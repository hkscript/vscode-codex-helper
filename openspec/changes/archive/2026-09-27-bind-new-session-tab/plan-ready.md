# 实现计划：bind-new-session-tab

## 来源

- 提案：openspec/changes/bind-new-session-tab/proposal.md
- 设计：openspec/changes/bind-new-session-tab/design.md
- 规格：openspec/changes/bind-new-session-tab/specs/codex-session-sidebar/spec.md
- 测试计划：openspec/changes/bind-new-session-tab/test-plan.md

## 执行顺序

Task 1（建会话水线）→ Task 2（命令层建会话优先）→ Task 3（扫描带出句柄/栏号/下标）→ Task 4（点击时重载）→ Task 5（等新会话进列表）→ Task 6（extension 接线）→ Task 7（文档与版本）→ Task 8（补齐红证据）

### Task 1: 一次性 app-server 建会话水线

- [x] 完成（实现与断言已落地；T-121/T-122/T-124 的红证据由 Task 8 补）
- 目标：`src/session/sessionCreator.ts` 提供 `createBoundSession(client, {cwd, gitInfo})` 与 `waitForChildExit(child, timeoutMs)`；顺序 `thread/start` → `thread/metadata/update` → `thread/resume`，任一步失败返回 `null`（不抛），gitInfo 为空时**一个请求都不发**
- Test cases: T-101, T-102, T-103, T-104, T-105, T-106, T-121, T-122, T-124
- Files: `src/session/sessionCreator.ts`, `test/unit/sessionCreator.test.ts`
- 验证方式：`npx vitest run test/unit/sessionCreator.test.ts`
- 确定性：[Verified]（调用序列来自本机 probe）

### Task 2: 命令层改为「建会话优先、空白面板兜底」

- [x] 完成
- 目标：`createNewSessionCommand` 依赖 `createBoundSession()`；成功 → `openWith(buildConversationUri(id))`；`null` 或抛异常 → 回退 `openWith(buildNewPanelUri(nonce))` 且不弹错误
- Test cases: T-115, T-116, T-117
- Files: `src/commands.ts`, `test/unit/commands.test.ts`
- 验证方式：`npx vitest run test/unit/commands.test.ts`
- 确定性：[Verified]

### Task 3: 扫描带出标签句柄、栏号与组内下标

- [x] 完成
- 目标：`OpenTab` 增加 `handle` / `viewColumn` / `index`，`scanCodexTabs` 在快照带这些信息时原样带出（关标签要句柄、重开要落回原栏与原下标）
- Test cases: T-118
- Files: `src/codex/types.ts`, `src/session/openTabs.ts`, `test/unit/openTabs.test.ts`
- 验证方式：`npx vitest run test/unit/openTabs.test.ts`
- 确定性：[Verified]

### Task 4: 点击那一行时重载标题过时的标签

- [x] 完成（实现与断言已落地；T-139 的红证据由 Task 8 补）
- 目标：`createRowOpener` 在 `target.kind === 'tab'` 且注入了 `reloadUntitledTab` 时先问一次，返回 `true` 就直接结束；`tabTitleSync.ts` 收缩为 `CODEX_DEFAULT_TAB_TITLE` + `resourceKey`（后台自动同步整条机制退役）
- Test cases: T-132, T-133, T-134, T-135, T-136, T-139
- Files: `src/session/rowOpener.ts`, `src/session/tabTitleSync.ts`, `test/unit/rowOpener.test.ts`, `test/unit/tabTitleSync.test.ts`
- 验证方式：`npx vitest run test/unit/rowOpener.test.ts test/unit/tabTitleSync.test.ts`
- 确定性：[Verified]（上游 `singlePerResource` 行为来自本机 1.96 产物反编译）

### Task 5: 新会话进列表前的等待轮询

