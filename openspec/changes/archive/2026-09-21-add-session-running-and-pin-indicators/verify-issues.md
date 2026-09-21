# verify 记录：add-session-running-and-pin-indicators

- 变更：`add-session-running-and-pin-indicators`
- 环境：`/home/hk/github/vscode-codex-helper`（分支 `master`），Node + pnpm，vitest 2.1.9
- 范围：75 个测试（13 个文件）/ 35 条 test-plan 行（32 T + 3 INV）/ 41 个 scenario
- 基线：`d97b060`（`.openflow/gate.config.json` 的 `base_branch`）
- 结论：**通过**——闸门 1/2/4 通过；闸门 3 的 16 条改动点清单已由用户确认，且 2026-09-21 补 T-032 后 `src/` 相对 HEAD 零差异，声明仍逐字对齐（见「未决项」的处置记录）

## 闸门 1：全量测试

✅ 实跑 `pnpm test`（`vitest run`）（2026-09-21 补 T-032 后的复跑）：

```
 Test Files  13 passed (13)
      Tests  75 passed (75)
   Duration  576ms
```

✅ `pnpm typecheck`（`tsc --noEmit`）exit 0。
✅ `pnpm run build`（esbuild）exit 0，产物 `dist/extension.js` 30.7kb。

## 闸门 2：场景覆盖率

✅ `specs/codex-session-sidebar/spec.md` 共 41 个 `#### Scenario:`（6 个 `### Requirement:`，其中 `树视图组织与过滤` 属 `REMOVED Requirements`、0 个 scenario）。

✅ 41 = 31（本次新增/变更，由 31 条 T 行 + 3 条 INV 行一一对应）+ 10（行为不变，由既有回归用例覆盖）。逐条核对被声明为「既有覆盖」的 10 个 scenario：

| Scenario | 覆盖它的既有用例 |
|----------|------------------|
| 三组分别归位 | `sessionStore.test.ts::assigns_sessions_to_open_pinned_history_groups` |
| 空分组不渲染分组节点 | `sessionStore.test.ts::hides_empty_groups` |
| 关键词过滤只保留匹配项 | `sessionStore.test.ts::filter_keeps_only_matching_sessions` |
| 无名会话用首条消息作为显示标题 | `sessionStore.test.ts::falls_back_to_preview_when_name_is_null` |
| 置顶的会话已从服务端消失时不显示幽灵条目 | `sessionStore.test.ts::drops_pinned_session_that_no_longer_exists` |
| 已打开但不在服务端列表中的会话仍然显示 | `sessionStore.test.ts::keeps_open_tab_session_missing_from_thread_list` |
| 已打开与置顶分组默认展开 | `treeProvider.test.ts::expands_open_and_pinned_groups_by_default` |
| 置顶后写入全局状态 | `pinStore.test.ts::pins_session_into_global_state` |
| 取消置顶后从全局状态移除 | `pinStore.test.ts::unpins_session_from_global_state` |
| 首次读取时全局状态为空值 | `pinStore.test.ts::returns_empty_list_when_state_absent` |

✅ gate `check-test-plan`：`pass 35 / todo 0 / fail 0 / red_missing 0`。
✅ gate `check-cross-ref`：`35 tests, all covered by plan-ready tasks`。
✅ gate `check-verify-prerequisites`：`pass: true`，无 blockers。

## 闸门 3：设计一致性

✅ gate `check-design-consistency add-session-running-and-pin-indicators`：

```json
{ "pass": true, "design_exists": true, "design_file_count": 16, "blockers": [], "warnings": [], "change_point_verdicts": [] }
```

`change_point_verdicts` 为空（无归属漂移、无声称未落地警告）——按 verify.md，warning 为 0 **不代表**改动点都落地了，故下面逐条核验照做。

### 改动文件对账

`design.md ## 改动文件` 列 16 个路径（10 改 + 6 新增），全部出现在 `git diff d97b060...HEAD --name-only` 中，**无「表里有但没改」**：

