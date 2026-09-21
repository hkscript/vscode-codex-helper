# 实现计划：add-codex-session-sidebar

## 来源
- 提案：openspec/changes/add-codex-session-sidebar/proposal.md
- 设计：openspec/changes/add-codex-session-sidebar/design.md
- 规格：openspec/changes/add-codex-session-sidebar/specs/
- 任务：openspec/changes/add-codex-session-sidebar/tasks.md
- 测试计划：openspec/changes/add-codex-session-sidebar/test-plan.md

## Amendments

### 2026-09-21 — 追加「新建会话」与分组默认展开（Task 11）

用户在 verify 阶段提出两条新需求，已按 amend 流程回写 spec / design / test-plan：

1. 侧边栏需要有「新建会话」入口（委派 Codex 的 `chatgpt.newCodexPanel`，见 design D12 与改动点 10）
2. 「置顶」与「已打开」分组默认不折叠（见 design D13 与改动点 8）

任务层面：新增 **Task 11**（绑定 `T-037`~`T-040`）。Task 9（树视图）与 Task 10（命令注册与装配）已完成的部分**不重开**，本次增量统一由 Task 11 承担，避免同一 T-id 绑两个 task。
测试影响：已有 38 条测试无需修改、无需废弃；新增 4 条（`T-037`~`T-040`）。

另有一处不绑测试的产物：`.vscode/launch.json` [Verified]（F5「Run Extension」调试宿主配置，2026-09-21 由用户在 verify 阶段加入；`preLaunchTask: npm: build` 对应 `package.json` 的 `build` 脚本，本机 `npm`/`pnpm` 均可用）。它不含可测试逻辑，故不进 test-plan，仅登记在案以保证 design 的「改动文件」对账完整。

## 执行顺序说明

Task 1 是**生死线任务**：它同时建立工程骨架和会话 URI 契约，并附带一个**人工 spike 门禁**——在 Extension Development Host 里实测 `vscode.openWith` 能否恢复指定会话。spike 不通过就必须停下来重新决策（见 design.md §6），**不得继续 Task 2 及以后**。

Task 2–8 之间没有强耦合，但按依赖排序：二进制定位 → RPC 客户端 → thread API（数据链路），标签扫描 / 置顶存储（独立数据源），再汇入 sessionStore 合并逻辑。Task 9–10 是 UI 与装配，依赖前面全部产物。

---

### Task 1: 工程骨架与会话 URI 契约（含 spike 门禁）
- 目标：建立 TypeScript + vitest + esbuild 工程骨架；实现 `openai-codex://route/local/<id>` 的编解码，使其与 Codex 插件的 `pI()` / `dI()` 完全互逆；并人工实测 `vscode.openWith` 能否恢复指定会话
- Test cases: T-019
- Files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `esbuild.mjs`, `.gitignore`, `src/codex/conversationUri.ts`, `src/codex/types.ts`, `src/extension.ts`, `test/helpers/fakes.ts`, `test/unit/conversationUri.test.ts`
- Test framework setup: `package.json`, `vitest.config.ts`, `tsconfig.json`
- 改动文件：`package.json` [Inferred]、`tsconfig.json` [Inferred]、`vitest.config.ts` [Inferred]、`esbuild.mjs` [Inferred]、`.gitignore` [Inferred]、`src/codex/conversationUri.ts` [Inferred]、`src/codex/types.ts` [Inferred]、`src/extension.ts` [Inferred]、`test/helpers/fakes.ts` [Inferred]、`test/unit/conversationUri.test.ts` [Inferred]
- 覆盖场景：T-019
- 测试先行：先写 T-019（`test/unit/conversationUri.test.ts`），断言 `buildConversationUri` → `parseConversationId` 往返得回原 id，且对 scheme/authority 不符的 uri 返回 `null` [Inferred]
- 验证方式：`pnpm vitest run test/unit/conversationUri.test.ts` 全绿；**并且**在 Extension Development Host 中执行一次 `vscode.commands.executeCommand('vscode.openWith', buildConversationUri('<真实会话id>'), 'chatgpt.conversationEditor', {preview:false})`，确认打开的标签页标题与内容是该历史会话而非新会话，同时记录 `TabInputCustom.viewType` 的实际取值。两项都通过才算完成
- 确定性：[Inferred]（全新文件；URI 规则来自 design.md §2.1 的 `[Verified]` 证据）
- [x] 工程骨架与会话 URI 契约（含 spike 门禁）

