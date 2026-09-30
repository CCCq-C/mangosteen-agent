import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle } from "lucide-react"
import { validateProxyUrl } from "@/lib/proxy-config"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function NetworkSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  // Live URL validation — only flag the user when they've actually
  // typed something. Empty + enabled is "form not yet finished",
  // not a hard error.
  const trimmed = draft.proxyUrl.trim()
  const validation = trimmed === "" ? null : validateProxyUrl(trimmed)
  const showError = draft.proxyEnabled && validation && !validation.ok

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.network.title", { defaultValue: "网络" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.network.description", {
            defaultValue:
              "让大模型、语义搜索、网页搜索和更新检查等外部请求通过代理。保存后立即生效，无需重启。",
          })}
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.proxyEnabled}
          onChange={(e) => setDraft("proxyEnabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          {t("settings.sections.network.enable", {
            defaultValue: "启用代理",
          })}
        </span>
      </label>

      <div className="space-y-2">
        <Label htmlFor="proxy-url">
          {t("settings.sections.network.url", { defaultValue: "代理地址" })}
        </Label>
        <Input
          id="proxy-url"
          value={draft.proxyUrl}
          onChange={(e) => setDraft("proxyUrl", e.target.value)}
          placeholder="http://127.0.0.1:7890"
          disabled={!draft.proxyEnabled}
          className={showError ? "border-destructive" : ""}
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.network.urlHelp", {
            defaultValue:
              "请输入带协议的完整地址。支持 http:// 和 https://，当前版本不支持 SOCKS5。",
          })}
        </p>
        {showError && validation && !validation.ok && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {validation.error}
          </p>
        )}
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.proxyBypassLocal}
          onChange={(e) => setDraft("proxyBypassLocal", e.target.checked)}
          disabled={!draft.proxyEnabled}
          className="mt-0.5 h-4 w-4"
        />
        <div className="space-y-1">
          <span className="text-sm">
            {t("settings.sections.network.bypassLocal", {
              defaultValue: "本地地址不走代理（推荐）",
            })}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.network.bypassLocalHelp", {
              defaultValue:
                "对 localhost、127.0.0.0/8、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 和 *.local 的请求不会走代理。使用 Ollama、LM Studio 或局域网模型时请保持开启。",
            })}
          </p>
        </div>
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.proxyAcceptInvalidCerts}
          onChange={(e) => setDraft("proxyAcceptInvalidCerts", e.target.checked)}
          disabled={!draft.proxyEnabled}
          className="mt-0.5 h-4 w-4"
        />
        <div className="space-y-1">
          <span className="text-sm">
            {t("settings.sections.network.acceptInvalidCerts", {
              defaultValue: "忽略 TLS 证书错误",
            })}
          </span>
          <p className="text-xs text-destructive">
            {t("settings.sections.network.acceptInvalidCertsHelp", {
              defaultValue:
                "仅用于可信的企业代理。开启后会停止校验外部请求的证书，可能增加加密流量被拦截的风险。",
            })}
          </p>
        </div>
      </label>

    </div>
  )
}
