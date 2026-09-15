# Codex-Only Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every model-backed feature in Mangosteen use Codex CLI and remove all non-Codex model choices from the product UI.

**Architecture:** Add one canonical Codex-only config normalizer at the shared model boundary, then use it during store hydration and Rust backend configuration. Preserve old saved provider records without reading them at runtime. Keep the existing Codex CLI subprocess transport until the App Server plan replaces it.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri 2, Rust, Vitest, Cargo test

**Spec:** `docs/superpowers/specs/2026-09-15-mangosteen-agent-turn-runtime-design.md`

## Global Constraints

- Only `provider: "codex-cli"` may reach a model transport.
- Preserve old provider settings on disk; do not delete user data.
- Keep local Wiki/RAG/graph and SearXNG search behavior unchanged.
- Do not add dependencies.
- One user request produces one final model answer.

---

### Task 1: Canonical Codex-only configuration

**Files:**
- Create: `src/lib/codex-only-config.ts`
- Test: `src/lib/codex-only-config.test.ts`

**Interfaces:**
- Consumes: `LlmConfig` from `src/stores/wiki-store.ts`
- Produces: `CODEX_PRESET_ID`, `DEFAULT_CODEX_MODEL`, `toCodexOnlyConfig(config): LlmConfig`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { toCodexOnlyConfig } from "./codex-only-config"

