import { describe, expect, it } from "vitest"
import type { ProviderOverride } from "@/stores/wiki-store"
import { availableLlmPresets, type LlmPreset } from "./llm-presets"
import {
  codexOnlyPresets,
  connectionTestErrorField,
  duplicateProviderConfig,
  isModelHubConfigured,
  modelHubCategory,
  modelHubDisplayModel,
  selectableModelHubProfiles,
  shouldRunProviderTest,
} from "./model-hub-utils"

const preset = (provider: LlmPreset["provider"]): LlmPreset => ({
  id: `${provider}-preset`,
  label: "Example model",
  provider,
  defaultModel: "default-model",
})

describe("model hub selectors", () => {
  it("keeps the Codex preset visible before configuration", () => {
    expect(codexOnlyPresets(availableLlmPresets([])).map((item) => item.id)).toEqual(["codex-cli"])
  })

  it("puts only active or configured presets in My Models", () => {
    expect(isModelHubConfigured(undefined, false)).toBe(false)
    expect(isModelHubConfigured({ model: "gpt-5" }, false)).toBe(true)
    expect(isModelHubConfigured(undefined, true)).toBe(true)
  })

  it("treats advanced saved options as a configured model", () => {
    const configured: ProviderOverride = { localCliIsolation: true }
    expect(isModelHubConfigured(configured, false)).toBe(true)
  })

  it("sorts provider types into the four model hub entries", () => {
    expect(modelHubCategory(preset("codex-cli"))).toBe("subscription")
    expect(modelHubCategory(preset("ollama"))).toBe("local")
    expect(modelHubCategory(preset("openai"))).toBe("official")
    expect(modelHubCategory(preset("custom"))).toBe("compatible")
  })

  it("uses a saved model name before the preset suggestion", () => {
    expect(modelHubDisplayModel(preset("openai"), { model: "gpt-5" })).toBe("gpt-5")
    expect(modelHubDisplayModel(preset("openai"), undefined)).toBe("default-model")
  })

  it("runs provider tests only for an explicit dialog recheck", () => {
    expect(shouldRunProviderTest({ editorOnly: true, testRequestId: 0, handledTestRequestId: 0 })).toBe(false)
    expect(shouldRunProviderTest({ editorOnly: false, testRequestId: 1, handledTestRequestId: 0 })).toBe(false)
    expect(shouldRunProviderTest({ editorOnly: true, testRequestId: 1, handledTestRequestId: 1 })).toBe(false)
    expect(shouldRunProviderTest({ editorOnly: true, testRequestId: 1, handledTestRequestId: 0 })).toBe(true)
  })

  it("copies a profile override into an independent profile configuration", () => {
    const source = { apiKey: "secret", model: "gpt-5", maxContextSize: 128_000 }
    const copied = duplicateProviderConfig({ source }, "source", "copy")

    expect(copied.copy).toEqual(source)
    expect(copied.copy).not.toBe(source)
  })

  it("maps blocked connection checks to their input fields", () => {
    expect(connectionTestErrorField("尚未填写模型")).toBe("model")
    expect(connectionTestErrorField("需要填写 API 密钥")).toBe("apiKey")
    expect(connectionTestErrorField("尚未填写服务地址")).toBe("endpoint")
    expect(connectionTestErrorField("Network refused")).toBeNull()
  })

  it("offers task routing only for active or saved profiles", () => {
    const profiles = [preset("openai"), preset("ollama"), preset("custom")]
    profiles[2] = { ...profiles[2], id: "custom-saved" }

    expect(selectableModelHubProfiles(profiles, { "custom-saved": { model: "local-model" } }, "ollama-preset")
      .map((profile) => profile.id))
      .toEqual(["ollama-preset", "custom-saved"])
  })

  it("keeps saved custom CLI profiles and already selected templates routable", () => {
    const profiles: LlmPreset[] = [
      { ...preset("codex-cli"), id: "custom-codex" },
      { ...preset("openai"), id: "openai-template" },
      { ...preset("anthropic"), id: "anthropic-template" },
    ]

    expect(selectableModelHubProfiles(profiles, {}, null, ["openai-template"])
      .map((profile) => profile.id))
      .toEqual(["custom-codex", "openai-template"])
  })

})
