# bind-new-session-tab Task 8（补齐红证据）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 11 条「断言已写、实现已写、但没有留下跑红记录」的用例补上 `🔴 RED` 证据——把对应实现临时退回/摘掉，亲眼看它失败，再恢复实现。

**Architecture:** 纯证据补录，不改变任何产品行为。每个文件组：一次性施加该组的变异（mutation）→ 用 `npx vitest run <文件> -t <用例名>` 逐条跑出失败并留档 → 一次性精确恢复 → 最后跑全量套件确认绿。

**Tech Stack:** TypeScript + vitest（`npx vitest run`，用例在 `test/unit/**`），gate 校验脚本 `~/.codex/hooks/openflow-gate.mjs`。

**Spec:** `openspec/changes/bind-new-session-tab/specs/codex-session-sidebar/spec.md`；执行计划 `openspec/changes/bind-new-session-tab/plan-ready.md`（Task 8）；测试计划 `openspec/changes/bind-new-session-tab/test-plan.md`。

## Global Constraints

- 每个 `✅ PASS` 行必须同时带 `🔴 RED`，且 `🔴 RED` 只能来自**实际观察到的失败**（gate 的 `red_evidence_missing` 检查）。
- 本轮**不得改变产品行为**：所有变异都必须在同一个 task 内精确恢复，结束时 `git status` 里 src/ 的改动必须与开始前逐字一致。
- 测试选择器一律写稳定 ID（`T-1xx`），与 `test-plan.md` 一对一。
- 变异只允许出现在 Task 8 声明的文件里：`src/session/sessionCreator.ts`、`src/session/tabTitleSync.ts`、`src/session/newSessionWatch.ts`、`src/extension.ts`。

## Review Focus

- 某条用例在实现被摘掉后**仍然是绿的**：说明这条断言没有失败能力（例如只钉了负空间），这是本轮唯一可能产生的实质发现，必须补强断言而不是照抄 `🔴 RED`。
- 变异是否真的打到了那条断言依赖的行为：打偏了会得到「红」，但证明的不是这条用例的失败能力。
- 恢复是否逐字精确：残留的变异会被后续 verify 当成真实实现。
- 单跑与全量跑的一致性：单跑红、全量绿才是「实现恢复正确」的证据。
- 隔离性：同一文件组内多条变异同时存在时，某条用例的红可能来自邻居的变异——每条失败输出里必须能读出它自己的断言没被满足。

---

### Task 8: 补齐 11 条用例的 `🔴 RED`

**Files:**

- Modify: `src/session/sessionCreator.ts`（临时变异 T-121/T-122/T-124，随后恢复）
- Modify: `src/session/tabTitleSync.ts`（临时变异 T-139，随后恢复）
- Modify: `src/session/newSessionWatch.ts`（临时变异 T-140~T-144，随后恢复）
- Modify: `src/extension.ts`（临时变异 T-125/T-138，随后恢复）
- Modify: `openspec/changes/bind-new-session-tab/test-plan.md`（11 行追加 `🔴 RED`）

**Interfaces:**

- Consumes: `createBoundSession(client, {cwd, gitInfo})`、`PLACEHOLDER_GIT_INFO`（`src/session/sessionCreator.ts`）；`resourceKey(uri)`（`src/session/tabTitleSync.ts`）；`createNewSessionWatch(deps)`（`src/session/newSessionWatch.ts`）；`reloadUntitledTab(uri)`（`src/extension.ts`）
- Produces: test-plan.md 中 11 行带 `🔴 RED ✅ PASS`，`check-test-plan` 报 `pass: true`

**变异清单（每条对应一个稳定 ID）**

| ID | 文件 | 变异 |
|----|------|------|
| T-121 | sessionCreator.ts | `thread/start` 参数改为恒带 cwd：`{ cwd: options.cwd }` |
| T-122 | sessionCreator.ts | `thread/resume` 的失败被 try/catch 吞掉，照常返回 id |
| T-124 | sessionCreator.ts | `PLACEHOLDER_GIT_INFO` 的 sha 改成空串 |
| T-139 | tabTitleSync.ts | `resourceKey` 不再拼接 `query` |
| T-140 | newSessionWatch.ts | `check()` 里删掉 `deps.refresh()` |
| T-141 | newSessionWatch.ts | 剔除逻辑里删掉「标签已关」这一条 |
| T-142 | newSessionWatch.ts | 剔除逻辑里删掉「超过等待上限」这一条 |
| T-143 | newSessionWatch.ts | 拉列表失败时 `stop()` 而不是等下一拍 |
| T-144 | newSessionWatch.ts | 只要有一个会话出现就 `stop()`（不再等其他在等的会话） |
| T-125 | extension.ts | 探测不到 gitInfo 时返回 `null`（不再退到全零 sha 占位） |
| T-138 | extension.ts | `reloadUntitledTab` 删掉「标题仍是 `Codex`」这一条判定 |

- [ ] **Step 1: 记录基线**（`git stash list` 为空、`git status --short` 存底），确保恢复后能逐字比对
- [ ] **Step 2: A 组变异**（sessionCreator.ts 三条）→ 跑 T-121 / T-122 / T-124 三条用例，各留失败输出
- [ ] **Step 3: A 组恢复** → `npx vitest run test/unit/sessionCreator.test.ts` 必须全绿
- [ ] **Step 4: B 组变异**（tabTitleSync.ts）→ 跑 T-139 留失败输出 → 恢复 → 该文件全绿
- [ ] **Step 5: C 组变异**（newSessionWatch.ts 五条）→ 逐条跑 T-140~T-144 留失败输出 → 恢复 → 该文件全绿
- [ ] **Step 6: D 组变异**（extension.ts 两条）→ 跑 T-125 / T-138 留失败输出 → 恢复 → 该文件全绿
- [ ] **Step 7: 全量验证**：`npx vitest run` + `npx tsc --noEmit` 全绿，且 `git diff --stat src/` 与基线一致
- [ ] **Step 8: 更新 test-plan.md**：11 行追加 `🔴 RED`（去掉「待补红证据」），跑 `check-test-plan` 必须 `pass: true`
- [ ] **Step 9: 收尾**：`plan-ready.md` 的 Task 8 勾成 `- [x]`，重跑 `check-build-done`

### Task 8 的异常分支

- 某条用例变异后仍为绿 ⇒ 停下，把该断言补强（在**声明范围内**的测试文件里），重新走 Step 2 的「观察失败」，再恢复实现。
- 恢复后该用例转红 ⇒ 恢复不精确，用 `git diff` 逐行核对，直到全绿。