✅ 10 个存量：`src/codex/types.ts`、`src/codex/threadApi.ts`、`src/session/sessionStore.ts`、`src/ui/treeProvider.ts`、`src/extension.ts`、`package.json`、`test/helpers/fakes.ts`、`test/unit/threadApi.test.ts`、`test/unit/sessionStore.test.ts`、`test/unit/treeProvider.test.ts`
✅ 6 个新增：`src/session/processScan.ts`、`src/session/runningState.ts`、`src/session/runningTracker.ts`、`test/unit/processScan.test.ts`、`test/unit/runningState.test.ts`、`test/unit/runningTracker.test.ts`

反向（diff 里有但不在表里）共 5 组，均可解释、非文档漂移：

- `.openflow/gate.config.json`、`.openflow/phase`——openflow 运行时状态，非本变更产物
- `openspec/changes/**`、`docs/superpowers/plans/*.md`——本变更自身的规格与计划文档
- `resources/icon.gen.py`、`resources/icon.png`——**不属于本变更**：来自 `55852fa feat: add marketplace icon` 与 `5666d9f feat: put the codex wordmark on the icon` 两个上架准备提交。它们位于基线 `d97b060` 之后，但 `d97b060` 是仓库早期提交（`git log --oneline -3 d97b060` → `d97b060 docs: add README for marketplace listing`、`04eda61 first commit`），故被划进 diff 区间。本变更的 spec/design 均未涉及图标，不属于本变更范围，无需补进文件表。

### 改动点逐条核验（固定格式）

改动点 1（声明 `src/session/sessionStore.ts::buildSessionGroups`）：代码落点 = `buildSessionGroups` 内的 `toItem(...)` 调用点 @93/@106/@114、`runningSet.has(id)` @80 → ✅
改动点 2（声明 `src/ui/treeProvider.ts::toItemNode`）：代码落点 = `getChildren` @129 `element.group.sessions.map((session) => toItemNode(session, element.group.id))` → ✅
改动点 2（声明 `src/ui/treeProvider.ts::toItemNode`，2026-09-21 amend 的 description 两行）：代码落点 = `toItemNode` 内 `cwdBasename(session.cwd)` @98 与 `const description = ...` @101 → ✅
改动点 2（声明 `src/ui/treeProvider.ts::cwdBasename`）：代码落点 = `toItemNode` 内 `cwdBasename(session.cwd)` @98 → ✅
改动点 2（声明 `src/ui/treeProvider.ts::getTreeItem`）：代码落点 = `getTreeItem` 内 `new vscode.ThemeIcon(node.session.running ? 'loading~spin' : ...)` @174-180 → ✅
改动点 3（声明 `src/codex/threadApi.ts::createThreadApi`）：代码落点 = `src/extension.ts:115` `listTurns: (threadId) => api().listTurns(threadId)` → `src/session/runningTracker.ts:132` `await deps.listTurns(thread.id)` → ✅
改动点 4（声明 `src/codex/types.ts::Thread`）：代码落点 = `src/session/runningState.ts:69` `if (!thread.path) continue;` → ✅
改动点 4（声明 `src/codex/types.ts::SessionItem`）：代码落点 = `src/session/sessionStore.ts:80` `running: runningSet.has(id)`、`src/ui/treeProvider.ts:174` `node.session.running ? ...` → ✅
改动点 5（声明 `src/session/processScan.ts::scanHeldRollouts`）：代码落点 = `src/extension.ts:113` `? scanHeldRollouts({ fs: { readdirSync, readlinkSync, readFileSync } })` → ✅
改动点 6（声明 `src/session/runningState.ts::hasNoTerminalRecord`）：代码落点 = `src/session/runningState.ts:70` `if (!hasNoTerminalRecord(turns.get(thread.id))) continue;` → ✅
改动点 6（声明 `src/session/runningState.ts::selectCandidates`）：代码落点 = `src/session/runningTracker.ts:126` `const candidates = selectCandidates({ threads, heldRollouts, nowSeconds, staleSeconds });` → ✅
改动点 6（声明 `src/session/runningState.ts::computeRunningIds`）：代码落点 = `src/session/runningTracker.ts:143` `const next = computeRunningIds({ ... });` → ✅
改动点 7（声明 `src/session/runningTracker.ts::createRunningTracker`）：代码落点 = `src/extension.ts:109` `tracker = createRunningTracker({ ... })` → ✅
改动点 7（声明 `src/extension.ts::activate`）：代码落点 = `activate` 内的 @109 `createRunningTracker(...)`、@120 `onChange: () => provider.refresh()` → ✅
改动点 7（声明 `src/extension.ts::load`）：代码落点 = `load` 内的 @96 `tracker?.update(threads)`、@101 `runningIds: tracker?.snapshot() ?? null` → ✅
改动点 7（声明 `package.json::configuration`）：代码落点 = `package.json:153/158/163` 三个新属性（`showRunningIndicator` / `runningStaleSeconds` / `runningPollSeconds`），读取点 `src/extension.ts:108/121/122` → ✅