describe("toCodexOnlyConfig", () => {
  it("replaces every non-Codex provider and model", () => {
    const actual = toCodexOnlyConfig({
      provider: "openai", apiKey: "secret", model: "gpt-4o",
      ollamaUrl: "http://localhost:11434", customEndpoint: "https://example.com/v1",
      maxContextSize: 32000,
    })
    expect(actual.provider).toBe("codex-cli")
    expect(actual.apiKey).toBe("")
    expect(actual.customEndpoint).toBe("")
    expect(actual.model).not.toBe("gpt-4o")
  })

  it("preserves Codex model and local CLI controls", () => {
    const actual = toCodexOnlyConfig({
      provider: "codex-cli", apiKey: "", model: "gpt-5.6-sol",
      ollamaUrl: "", customEndpoint: "", maxContextSize: 200000,
      localCliIsolation: true, codexCliTimeoutMinutes: 20,
    })
    expect(actual.model).toBe("gpt-5.6-sol")
    expect(actual.localCliIsolation).toBe(true)
    expect(actual.codexCliTimeoutMinutes).toBe(20)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/codex-only-config.test.ts`

Expected: FAIL because `codex-only-config.ts` does not exist.

- [ ] **Step 3: Add the minimal normalizer**

```ts
import type { LlmConfig } from "@/stores/wiki-store"

export const CODEX_PRESET_ID = "codex-cli"
export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol"

export function toCodexOnlyConfig(config: LlmConfig): LlmConfig {
  const isCodex = config.provider === "codex-cli"
  return {
    ...config,
    provider: "codex-cli",
    apiKey: "",
    model: isCodex && config.model.trim() ? config.model.trim() : DEFAULT_CODEX_MODEL,
    ollamaUrl: "",
    customEndpoint: "",
    customHeaders: undefined,
    apiMode: undefined,
    localCliIsolation: isCodex ? config.localCliIsolation === true : false,
    codexCliTimeoutMinutes: isCodex ? config.codexCliTimeoutMinutes : 10,
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/codex-only-config.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/lib/codex-only-config.ts src/lib/codex-only-config.test.ts
git commit -m "feat: add Codex-only model policy"
```

### Task 2: Force every frontend model call through Codex

**Files:**
- Modify: `src/lib/llm-client.ts`
- Modify: `src/lib/llm-task-routing.ts`
- Test: `src/lib/llm-task-routing.test.ts`
- Test: `src/lib/codex-cli-transport.test.ts`

**Interfaces:**
- Consumes: `toCodexOnlyConfig(config)` from Task 1
- Produces: `streamChat` always invokes `streamViaCodexCli`; task/project routing always returns Codex

- [ ] **Step 1: Add failing routing tests**

Add assertions that `resolveTaskLlmConfig` and `resolveProjectLlmConfig` return `provider === "codex-cli"` even when the saved active preset, task preset, or project preset is OpenAI, Claude, custom, or Ollama.

```ts
expect(resolveTaskLlmConfig("chat", openAiConfig, configs, routing).provider).toBe("codex-cli")
expect(resolveProjectLlmConfig(openAiConfig, configs, projectOverride).provider).toBe("codex-cli")
```

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `npx vitest run src/lib/llm-task-routing.test.ts src/lib/codex-cli-transport.test.ts`

Expected: routing assertions report a non-Codex provider.

- [ ] **Step 3: Normalize at the shared boundaries**

In `llm-task-routing.ts`, wrap every return from both resolver functions with `toCodexOnlyConfig(...)`.

In `llm-client.ts`, normalize before dispatch and remove the reachable Claude/HTTP branches:

```ts
const codexConfig = toCodexOnlyConfig(config)
return streamViaCodexCli(
  codexConfig,
  messages,
  codexConfig.streamingEnabled === false ? bufferedStreamCallbacks(callbacks) : callbacks,
  signal,
  requestOverrides,
)
```

Leave HTTP provider parsing helpers in place for now because unrelated tests and historical data still import them; they become unreachable product compatibility code.

- [ ] **Step 4: Run the targeted tests**

Run: `npx vitest run src/lib/llm-task-routing.test.ts src/lib/codex-cli-transport.test.ts`

Expected: all targeted tests pass and no Claude/HTTP transport mock is called.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/lib/llm-client.ts src/lib/llm-task-routing.ts src/lib/llm-task-routing.test.ts src/lib/codex-cli-transport.test.ts
git commit -m "feat: route frontend model work to Codex CLI"
```

### Task 3: Normalize startup and Rust Agent configuration

**Files:**
- Modify: `src/stores/wiki-store.ts`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/agent/provider.rs`
- Modify: `src-tauri/src/api_server.rs`
- Test: `src/stores/wiki-store.test.ts`
- Test: Rust tests in the two modified modules

**Interfaces:**
- Consumes: `toCodexOnlyConfig`
- Produces: hydrated frontend state and all backend Agent clients use Codex CLI

- [ ] **Step 1: Add failing tests**

Add a store hydration assertion for the Codex defaults. Add Rust tests that a legacy OpenAI `LlmConfig` is normalized to the Codex client and that API/MCP project chat cannot choose a saved non-Codex provider.

- [ ] **Step 2: Run the targeted tests and confirm they fail**

Run: `npx vitest run src/stores/wiki-store.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_only --lib`

Expected: at least one assertion reports `openai` or constructs the HTTP client.

- [ ] **Step 3: Apply the policy at initialization and backend client creation**

Set both Zustand defaults to Codex. In `App.tsx`, retain loading of old provider records but store a normalized active config and force `activePresetId` to `codex-cli`.

In Rust, add a single method on `LlmConfig`:

```rust
pub fn into_codex_only(mut self) -> Self {
    let was_codex = self.provider == "codex-cli";
    self.provider = "codex-cli".to_string();
    self.api_key.clear();
    self.custom_endpoint.clear();
    if !was_codex || self.model.trim().is_empty() {
        self.model = "gpt-5.6-sol".to_string();
    }
    self
}
```

Call it once before `BackendLlmClient` selects a transport and once when `api_server.rs` resolves persisted project configuration.

- [ ] **Step 4: Run the targeted tests**

Run: `npx vitest run src/stores/wiki-store.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_only --lib`

Expected: frontend and Rust tests pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/stores/wiki-store.ts src/App.tsx src-tauri/src/agent/provider.rs src-tauri/src/api_server.rs src/stores/wiki-store.test.ts
git commit -m "feat: enforce Codex CLI in app and Agent backend"
```

### Task 4: Replace the model hub with one Codex card

**Files:**
- Modify: `src/components/settings/sections/llm-provider-section.tsx`
- Modify: `src/components/settings/llm-presets.ts`
- Modify: `src/components/settings/model-hub-utils.ts`
- Modify: `src/i18n/zh.json`
- Test: `src/components/settings/model-hub-utils.test.ts`
- Test: `src/components/settings/model-profile-catalog.test.tsx`

**Interfaces:**
- Consumes: existing `PresetRow`, `codex_cli_detect`, and Codex override fields
- Produces: one Codex card with auto-detect, model, reasoning, isolation, timeout, and no provider catalog

- [ ] **Step 1: Add failing UI policy tests**

Assert the visible preset helper returns only `codex-cli` and the Codex card remains visible even before configuration.

```ts
expect(codexOnlyPresets(availableLlmPresets([])).map((item) => item.id)).toEqual(["codex-cli"])
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/components/settings/model-hub-utils.test.ts src/components/settings/model-profile-catalog.test.tsx`

Expected: the helper is missing or non-Codex presets remain visible.

- [ ] **Step 3: Render only the existing Codex editor**

Keep `PresetRow` and its current auto-detection logic. Remove the add-model button, catalog dialog, custom profile management, task routing selectors, and project override controls from the returned JSX. Do not delete stored configuration or shared parsing helpers.

Use this visible hierarchy:

```tsx
<div className="space-y-4">
  <header>
    <h2>Codex</h2>
    <p>山竹的所有 AI 功能都使用你的 ChatGPT / Codex 订阅。</p>
  </header>
  {renderPreset(codexPreset, true)}
</div>
```

- [ ] **Step 4: Run UI tests and typecheck**

Run: `npx vitest run src/components/settings/model-hub-utils.test.ts src/components/settings/model-profile-catalog.test.tsx`

Run: `npm run typecheck`

Expected: tests and TypeScript build pass with no unused imports.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/components/settings/sections/llm-provider-section.tsx src/components/settings/llm-presets.ts src/components/settings/model-hub-utils.ts src/components/settings/model-hub-utils.test.ts src/components/settings/model-profile-catalog.test.tsx src/i18n/zh.json
git commit -m "feat: simplify model settings to Codex"
```

### Task 5: Remove duplicate generation and reject empty answers

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`
- Modify: `src/stores/chat-store.ts`
- Test: `src/stores/chat-store.test.ts`
- Test: `src/lib/chat-stream-status.test.ts`

**Interfaces:**
- Consumes: existing `agent_start_turn_stream` terminal response
- Produces: exactly one final assistant message per user turn

- [ ] **Step 1: Add failing regression tests**

Add one test proving empty assistant content is not finalized and one test proving a backend Codex response does not call `streamChat` again.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts`

Expected: empty content is stored or the duplicate-generation assertion fails.

- [ ] **Step 3: Use the backend Agent result as the final result**

Remove the condition that excludes `codex-cli` from the backend stream branch. Delete the second `streamChat` call for Codex. Before `finalizeStream`, validate:

```ts
const finalText = backendResponse.message.content.trim()
if (!finalText) throw new Error("Codex 已完成任务，但没有返回可显示的答案")
finalizeStream(finalText, backendResponse.references, backendResponse.toolEvents)
```

In `chat-store.ts`, make `finalizeStream` return without creating an assistant message when both text and confirmed generated files are empty.

- [ ] **Step 4: Run targeted tests and the production build**

Run: `npx vitest run src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts`

Run: `npm run build`

Expected: tests and build pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/components/chat/chat-panel.tsx src/stores/chat-store.ts src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts
git commit -m "fix: keep one non-empty Codex answer per turn"
```

### Task 6: Cross-feature verification

**Files:**
- Modify only if a test exposes a root-cause defect in files already listed above

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: verified Codex-only milestone

- [ ] **Step 1: Run the complete frontend suite**

Run: `npm run test:mocks`

Expected: all mock tests pass.

- [ ] **Step 2: Run the Rust library suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: all Rust library tests pass.

- [ ] **Step 3: Run production checks**

Run: `npm run build`

Run: `npm run mcp:test`

Expected: both commands exit 0.

- [ ] **Step 4: Run a real desktop smoke test**

Start the desktop app, confirm only Codex appears in settings, then test: one chat answer, one image question, one DeepSearch synthesis, and one PDF import. Watch process/network logs and confirm no HTTP model provider or Claude/Ollama process is used.

- [ ] **Step 5: Commit only verification-related fixes, if any**

```powershell
git status --short
```

Expected: no uncommitted files introduced by this plan remain.
