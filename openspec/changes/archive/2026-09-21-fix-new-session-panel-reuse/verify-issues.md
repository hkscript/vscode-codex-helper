# 验证记录：fix-new-session-panel-reuse

验证时间：2026-09-21。阶段状态：`verify`（bootstrap 标记已移除）。分支基线：`.openflow/gate.config.json` → `base_branch = 7ea06de`。

## 闸门 1：全量测试

自动化检查汇总（sign receipt 前最后一次运行）：

| 检查 | 结果 |
|------|------|
| `check-build-done` | `all_tasks_done: true`、`all_tests_pass: true` |
| `check-test-plan` | `pass 5 / todo 0 / fail 0 / red_missing 0` |
| `check-cross-ref` | `5 tests, all covered by plan-ready tasks` |
| `check-design-consistency` | `pass: true`，`blockers: []`，3 个改动点 verdict 全 ✅ |
| `check-verify-issues` | `unresolved_count: 0` |
| `check-verify-prerequisites` | `pass: true` |
| `openspec validate --strict` | `Change 'fix-new-session-panel-reuse' is valid` |

```
$ pnpm test          # vitest run
 ✓ test/unit/processScan.test.ts (3 tests)
 ✓ test/unit/binary.test.ts (4 tests)
 ✓ test/unit/conversationUri.test.ts (3 tests)
 ✓ test/unit/pinStore.test.ts (3 tests)
 ✓ test/unit/openTabs.test.ts (3 tests)
 ✓ test/unit/opener.test.ts (2 tests)
 ✓ test/unit/threadApi.test.ts (5 tests)
 ✓ test/unit/commands.test.ts (6 tests)
 ✓ test/unit/runningState.test.ts (12 tests)
 ✓ test/unit/sessionStore.test.ts (12 tests)
 ✓ test/unit/treeProvider.test.ts (10 tests)
 ✓ test/unit/appServerClient.test.ts (7 tests)
 ✓ test/unit/runningTracker.test.ts (8 tests)

 Test Files  13 passed (13)
      Tests  78 passed (78)
```

- exit code：0
- 另外跑过：`pnpm typecheck`（tsc --noEmit）exit 0；`pnpm build`（esbuild）exit 0
- 无回归：`commands.test.ts` 由 6 个用例覆盖（删 1 加 3 后与 rename 的 3 个用例合计 6）

## 闸门 2：场景覆盖率 5/5

本变更 `specs/codex-session-sidebar/spec.md` 的 ADDED requirement 共 5 个 scenario：

| # | Scenario | 覆盖用例 | 类型 |
|---|----------|----------|------|
| 1 | 每次执行都打开带上本次调用独有 query 的新面板 URI | T-001（构造）+ T-002（命令） | 新增 |
| 2 | 连续两次执行产生两个互不相同的 URI | T-003 | 新增 |
| 3 | 新建失败时提示错误 | T-004 | 新增（重写既有用例） |
| 4 | 尚未绑定会话的新建标签以未命名项出现在「已打开」组 | `test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` | **既有覆盖**（本变更未改该行为，无 RED，见 test-plan.md「既有覆盖」节） |
| 5 | 带 query 的新面板 URI 不被误判为会话 | T-005 | 新增 |

mapped 5 / total 5 = 100%（scenario 1 由两条用例分别从「URI 构造」与「命令调用」两侧覆盖）。

REMOVED 的旧 requirement 的 `Scenario: 执行命令时调用 Codex 的新建面板命令` 被本变更推翻（见 spec delta 的 Reason），不参与覆盖率分母。

## 闸门 3：设计一致性

`node ~/.codex/hooks/openflow-gate.mjs check-design-consistency fix-new-session-panel-reuse` → `pass: true`，`blockers: []`。

### change_point_verdicts（gate 原样输出）

| 改动点 | claimed | verdict |
|--------|---------|---------|
| 改动点 1 新增 new-panel URI 构造 | `src/codex/conversationUri.ts::buildNewPanelUri`（hit: true, `buildNewPanelUri@45`）、`src/codex/conversationUri.ts::buildConversationUri`（不随改） | ✅ |
| 改动点 2 新建会话命令改为自建 URI | `src/commands.ts::createNewSessionCommand`（hit: true, `createNewSessionCommand@88`）、`src/session/opener.ts::openSession`（不随改） | ✅ |
| 改动点 3 接线注入 `uriApi` 与 `createNonce` | `src/extension.ts::activate`（hit: true, `activate@35`） | ✅ |

### gate 的 4 条归属漂移 warning（逐条给代码证据，已归位到改动点 2）

gate 输出的归因文字统一为：`改动点归属：src/commands.ts 的 createRenameSessionCommand（第 41 行）未被任何改动点声明，但 diff 落点在此方法内（第 N 行）——方法归属漂移，人工核对是否插错方法`，N 分别为 69 / 77 / 79 / 84。

| # | gate 归因（⚠️） | 代码证据与处置（✅） |
|---|------------------|----------------------|
| 1 | ⚠️ 第 69 行归属 `createRenameSessionCommand` | ✅ 实为 `createNewSessionCommand` 的 JSDoc 首行 `/**`（第 69-87 行为该函数的注释块），紧接着的第 88 行就是 `export function createNewSessionCommand(...)`，属 design 改动点 2 的声明目标 |
| 2 | ⚠️ 第 77 行归属 `createRenameSessionCommand` | ✅ 实为同一 JSDoc 块的注释正文行，仍属第 88 行 `createNewSessionCommand` 的文档块 |
| 3 | ⚠️ 第 79 行归属 `createRenameSessionCommand` | ✅ 同上，实为 JSDoc 正文行（`* 这里也不刷新：…`），属 `createNewSessionCommand` 文档块 |
| 4 | ⚠️ 第 84 行归属 `createRenameSessionCommand` | ✅ 实为 `NewSessionCommandDeps` 的字段 `createNonce(): string;`；该接口的唯一消费者是第 88 行的 `createNewSessionCommand`（`deps.createNonce()` 调用点在 `src/commands.ts:93`），属 design 改动点 2 |

