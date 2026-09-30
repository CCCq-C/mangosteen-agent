import { describe, expect, it } from "vitest"
import { __projectStoreTest, normalizeGeneralConfig } from "./project-store"

describe("project-store Windows close behavior", () => {
  it("migrates legacy hide and ask preferences to a real app exit", () => {
    expect(normalizeGeneralConfig({ autostart: true, closeBehavior: "minimize" }))
      .toEqual({ autostart: true, closeBehavior: "exit" })
    expect(normalizeGeneralConfig({ autostart: false, closeBehavior: "ask" }))
      .toEqual({ autostart: false, closeBehavior: "exit" })
  })
})

describe("project-store MinerU config normalization", () => {
  it("preserves valid MinerU config values", () => {
    expect(__projectStoreTest.normalizeMineruConfig({
      enabled: true,
      backend: "local",
      localEndpoint: "http://localhost:9000/mineru",
      localToken: " local-secret ",
      localBackend: "pipeline",
      localEffort: "high",
      localParseMethod: "ocr",
      localLanguage: "korean",
      localFormulaEnabled: false,
      localTableEnabled: true,
      localImageAnalysis: false,
      localServerUrl: "http://localhost:30000",
      token: "token-123",
      modelVersion: "pipeline",
    })).toEqual({
      enabled: true,
      backend: "local",
      localEndpoint: "http://localhost:9000/mineru",
      localToken: "local-secret",
      localBackend: "pipeline",
      localEffort: "high",
      localParseMethod: "ocr",
      localLanguage: "korean",
      localFormulaEnabled: false,
      localTableEnabled: true,
      localImageAnalysis: false,
      localServerUrl: "http://localhost:30000",
      token: "token-123",
      modelVersion: "pipeline",
    })
  })

  it("migrates legacy and malformed MinerU config values to safe defaults", () => {
    expect(__projectStoreTest.normalizeMineruConfig({
      enabled: "yes" as unknown as boolean,
      token: 123 as unknown as string,
      modelVersion: "mineru-html" as "vlm",
    })).toEqual({
      enabled: false,
      backend: "cloud",
      localEndpoint: "http://127.0.0.1:8000",
      localToken: "",
      localBackend: "hybrid-engine",
      localEffort: "medium",
      localParseMethod: "auto",
      localLanguage: "ch",
      localFormulaEnabled: true,
      localTableEnabled: true,
      localImageAnalysis: true,
      localServerUrl: "",
      token: "",
      modelVersion: "vlm",
    })
  })
})

describe("project-store zoom normalization", () => {
  it("preserves valid zoom values", () => {
    expect(__projectStoreTest.normalizeZoomLevel(0.5)).toBe(0.5)
    expect(__projectStoreTest.normalizeZoomLevel(1.25)).toBe(1.25)
    expect(__projectStoreTest.normalizeZoomLevel(3)).toBe(3)
  })

  it("clamps finite out-of-range values", () => {
    expect(__projectStoreTest.normalizeZoomLevel(-2)).toBe(0.5)
    expect(__projectStoreTest.normalizeZoomLevel(0)).toBe(0.5)
    expect(__projectStoreTest.normalizeZoomLevel(0.49)).toBe(0.5)
    expect(__projectStoreTest.normalizeZoomLevel(3.01)).toBe(3)
  })

  it("falls back to 100% for malformed values", () => {
    expect(__projectStoreTest.normalizeZoomLevel(undefined)).toBe(1)
    expect(__projectStoreTest.normalizeZoomLevel(null)).toBe(1)
    expect(__projectStoreTest.normalizeZoomLevel(Number.NaN)).toBe(1)
    expect(__projectStoreTest.normalizeZoomLevel(Number.POSITIVE_INFINITY)).toBe(1)
    expect(__projectStoreTest.normalizeZoomLevel("150")).toBe(1)
  })
})

describe("project-store custom LLM preset normalization", () => {
  it("keeps valid unique presets and bounds labels", () => {
    const longLabel = "x".repeat(100)
    expect(__projectStoreTest.normalizeCustomLlmPresets([
      { id: "custom-one", label: " Team Gateway " },
      { id: "custom-one", label: "duplicate" },
      { id: "custom-two", label: longLabel },
      { id: "openai", label: "collision" },
      { id: "custom-empty", label: " " },
    ])).toEqual([
      { id: "custom-one", label: "Team Gateway" },
      { id: "custom-two", label: "x".repeat(80) },
    ])
  })

  it("retains a valid base preset id and drops malformed or unknown values", () => {
    expect(__projectStoreTest.normalizeCustomLlmPresets([
      { id: "custom-codex", label: "Codex", basePresetId: "codex-cli" },
      { id: "custom-garbage", label: "Garbage", basePresetId: "missing" },
      { id: "custom-custom", label: "Custom", basePresetId: "custom" },
      { id: "custom-malformed", label: "Malformed", basePresetId: 42 },
    ])).toEqual([
      { id: "custom-codex", label: "Codex", basePresetId: "codex-cli" },
      { id: "custom-garbage", label: "Garbage" },
      { id: "custom-custom", label: "Custom" },
      { id: "custom-malformed", label: "Malformed" },
    ])
  })
})
