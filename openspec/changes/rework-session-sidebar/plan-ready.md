# 实现计划：rework-session-sidebar

## 来源

- 提案：openspec/changes/rework-session-sidebar/proposal.md
- 设计：openspec/changes/rework-session-sidebar/design.md
- 规格：openspec/changes/rework-session-sidebar/specs/
- 测试计划：openspec/changes/rework-session-sidebar/test-plan.md

## 执行顺序

依赖顺序（build 期调整过一次）：Task 1（类型/扫描）→ Task 2（树数据四组）→ Task 3（打开目标）→ Task 4（打开器）→ Task 5（树条目）→ **Task 7（app-server 方法）→ Task 8（三个命令）→ Task 6（打开接线 + 已归档列表 + README）** → Task 9（清单贡献 + 标签定位）→ Task 10（归档/删除接线）。调整原因：`rowOpener` 的 `unarchive` 依赖要有 app-server 方法（Task 7）才接得起来，而 `load()` 里「并行拉两批会话」与归档/删除的接线同属 extension.ts，放到 Task 6/10 一起做更省事。

### Task 1: 标签扫描丢弃未绑定面板并保留标签 resource

- 目标：`OpenTab.id` 收紧为非空、新增 `uri`；未绑定会话的标签在扫描阶段被忽略
- Test cases: T-001, T-002
- Files: `src/codex/types.ts`, `src/session/openTabs.ts`, `test/helpers/fakes.ts`, `test/unit/openTabs.test.ts`
- 改动文件：src/codex/types.ts [Verified]、src/session/openTabs.ts [Verified]、test/helpers/fakes.ts [Verified]、test/unit/openTabs.test.ts [Verified]
- 覆盖场景：T-001（未绑定面板标签被忽略）、T-002（保留标签自己的 resource）
- 测试先行：先写 T-001（`test/unit/openTabs.test.ts::drops_tab_without_conversation_id`）——旧行为「保留为未命名项」下它是红的 [Verified]
- 验证方式：`npx vitest run test/unit/openTabs.test.ts`
- 确定性：[Verified]
- [x] 标签扫描丢弃未绑定面板并保留标签 resource

### Task 2: 树数据按「置顶 / 最近 / 历史 / 已归档」归位

- 目标：`SessionGroupId` 变为 `'pinned' | 'recent' | 'history' | 'archived'`、`GROUP_LABELS` 同步；`buildSessionGroups` 入参增加 `archivedThreads`，按「已归档优先 → 置顶 → `updatedAt` 前 10 个进最近 → 其余历史」归位；`SessionItem` 增加 `tabUri`，已打开会话标 `open`
- Test cases: T-008, T-009, T-010, T-011, T-012, T-013, T-020, T-021, T-022, T-023, T-036, T-037, INV-002, INV-003
- Files: `src/codex/types.ts`, `src/session/sessionStore.ts`, `test/helpers/fakes.ts`, `test/unit/sessionStore.test.ts`
- 改动文件：src/codex/types.ts [Verified]、src/session/sessionStore.ts [Verified]、test/helpers/fakes.ts [Verified]、test/unit/sessionStore.test.ts [Verified]
- 覆盖场景：T-008~T-013、T-020~T-023、T-036、T-037、INV-002、INV-003
- 测试先行：先写 T-010（`drops_unbound_new_panel_tab`）与 T-036（`archived_threads_land_in_archived_group_only`）——旧实现前者会造出 `open-tab:0` 行、后者没有已归档组，两条必红 [Verified]
- 验证方式：`npx vitest run test/unit/sessionStore.test.ts`
- 确定性：[Verified]
- [x] 树数据按「置顶 / 最近 / 历史 / 已归档」归位

### Task 3: 打开目标判定 + 行打开编排（含「归档行先取消归档」）

