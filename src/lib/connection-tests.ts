import type { EmbeddingConfig, LlmConfig } from "@/stores/wiki-store"
import { fetchEmbedding, getLastEmbeddingError } from "@/lib/embedding"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat } from "@/lib/llm-client"

export interface ProviderTestResult {
  ok: boolean
  message: string
}

export const LLM_PROVIDER_TEST_MAX_TOKENS = 512

function llmConnectionConfigError(cfg: LlmConfig): string | null {
  if (!cfg.model.trim()) return "尚未填写模型"
  if (!hasUsableLlm(cfg)) return "需要填写 API 密钥"
  if ((cfg.provider === "custom" || cfg.provider === "azure") && !cfg.customEndpoint.trim()) {
    return "尚未填写服务地址"
  }
  if (cfg.provider === "ollama" && !cfg.ollamaUrl.trim()) return "尚未填写服务地址"
  return null
}

export async function testEmbeddingConnection(cfg: EmbeddingConfig): Promise<ProviderTestResult> {
  if (!cfg.endpoint.trim()) {
    return { ok: false, message: "语义搜索服务地址为空。" }
  }
  if (!cfg.model.trim()) {
    return { ok: false, message: "尚未填写语义搜索模型。" }
  }

  const started = performance.now()
  const vector = await fetchEmbedding("LLM Wiki embedding connection test.", cfg, 0)
  if (!vector) {
    return {
      ok: false,
      message: getLastEmbeddingError() ?? "语义搜索服务没有返回向量。",
    }
  }

  return {
    ok: true,
    message: `连接成功，用时 ${Math.round(performance.now() - started)} 毫秒，返回 ${vector.length} 维向量。`,
  }
}

export async function testEmbeddingFunction(cfg: EmbeddingConfig): Promise<ProviderTestResult> {
  const first = await fetchEmbedding("LLM Wiki functional embedding test: apple banana graph.", cfg, 0)
  const second = await fetchEmbedding("LLM Wiki functional embedding test: apple banana graph.", cfg, 0)
  if (!first || !second) {
    return {
      ok: false,
      message: getLastEmbeddingError() ?? "语义搜索服务没有返回向量。",
    }
  }
  if (first.length !== second.length) {
    return {
      ok: false,
      message: `两次请求返回的向量维度不一致（${first.length} 与 ${second.length}）。`,
    }
  }
  if (first.length === 0 || first.some((v) => !Number.isFinite(v)) || second.some((v) => !Number.isFinite(v))) {
    return { ok: false, message: "语义搜索服务返回了空向量或无效向量。" }
  }

  const norm = Math.sqrt(first.reduce((sum, v) => sum + v * v, 0))
  if (!Number.isFinite(norm) || norm <= 0) {
    return { ok: false, message: "语义搜索服务返回的向量无效。" }
  }

  return {
    ok: true,
    message: `功能测试通过，稳定返回 ${first.length} 维有效向量。`,
  }
}

export async function testLlmConnection(cfg: LlmConfig): Promise<ProviderTestResult> {
  const configError = llmConnectionConfigError(cfg)
  if (configError) return { ok: false, message: configError }

  const started = performance.now()
  let content = ""
  let errorMessage: string | null = null

  await streamChat(
    cfg,
    [
      { role: "system", content: "You are a connection checker. Reply briefly." },
      { role: "user", content: "Reply with one short word." },
    ],
    {
      onToken: (token) => { content += token },
      onDone: () => {},
      onError: (err) => { errorMessage = err.message },
    },
    undefined,
    { max_tokens: LLM_PROVIDER_TEST_MAX_TOKENS, reasoning: { mode: "auto" } },
  )

  if (errorMessage) return { ok: false, message: errorMessage }
  if (!content.trim()) return { ok: false, message: "模型已连接，但没有返回内容。" }
  return {
    ok: true,
    message: `连接成功，用时 ${Math.round(performance.now() - started)} 毫秒。模型回复：${content.trim().slice(0, 80)}`,
  }
}

export async function testLlmFunction(cfg: LlmConfig): Promise<ProviderTestResult> {
  const configError = llmConnectionConfigError(cfg)
  if (configError) return { ok: false, message: configError }

  let content = ""
  let errorMessage: string | null = null

  await streamChat(
    cfg,
    [
      {
        role: "system",
        content: "You are a deterministic API test. Do not explain. Output only the requested token.",
      },
      { role: "user", content: "Output exactly this token and nothing else: LLM_WIKI_TEST_OK" },
    ],
    {
      onToken: (token) => { content += token },
      onDone: () => {},
      onError: (err) => { errorMessage = err.message },
    },
    undefined,
    { max_tokens: LLM_PROVIDER_TEST_MAX_TOKENS, reasoning: { mode: "auto" } },
  )

  if (errorMessage) return { ok: false, message: errorMessage }
  const trimmed = content.trim()
  if (!trimmed.includes("LLM_WIKI_TEST_OK")) {
    return {
      ok: false,
      message: `模型已回复，但没有按功能测试要求返回指定内容。模型回复：${trimmed.slice(0, 120) || "（空）"}`,
    }
  }
  return { ok: true, message: "功能测试通过，模型返回了预期内容。" }
}
