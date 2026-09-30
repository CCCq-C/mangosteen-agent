import { useTranslation } from "react-i18next"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function GeneralSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.general.title", { defaultValue: "通用" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.general.description", {
            defaultValue: "桌面应用的启动和窗口关闭行为。",
          })}
        </p>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={draft.autostart}
          onChange={(e) => setDraft("autostart", e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <div className="space-y-1">
          <span className="text-sm">
            {t("settings.sections.general.autostart", { defaultValue: "登录系统后自动启动" })}
          </span>
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.general.autostartHint", {
              defaultValue: "登录这台电脑后自动启动山竹智能体。",
            })}
          </p>
        </div>
      </label>
    </div>
  )
}
