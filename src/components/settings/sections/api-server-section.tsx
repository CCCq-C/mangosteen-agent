import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { openUrl } from "@tauri-apps/plugin-opener"
import { apiServerStatus, mcpServerEntryPath } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { API_SERVER_BASE_URL, API_SERVER_HEALTH_URL } from "@/lib/api-server-constants"
import { generateApiToken } from "@/lib/api-token"
import { useWikiStore } from "@/stores/wiki-store"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

interface ApiHealth {
  ok?: boolean
  status?: string
  enabled?: boolean
  mcpEnabled?: boolean
  authRequired?: boolean
  authConfigured?: boolean
  allowUnauthenticated?: boolean
  allowLanAccess?: boolean
  tokenSource?: "env" | "store" | "none"
}

/**
 * Documented endpoint surface. Kept in lock-step with
 * `src-tauri/src/api_server.rs::handle_request`. When you add or remove
 * a route there, update this list — it's the only place users discover
 * the API contract until we ship a proper OpenAPI doc.
 */
export const API_ENDPOINTS: Array<{ method: "GET" | "POST" | "PATCH"; path: string; noteKey: string }> = [
  { method: "GET", path: "/api/v1/health", noteKey: "endpointHealthNote" },
  { method: "GET", path: "/api/v1/projects", noteKey: "endpointProjectsNote" },
  { method: "GET", path: "/api/v1/projects/{id}/files", noteKey: "endpointFilesNote" },
  { method: "GET", path: "/api/v1/projects/{id}/files/content", noteKey: "endpointContentNote" },
  { method: "GET", path: "/api/v1/projects/{id}/reviews", noteKey: "endpointReviewsNote" },
  { method: "PATCH", path: "/api/v1/projects/{id}/reviews/{reviewId}", noteKey: "endpointPatchReviewNote" },
  { method: "POST", path: "/api/v1/projects/{id}/reviews/resolve", noteKey: "endpointBulkResolveNote" },
  { method: "POST", path: "/api/v1/projects/{id}/search", noteKey: "endpointSearchNote" },
  { method: "GET", path: "/api/v1/projects/{id}/graph", noteKey: "endpointGraphNote" },
  { method: "POST", path: "/api/v1/projects/{id}/sources/rescan", noteKey: "endpointRescanNote" },
  { method: "POST", path: "/api/v1/projects/{id}/pages/embed", noteKey: "endpointEmbedPageNote" },
  { method: "POST", path: "/api/v1/projects/{id}/chat", noteKey: "endpointChatNote" },
  { method: "POST", path: "/api/v1/projects/{id}/chat/{sessionId}/cancel", noteKey: "endpointChatCancelNote" },
]

