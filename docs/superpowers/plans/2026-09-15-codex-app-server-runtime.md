# Codex App Server Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-request `codex exec --ephemeral` processes with one managed Codex App Server that provides subscription login, model discovery, persistent conversations, streaming items, recovery, and exact interruption.

**Architecture:** Tauri owns one stdio App Server child and exposes a small typed command surface to React. Each Mangosteen conversation maps to one Codex thread; each user request maps to one turn. Existing LLM Wiki MCP/API tools remain the data plane, with the recursive `llm_wiki_chat` tool excluded from the internal Codex configuration.

**Tech Stack:** Rust, Tokio, Serde JSON, Tauri events/commands, React, TypeScript, Codex App Server JSON-RPC over stdio

**Spec:** `docs/superpowers/specs/2026-09-15-mangosteen-agent-turn-runtime-design.md`

## Global Constraints

- Launch `codex app-server --listen stdio://`; do not use experimental WebSocket transport.
- One managed child process per desktop app.
- Kill the child and active turns when the app exits.
- Do not expose `llm_wiki_chat` to the internal Codex process.
- Keep Codex shell access read-only; writes to the knowledge base use validated local tools.
- A completed turn without non-empty text or a confirmed artifact is failure.
- Do not add a JSON-RPC dependency; newline JSON plus Tokio channels is sufficient.

---

### Task 1: Typed protocol envelope and reducer

**Files:**
- Create: `src-tauri/src/commands/codex_app_server_protocol.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Test: unit tests in `codex_app_server_protocol.rs`

**Interfaces:**
- Produces: `RpcRequest`, `RpcResponse`, `ServerMessage`, `CodexTurnSnapshot`, `apply_notification(snapshot, message)`

- [ ] **Step 1: Write failing parser and reducer tests**

Cover response/request ID matching, `turn/started`, agent message deltas, `item/completed`, `turn/completed`, and an unknown future notification that must be ignored rather than crash.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server_protocol --lib`

Expected: module or types do not exist.

- [ ] **Step 3: Implement only the stable envelope fields**

```rust
#[derive(Debug, Serialize)]
pub struct RpcRequest<'a> {
    pub method: &'a str,
    pub id: u64,
    pub params: Value,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum ServerMessage {
    Response { id: u64, result: Option<Value>, error: Option<Value> },
    Notification { method: String, params: Value },
    Request { method: String, id: u64, params: Value },
}
```

Keep unknown item payloads as `serde_json::Value`; do not mirror the complete upstream schema.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server_protocol --lib`

Expected: all protocol tests pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src-tauri/src/commands/codex_app_server_protocol.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add Codex App Server protocol core"
```

### Task 2: Managed stdio process

**Files:**
- Create: `src-tauri/src/commands/codex_app_server.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `codex_app_server.rs`

**Interfaces:**
- Consumes: protocol types from Task 1; existing `find_codex_command` and Windows console suppression helpers from `codex_cli.rs`
- Produces: `CodexAppServerState::request(method, params)`, `ensure_started`, `shutdown`

- [ ] **Step 1: Write failing lifecycle tests using a fake JSONL child**

The fake child must answer `initialize`, accept `initialized`, answer two concurrent request IDs out of order, emit a notification, and exit when stdin closes.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server_process --lib`

Expected: App Server manager does not exist.

- [ ] **Step 3: Implement the manager**

Use existing Tokio/Serde dependencies only:

```rust
pub struct CodexAppServerState {
    inner: Mutex<Option<AppServerProcess>>,
    next_id: AtomicU64,
}

struct AppServerProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>,
}
```

Spawn `codex app-server --listen stdio://`, set `.kill_on_drop(true)`, suppress the Windows console, read stdout line by line, route response IDs to `pending`, and emit notifications on one Tauri topic. Initialize with client name `mangosteen` and version from `env!("CARGO_PKG_VERSION")`.

- [ ] **Step 4: Run the lifecycle tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server_process --lib`

Expected: concurrent request pairing, notification forwarding, and shutdown pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src-tauri/src/commands/codex_app_server.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: manage one Codex App Server process"
```

### Task 3: Account and model commands

**Files:**
- Modify: `src-tauri/src/commands/codex_app_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/codex-app-server.ts`
- Test: `src/lib/codex-app-server.test.ts`

**Interfaces:**
- Produces Tauri commands: `codex_account_read`, `codex_login_start`, `codex_models_list`
- Produces frontend types: `CodexAccount`, `CodexModel`, `CodexLoginStart`

