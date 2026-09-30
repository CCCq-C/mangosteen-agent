import { describe, expect, it } from "vitest"
import * as ingest from "./ingest"
import type { LlmConfig, MultimodalConfig } from "@/stores/wiki-store"

const mainConfig: LlmConfig = {
  provider: "openai",
  apiKey: "main-key",
  model: "gpt-4o",
  ollamaUrl: "http://main-ollama",
  customEndpoint: "https://main.example/v1",
  maxContextSize: 128000,
}

const legacyMultimodal: MultimodalConfig = {
  enabled: true,
  useMainLlm: false,
  provider: "custom",
  apiKey: "legacy-caption-key",
  model: "legacy-caption-model",
  ollamaUrl: "http://legacy-caption-ollama",
  customEndpoint: "https://legacy-caption.example/v1",
  concurrency: 4,
}

describe("caption model routing", () => {
  it("normalizes the active main config instead of using legacy caption credentials", () => {
    const resolveCaptionConfig = (
      ingest as unknown as {
        resolveCaptionConfig: (multimodal: MultimodalConfig, main: LlmConfig) => LlmConfig | null
      }
    ).resolveCaptionConfig

    expect(resolveCaptionConfig(legacyMultimodal, mainConfig)).toMatchObject({
      provider: "codex-cli",
      apiKey: "",
      model: "gpt-5.6-sol",
      ollamaUrl: "",
      customEndpoint: "",
    })
  })
})
