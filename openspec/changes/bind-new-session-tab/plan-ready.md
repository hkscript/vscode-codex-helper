# 实现计划：bind-new-session-tab

## 来源

- 提案：openspec/changes/bind-new-session-tab/proposal.md
- 设计：openspec/changes/bind-new-session-tab/design.md
- 规格：openspec/changes/bind-new-session-tab/specs/codex-session-sidebar/spec.md
- 测试计划：openspec/changes/bind-new-session-tab/test-plan.md

## 执行顺序

Task 1（一次性建会话水线）→ Task 2（标题同步判定）→ Task 3（命令层建会话优先）→ Task 4（扫描带出标签句柄）→ Task 5（extension 接线）→ Task 6（README + 版本）

### Task 1: 一次性 app-server 建会话水线

- 目标：`src/session/sessionCreator.ts` 提供 `createBoundSession(client, {cwd, gitInfo})` 与 `waitForChildExit(child, timeoutMs)`；顺序 `thread/start` → `thread/metadata/update` → `thread/resume`，任一步失败返回 `null`（不抛），gitInfo 为空时**一个请求都不发**
- Test cases: T-101, T-102, T-103, T-104, T-105, T-106
- Files: `src/session/sessionCreator.ts`（新增）、`test/unit/sessionCreator.test.ts`（新增）
- 测试先行：先写 6 条用例，`sessionCreator` 尚不存在，全部必红
- 验证方式：`npx vitest run test/unit/sessionCreator.test.ts`
- 确定性：[Verified]（调用序列来自本机 probe）

### Task 2: 标题同步判定

- 目标：`src/session/tabTitleSync.ts` 提供 `CODEX_DEFAULT_TAB_TITLE`、`expectedTabTitle(thread)`、`planTabTitleSync(input)`；只对「标题仍是 `Codex`、会话有目标标题、会话不运行、标签非激活、该目标标题未同步过」的标签给出重开计划
- Test cases: T-107, T-108, T-109, T-110, T-111, T-112, T-113, T-114
- Files: `src/session/tabTitleSync.ts`（新增）、`test/unit/tabTitleSync.test.ts`（新增）
- 测试先行：先写 8 条用例，模块不存在 → 必红
- 验证方式：`npx vitest run test/unit/tabTitleSync.test.ts`
- 确定性：[Verified]（30 字截断与 `name?.trim() || preview` 来自上游 bundle）

### Task 3: 命令层改为「建会话优先、空白面板兜底」

- 目标：`createNewSessionCommand` 依赖新增 `createBoundSession()`；成功 → `openWith(buildConversationUri(id))`；`null` 或抛异常 → 回退 `openWith(buildNewPanelUri(nonce))` 且不弹错误
- Test cases: T-115, T-116, T-117
- Files: `src/commands.ts`、`test/unit/commands.test.ts`
- 验证方式：`npx vitest run test/unit/commands.test.ts`
- 确定性：[Verified]

### Task 4: 扫描带出标签句柄

- 目标：`OpenTab` 增加可选 `handle`，`scanCodexTabs` 在快照带句柄时原样带出（关标签需要原始句柄）
- Test cases: T-118
- Files: `src/codex/types.ts`、`src/session/openTabs.ts`、`test/unit/openTabs.test.ts`
- 验证方式：`npx vitest run test/unit/openTabs.test.ts`
- 确定性：[Verified]

### Task 5: extension 接线

- 目标：`newSession` 注入一次性子进程（`createAppServerClient` + 探到的 gitInfo，等子进程退出后返回 id）；每次 `load()` 之后跑一次标题同步（close + 用自己的 resource 重开），用 `synced: Map<sessionId, expectedTitle>` 防抖
- Test cases: T-119, T-120
- Files: `src/extension.ts`、`test/unit/extension.test.ts`、`test/helpers/fakes.ts`
- 验证方式：`npx vitest run test/unit/extension.test.ts`
- 确定性：[Verified]（writer 锁与"子进程退出后才放行"来自本机 probe 第 4→7 步）

### Task 6: 文档与版本

- 目标：README 更新「新建会话」工作原理、已知限制与代价；`package.json` 版本号递增并打包 vsix
- Test cases: T-033 类别不新增，仅人工核对 README 与 package 贡献一致
- Files: `README.md`、`package.json`
- 验证方式：`npx vitest run` 全绿 + `npx tsc --noEmit` + `npm run build`
- 确定性：[Verified]
