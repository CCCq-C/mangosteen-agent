import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

const test = vi.hoisted(() => {
  const setLlmConfig = vi.fn()
  return {
    callbacks: [] as Array<(...args: never[]) => unknown>,
    changeLanguage: vi.fn(),
    setLlmConfig,
    saveLlmConfig: vi.fn().mockResolvedValue(undefined),
    saveEmbeddingConfig: vi.fn().mockResolvedValue(undefined),
    saveMultimodalConfig: vi.fn().mockResolvedValue(undefined),
    saveOutputLanguage: vi.fn().mockResolvedValue(undefined),
    saveProxyConfig: vi.fn().mockResolvedValue(undefined),
    saveSourceWatchConfig: vi.fn().mockResolvedValue(undefined),
    saveMineruConfig: vi.fn().mockResolvedValue(undefined),
    saveApiConfig: vi.fn().mockResolvedValue(undefined),
    saveGeneralConfig: vi.fn().mockResolvedValue(undefined),
    saveZoomLevel: vi.fn().mockResolvedValue(undefined),
    chatState: { maxHistoryMessages: 20, setMaxHistoryMessages: vi.fn() },
    wikiState: {
      project: undefined,
      llmConfig: {
        provider: "codex-cli",
        apiKey: "",
        model: "gpt-5.6-sol",
        ollamaUrl: "",
        customEndpoint: "",
        apiMode: undefined,
        reasoning: undefined,
        ingestReasoning: undefined,
        localCliIsolation: false,
      },
      setLlmConfig,
      embeddingConfig: { enabled: false, endpoint: "", apiKey: "", model: "", concurrency: 1, batchSize: 1 },
      setEmbeddingConfig: vi.fn(),
      multimodalConfig: { enabled: false, useMainLlm: true, provider: "codex-cli", apiKey: "", model: "", ollamaUrl: "", customEndpoint: "", concurrency: 1 },
      setMultimodalConfig: vi.fn(),
      outputLanguage: "en",
      setOutputLanguage: vi.fn(),
      proxyConfig: { enabled: false, url: "", bypassLocal: true, acceptInvalidCerts: false },
      setProxyConfig: vi.fn(),
      scheduledImportConfig: { enabled: false, path: "", interval: 60 },
      setScheduledImportConfig: vi.fn(),
      sourceWatchConfig: { ingestConcurrency: 1 },
      setSourceWatchConfig: vi.fn(),
      mineruConfig: { enabled: false, token: "", modelVersion: "v4", backend: "cloud" },
      setMineruConfig: vi.fn(),
      apiConfig: { enabled: false, allowUnauthenticated: false, allowLanAccess: false, mcpEnabled: false, token: "" },
      setApiConfig: vi.fn(),
      generalConfig: { autostart: false, closeBehavior: "hide" },
      setGeneralConfig: vi.fn(),
    },
  }
})

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>()
  return {
    ...react,
    useCallback: (callback: (...args: never[]) => unknown) => {
      test.callbacks.push(callback)
      return callback
    },
  }
})

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/i18n", () => ({ default: { language: "en", changeLanguage: test.changeLanguage } }))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: Object.assign(
    (selector: (state: typeof test.wikiState) => unknown) => selector(test.wikiState),
    { getState: () => test.wikiState },
  ),
}))
vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (state: typeof test.chatState) => unknown) => selector(test.chatState),
}))
vi.mock("@/stores/update-store", () => ({ useUpdateStore: () => false, hasAvailableUpdate: () => false }))
vi.mock("@/stores/zoom-store", () => ({ useZoomStore: { getState: () => ({ level: 100, setLevel: vi.fn() }) } }))
vi.mock("@/lib/project-store", () => ({
  loadSourceWatchConfig: vi.fn().mockResolvedValue({ ingestConcurrency: 1 }),
  saveLanguage: vi.fn().mockResolvedValue(undefined),
  saveTheme: vi.fn().mockResolvedValue(undefined),
  loadTheme: vi.fn().mockResolvedValue(null),
  saveLlmConfig: test.saveLlmConfig,
  loadLlmConfig: vi.fn().mockResolvedValue(null),
  saveEmbeddingConfig: test.saveEmbeddingConfig,
  loadEmbeddingConfig: vi.fn().mockResolvedValue(null),
  saveMultimodalConfig: test.saveMultimodalConfig,
  loadMultimodalConfig: vi.fn().mockResolvedValue(null),
  saveOutputLanguage: test.saveOutputLanguage,
  loadOutputLanguage: vi.fn().mockResolvedValue(null),
  saveProxyConfig: test.saveProxyConfig,
  loadProxyConfig: vi.fn().mockResolvedValue(null),
  saveScheduledImportConfig: vi.fn().mockResolvedValue(undefined),
  loadScheduledImportConfig: vi.fn().mockResolvedValue(null),
  saveSourceWatchConfig: test.saveSourceWatchConfig,
  saveMineruConfig: test.saveMineruConfig,
  loadMineruConfig: vi.fn().mockResolvedValue(null),
  saveApiConfig: test.saveApiConfig,
  loadApiConfig: vi.fn().mockResolvedValue(null),
  saveGeneralConfig: test.saveGeneralConfig,
  loadGeneralConfig: vi.fn().mockResolvedValue(null),
  saveZoomLevel: test.saveZoomLevel,
  loadZoomLevel: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/source-watch-config", () => ({ normalizeSourceWatchConfig: (config: { ingestConcurrency?: number } = {}) => ({ ingestConcurrency: config.ingestConcurrency ?? 1 }) }))
vi.mock("@/lib/ingest-queue", () => ({ setIngestWorkerLimit: vi.fn() }))
vi.mock("@/lib/theme", () => ({ applyTheme: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-autostart", () => ({ disable: vi.fn(), enable: vi.fn() }))

vi.mock("./sections/llm-provider-section", () => ({ LlmProviderSection: () => null }))
vi.mock("./sections/embedding-section", () => ({ EmbeddingSection: () => null }))
vi.mock("./sections/multimodal-section", () => ({ MultimodalSection: () => null }))
vi.mock("./sections/output-section", () => ({ OutputSection: () => null }))
vi.mock("./sections/interface-section", () => ({ InterfaceSection: () => null }))
vi.mock("./sections/network-section", () => ({ NetworkSection: () => null }))
vi.mock("./sections/scheduled-import-section", () => ({ ScheduledImportSection: () => null }))
vi.mock("./sections/source-watch-section", () => ({ SourceWatchSection: () => null }))
vi.mock("./sections/mineru-section", () => ({ MineruSection: () => null }))
vi.mock("./sections/api-server-section", () => ({ ApiServerSection: () => null }))
vi.mock("./sections/general-section", () => ({ GeneralSection: () => null }))
vi.mock("./sections/changelog-section", () => ({ ChangelogSection: () => null }))
vi.mock("./sections/maintenance-section", () => ({ MaintenanceSection: () => null }))
vi.mock("./sections/about-section", () => ({ AboutSection: () => null }))

import { SettingsView } from "./settings-view"

describe("SettingsView generic save", () => {
  it("does not overwrite Codex config", async () => {
    renderToStaticMarkup(<SettingsView />)

    const handleSave = test.callbacks[test.callbacks.length - 1]
    expect(handleSave).toBeTypeOf("function")
    await handleSave!()

    expect(test.saveEmbeddingConfig).toHaveBeenCalledTimes(1)
    expect(test.setLlmConfig).not.toHaveBeenCalled()
    expect(test.saveLlmConfig).not.toHaveBeenCalled()
  })
})
