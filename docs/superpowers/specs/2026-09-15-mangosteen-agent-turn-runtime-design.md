# 山竹智能体 Codex CLI 单引擎架构设计

## 目标

山竹只支持 Codex CLI。聊天、知识库整理、DeepSearch 总结、图片理解、页面生成、去重与后台维护等所有需要大模型的任务，统一由本机 Codex CLI 的订阅登录驱动，不再要求用户填写 OpenAI API Key，也不再向用户提供 Claude、第三方 API 或本地模型入口。

底层采用 `codex app-server`，而不是为每次请求启动一次 `codex exec --ephemeral`。App Server 是山竹的唯一模型运行引擎；山竹现有 Wiki、RAG、图谱、本机网页搜索与文件导入继续保留，作为 Codex 可调用的本地工具。

## 用户可见结果

- 设置页只显示“Codex”，自动检测本机 CLI、登录状态、订阅类型、可用模型、推理强度和是否支持图片。
- 未登录时点击一次“登录 Codex”，在浏览器完成 ChatGPT 登录；不显示 API Key 输入框。
- 所有 AI 功能使用同一份 Codex 登录和模型选择，不再出现“聊天能用，但 DeepSearch 又索要 API Key”。
- AI 工作时允许切换 Wiki、设置、对话或项目；返回后继续显示真实进度和最终回答。
- 关闭山竹即终止 App Server 与本轮任务，不在后台残留黑框或进程。

## 产品边界

“全部走 Codex CLI”指所有模型推理都走 Codex；不表示放弃山竹自己的资料能力。

- 知识库检索继续使用山竹的 Wiki/RAG/图谱。
- 联网搜索继续使用山竹内置的本机 SearXNG 与国内搜索源，默认开启且普通用户不见配置。
- Codex 自带网页搜索不是默认依赖，避免不同订阅、地区和版本造成搜索体验漂移。
- AnyTXT、MinerU 等高级能力不作为普通入口；已有数据与旧配置不删除。
- 旧模型配置保留在本地状态中但不再生效，便于回滚和迁移，避免升级时破坏用户数据。

## 核心运行方式

### 一个后台进程

Tauri 启动并持有一个 `codex app-server --listen stdio://` 子进程，通过 JSONL/JSON-RPC 通信。前端不直接启动 Codex 进程。

首版使用稳定的 stdio 传输，不使用官方仍标记为实验性的 WebSocket、远程主机、动态工具、多智能体或实时语音接口。

### Thread、Turn、Item

- 山竹的一段对话对应一个 Codex Thread，并保存 `conversationId -> codexThreadId` 映射。
- 用户的一次请求对应一个 Codex Turn。
- 模型消息、知识库搜索、网页搜索、文件读取、保存页面等操作对应 Codex Item。
- App Server 的 `thread/*`、`turn/*` 与 `item/*` 通知是运行状态的唯一真相；前端只订阅和展示。

同一 Thread 首版只允许一个活动 Turn。不同对话可独立运行，但第一版可先限制全局并发为 1，等真实使用证明需要并发后再放开。

### 登录和模型

- 启动后调用 `account/read` 获取登录状态。
- 未登录时调用 `account/login/start`，优先使用 ChatGPT 浏览器登录；回调不稳定时使用 device-code 流程。
- 监听 `account/login/completed` 与 `account/updated` 更新界面。
- 调用 `model/list` 获取真实可用模型、默认推理强度与 `inputModalities`，不再维护硬编码模型列表。
- 默认选择 App Server 返回的 `isDefault` 模型；用户选择只保存模型 ID 和推理强度。

## 山竹本地工具

复用现有 `mcp-server` 与本地 API，不再新造第二套工具协议。

允许 Codex 使用的工具：

- `llm_wiki_files`
- `llm_wiki_read_file`
- `llm_wiki_search`
- `llm_wiki_graph`
- `llm_wiki_reviews`
- `llm_wiki_rescan_sources`
- `llm_wiki_embed_page`
- 新增最小工具：本机网页搜索、导入用户明确指定的文件、保存 Wiki 页面

`llm_wiki_chat` 不提供给山竹内部 Codex。否则会形成“Codex 调山竹 Agent，山竹 Agent 再调 Codex”的递归链路。

工具仍由山竹校验项目边界、路径、写入权限和取消状态。普通聊天的 Codex 沙箱默认为只读；写知识库必须走受控工具，不能让模型任意修改电脑文件。

## 意图与搜索规则

- “我的产品、我的资料、根据知识库、根据之前保存的内容”：先搜索 Wiki、原始资料和图谱，不自动查通用网页。
- “最新、新闻、市场、竞品、网上、联网”：调用本机网页搜索。
- “结合我的资料和市场”：并行使用本地资料与网页，并在引用中区分来源类型。
- 用户给出明确本机文件路径并要求保存：直接调用文件导入工具，不把整句提示词拿去网页搜索。
- 本地证据不足时，先说明缺少什么；不能用搜索到的通用教程假装成用户自己的产品资料。

