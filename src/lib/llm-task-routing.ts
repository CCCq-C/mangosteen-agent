import { toCodexOnlyConfig } from "./codex-only-config"
import type {
  LlmConfig,
  ProjectLlmOverride,
  CustomLlmPreset,
  ProviderConfigs,
  TaskModelRoutingConfig,
} from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"

export type LlmTaskKind = "chat" | "ingest"

export function resolveProjectLlmConfig(
  globalConfig: LlmConfig,
  _providerConfigs: ProviderConfigs,
  _projectOverride: ProjectLlmOverride,
  _customPresets: CustomLlmPreset[] = [],
): LlmConfig {
  return toCodexOnlyConfig(globalConfig)
}

export function projectLlmProfile(config: LlmConfig): Omit<LlmConfig, "apiKey" | "customHeaders"> {
  // Headers can contain gateway credentials, so keep them in the provider
  // credential record and merge them at runtime just like the API key.
  const { apiKey: _apiKey, customHeaders: _customHeaders, ...profile } = config
  return profile
}

/**
 * Legacy task routing remains persisted for compatibility, but every task
 * uses the current normalized global Codex configuration.
 */
export function resolveTaskLlmConfig(
  _task: LlmTaskKind,
  fallback: LlmConfig,
  _providerConfigs: ProviderConfigs,
  _routing: TaskModelRoutingConfig,
  _projectOverride?: ProjectLlmOverride,
  _customPresets: CustomLlmPreset[] = [],
): LlmConfig {
  return toCodexOnlyConfig(fallback)
}

/** Resolve against one atomic Zustand snapshot for imperative/background code. */
export function getTaskLlmConfig(task: LlmTaskKind, fallback?: LlmConfig): LlmConfig {
  const state = useWikiStore.getState()
  return resolveTaskLlmConfig(
    task,
    fallback ?? state.llmConfig,
    state.providerConfigs,
    state.taskModelRouting,
    state.projectLlmOverride,
    state.customLlmPresets,
  )
}
