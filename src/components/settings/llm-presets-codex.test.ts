import { describe, expect, it } from "vitest"
import { DEFAULT_CODEX_MODEL } from "@/lib/codex-only-config"
import { findLlmPreset } from "./llm-presets"

describe("Codex CLI preset", () => {
  it("uses the shared Codex default model", () => {
    expect(findLlmPreset("codex-cli")?.defaultModel).toBe(DEFAULT_CODEX_MODEL)
  })
})