### Task 2: codex 可执行文件定位
- 目标：按「`codexHelper.codexExecutable` → `chatgpt.cliExecutable` → Codex 插件 `extensionPath` + 平台目录」顺序解析 codex 二进制路径，失败时抛出含扩展 id 的错误；平台目录映射复刻 Codex 的 `fh()`
- Test cases: T-001, T-002, T-034, T-003
- Files: `src/codex/binary.ts`, `test/unit/binary.test.ts`
- 改动文件：`src/codex/binary.ts` [Inferred]、`test/unit/binary.test.ts` [Inferred]
- 覆盖场景：T-001, T-002, T-034, T-003
- 测试先行：先写 T-001（`test/unit/binary.test.ts`），注入 fake 的 `getExtension` / `getConfiguration`，断言拼出 `<extensionPath>/bin/linux-x86_64/codex` [Inferred]
- 验证方式：`pnpm vitest run test/unit/binary.test.ts`，4 个用例全绿
- 确定性：[Verified]（解析顺序与平台映射对照 Codex 自身的 `yI()` / `fh()` 实现，见 design.md 调研表）
- [x] codex 可执行文件定位

### Task 3: app-server JSON-RPC 客户端
- 目标：spawn `codex app-server` 子进程，实现 NDJSON 分帧、`initialize` 握手、请求/响应路由、超时与 dispose
- Test cases: T-004, T-005, T-006, T-007, T-008, T-009, T-010
- Files: `src/codex/appServerClient.ts`, `src/codex/types.ts`, `test/unit/appServerClient.test.ts`
- 改动文件：`src/codex/appServerClient.ts` [Inferred]、`src/codex/types.ts` [Inferred]、`test/unit/appServerClient.test.ts` [Inferred]
- 覆盖场景：T-004, T-005, T-006, T-007, T-008, T-009, T-010
- 测试先行：先写 T-004（`test/unit/appServerClient.test.ts`），注入 fake spawn（可控 stdin 收集 + stdout 推送），断言第一条写出的消息 `method === 'initialize'` [Inferred]
- 验证方式：`pnpm vitest run test/unit/appServerClient.test.ts`，7 个用例全绿
- 确定性：[Inferred]（协议行为由 design.md §2.2 的 `[Verified]` 实跑 probe 得出）
- [x] app-server JSON-RPC 客户端

### Task 4: thread API 封装
- 目标：封装 `thread/list` / `thread/loaded/list` / `thread/name/set`，负责参数构造（排序、归档过滤、关键词、cwd、分页）
- Test cases: T-011, T-012, T-013, T-014
- Files: `src/codex/threadApi.ts`, `test/unit/threadApi.test.ts`
- 改动文件：`src/codex/threadApi.ts` [Inferred]、`test/unit/threadApi.test.ts` [Inferred]
- 覆盖场景：T-011, T-012, T-013, T-014
- 测试先行：先写 T-011（`test/unit/threadApi.test.ts`），用 fake client 捕获请求参数，断言 `sortKey==='updated_at'`、`archived===false`、`limit===50` [Inferred]
- 验证方式：`pnpm vitest run test/unit/threadApi.test.ts`，4 个用例全绿
- 确定性：[Inferred]（参数名与枚举值来自 design.md §2.2 的 `[Verified]` schema）
- [x] thread API 封装

### Task 5: 已打开标签页扫描
- 目标：从 tabGroups 快照中挑出 Codex 会话标签并解析 conversationId，未绑定会话的新建标签保留为 `null`
- Test cases: T-015, T-016, T-017
- Files: `src/session/openTabs.ts`, `test/unit/openTabs.test.ts`
- 改动文件：`src/session/openTabs.ts` [Inferred]、`test/unit/openTabs.test.ts` [Inferred]
- 覆盖场景：T-015, T-016, T-017
- 测试先行：先写 T-015（`test/unit/openTabs.test.ts`），构造 fake tab（含 `input.viewType` 与 `input.uri`），断言解析出正确的 conversationId [Inferred]
- 验证方式：`pnpm vitest run test/unit/openTabs.test.ts`，3 个用例全绿
- 确定性：[Inferred]（`TabInputCustom` 字段已 `[Verified]`；实际 viewType 取值由 Task 1 spike 确认）
- [x] 已打开标签页扫描