- [ ] **Step 1: Write failing frontend mapping tests**

Test ChatGPT logged-out/logged-in account results and model entries with `inputModalities: ["text", "image"]`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/codex-app-server.test.ts`

Expected: adapter module is missing.

- [ ] **Step 3: Add thin RPC commands and frontend wrappers**

Map directly to stable methods:

```text
codex_account_read -> account/read { refreshToken: true }
codex_login_start  -> account/login/start { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "codex" }
codex_models_list  -> model/list { limit: 100, includeHidden: false }
```

Open the returned `authUrl` with the existing Tauri opener. Never accept or persist an API key.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/lib/codex-app-server.test.ts`

Run: `npm run typecheck`

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src-tauri/src/commands/codex_app_server.rs src-tauri/src/lib.rs src/lib/codex-app-server.ts src/lib/codex-app-server.test.ts
git commit -m "feat: expose Codex subscription and model discovery"
```

### Task 4: Conversation and turn commands

**Files:**
- Modify: `src-tauri/src/commands/codex_app_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/codex-app-server.ts`
- Test: Rust unit tests and `src/lib/codex-app-server.test.ts`

**Interfaces:**
- Produces: `codex_thread_start`, `codex_thread_resume`, `codex_turn_start`, `codex_turn_read`, `codex_turn_interrupt`

- [ ] **Step 1: Add failing command-shape tests**

Assert that turn start sends text/local-image inputs, working directory, selected model/effort, read-only sandbox, and the exact Codex thread ID. Assert interrupt includes both thread and turn IDs.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_turn --lib`

Run: `npx vitest run src/lib/codex-app-server.test.ts`

- [ ] **Step 3: Add the stable thread/turn calls**

Use App Server methods `thread/start`, `thread/resume`, `thread/read`, `turn/start`, and `turn/interrupt`. Turn inputs use only documented `text` and `localImage` shapes. Set `approvalPolicy: "never"` and a read-only sandbox for chat; mutations are available only through validated MCP tools.

- [ ] **Step 4: Run targeted tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_turn --lib`

Run: `npx vitest run src/lib/codex-app-server.test.ts`

Expected: command shapes and response parsing pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src-tauri/src/commands/codex_app_server.rs src-tauri/src/lib.rs src/lib/codex-app-server.ts src/lib/codex-app-server.test.ts
git commit -m "feat: drive Codex threads and turns"
```

### Task 5: Register safe Mangosteen tools

**Files:**
- Modify: `mcp-server/src/index.ts`
- Modify: `mcp-server/src/api-client.ts`
- Modify: `src-tauri/src/api_server.rs`
- Modify: `src-tauri/src/commands/codex_app_server.rs`
- Test: `mcp-server/test/api-client.test.ts`
- Test: Rust API server tests

**Interfaces:**
- Produces MCP tools: `llm_wiki_web_search`, `llm_wiki_import_source`, `llm_wiki_save_page`
- Internal Codex tool list excludes `llm_wiki_chat`

- [ ] **Step 1: Add failing API/MCP contract tests**

Cover a web search response with clickable URL fields, import of one explicit absolute file path, safe save under `wiki/`, path traversal rejection, and absence of `llm_wiki_chat` from the internal tool list.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run mcp:test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml api_server --lib`

- [ ] **Step 3: Add only the three missing tool endpoints**

Reuse existing local search, `fs::read_file`/ingest queue, and Wiki persist helpers. Do not duplicate parsing, search engines, or page validation. Register the MCP server for App Server with only the safe tool names; never expose `llm_wiki_chat` to the internal process.

- [ ] **Step 4: Run API/MCP tests**

Run: `npm run mcp:test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml api_server --lib`

Expected: new tools work and unsafe paths are rejected.

- [ ] **Step 5: Commit only this task**

```powershell
git add mcp-server/src/index.ts mcp-server/src/api-client.ts mcp-server/test/api-client.test.ts src-tauri/src/api_server.rs src-tauri/src/commands/codex_app_server.rs
git commit -m "feat: expose safe Mangosteen tools to Codex"
```

### Task 6: Replace chat transport and persist thread mapping

**Files:**
- Modify: `src/components/chat/chat-panel.tsx`
- Modify: `src/stores/chat-store.ts`
- Modify: `src/lib/chat-agent-types.ts`
- Modify: `src/lib/project-store.ts`
- Test: `src/stores/chat-store.test.ts`
- Test: `src/lib/chat-stream-status.test.ts`

**Interfaces:**
- Consumes: turn commands and App Server notifications
- Produces: `conversationId -> codexThreadId`; per-turn UI state keyed by `conversationId + turnId`

- [ ] **Step 1: Add failing reducer tests**

Cover switching away during a turn, replay after return, duplicate notification IDs, late events from an old turn, exact interruption, and completed-with-empty-answer failure.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts`