- 目标：`readSessionRow` 归一节点形状、`resolveOpenTarget` 判定目标（resource 优先 / 会话 id 兜底 / 都没有则 `null`）、`createRowOpener` 编排（归档行先 `unarchive` 再打开，取消归档失败不阻止打开）
- Test cases: T-003, T-004, T-005, T-040, T-041, INV-001, INV-005
- Files: `src/session/openTarget.ts`, `src/session/rowOpener.ts`, `test/unit/openTarget.test.ts`, `test/unit/rowOpener.test.ts`
- 改动文件：src/session/openTarget.ts [Verified]（新增）、src/session/rowOpener.ts [Verified]（新增）、test/unit/openTarget.test.ts [Verified]（新增）、test/unit/rowOpener.test.ts [Verified]（新增）
- 覆盖场景：T-003、T-004、T-005、T-040、T-041、INV-001、INV-005
- 测试先行：先写 T-040（`archived_row_unarchives_before_opening`）与 T-041（`opens_even_when_unarchive_fails`）——`createRowOpener` 尚不存在，两条必红 [Verified]
- 验证方式：`npx vitest run test/unit/openTarget.test.ts test/unit/rowOpener.test.ts`
- 确定性：[Verified]
- [x] 打开目标判定 + 行打开编排（含「归档行先取消归档」）

### Task 4: opener 增加按 resource 聚焦的入口

- 目标：`src/session/opener.ts::revealTab`：`vscode.openWith(resource, chatgpt.conversationEditor, {preview:false})`；失败报错且不回退新建
- Test cases: T-006, T-007
- Files: `src/session/opener.ts`, `test/unit/opener.test.ts`
- 改动文件：src/session/opener.ts [Verified]、test/unit/opener.test.ts [Verified]
- 覆盖场景：T-006、T-007
- 测试先行：先写 T-006（`reveals_open_tab_with_its_own_resource`）[Verified]
- 验证方式：`npx vitest run test/unit/opener.test.ts`
- 确定性：[Verified]
- [x] opener 增加按 resource 聚焦的入口

### Task 5: 树条目携带标签 resource 与已归档 contextValue

- 目标：`getTreeItem` 的 `command.arguments` 带上 `tabUri`；`session.archived` 条目的 `contextValue` 为 `session.archived`；默认折叠态为「置顶、最近展开 / 历史、已归档折叠」
- Test cases: T-014, T-015, T-016, T-017, T-018, T-038, T-042
- Files: `src/ui/treeProvider.ts`, `test/unit/treeProvider.test.ts`
- 改动文件：src/ui/treeProvider.ts [Verified]、test/unit/treeProvider.test.ts [Verified]
- 覆盖场景：T-014~T-018、T-038、T-042
- 测试先行：先写 T-038（`archived_row_uses_archived_context_value`）与 T-042（`archived_row_passes_archived_flag`）——现在既没有 `session.archived` 这个 contextValue，命令参数里也没有 `archived` 字段，两条必红 [Verified]
- 验证方式：`npx vitest run test/unit/treeProvider.test.ts`
- 确定性：[Verified]
- [x] 树条目携带标签 resource 与已归档 contextValue

### Task 6: 打开会话的接线与文档

- 目标：`codexHelper.openSession` 处理器改走 `createRowOpener`（归档行先取消归档，资源优先）；`load()` 并行发两次 `thread/list`（`archived:false` / `true`）把两批会话交给 `buildSessionGroups`；README 记录分组变化与「空白面板不进侧边栏」
- Test cases: T-019
- Files: `src/extension.ts`, `test/unit/extension.test.ts`, `README.md`
- 改动文件：src/extension.ts [Verified]、test/unit/extension.test.ts [Verified]（新增）、README.md [Verified]
- 覆盖场景：T-019
- 测试先行：先写 T-019（`open_session_command_prefers_the_tab_resource`）：`activate()` 后用假 `vscode` 捕获命令处理器，断言 `vscode.openWith` 的第一个参数是该标签 resource [Verified]
- 验证方式：`npx vitest run test/unit/extension.test.ts`
- 确定性：[Verified]
- [x] 打开会话的接线与文档

### Task 7: app-server 归档 / 取消归档 / 删除与已归档列表

- 目标：`threadApi.archiveThread` / `unarchiveThread` / `deleteThread`；`listThreads` 支持 `archived` 入参
- Test cases: T-024, T-025, T-026, T-027
- Files: `src/codex/threadApi.ts`, `test/unit/threadApi.test.ts`
- 改动文件：src/codex/threadApi.ts [Verified]、test/unit/threadApi.test.ts [Verified]
- 覆盖场景：T-024~T-027
- 测试先行：先写 T-027（`lists_archived_threads_when_asked`）——现在 `listThreads` 固定 `archived:false`，必红 [Verified]
- 验证方式：`npx vitest run test/unit/threadApi.test.ts`
- 确定性：[Verified]
- [x] app-server 归档 / 取消归档 / 删除与已归档列表