### Task 6: 置顶存储
- 目标：在 `globalState['codexHelper.pinnedSessionIds']` 中读写置顶会话 id 列表
- Test cases: T-024, T-025, T-026
- Files: `src/session/pinStore.ts`, `test/unit/pinStore.test.ts`
- 改动文件：`src/session/pinStore.ts` [Inferred]、`test/unit/pinStore.test.ts` [Inferred]
- 覆盖场景：T-024, T-025, T-026
- 测试先行：先写 T-024（`test/unit/pinStore.test.ts`），用 fake Memento 断言 pin 后写入 `['t1']` [Inferred]
- 验证方式：`pnpm vitest run test/unit/pinStore.test.ts`，3 个用例全绿
- 确定性：[Inferred]
- [x] 置顶存储

### Task 7: 会话合并、分组与过滤
- 目标：把 thread 列表、已打开标签、置顶集合、过滤关键词合并成互斥的三个分组，并保证两条不变量成立
- Test cases: T-027, T-028, T-029, T-030, T-031, T-035, T-036, INV-001, INV-002
- Files: `src/session/sessionStore.ts`, `test/unit/sessionStore.test.ts`
- 改动文件：`src/session/sessionStore.ts` [Inferred]、`test/unit/sessionStore.test.ts` [Inferred]
- 覆盖场景：T-027, T-028, T-029, T-030, T-031, T-035, T-036, INV-001, INV-002
- 测试先行：先写 T-027（`test/unit/sessionStore.test.ts`）三组归位，再补 INV-001 —— 对「有无已打开 × 是否置顶 × 是否在列表中」的全组合断言每个 id 在结果里至多出现一次 [Inferred]
- 验证方式：`pnpm vitest run test/unit/sessionStore.test.ts`，7 个场景用例 + 2 个不变量用例全绿
- 确定性：[Inferred]（纯逻辑，规则由 design.md D7/D8 裁定）
- [x] 会话合并、分组与过滤

### Task 8: 会话打开器
- 目标：用 `vscode.openWith` + 会话 URI + `chatgpt.conversationEditor` 打开会话；失败时报错且绝不回退到新建面板
- Test cases: T-018, T-020
- Files: `src/session/opener.ts`, `test/unit/opener.test.ts`
- 改动文件：`src/session/opener.ts` [Inferred]、`test/unit/opener.test.ts` [Inferred]
- 覆盖场景：T-018, T-020
- 测试先行：先写 T-018（`test/unit/opener.test.ts`），注入 fake `executeCommand`，断言三个参数完全匹配 [Inferred]
- 验证方式：`pnpm vitest run test/unit/opener.test.ts`，2 个用例全绿；T-020 必须显式断言 `chatgpt.newCodexPanel` 从未被调用
- 确定性：[Inferred]（调用形态由 design.md §2.1 的 `[Verified]` 证据 + Task 1 spike 共同确认）
- [x] 会话打开器

### Task 9: 树视图
- 目标：实现 `TreeDataProvider`——分组节点、会话节点、错误节点（带重试 command）、加载更多节点
  （2026-09-21 amend：分组节点的默认折叠状态由 Task 11 追加，本 task 的既有实现不重开）
- Test cases: T-032, T-033
- Files: `src/ui/treeProvider.ts`, `test/unit/treeProvider.test.ts`
- 改动文件：`src/ui/treeProvider.ts` [Inferred]、`test/unit/treeProvider.test.ts` [Inferred]
- 覆盖场景：T-032, T-033
- 测试先行：先写 T-032（`test/unit/treeProvider.test.ts`），让数据源抛 `spawn ENOENT`，断言 `getChildren()` 返回恰好一个错误节点且 `command === 'codexHelper.refresh'` [Inferred]
- 验证方式：`pnpm vitest run test/unit/treeProvider.test.ts`，2 个用例全绿
- 确定性：[Inferred]
- [x] 树视图