补充核验（design 改动点 7 正文提出、未单列选择器）：`deactivate()` 已回收 tracker——`src/extension.ts:214` `runningTracker?.dispose()`，`runningTracker.ts:166-180` 的 `dispose` 清 debounce/poll 定时器与全部 watcher → ✅

## 闸门 4：场景断言核对

深度核对了三条关键路径（对应 design §6.1 / §6.3 / §6.2 的全组合不变量），并全量扫描了跨用例委托：

✅ `INV-001`（`runningState.test.ts::running_iff_no_terminal_record_and_owner_alive`）：5 状态 × 2 `completedAt` × 3 归属 × 2 新鲜度 = 60 格全遍历，期望值在测试内**独立推导**（`noTerminalRecord` / `ownerAlive` 不复用被测实现的任何分支），每格带参数化失败消息；末尾反空转护栏断言 `60 / runningCells=6 / idleCells=54`——循环若被写成不执行的假绿会被这行打红。**GIVEN 对齐**：`status='interrupted'` + `completedAt: null` 正是 scenario「跨进程读到的运行中回合编码为 interrupted 且 completedAt 为空」的夹具；design §6.1 第 2b 行（mtime 远超阈值仍判运行中）由 `stale_mtime_does_not_clear_running_when_owner_alive`（`:96`）覆盖。**失败能力**：正负两类断言都出现，非纯否定形状。

✅ `INV-003`（`treeProvider.test.ts::description_matrix_holds_for_all_cwd_and_pinned_combinations`）：4 种 cwd 形态 × 2 种置顶 = 8 格，逐格断言**完整字符串相等**（`expect.soft(...).toBe(expected)`），并额外断言 `String(description).trimEnd() === String(description)` 专钉 `📌 ` 尾随空格；走的是**真实渲染路径**（`createSessionTreeProvider` → `getChildren` → `toItemNode`），不是把 `📌 ${base}` 公式在测试里重写一遍。末尾护栏断言 `8 / withDir=4 / withoutDir=4`。**GIVEN 对齐**：`cwd = '/home/hk/github/vscode-codex-helper'` 与 scenario「条目描述显示会话所在目录的末级名称」逐字一致；`cwd = null` 一格与 scenario「没有目录信息的会话不显示描述」同构（`t8` 已打开但不在 `thread/list` 中）。

✅ `INV-002`（`sessionStore.test.ts::group_membership_matrix_holds_for_all_combinations`）：design §6.2 的 8 格全遍历，逐格断言三组成员关系，并保留「历史组与另两组互斥」这条仍成立的不变量。

✅ **跨用例委托扫描**：`grep -rn "见 T-\|见 INV-\|另一个测试\|分叉逻辑\|真实断言" test/` → 无命中，不存在「真实断言在别的用例里」的接缝。

✅ **失败能力（抛错路径）——本轮新增发现并已修复**：首轮核对发现 scenario「单个会话的回合查询失败不影响其他会话」的 GIVEN 写的是「查询**抛出错误**」，而唯一映射的 T-008 把失败建模为「turns map 缺键」，真正处理 reject 的 `src/session/runningTracker.ts:131-136` 的 try/catch 零覆盖。经 amend 补 T-032 后复核：

