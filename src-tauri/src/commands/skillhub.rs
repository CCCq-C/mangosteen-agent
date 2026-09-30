use std::path::Path;
use std::time::Duration;

use futures::future::join_all;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::commands::cli_resolver::{child_path_env, find_cli_command};
use crate::panic_guard::run_guarded_async;

const SKILLHUB_PACKAGE: &str = "@astron-team/skillhub@latest";
const SKILLHUB_WEB_URL: &str = "https://skill.xfyun.cn";
const SKILLHUB_API_URL: &str = "https://skill.xfyun.cn/api/v1/skills";
const MAX_SEARCH_RESULTS: usize = 30;
const RECOMMENDATION_LIMIT: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillhubSkill {
    pub namespace: String,
    pub slug: String,
    pub latest_version: String,
    pub summary: String,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub stars: u64,
    #[serde(default)]
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillhubRecommendationPage {
    pub items: Vec<SkillhubSkill>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SkillhubSearchOutput {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    items: Vec<SkillhubSkill>,
}

#[derive(Debug, Deserialize)]
struct SkillhubDetailResponse {
    code: i32,
    data: SkillhubDetail,
}

#[derive(Debug, Deserialize)]
struct SkillhubRecommendedResponse {
    #[serde(default)]
    items: Vec<SkillhubRecommendedItem>,
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillhubRecommendedItem {
    slug: String,
    #[serde(default)]
    summary: String,
    stats: SkillhubStats,
    latest_version: SkillhubLatestVersion,
}

#[derive(Debug, Deserialize)]
struct SkillhubLatestVersion {
    version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillhubDetail {
    download_count: u64,
    star_count: u64,
}

#[derive(Debug, Deserialize, PartialEq)]
struct SkillhubStats {
    downloads: u64,
    stars: u64,
}

#[tauri::command]
pub async fn skillhub_recommended(
    page: Option<usize>,
) -> Result<SkillhubRecommendationPage, String> {
    run_guarded_async("skillhub_recommended", async move {
        let client = crate::proxy::configure_http_client(reqwest::Client::builder())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| format!("Could not create SkillHub client: {error}"))?;
        let mut query = vec![
            ("sort", "downloads".to_string()),
            ("order", "desc".to_string()),
            ("limit", RECOMMENDATION_LIMIT.to_string()),
        ];
        query.push(("page", page.unwrap_or(1).max(1).to_string()));
        let response = client
            .get(SKILLHUB_API_URL)
            .query(&query)
            .send()
            .await
            .map_err(|error| format!("Could not load SkillHub recommendations: {error}"))?
            .error_for_status()
            .map_err(|error| format!("SkillHub recommendations failed: {error}"))?;
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("Could not read SkillHub recommendations: {error}"))?;
        parse_skillhub_recommended(&body)
    })
    .await
}

#[tauri::command]
pub async fn skillhub_search(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SkillhubSkill>, String> {
    run_guarded_async("skillhub_search", async move {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.unwrap_or(12).clamp(1, MAX_SEARCH_RESULTS);
        let args = vec![
            "--yes".to_string(),
            SKILLHUB_PACKAGE.to_string(),
            "search".to_string(),
            query.to_string(),
            "--limit".to_string(),
            limit.to_string(),
            "--json".to_string(),
        ];
        let output = run_skillhub(&args).await?;
        let parsed: SkillhubSearchOutput =
            serde_json::from_slice(&output.stdout).map_err(|_| {
                format!(
                    "SkillHub returned invalid search data: {}",
                    output_text(&output.stdout)
                )
            })?;
        if !parsed.ok {
            return Err("SkillHub could not complete the search".to_string());
        }
        let client = crate::proxy::configure_http_client(reqwest::Client::builder())
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| format!("Could not create SkillHub client: {error}"))?;
        Ok(join_all(parsed.items.into_iter().map(|skill| {
            let client = client.clone();
            async move { enrich_skillhub_skill(&client, skill).await }
        }))
        .await)
    })
    .await
}

#[tauri::command]
pub async fn skillhub_install(project_path: String, coordinate: String) -> Result<(), String> {
    run_guarded_async("skillhub_install", async move {
        let args = skillhub_install_args(Path::new(&project_path), &coordinate)?;
        run_skillhub(&args).await.map(|_| ())
    })
    .await
}

fn skillhub_install_args(project_path: &Path, coordinate: &str) -> Result<Vec<String>, String> {
    let coordinate = normalize_coordinate(coordinate)?;
    let target = project_path.join(".llm-wiki").join("skills");
    Ok(vec![
        "--yes".to_string(),
        SKILLHUB_PACKAGE.to_string(),
        "install".to_string(),
        coordinate,
        "--dir".to_string(),
        target.to_string_lossy().replace('\\', "/"),
    ])
}

fn normalize_coordinate(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.contains("..")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'@' | b'/' | b'-' | b'_'))
    {
        return Err("Invalid SkillHub skill identifier".to_string());
    }
    Ok(value.to_string())
}

