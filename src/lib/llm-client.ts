import type { LlmConfig } from "@/stores/wiki-store"
import { type RequestOverrides } from "./llm-providers"
import { toCodexOnlyConfig } from "./codex-only-config"

export type { ChatMessage, ContentBlock, RequestOverrides } from "./llm-providers"
export { isFetchNetworkError } from "./tauri-fetch"

export interface StreamCallbacks {
  onToken: (token: string) => void
  onReasoningToken?: (token: string) => void
  onDone: () => void
  onError: (error: Error) => void
}

function bufferedStreamCallbacks(callbacks: StreamCallbacks): StreamCallbacks {
  let content = ""
  let reasoning = ""
  return {
    onToken: (token) => { content += token },
    onReasoningToken: (token) => { reasoning += token },
    onDone: () => {
      if (reasoning) callbacks.onReasoningToken?.(reasoning)
      if (content) callbacks.onToken(content)
      callbacks.onDone()
    },
    onError: callbacks.onError,
  }
}

// Lazy import keeps the Tauri event/invoke bindings out of bundles that
// never touch the subprocess provider (e.g. vitest with a fetch mock).
async function streamViaCodexCli(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
) {
  const mod = await import("./codex-cli-transport")
  return mod.streamCodexCli(config, messages, callbacks, signal, requestOverrides)
}

export function isReasoningOnlyResponseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /^Model produced [\d,]+ characters of reasoning \/ chain-of-thought, but no actual response content\./.test(message)
}

export async function streamChat(
  config: LlmConfig,
  messages: import("./llm-providers").ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  requestOverrides?: RequestOverrides,
): Promise<void> {
  const codexConfig = toCodexOnlyConfig(config)
  return streamViaCodexCli(
    codexConfig,
    messages,
    codexConfig.streamingEnabled === false ? bufferedStreamCallbacks(callbacks) : callbacks,
    signal,
    requestOverrides,
  )
}
