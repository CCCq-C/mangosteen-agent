//! Codex CLI subprocess transport.
//!
//! This mirrors the Claude Code CLI transport, but treats `codex` as a
//! local completion engine via `codex exec --json`. The webview can only
//! spawn this fixed command; it cannot execute arbitrary shell commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::cli_resolver::{child_path_env, find_cli_command};

#[derive(Default)]
pub struct CodexCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

const DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 10;
const MIN_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 1;
const MAX_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 240;
const STDERR_LIMIT_BYTES: usize = 1024 * 1024;
const STDOUT_LIMIT_BYTES: usize = 1024 * 1024;
const MAX_CODEX_CLI_IMAGES: usize = 5;
const MAX_CODEX_CLI_IMAGE_BYTES: usize = 7 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliImage {
    pub media_type: String,
    pub data_base64: String,
}

struct TemporaryCodexCliImages {
    dir: PathBuf,
    paths: Vec<PathBuf>,
}

impl Drop for TemporaryCodexCliImages {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn append_capped_line(collected: &mut String, line: &str, limit_bytes: usize) {
    if collected.len() >= limit_bytes {
        return;
    }
    for ch in line.chars() {
        if collected.len() + ch.len_utf8() > limit_bytes {
            break;
        }
        collected.push(ch);
    }
    if collected.len() < limit_bytes {
        collected.push('\n');
    }
}

async fn find_codex_command() -> Result<PathBuf, String> {
    find_cli_command("codex", &["codex.cmd", "codex.exe"]).await
}

fn suppress_windows_console(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[tauri::command]
pub async fn codex_cli_detect() -> Result<DetectResult, String> {
    let path = match find_codex_command().await {
        Ok(p) => p,
        Err(error) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                error: Some(error),
            });
        }
    };

    let path_str = path.to_string_lossy().to_string();
    let mut cmd = Command::new(&path);
    suppress_windows_console(&mut cmd);
    // `codex` is a node shim (`#!/usr/bin/env node`); under a GUI launch the
    // inherited PATH lacks node, so hand it the login shell PATH or its
    // shebang fails with `env: node: No such file or directory`.
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    let output = tokio::time::timeout(Duration::from_secs(3), cmd.arg("--version").output()).await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(DetectResult {
                installed: true,
                version: Some(stdout),
                path: Some(path_str),
                error: None,
            })
        }
        Ok(Ok(out)) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                error: Some(if stderr.is_empty() {
                    format!("`codex --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some(format!("无法启动 `codex`：{e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some("`codex --version` timed out after 3s".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn codex_cli_spawn(
    app: AppHandle,
    state: State<'_, CodexCliState>,
    stream_id: String,
    model: String,
    prompt: String,
    images: Vec<CodexCliImage>,
    isolate_local_config: bool,
    timeout_minutes: Option<u64>,
    working_directory: Option<String>,
) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("没有可发送给 Codex CLI 的提示词".to_string());
    }

    let working_directory = resolve_codex_working_directory(working_directory).await?;
    let temporary_images = prepare_codex_cli_images(&images).await?;
    let codex = find_codex_command().await?;
    let mut cmd = Command::new(&codex);
    suppress_windows_console(&mut cmd);
    // See `codex_cli_detect`: the node shim needs the login shell PATH at run
    // time so its shebang resolves `node` under a GUI launch.
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    cmd.args(build_codex_cli_args_with_images(
        &model,
        isolate_local_config,
        &temporary_images.paths,
    ));
    cmd.current_dir(&working_directory);

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn codex: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Missing stdin handle".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout handle".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing stderr handle".to_string())?;

    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to codex stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush codex stdin: {e}"))?;
    drop(stdin);

    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let timeout_children = Arc::clone(&state.children);
    let timed_out = Arc::new(AtomicBool::new(false));
    let timeout_flag = Arc::clone(&timed_out);
    let timeout_stream_id = stream_id.clone();
    let timeout_minutes = codex_timeout_minutes(timeout_minutes);
    let timeout_duration = Duration::from_secs(timeout_minutes * 60);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let topic = format!("codex-cli:{stream_id}");
    let done_topic = format!("codex-cli:{stream_id}:done");

    tokio::spawn(async move {
        tokio::time::sleep(timeout_duration).await;
        if let Some(mut child) = timeout_children.lock().await.remove(&timeout_stream_id) {
            timeout_flag.store(true, Ordering::SeqCst);
            let _ = child.start_kill();
        }
    });

    tokio::spawn(async move {
        let _temporary_images = temporary_images;
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[codex-cli stderr] {line}");
                append_capped_line(&mut collected, &line, STDERR_LIMIT_BYTES);
            }
            collected
        });

        let mut stdout_text = String::new();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    append_capped_line(&mut stdout_text, &line, STDOUT_LIMIT_BYTES);
                    if app.emit(&topic, line).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[codex-cli stdout] read error: {e}");
                    break;
                }
            }
        }

        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            None
        };

        let mut stderr_text = stderr_task.await.unwrap_or_default();
        if timed_out.load(Ordering::SeqCst) {
            if !stderr_text.is_empty() {
                stderr_text.push('\n');
            }
            stderr_text.push_str(&format!(
                "Codex CLI timed out after {timeout_minutes} minutes."
            ));
        } else if stderr_text.len() >= STDERR_LIMIT_BYTES {
            stderr_text.push_str("\n[stderr truncated]");
        }
        if stdout_text.len() >= STDOUT_LIMIT_BYTES {
            stdout_text.push_str("\n[stdout truncated]");
        }

        let code = if timed_out.load(Ordering::SeqCst) {
            Some(-1)
        } else {
            exit_code
        };

        let _ = app.emit(
            &done_topic,
            serde_json::json!({
                "code": code,
                "stderr": stderr_text,
                "stdout": stdout_text,
            }),
        );
    });

    Ok(())
}

