# 测试计划：add-session-running-and-pin-indicators

框架：vitest（`pnpm test` → `vitest run`），用例位于 `test/unit/**/*.test.ts`，`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`。

## 测试映射

<!--
  机器格式（enforcement / Gate / detect 逐行解析，必须保持）：
  每行 = 一个测试用例，`<ID>: `<测试文件>::<测试函数名>``
  状态后缀可选（行尾追加）：🔴 RED / ✅ PASS / ⬜ TODO / ❌ FAIL；build 逐任务更新。
-->

T-001: `test/unit/runningState.test.ts::marks_running_when_turn_in_progress_and_owner_alive` 🔴 RED ✅ PASS
T-002: `test/unit/runningState.test.ts::marks_running_when_interrupted_without_completed_at_and_owner_alive` 🔴 RED ✅ PASS
T-003: `test/unit/runningState.test.ts::not_running_when_latest_turn_has_terminal_record` 🔴 RED ✅ PASS
T-004: `test/unit/runningState.test.ts::not_running_when_no_live_owner_holds_rollout` 🔴 RED ✅ PASS
T-005: `test/unit/runningState.test.ts::stale_mtime_does_not_clear_running_when_owner_alive` 🔴 RED ✅ PASS
T-006: `test/unit/runningState.test.ts::not_running_when_thread_has_no_turns` 🔴 RED ✅ PASS
T-007: `test/unit/runningState.test.ts::missing_rollout_path_is_not_running_and_does_not_throw` 🔴 RED ✅ PASS
T-008: `test/unit/runningState.test.ts::turn_query_failure_isolates_to_that_session` 🔴 RED ✅ PASS
T-009: `test/unit/runningState.test.ts::fallback_marks_running_within_stale_threshold` 🔴 RED ✅ PASS
T-010: `test/unit/runningState.test.ts::fallback_clears_running_beyond_stale_threshold` 🔴 RED ✅ PASS
T-011: `test/unit/runningState.test.ts::candidates_exclude_sessions_not_held_by_any_process` 🔴 RED ✅ PASS
T-012: `test/unit/threadApi.test.ts::list_turns_requests_latest_turn_in_descending_order` 🔴 RED ✅ PASS
T-013: `test/unit/processScan.test.ts::maps_rollout_file_to_holding_codex_process` 🔴 RED ✅ PASS
T-014: `test/unit/processScan.test.ts::ignores_rollout_fd_held_by_non_codex_process` 🔴 RED ✅ PASS
T-015: `test/unit/processScan.test.ts::skips_processes_that_vanish_during_scan` 🔴 RED ✅ PASS
T-016: `test/unit/runningTracker.test.ts::recomputes_and_notifies_after_rollout_write`
T-017: `test/unit/runningTracker.test.ts::debounces_multiple_writes_into_one_notification`
T-018: `test/unit/runningTracker.test.ts::does_not_notify_when_running_set_unchanged`
T-019: `test/unit/runningTracker.test.ts::falls_back_to_polling_when_watch_throws`
T-020: `test/unit/runningTracker.test.ts::releases_watchers_for_dropped_candidates`
T-021: `test/unit/runningTracker.test.ts::dispose_releases_all_watchers_and_timers`
T-022: `test/unit/sessionStore.test.ts::pinned_session_stays_in_pinned_group_when_open` 🔴 RED ✅ PASS
T-023: `test/unit/sessionStore.test.ts::unpinning_removes_pinned_row_but_keeps_open_row` 🔴 RED ✅ PASS
T-024: `test/unit/sessionStore.test.ts::marks_sessions_present_in_running_set` 🔴 RED ✅ PASS
T-025: `test/unit/treeProvider.test.ts::same_session_gets_distinct_node_ids_per_group` 🔴 RED ✅ PASS
T-026: `test/unit/treeProvider.test.ts::running_session_uses_spinner_icon` 🔴 RED ✅ PASS
T-027: `test/unit/treeProvider.test.ts::pinned_session_description_starts_with_pin_marker` 🔴 RED ✅ PASS
T-028: `test/unit/treeProvider.test.ts::open_and_pinned_item_context_value_is_pinned` 🔴 RED ✅ PASS
T-029: `test/unit/runningTracker.test.ts::stale_recompute_results_are_discarded`
INV-001: `test/unit/runningState.test.ts::running_iff_no_terminal_record_and_owner_alive` covers T-001, T-002, T-003, T-004, T-005, T-006, T-007, T-008, T-009, T-010 🔴 RED ✅ PASS
INV-002: `test/unit/sessionStore.test.ts::group_membership_matrix_holds_for_all_combinations` covers T-022, T-023 🔴 RED ✅ PASS

## 不变量说明

- **INV-001** 对 design §6.1 的四个维度（最新回合状态 × `completedAt` × 归属存活 × 平台是否可探测）做全组合遍历，每格用**独立推导**的谓词复核 `computeRunningIds` 的输出，并在末尾断言遍历计数（running 格数 / 非 running 格数），防止循环被写成永不进循环的假绿（沿用 archive lessons 的「组合不变量 + 反空转护栏」模式）。
- **INV-002** 对 design §6.2 的 (hasOpenTab × pinned × inThreadList) 8 格做全组合遍历，逐格断言三个分组的成员关系，并断言「历史组与另两组互斥」这条仍然成立的不变量。它取代既有的 `every_session_appears_in_exactly_one_group`——那条断言的「恰好出现一次」正是本次要推翻的语义。

