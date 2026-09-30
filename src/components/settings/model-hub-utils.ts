import type { ProviderOverride } from "@/stores/wiki-store"
import type { LlmPreset } from "./llm-presets"

export type ModelHubCategory = "subscription" | "local" | "official" | "compatible"
export type ConnectionTestField = "model" | "apiKey" | "endpoint"

export function codexOnlyPresets(presets: LlmPreset[]): LlmPreset[] {
  return presets.filter((preset) => preset.id === "codex-cli")
}

export function modelHubCategory(preset: LlmPreset): ModelHubCategory {
  if (preset.provider === "codex-cli" || preset.provider === "claude-code") return "subscription"
  if (preset.provider === "ollama") return "local"
  if (preset.provider === "custom") return "compatible"
  return "official"
}

export function isModelHubConfigured(
  override: ProviderOverride | undefined,
  isActive: boolean,
): boolean {
  if (isActive) return true
  if (!override) return false
  return Object.values(override).some((value) => {
    if (typeof value === "string") return value.trim().length > 0
    if (typeof value === "number" || typeof value === "boolean") return true
    if (value && typeof value === "object") return Object.keys(value).length > 0
    return false
  })
}

export function duplicateProviderConfig(
  configs: Record<string, ProviderOverride>,
  sourceId: string,
  copyId: string,
): Record<string, ProviderOverride> {
  const source = configs[sourceId]
  return source ? { ...configs, [copyId]: { ...source } } : configs
}

export function connectionTestErrorField(message: string): ConnectionTestField | null {
  if (message === "尚未填写模型") return "model"
  if (message === "需要填写 API 密钥") return "apiKey"
  if (message === "尚未填写服务地址") return "endpoint"
  return null
}

export function selectableModelHubProfiles(
  presets: LlmPreset[],
  configs: Record<string, ProviderOverride>,
  activePresetId: string | null,
  selectedPresetIds: readonly (string | null | undefined)[] = [],
): LlmPreset[] {
  return presets.filter((preset) =>
    preset.id.startsWith("custom-") ||
    selectedPresetIds.includes(preset.id) ||
    isModelHubConfigured(configs[preset.id], preset.id === activePresetId),
  )
}

export function modelHubDisplayModel(
  preset: LlmPreset,
  override: ProviderOverride | undefined,
): string {
  return override?.model?.trim() || preset.defaultModel || ""
}

export function shouldRunProviderTest({
  editorOnly,
  testRequestId,
  handledTestRequestId,
}: {
  editorOnly: boolean
  testRequestId: number
  handledTestRequestId: number
}): boolean {
  return editorOnly && testRequestId > handledTestRequestId
}
