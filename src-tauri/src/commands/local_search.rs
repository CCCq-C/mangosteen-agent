use std::{
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const LOCAL_SEARCH_PORT: u16 = 17888;
const LOCAL_SEARCH_ENDPOINT: &str = "http://127.0.0.1:17888";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(12);

pub struct LocalSearchState(Mutex<Option<Child>>);

impl Default for LocalSearchState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSearchStatus {
    pub state: String,
    pub endpoint: String,
    pub detail: String,
}

#[tauri::command]
pub async fn ensure_local_search(
    app: AppHandle,
    state: State<'_, LocalSearchState>,
) -> Result<LocalSearchStatus, String> {
    let runtime_dir = find_runtime_dir(&app)?;
    let config_path = ensure_settings_file(&app)?;
    {
        let mut child = state
            .0
            .lock()
            .map_err(|_| "Local search state is unavailable.".to_string())?;

        let is_running = child
            .as_mut()
            .map(|process| process.try_wait().map(|exit| exit.is_none()))
            .transpose()
            .map_err(|err| format!("Could not check local search process: {err}"))?
            .unwrap_or(false);
        if !is_running {
            *child = Some(start_runtime(&runtime_dir, &config_path)?);
        }
    }

    if wait_for_loopback().await {
        Ok(LocalSearchStatus {
            state: "ready".to_string(),
            endpoint: LOCAL_SEARCH_ENDPOINT.to_string(),
            detail: "本机联网搜索已就绪".to_string(),
        })
    } else {
        Err("本机联网搜索启动超时。请在高级设置中点击“重新启动本机搜索”。".to_string())
    }
}

#[tauri::command]
pub fn local_search_status(state: State<'_, LocalSearchState>) -> LocalSearchStatus {
    let managed = state
        .0
        .lock()
        .ok()
        .and_then(|mut child| {
            child.as_mut().map(|process| {
                process
                    .try_wait()
                    .map(|exit| exit.is_none())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    let ready = loopback_available();
    LocalSearchStatus {
        state: if ready {
            "ready"
        } else if managed {
            "starting"
        } else {
            "stopped"
        }
        .to_string(),
        endpoint: LOCAL_SEARCH_ENDPOINT.to_string(),
        detail: if ready {
            "本机联网搜索已就绪".to_string()
        } else {
            "本机联网搜索尚未启动".to_string()
        },
    }
}

#[tauri::command]
pub async fn restart_local_search(
    app: AppHandle,
    state: State<'_, LocalSearchState>,
) -> Result<LocalSearchStatus, String> {
    stop_local_search_inner(&state);
    ensure_local_search(app, state).await
}

pub fn stop_local_search_inner(state: &LocalSearchState) {
    let Ok(mut child) = state.0.lock() else {
        return;
    };
    if let Some(mut process) = child.take() {
        let _ = process.kill();
        let _ = process.wait();
    }
}

/// Upgrade only the empty search selection written by old releases. This runs
/// before the webview loads so a broken frontend setting cannot suppress the
/// zero-configuration local default.
pub fn adopt_local_search_default(app: &AppHandle) -> Result<bool, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Could not resolve app data directory: {err}"))?
        .join("app-state.json");
    if !path.is_file() {
        return Ok(false);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|err| format!("Could not read app settings: {err}"))?;
    let mut root: Value = serde_json::from_str(&text)
        .map_err(|err| format!("Could not read app settings JSON: {err}"))?;
    if !migrate_search_config(&mut root) {
        return Ok(false);
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&root)
            .map_err(|err| format!("Could not encode app settings: {err}"))?,
    )
    .map_err(|err| format!("Could not save app settings: {err}"))?;
    Ok(true)
}

fn migrate_search_config(root: &mut Value) -> bool {
    let Some(root) = root.as_object_mut() else {
        return false;
    };
    let config = root
        .entry("searchApiConfig".to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    let Some(config) = config.as_object_mut() else {
        return false;
    };
    let provider = config.get("provider").and_then(Value::as_str).unwrap_or("");
    let empty_key = config
        .get("apiKey")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    let empty_searx = config
        .get("searXngUrl")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    let empty_ollama = config
        .get("ollamaUrl")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty() || value == "https://ollama.com");
    if !((provider.is_empty() || provider == "none")
        && empty_key
        && empty_searx
        && empty_ollama
        && !has_saved_provider_config(config.get("providerConfigs")))
    {
        return false;
    }

    config.insert("provider".to_string(), json!("searxng"));
    config.insert("apiKey".to_string(), json!(""));
    config.insert("searXngUrl".to_string(), json!(LOCAL_SEARCH_ENDPOINT));
    config.insert("searXngCategories".to_string(), json!(["general"]));
    config.insert("deepResearchSource".to_string(), json!("both"));
    config.insert(
        "providerConfigs".to_string(),
        json!({
            "searxng": {
                "searXngUrl": LOCAL_SEARCH_ENDPOINT,
                "searXngCategories": ["general"]
            }
        }),
    );
    true
}

fn has_saved_provider_config(configs: Option<&Value>) -> bool {
    configs.and_then(Value::as_object).is_some_and(|providers| {
        providers.values().any(|provider| {
            ["apiKey", "baseUrl", "ollamaUrl", "searXngUrl"]
                .iter()
                .any(|key| {
                    provider
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty())
                })
        })
    })
}

fn find_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("local-search-runtime"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local-search-runtime"));
    candidates
        .into_iter()
        .find(|dir| dir.join("python").join("python.exe").is_file())
        .ok_or_else(|| "本机联网搜索组件缺失。请重新安装山竹智能体。".to_string())
}

fn ensure_settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Could not resolve app data directory: {err}"))?
        .join("local-search");
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Could not prepare local search settings: {err}"))?;
    let path = dir.join("settings.yml");
    std::fs::write(
        &path,
        render_settings(
            &Uuid::new_v4().to_string(),
            LOCAL_SEARCH_PORT,
            configured_proxy().as_deref(),
        ),
    )
    .map_err(|err| format!("Could not write local search settings: {err}"))?;
    Ok(path)
}

fn configured_proxy() -> Option<String> {
    let value = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .ok()?;
    let parsed = reqwest::Url::parse(&value).ok()?;
    matches!(parsed.scheme(), "http" | "https").then_some(value)
}

fn start_runtime(runtime_dir: &Path, settings_path: &Path) -> Result<Child, String> {
    let python = runtime_dir.join("python").join("python.exe");
    let webapp = runtime_dir
        .join("python")
        .join("Lib")
        .join("site-packages")
        .join("searx")
        .join("webapp.py");
    if !webapp.is_file() {
        return Err("本机联网搜索组件不完整。请重新安装山竹智能体。".to_string());
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(settings_path.with_extension("log"))
        .map_err(|err| format!("Could not open local search log: {err}"))?;
    let log_copy = log
        .try_clone()
        .map_err(|err| format!("Could not prepare local search log: {err}"))?;
    let mut command = Command::new(python);
    command
        .arg(webapp)
        .current_dir(runtime_dir)
        .env("SEARXNG_SETTINGS_PATH", settings_path)
        .env("SEARXNG_DISABLE_ETC_SETTINGS", "1")
        .stdin(std::process::Stdio::null())
        .stdout(log_copy)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
        .spawn()
        .map_err(|err| format!("Could not start local web search: {err}"))
}

async fn wait_for_loopback() -> bool {
    let started = std::time::Instant::now();
    while started.elapsed() < STARTUP_TIMEOUT {
        if loopback_available() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

fn loopback_available() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], LOCAL_SEARCH_PORT));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn render_settings(secret: &str, port: u16, proxy: Option<&str>) -> String {
    let proxy_line = proxy
        .map(|value| format!("  proxies: \"{}\"\n", value.replace('"', "\\\"")))
        .unwrap_or_default();
    format!(
        r#"use_default_settings: true
general:
  instance_name: "山竹本机搜索"
  enable_metrics: false
search:
  safe_search: 1
  default_lang: auto
server:
  bind_address: "127.0.0.1"
  port: {port}
  secret_key: "{secret}"
  limiter: false
outgoing:
  request_timeout: 10.0
{proxy_line}
engines:
  - name: 360search
    disabled: false
  - name: quark
    disabled: false
"#
    )
}

#[cfg(test)]
mod tests {
    use super::{
        loopback_available, migrate_search_config, render_settings, start_runtime,
        LOCAL_SEARCH_ENDPOINT, LOCAL_SEARCH_PORT,
    };
    use serde_json::json;
    use std::{fs, thread, time::Duration};
    use uuid::Uuid;

    #[test]
    fn generated_settings_are_loopback_only_and_use_the_requested_port() {
        let settings = render_settings("test-secret", 17888, Some("http://127.0.0.1:7892"));
        assert!(settings.contains("general:\n  instance_name: \"山竹本机搜索\""));
        assert!(settings.contains("bind_address: \"127.0.0.1\""));
        assert!(settings.contains("port: 17888"));
        assert!(settings.contains("secret_key: \"test-secret\""));
        assert!(settings.contains("enable_metrics: false"));
        assert!(settings.contains("proxies: \"http://127.0.0.1:7892\""));
        assert!(settings.contains("- name: 360search\n    disabled: false"));
        assert!(settings.contains("- name: quark\n    disabled: false"));
    }

    #[test]
    fn migrates_only_the_empty_legacy_search_selection() {
        let mut legacy = json!({
            "searchApiConfig": {
                "provider": "none",
                "apiKey": "",
                "ollamaUrl": "https://ollama.com",
                "providerConfigs": {}
            }
        });
        assert!(migrate_search_config(&mut legacy));
        assert_eq!(legacy["searchApiConfig"]["provider"], "searxng");
        assert_eq!(
            legacy["searchApiConfig"]["searXngUrl"],
            LOCAL_SEARCH_ENDPOINT
        );

        let mut configured = json!({
            "searchApiConfig": {
                "provider": "none",
                "apiKey": "",
                "providerConfigs": { "tavily": { "apiKey": "saved-key" } }
            }
        });
        assert!(!migrate_search_config(&mut configured));
    }

    #[test]
    #[ignore = "requires the build-time bundled Windows local search runtime"]
    fn bundled_runtime_starts_on_the_loopback_endpoint() {
        assert!(
            !loopback_available(),
            "test port {LOCAL_SEARCH_PORT} is already occupied"
        );
        let runtime =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local-search-runtime");
        let settings =
            std::env::temp_dir().join(format!("mangosteen-local-search-{}.yml", Uuid::new_v4()));
        fs::write(
            &settings,
            render_settings("test-secret", LOCAL_SEARCH_PORT, None),
        )
        .unwrap();
        let mut child = start_runtime(&runtime, &settings).unwrap();
        let mut ready = false;
        let mut exit_status = None;
        for _ in 0..60 {
            if loopback_available() {
                ready = true;
                break;
            }
            if let Some(status) = child.try_wait().unwrap() {
                exit_status = Some(status);
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
        let _ = child.kill();
        let _ = child.wait();
        let log_path = settings.with_extension("log");
        let log_text = fs::read_to_string(&log_path).unwrap_or_default();
        let _ = fs::remove_file(&settings);
        let _ = fs::remove_file(log_path);
        assert!(
            ready,
            "bundled runtime did not start on the loopback endpoint; process exit: {exit_status:?}; log: {log_text}"
        );
    }
}
