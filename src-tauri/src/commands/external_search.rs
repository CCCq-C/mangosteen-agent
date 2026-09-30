use serde::{Deserialize, Serialize};

use crate::agent::tools::{run_web_search, WebSearchConfig};
use crate::panic_guard::run_guarded_async;

/// Frontend-facing search result shape. The Rust Agent uses
/// `AgentReference` internally, but UI/deep-research code historically
/// consumes `{ title, url, snippet, source }`; keep that wire contract
/// stable while moving provider/network logic to Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
}

#[tauri::command]
pub async fn web_search(
    query: String,
    config: WebSearchConfig,
    max_results: Option<usize>,
) -> Result<Vec<ExternalSearchResult>, String> {
    run_guarded_async("web_search", async move {
        let references = run_web_search(&query, Some(config), max_results.unwrap_or(10)).await?;
        Ok(references
            .into_iter()
            .map(|item| ExternalSearchResult {
                title: item.title,
                source: hostname_label(&item.path).unwrap_or_else(|| "web".to_string()),
                url: item.path,
                snippet: item.snippet.unwrap_or_default(),
            })
            .collect())
    })
    .await
}

fn hostname_label(url: &str) -> Option<String> {
    let host = reqwest::Url::parse(url).ok()?.host_str()?.to_string();
    Some(host.strip_prefix("www.").unwrap_or(&host).to_string())
}