### Task 10: 命令注册与插件装配
- 目标：注册全部命令（刷新 / 打开 / 重命名 / 置顶 / 取消置顶 / 过滤 / 清除过滤 / 加载更多），在 `package.json` 声明视图容器、视图、命令、菜单与配置项，`activate` 装配、`deactivate` 回收子进程
- Test cases: T-021, T-022, T-023
- Files: `src/commands.ts`, `src/extension.ts`, `package.json`, `test/unit/commands.test.ts`, `resources/codex.svg`
- 改动文件：`src/commands.ts` [Inferred]、`src/extension.ts` [Inferred]、`package.json` [Inferred]、`test/unit/commands.test.ts` [Inferred]
- 覆盖场景：T-021, T-022, T-023
- 测试先行：先写 T-021（`test/unit/commands.test.ts`），注入 fake `showInputBox` 返回 `价格排查`，断言 `thread/name/set` 收到 `{threadId:'t1', name:'价格排查'}` [Inferred]
- 验证方式：`pnpm vitest run`（全量 38 个用例全绿）+ `pnpm run build`（esbuild 打包无错）+ 在 Extension Development Host 中人工走查 proposal.md 的 7 条验收条件
- 确定性：[Inferred]
- [x] 命令注册与插件装配
  （2026-09-21 amend：新增会话命令的注册与菜单贡献、以及树的分组默认展开由 Task 11 追加；全量用例数已由 38 增至 42）

### Task 11: 新建会话命令与分组默认展开（amend 追加）
- 目标：新增 `codexHelper.newSession` 命令（视图标题栏入口），委派 Codex 的 `chatgpt.newCodexPanel` 创建新会话面板；失败时报错且不把异常抛回命令层。同时让 `src/ui/treeProvider.ts::getTreeItem` 对分组节点按组给出默认折叠状态：「已打开」「置顶」为 `Expanded`、「历史」为 `Collapsed`
- Test cases: T-037, T-038, T-039, T-040
- Files: `src/commands.ts`, `src/extension.ts`, `src/ui/treeProvider.ts`, `package.json`, `test/unit/commands.test.ts`, `test/unit/sessionStore.test.ts`, `test/unit/treeProvider.test.ts`, `src/session/sessionStore.ts`, `openspec/changes/add-codex-session-sidebar/test-plan.md`, `openspec/changes/add-codex-session-sidebar/plan-ready.md`
  末四项都是**流程性/校验性**触碰，不是功能改动，显式声明出来便于复核：
  - `test-plan.md` / `plan-ready.md`：build 流程自身要求的记账写回（`🔴 RED` / `✅ PASS` 后缀、task checkbox）。
  - `src/session/sessionStore.ts`：T-039 断言的「两个 `id: null` 标签各占一项」是 Task 7 已实现的行为（纯回归守卫，天生不会因新功能而变红），因此它的失败能力必须用**变异校验**证明——把这个合成 id 临时写坏、看到 T-039 变红、立刻还原。该文件最终**不保留任何改动**。
  - 原因：Codex 的 enforcement hook 在 task-build 模式只允许改「task 声明的文件」，不声明就无法执行上述两类触碰。
- 改动文件：`src/commands.ts` [Verified]、`src/extension.ts` [Verified]、`src/ui/treeProvider.ts` [Verified]、`package.json` [Verified]、`test/unit/commands.test.ts` [Verified]、`test/unit/sessionStore.test.ts` [Verified]、`test/unit/treeProvider.test.ts` [Verified]
- 覆盖场景：T-037, T-038, T-039, T-040
- 测试先行：先写 T-037（`test/unit/commands.test.ts`），注入 fake `executeCommand`，断言收到 `chatgpt.newCodexPanel` 且恰好一次（不带参数）；再写 T-038 的失败路径（fake 抛 `command 'chatgpt.newCodexPanel' not found`，断言展示错误消息、命令不抛出）；然后 T-039（`test/unit/sessionStore.test.ts`：两个 `conversationId` 为 `null` 的标签必须各占一项、id 互不相同、标题取自标签页标题）；最后 T-040（`test/unit/treeProvider.test.ts`：`getTreeItem` 对 open/pinned 分组返回 `TreeItemCollapsibleState.Expanded`、history 返回 `Collapsed`，`TreeItemCollapsibleState` 从 `test/helpers/fakes.ts` 取）
- 验证方式：`pnpm vitest run test/unit/commands.test.ts test/unit/sessionStore.test.ts test/unit/treeProvider.test.ts` 全绿；随后 `pnpm test`（全量 42 个用例全绿）+ `pnpm typecheck` + `pnpm run build`
- 确定性：[Verified]（`chatgpt.newCodexPanel` 的 handler 用可选链取参、无参调用安全——Codex `out/extension.js` 实测；`TreeItemCollapsibleState` 已在 `test/helpers/fakes.ts` 提供，可直接断言）
- 注意：不要改动 `src/session/opener.ts` 的失败路径——D9/T-020 断言 opener 永不调用 `chatgpt.newCodexPanel`，本次新增的是另一条用户显式入口
- [x] 新建会话命令与分组默认展开