export function ApiServerSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const [showToken, setShowToken] = useState(false)
  const [copiedField, setCopiedField] = useState<"token" | "curl" | "chat" | "mcp" | null>(null)
  const [serverStatus, setServerStatus] = useState<string>("...")
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [mcpEntryPath, setMcpEntryPath] = useState<string | null>(null)
  const [mcpPathError, setMcpPathError] = useState<string | null>(null)
  const persistedApiConfig = useWikiStore((s) => s.apiConfig)

  useEffect(() => {
    let alive = true
    apiServerStatus()
      .then((s) => {
        if (alive) setServerStatus(s)
      })
      .catch(() => {
        if (alive) setServerStatus("unknown")
      })
    fetch(API_SERVER_HEALTH_URL)
      .then((res) => res.json() as Promise<ApiHealth>)
      .then((value) => {
        if (alive) setHealth(value)
      })
      .catch(() => {
        if (alive) setHealth(null)
      })
    mcpServerEntryPath()
      .then((path) => {
        if (!alive) return
        setMcpEntryPath(path)
        setMcpPathError(null)
      })
      .catch((err) => {
        if (!alive) return
        setMcpEntryPath(null)
        setMcpPathError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  const handleGenerate = useCallback(() => {
    setDraft("apiToken", generateApiToken())
    setShowToken(true)
  }, [setDraft])

  const handleCopyToken = useCallback(async () => {
    if (!draft.apiToken) return
    try {
      await navigator.clipboard.writeText(draft.apiToken)
      setCopiedField("token")
      setTimeout(() => setCopiedField(null), 1500)
    } catch (err) {
      console.error("[api-settings] copy token failed:", err)
    }
  }, [draft.apiToken])

  const sampleCurl = useMemo(() => {
    if (draft.apiAllowUnauthenticated) {
      return `curl ${API_SERVER_BASE_URL}/api/v1/projects`
    }
    // Show the user a complete, paste-runnable example. The Bearer
    // header is the recommended auth (never put the token in URL
    // query — it leaks into logs / shell history / Referer).
    const tokenForExample = draft.apiToken || "<your-token>"
    return `curl -H "Authorization: Bearer ${tokenForExample}" ${API_SERVER_BASE_URL}/api/v1/projects`
  }, [draft.apiAllowUnauthenticated, draft.apiToken])

  const sampleChatCurl = useMemo(() => {
    const tokenForExample = health?.tokenSource === "env"
      ? "$LLM_WIKI_API_TOKEN"
      : draft.apiToken || "<your-token>"
    return `curl -N -X POST \\
  -H "Authorization: Bearer ${tokenForExample}" \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: text/event-stream' \\
  ${API_SERVER_BASE_URL}/api/v1/projects/current/chat \\
  -d '{"message":"总结这个知识库。","stream":true}'`
  }, [draft.apiToken, health?.tokenSource])

  const sampleMcpConfig = useMemo(() => {
    if (!mcpEntryPath) return ""
    const env = health?.tokenSource === "env"
      ? { LLM_WIKI_API_TOKEN: "<与山竹智能体进程环境变量相同的值>" }
      : draft.apiToken
        ? { LLM_WIKI_API_TOKEN: draft.apiToken }
        : draft.apiAllowUnauthenticated
          ? {}
          : { LLM_WIKI_API_TOKEN: "<your-token>" }
    return JSON.stringify(
      {
        mcpServers: {
          "llm-wiki": {
            command: "node",
            args: [mcpEntryPath],
            ...(Object.keys(env).length > 0 ? { env } : {}),
          },
        },
      },
      null,
      2,
    )
  }, [draft.apiAllowUnauthenticated, draft.apiToken, health?.tokenSource, mcpEntryPath])

  const hasUnsavedApiConfig =
    persistedApiConfig.enabled !== draft.apiEnabled ||
    persistedApiConfig.allowUnauthenticated !== draft.apiAllowUnauthenticated ||
    persistedApiConfig.allowLanAccess !== draft.apiAllowLanAccess ||
    persistedApiConfig.mcpEnabled !== draft.apiMcpEnabled ||
    persistedApiConfig.token !== draft.apiToken.trim()

  const handleCopyCurl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sampleCurl)
      setCopiedField("curl")
      setTimeout(() => setCopiedField(null), 1500)
    } catch (err) {
      console.error("[api-settings] copy curl failed:", err)
    }
  }, [sampleCurl])

  const handleCopyChatCurl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sampleChatCurl)
      setCopiedField("chat")
      setTimeout(() => setCopiedField(null), 1500)
    } catch (err) {
      console.error("[api-settings] copy streaming chat curl failed:", err)
    }
  }, [sampleChatCurl])

  const handleCopyMcpConfig = useCallback(async () => {
    if (!mcpEntryPath) return
    try {
      await navigator.clipboard.writeText(sampleMcpConfig)
      setCopiedField("mcp")
      setTimeout(() => setCopiedField(null), 1500)
    } catch (err) {
      console.error("[api-settings] copy MCP config failed:", err)
    }
  }, [mcpEntryPath, sampleMcpConfig])

  const handleOpenHealth = useCallback(() => {
    void openUrl(API_SERVER_HEALTH_URL).catch((err) => {
      console.error("[api-settings] open health failed:", err)
    })
  }, [])

  const statusLabel = useMemo(() => {
    if (!draft.apiEnabled) {
      return t("settings.sections.apiServer.statusDisabled", { defaultValue: "已禁用" })
    }
    if (health?.allowUnauthenticated || draft.apiAllowUnauthenticated) {
      return t("settings.sections.apiServer.statusOpen", { defaultValue: "运行中，无需鉴权" })
    }
    if (serverStatus === "running" && health?.authConfigured === false && !draft.apiToken) {
      return t("settings.sections.apiServer.statusNoToken", { defaultValue: "运行中，未配置访问令牌" })
    }
    switch (serverStatus) {
      case "running":
        return t("settings.sections.apiServer.statusRunning", { defaultValue: "运行中" })
      case "starting":
        return t("settings.sections.apiServer.statusStarting", { defaultValue: "启动中……" })
      case "port_conflict":
        return t("settings.sections.apiServer.statusPortConflict", {
          defaultValue: "端口 19828 已被占用",
        })
      case "error":
        return t("settings.sections.apiServer.statusError", { defaultValue: "错误" })
      case "unknown":
        return t("settings.sections.apiServer.statusUnknown", { defaultValue: "未知" })
      default:
        return serverStatus
    }
  }, [draft.apiAllowUnauthenticated, draft.apiEnabled, draft.apiToken, health, serverStatus, t])

  const statusToneClass =
    !draft.apiEnabled
      ? "text-muted-foreground"
      : (health?.allowUnauthenticated || draft.apiAllowUnauthenticated)
        ? "text-amber-700 dark:text-amber-400"
        : serverStatus === "running"
      ? "text-emerald-600 dark:text-emerald-400"
      : serverStatus === "starting"
        ? "text-muted-foreground"
        : serverStatus === "unknown"
          ? "text-muted-foreground"
          : "text-destructive"

  const tokenStrength: "unused" | "missing" | "weak" | "ok" = draft.apiAllowUnauthenticated
    ? "unused"
    : !draft.apiToken
      ? "missing"
      : draft.apiToken.length < 16
        ? "weak"
        : "ok"

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.apiServer.title", { defaultValue: "API + MCP" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.apiServer.description", {
            defaultValue:
              "通过本地 HTTP API 把山竹智能体连接到其他工具，也可以通过内置 MCP 服务连接智能体客户端。",
          })}
        </p>
      </div>

      {/* ── Enable + status ───────────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.apiEnabled}
            onChange={(event) => setDraft("apiEnabled", event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Server className="h-4 w-4 text-muted-foreground" />
              {t("settings.sections.apiServer.enable", {
                defaultValue: "启用本地 HTTP API",
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.enableHint", {
                defaultValue:
                  "关闭后，除 /health 外的接口都会返回 503。无需删除令牌即可暂时停用服务。",
              })}
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
          <input
            type="checkbox"
            checked={draft.apiAllowUnauthenticated}
            onChange={(event) => setDraft("apiAllowUnauthenticated", event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {t("settings.sections.apiServer.allowUnauthenticated", {
                defaultValue: "允许无访问令牌连接",
              })}
            </div>
            <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              {t("settings.sections.apiServer.allowUnauthenticatedHint", {
                defaultValue:
                  "仅建议在可信的本机环境中使用。开启后，本机其他程序或网页也能调用接口。",
              })}
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <input
            type="checkbox"
            checked={draft.apiAllowLanAccess}
            onChange={(event) => setDraft("apiAllowLanAccess", event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <div className="text-sm font-semibold">
              {t("settings.sections.apiServer.allowLanAccess", {
                defaultValue: "允许 API 和网页剪藏服务从局域网访问",
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.allowLanAccessHint", {
                defaultValue:
                  "重启软件后，API 和剪贴服务将监听 0.0.0.0，而不是 127.0.0.1。仅在可信网络中使用，并建议保留令牌验证。",
              })}
            </p>
          </div>
        </label>

        <div className="grid grid-cols-1 gap-3 rounded-md border border-border/60 bg-background/40 p-3 text-sm sm:grid-cols-2">
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("settings.sections.apiServer.status", { defaultValue: "状态" })}
            </div>
            <div className={`font-mono text-xs ${statusToneClass}`}>{statusLabel}</div>
          </div>
          <div className="space-y-0.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("settings.sections.apiServer.baseUrl", { defaultValue: "服务地址" })}
            </div>
            <div className="font-mono text-xs">{API_SERVER_BASE_URL}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenHealth} className="gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.sections.apiServer.openHealth", { defaultValue: "打开 /health" })}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {t("settings.sections.apiServer.openHealthHint", {
              defaultValue: "/health 无需身份验证。其他接口遵循下方访问设置，但智能体对话始终需要令牌。",
            })}
          </span>
        </div>
      </div>

      {/* ── Token ─────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            {t("settings.sections.apiServer.token", { defaultValue: "访问令牌" })}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("settings.sections.apiServer.tokenHint", {
              defaultValue:
                "请通过 `Authorization: Bearer <token>` 或 `X-LLM-Wiki-Token: <token>` 发送令牌。允许免验证访问时，读取类接口可以省略令牌，但智能体对话和取消操作仍需令牌。环境变量 LLM_WIKI_API_TOKEN 会覆盖此处设置。",
            })}
          </p>
        </div>

        <Label htmlFor="api-token-input" className="sr-only">
          {t("settings.sections.apiServer.token", { defaultValue: "访问令牌" })}
        </Label>
        <div className="flex gap-2">
          <Input
            id="api-token-input"
            type={showToken ? "text" : "password"}
            value={draft.apiToken}
            onChange={(event) => setDraft("apiToken", event.target.value)}
            placeholder={t("settings.sections.apiServer.tokenPlaceholder", {
              defaultValue: "粘贴已有令牌，或点击生成",
            })}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowToken((value) => !value)}
            title={
              showToken
                ? t("settings.sections.apiServer.hide", { defaultValue: "隐藏" })
                : t("settings.sections.apiServer.show", { defaultValue: "显示" })
            }
            aria-label={
              showToken
                ? t("settings.sections.apiServer.hide", { defaultValue: "隐藏" })
                : t("settings.sections.apiServer.show", { defaultValue: "显示" })
            }
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleCopyToken}
            disabled={!draft.apiToken}
            title={t("settings.sections.apiServer.copy", { defaultValue: "复制" })}
            aria-label={t("settings.sections.apiServer.copy", { defaultValue: "复制" })}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleGenerate} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            {t("settings.sections.apiServer.generate", { defaultValue: "生成新令牌" })}
          </Button>
          {copiedField === "token" && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">
              {t("settings.sections.apiServer.copied", { defaultValue: "已复制" })}
            </span>
          )}
          {tokenStrength === "missing" && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.apiServer.tokenMissing", {
                defaultValue: "未配置访问令牌——智能体对话不可用，受保护的接口会返回 401",
              })}
            </span>
          )}
          {tokenStrength === "unused" && health?.tokenSource !== "env" && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.apiServer.tokenUnused", {
                defaultValue: "读取类接口已开放，但智能体对话仍使用此令牌",
              })}
            </span>
          )}
          {health?.tokenSource === "env" && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.apiServer.envTokenActive", {
                defaultValue: "LLM_WIKI_API_TOKEN 正在生效，并会覆盖此处填写的令牌",
              })}
            </span>
          )}
          {hasUnsavedApiConfig && (
            <span className="text-xs text-muted-foreground">
              {t("settings.sections.apiServer.saveFirst", {
                defaultValue: "保存设置后 API 改动才会生效",
              })}
            </span>
          )}
          {tokenStrength === "weak" && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {t("settings.sections.apiServer.tokenWeak", {
                defaultValue: "令牌长度偏短，建议重新生成一个更安全的令牌",
              })}
            </span>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <div>
              {t("settings.sections.apiServer.tokenWarning", {
                defaultValue:
                  "请妥善保管令牌。任何拿到令牌的本机程序都可能通过 localhost 读取项目文件。",
              })}
            </div>
            <div>
              {t("settings.sections.apiServer.tokenQueryWarning", {
                defaultValue:
                  "建议使用 Authorization 请求头。通过网址传递 ?token=… 可能把令牌泄露到命令历史、日志和 Referer 请求头中。",
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sample curl ───────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t("settings.sections.apiServer.sample", { defaultValue: "示例请求" })}
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyCurl}
            disabled={hasUnsavedApiConfig}
            className="gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" />
            {copiedField === "curl"
              ? t("settings.sections.apiServer.copied", { defaultValue: "已复制" })
              : t("settings.sections.apiServer.copy", { defaultValue: "复制" })}
          </Button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-[11px] font-mono leading-relaxed">
          {hasUnsavedApiConfig
            ? t("settings.sections.apiServer.saveFirstExample", {
                defaultValue: "请先保存设置，然后再复制示例请求。",
              })
            : sampleCurl}
        </pre>
      </div>

      {/* ── Endpoint catalog ──────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t("settings.sections.apiServer.chatTitle", { defaultValue: "智能体对话与流式输出" })}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.chatHint", {
                defaultValue:
                  "向 /chat 发送 POST 消息。默认返回一份 JSON；设置 stream: true 或发送 Accept: text/event-stream，可在智能体工作时接收 SSE 流式消息。",
              })}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={handleCopyChatCurl} disabled={hasUnsavedApiConfig} className="shrink-0 gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            {copiedField === "chat"
              ? t("settings.sections.apiServer.copied", { defaultValue: "已复制" })
              : t("settings.sections.apiServer.copy", { defaultValue: "复制" })}
          </Button>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <div className="font-medium">{t("settings.sections.apiServer.chatJsonTitle", { defaultValue: "JSON 模式" })}</div>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.chatJsonHint", { defaultValue: "省略 stream 或设为 false。智能体完成一轮任务后返回结果。" })}
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <div className="font-medium">{t("settings.sections.apiServer.chatSseTitle", { defaultValue: "SSE 模式" })}</div>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.chatSseHint", { defaultValue: "事件依次为 meta、智能体增量事件，以及 done、cancelled 或 error；done 包含完整结果。" })}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t("settings.sections.apiServer.chatTokenRequired", { defaultValue: "智能体对话及取消接口始终需要访问令牌，即使读取类接口允许无认证访问。" })}
          </span>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-[11px] font-mono leading-relaxed">
          {hasUnsavedApiConfig
            ? t("settings.sections.apiServer.saveFirstExample", { defaultValue: "请先保存设置，然后再复制示例请求。" })
            : sampleChatCurl}
        </pre>
      </div>

      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
        <h3 className="text-sm font-semibold">
          {t("settings.sections.apiServer.endpoints", { defaultValue: "接口列表" })}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.sections.apiServer.endpointsHint", {
            defaultValue: "将 {id} 替换为项目 UUID、项目文件路径或固定值 'current'。",
          })}
        </p>
        <div className="space-y-1 text-xs">
          {API_ENDPOINTS.map((endpoint) => {
            const note = t(`settings.sections.apiServer.${endpoint.noteKey}`, {
              defaultValue: "",
            })
            const methodClass =
              endpoint.method === "GET"
                ? "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                : endpoint.method === "PATCH"
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            return (
              <div
                key={`${endpoint.method} ${endpoint.path}`}
                className="flex flex-wrap items-baseline gap-2 rounded border border-border/40 bg-background/50 px-2 py-1"
              >
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${methodClass}`}
                >
                  {endpoint.method}
                </span>
                <span className="font-mono">{endpoint.path}</span>
                {note && <span className="text-muted-foreground">— {note}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── MCP ──────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.apiMcpEnabled}
            onChange={(event) => setDraft("apiMcpEnabled", event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <div className="text-sm font-semibold">
              {t("settings.sections.apiServer.mcpEnable", {
                defaultValue: "启用 MCP 访问",
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.apiServer.mcpEnableHint", {
                defaultValue:
                  "MCP 使用本地 API 和相同的令牌规则。请保持 HTTP API 开启，再把 MCP 客户端连接到内置 Node 服务。",
              })}
            </p>
          </div>
        </label>

        <div className="rounded-md border border-border/50 bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t("settings.sections.apiServer.mcpUsage", { defaultValue: "MCP 使用说明" })}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyMcpConfig}
              disabled={hasUnsavedApiConfig || !draft.apiMcpEnabled || !mcpEntryPath}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              {copiedField === "mcp"
                ? t("settings.sections.apiServer.copied", { defaultValue: "已复制" })
                : t("settings.sections.apiServer.copy", { defaultValue: "复制" })}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("settings.sections.apiServer.mcpUsageHint", {
              defaultValue:
                "先运行一次 `npm run mcp:build`，再让 MCP 客户端启动下方服务。除非已允许免验证访问，否则请设置 LLM_WIKI_API_TOKEN。",
            })}
          </p>
          {mcpPathError && (
            <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              {mcpPathError}
            </p>
          )}
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-background/60 px-3 py-2 text-[11px] font-mono leading-relaxed">
            {hasUnsavedApiConfig
              ? t("settings.sections.apiServer.saveFirstExample", {
                  defaultValue: "请先保存设置，然后再复制示例请求。",
                })
              : !mcpEntryPath
                ? t("settings.sections.apiServer.mcpPathUnavailable", {
                    defaultValue:
                      "未找到 MCP 服务入口。请在山竹智能体项目目录运行 `npm run mcp:build`，然后重新打开设置。",
                  })
              : sampleMcpConfig}
          </pre>
        </div>
      </div>
    </div>
  )
}
