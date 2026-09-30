import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/chat/reference-knowledge-graph", () => ({
  ReferenceKnowledgeGraph: () => null,
}))

import { agentStreamIdleTimeoutMs } from "./chat-panel"

const standardAgent = {
  useWebSearch: false,
  agentMode: "standard" as const,
  retrievalMode: "standard" as const,
  skills: [],
  contextFiles: [],
}

describe("agent stream idle timeout", () => {
  it("keeps a configured Codex CLI run alive through its completion buffer", () => {
    expect(agentStreamIdleTimeoutMs(standardAgent, 0, 45)).toBe(46 * 60 * 1000)
  })

  it("keeps the longer deep-agent allowance", () => {
    expect(agentStreamIdleTimeoutMs({ ...standardAgent, agentMode: "deep" }, 0, 10)).toBe(15 * 60 * 1000)
  })
})
