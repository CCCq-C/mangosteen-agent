import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import type { MineruLocalBackend, MineruModelVersion, MineruParseMethod } from "@/stores/wiki-store"
import { testMineruConnection } from "@/lib/mineru"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

type TestState = "idle" | "running" | "success" | "failed"

export function MineruSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const [testState, setTestState] = useState<TestState>("idle")
  const [testError, setTestError] = useState("")

  const handleTest = async () => {
    if (draft.mineruBackend === "cloud" && !draft.mineruToken.trim()) return
    setTestState("running")
    setTestError("")
    try {
      await testMineruConnection(draft.mineruToken.trim(), {
        backend: draft.mineruBackend,
        localEndpoint: draft.mineruLocalEndpoint,
        localToken: draft.mineruLocalToken.trim(),
      })
      setTestState("success")
    } catch (err) {
      setTestState("failed")
      setTestError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.mineru.title", { defaultValue: "MinerU PDF 解析" })}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.sections.mineru.description", {
            defaultValue:
              "使用 MinerU 云服务或自行部署的本地服务，提高表格、公式和复杂排版 PDF 的解析质量。",
          })}
        </p>
        {draft.mineruBackend === "cloud" && (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {t("settings.sections.mineru.privacyNotice", {
              defaultValue:
                "开启后，PDF 内容会上传到 MinerU 云端解析。敏感文档请谨慎使用。",
            })}
          </p>
        )}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.mineruEnabled}
          onChange={(e) => setDraft("mineruEnabled", e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          {t("settings.sections.mineru.enabled", { defaultValue: "启用 MinerU" })}
        </span>
      </label>

      {draft.mineruEnabled && (
        <div className="space-y-4 pl-1">
          <div className="space-y-2">
            <Label>{t("settings.sections.mineru.backend", { defaultValue: "解析服务" })}</Label>
            <div className="space-y-1 pl-1">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.mineruBackend === "cloud"}
                  onChange={() => {
                    setDraft("mineruBackend", "cloud")
                    setTestState("idle")
                  }}
                  className="h-4 w-4"
                />
                <span className="text-sm">
                  {t("settings.sections.mineru.cloudBackend", {
                    defaultValue: "云端（mineru.net）——需要访问令牌，解析质量更高",
                  })}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={draft.mineruBackend === "local"}
                  onChange={() => {
                    setDraft("mineruBackend", "local")
                    setTestState("idle")
                  }}
                  className="h-4 w-4"
                />
                <span className="text-sm">
                  {t("settings.sections.mineru.localBackend", {
                    defaultValue: "官方自建 mineru-api——私有、离线",
                  })}
                </span>
              </label>
            </div>
          </div>

          {draft.mineruBackend === "cloud" && (
            <div className="space-y-2">
              <Label htmlFor="mineru-token">
                {t("settings.sections.mineru.token", { defaultValue: "API 访问令牌" })}
              </Label>
              <Input
                id="mineru-token"
                type="password"
                value={draft.mineruToken}
                onChange={(e) => {
                  setDraft("mineruToken", e.target.value)
                  setTestState("idle")
                }}
                placeholder={t("settings.sections.mineru.tokenHint", {
                  defaultValue: "从 mineru.net 获取访问令牌",
                })}
              />
            </div>
          )}

          {draft.mineruBackend === "local" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mineru-local-endpoint">
                  {t("settings.sections.mineru.localEndpoint", {
                    defaultValue: "本地服务地址",
                  })}
                </Label>
                <Input
                  id="mineru-local-endpoint"
                  type="url"
                  value={draft.mineruLocalEndpoint}
                  onChange={(e) => {
                    setDraft("mineruLocalEndpoint", e.target.value)
                    setTestState("idle")
                  }}
                  placeholder="http://127.0.0.1:8000"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.mineru.localInfo", {
                    defaultValue:
                      "官方 mineru-api 或 mineru-router 服务的基础地址。",
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mineru-local-token">
                  {t("settings.sections.mineru.localToken", {
                    defaultValue: "本地 API 密钥（可选）",
                  })}
                </Label>
                <Input
                  id="mineru-local-token"
                  type="password"
                  value={draft.mineruLocalToken}
                  onChange={(e) => {
                    setDraft("mineruLocalToken", e.target.value)
                    setTestState("idle")
                  }}
                  placeholder={t("settings.sections.mineru.localTokenHint", {
                    defaultValue: "通过 Authorization: Bearer 请求头发送",
                  })}
                />
              </div>
            </div>
          )}

          {draft.mineruBackend === "cloud" && <div className="space-y-2">
            <Label htmlFor="mineru-model">
              {t("settings.sections.mineru.model", { defaultValue: "模型版本" })}
            </Label>
            <select
              id="mineru-model"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={draft.mineruModelVersion}
              onChange={(e) =>
                setDraft("mineruModelVersion", e.target.value as MineruModelVersion)
              }
            >
              <option value="vlm">
                {t("settings.sections.mineru.modelVlm", {
                  defaultValue: "VLM（推荐，适合复杂排版）",
                })}
              </option>
              <option value="pipeline">
                {t("settings.sections.mineru.modelPipeline", {
                  defaultValue: "Pipeline（更快）",
                })}
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              {t("settings.sections.mineru.modelHint", {
                defaultValue: "PDF 解析支持 Pipeline 和 VLM。MinerU-HTML 用于 HTML 文件，这里不会使用。",
              })}
            </p>
          </div>}

          {draft.mineruBackend === "local" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mineru-local-backend">{t("settings.sections.mineru.parsingBackend")}</Label>
                <select
                  id="mineru-local-backend"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={draft.mineruLocalBackend}
                  onChange={(e) => setDraft("mineruLocalBackend", e.target.value as MineruLocalBackend)}
                >
                  <option value="hybrid-engine">{t("settings.sections.mineru.backendHybrid")}</option>
                  <option value="pipeline">{t("settings.sections.mineru.backendPipeline")}</option>
                  <option value="vlm-engine">{t("settings.sections.mineru.backendVlm")}</option>
                  <option value="hybrid-http-client">{t("settings.sections.mineru.backendHybridHttp")}</option>
                  <option value="vlm-http-client">{t("settings.sections.mineru.backendVlmHttp")}</option>
                </select>
              </div>

              {draft.mineruLocalBackend.startsWith("hybrid-") && (
                <div className="space-y-2">
                  <Label htmlFor="mineru-effort">{t("settings.sections.mineru.effort")}</Label>
                  <select id="mineru-effort" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.mineruLocalEffort} onChange={(e) => setDraft("mineruLocalEffort", e.target.value as "medium" | "high")}>
                    <option value="medium">{t("settings.sections.mineru.effortMedium")}</option>
                    <option value="high">{t("settings.sections.mineru.effortHigh")}</option>
                  </select>
                </div>
              )}

              {(draft.mineruLocalBackend === "pipeline" || draft.mineruLocalBackend.startsWith("hybrid-")) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="mineru-language">{t("settings.sections.mineru.ocrLanguage")}</Label>
                    <Input id="mineru-language" value={draft.mineruLocalLanguage} onChange={(e) => setDraft("mineruLocalLanguage", e.target.value)} placeholder="ch" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mineru-parse-method">{t("settings.sections.mineru.parseMethod")}</Label>
                    <select id="mineru-parse-method" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.mineruLocalParseMethod} onChange={(e) => setDraft("mineruLocalParseMethod", e.target.value as MineruParseMethod)}>
                      <option value="auto">{t("settings.sections.mineru.parseAuto")}</option>
                      <option value="txt">{t("settings.sections.mineru.parseText")}</option>
                      <option value="ocr">{t("settings.sections.mineru.parseOcr")}</option>
                    </select>
                  </div>
                </div>
              )}

              {draft.mineruLocalBackend.endsWith("http-client") && (
                <div className="space-y-2">
                  <Label htmlFor="mineru-server-url">{t("settings.sections.mineru.serverUrl")}</Label>
                  <Input id="mineru-server-url" type="url" value={draft.mineruLocalServerUrl} onChange={(e) => setDraft("mineruLocalServerUrl", e.target.value)} placeholder="http://127.0.0.1:30000" />
                </div>
              )}

              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.mineruLocalFormulaEnabled} onChange={(e) => setDraft("mineruLocalFormulaEnabled", e.target.checked)} />{t("settings.sections.mineru.formulaParsing")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.mineruLocalTableEnabled} onChange={(e) => setDraft("mineruLocalTableEnabled", e.target.checked)} />{t("settings.sections.mineru.tableParsing")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.mineruLocalImageAnalysis} onChange={(e) => setDraft("mineruLocalImageAnalysis", e.target.checked)} />{t("settings.sections.mineru.imageAnalysis")}</label>
              </div>
            </div>
          )}
          {draft.mineruBackend === "cloud" && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("settings.sections.mineru.testQuotaNotice", {
                defaultValue:
                  "连接测试会向 MinerU 提交一个小型示例文件，可能消耗少量额度。",
              })}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={
                (draft.mineruBackend === "cloud" && !draft.mineruToken.trim()) ||
                (draft.mineruBackend === "local" && !draft.mineruLocalEndpoint.trim()) ||
                testState === "running"
              }
            >
              {testState === "running"
                ? t("settings.sections.mineru.testing", { defaultValue: "测试中……" })
                : t("settings.sections.mineru.test", {
                    defaultValue: "测试连接",
                  })}
            </Button>
            {testState === "success" && (
              <span className="text-sm text-green-600">
                {t("settings.sections.mineru.testSuccess", {
                  defaultValue: "连接成功",
                })}
              </span>
            )}
            {testState === "failed" && (
              <span className="text-sm text-red-600">
                {t("settings.sections.mineru.testFailed", {
                  defaultValue: "测试失败",
                })}
                : {testError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
