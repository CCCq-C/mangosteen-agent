import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { LlmPreset } from "./llm-presets"
import { modelHubCategory, type ModelHubCategory } from "./model-hub-utils"

const CATEGORIES: ModelHubCategory[] = ["subscription", "local", "official", "compatible"]

export function filterModelProfileTemplates(
  presets: LlmPreset[],
  category: ModelHubCategory,
  query: string,
): LlmPreset[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return presets.filter((preset) => {
    if (preset.id.startsWith("custom-") || modelHubCategory(preset) !== category) return false
    if (!normalizedQuery) return true
    return [preset.label, preset.id, preset.hint ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    )
  })
}

export function ModelProfileCatalog({
  presets,
  onChoose,
}: {
  presets: LlmPreset[]
  onChoose: (basePresetId: string) => void
}) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<ModelHubCategory>("subscription")
  const [query, setQuery] = useState("")
  const templates = useMemo(
    () => filterModelProfileTemplates(presets, category, query),
    [category, presets, query],
  )

  return (
    <div className="space-y-3">
      <Input
        type="search"
        role="searchbox"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("settings.sections.llm.modelHub.catalog.searchPlaceholder")}
        aria-label={t("settings.sections.llm.modelHub.catalog.searchPlaceholder")}
      />
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={category === item ? "default" : "outline"}
            onClick={() => setCategory(item)}
          >
            {t(`settings.sections.llm.modelHub.categories.${item}`)}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {templates.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            className="h-auto items-start justify-start whitespace-normal p-3 text-left"
            onClick={() => onChoose(preset.id)}
          >
            <span>
              <span className="block font-medium">{preset.label}</span>
              {preset.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{preset.hint}</span>}
            </span>
          </Button>
        ))}
      </div>
      {templates.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("settings.sections.llm.modelHub.catalog.empty")}</p>
      )}
    </div>
  )
}
