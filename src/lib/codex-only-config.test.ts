import { describe, expect, it } from "vitest"
import { toCodexOnlyConfig } from "./codex-only-config"

describe("toCodexOnlyConfig", () => {
  it("replaces every non-Codex provider and model", () => {
    const actual = toCodexOnlyConfig({
      provider: "openai", apiKey: "secret", model: "gpt-4o",
      ollamaUrl: "http://localhost:11434", customEndpoint: "https://example.com/v1",
      maxContextSize: 32000,
    })
    expect(actual.provider).toBe("codex-cli")
    expect(actual.apiKey).toBe("")
    expect(actual.customEndpoint).toBe("")
    expect(actual.model).not.toBe("gpt-4o")
  })

  it("preserves Codex model and local CLI controls", () => {
    const actual = toCodexOnlyConfig({
      provider: "codex-cli", apiKey: "", model: "gpt-5.6-sol",
      ollamaUrl: "", customEndpoint: "", maxContextSize: 200000,
      localCliIsolation: true, codexCliTimeoutMinutes: 20,
    })
    expect(actual.model).toBe("gpt-5.6-sol")
    expect(actual.localCliIsolation).toBe(true)
    expect(actual.codexCliTimeoutMinutes).toBe(20)
  })
})
