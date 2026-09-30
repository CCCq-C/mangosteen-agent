import type { ChatAgentEvent } from "./chat-agent-types"

export type StreamingStatusKind =
  | "received"
  | "understanding"
  | "wiki"
  | "web"
  | "local_files"
  | "reading"
  | "working"
  | "writing"
  | "polishing"

const STATUS_PHRASES: Record<StreamingStatusKind, string[]> = {
  received: ["收到消息啦，我来看看~", "我收到啦，马上帮你处理", "好哒，让我想想怎么帮你"],
  understanding: ["我先理理思路嗷", "我在理解你的需求", "我先想清楚再动手~"],
  wiki: ["我看看资料嗷", "我翻翻知识库", "我在找相关内容~"],
  web: ["我去看看网页信息~~", "我正在查网页资料", "我去网上核对一下"],
  local_files: ["我翻翻本地资料库", "我在本机资料里找找", "我去查查你的本地文件"],
  reading: ["我正在读这份资料", "我先把资料看一遍", "我在提取重点内容"],
  working: ["我正在处理嗷", "我继续整理一下", "我在认真完成这一步"],
  writing: ["我正在把答案整理出来", "我开始写给你啦", "我把重点说清楚~"],
  polishing: ["我再检查一下就发给你~", "快写好啦，马上发给你~", "我在把最后细节整理好"],
}

export function shouldUseBackendAgentStream(provider: string): boolean {
  return provider !== "claude-code"
}

export function hasBackendDisplayableOutcome(text: string, confirmedGeneratedFileCount: number): boolean {
  return Boolean(text.trim()) || confirmedGeneratedFileCount > 0
}

export function resolveStreamingStatusKind(content: string, events: ChatAgentEvent[]): StreamingStatusKind {
  const answerLength = content.trim().length
  if (answerLength >= 280) return "polishing"
  if (answerLength > 0) return "writing"

  const current = [...events].reverse().find((event) => event.status === "running")
  switch (current?.stage) {
    case "understanding":
    case "routing":
      return "understanding"
    case "searching_wiki":
    case "searching_graph":
      return "wiki"
    case "searching_web":
      return "web"
    case "reading_context":
      return "reading"
    case "writing":
      return "writing"
    case "tool_call":
    case "tool_result":
      return "working"
    default:
      return "received"
  }
}

export function pickStreamingStatusPhrase(kind: StreamingStatusKind): string {
  const phrases = STATUS_PHRASES[kind]
  return phrases[Math.floor(Math.random() * phrases.length)]
}
