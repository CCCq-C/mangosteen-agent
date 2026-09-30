import { useEffect, useMemo, useState } from "react"
import { FolderSync, ShieldAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import {
  normalizeSourceWatchConfig,
  SOURCE_WATCH_FILE_TYPE_GROUPS,
} from "@/lib/source-watch-config"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
  projectReady: boolean
}

function updateListValue(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinList(values: readonly string[]): string {
  return values.join(", ")
}

export function SourceWatchSection({ draft, setDraft, projectReady }: Props) {
  const { t } = useTranslation()
  const config = normalizeSourceWatchConfig(draft.sourceWatchConfig)
  const selected = useMemo(() => new Set(config.includeExtensions), [config.includeExtensions])
  const [editingList, setEditingList] = useState<"dirs" | "extensions" | "globs" | null>(null)
  const [excludeDirsText, setExcludeDirsText] = useState(() => joinList(config.excludeDirs))
  const [excludeExtensionsText, setExcludeExtensionsText] = useState(() => joinList(config.excludeExtensions))
  const [excludeGlobsText, setExcludeGlobsText] = useState(() => joinList(config.excludeGlobs))
  const excludeDirsKey = config.excludeDirs.join("\0")
  const excludeExtensionsKey = config.excludeExtensions.join("\0")
  const excludeGlobsKey = config.excludeGlobs.join("\0")

  useEffect(() => {
    if (editingList !== "dirs") setExcludeDirsText(joinList(config.excludeDirs))
    if (editingList !== "extensions") setExcludeExtensionsText(joinList(config.excludeExtensions))
    if (editingList !== "globs") setExcludeGlobsText(joinList(config.excludeGlobs))
  }, [editingList, excludeDirsKey, excludeExtensionsKey, excludeGlobsKey])

  const updateConfig = (patch: Partial<typeof config>) => {
    setDraft("sourceWatchConfig", normalizeSourceWatchConfig({ ...config, ...patch }))
  }

  const finishListEdit = (field: "dirs" | "extensions" | "globs", value: string) => {
    const normalized = normalizeSourceWatchConfig({
      ...config,
      ...(field === "dirs" ? { excludeDirs: updateListValue(value) } : {}),
      ...(field === "extensions" ? { excludeExtensions: updateListValue(value) } : {}),
      ...(field === "globs" ? { excludeGlobs: updateListValue(value) } : {}),
    })
    setEditingList(null)
    if (field === "dirs") setExcludeDirsText(joinList(normalized.excludeDirs))
    if (field === "extensions") setExcludeExtensionsText(joinList(normalized.excludeExtensions))
    if (field === "globs") setExcludeGlobsText(joinList(normalized.excludeGlobs))
  }

  const toggleExtension = (ext: string, checked: boolean) => {
    const next = new Set(config.includeExtensions)
    if (checked) {
      next.add(ext)
    } else {
      next.delete(ext)
    }
    updateConfig({ includeExtensions: [...next].sort() })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.sourceWatch.title", { defaultValue: "资料文件夹自动监控" })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.sourceWatch.description", {
            defaultValue:
              "监控 raw/sources 的外部变化，并选择允许自动整理的文件。",
          })}
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => updateConfig({ enabled: event.target.checked })}
            disabled={!projectReady}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FolderSync className="h-4 w-4 text-muted-foreground" />
              {t("settings.sections.sourceWatch.enable", { defaultValue: "监控项目资料文件夹" })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.sourceWatch.enableDescription", {
                defaultValue:
                  "刷新资料列表，并整理 raw/sources 中允许的新增或修改文件。",
              })}
            </p>
          </div>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">
            {t("settings.sections.sourceWatch.parsingConcurrency", {
              defaultValue: "文档解析并发数",
            })}
          </span>
          <input
            type="number"
            min={1}
            max={8}
            value={config.parsingConcurrency}
            onChange={(event) => updateConfig({ parsingConcurrency: Number(event.target.value) || 1 })}
            disabled={!projectReady}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.parsingConcurrencyDescription", {
              defaultValue:
                "最多同时解析这些数量的导入文档。为保证稳定，PDF 仍会逐个解析。",
            })}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">
            {t("settings.sections.sourceWatch.ingestConcurrency", {
              defaultValue: "资料整理并发数",
            })}
          </span>
          <input
            type="number"
            min={1}
            max={5}
            value={config.ingestConcurrency}
            onChange={(event) => updateConfig({ ingestConcurrency: Number(event.target.value) || 1 })}
            disabled={!projectReady}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.ingestConcurrencyDescription", {
              defaultValue:
                "同时准备这些数量的资料，写入知识库时仍会保持顺序。数值越高，占用的模型容量和内存越多。",
            })}
          </p>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={config.persistExtractedMarkdown}
            onChange={(event) => updateConfig({ persistExtractedMarkdown: event.target.checked })}
            disabled={!projectReady}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <span className="text-sm font-semibold">
              {t("settings.sections.sourceWatch.persistExtractedMarkdown", {
                defaultValue: "保留解析后的 Markdown",
              })}
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.sourceWatch.persistExtractedMarkdownDescription", {
                defaultValue:
                  "将文档解析出的文本按 raw/sources 的目录结构保存到 raw/parsed。",
              })}
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={config.autoIngest}
            onChange={(event) => updateConfig({ autoIngest: event.target.checked })}
            disabled={!projectReady || !config.enabled}
            className="mt-1 h-4 w-4"
          />
          <div className="space-y-1">
            <span className="text-sm font-semibold">
              {t("settings.sections.sourceWatch.autoIngest", { defaultValue: "自动整理允许的资料文件" })}
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.sections.sourceWatch.autoIngestDescription", {
                defaultValue:
                  "关闭后，外部变化仍会刷新文件列表，但不会自动整理资料。",
              })}
            </p>
          </div>
        </label>

        {!projectReady && (
          <p className="text-xs text-muted-foreground">
            {t("settings.sections.sourceWatch.noProject", {
              defaultValue: "打开项目后才能修改此项目设置。",
            })}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            {t("settings.sections.sourceWatch.fileTypes", { defaultValue: "允许的文件类型" })}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.fileTypesDescription", {
              defaultValue:
                "常见文档类型默认开启。媒体、程序、源代码和配置文件默认关闭，需要时可手动选择。",
            })}
          </p>
        </div>

        <div className="space-y-4">
          {SOURCE_WATCH_FILE_TYPE_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`settings.sections.sourceWatch.groups.${group.id}`, { defaultValue: group.id })}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.extensions.map((ext) => (
                  <label
                    key={ext}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(ext)}
                      onChange={(event) => toggleExtension(ext, event.target.checked)}
                      disabled={!projectReady || !config.enabled}
                      className="h-3.5 w-3.5"
                    />
                    <span>.{ext}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            {t("settings.sections.sourceWatch.exclusions", { defaultValue: "排除规则和限制" })}
          </h3>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">
            {t("settings.sections.sourceWatch.maxSize", { defaultValue: "自动整理的最大文件大小（MB）" })}
          </span>
          <input
            type="number"
            min={1}
            max={4096}
            value={config.maxFileSizeMb}
            onChange={(event) => updateConfig({ maxFileSizeMb: Number(event.target.value) || 1 })}
            disabled={!projectReady || !config.enabled}
            className="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">
            {t("settings.sections.sourceWatch.excludeDirs", { defaultValue: "排除的文件夹" })}
          </span>
          <textarea
            value={excludeDirsText}
            onFocus={() => setEditingList("dirs")}
            onChange={(event) => {
              setExcludeDirsText(event.target.value)
              updateConfig({ excludeDirs: updateListValue(event.target.value) })
            }}
            onBlur={() => finishListEdit("dirs", excludeDirsText)}
            placeholder={t("settings.sections.sourceWatch.excludeDirsPlaceholder", {
              defaultValue: ".git, node_modules, drafts, subdir/drafts",
            })}
            disabled={!projectReady || !config.enabled}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.excludeDirsHint", {
              defaultValue: "文件夹名称会匹配路径中的任意层级，例如 subdir/drafts 会匹配对应的嵌套文件夹。",
            })}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">
            {t("settings.sections.sourceWatch.excludeExtensions", { defaultValue: "排除的文件扩展名" })}
          </span>
          <textarea
            value={excludeExtensionsText}
            onFocus={() => setEditingList("extensions")}
            onChange={(event) => {
              setExcludeExtensionsText(event.target.value)
              updateConfig({ excludeExtensions: updateListValue(event.target.value) })
            }}
            onBlur={() => finishListEdit("extensions", excludeExtensionsText)}
            placeholder={t("settings.sections.sourceWatch.excludeExtensionsPlaceholder", {
              defaultValue: "tmp, bak, exe, dll, iso, dmg",
            })}
            disabled={!projectReady || !config.enabled}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.excludeExtensionsHint", {
              defaultValue: "扩展名不需要带点号；这里的设置优先于上面的允许文件类型。",
            })}
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium">
            {t("settings.sections.sourceWatch.excludeGlobs", { defaultValue: "排除的文件名模式" })}
          </span>
          <textarea
            value={excludeGlobsText}
            onFocus={() => setEditingList("globs")}
            onChange={(event) => {
              setExcludeGlobsText(event.target.value)
              updateConfig({ excludeGlobs: updateListValue(event.target.value) })
            }}
            onBlur={() => finishListEdit("globs", excludeGlobsText)}
            disabled={!projectReady || !config.enabled}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("settings.sections.sourceWatch.excludeGlobsHint", {
              defaultValue: "使用逗号分隔多个模式，例如 *.draft.*、~$*、.~lock.*#。",
            })}
          </p>
        </label>
      </div>
    </div>
  )
}
