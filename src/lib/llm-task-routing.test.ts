import { describe, expect, it } from "vitest"
import { projectLlmProfile, resolveProjectLlmConfig, resolveTaskLlmConfig } from "./llm-task-routing"
import type { LlmConfig } from "@/stores/wiki-store"

const fallback: LlmConfig = {
  provider: "codex-cli",
  apiKey: "global-key",
  model: "gpt-5.6-astra",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 192000,
  reasoning: { mode: "high" },
  localCliIsolation: true,
  codexCliTimeoutMinutes: 35,
  streamingEnabled: false,
}

describe("resolveTaskLlmConfig", () => {
  it("uses the active global config when no task override is selected", () => {
    expect(resolveTaskLlmConfig("chat", fallback, {}, {
      chatPresetId: null,
      ingestPresetId: null,
    }).provider).toBe("codex-cli")
  })

  it("ignores legacy task routing without changing global Codex controls", () => {
    const configs = {
      openai: {
        apiKey: "chat-key",
        model: "gpt-4o-mini",
        maxContextSize: 16000,
        reasoning: { mode: "off" as const },
        localCliIsolation: false,
        codexCliTimeoutMinutes: 1,
        streamingEnabled: true,
      },
    }
    const routing = { chatPresetId: "openai", ingestPresetId: null }

    expect(resolveTaskLlmConfig("chat", fallback, configs, routing)).toMatchObject({
      provider: "codex-cli",
      model: "gpt-5.6-astra",
      maxContextSize: 192000,
      reasoning: { mode: "high" },
      localCliIsolation: true,
      codexCliTimeoutMinutes: 35,
      streamingEnabled: false,
    })
  })

  it("ignores a missing legacy task preset and uses global Codex config", () => {
    expect(resolveTaskLlmConfig("ingest", fallback, {}, {
      chatPresetId: null,
      ingestPresetId: "removed-provider",
    }).provider).toBe("codex-cli")
  })

  it("ignores legacy custom task routing and uses global Codex config", () => {
    const custom = [{ id: "custom-team", label: "Team Gateway" }]
    expect(resolveTaskLlmConfig(
      "chat",
      fallback,
      { "custom-team": { apiKey: "team-key", model: "team-model", baseUrl: "https://gateway.example/v1" } },
      { chatPresetId: "custom-team", ingestPresetId: null },
      undefined,
      custom,
    ).provider).toBe("codex-cli")
  })

  it("ignores legacy Ollama task routing and uses global Codex config", () => {
    expect(resolveTaskLlmConfig(
      "ingest",
      fallback,
      { ollama: { model: "qwen3:8b", baseUrl: "http://localhost:11434" } },
      { chatPresetId: null, ingestPresetId: "ollama" },
    ).provider).toBe("codex-cli")
  })
})

describe("resolveProjectLlmConfig", () => {
  it("does not duplicate API keys or custom headers into project profiles", () => {
    const profile = projectLlmProfile({
      ...fallback,
      customHeaders: { Authorization: "Bearer gateway-secret" },
    })
    expect(profile).not.toHaveProperty("apiKey")
    expect(profile).not.toHaveProperty("customHeaders")
  })

  it("ignores disabled legacy project overrides and uses global Codex config", () => {
    expect(resolveProjectLlmConfig(fallback, {}, {
      enabled: false,
      presetId: "anthropic",
      model: "project-model",
    }).provider).toBe("codex-cli")
  })

  it("ignores legacy project overrides without changing global Codex controls", () => {
    const resolved = resolveProjectLlmConfig(fallback, {
      anthropic: {
        apiKey: "shared-secret",
        model: "global-anthropic-model",
        maxContextSize: 16000,
        reasoning: { mode: "off" },
        localCliIsolation: false,
        codexCliTimeoutMinutes: 1,
        streamingEnabled: true,
      },
    }, {
      enabled: true,
      presetId: "anthropic",
      model: "project-sonnet",
    })
    expect(resolved).toMatchObject({
      provider: "codex-cli",
      model: "gpt-5.6-astra",
      maxContextSize: 192000,
      reasoning: { mode: "high" },
      localCliIsolation: true,
      codexCliTimeoutMinutes: 35,
      streamingEnabled: false,
    })
  })

  it("ignores legacy custom project overrides and uses global Codex config", () => {
    expect(resolveProjectLlmConfig(
      fallback,
      { "custom-team": { apiKey: "secret", baseUrl: "https://team.example/v1" } },
      { enabled: true, presetId: "custom-team", model: "project-model" },
      [{ id: "custom-team", label: "Team" }],
    ).provider).toBe("codex-cli")
  })

  it("ignores legacy Ollama project overrides and uses global Codex config", () => {
    expect(resolveProjectLlmConfig(
      fallback,
      { ollama: { model: "qwen3:8b", baseUrl: "http://localhost:11434" } },
      { enabled: true, presetId: "ollama", model: "" },
    ).provider).toBe("codex-cli")
  })

  it("ignores legacy project and task routing and uses global Codex config", () => {
    expect(resolveTaskLlmConfig(
      "chat",
      { ...fallback, provider: "anthropic", model: "project-sonnet" },
      { openai: { apiKey: "chat-key", model: "cheap-chat" } },
      { chatPresetId: "openai", ingestPresetId: null },
      { enabled: true, presetId: "anthropic", model: "project-sonnet" },
    ).provider).toBe("codex-cli")
  })
})
