import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function MultimodalSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.multimodal.title", "图片描述")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.sections.multimodal.description",
            "整理资料时，使用当前 Codex 配置为提取的图片生成描述，并写入来源 Markdown 的替代文本。",
          )}
        </p>
      </div>

      <div
        className={`flex items-center justify-between rounded-md border-2 p-3 transition-colors ${
          draft.multimodalEnabled
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-background"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {t("settings.sections.multimodal.enableLabel", "整理资料时生成图片描述")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(
              "settings.sections.multimodal.enableHint",
              "开启后使用当前 Codex 配置生成图片描述；关闭后仍会提取图片，但不会生成描述。",
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDraft("multimodalEnabled", !draft.multimodalEnabled)}
          role="switch"
          aria-checked={draft.multimodalEnabled}
          aria-label={t("settings.sections.multimodal.enableLabel", "整理资料时生成图片描述")}
          className="ml-3 flex shrink-0 items-center gap-2"
        >
          <span
            className={`text-xs font-semibold ${
              draft.multimodalEnabled ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {draft.multimodalEnabled
              ? t("settings.sections.multimodal.stateOn", "ON")
              : t("settings.sections.multimodal.stateOff", "OFF")}
          </span>
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              draft.multimodalEnabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                draft.multimodalEnabled ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {draft.multimodalEnabled && (
        <div className="space-y-2 rounded-md border p-3">
          <Label>{t("settings.sections.multimodal.concurrency", "并行图片描述请求数")}</Label>
          <Input
            type="number"
            min={1}
            max={16}
            step={1}
            value={draft.multimodalConcurrency}
            onChange={(e) => {
              const n = Number(e.target.value)
              setDraft("multimodalConcurrency", Number.isFinite(n) ? n : 4)
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.multimodal.concurrencyHint", "同时运行的图片描述请求数。")}
          </p>
        </div>
      )}
    </div>
  )
}
