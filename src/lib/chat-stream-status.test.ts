import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { hasBackendDisplayableOutcome, resolveStreamingStatusKind, shouldUseBackendAgentStream } from "./chat-stream-status"

describe("resolveStreamingStatusKind", () => {
  it("shows the matching real retrieval activity before the model writes", () => {
    expect(resolveStreamingStatusKind("", [{ stage: "searching_web", status: "running" }])).toBe("web")
    expect(resolveStreamingStatusKind("", [{ stage: "searching_wiki", status: "running" }])).toBe("wiki")
  })

  it("switches to writing once answer tokens arrive", () => {
    expect(resolveStreamingStatusKind("第一段回答", [{ stage: "searching_web", status: "running" }])).toBe("writing")
  })

  it("shows writing while the model thinks before its first visible token", () => {
    expect(resolveStreamingStatusKind("", [{ stage: "writing", status: "running" }])).toBe("writing")
  })

  it("uses a polishing status only after a substantial streamed answer", () => {
    expect(resolveStreamingStatusKind("答".repeat(300), [])).toBe("polishing")
  })

  it("allows an artifact-only backend result when the file change is confirmed", () => {
    expect(hasBackendDisplayableOutcome("   ", 1)).toBe(true)
    expect(hasBackendDisplayableOutcome("   ", 0)).toBe(false)
  })

  it("routes Codex replies through the backend stream and returns before the frontend fallback", () => {
    expect(shouldUseBackendAgentStream("codex-cli")).toBe(true)

    const source = readFileSync(new URL("../components/chat/chat-panel.tsx", import.meta.url), "utf8")
    const backendStart = source.indexOf("const useBackendAgent = shouldUseBackendAgentStream")
    const backendFinalizeStart = source.indexOf("finalizeStreamForConversation(", backendStart)
    const frontendFallbackStart = source.indexOf("const activeConvMessages = conversationMessages", backendStart)
    const backendSegment = source.slice(backendStart, frontendFallbackStart)
    const afterFinalization = source.slice(backendFinalizeStart, frontendFallbackStart)

    expect(backendSegment).toContain('invoke<string>("agent_start_turn_stream"')
    expect(backendFinalizeStart).toBeGreaterThan(backendStart)
    expect(afterFinalization).toMatch(/\r?\n          return\r?\n        }/)
    expect(backendSegment).not.toContain("streamChat(")
    expect(frontendFallbackStart).toBeGreaterThan(backendStart)
  })
})
