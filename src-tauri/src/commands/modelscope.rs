use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::commands::cli_resolver::{child_path_env, find_cli_command};
use crate::panic_guard::run_guarded_async;

const MODELSCOPE_SKILLS_API: &str = "https://modelscope.cn/openapi/v1/skills";
const MODELSCOPE_SKILL_URL_PREFIX: &str = "https://modelscope.cn/skills/";
const MAX_SEARCH_RESULTS: usize = 30;
const RECOMMENDATION_LIMIT: usize = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelscopeSkill {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub logo_url: String,
    pub downloads: u64,
    pub view_count: u64,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelscopeRecommendationPage {
    pub items: Vec<ModelscopeSkill>,
    pub page_number: usize,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
struct ModelscopeSearchResponse {
    success: bool,
    data: Option<ModelscopeApiSearchData>,
}

#[derive(Debug, Deserialize)]
struct ModelscopeApiSearchData {
    #[serde(default)]
    skills: Vec<ModelscopeApiSkill>,
    #[serde(default)]
    total: Option<usize>,
    #[serde(default)]
    page_number: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct ModelscopeApiSkill {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    logo_url: Option<String>,
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    view_count: Option<u64>,
    #[serde(default)]
    locales: Option<ModelscopeLocales>,
}

#[derive(Debug, Deserialize)]
struct ModelscopeLocales {
    #[serde(default)]
    zh: Option<ModelscopeLocale>,
}

#[derive(Debug, Deserialize)]
struct ModelscopeLocale {
    #[serde(default)]
    description: Option<String>,
}

#[tauri::command]
pub async fn modelscope_search(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ModelscopeSkill>, String> {
    run_guarded_async("modelscope_search", async move {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.unwrap_or(12).clamp(1, MAX_SEARCH_RESULTS);
        Ok(fetch_modelscope_page(Some(query), limit, 1).await?.items)
    })
    .await
}

#[tauri::command]
pub async fn modelscope_recommended(
    page: Option<usize>,
) -> Result<ModelscopeRecommendationPage, String> {
    run_guarded_async("modelscope_recommended", async move {
        fetch_modelscope_page(None, RECOMMENDATION_LIMIT, page.unwrap_or(1).max(1)).await
    })
    .await
}

fn parse_modelscope_recommendation_page(
    bytes: &[u8],
) -> Result<ModelscopeRecommendationPage, String> {
    let result: ModelscopeSearchResponse = serde_json::from_slice(bytes)
        .map_err(|error| format!("ModelScope returned invalid search data: {error}"))?;
    if !result.success {
        return Err("ModelScope could not complete the search".to_string());
    }
    let data = result.data.unwrap_or(ModelscopeApiSearchData {
        skills: Vec::new(),
        total: None,
        page_number: None,
    });
    let items = data.skills
        .into_iter()
        .filter_map(|skill| {
            let id = skill.id?.trim().to_string();
            let source_url = modelscope_skill_url(&id).ok()?;
            Some(ModelscopeSkill {
                display_name: skill
                    .display_name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| id.clone()),
                description: skill
                    .locales
                    .and_then(|locales| locales.zh)
                    .and_then(|locale| locale.description)
                    .filter(|description| !description.trim().is_empty())
                    .or(skill.description)
                    .unwrap_or_default(),
                logo_url: skill.logo_url.unwrap_or_default(),
                downloads: skill.downloads.unwrap_or_default(),
                view_count: skill.view_count.unwrap_or_default(),
                source_url,
                id,
            })
        })
        .collect();
    Ok(ModelscopeRecommendationPage {
        items,
        page_number: data.page_number.unwrap_or(1).max(1),
        total: data.total.unwrap_or_default(),
    })
}

async fn fetch_modelscope_page(
    query: Option<&str>,
    limit: usize,
    page_number: usize,
) -> Result<ModelscopeRecommendationPage, String> {
    let client = crate::proxy::configure_http_client(reqwest::Client::builder())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not create ModelScope client: {error}"))?;
    let mut params = vec![
        ("page_size", limit.to_string()),
        ("page_number", page_number.to_string()),
    ];
    if let Some(query) = query {
        params.push(("search", query.to_string()));
    }
    let response = client
        .get(MODELSCOPE_SKILLS_API)
        .query(&params)
        .send()
        .await
        .map_err(|error| format!("Could not search ModelScope: {error}"))?
        .error_for_status()
        .map_err(|error| format!("ModelScope search failed: {error}"))?;
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read ModelScope search data: {error}"))?;
    parse_modelscope_recommendation_page(&body)
}

#[tauri::command]
pub async fn modelscope_install(project_path: String, skill_id: String) -> Result<(), String> {
    run_guarded_async("modelscope_install", async move {
        let skill_url = modelscope_skill_url(&skill_id)?;
        let npx = find_cli_command("npx", &["npx.cmd", "npx.exe"]).await?;
        let mut command = Command::new(npx);
        command
            .current_dir(Path::new(&project_path))
            .args(["--yes", "skills@latest", "add", &skill_url, "-y", "--copy"])
            .stdin(std::process::Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        if let Some(path) = child_path_env().await {
            command.env("PATH", path);
        }
        let output = command
            .output()
            .await
            .map_err(|error| format!("Could not run the ModelScope installer: {error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "ModelScope installation failed: {}",
                output_text(&output.stderr)
            ))
        }
    })
    .await
}

fn modelscope_skill_url(value: &str) -> Result<String, String> {
    let id = value.trim();
    let plain = id.strip_prefix('@').unwrap_or(id);
    let mut parts = plain.split('/');
    let Some(owner) = parts.next() else {
        return Err("Invalid ModelScope skill identifier".to_string());
    };
    let Some(skill) = parts.next() else {
        return Err("Invalid ModelScope skill identifier".to_string());
    };
    if parts.next().is_some()
        || owner.is_empty()
        || skill.is_empty()
        || !owner
            .bytes()
            .chain(skill.bytes())
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err("Invalid ModelScope skill identifier".to_string());
    }
    Ok(format!("{MODELSCOPE_SKILL_URL_PREFIX}{id}"))
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
    use super::*;

    #[test]
    fn modelscope_url_keeps_the_skill_on_the_trusted_modelscope_host() {
        assert_eq!(
            modelscope_skill_url("@anthropics/pdf").unwrap(),
            "https://modelscope.cn/skills/@anthropics/pdf"
        );
    }

    #[test]
    fn modelscope_url_rejects_a_path_or_another_host() {
        assert!(modelscope_skill_url("../../secret").is_err());
        assert!(modelscope_skill_url("https://example.com/skill").is_err());
    }

    #[test]
    fn search_response_accepts_missing_optional_metadata() {
        let skills = parse_modelscope_recommendation_page(
            br#"{"success":true,"data":{"skills":[{"id":"@anthropics/pdf","display_name":null,"description":null,"logo_url":null,"downloads":null,"view_count":null,"source_url":null}]}}"#,
        )
        .unwrap()
        .items;

        assert_eq!(skills[0].display_name, "@anthropics/pdf");
        assert_eq!(skills[0].description, "");
        assert_eq!(skills[0].logo_url, "");
        assert_eq!(skills[0].downloads, 0);
        assert_eq!(
            skills[0].source_url,
            "https://modelscope.cn/skills/@anthropics/pdf"
        );
    }

    #[test]
    fn search_response_prefers_the_official_chinese_description() {
        let skills = parse_modelscope_recommendation_page(
            r#"{"success":true,"data":{"skills":[{"id":"@anthropics/pdf","description":"English description","locales":{"zh":{"description":"官方中文简介"}}}]}}"#.as_bytes(),
        )
        .unwrap()
        .items;

        assert_eq!(skills[0].description, "官方中文简介");
    }

    #[test]
    fn recommendation_response_exposes_the_next_page() {
        let page = parse_modelscope_recommendation_page(
            br#"{"success":true,"data":{"total":13,"page_number":2,"page_size":6,"skills":[{"id":"@anthropics/pdf"}]}}"#,
        )
        .unwrap();

        assert_eq!(page.page_number, 2);
        assert_eq!(page.total, 13);
        assert_eq!(page.items[0].id, "@anthropics/pdf");
    }

}