pub(crate) fn codex_timeout_minutes(value: Option<u64>) -> u64 {
    value.unwrap_or(DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES).clamp(
        MIN_CODEX_SPAWN_TIMEOUT_MINUTES,
        MAX_CODEX_SPAWN_TIMEOUT_MINUTES,
    )
}

fn build_codex_cli_args_with_images(
    model: &str,
    isolate_local_config: bool,
    images: &[PathBuf],
) -> Vec<String> {
    let mut args = vec!["-a".to_string(), "never".to_string(), "exec".to_string()];

    if isolate_local_config {
        args.extend([
            "--ignore-user-config".to_string(),
            "--ignore-rules".to_string(),
        ]);
    }

    args.extend([
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--ephemeral".to_string(),
        "--model".to_string(),
        model.to_string(),
    ]);
    if !images.is_empty() {
        args.push("--image".to_string());
        args.extend(images.iter().map(|path| path.to_string_lossy().to_string()));
    }
    args.push("-".to_string());
    args
}

async fn prepare_codex_cli_images(
    images: &[CodexCliImage],
) -> Result<TemporaryCodexCliImages, String> {
    if images.len() > MAX_CODEX_CLI_IMAGES {
        return Err(format!(
            "At most {MAX_CODEX_CLI_IMAGES} images can be sent to Codex CLI at once"
        ));
    }
    let images = images.to_vec();
    tokio::task::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(format!("llm-wiki-codex-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create temporary Codex image directory: {e}"))?;
        let mut temporary = TemporaryCodexCliImages {
            dir,
            paths: Vec::with_capacity(images.len()),
        };
        for (index, image) in images.iter().enumerate() {
            let extension = codex_cli_image_extension(&image.media_type)?;
            let bytes = B64
                .decode(image.data_base64.trim())
                .map_err(|_| "Codex CLI image data is not valid base64".to_string())?;
            if bytes.len() > MAX_CODEX_CLI_IMAGE_BYTES {
                return Err(format!(
                    "Each Codex CLI image must be at most {} MB",
                    MAX_CODEX_CLI_IMAGE_BYTES / (1024 * 1024)
                ));
            }
            let path = temporary.dir.join(format!("image-{index}.{extension}"));
            std::fs::write(&path, bytes)
                .map_err(|e| format!("Failed to write temporary Codex image: {e}"))?;
            temporary.paths.push(path);
        }
        Ok(temporary)
    })
    .await
    .map_err(|e| format!("Failed to prepare Codex CLI images: {e}"))?
}

fn codex_cli_image_extension(media_type: &str) -> Result<&'static str, String> {
    match media_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Ok("png"),
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        _ => Err(format!("Unsupported Codex CLI image type: {media_type}")),
    }
}