- **RED（变异校验）**：临时移除 `:131-136` 的 try/catch → 新用例 `throwing_turn_query_does_not_clear_other_sessions` 失败，失败信息指向异常从 `recompute`（`:130`）逃逸；**同轮全量为 `1 failed | 74 passed`**——即此前 74 条用例对这层保护全无感觉，这正是本次 amend 的理由。
- **GREEN（最小实现加回）**：还原 try/catch 后该文件 8/8 通过、全量 75/75 通过、`pnpm typecheck` exit 0。
- **净改动为 0**：`git diff` 显示 `src/session/runningTracker.ts` 与 HEAD **逐字一致**——补的是测试，不是实现。
- **断言具备失败能力**：该用例同时断言正空间（`t2` 必须在运行集合、回调必须发出 `['t2']`）与负空间（`t1` 不在），且会捕获 `void recompute()` 丢 promise 导致的 unhandled rejection；仅断言「不抛错」是单薄写法，这里不采用。

✅ 对照组检查：T-003（`:65` 循环内放 `busy` 会话并断言 `ids.has('busy') === true`）、T-004（`:83` 同形对照）、T-007（`:138`）、T-010（`:174`）都配了「同形但结论相反」的对照组，防「永远返回空集合」式假绿。

## 未决项（待用户裁定）

### 未决项 1：T-008 的 GIVEN 与 scenario 不同构——抛错路径无测试钉住 ✅ 已解决（2026-09-21 amend + build）

**处置结果**：用户确认补测试后，走 `$openflow amend`（新增 T-032 + plan-ready Task 9）→ `$openflow build`（变异取 RED → 最小实现加回 → GREEN）→ 本文件复核通过。T-008 保留原样（它钉的「数据缺失 ⇒ 非运行且隔离」是同一 scenario 的另一条真实边界，仍有失败能力），scenario 的两条路径现各有钉子。生产代码净改动为 0。

以下为发现时的原始记录（保留审计轨迹）：

- scenario（`specs/codex-session-sidebar/spec.md`）：「**单个会话的回合查询失败不影响其他会话**」——GIVEN `t1 的回合查询抛出错误`，THEN `...计算过程不向上抛错`。
- 映射的用例：`runningState.test.ts::turn_query_failure_isolates_to_that_session`（`:147`），它把「查询失败」建模为 **turns map 里缺少 t1 这个键**（注释亦自述「t1 的查询失败（turns 里没有它）」），断言 `t2` 运行 / `t1` 非运行。
- 代码事实：真正的 try/catch 在 `src/session/runningTracker.ts:131-136`（`try { turns.set(thread.id, await deps.listTurns(thread.id)) } catch { turns.set(thread.id, undefined) }`，注释标 D24）；`computeRunningIds` 收到的只是 Map，永远看不到「抛错」这件事。
- 缺口：把 `runningTracker.ts:131-136` 的 try/catch 整块删掉，现有 74 个测试**仍然全绿**——`INV-001` 遍历的是 `computeRunningIds`，`runningTracker.test.ts` 的 7 个用例用的 `listTurns` 都正常返回。即 scenario 的「查询抛出错误 → 不向上抛错」这一层没有被钉住，属 verify.md 闸门 4 所说「断言没有失败能力」的形状。
- 影响面：窄。catch 块本身只有两行、可读性无疑问，且它是本变更新写的唯一一处 D24 降级实现；但它是「单条查询失败不能带走整棵树」这条 requirement 的唯一落点。
- 建议修法（若裁定要修）：回 `$openflow build`，在 `runningTracker.test.ts` 加一条用例——`harness({ turns: async () => { throw new Error('boom'); } })` 配一个正常返回的对照组会话，断言（a）不向上抛错、（b）抛错会话不在运行集合、（c）对照组仍在运行集合。需先在 `test-plan.md` 登记新 T 行（带 `🔴 RED` 再转 `✅ PASS`）。

### 未决项 2：T-007 的 GIVEN 第二半用了「path 缺失」而非「path 指向不存在的文件」 ℹ️ 记录为不阻塞（用户未要求处置）

