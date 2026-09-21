# 侧边栏重做（四组 + 归档/删除 + 归档行打开即取消归档） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让侧边栏只列会话（置顶 / 最近 / 历史 / 已归档），未绑定会话的空白面板不再产生任何行；点击已打开的会话聚焦它自己的标签页；用「先归档、再删除」两步提供删除，且打开已归档会话时先取消归档。

**Architecture:** 三处收口：(1) `src/session/openTabs.ts` 只保留能解析出会话 id 的标签并带上标签自己的 resource；(2) `src/session/sessionStore.ts` 按「已归档 → 置顶 → 最近 10 个 → 历史」唯一归位；(3) `src/session/openTarget.ts` + `src/session/rowOpener.ts` 把「读一行 → 判定目标 → 归档行先取消归档 → 打开」做成注入式纯逻辑。`extension.ts` 只接线，失败语义沿用既有 opener（只报错、不回退、不静默）。

**Tech Stack:** TypeScript + esbuild，vitest（`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`）。

**Spec:** `openspec/changes/rework-session-sidebar/design.md`（D33–D48）、`specs/codex-session-sidebar/spec.md`、`test-plan.md`（47 条选择器）、`plan-ready.md`（10 个 task）

## Global Constraints

- 每个 task 先写测试、见过红（`🔴 RED`）再写实现；`test-plan.md` 状态后缀只追加在行尾，选择器一字不改。
- 生产代码不许 import `vscode`（`src/codex/types.ts` 的注释是硬约束）；新依赖一律注入。
- 单文件跑测试用 `npx vitest run <文件>`（`pnpm test -- <名字>` 不过滤，见 archive lessons 坑 3）；单条用例用 `npx vitest run <文件> -t <用例名>`。
- 桩策略：只对**新建**的 4 个测试文件先铺桩（`openTarget`/`rowOpener`/`packageContributes`/`extension`），既有测试文件按 task 逐个追加真断言——这样每个 task 的 RED 都是「断言真的红了」，不会被别的 task 的桩噪声淹没。
- 图标只用已核实存在的 codicon：`$(archive)`、`$(trash)`（`$(unarchive)` 不存在，取消归档放右键菜单不带图标）。

---

### Task 1: 标签扫描丢弃未绑定面板并保留标签 resource

**Files:**
- Modify: `src/codex/types.ts`, `src/session/openTabs.ts`
- Modify: `test/helpers/fakes.ts`, `test/unit/openTabs.test.ts`

**Interfaces:**
- Consumes: `parseConversationId`（`src/codex/conversationUri.ts`）
- Produces: `OpenTab { id: string; tabLabel: string; uri: UriLike }`——Task 2/9 依赖；`makeOpenTab(id: string, tabLabel?: string): OpenTab`（带默认 resource）

