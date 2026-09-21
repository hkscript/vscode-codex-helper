# 实现计划：add-session-running-and-pin-indicators

## 来源
- 提案：openspec/changes/add-session-running-and-pin-indicators/proposal.md
- 设计：openspec/changes/add-session-running-and-pin-indicators/design.md
- 规格：openspec/changes/add-session-running-and-pin-indicators/specs/
- 任务：openspec/changes/add-session-running-and-pin-indicators/tasks.md
- 测试计划：openspec/changes/add-session-running-and-pin-indicators/test-plan.md

## 执行前置

1. **先配基准分支**（archive lessons 坑 1）：本仓库只有 `master` 一个 ref，gate 的基准探测会取到 `master` 导致 `git diff master...HEAD` 为空、改动点归属对账整段空转。build 开始时写：
   ```bash
   printf '%s\n' '{"base_branch":"d97b060"}' > .openflow/gate.config.json
   ```
   `d97b060` 是本变更开工前的 HEAD（`[Verified]` `git log` 最新提交 `docs: add README for marketplace listing`）。
2. 每个 task 的 `Files` 都显式包含 `test-plan.md` 与 `plan-ready.md`——build 要求写回 `🔴 RED` / `✅ PASS` 后缀与 checkbox，不声明会被 enforcement 拦截（archive lessons 坑 2 的处置方式：显式声明而不是绕过 hook）。
3. 验证命令统一为 `pnpm test`（`vitest run`）与 `pnpm typecheck`（`tsc --noEmit`）。

### Task 1: 类型扩展与回合列表 API
- 目标：给 `Thread` 补 `path`、新增 `Turn` / `TurnStatus`、给 `SessionItem` 补 `running`，并在 `ThreadApi` 上新增 `listTurns`
- Test cases: T-012
- Files: `src/codex/types.ts`, `src/codex/threadApi.ts`, `test/helpers/fakes.ts`, `test/unit/threadApi.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/codex/types.ts` [Verified]、`src/codex/threadApi.ts` [Verified]、`test/helpers/fakes.ts` [Verified]（补 `makeTurn` fixture，供 Task 3/6 造回合数据）、`test/unit/threadApi.test.ts` [Verified]
- 覆盖场景：T-012
- 测试先行：先写 `test/unit/threadApi.test.ts::list_turns_requests_latest_turn_in_descending_order`，断言请求方法 `thread/turns/list`、参数 `{threadId, limit: 1, sortDirection: 'desc'}`、空列表返回 `undefined`
- 验证方式：`pnpm test -- threadApi` 先红后绿；`pnpm typecheck` 通过
- 确定性：[Verified]（三个文件均已存在，`sortDirection` 取值经 probe 实测）
- [x] 类型扩展与回合列表 API

### Task 2: 进程归属扫描
- 目标：新增 `scanHeldRollouts`，从注入的 fs 读 `/proc`，得出 `Map<threadId, pid>`，单点失败即跳过
- Test cases: T-013, T-014, T-015
- Files: `src/session/processScan.ts`, `test/unit/processScan.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/session/processScan.ts` [Inferred: 新增文件]、`test/unit/processScan.test.ts` [Inferred: 新增文件]
- 覆盖场景：T-013, T-014, T-015
- 测试先行：先写 `test/unit/processScan.test.ts::maps_rollout_file_to_holding_codex_process`，用假的 `readdirSync` / `readlinkSync` / `readFileSync` 构造 `/proc` 快照（cmdline 同含 `codex` 与 `app-server`，fd 软链指向 `rollout-2026-09-21T13-08-48-<uuid>.jsonl`）
- 验证方式：`pnpm test -- processScan` 先红后绿
- 确定性：[Verified]（扫描规则在 proposal 阶段用真实 `/proc` 实测通过，本 task 只是把它搬进注入式实现）
- [x] 进程归属扫描

### Task 3: 运行状态纯函数
- 目标：实现 `hasNoTerminalRecord` / `selectCandidates` / `computeRunningIds`，落地 D14/D15/D16/D18 的判定与降级
- Test cases: T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, INV-001
- Files: `src/session/runningState.ts`, `test/unit/runningState.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/session/runningState.ts` [Inferred: 新增文件]、`test/unit/runningState.test.ts` [Inferred: 新增文件]
- 覆盖场景：T-001~T-011, INV-001
- 测试先行：先写 `test/unit/runningState.test.ts::marks_running_when_turn_in_progress_and_owner_alive`；INV-001 最后写，遍历 design §6.1 全组合并带遍历计数护栏
- 验证方式：`pnpm test -- runningState` 先红后绿；INV-001 断言 running / 非 running 的格数与 design §6.1 表一致
- 确定性：[Verified]（判定谓词的每条编码都由 proposal 的 probe 实测支撑）
- [x] 运行状态纯函数