对 `createRenameSessionCommand`（`src/commands.ts:41-63`）本变更**零改动**：`git diff` 显示该函数体内没有任何 hunk。gate 按「声明行区间」归属，把紧邻下一个声明的注释/接口算进了上一个方法，属**归因边界**而非改动落错方法。

### 改动点逐条落点核验

```
改动点 1（声明 `src/codex/conversationUri.ts::buildNewPanelUri`）：代码落点 = buildNewPanelUri(deps.uriApi, deps.createNonce())@src/commands.ts:93 → ✅
改动点 2（声明 `src/commands.ts::createNewSessionCommand`）：代码落点 = createNewSessionCommand({...})@src/extension.ts:144 → ✅
改动点 3（声明 `src/extension.ts::activate`）：代码落点 = { uriApi: vscode.Uri, createNonce: () => randomUUID() }@src/extension.ts:148-149（作为 deps 传入 createNewSessionCommand）→ ✅
```

`不随改` 的两条并行路径理由（引用 design 声明）：

- `src/codex/conversationUri.ts::buildConversationUri` —— 打开既有会话的 resource 必须保持「每个会话一个 URI」的既有语义，本变更只新增函数，未触碰它。
- `src/session/opener.ts::openSession` —— 打开既有会话失败时不得回退新建，是上一变更守住的语义，本变更不碰它（`git diff` 中该文件无改动）。

**design「改动文件」对账**：`src/codex/conversationUri.ts`、`src/commands.ts`、`src/extension.ts`、`test/unit/conversationUri.test.ts`、`test/unit/commands.test.ts`、`README.md` 六项均有实际改动（`git status` 一致），无「表里有但没改」或「改了但不在表」。

### 待用户确认的改动点清单

见本轮对话中展示的表（同「改动点逐条落点核验」+「gate warning 解释」）。**用户显式确认后才写 receipt。**

## 闸门 4：场景断言核对

| 测试 | 结论 | 说明 |
|------|------|------|
| T-001 | ✅ 断言匹配 | GIVEN 用 `createFakeUriApi()`（scheme `file` → `with()` 覆盖为 Codex 契约），断言 scheme/authority/path/query 四项 + 两次不同 nonce 的 query 不同；`NEW_PANEL_PATH` 常量本身也被钉住，防止与 Codex 的常量漂移 |
| T-003 | ✅ 断言匹配 | GIVEN 的 `createNonce` 依次返回 `n1`/`n2`（与 scenario 逐字一致），断言两次 `resourceKey`（scheme://authority+path+query）全等比较 + 去重后大小为 2 + path 不变 + 未调用 `chatgpt.newCodexPanel`。这是本次 bug 的核心断言，失败能力已由 RED 证明 |
| T-004 | ✅ 断言匹配（含一次修正） | scenario 的 GIVEN 是「`vscode.openWith` 抛出错误」。第一版把 fake 写成一抛就抛，导致旧实现（走 `chatgpt.newCodexPanel`）下也是绿的——**没有失败能力**。改成「只有 `vscode.openWith` 抛错」后取到红（`showErrorMessage` 0 次），再转绿。负空间断言（`resolves.toBeUndefined()`）旁边有正向断言（`showErrorMessage` 调用 1 次 + 消息含原因） |
| T-002 | ✅ 断言匹配 | 断言完整调用参数四元组（command / URI / viewType / options），不只看命令名 |
| T-005 | ⚠️ 失败能力有边界（记录在案） | 断言 `parseConversationId(新面板 URI) === null` 与 scenario 逐字对应；但它是**守卫型负空间**断言：本变更之前它也是 `null`，RED 只来自 `buildNewPanelUri` 尚未导出（模块导出缺失 ⇒ 用例无法执行） |

✅ T-005 的处置：**判定为可接受、不阻塞**（代码证据与兜底如下）——

- scenario 文本是「**WHEN** 解析该 URI 的会话 id / **THEN** 得到 `null`」，断言与该验收条件逐字对应，不存在「测了另一件事」的偏差；
- 该用例的 RED 凭据形态是「模块导出缺失导致用例无法执行」，属 build.md Step 2 认可的红因（预期行为尚不存在），不是 NPE / 夹具没建好；
- 这条边界不是只有它在守：`test/unit/openTabs.test.ts` 覆盖「未绑定会话的标签被扫出来但 id 为 `null`」，`test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` 覆盖「两个未命名标签各占一行」——三处一起才能兜住「带 query 不改变标签语义」；
- 已知的局限：若有人把 `parseConversationId` 改成对任意非 `local`/`remote` 路径返回 `'panel'`，这条断言会红，但**单独**看它无法区分「守卫被破」与「函数被删」（后者也会红）。这是负空间断言的固有边界，故记录而非判缺陷。

**跨用例委托检查**：5 个新用例均无「真实断言见 T-00x」式注释，断言都在自身用例内完成；无跨用例委托盲区。

## 人工验收（自动化无法覆盖）

用户在本机 VS Code 中实操确认：连点 `+` 能开出多个新会话面板 —— **已确认「跑通了」**。

## 遗留风险

- 本方案复刻了 Codex 的 new-panel 路由与 `newPanel` query（design D28）。若上游改路由或不再容忍 query，症状是 `+` 开出空白/异常页面；回退路径已写进 README「已知限制」。verify 阶段无法自动探测上游变更。