- [ ] **Step 1: 写失败测试**：`test/unit/openTabs.test.ts` 把 `keeps_new_panel_tab_with_null_conversation_id` 改写为 `drops_tab_without_conversation_id`（`/extension/panel/new?newPanel=n1` → 结果为空数组），新增 `keeps_each_tab_own_resource`（`/local/conv-1?projectId=p1` 与 `/remote/conv-r` 的 `uri` 原样保留）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/openTabs.test.ts`——期望 `drops_tab_without_conversation_id` 失败（旧实现返回了一条 `{id: null, tabLabel}`）。
- [ ] **Step 3: 实现**：`OpenTab.id: string` + `uri: UriLike`；`scanCodexTabs` 里 `const id = parseConversationId(input.uri); if (!id) continue;` 后 `open.push({ id, tabLabel: tab.label, uri: input.uri })`；`makeOpenTab` 同步收紧。
- [ ] **Step 4: 跑绿**：同命令，4 条全绿。
- [ ] **Step 5: commit**：`git add -A && git commit -m "refactor(session): drop unbound panel tabs and keep each tab resource"`。
- [ ] **Step 6: 记状态**：test-plan 给 T-001/T-002 追加 `🔴 RED ✅ PASS`，plan-ready 勾 Task 1。

### Task 2: 树数据按「置顶 / 最近 / 历史 / 已归档」归位

**Files:**
- Modify: `src/codex/types.ts`, `src/session/sessionStore.ts`, `test/unit/sessionStore.test.ts`

**Interfaces:**
- Consumes: `OpenTab[]`（Task 1）
- Produces: `SessionGroupId = 'pinned' | 'recent' | 'history' | 'archived'`、`SessionItem { …, tabUri: UriLike | null; archived: boolean }`、`RECENT_LIMIT = 10`、`buildSessionGroups({ threads, archivedThreads, openTabs, pinnedIds, runningIds, filter })`

- [ ] **Step 1: 写失败测试**：重写分组用例为 `renders_pinned_recent_history_and_archived_groups`；新增 `open_session_row_lands_in_recent_with_open_mark`、`drops_unbound_new_panel_tab`、`pinned_open_session_keeps_single_pinned_row`、`unpinning_moves_open_session_to_recent`、`drops_open_tab_whose_thread_is_missing`、`recent_group_takes_ten_most_recent_unpinned`、`recent_group_holds_all_when_fewer_than_ten`、`pinned_session_leaves_recent_group`、`recent_and_history_are_disjoint`、`archived_threads_land_in_archived_group_only`（含 `archived` 标记断言）、`pinned_archived_session_still_marked_pinned`；两条不变量 `no_unbound_panel_row_ever_rendered`、`every_thread_renders_exactly_once`（矩阵：未绑定 × 已归档 × 置顶 × 最近）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/sessionStore.test.ts`——期望 `drops_unbound_new_panel_tab`（旧实现造 `open-tab:0`）与 `archived_threads_land_in_archived_group_only`（没有已归档组）失败，且失败信息指向断言而非类型错误。
- [ ] **Step 3: 实现**：`GROUP_LABELS` 四组；`buildSessionGroups` 先 `claimed` 掉已归档 id → 置顶 → 其余按 `updatedAt` 倒序取前 `RECENT_LIMIT` 进 `recent` → 剩下的进 `history`；行上带 `tabUri`（来自对应 `OpenTab.uri`）与 `archived`。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(session): group sessions as pinned/recent/history/archived"`。
- [ ] **Step 6: 记状态**：T-008~T-013、T-020~T-023、T-036、T-037、INV-002、INV-003。

### Task 3: 打开目标判定 + 行打开编排（含「归档行先取消归档」）

**Files:**
- Create: `src/session/openTarget.ts`, `src/session/rowOpener.ts`
- Create: `test/unit/openTarget.test.ts`, `test/unit/rowOpener.test.ts`

**Interfaces:**
- Consumes: `UriLike`（`src/codex/types.ts`）
- Produces: `readSessionRow(node: unknown): SessionRow`、`resolveOpenTarget(row: SessionRow): OpenTarget | null`、`createRowOpener(deps: { unarchive(id): Promise<boolean>; revealTab(uri): Promise<boolean>; openSession(id): Promise<boolean> }): (node: unknown) => Promise<boolean>`——Task 6/10 依赖

- [ ] **Step 1: 写失败测试**：`openTarget.test.ts` 覆盖 T-003/T-004/T-005 与 `every_row_opens_its_own_source`（矩阵：合成 id / 真实 id / 远端 / 带 query）；`rowOpener.test.ts` 覆盖 `archived_row_unarchives_before_opening`（断言调用顺序 `['unarchive','openSession']`）、`opens_even_when_unarchive_fails`、`unarchive_only_for_archived_rows_before_opening`。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/openTarget.test.ts test/unit/rowOpener.test.ts`——文件不存在/模块不存在即红，先补桩再跑，确保最终红来自断言。
- [ ] **Step 3: 实现**：`readSessionRow` 归一 `{sessionId, tabUri, archived}` 与 `{session:{...}}`；`resolveOpenTarget` 有可用 `tabUri` → `{kind:'tab'}`，否则 `sessionId` → `{kind:'conversation'}`，都无 → `null`；`createRowOpener` 先 `unarchive`（归档行）再按 kind 打开，`unarchive` 失败不中断（错误由注入方上报）。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(session): resolve open target per row and unarchive before opening"`。
- [ ] **Step 6: 记状态**：T-003、T-004、T-005、T-040、T-041、INV-001、INV-005。

### Task 4: opener 增加按 resource 聚焦的入口

**Files:**
- Modify: `src/session/opener.ts`, `test/unit/opener.test.ts`

**Interfaces:**
- Produces: `SessionOpener.revealTab(uri: UriLike): Promise<boolean>`

