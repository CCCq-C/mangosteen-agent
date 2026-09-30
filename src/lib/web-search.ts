import { invoke } from "@tauri-apps/api/core"
import type {
  SearchApiConfig,
  SearchProvider,
  SearchProviderConfigs,
  SearXngCategory,
  SerpApiEngine,
} from "@/stores/wiki-store"

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

export const DEFAULT_FIRECRAWL_URL = "https://api.firecrawl.dev"
/** Loopback-only endpoint managed by the bundled SearXNG companion. */
export const LOCAL_SEARCH_DEFAULT_URL = "http://127.0.0.1:17888"

export const SERPAPI_ENGINE_OPTIONS: { value: SerpApiEngine; label: string; hint: string }[] = [
  { value: "google", label: "Google 网页", hint: "SerpApi 的 Google 常规搜索结果" },
  { value: "google_news", label: "Google 新闻", hint: "侧重新闻内容" },
  { value: "google_scholar", label: "Google 学术", hint: "学术论文和引用" },
  { value: "google_patents", label: "Google 专利", hint: "专利搜索结果" },
  { value: "bing", label: "Bing", hint: "Bing 常规搜索结果" },
  { value: "duckduckgo", label: "DuckDuckGo", hint: "DuckDuckGo 常规搜索结果" },
  { value: "google_images", label: "Google 图片", hint: "图片搜索结果" },
  { value: "google_videos", label: "Google 视频", hint: "视频搜索结果" },
  { value: "youtube", label: "YouTube", hint: "YouTube 视频结果" },
]

export const SEARXNG_CATEGORY_OPTIONS: { value: SearXngCategory; label: string; hint: string }[] = [
  { value: "general", label: "综合", hint: "默认网页结果" },
  { value: "news", label: "新闻", hint: "新闻搜索引擎" },
  { value: "science", label: "科学", hint: "侧重学术和科学内容" },
  { value: "it", label: "技术", hint: "侧重开发和科技内容" },
  { value: "images", label: "图片", hint: "图片搜索结果" },
  { value: "videos", label: "视频", hint: "视频搜索结果" },
  { value: "files", label: "文件", hint: "文件和文档搜索" },
  { value: "map", label: "地图", hint: "地图和地点结果" },
  { value: "music", label: "音乐", hint: "音乐搜索引擎" },
  { value: "social media", label: "社交媒体", hint: "社交媒体搜索引擎" },
]

export function resolveSearchConfig(config: SearchApiConfig): SearchApiConfig {
  const providerConfigs: SearchProviderConfigs = config.providerConfigs ?? {
    ...(config.provider !== "none" && config.provider !== "ollama" && config.provider !== "firecrawl" && config.apiKey
      ? {
          [config.provider]: {
            apiKey: config.apiKey,
            serpApiEngine: config.serpApiEngine,
            searXngUrl: config.searXngUrl,
            searXngCategories: config.searXngCategories,
          },
        }
      : {}),
    ...(config.provider === "searxng" && config.searXngUrl
      ? {
          searxng: {
            searXngUrl: config.searXngUrl,
            searXngCategories: config.searXngCategories,
          },
        }
      : {}),
    ...(config.provider === "ollama" && config.ollamaUrl
      ? {
          ollama: {
            ollamaUrl: config.ollamaUrl,
          },
        }
      : {}),
  }

  const activeProvider = config.provider as SearchProvider
  const activeOverride = activeProvider === "none" ? undefined : providerConfigs[activeProvider]
  const resolvedOllamaUrl =
    activeProvider === "ollama"
      ? activeOverride?.ollamaUrl ?? config.ollamaUrl ?? "https://ollama.com"
      : providerConfigs.ollama?.ollamaUrl ?? "https://ollama.com"

  if (activeProvider === "none") {
    return {
      ...config,
      provider: "none",
      apiKey: "",
      serpApiEngine: config.serpApiEngine ?? providerConfigs.serpapi?.serpApiEngine ?? "google",
      searXngUrl: config.searXngUrl ?? providerConfigs.searxng?.searXngUrl ?? "",
      searXngCategories: config.searXngCategories ?? providerConfigs.searxng?.searXngCategories ?? ["general"],
      ollamaUrl: providerConfigs.ollama?.ollamaUrl ?? "https://ollama.com",
      providerConfigs,
      deepResearchSource: "web",
    }
  }

  return {
    ...config,
    provider: activeProvider,
    apiKey: activeOverride?.apiKey ?? config.apiKey ?? "",
    serpApiEngine: activeOverride?.serpApiEngine ?? config.serpApiEngine ?? "google",
    searXngUrl: activeOverride?.searXngUrl ?? config.searXngUrl ?? "",
    searXngCategories: activeOverride?.searXngCategories ?? config.searXngCategories ?? ["general"],
    ollamaUrl: resolvedOllamaUrl,
    providerConfigs,
    deepResearchSource: "web",
  }
}

/** Keep the hidden provider selection on the bundled, zero-config service. */
export function migrateSearchConfigToLocalDefault(config: SearchApiConfig | null): SearchApiConfig | null {
  const localOverride = config?.providerConfigs?.searxng
  if (
    config?.provider === "searxng"
    && config.searXngUrl === LOCAL_SEARCH_DEFAULT_URL
    && localOverride?.searXngUrl === LOCAL_SEARCH_DEFAULT_URL
    && config.deepResearchSource === "web"
  ) return null

  return resolveSearchConfig({
    ...config,
    provider: "searxng",
    apiKey: "",
    searXngUrl: LOCAL_SEARCH_DEFAULT_URL,
    searXngCategories: config?.searXngCategories ?? ["general"],
    providerConfigs: {
      ...(config?.providerConfigs ?? {}),
      searxng: {
        ...(config?.providerConfigs?.searxng ?? {}),
        searXngUrl: LOCAL_SEARCH_DEFAULT_URL,
        searXngCategories: config?.searXngCategories ?? ["general"],
      },
    },
    deepResearchSource: "web",
  })
}

export function hasConfiguredSearchProvider(config: SearchApiConfig): boolean {
  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "none") return false
  if (resolved.provider === "searxng") return Boolean(resolved.searXngUrl?.trim())
  if (resolved.provider === "ollama") return Boolean(resolved.apiKey?.trim())
  if (resolved.provider === "firecrawl") return true
  return Boolean(resolved.apiKey?.trim())
}

export function hasConfiguredDeepResearchSources(config: SearchApiConfig): boolean {
  return hasConfiguredSearchProvider(config)
}

export async function webSearch(
  query: string,
  config: SearchApiConfig,
  maxResults: number = 10,
): Promise<WebSearchResult[]> {
  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "none") {
    throw new Error("Web search not configured. Select a search provider in Settings.")
  }
  if (
    (
      resolved.provider === "tavily" ||
      resolved.provider === "serpapi" ||
      resolved.provider === "brave" ||
      resolved.provider === "bocha"
    ) &&
    !resolved.apiKey
  ) {
    throw new Error("Web search not configured. Add an API key for the selected search provider in Settings, or select a key-free provider such as Firecrawl or SearXNG.")
  }
  if (resolved.provider === "searxng" && !resolved.searXngUrl?.trim()) {
    throw new Error("Web search not configured. Add a SearXNG instance URL in Settings.")
  }
  if (resolved.provider === "ollama" && !resolved.apiKey?.trim()) {
    throw new Error("Ollama Web Search API requires an Ollama API key. Add one in Settings.")
  }

  return invoke<WebSearchResult[]>("web_search", {
    query,
    config: resolved,
    maxResults,
  })
}