## 既有测试的处置

| 既有测试 | 处置 | 原因 |
|----------|------|------|
| `test/unit/sessionStore.test.ts::open_group_wins_over_pinned_group` | **删除**，由 T-022 取代 | 断言「置顶组中不含已打开的会话」，与新规格直接冲突 |
| `test/unit/sessionStore.test.ts::every_session_appears_in_exactly_one_group` | **重写**为 INV-002 | 「恰好一个分组」不再成立 |
| `test/unit/treeProvider.test.ts::expands_open_and_pinned_groups_by_default` | 保留 | 折叠默认值未变 |
| 其余 8 个测试文件（binary / appServerClient / conversationUri / openTabs / pinStore / opener / commands / threadApi 既有用例） | 保留，作为回归 | 本变更不改其行为；`Thread.path` 为可选字段，不破坏 `makeThread` fixture |

## 追溯表（人工阅读用，不是解析来源）

| ID | 来源 Requirement | Scenario | 类型 |
|----|-----------------|----------|------|
| T-001 | 会话运行状态识别 | 最新回合为 inProgress 且归属进程存活时判定为运行中 | 单元 |
| T-002 | 会话运行状态识别 | 跨进程读到的运行中回合编码为 interrupted 且 completedAt 为空 | 单元 |
| T-003 | 会话运行状态识别 | 最新回合已终止时判定为非运行 | 单元 |
| T-004 | 会话运行状态识别 | 无终止记录但没有存活进程持有时判定为非运行 | 单元 |
| T-005 | 会话运行状态识别 | 长时间无写入不改变运行判定 | 单元 |
| T-006 | 会话运行状态识别 | 没有任何回合记录的会话判定为非运行 | 单元 |
| T-007 | 会话运行状态识别 | rollout 文件缺失时判定为非运行且不抛错 | 单元 |
| T-008 | 会话运行状态识别 | 单个会话的回合查询失败不影响其他会话 | 单元 |
| T-009 | 会话运行状态识别 | 无法探测进程归属的平台在阈值内视为运行中 | 单元 |
| T-010 | 会话运行状态识别 | 无法探测进程归属的平台超过阈值视为非运行 | 单元 |
| T-011 | 会话运行状态识别 | 未被任何进程持有的会话不发起回合查询 | 单元 |
| T-012 | 会话运行状态识别 | 回合查询使用最新一条且按降序排序 | 单元 |
| T-013 | rollout 文件归属探测 | 扫描出持有 rollout 文件的 codex 进程 | 单元 |
| T-014 | rollout 文件归属探测 | 非 codex 进程持有的 rollout 文件被忽略 | 单元 |
| T-015 | rollout 文件归属探测 | 扫描过程中进程消失不影响其余结果 | 单元 |
| T-016 | 运行状态自动刷新 | rollout 文件写入后自动重算并刷新 | 单元 |
| T-017 | 运行状态自动刷新 | 去抖窗口内的多次写入只触发一次回调 | 单元 |
| T-018 | 运行状态自动刷新 | 运行集合未变化时不触发回调 | 单元 |
| T-019 | 运行状态自动刷新 | 监听建立失败时退化为轮询 | 单元 |
| T-020 | 运行状态自动刷新 | 候选集合变化时释放不再需要的监听 | 单元 |
| T-021 | 运行状态自动刷新 | 释放追踪器时回收全部监听与定时器 | 单元 |
| T-022 | 树视图组织、状态标识与过滤 | 置顶会话被打开后仍保留在置顶组 | 单元 |
| T-023 | 会话置顶 | 取消置顶后已打开的那一行仍然保留 | 单元 |
| T-024 | 树视图组织、状态标识与过滤 | 运行状态随会话数据一起传递给条目 | 单元 |
| T-025 | 树视图组织、状态标识与过滤 | 同一会话在两组中的树节点 id 不同 | 单元 |
| T-026 | 树视图组织、状态标识与过滤 | 运行中的条目使用运行图标 | 单元 |
| T-027 | 树视图组织、状态标识与过滤 | 置顶的条目显示置顶标识 | 单元 |
| T-028 | 树视图组织、状态标识与过滤 | 已打开且已置顶的条目右键菜单给出取消置顶 | 单元 |
| T-029 | 运行状态自动刷新 | 重入的重算只采用最新一轮结果 | 单元 |
| INV-001 | 会话运行状态识别 | design §6.1 全组合 | 不变量 |
| INV-002 | 树视图组织、状态标识与过滤 | design §6.2 全组合 | 不变量 |

**既有覆盖（本次不新增用例，靠现有回归守住）**：`三组分别归位`、`空分组不渲染分组节点`、`关键词过滤只保留匹配项`、`无名会话用首条消息作为显示标题`、`置顶的会话已从服务端消失时不显示幽灵条目`、`已打开但不在服务端列表中的会话仍然显示`、`已打开与置顶分组默认展开`、`会话置顶` 的三个既有 scenario——它们的行为在本变更中不变，已由 `test/unit/sessionStore.test.ts`、`test/unit/treeProvider.test.ts`、`test/unit/pinStore.test.ts` 的现存用例覆盖。

## 统计

- 本变更 scenario 总数：39（新增/变更 29，行为不变沿用既有覆盖 10）
- 新增测试用例：29 个 T + 2 个 INV
- 涉及测试文件：6（新增 3：`runningState` / `processScan` / `runningTracker`；改动 3：`threadApi` / `sessionStore` / `treeProvider`）