## 所有 AI 任务的统一入口

以下调用必须进入同一个 Codex App Server 客户端，不得直接调用 HTTP 模型接口：

- 聊天与 Agent 回答
- PDF/Word/网页入库后的分析、摘要与 Wiki 页面生成
- 图片描述与视觉理解
- DeepSearch 的关键词扩展、资料筛选与最终综合
- 页面合并、去重、Review 修复、标题和市场摘要

后台批处理使用独立的隐藏 Thread，避免污染用户聊天上下文；任务完成后只保存产物与必要日志，不向用户展示内部 Thread。

## 进度和最终结果

界面用真实事件映射人性化提示：

- Turn 已接收：`收到啦～`
- 知识库/资料检索：`我看看你的资料嗷～`
- 网页检索：`我去看看网页信息～`
- 模型生成：`正在整理重点～`
- 已收到正文增量：`快完成啦～`

提示词从预设词条轮换，不能让模型随机编造未发生的操作。

Turn 只有在以下任一条件满足时才能标记成功：

- 有非空最终正文；
- 用户要求生成文件，且后台确认目标文件存在并可读取。

`completed` 但没有正文或产物时自动重试一次最终整理；仍为空则显示明确失败，不创建空白 assistant 消息。引用不是最终回答。

## 中断、切页与关闭

- 切换页面只取消当前页面订阅，不中断 Turn。
- 返回对话时使用 Thread/Turn 读取接口补齐状态与历史 Item。
- 停止按钮必须携带准确 `threadId + turnId`，调用 `turn/interrupt`；旧按钮不能误停新任务。
- 项目切换后，旧 Turn 仍绑定旧项目，任何工具写入都再次校验项目和取消状态。
- 应用退出时终止 App Server 子进程；下次启动把未完成任务显示为“已中断”，不自动续跑。

## 安装与升级

开发阶段先使用系统已安装的 Codex CLI。发布安装包时优先内置一个经过验证的 Codex CLI sidecar，并保留系统 CLI 作为回退；用户不需要打开终端。

每次启动检查版本与 App Server 协议能力。模型列表与生成的协议 Schema 必须来自当前实际运行的 Codex 版本，不能假设所有版本字段一致。版本不兼容时阻止开始任务，并给出“更新山竹/更新 Codex”按钮，不回退到其他模型。

## 分阶段实施

### 第一阶段：锁死 Codex 单引擎

- 全局、项目、聊天、入库、图片和后台任务全部强制解析为 `codex-cli`。
- 设置页只保留 Codex 自动检测、登录提示、模型、推理强度、隔离和超时。
- 删除任务模型分流和项目模型覆盖的用户入口。
- 移除 Codex 的前端二次生成；保留第一次后端 Agent 的完整回答作为唯一结果。
- 禁止空正文成功落盘。

### 第二阶段：接入 App Server

- 新增一个 Tauri App Server 管理器，负责启动、初始化、请求配对、通知分发和退出清理。
- 用 `account/read`、`account/login/start`、`model/list` 替换硬编码检测与模型列表。
- 用 Thread/Turn/Item 替换 `codex exec --ephemeral`。
- 将山竹 MCP 只读/受控写工具注册给 Codex，并排除 `llm_wiki_chat`。
- 前端按 `conversationId + turnId` 保存流式状态，支持切页恢复和精确中断。

### 第三阶段：发布体验

- 安装包内置经过验证的 Codex CLI sidecar。
- 完成首次启动登录引导、版本升级提示和无终端进程管理。
- 做真实 Windows 安装机端到端测试。

## 验收标准

1. 设置中只有 Codex，不存在其他模型或 API Key 入口。
2. 任意 AI 功能都不会向 OpenAI API、Claude、第三方模型或 Ollama 直接发请求。
3. ChatGPT 订阅登录成功后，聊天、入库、DeepSearch 和识图使用同一账户。
4. 一次提问只有一个 Codex Turn 和一份最终回答。
5. “根据我的产品写介绍”只查本地资料；没有资料时不搜索通用产品写作网页。
6. 明确要求联网时使用山竹本机搜索，显示约 10–20 个去重来源且外链可点击。
7. 输入明确 PDF 路径并要求保存时走文件导入，不把路径和指令拿去网页搜索。
8. 切到 Wiki/设置/其他对话后任务继续；返回后进度、引用和正文完整。
9. 空正文加引用不能成为成功消息。
10. 关闭山竹后 App Server 和关联任务进程全部退出。

## 来源与许可

架构使用 OpenAI 官方 `codex app-server` 公共协议与实现。山竹只编写协议客户端和产品适配，不复制完整 Codex 源码。若后续复制 Apache-2.0 代码片段，必须保留对应 LICENSE/NOTICE 并更新 `THIRD_PARTY_NOTICES.md`。
