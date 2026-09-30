import { describe, expect, it } from "vitest"
import type { LlmPreset } from "./llm-presets"
import { filterModelProfileTemplates } from "./model-profile-catalog"

const presets: LlmPreset[] = [
  { id: "codex-cli", label: "Codex CLI", provider: "codex-cli" },
  { id: "ollama", label: "Ollama Local", provider: "ollama" },
  { id: "openai", label: "OpenAI", provider: "openai" },
  { id: "custom-gateway", label: "Team Gateway", provider: "custom" },
]

describe("model profile catalog filters", () => {
  it("returns matching local templates and excludes saved custom profiles", () => {
    expect(filterModelProfileTemplates(presets, "local", "ollama").map((preset) => preset.id))
      .toEqual(["ollama"])
  })

  it("matches a template hint without changing its category", () => {
    const apiPreset: LlmPreset = {
      id: "deepseek",
      label: "DeepSeek",
      hint: "OpenAI-compatible endpoint",
      provider: "custom",
    }

    expect(filterModelProfileTemplates([apiPreset], "compatible", "openai").map((preset) => preset.id))
      .toEqual(["deepseek"])
  })
})
