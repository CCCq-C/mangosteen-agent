import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import "@/i18n"
import type { SettingsDraft } from "../settings-types"
import { MultimodalSection } from "./multimodal-section"

const draft = {
  multimodalEnabled: true,
  multimodalUseMainLlm: false,
  multimodalProvider: "custom",
  multimodalApiKey: "legacy-caption-key",
  multimodalModel: "legacy-caption-model",
  multimodalOllamaUrl: "http://legacy-caption-ollama",
  multimodalCustomEndpoint: "https://legacy-caption.example/v1",
  multimodalAzureApiVersion: "2024-10-21",
  multimodalAzureModelFamily: "auto",
  multimodalApiMode: "chat_completions",
  multimodalConcurrency: 3,
} as SettingsDraft

describe("MultimodalSection", () => {
  it("keeps caption controls without rendering legacy caption credentials", () => {
    const html = renderToStaticMarkup(
      <MultimodalSection draft={draft} setDraft={() => undefined} />,
    )

    expect(html).toContain('value="3"')
    expect(html).not.toContain("legacy-caption-key")
    expect(html).not.toContain("legacy-caption-model")
    expect(html).not.toContain("legacy-caption.example")
  })
})