- [ ] **Step 3: Consume App Server events as the only chat stream**

Persist the Codex thread ID with the conversation. Keep one `TurnUiState` per active turn, merge agent deltas by item ID, and finalize only on `turn/completed` after the final agent message is non-empty. Page unmount removes listeners only; it never calls interrupt.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts`

Run: `npm run typecheck`

Expected: reducer tests and typecheck pass.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/components/chat/chat-panel.tsx src/stores/chat-store.ts src/lib/chat-agent-types.ts src/lib/project-store.ts src/stores/chat-store.test.ts src/lib/chat-stream-status.test.ts
git commit -m "feat: render Codex App Server turns in chat"
```

### Task 7: Route background model work through hidden Codex threads

**Files:**
- Modify: `src/lib/llm-client.ts`
- Modify: `src/lib/codex-cli-transport.ts`
- Modify: background callers found by `rg -n "streamChat\\(" src`
- Test: `src/lib/codex-cli-transport.test.ts`
- Test: existing ingest, caption, research, and sweep tests

**Interfaces:**
- Consumes: App Server turn wrapper
- Produces: all non-chat `streamChat` callers use a short-lived hidden Codex thread

- [ ] **Step 1: Add failing transport tests**

Assert one hidden thread is created, one turn runs, image input is preserved, and the final agent message is returned. Assert no `codex_cli_spawn`/`codex exec` call occurs.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/lib/codex-cli-transport.test.ts`

- [ ] **Step 3: Replace the subprocess transport**

Keep the existing `streamChat` signature so ingest, DeepSearch, captions, dedup, merge, review, and summaries require no architectural rewrite. Inside `streamViaCodexCli`, call the App Server wrapper, forward agent-message deltas to `onToken`, and interrupt the exact turn when the AbortSignal fires.

- [ ] **Step 4: Run focused background tests**

Run: `npx vitest run src/lib/codex-cli-transport.test.ts src/lib/ingest.scenarios.test.ts src/lib/image-caption-pipeline.test.ts src/lib/deep-research.test.ts src/lib/sweep-reviews.test.ts`

Expected: all model-backed workflows pass through the App Server mock.

- [ ] **Step 5: Commit only this task**

```powershell
git add src/lib/llm-client.ts src/lib/codex-cli-transport.ts src/lib/codex-cli-transport.test.ts
git commit -m "feat: run background AI work through Codex App Server"
```

### Task 8: Settings, shutdown, and end-to-end verification

**Files:**
- Modify: `src/components/settings/sections/llm-provider-section.tsx`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tray.rs`
- Test: relevant frontend and Rust tests

**Interfaces:**
- Consumes: account/model commands and App Server state
- Produces: login/model UI and guaranteed child cleanup

- [ ] **Step 1: Add failing UI and shutdown tests**

Test logged-out, login-pending, logged-in, rate-limited, CLI-missing, unsupported-version, and app-exit child cleanup states.

- [ ] **Step 2: Run targeted tests and confirm they fail**

Run: `npx vitest run src/components/settings/model-hub-utils.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_app_server_shutdown --lib`

- [ ] **Step 3: Connect the Codex card and shutdown hooks**

Render account status, login button, dynamic model selector, effort selector, and input modality badge. On `RunEvent::Exit`, call App Server shutdown before the process exits. Closing the main window keeps the existing user-selected close behavior; a real app exit always kills the child.

- [ ] **Step 4: Run all automated checks**

Run: `npm run test:mocks`

Run: `npm run mcp:test`

Run: `npm run build`

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`

Expected: every command exits 0.

- [ ] **Step 5: Run the Windows desktop acceptance flow**

Test login, one knowledge-only chat, one web chat, one image question, one PDF import, switching pages during a turn, stopping a turn, and exiting the app. Confirm exactly one App Server child exists while open and no `codex`, Node MCP, or search child remains after exit.

- [ ] **Step 6: Commit verification fixes only**

```powershell
git status --short
```

Expected: no files introduced by this plan remain uncommitted.
