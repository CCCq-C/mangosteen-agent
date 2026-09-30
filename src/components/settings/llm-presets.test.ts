import { afterEach, describe, expect, it, vi } from "vitest"
import { createProfilePreset, findLlmPreset } from "./llm-presets"

afterEach(() => vi.unstubAllGlobals())

describe("LLM profile presets", () => {
  it("resolves a profile copied from Codex CLI with its own id and name", () => {
    const profile = { id: "custom-work", label: "工作 Codex", basePresetId: "codex-cli" }

    expect(findLlmPreset("custom-work", [profile])).toMatchObject({
      id: "custom-work",
      label: "工作 Codex",
      provider: "codex-cli",
    })
  })

  it("keeps a legacy custom profile as a compatible endpoint", () => {
    expect(findLlmPreset("custom-old", [{ id: "custom-old", label: "旧接口" }])?.provider).toBe("custom")
  })

  it("creates a custom id and trims a supplied profile label", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "profile-id" })

    expect(createProfilePreset("codex-cli", ` ${"x".repeat(100)} `)).toEqual({
      id: "custom-profile-id",
      label: "x".repeat(80),
      basePresetId: "codex-cli",
    })
  })

  it("uses the base preset label when a profile label is absent", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "profile-id" })

    expect(createProfilePreset("codex-cli")).toMatchObject({ label: "Codex CLI（本机）" })
  })
})