pub(crate) async fn codex_cli_complete(
    model: &str,
    isolate_local_config: bool,
    timeout_minutes: u64,
    prompt: &str,
    images: &[CodexCliImage],
    working_directory: Option<String>,
) -> Result<String, String> {
    if model.trim().is_empty() {
        return Err("尚未配置 Codex CLI 模型".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("没有可发送给 Codex CLI 的提示词".to_string());
    }

    let working_directory = resolve_codex_working_directory(working_directory).await?;
    let temporary_images = prepare_codex_cli_images(images).await?;
    let codex = find_codex_command().await?;
    let mut cmd = Command::new(&codex);
    suppress_windows_console(&mut cmd);
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    cmd.args(build_codex_cli_args_with_images(
        model,
        isolate_local_config,
        &temporary_images.paths,
    ));
    cmd.current_dir(working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex CLI: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Missing Codex CLI stdin handle".to_string())?;
    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to Codex CLI stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush Codex CLI stdin: {e}"))?;
    drop(stdin);

    let timeout_minutes = codex_timeout_minutes(Some(timeout_minutes));
    let output = tokio::time::timeout(
        Duration::from_secs(timeout_minutes * 60),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| format!("Codex CLI 在 {timeout_minutes} 分钟后超时"))?
    .map_err(|e| format!("Failed while waiting for Codex CLI: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let detail = if stderr.is_empty() {
            stdout.trim()
        } else {
            stderr.as_str()
        };
        return Err(if detail.is_empty() {
            format!("Codex CLI exited with {status}", status = output.status)
        } else {
            format!(
                "Codex CLI exited with {status}: {detail}",
                status = output.status
            )
        });
    }

    parse_codex_cli_response(&stdout)
}

fn parse_codex_cli_response(output: &str) -> Result<String, String> {
    let mut answer = None;
    for line in output.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(item) = event
            .as_object()
            .filter(|event| event.get("type").and_then(Value::as_str) == Some("item.completed"))
            .and_then(|event| event.get("item"))
            .and_then(Value::as_object)
        else {
            continue;
        };
        if item.get("type").and_then(Value::as_str) == Some("agent_message") {
            if let Some(text) = item
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
            {
                answer = Some(text.to_string());
            }
        }
    }
    answer.ok_or_else(|| "Codex CLI completed but did not emit an agent_message".to_string())
}

async fn resolve_codex_working_directory(value: Option<String>) -> Result<PathBuf, String> {
    let raw = value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Codex CLI 需要一个已打开项目作为工作目录".to_string())?;
    let path = Path::new(raw.as_str());
    if !path.is_absolute() {
        return Err("Codex CLI 工作目录必须是项目的绝对路径".to_string());
    }
    let path_meta = tokio::fs::metadata(path).await.map_err(|e| {
        eprintln!("[codex-cli] failed to read working directory metadata {raw}: {e}");
        format!("Codex CLI 工作目录不存在或无法读取：{raw}")
    })?;
    if !path_meta.is_dir() {
        return Err(format!("Codex CLI 工作目录不是文件夹：{raw}"));
    }
    let index_path = path.join("wiki").join("index.md");
    let index_meta = tokio::fs::metadata(&index_path).await.map_err(|e| {
        eprintln!("[codex-cli] failed to read wiki/index.md metadata for {raw}: {e}");
        format!("Codex CLI 工作目录必须是包含 wiki/index.md 的山竹智能体项目：{raw}")
    })?;
    if !index_meta.is_file() {
        return Err(format!(
            "Codex CLI 工作目录必须是包含 wiki/index.md 的山竹智能体项目：{raw}"
        ));
    }
    tokio::fs::canonicalize(path)
        .await
        .map_err(|e| format!("无法解析 Codex CLI 工作目录 {raw}：{e}"))
}

#[tauri::command]
pub async fn codex_cli_kill(
    state: State<'_, CodexCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_capped_line_appends_newline_when_space_remains() {
        let mut out = String::new();
        append_capped_line(&mut out, "hello", 16);
        assert_eq!(out, "hello\n");
    }

    #[test]
    fn append_capped_line_never_exceeds_limit() {
        let mut out = String::new();
        append_capped_line(&mut out, "abcdef", 4);
        assert_eq!(out, "abcd");
        assert_eq!(out.len(), 4);
        append_capped_line(&mut out, "ignored", 4);
        assert_eq!(out, "abcd");
    }

    #[test]
    fn append_capped_line_preserves_utf8_boundaries() {
        let mut out = String::new();
        append_capped_line(&mut out, "é水x", 5);
        assert_eq!(out, "é水");
        assert_eq!(out.len(), 5);
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    #[test]
    fn backend_response_uses_the_last_completed_agent_message() {
        let output = concat!(
            "{\"type\":\"thread.started\"}\n",
            "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"first\"}}\n",
            "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"final answer\"}}\n"
        );

        assert_eq!(parse_codex_cli_response(output).unwrap(), "final answer");
    }

    #[test]
    fn codex_timeout_minutes_defaults_and_clamps() {
        assert_eq!(
            codex_timeout_minutes(None),
            DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES
        );
        assert_eq!(
            codex_timeout_minutes(Some(0)),
            MIN_CODEX_SPAWN_TIMEOUT_MINUTES
        );
        assert_eq!(codex_timeout_minutes(Some(42)), 42);
        assert_eq!(
            codex_timeout_minutes(Some(999)),
            MAX_CODEX_SPAWN_TIMEOUT_MINUTES
        );
    }

    #[test]
    fn codex_args_do_not_isolate_local_config_by_default() {
        let args = build_codex_cli_args_with_images("gpt-5", false, &[]);

        assert!(args
            .windows(3)
            .any(|pair| pair[0] == "-a" && pair[1] == "never" && pair[2] == "exec"));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"gpt-5".to_string()));
        assert!(!args.contains(&"--ignore-user-config".to_string()));
        assert!(!args.contains(&"--ignore-rules".to_string()));
    }

    #[test]
    fn codex_args_attach_images_before_the_stdin_prompt() {
        let args = build_codex_cli_args_with_images(
            "gpt-5",
            false,
            &[
                PathBuf::from("C:/temp/chart.png"),
                PathBuf::from("C:/temp/screenshot.jpg"),
            ],
        );
        let image_pos = args
            .iter()
            .position(|arg| arg == "--image")
            .expect("image flag");
        let stdin_pos = args
            .iter()
            .position(|arg| arg == "-")
            .expect("stdin prompt");

        assert!(image_pos < stdin_pos);
        assert_eq!(args[image_pos + 1], "C:/temp/chart.png");
        assert_eq!(args[image_pos + 2], "C:/temp/screenshot.jpg");
    }

    #[test]
    fn codex_args_can_isolate_user_config_and_rules() {
        let args = build_codex_cli_args_with_images("gpt-5", true, &[]);
        let exec_pos = args.iter().position(|arg| arg == "exec").expect("exec arg");
        let ignore_config_pos = args
            .iter()
            .position(|arg| arg == "--ignore-user-config")
            .expect("ignore-user-config arg");
        let ignore_rules_pos = args
            .iter()
            .position(|arg| arg == "--ignore-rules")
            .expect("ignore-rules arg");

        assert!(ignore_config_pos > exec_pos);
        assert!(ignore_rules_pos > exec_pos);
    }

    struct TestDir(PathBuf);

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn codex_working_directory_requires_absolute_existing_project() {
        assert!(resolve_codex_working_directory(None)
            .await
            .unwrap_err()
            .contains("已打开项目"));
        assert!(resolve_codex_working_directory(Some("".to_string()))
            .await
            .unwrap_err()
            .contains("已打开项目"));
        assert!(resolve_codex_working_directory(Some("   ".to_string()))
            .await
            .unwrap_err()
            .contains("已打开项目"));
        assert!(
            resolve_codex_working_directory(Some("relative/project".to_string()))
                .await
                .unwrap_err()
                .contains("绝对路径")
        );

        let missing =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert!(
            resolve_codex_working_directory(Some(missing.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("不存在或无法读取")
        );

        let file_path =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-file-{}", std::process::id()));
        let _ = std::fs::remove_file(&file_path);
        std::fs::write(&file_path, "not a directory").expect("temp file");
        struct TestFile(PathBuf);
        impl Drop for TestFile {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _file_guard = TestFile(file_path.clone());
        assert!(
            resolve_codex_working_directory(Some(file_path.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("不是文件夹")
        );

        let dir =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tempdir");
        let _guard = TestDir(dir.clone());
        assert!(
            resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("wiki/index.md")
        );

        let wiki_dir = dir.join("wiki");
        std::fs::create_dir_all(&wiki_dir).expect("wiki dir");
        let index_dir = wiki_dir.join("index.md");
        std::fs::create_dir_all(&index_dir).expect("index dir");
        assert!(
            resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("wiki/index.md")
        );
        std::fs::remove_dir_all(&index_dir).expect("remove index dir");
        std::fs::write(wiki_dir.join("index.md"), "# Index\n").expect("index");
        let resolved = resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
            .await
            .expect("valid project path");
        assert_eq!(resolved, dir.canonicalize().expect("canonical tempdir"));
    }
}