- [ ] **Step 1: 写失败测试**：`reveals_open_tab_with_its_own_resource`（`vscode.openWith` 第一个参数是该 resource，viewType 与 `{preview:false}` 不变）、`shows_error_and_never_creates_new_panel_when_revealing_tab`（失败报错、不调 `chatgpt.newCodexPanel`）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/opener.test.ts`——`revealTab 不是函数` 属导入错误，先补最小桩签名再让红来自断言。
- [ ] **Step 3: 实现**：`revealTab(uri)` 复用 `openWith(uri, CODEX_CONVERSATION_VIEW_TYPE, { preview: false })`；失败 `showErrorMessage('无法打开 Codex 标签页：<原因>')` 并返回 `false`。
- [ ] **Step 4: 跑绿**：同命令（含既有 2 条）。
- [ ] **Step 5: commit**：`git commit -m "feat(session): reveal an already-open tab by its own resource"`。
- [ ] **Step 6: 记状态**：T-006、T-007。

### Task 5: 树条目携带标签 resource、归档标记与归档 contextValue

**Files:**
- Modify: `src/ui/treeProvider.ts`, `test/unit/treeProvider.test.ts`

**Interfaces:**
- Consumes: `SessionItem.tabUri` / `SessionItem.archived`（Task 2）
- Produces: 命令参数 `{ sessionId, label, tabUri, archived }`；已归档条目 `contextValue === 'session.archived'`

- [ ] **Step 1: 写失败测试**：`item_id_carries_group_segment`、`open_session_row_passes_tab_resource`、`archived_row_passes_archived_flag`、`archived_row_uses_archived_context_value`、`running_icon_wins_over_open_icon`、`session_without_cwd_has_empty_description`、`expands_pinned_and_recent_collapses_history_and_archived`。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/treeProvider.test.ts`——`archived_row_uses_archived_context_value` 与 `archived_row_passes_archived_flag` 必红。
- [ ] **Step 3: 实现**：`toItemNode` 里 `groupId === 'archived'` → `contextValue: 'session.archived'`；命令参数补 `tabUri`、`archived`；`defaultCollapsibleState` 保持「只有 history 折叠」→ 改为「history 与 archived 折叠」。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(ui): carry tab resource and archived flag on session rows"`。
- [ ] **Step 6: 记状态**：T-014~T-018、T-038、T-042。

### Task 6: 打开会话的接线与文档

**Files:**
- Modify: `src/extension.ts`, `README.md`
- Create: `test/unit/extension.test.ts`

**Interfaces:**
- Consumes: `createRowOpener`（Task 3）、`opener.revealTab`/`openSession`（Task 4）

- [ ] **Step 1: 写失败测试**：`open_session_command_prefers_the_tab_resource`——`activate()` 后用假 `vscode` 捕获 `codexHelper.openSession` 处理器，传 `{sessionId:'conv-1', tabUri:<带 query 的 resource>}`，断言 `commands.executeCommand` 收到 `('vscode.openWith', <该 resource>, 'chatgpt.conversationEditor', {preview:false})`。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/extension.test.ts`——旧接线会传 `buildConversationUri('conv-1')`（无 query），必红。
- [ ] **Step 3: 实现**：`activate` 里 `const rowOpener = createRowOpener({...})`，`openSession` 处理器改调 `rowOpener(node)`；`load()` 并行发两次 `listThreads`（`archived:false` / `true`）并传给 `buildSessionGroups`；README 更新分组与空白面板说明。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(extension): wire row opener and archived thread listing"`。
- [ ] **Step 6: 记状态**：T-019。

### Task 7: app-server 归档 / 取消归档 / 删除与已归档列表

**Files:**
- Modify: `src/codex/threadApi.ts`, `test/unit/threadApi.test.ts`

**Interfaces:**
- Produces: `archiveThread(id)`、`unarchiveThread(id)`、`deleteThread(id)`、`listThreads({ archived?: boolean })`

- [ ] **Step 1: 写失败测试**：`sends_thread_delete_with_thread_id`、`sends_thread_archive_with_thread_id`、`sends_thread_unarchive_with_thread_id`、`lists_archived_threads_when_asked`。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/threadApi.test.ts`。
- [ ] **Step 3: 实现**：三个薄封装 `client.request('thread/archive'|'thread/unarchive'|'thread/delete', { threadId })`；`listThreads` 的 `archived` 默认 `false`，入参覆盖。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(codex): archive, unarchive and delete threads via app-server"`。
- [ ] **Step 6: 记状态**：T-024~T-027。

### Task 8: 归档 / 取消归档 / 删除三个命令

**Files:**
- Modify: `src/commands.ts`, `test/unit/commands.test.ts`

