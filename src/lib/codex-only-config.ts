import type { LlmConfig } from "@/stores/wiki-store"

export const CODEX_PRESET_ID = "codex-cli"
export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol"

export function toCodexOnlyConfig(config: LlmConfig): LlmConfig {
  const isCodex = config.provider === "codex-cli"
  return {
    ...config,
    provider: "codex-cli",
    apiKey: "",
    model: isCodex && config.model.trim() ? config.model.trim() : DEFAULT_CODEX_MODEL,
    ollamaUrl: "",
    customEndpoint: "",
    customHeaders: undefined,
    apiMode: undefined,
    localCliIsolation: isCodex ? config.localCliIsolation === true : false,
    codexCliTimeoutMinutes: isCodex ? config.codexCliTimeoutMinutes : 10,
  }
}
