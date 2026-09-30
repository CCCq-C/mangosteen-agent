import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, XCircle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore, type LlmConfig, type ProviderOverride, type ReasoningConfig, type ReasoningMode } from "@/stores/wiki-store"
import { availableLlmPresets, findLlmPreset, type LlmPreset } from "../llm-presets"
import { ContextSizeSelector } from "../context-size-selector"
import { disabledLlmConfig, resolveConfig } from "../preset-resolver"
import { normalizeEndpoint } from "@/lib/endpoint-normalizer"
import { AZURE_OPENAI_API_VERSION } from "@/lib/azure-openai"
import { testLlmConnection, testLlmFunction, type ProviderTestResult } from "@/lib/connection-tests"
import { resolveProjectLlmConfig } from "@/lib/llm-task-routing"
import { normalizeReasoningForProvider, resolveReasoningCapabilities } from "@/lib/reasoning-capabilities"
import {
  connectionTestErrorField,
  codexOnlyPresets,
} from "../model-hub-utils"

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

type ProviderTestState =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "done"; result: ProviderTestResult }

export function llmHeadersToText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`).join("\n")
}

export function parseLlmHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    const name = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (HTTP_HEADER_NAME_RE.test(name) && value && !/[\r\n]/.test(value)) headers[name] = value
  }
  return headers
}

export function LlmProviderSection() {
  const { t } = useTranslation()
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const setProviderConfigs = useWikiStore((s) => s.setProviderConfigs)
  const customLlmPresets = useWikiStore((s) => s.customLlmPresets)
  const activePresetId = useWikiStore((s) => s.activePresetId)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const globalLlmConfig = useWikiStore((s) => s.globalLlmConfig)
  const setGlobalLlmConfig = useWikiStore((s) => s.setGlobalLlmConfig)
  const projectLlmOverride = useWikiStore((s) => s.projectLlmOverride)

  const [lastTestByPreset, setLastTestByPreset] = useState<Record<string, ProviderTestState>>({})
  const codexPreset = codexOnlyPresets(availableLlmPresets([]))[0]!

  async function persist(newConfigs: typeof providerConfigs, newActive: string | null) {
    const { saveProviderConfigs, saveActivePresetId, saveLlmConfig } = await import(
      "@/lib/project-store"
    )
    await saveProviderConfigs(newConfigs)
    await saveActivePresetId(newActive)
    if (newActive) {
      const preset = findLlmPreset(newActive, customLlmPresets)
      if (preset) {
        const resolved = resolveConfig(preset, newConfigs[newActive], globalLlmConfig)
        setGlobalLlmConfig(resolved)
        setLlmConfig(resolveProjectLlmConfig(resolved, newConfigs, projectLlmOverride, customLlmPresets))
        await saveLlmConfig(resolved)
      }
    } else {
      // All presets disabled: write llmConfig into a state where hasUsableLlm()
      // returns false so ingest, dedup, and sweep queues pause immediately.
      // Clearing provider to "openai" (a keyed provider) + empty apiKey covers
      // the case where the previous provider was a keyless local CLI.
      // resolveConfig() on re-enable reads from providerConfigs[], not llmConfig,
      // so the cleared values here do not affect the user's saved settings.
      const cleared = disabledLlmConfig(globalLlmConfig)
      setGlobalLlmConfig(cleared)
      setLlmConfig(resolveProjectLlmConfig(cleared, newConfigs, projectLlmOverride, customLlmPresets))
      await saveLlmConfig(cleared)
    }
  }

  function updateOverride(id: string, patch: ProviderOverride) {
    const currentConfigs = useWikiStore.getState().providerConfigs
    const merged: ProviderOverride = { ...(currentConfigs[id] ?? {}), ...patch }
    const next = { ...currentConfigs, [id]: merged }
    setProviderConfigs(next)
    persist(next, activePresetId).catch(() => {})
    // If this preset is active, refresh the resolved LlmConfig live.
    if (id === activePresetId) {
      const preset = findLlmPreset(id, customLlmPresets)
      if (preset) {
        const resolved = resolveConfig(preset, merged, globalLlmConfig)
        setGlobalLlmConfig(resolved)
        setLlmConfig(resolveProjectLlmConfig(resolved, next, projectLlmOverride, customLlmPresets))
      }
    }
  }

  function updateProviderTest(id: string, state: ProviderTestState) {
    setLastTestByPreset((current) => ({ ...current, [id]: state }))
  }

  function renderPreset(preset: LlmPreset) {
    return (
      <PresetRow
        key={preset.id}
        preset={preset}
        override={providerConfigs[preset.id]}
        latestTest={lastTestByPreset[preset.id]}
        onTestState={(state) => updateProviderTest(preset.id, state)}
        onChange={(patch) => updateOverride(preset.id, patch)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold">{t("settings.sections.llm.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.sections.llm.description")}</p>
      </header>
      {renderPreset(codexPreset)}
    </div>
  )
}

interface PresetRowProps {
  preset: LlmPreset
  override: ProviderOverride | undefined
  latestTest: ProviderTestState | undefined
  onTestState: (state: ProviderTestState) => void
  onChange: (patch: ProviderOverride) => void
}

function PresetRow({
  preset,
  override,
  latestTest,
  onTestState,
  onChange,
}: PresetRowProps) {
  const { t } = useTranslation()
  const ov = override ?? {}
  const model = ov.model ?? preset.defaultModel ?? ""
  const apiKey = ov.apiKey ?? ""
  const apiMode = ov.apiMode ?? preset.apiMode ?? "chat_completions"
  const baseUrl = ov.baseUrl ?? preset.baseUrl ?? ""
  const azureApiVersion = ov.azureApiVersion ?? preset.azureApiVersion ?? AZURE_OPENAI_API_VERSION
  const azureModelFamily = ov.azureModelFamily ?? preset.azureModelFamily ?? "auto"
  const context = ov.maxContextSize ?? preset.suggestedContextSize ?? 131072
  const reasoning = ov.reasoning ?? { mode: "auto" as const }
  // "off" by default: what ingest hardcoded before it was settable.
  const ingestReasoning = ov.ingestReasoning ?? { mode: "off" as const }
  const localCliIsolation = ov.localCliIsolation === true
  const codexCliTimeoutMinutes = Math.max(1, Math.min(240, ov.codexCliTimeoutMinutes ?? 10))
  const requestTimeoutMinutes = Math.max(1, Math.min(1440, ov.requestTimeoutMinutes ?? 30))
  const streamingEnabled = ov.streamingEnabled !== false
  const [headersText, setHeadersText] = useState(() => llmHeadersToText(ov.customHeaders))
  const isLocalCliProvider = preset.provider === "claude-code" || preset.provider === "codex-cli"
  // Local CLI providers authenticate via their own existing login state
  // (inherited by the spawned subprocess), so no API key field is shown.
  // Ollama ditto for its local-only model.
  const needsApiKey =
    preset.provider !== "ollama" &&
    preset.provider !== "claude-code" &&
    preset.provider !== "codex-cli"

  const resolvedConfig = useMemo(
    () => resolveConfig(preset, ov, useWikiStore.getState().globalLlmConfig),
    [apiKey, apiMode, azureApiVersion, azureModelFamily, baseUrl, context, model, preset, reasoning, ov],
  )
  const testErrorField = latestTest?.kind === "done" && !latestTest.result.ok
    ? connectionTestErrorField(latestTest.result.message)
    : null
  const testErrorMessage = testErrorField === "model"
    ? t("settings.sections.llm.validation.model", "请先填写模型名称，再测试连接。")
    : testErrorField === "apiKey"
      ? t("settings.sections.llm.validation.apiKey", "请先填写 API Key，再测试连接。")
      : testErrorField === "endpoint"
        ? t("settings.sections.llm.validation.endpoint", "请先填写服务地址，再测试连接。")
        : undefined

  async function runProviderTest(kind: "connection" | "function") {
    const running: ProviderTestState = {
      kind: "running",
      label: kind === "connection"
        ? t("settings.sections.llm.testingConnection")
        : t("settings.sections.llm.testingFunction"),
    }
    onTestState(running)
    const result = kind === "connection"
      ? await testLlmConnection(resolvedConfig)
      : await testLlmFunction(resolvedConfig)
    const done: ProviderTestState = { kind: "done", result }
    onTestState(done)
  }

  const testControls = (
    <div className="space-y-2 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{t("settings.sections.llm.providerTests")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.sections.llm.providerTestsHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runProviderTest("connection")}
          disabled={(latestTest?.kind ?? "idle") === "running"}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("settings.sections.llm.testConnection")}
        </button>
        <button
          type="button"
          onClick={() => void runProviderTest("function")}
          disabled={(latestTest?.kind ?? "idle") === "running"}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("settings.sections.llm.testFunction")}
        </button>
      </div>
      {latestTest?.kind === "running" && <p className="text-xs text-muted-foreground">{latestTest.label}</p>}
      {latestTest?.kind === "done" && (
        <div className={`rounded-md border px-3 py-2 text-xs ${latestTest.result.ok ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
          {latestTest.result.message}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
          {preset.provider === "custom" && (
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.apiMode")}</Label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "chat_completions", labelKey: "settings.sections.llm.wireOpenAi" },
                    { value: "anthropic_messages", labelKey: "settings.sections.llm.wireAnthropic" },
                  ] as const
                ).map((m) => {
                  const active = apiMode === m.value
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => {
                        // When a preset declares different base URLs for
                        // each wire (e.g. Bailian Coding Plan: /v1 for
                        // OpenAI, /apps/anthropic for Anthropic), flip
                        // the URL alongside the mode so users don't have
                        // to know both URLs or edit manually.
                        const patch: ProviderOverride = { apiMode: m.value }
                        const nextBaseUrl = preset.baseUrlByMode?.[m.value]
                        if (nextBaseUrl) patch.baseUrl = nextBaseUrl
                        onChange(patch)
                      }}
                      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {t(m.labelKey)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {(preset.provider === "custom" || preset.provider === "ollama" || preset.provider === "azure") && (
            <EndpointField
              value={baseUrl}
              mode={preset.provider === "azure" ? "azure" : apiMode}
              placeholder={preset.baseUrl ?? "https://your-api.example.com/v1"}
              onChange={(v) => onChange({ baseUrl: v })}
              error={testErrorField === "endpoint" ? testErrorMessage : undefined}
            />
          )}

          {preset.provider === "azure" && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("settings.sections.llm.azureApiVersion")}</Label>
                <Input
                  value={azureApiVersion}
                  onChange={(e) => onChange({ azureApiVersion: e.target.value })}
                  placeholder="2024-10-21"
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.azureApiVersionHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.sections.llm.azureModelFamily")}</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={azureModelFamily}
                  onChange={(e) => onChange({ azureModelFamily: e.target.value as typeof azureModelFamily })}
                >
                  <option value="auto">{t("settings.sections.llm.azureModelFamilyAuto")}</option>
                  <option value="gpt5">{t("settings.sections.llm.azureModelFamilyGpt5")}</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.azureModelFamilyHint")}
                </p>
              </div>
            </div>
          )}

          {preset.provider === "claude-code" && <ClaudeCliStatusPill />}
          {preset.provider === "codex-cli" && <CodexCliStatusPill />}

          {isLocalCliProvider && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("settings.sections.llm.advancedCli", "CLI 高级设置")}
              </summary>
              <div className="mt-3 space-y-4">
          {isLocalCliProvider && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {t("settings.sections.llm.localCliIsolation")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.sections.llm.localCliIsolationHint")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange({ localCliIsolation: !localCliIsolation })}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    localCliIsolation
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                  }`}
                  title={
                    localCliIsolation
                      ? t("settings.sections.llm.localCliIsolationOn")
                      : t("settings.sections.llm.localCliIsolationOff")
                  }
                  aria-label={t("settings.sections.llm.localCliIsolation")}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                      localCliIsolation ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                {localCliIsolation
                  ? t("settings.sections.llm.localCliIsolationOn")
                  : t("settings.sections.llm.localCliIsolationOff")}
              </div>
            </div>
          )}

          {preset.provider === "codex-cli" && (
            <div className="space-y-2 rounded-md border p-3">
              <Label>{t("settings.sections.llm.codexCliTimeout")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={240}
                  className="w-28"
                  value={codexCliTimeoutMinutes}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    onChange({
                      codexCliTimeoutMinutes: Number.isFinite(n)
                        ? Math.max(1, Math.min(240, Math.floor(n)))
                        : undefined,
                    })
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.codexCliTimeoutUnit")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.codexCliTimeoutHint")}
              </p>
            </div>
          )}
              </div>
            </details>
          )}

          {needsApiKey && (
            <div className="space-y-2">
              <Label>{t("settings.apiKey")}</Label>
              <Input
                type="password"
                value={apiKey}
                aria-invalid={testErrorField === "apiKey"}
                onChange={(e) => onChange({ apiKey: e.target.value })}
                placeholder={
                  preset.provider === "custom"
                    ? t("settings.sections.llm.apiKeyPlaceholderCustom")
                    : t("settings.sections.llm.apiKeyPlaceholder")
                }
              />
              {testErrorField === "apiKey" && <p className="text-xs text-destructive">{testErrorMessage}</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {preset.provider === "azure"
                ? t("settings.sections.llm.deploymentName", "部署名称")
                : t("settings.model")}
            </Label>
            <ModelPicker
              value={model}
              suggestions={preset.suggestedModels ?? []}
              placeholder={preset.defaultModel ?? "e.g. gpt-4o"}
              onChange={(v) => onChange({ model: v })}
              error={testErrorField === "model" ? testErrorMessage : undefined}
            />
          </div>

          {testControls}

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("settings.sections.llm.advancedSettings", "高级设置")}
            </summary>
            <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <Label>{t("settings.sections.llm.contextWindow")}</Label>
            <ContextSizeSelector
              value={context}
              onChange={(v) => onChange({ maxContextSize: v })}
            />
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {t("settings.sections.llm.streamingOutput")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.sections.llm.streamingOutputHint")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={streamingEnabled}
                onClick={() => onChange({ streamingEnabled: !streamingEnabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                  streamingEnabled
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
                }`}
                title={streamingEnabled
                  ? t("settings.sections.llm.streamingOutputOn")
                  : t("settings.sections.llm.streamingOutputOff")}
                aria-label={t("settings.sections.llm.streamingOutput")}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                    streamingEnabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
              {streamingEnabled
                ? t("settings.sections.llm.streamingOutputOn")
                : t("settings.sections.llm.streamingOutputOff")}
            </div>
          </div>

          {!isLocalCliProvider && (
            <>
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.customHeaders")}</Label>
              <textarea
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                onBlur={() => onChange({ customHeaders: parseLlmHeadersText(headersText) })}
                rows={3}
                spellCheck={false}
                placeholder="X-Tenant-ID: team-a"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.customHeadersHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.sections.llm.requestTimeout", "请求超时时间（分钟）")}</Label>
              <Input
                type="number"
                min={1}
                max={1440}
                value={requestTimeoutMinutes}
                onChange={(e) => onChange({
                  requestTimeoutMinutes: Math.max(1, Math.min(1440, Number(e.target.value) || 30)),
                })}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.requestTimeoutHint", "本地 CPU 模型较慢时可适当调大，默认 30 分钟。")}
              </p>
            </div>
            </>
          )}

          <ReasoningControls
            value={reasoning}
            config={resolvedConfig}
            onChange={(reasoning) => onChange({ reasoning })}
          />

          <ReasoningControls
            value={ingestReasoning}
            config={resolvedConfig}
            onChange={(ingestReasoning) => onChange({ ingestReasoning })}
            title={t("settings.sections.llm.reasoning.ingestTitle")}
            hint={t("settings.sections.llm.reasoning.ingestHint")}
          />
            </div>
          </details>

        </div>
  )
}