async fn run_skillhub(args: &[String]) -> Result<std::process::Output, String> {
    let npx = find_cli_command("npx", &["npx.cmd", "npx.exe"]).await?;
    let mut command = Command::new(npx);
    command.args(args).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    if let Some(path) = child_path_env().await {
        command.env("PATH", path);
    }
    let output = command
        .output()
        .await
        .map_err(|error| format!("Could not run SkillHub: {error}"))?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!("SkillHub failed: {}", output_text(&output.stderr)))
    }
}

async fn enrich_skillhub_skill(
    client: &reqwest::Client,
    mut skill: SkillhubSkill,
) -> SkillhubSkill {
    let Ok(url) = skillhub_detail_url(&skill.namespace, &skill.slug) else {
        return skill;
    };
    skill.source_url = url.clone();
    let Ok(response) = client
        .get(format!(
            "{SKILLHUB_API_URL}/{}/{}",
            skill.namespace, skill.slug
        ))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
    else {
        return skill;
    };
    let Ok(bytes) = response.bytes().await else {
        return skill;
    };
    if let Ok(stats) = parse_skillhub_detail(&bytes) {
        skill.downloads = stats.downloads;
        skill.stars = stats.stars;
    }
    skill
}

fn skillhub_detail_url(namespace: &str, slug: &str) -> Result<String, String> {
    if namespace.is_empty()
        || slug.is_empty()
        || !namespace
            .bytes()
            .chain(slug.bytes())
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid SkillHub skill identifier".to_string());
    }
    Ok(format!("{SKILLHUB_WEB_URL}/space/{namespace}/{slug}"))
}

fn parse_skillhub_detail(bytes: &[u8]) -> Result<SkillhubStats, String> {
    let response: SkillhubDetailResponse = serde_json::from_slice(bytes)
        .map_err(|error| format!("SkillHub returned invalid detail data: {error}"))?;
    if response.code != 0 {
        return Err("SkillHub could not load skill statistics".to_string());
    }
    Ok(SkillhubStats {
        downloads: response.data.download_count,
        stars: response.data.star_count,
    })
}

fn parse_skillhub_recommended(bytes: &[u8]) -> Result<SkillhubRecommendationPage, String> {
    let response: SkillhubRecommendedResponse = serde_json::from_slice(bytes)
        .map_err(|error| format!("SkillHub returned invalid recommendation data: {error}"))?;
    let next_cursor = response.next_cursor;
    let items = response.items.into_iter().filter_map(|item| {
            let source_url = skillhub_detail_url("global", &item.slug).ok()?;
            Some(SkillhubSkill {
                namespace: "global".to_string(),
                slug: item.slug,
                latest_version: item.latest_version.version,
                summary: item.summary,
                downloads: item.stats.downloads,
                stars: item.stats.stars,
                source_url,
            })
        }).collect();
    Ok(SkillhubRecommendationPage { items, next_cursor })
}

fn output_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim()
        .chars()
        .take(500)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn install_command_keeps_a_skill_inside_the_current_project() {
        assert_eq!(
            skillhub_install_args(Path::new("C:/wiki"), "@global/docx-to-pdf").unwrap(),
            vec![
                "--yes",
                "@astron-team/skillhub@latest",
                "install",
                "@global/docx-to-pdf",
                "--dir",
                "C:/wiki/.llm-wiki/skills",
            ]
        );
    }

    #[test]
    fn install_command_rejects_a_path_instead_of_a_skill_coordinate() {
        assert!(skillhub_install_args(Path::new("C:/wiki"), "../../secret").is_err());
    }

    #[test]
    fn detail_url_points_to_the_public_skill_page() {
        assert_eq!(
            skillhub_detail_url("global", "yidiandian").unwrap(),
            "https://skill.xfyun.cn/space/global/yidiandian"
        );
    }

    #[test]
    fn detail_response_exposes_downloads_and_stars() {
        let detail =
            parse_skillhub_detail(br#"{"code":0,"data":{"downloadCount":11,"starCount":1}}"#)
                .unwrap();

        assert_eq!(detail.downloads, 11);
        assert_eq!(detail.stars, 1);
    }

    #[test]
    fn recommendation_response_keeps_download_and_star_counts() {
        let page = parse_skillhub_recommended(
            br#"{"items":[{"slug":"word-docx","summary":"docs","stats":{"downloads":2282,"stars":1},"latestVersion":{"version":"1.0.2"}}]}"#,
        )
        .unwrap();

        assert_eq!(page.items[0].slug, "word-docx");
        assert_eq!(page.items[0].downloads, 2282);
        assert_eq!(page.items[0].stars, 1);
        assert_eq!(page.next_cursor.as_deref(), None);
    }
}