- [x] 完成（实现与断言已落地；T-140~T-144 的红证据由 Task 8 补）
- 目标：`src/session/newSessionWatch.ts` 提供 `createNewSessionWatch(deps)`（3 秒一拍、10 分钟上限、标签关掉即放弃、不比对搜索结果、拉列表失败继续等）；计时/IO/刷新全部由调用方注入
- Test cases: T-140, T-141, T-142, T-143, T-144
- Files: `src/session/newSessionWatch.ts`, `test/unit/newSessionWatch.test.ts`
- 验证方式：`npx vitest run test/unit/newSessionWatch.test.ts`
- 确定性：[Verified]（`src/session/newSessionWatch.ts` 与 `test/unit/newSessionWatch.test.ts` 是本轮新增的未跟踪文件，改动文件对账要看这两条）

### Task 6: extension 接线

- [x] 完成（实现与断言已落地；T-125/T-138 的红证据由 Task 8 补）
- 目标：`newSession` 注入一次性子进程（`createAppServerClient` + 探到的 gitInfo，等子进程退出后返回 id）并在建出会话后 `watch(id)`；点击路径注入 `reloadUntitledTab`（close + 用标签自己的 resource 重开 + `putTabBack` 还原位置）
- Test cases: T-119, T-125, T-137, T-138, T-145
- Files: `src/extension.ts`, `test/unit/extension.test.ts`, `test/helpers/fakes.ts`
- 验证方式：`npx vitest run test/unit/extension.test.ts`
- 确定性：[Verified]（writer 锁与「子进程退出后才放行」来自本机 probe 第 4→7 步）

### Task 7: 文档与版本

- [x] 完成
- 目标：README 更新「新建会话」工作原理、已知限制与代价；`package.json` 版本号递增并打包 vsix
- Test cases: （不新增用例，仅人工核对 README 与 `package.json` 的贡献一致）
- Files: `README.md`, `package.json`
- 验证方式：`npx vitest run` 全绿 + `npx tsc --noEmit` + `npm run build`
- 确定性：[Verified]

### Task 8: 补齐缺失的红证据

- [x] 完成（11 条逐条变异→跑红→精确恢复；`check-test-plan` 报 `pass: true`、`red_missing: 0`）
- 目标：T-121 / T-122 / T-124 / T-125 / T-138 / T-139 / T-140~T-144 这 11 条断言是在实现之前写下的，但没有留下「跑红」的记录（见 test-plan.md「Amendments」的五次影响分析）。逐条把对应实现临时退回或摘掉 → 跑该用例确认失败并贴出失败输出 → 恢复实现后在 test-plan.md 对应行补 `🔴 RED`
- Test cases: （不新增绑定——这些 ID 已归属 Task 1 / 4 / 5 / 6；本 task 只补证据，不动绑定）
- Files: `src/session/sessionCreator.ts`, `src/session/tabTitleSync.ts`, `src/session/newSessionWatch.ts`, `src/extension.ts`
- 验证方式：`node ~/.codex/hooks/openflow-gate.mjs check-test-plan bind-new-session-tab` 报 `pass: true`（`red_missing: 0`）
- 确定性：[Verified]（红证据的判定规则来自 gate 的 `red_evidence_missing` 检查）

## Amendments

### 2026-09-27 五次：重写任务清单以匹配现状（不改行为）

- 原 Task 5 里的「每次 `load()` 之后跑一次标题同步 + `synced` 防抖」随机制退役，改为 Task 4 的点击路径重载。
- 新增 Task 5（`newSessionWatch`）与 Task 8（补齐红证据）。
- 每个 task 的 `Test cases` 改为绑定 test-plan.md 的稳定 ID；原 Task 6 里的「T-033 类别不新增」是无效引用，已删除（该 ID 属于另一个变更的 test-plan）。
- 补上 gate 需要的任务 checkbox（`check-build-done` 依据它判 `all_tasks_done`；写法是「短横线 + 方括号」的 GFM 任务项，八个 task 各一行）。