- scenario：「rollout 文件缺失时判定为非运行且不抛错」——GIVEN `t1 的 path 为 null，t2 的 path 指向一个不存在的文件`。
- 用例 `runningState.test.ts::missing_rollout_path_is_not_running_and_does_not_throw`（`:122`）：第一半（`path: null`）逐字同构 ✅；第二半用的是 `makeThread({ id: 't2', updatedAt: NOW })`，而 `makeThread` 默认不含 `path` 键 ⇒ 实际钉的是「`path` 字段整个缺失（旧服务端）」+ 「`t2` 仍在 heldRollouts 里但被 `!thread.path` 挡下」。
- 为什么判定为低风险而非缺陷：design §5 改动点 6 明确「不额外 stat」——不存在的文件不可能被任何进程持有，故该格由 heldRollouts 查不到（即「未持有」分支）吸收，而「未持有 ⇒ 非运行」已由 T-004 与 `INV-001` 的 `not-held` 维度覆盖；`computeRunningIds` 对该输入的行为与已覆盖分支完全同路（不碰文件系统）。
- 性质：GIVEN 措辞与夹具不完全同构，THEN 结论仍被真实覆盖。记录在案，不阻塞。

## 尚未执行

- 首轮的 receipt 已作废并由 2026-09-21 的复跑替换（T-032 写入测试文件后工作树指纹变更，旧 receipt 依设计失效）。
- `userConfirmation.received: true` 的依据：用户已显式确认 16 条改动点清单；T-032 补完后 `git diff HEAD -- src/` 为空，**声明与代码的对齐关系未发生任何变化**，故该确认继续有效。
- `archive-verified` 尚未执行——close 是用户显式触发的不可逆操作。

## 附录：发布杂务（2026-09-21，用户显式要求，不属于本变更设计范围）

用户要求为应用市场发布打包，期间改动了三个**不在 design.md `## 改动文件` 表内**的文件。它们是发布工具链产物、与本变更的功能实现无关，故未回 `$openflow amend` 扩表；此处登记以免后续 close 时对账出现无法解释的差异：

| 文件 | 性质 | 说明 |
|------|------|------|
| `.vscodeignore`（新增） | 打包配置 | 仓库原本没有该文件，vsce 会把 `src/`、`test/`、`openspec/`、`node_modules/` 一并打进 vsix。现显式排除，仅保留 `dist/extension.js` + `resources/*` + `README.md` + `package.json` + `LICENSE`。 |
| `README.md`（修改） | 上架文案 | 原文描述的是本次变更**之前**的语义（「同一个会话只会出现在一组里，优先级 `已打开 > 置顶 > 历史`」），且配置表缺 3 个新配置项、工作原理缺 `thread/turns/list`。已按当前实现重写功能/配置/原理/限制各节。marketplace 页面由 README 渲染，属发布阻塞项。 |
| `LICENSE`（新增） | 许可证 | `package.json` 声明 MIT 但仓库无许可证文本，vsce 报 warning。已补标准 MIT 全文（署名 `hkscript`，与 `publisher` 一致——**该署名是 AI 的假设**，用户未指定版权人）。 |

打包命令：`vsce package`（`@vscode/vsce` 经临时目录安装，未改动 `package.json` / 锁文件）。
产物：`vscode-codex-helper-0.0.1.vsix`，8 个文件 24.1 KB，`sha256 6d44e040b47544c984de0401ced9910714c6814b7bf6ecd11bef6127e3a16558`。
核验：解包确认 `extension/dist/extension.js`（30.72 KB，与 `pnpm run build` 产物一致）在内，`src/` / `test/` / `openspec/` / `node_modules/` 不在内；`LICENSE.txt` 与更新后的 `readme.md` 均已入包。

剩余唯一 warning：`package.json` 缺 `repository` 字段。仓库无 git remote、无任何 URL 线索，AI 无法确定真实地址；**臆造一个 URL 比保留 warning 更糟**，故留待用户提供后再补并重新打包。
