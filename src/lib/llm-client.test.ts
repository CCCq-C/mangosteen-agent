import { beforeEach, describe, expect, it, vi } from "vitest"

const transportMocks = vi.hoisted(() => ({
  streamCodexCli: vi.fn(),
}))

vi.mock("./codex-cli-transport", () => ({
  streamCodexCli: transportMocks.streamCodexCli,
}))

import { isFetchNetworkError, isReasoningOnlyResponseError, streamChat } from "./llm-client"
import type { LlmConfig } from "@/stores/wiki-store"

describe("isFetchNetworkError — cross-webview fetch failures", () => {
  it("recognises WebKit's 'Load failed' (macOS / Linux GTK)", () => {
    expect(isFetchNetworkError(new Error("Load failed"))).toBe(true)
  })

  it("recognises Chromium/Edge's TypeError: Failed to fetch (Windows)", () => {
    expect(isFetchNetworkError(new TypeError("Failed to fetch"))).toBe(true)
  })

  it("recognises messages containing 'network error' (mid-stream drops)", () => {
    expect(isFetchNetworkError(new Error("The network error occurred while reading"))).toBe(true)
  })

  it("rejects AbortError and non-Error values", () => {
    const aborted = new Error("The operation was aborted.")
    aborted.name = "AbortError"
    expect(isFetchNetworkError(aborted)).toBe(false)
    expect(isFetchNetworkError("boom")).toBe(false)
  })
})

describe("isReasoningOnlyResponseError", () => {
  it("recognises the reasoning-only stream diagnostic", () => {
    expect(isReasoningOnlyResponseError(
      new Error("Model produced 2,176 characters of reasoning / chain-of-thought, but no actual response content. Try again."),
    )).toBe(true)
    expect(isReasoningOnlyResponseError(new Error("plain provider error"))).toBe(false)
  })
})

const legacyConfig: LlmConfig = {
  provider: "custom",
  apiKey: "legacy-key",
  model: "local-openai-model",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "http://127.0.0.1:13305/v1",
  apiMode: "chat_completions",
  maxContextSize: 8192,
}

describe("streamChat — Codex-only public route", () => {
  beforeEach(() => {
    transportMocks.streamCodexCli.mockReset()
  })

  it("normalizes legacy configurations before invoking the Codex CLI", async () => {
    transportMocks.streamCodexCli.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("Codex response")
      callbacks.onDone()
    })
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }

    await streamChat(legacyConfig, [{ role: "user", content: "hi" }], callbacks)

    expect(transportMocks.streamCodexCli).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex-cli",
        apiKey: "",
        model: "gpt-5.6-sol",
        customEndpoint: "",
        ollamaUrl: "",
      }),
      [{ role: "user", content: "hi" }],
      expect.any(Object),
      undefined,
      undefined,
    )
    expect(callbacks.onToken).toHaveBeenCalledWith("Codex response")
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it("buffers Codex CLI tokens when streaming is disabled", async () => {
    transportMocks.streamCodexCli.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onToken("complete ")
      callbacks.onToken("answer")
      callbacks.onDone()
    })
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }

    await streamChat({ ...legacyConfig, streamingEnabled: false }, [{ role: "user", content: "hi" }], callbacks)

    expect(transportMocks.streamCodexCli).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex-cli" }),
      expect.any(Array),
      expect.any(Object),
      undefined,
      undefined,
    )
    expect(callbacks.onToken).toHaveBeenCalledTimes(1)
    expect(callbacks.onToken).toHaveBeenCalledWith("complete answer")
    expect(callbacks.onDone).toHaveBeenCalledTimes(1)
  })

  it("forwards the abort signal and request overrides to the Codex CLI", async () => {
    transportMocks.streamCodexCli.mockResolvedValue(undefined)
    const controller = new AbortController()
    const overrides = { temperature: 0.1, max_tokens: 512 }

    await streamChat(
      legacyConfig,
      [{ role: "user", content: "hi" }],
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      controller.signal,
      overrides,
    )

    expect(transportMocks.streamCodexCli).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex-cli" }),
      expect.any(Array),
      expect.any(Object),
      controller.signal,
      overrides,
    )
  })

  it("forwards Codex CLI errors without remapping them as HTTP failures", async () => {
    const error = new Error("Codex CLI exited with code 1")
    transportMocks.streamCodexCli.mockImplementation(async (_config, _messages, callbacks) => {
      callbacks.onError(error)
    })
    const callbacks = { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }

    await streamChat(legacyConfig, [{ role: "user", content: "hi" }], callbacks)

    expect(callbacks.onError).toHaveBeenCalledWith(error)
    expect(callbacks.onDone).not.toHaveBeenCalled()
  })
})