### Task 8: 归档 / 取消归档 / 删除三个命令

- 目标：`createArchiveSessionCommand` / `createUnarchiveSessionCommand` / `createDeleteSessionCommand`（均无确认依赖：成功返回 `true`，失败只报错返回 `false`）；`registerCommands` 注册三个命令
- Test cases: T-028, T-029, T-030, T-031, T-032
- Files: `src/commands.ts`, `test/unit/commands.test.ts`
- 改动文件：src/commands.ts [Verified]、test/unit/commands.test.ts [Verified]
- 覆盖场景：T-028~T-032
- 测试先行：先写 T-028/T-029（三个命令尚不存在，必红）[Verified]
- 验证方式：`npx vitest run test/unit/commands.test.ts`
- 确定性：[Verified]
- [x] 归档 / 取消归档 / 删除三个命令

### Task 9: 清单贡献与「被删会话的标签」定位

- 目标：`package.json` 新增三个命令与其菜单贡献（归档→未归档条目的 `inline@1`；删除→`session.archived` 的 `inline@2`；取消归档与打开会话→`1_modification` 组，`openSession` 移出 inline）；`openTabs.selectTabsForConversation` 按会话 id 选出要关闭的标签句柄
- Test cases: T-033, T-039
- Files: `package.json`, `src/session/openTabs.ts`, `test/unit/packageContributes.test.ts`, `test/unit/openTabs.test.ts`
- 改动文件：package.json [Verified]、src/session/openTabs.ts [Verified]、test/unit/packageContributes.test.ts [Verified]（新增）、test/unit/openTabs.test.ts [Verified]
- 覆盖场景：T-033、T-039
- 测试先行：先写 T-033（`archive_inline_on_sessions_delete_inline_on_archived`）——当前 inline 组里只有 `openSession`，必红 [Verified]
- 验证方式：`npx vitest run test/unit/packageContributes.test.ts test/unit/openTabs.test.ts`
- 确定性：[Verified]
- [x] 清单贡献与「被删会话的标签」定位

### Task 10: 归档 / 删除的接线与文档

- 目标：`activate` 注册三个处理器（归档/取消归档只刷新；删除成功再 unpin + 关闭命中标签 + 刷新）；`fakes.ts` 的 `tabGroups.close` 与 `showWarningMessage`；README 记录「先归档再删除」的语义与「已归档分组只取一页」
- Test cases: T-035, INV-004
- Files: `src/extension.ts`, `src/session/openTabs.ts`, `test/helpers/fakes.ts`, `test/unit/extension.test.ts`, `README.md`
- 改动文件：src/extension.ts [Verified]、src/session/openTabs.ts [Verified]、test/helpers/fakes.ts [Verified]、test/unit/extension.test.ts [Verified]、README.md [Verified]
- 覆盖场景：T-035、INV-004（「归档与取消归档不改动标签页」并入 INV-004 的 3×2 矩阵：它在纯实现前就是绿的，单独成行没有失败能力）
- 测试先行：先写 INV-004（`destructive_actions_never_ask_and_only_delete_closes_tabs`）：三条命令都不得调用 `showWarningMessage`，且只有删除会调用 `tabGroups.close` [Verified]
- 验证方式：`npx vitest run test/unit/extension.test.ts`，随后全量 `pnpm test` + `pnpm typecheck`
- 确定性：[Verified]
- [x] 归档 / 删除的接线与文档

### Task 11: 侧边栏标题不重复（amend 追加）

- 目标：容器标题改为 `Codex`、视图名保持 `会话`、去掉视图的 `contextualTitle`（VS Code 会把两段拼成标题栏文案）
- Test cases: T-043
- Files: `package.json`, `test/unit/packageContributes.test.ts`
- 改动文件：package.json [Verified]、test/unit/packageContributes.test.ts [Verified]
- 覆盖场景：T-043（侧边栏标题不出现重复的「会话」）
- 测试先行：先写 T-043（`test/unit/packageContributes.test.ts::sidebar_title_is_not_duplicated`）——当前容器标题是 `Codex 会话`、视图还带 `contextualTitle`，必红 [Verified]
- 验证方式：`npx vitest run test/unit/packageContributes.test.ts`，随后全量 `pnpm test`
- 确定性：[Verified]
- [x] 侧边栏标题不重复（amend 追加）