**Interfaces:**
- Produces: `createArchiveSessionCommand` / `createUnarchiveSessionCommand` / `createDeleteSessionCommand`（依赖 `{ threadApi, showErrorMessage }`，成功 `true`、失败 `false`）；`registerCommands` 注册三个命令；`CommandHandlers` 增加三个处理器

- [ ] **Step 1: 写失败测试**：`archives_session_without_confirmation`、`deletes_archived_session_without_confirmation`、`unarchives_session`、`shows_error_when_archive_fails`、`shows_error_when_delete_fails`（断言依赖里**没有**确认类调用，失败时返回 `false` 且报错一次）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/commands.test.ts`。
- [ ] **Step 3: 实现**：三个同构命令 + `registerCommands` 注册（`codexHelper.archiveSession` / `unarchiveSession` / `deleteSession`）。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(commands): archive, unarchive and delete session commands"`。
- [ ] **Step 6: 记状态**：T-028~T-032。

### Task 9: 清单贡献与「被删会话的标签」定位

**Files:**
- Modify: `package.json`, `src/session/openTabs.ts`
- Create: `test/unit/packageContributes.test.ts`
- Modify: `test/unit/openTabs.test.ts`

**Interfaces:**
- Produces: `selectTabsForConversation(snapshot, conversationId): unknown[]`；三个命令与菜单贡献

- [ ] **Step 1: 写失败测试**：`archive_inline_on_sessions_delete_inline_on_archived`（读 `package.json`：`deleteSession` 在内联组且 `when` 限定 `session.archived`；`archiveSession` 内联且排除已归档；`openSession` 不在内联组但在菜单组）、`selects_open_tabs_of_a_conversation`（只选 id 匹配的标签，含原始句柄）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/packageContributes.test.ts test/unit/openTabs.test.ts`。
- [ ] **Step 3: 实现**：`package.json` 三个命令 + 菜单组调整（`openSession` 移出 inline）；`openTabs.selectTabsForConversation` 复用 `parseConversationId`。
- [ ] **Step 4: 跑绿**：同命令。
- [ ] **Step 5: commit**：`git commit -m "feat(manifest): archive/delete hover actions and archived tab lookup"`。
- [ ] **Step 6: 记状态**：T-033、T-039。

### Task 10: 归档 / 删除的接线与文档

**Files:**
- Modify: `src/extension.ts`, `README.md`, `test/helpers/fakes.ts`, `test/unit/extension.test.ts`

**Interfaces:**
- Consumes: 三个命令（Task 8）、`selectTabsForConversation`（Task 9）

- [ ] **Step 1: 写失败测试**：`archive_and_unarchive_refresh_without_closing_tabs`、`delete_closes_only_the_matching_tab`、`destructive_actions_never_ask_and_only_delete_closes_tabs`（三条命令都不得调用 `showWarningMessage`；只有删除调用 `tabGroups.close`）。
- [ ] **Step 2: 跑红**：`npx vitest run test/unit/extension.test.ts`。
- [ ] **Step 3: 实现**：`activate` 注册三个处理器（归档/取消归档只刷新；删除成功再 `pinStore.unpin` + 关闭命中标签 + 刷新）；`fakes.ts` 的 `tabGroups` 加 `close`、`window` 加 `showWarningMessage`；README 写清两步删除与已归档分组。
- [ ] **Step 4: 跑绿**：`npx vitest run test/unit/extension.test.ts`，随后全量 `pnpm test` + `pnpm typecheck`。
- [ ] **Step 5: commit**：`git commit -m "feat(extension): two-step archive-then-delete with tab cleanup"`。
- [ ] **Step 6: 记状态**：T-034、T-035、INV-004；全部 task 勾选后切 phase=verify 并删除 `.openflow/building`。

---

## Self-Review

- **覆盖**：test-plan 的 47 条选择器逐条落到 10 个 task；每个 task 的 `Test cases:` 与 `Files:` 已被 `check-cross-ref` 校验通过。
- **风险**：`package.json` 的菜单 `when` 语法（`viewItem != session.archived`）在真实 VS Code 里只影响按钮可见性，不影响命令可用性；`extension.test.ts` 用 `activate()` + 假 `vscode`，不触发 app-server（`load()` 只在树请求子节点时运行）。
- **人工验收**：见 test-plan 的 11 条（含重启后聚焦、归档→删除两步、打开已归档先取消归档）。