### Task 4: 分组规则改为非互斥并透传运行标记
- 目标：`buildSessionGroups` 的 `taken` 降级为「历史组排除集」，pinned 段不再被 open 掏空；新增 `runningIds` 入参落到 `SessionItem.running`
- Test cases: T-022, T-023, T-024, INV-002
- Files: `src/session/sessionStore.ts`, `test/unit/sessionStore.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/session/sessionStore.ts` [Verified]、`test/unit/sessionStore.test.ts` [Verified]
- 覆盖场景：T-022, T-023, T-024, INV-002
- 测试先行：先写 `test/unit/sessionStore.test.ts::pinned_session_stays_in_pinned_group_when_open`（当前实现下必红）；同一提交内删除 `open_group_wins_over_pinned_group`、把 `every_session_appears_in_exactly_one_group` 重写为 INV-002
- 验证方式：`pnpm test -- sessionStore` 先红后绿；确认「幽灵置顶丢弃」与「历史组互斥」两条既有行为在 INV-002 中仍为真
- 确定性：[Verified]
- [x] 分组规则改为非互斥并透传运行标记

### Task 5: 树条目的 id、图标、描述与 contextValue
- 目标：节点 id 加分组段、running 用 `loading~spin` 图标、pinned 在 description 加 `📌`、contextValue 改为 pinned 优先
- Test cases: T-025, T-026, T-027, T-028
- Files: `src/ui/treeProvider.ts`, `test/unit/treeProvider.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/ui/treeProvider.ts` [Verified]、`test/unit/treeProvider.test.ts` [Verified]
- 覆盖场景：T-025, T-026, T-027, T-028
- 测试先行：先写 `test/unit/treeProvider.test.ts::same_session_gets_distinct_node_ids_per_group`
- 验证方式：`pnpm test -- treeProvider` 先红后绿；人工核对 `package.json` 的 pin/unpin `when` 表达式在新 contextValue 下语义仍正确（D22，不改文件）
- 确定性：[Verified]（依赖 Task 4 产出的双行分组）
- [ ] 树条目的 id、图标、描述与 contextValue

### Task 6: 运行状态追踪器（监听 + 去抖 + 轮询兜底）
- 目标：实现 `createRunningTracker`：扫描 → 候选 → 查询 → 计算 → `fs.watch` 去抖重算；watch 抛错退化轮询；重入用代际号丢弃迟到结果；`dispose` 回收全部句柄
- Test cases: T-016, T-017, T-019, T-020, T-021, T-029
- Files: `src/session/runningTracker.ts`, `test/unit/runningTracker.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/session/runningTracker.ts` [Inferred: 新增文件]、`test/unit/runningTracker.test.ts` [Inferred: 新增文件]
- 覆盖场景：T-016, T-017, T-019, T-020, T-021, T-029
- 测试先行：先写 `test/unit/runningTracker.test.ts::recomputes_and_notifies_after_rollout_write`，用注入的假 watch / 假定时器（`vi.useFakeTimers`）驱动去抖
- 验证方式：`pnpm test -- runningTracker` 先红后绿
- 确定性：[Inferred]（依赖 Task 2/3 的接口形状，实现顺序上必须排在它们之后）
- [ ] 运行状态追踪器（监听 + 去抖 + 轮询兜底）

### Task 7: 接线、自激防护与配置项
- 目标：在 `activate` 里构造追踪器并接到 `provider.refresh`，`load()` 把运行集合传进 `buildSessionGroups`，`deactivate` 回收追踪器；新增 3 个配置项；落地 D23「集合未变化不回调」
- Test cases: T-018
- Files: `src/extension.ts`, `package.json`, `src/session/runningTracker.ts`, `test/unit/runningTracker.test.ts`, `openspec/changes/add-session-running-and-pin-indicators/test-plan.md`, `openspec/changes/add-session-running-and-pin-indicators/plan-ready.md`
- 改动文件：`src/extension.ts` [Verified]、`package.json` [Verified]、`src/session/runningTracker.ts` [Inferred: Task 6 新建]、`test/unit/runningTracker.test.ts` [Inferred: Task 6 新建]
- 覆盖场景：T-018
- 测试先行：先写 `test/unit/runningTracker.test.ts::does_not_notify_when_running_set_unchanged`——这是 `refresh → load → update → refresh` 自激的唯一防线
- 验证方式：`pnpm test` 全量绿；`pnpm typecheck` 通过；`pnpm build` 成功。新增配置项：`codexHelper.showRunningIndicator`（boolean，默认 `true`）、`codexHelper.runningStaleSeconds`（number，默认 `300`，仅用于无法探测进程归属的平台）、`codexHelper.runningPollSeconds`（number，默认 `5`，`0` 表示关闭兜底轮询）
- 确定性：[Verified]（`extension.ts:80-94` 的 `load`、`:120-171` 的 subscriptions、`:180-185` 的 `deactivate`、`package.json:130-152` 的 configuration 均已确认）
- [ ] 接线、自激防护与配置项

## 依赖顺序

```
Task 1（类型 + API）
   ├─► Task 3（运行判定，用到 Turn 类型）
   │        ▲
   └─► Task 2（进程扫描）┘
Task 4（分组，用到 SessionItem.running）
   └─► Task 5（条目呈现，依赖双行分组）
Task 3 + Task 2 ─► Task 6（追踪器）─► Task 7（接线）
```

## 人工验收（非自动化，build 完成后在真实窗口确认）

1. 打开一个 Codex 会话并发起一条耗时回合 → 侧边栏该条目出现运行图标；回合结束后图标恢复。
2. 置顶一个会话再打开它 → 「已打开」与「置顶」两组各有一行，两行都带 `📌`，右键都给「取消置顶」。
3. 取消置顶 → 「置顶」组那行消失，「已打开」组那行保留且 `📌` 消失。
