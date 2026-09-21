# 实现计划：fix-new-session-panel-reuse

## 来源
- 提案：openspec/changes/fix-new-session-panel-reuse/proposal.md
- 设计：openspec/changes/fix-new-session-panel-reuse/design.md
- 规格：openspec/changes/fix-new-session-panel-reuse/specs/
- 测试计划：openspec/changes/fix-new-session-panel-reuse/test-plan.md

### Task 1: new-panel URI 契约
- 目标：在 URI 契约模块里新增 `NEW_PANEL_PATH` 与 `buildNewPanelUri(uriApi, nonce)`，使其产出的 URI 与 Codex 自己的 new-panel 路由逐字一致，仅在 query 上携带 nonce
- Test cases: T-001, T-005
- Files: `src/codex/conversationUri.ts`, `test/unit/conversationUri.test.ts`, `openspec/changes/fix-new-session-panel-reuse/test-plan.md`, `openspec/changes/fix-new-session-panel-reuse/plan-ready.md`
- 改动文件：`src/codex/conversationUri.ts` [Verified]、`test/unit/conversationUri.test.ts` [Verified]
- 覆盖场景：T-001, T-005
- 测试先行：T-001 与 T-005 写在 `test/unit/conversationUri.test.ts` [Verified]
- 验证方式：`npx vitest run test/unit/conversationUri.test.ts`，预期 2 个新用例先 FAIL（`buildNewPanelUri is not a function`）再 PASS
- 确定性：[Verified]（`src/codex/conversationUri.ts:1-42` 已存在并已有同款 `with({scheme, authority, query})` 实现可照抄）
- [x] new-panel URI 契约

### Task 2: 新建会话命令改为自建 URI + 接线
- 目标：`createNewSessionCommand` 依赖新增 `uriApi` 与 `createNonce`，实现从「委派 `chatgpt.newCodexPanel`」改为「`vscode.openWith` 一个带唯一 query 的 new-panel URI」；`extension.ts` 注入 `vscode.Uri` 与 `randomUUID`；README 记录这条复刻契约
- Test cases: T-002, T-003, T-004
- Files: `src/commands.ts`, `src/extension.ts`, `test/unit/commands.test.ts`, `README.md`, `openspec/changes/fix-new-session-panel-reuse/test-plan.md`, `openspec/changes/fix-new-session-panel-reuse/plan-ready.md`
- 改动文件：`src/commands.ts` [Verified]、`src/extension.ts` [Verified]、`test/unit/commands.test.ts` [Verified]、`README.md` [Verified]
- 覆盖场景：T-002, T-003, T-004
- 测试先行：T-002 / T-003 / T-004 写在 `test/unit/commands.test.ts` [Verified]（同时删除被取代的 `calls_new_codex_panel_once`、重写 `shows_error_when_new_session_command_fails`）
- 验证方式：`npx vitest run test/unit/commands.test.ts`，预期 3 个新用例先 FAIL 再 PASS；随后 `pnpm test` 全绿 + `pnpm typecheck` 通过
- 确定性：[Verified]（接线位置 `src/extension.ts:143-147`，`vscode.Uri` 注入样例见同文件 `:135`）
- [x] 新建会话命令改为自建 URI + 接线