function ReasoningControls({
  value,
  config,
  onChange,
  title,
  hint,
}: {
  value: ReasoningConfig
  config: LlmConfig
  onChange: (value: ReasoningConfig) => void
  /** Defaults to the chat reasoning label; the ingest control passes its own. */
  title?: string
  hint?: string
}) {
  const { t } = useTranslation()
  const capabilities = resolveReasoningCapabilities(config)
  const supportedModes = capabilities.modes
  const normalizedValue = normalizeReasoningForProvider(config, value)
  const allModes: { value: ReasoningMode; label: string }[] = [
    { value: "auto", label: t("settings.sections.llm.reasoning.auto") },
    { value: "off", label: t("settings.sections.llm.reasoning.off") },
    { value: "low", label: t("settings.sections.llm.reasoning.low") },
    { value: "medium", label: t("settings.sections.llm.reasoning.medium") },
    { value: "high", label: t("settings.sections.llm.reasoning.high") },
    { value: "max", label: t("settings.sections.llm.reasoning.max") },
    { value: "custom", label: t("settings.sections.llm.reasoning.custom") },
  ]
  const modes = allModes.filter((mode) => supportedModes.includes(mode.value))

  return (
    <div className="space-y-2">
      <Label>{title ?? t("settings.sections.llm.reasoning.title")}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {modes.map((m) => {
          const active = normalizedValue.mode === m.value
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange({ ...value, mode: m.value })}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-accent"
              }`}
            >
              {m.label}
            </button>
          )
        })}
      </div>
      {normalizedValue.mode === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={capabilities.customBudgetRange.min}
            max={capabilities.customBudgetRange.max}
            step={1}
            className="w-28"
            value={value.budgetTokens ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim()
              const n = Number(raw)
              onChange({
                ...value,
                budgetTokens: raw === "" || !Number.isFinite(n)
                  ? undefined
                  : Math.max(
                      capabilities.customBudgetRange.min,
                      Math.min(capabilities.customBudgetRange.max, Math.floor(n)),
                    ),
              })
            }}
            placeholder="1024"
          />
          <span className="text-xs text-muted-foreground">
            {t("settings.sections.llm.reasoning.budgetTokens")}
          </span>
        </div>
      )}
      {!hint && (
        <p className="text-xs text-muted-foreground">
          {t("settings.sections.llm.reasoning.hint")}
        </p>
      )}
    </div>
  )
}

interface EndpointFieldProps {
  value: string
  mode: "chat_completions" | "anthropic_messages" | "azure"
  placeholder: string
  onChange: (value: string) => void
  error?: string
}

/**
 * Endpoint input with live feedback + auto-fix on blur. The hint line
 * below the field tells the user what we'd normalize to (and why) while
 * they're typing; the input doesn't nag — it just shows the preview. On
 * blur, if normalization would change the value, we apply it.
 */
function EndpointField({ value, mode, placeholder, onChange, error }: EndpointFieldProps) {
  const { t } = useTranslation()
  const preview = useMemo(() => normalizeEndpoint(value, mode), [value, mode])

  function handleBlur() {
    if (preview.changed && preview.normalized !== value.trim()) {
      onChange(preview.normalized)
    }
  }

  const showHint = value.trim().length > 0 && (preview.changed || preview.warning)

  return (
    <div className="space-y-1.5">
      <Label>{t("settings.sections.llm.endpoint")}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {showHint && (
        <div
          className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
            preview.changed
              ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
              : "border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400"
          }`}
        >
          {preview.changed ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            {preview.changed && (
              <div>
                {t("settings.sections.llm.endpointPreviewWillUse")}{" "}
                <code className="break-all rounded bg-background/60 px-1 py-0.5 font-mono">
                  {preview.normalized || "(empty)"}
                </code>
                <span className="ml-1 text-muted-foreground">
                  {t("settings.sections.llm.endpointPreviewAutoApply")}
                </span>
              </div>
            )}
            {preview.warning && <div>{preview.warning}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

interface ModelPickerProps {
  value: string
  suggestions: string[]
  placeholder: string
  onChange: (value: string) => void
  error?: string
}

/**
 * Model input with a chip-based suggestion row above it. The input stays
 * free-text so users can always type unlisted models (fine-tunes, preview
 * IDs, local Ollama tags, etc.). Clicking a chip just fills the input.
 *
 * The currently-selected chip (if the value matches one of the suggestions)
 * gets the accent highlight so users can see at a glance which preset
 * model is active without reading the text field. Presets with no
 * `suggestedModels` render the input alone.
 */
function ModelPicker({ value, suggestions, placeholder, onChange, error }: ModelPickerProps) {
  const { t } = useTranslation()
  const hasSuggestions = suggestions.length > 0
  const isCustom = hasSuggestions && value.length > 0 && !suggestions.includes(value)

  return (
    <div className="space-y-2">
      {hasSuggestions && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((m) => {
            const active = m === value
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange(m)}
                className={`rounded-md border px-2 py-0.5 text-xs font-mono transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
                }`}
                title={t("settings.sections.llm.useModel", { model: m })}
              >
                {m}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => onChange("")}
            className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
              isCustom
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
            title={t("settings.sections.llm.typeCustomModel")}
          >
            {isCustom
              ? t("settings.sections.llm.customModelBadge", { model: value })
              : t("settings.sections.llm.customModel")}
          </button>
        </div>
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

interface DetectResult {
  installed: boolean
  version: string | null
  path: string | null
  error: string | null
}

/**
 * Health-check pill for the Claude Code CLI provider. Auto-runs
 * `claude --version` on mount, with a refresh button for when the user
 * just installed the binary and wants to re-check without reopening the
 * panel. The error message comes straight from the Rust side — it
 * already tailors the hint (macOS quarantine, missing binary, etc).
 */
function ClaudeCliStatusPill() {
  const { t } = useTranslation()
  const [state, setState] = useState<"loading" | "ok" | "err">("loading")
  const [result, setResult] = useState<DetectResult | null>(null)

  async function detect() {
    setState("loading")
    try {
      const r = await invoke<DetectResult>("claude_cli_detect")
      setResult(r)
      setState(r.installed ? "ok" : "err")
    } catch (e) {
      setResult({
        installed: false,
        version: null,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      })
      setState("err")
    }
  }

  useEffect(() => {
    void detect()
  }, [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="m-0">{t("settings.sections.llm.cliStatus")}</Label>
        <button
          type="button"
          onClick={() => void detect()}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          disabled={state === "loading"}
        >
          {state === "loading" ? t("settings.sections.llm.checkingCli") : t("settings.sections.llm.recheckCli")}
        </button>
      </div>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          state === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : state === "err"
              ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border bg-background/50 text-muted-foreground"
        }`}
      >
        {state === "loading" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {state === "err" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {state === "loading" && <div>{t("settings.sections.llm.detectingCli", { name: "Claude" })}</div>}
          {state === "ok" && (
            <>
              <div>
                {t("settings.sections.llm.cliDetected", { version: result?.version ? ` ${result.version}` : "", login: t("settings.sections.llm.claudeSubscription") })}
              </div>
              {result?.path && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {result.path}
                </div>
              )}
              {/* `claude --version` doesn't validate OAuth, so even a
                  green pill can hide an expired login. Surface the
                  remediation up front so users don't mis-diagnose
                  the resulting "Unauthenticated" exit-1 as a LLM
                  Wiki bug. */}
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliAuthBefore")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                  claude
                </code>{" "}
                {" "}{t("settings.sections.llm.cliAuthAfter")}
              </div>
            </>
          )}
          {state === "err" && (
            <>
              <div>{result?.error ?? t("settings.sections.llm.cliUnavailable", { name: "Claude" })}</div>
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliInstallBefore")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                  npm i -g @anthropic-ai/claude-code
                </code>{" "}
                {" "}{t("settings.sections.llm.cliInstallAfter")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CodexCliStatusPill() {
  const { t } = useTranslation()
  const [state, setState] = useState<"loading" | "ok" | "err">("loading")
  const [result, setResult] = useState<DetectResult | null>(null)

  async function detect() {
    setState("loading")
    try {
      const r = await invoke<DetectResult>("codex_cli_detect")
      setResult(r)
      setState(r.installed ? "ok" : "err")
    } catch (e) {
      setResult({
        installed: false,
        version: null,
        path: null,
        error: e instanceof Error ? e.message : String(e),
      })
      setState("err")
    }
  }

  useEffect(() => {
    void detect()
  }, [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="m-0">{t("settings.sections.llm.cliStatus")}</Label>
        <button
          type="button"
          onClick={() => void detect()}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          disabled={state === "loading"}
        >
          {state === "loading" ? t("settings.sections.llm.checkingCli") : t("settings.sections.llm.recheckCli")}
        </button>
      </div>
      <div
        className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          state === "ok"
            ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : state === "err"
              ? "border-rose-500/40 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border bg-background/50 text-muted-foreground"
        }`}
      >
        {state === "loading" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
        {state === "ok" && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        {state === "err" && <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <div className="min-w-0 flex-1 space-y-0.5">
          {state === "loading" && <div>{t("settings.sections.llm.detectingCli", { name: "Codex" })}</div>}
          {state === "ok" && (
            <>
              <div>
                {t("settings.sections.llm.cliDetected", { version: result?.version ? ` ${result.version}` : "", login: t("settings.sections.llm.codexLogin") })}
              </div>
              {result?.path && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {result.path}
                </div>
              )}
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliAuthBefore")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                  codex
                </code>{" "}
                {" "}{t("settings.sections.llm.cliAuthAfter")}
              </div>
            </>
          )}
          {state === "err" && (
            <>
              <div>{result?.error ?? t("settings.sections.llm.cliUnavailable", { name: "Codex" })}</div>
              <div className="text-muted-foreground">
                {t("settings.sections.llm.cliInstallBefore")}{" "}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[10px]">
                  npm install -g @openai/codex
                </code>{" "}
                {" "}{t("settings.sections.llm.cliInstallAfter")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
