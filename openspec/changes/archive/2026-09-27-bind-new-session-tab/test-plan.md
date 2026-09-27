# 测试计划：bind-new-session-tab

框架：vitest（`pnpm test` → `vitest run`），用例位于 `test/unit/**/*.test.ts`；`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`；app-server 子进程一律用假进程逐条回包。

## 测试映射

<!--
  机器格式：每行 = 一个测试用例，`<ID>: `<测试文件>::<测试函数名>``
-->

T-101: `test/unit/sessionCreator.test.ts::creates_session_then_materializes_rollout_with_git_info` 🔴 RED ✅ PASS
T-102: `test/unit/sessionCreator.test.ts::returns_null_and_stops_when_start_fails` 🔴 RED ✅ PASS
T-103: `test/unit/sessionCreator.test.ts::returns_null_when_start_has_no_thread_id` 🔴 RED ✅ PASS
T-104: `test/unit/sessionCreator.test.ts::returns_null_without_any_request_when_git_info_is_empty` 🔴 RED ✅ PASS
T-105: `test/unit/sessionCreator.test.ts::returns_null_when_metadata_update_fails` 🔴 RED ✅ PASS
T-106: `test/unit/sessionCreator.test.ts::waits_for_child_exit_and_gives_up_after_timeout` 🔴 RED ✅ PASS
T-115: `test/unit/commands.test.ts::new_session_opens_bound_tab_when_creation_succeeds` 🔴 RED ✅ PASS
T-116: `test/unit/commands.test.ts::new_session_falls_back_to_blank_panel_when_creation_returns_null` 🔴 RED ✅ PASS
T-117: `test/unit/commands.test.ts::new_session_falls_back_to_blank_panel_when_creation_throws` 🔴 RED ✅ PASS
T-118: `test/unit/openTabs.test.ts::keeps_tab_handle_for_closing` 🔴 RED ✅ PASS
T-119: `test/unit/extension.test.ts::new_session_command_creates_bound_session_with_one_shot_process` 🔴 RED ✅ PASS

## 额外补充用例（写实现时发现的边界）

T-121: `test/unit/sessionCreator.test.ts::omits_cwd_when_the_workspace_has_none` 🔴 RED ✅ PASS
T-122: `test/unit/sessionCreator.test.ts::returns_null_when_resume_fails` 🔴 RED ✅ PASS
T-124: `test/unit/sessionCreator.test.ts::placeholder_git_info_is_a_non_empty_sha_so_codex_can_persist` 🔴 RED ✅ PASS
T-125: `test/unit/extension.test.ts::new_session_still_binds_in_a_non_git_workspace` 🔴 RED ✅ PASS

## 测试映射（2026-09-27 四次：后台自动同步 → 点击时重载）

<!--
  T-107 ~ T-114、T-120、T-126 ~ T-131 随「后台自动同步」一起删除：那套「计划 → 关标签 →
  重开 → 还焦点 → 挪位置」的机制整体退役（见下节测试影响分析）。留在这里的名字只作历史记录。
-->

T-132: `test/unit/rowOpener.test.ts::reloads_untitled_tab_instead_of_revealing` 🔴 RED ✅ PASS
T-133: `test/unit/rowOpener.test.ts::falls_back_to_reveal_when_there_is_nothing_to_reload` 🔴 RED ✅ PASS
T-134: `test/unit/rowOpener.test.ts::still_opens_when_reload_fails` 🔴 RED ✅ PASS
T-135: `test/unit/rowOpener.test.ts::archived_row_unarchives_before_reloading` 🔴 RED ✅ PASS
T-136: `test/unit/rowOpener.test.ts::does_not_reload_when_the_session_has_no_open_tab` 🔴 RED ✅ PASS
T-137: `test/unit/extension.test.ts::open_session_command_reloads_an_untitled_tab_in_place` 🔴 RED ✅ PASS
T-138: `test/unit/extension.test.ts::open_session_command_only_reveals_an_already_titled_tab` 🔴 RED ✅ PASS
T-139: `test/unit/tabTitleSync.test.ts::resource_key_covers_scheme_authority_path_query` 🔴 RED ✅ PASS
T-140: `test/unit/newSessionWatch.test.ts::refreshes_once_and_stops_when_the_session_appears` 🔴 RED ✅ PASS
T-141: `test/unit/newSessionWatch.test.ts::stops_when_the_tab_was_closed` 🔴 RED ✅ PASS
T-142: `test/unit/newSessionWatch.test.ts::gives_up_after_the_wait_cap` 🔴 RED ✅ PASS
T-143: `test/unit/newSessionWatch.test.ts::keeps_polling_when_the_list_call_fails` 🔴 RED ✅ PASS
T-144: `test/unit/newSessionWatch.test.ts::waits_for_every_pending_session` 🔴 RED ✅ PASS
T-145: `test/unit/extension.test.ts::new_session_arms_a_watch_and_refreshes_once_it_shows_up` 🔴 RED ✅ PASS

## 已退役用例（历史，不参与机器统计）

下面这些行**故意不写成机器可解析的 `T-xxx:` 行**——它们对应的断言已经从代码里删除，留着当 `✅ PASS` 等于拿旧收据报新账。保留编号只为审计追溯。

- `T-107: test/unit/tabTitleSync.test.ts::expected_title_prefers_name_and_truncates_at_thirty` ❌ 已废弃：后台自动同步退役，`expectedTabTitle` 已删除
- `T-108: test/unit/tabTitleSync.test.ts::expected_title_is_null_without_name_and_preview` ❌ 已废弃：同上
- `T-109: test/unit/tabTitleSync.test.ts::plans_refresh_for_untitled_tab_of_a_titled_session` ❌ 已废弃：`planTabTitleSync` 已删除
- `T-110: test/unit/tabTitleSync.test.ts::skips_running_session` ❌ 已废弃：同上
- `T-111: test/unit/tabTitleSync.test.ts::skips_active_tab` ❌ 已废弃：同上
- `T-112: test/unit/tabTitleSync.test.ts::skips_already_synced_target_title` ❌ 已废弃：同上
- `T-113: test/unit/tabTitleSync.test.ts::skips_tab_that_already_has_a_custom_title` ❌ 已废弃：同上
- `T-114: test/unit/tabTitleSync.test.ts::skips_when_running_state_is_unknown` ❌ 已废弃：同上
- `T-120: test/unit/extension.test.ts::title_sync_reopens_untitled_tab_of_an_idle_session` ❌ 已废弃：后台触发路径已删除，重载移到点击路径（T-132~T-137）
- `T-123: test/unit/tabTitleSync.test.ts::skips_sessions_that_are_not_in_the_list` ❌ 已废弃：`planTabTitleSync` 的候选判定已删除
- `T-126: test/unit/extension.test.ts::title_sync_runs_on_tab_change_without_reloading_the_tree` ❌ 已废弃：`onDidChangeTabs` 触发随机制退役
- `T-127: test/unit/extension.test.ts::title_sync_reopens_in_background_without_stealing_focus` ❌ 已废弃：不再后台重开
- `T-128: test/unit/extension.test.ts::title_sync_restores_focus_when_the_reopen_steals_it` ❌ 已废弃：焦点快照与归还已删除
- `T-129: test/unit/extension.test.ts::title_sync_restores_a_custom_editor_by_its_own_view_type` ❌ 已废弃：同上
- `T-130: test/unit/extension.test.ts::title_sync_puts_the_reopened_tab_back_in_place` ❌ 已废弃：位置还原改由点击路径承担（`putTabBack`）
- `T-131: test/unit/extension.test.ts::title_sync_does_not_move_tabs_when_the_reopened_one_is_not_active` ❌ 已废弃：同上（点击路径的身份核对见 `reloadUntitledTab`）

## 测试影响分析（2026-09-27 四次：去后台自动同步）

用户实测反馈两件事：① 后台重载「会闪一下」；② 新建会话要手动点刷新才出现在侧边栏。用户给出的方向是「只在点击对应会话条目时重新加载」。据此：

- **删除**后台自动同步整套：`planTabTitleSync` / `expectedTabTitle` / `TitleSyncTab|Input|Plan`（`tabTitleSync.ts` 只留 `CODEX_DEFAULT_TAB_TITLE` 与 `resourceKey`）、三条触发（`load()` / `onDidChangeTabs` / 3 秒轮询）、焦点快照与归还、`syncedTitles` 去重表。对应用例 T-107~T-114、T-120、T-126~T-131 一并删除（不是回归，是机制退役）。
- **新增**点击时重载：`rowOpener` 增加可选依赖 `reloadUntitledTab`（T-132~T-136），接线层 T-137/T-138；位置还原（`viewColumn` + `moveActiveEditor`）保留，但只在点击路径上使用。
- **新增**新建会话的等待轮询：`newSessionWatch.ts`（纯逻辑，T-140~T-144）+ 接线 T-145。它解决的是「空会话不进 `thread/list` 且无事件通知」导致的「点了 `+` 侧边栏没反应」。
- 受影响的既有用例：`rowOpener.test.ts::archived_row_unarchives_before_opening` 的调用序列多了一步 `reloadUntitledTab`（标签行总是先问一次「标题过时了吗」）；`openTabs.test.ts::scans_codex_tab_and_parses_conversation_id` 断言扫描结果完整形状，按新契约补上 `viewColumn`/`index`。

## 测试影响分析（2026-09-27：重开改为后台）

同步重开的 `openWith` 选项由 `{preserveFocus: false}`（默认）改为 `{preserveFocus: true}`，新增 scenario「后台重开不抢焦点」（T-127）。受影响的既有用例是断言重开参数的 T-120 与补充用例 T-126——两条都改成断言 `{preview:false, preserveFocus:true}`，属于契约变更而非回归。`opener` 那条路径（用户主动打开/聚焦已有标签）的 `{preview:false}` 不变，T-019 等用例不受影响。

## 测试影响分析（2026-09-27 二次：实测 preserveFocus 无效，改为还焦点）

用户实测（开发宿主，日志确认加载的是本地代码）：装了带 `preserveFocus: true` 的版本之后，切到别的文件里打字仍会被拽到 Codex 标签上 ⇒ 该选项拦不住新建编辑器被激活。改为「重开之后把焦点还给快照里的编辑器」，新增 scenario「重开抢走了焦点就把焦点还回去」「焦点没被抢走时不动用户的编辑器」与 T-128/T-129。T-127 追加一条断言（焦点没跑时不额外发命令），T-120/T-126 的重开参数断言不变（`preserveFocus: true` 仍然保留，它是减少抖动的一道保险）。`opener` 那条路径不受影响。

## 测试影响分析（2026-09-27 三次：重开之后位置也还原）

用户实测反馈「打开后 codex 标签在最后边了」⇒ 重开丢位置（组内下标 + 所在栏）。改动：`scanCodexTabs` 的产物新增 `viewColumn` / `index`（`TabGroupsSnapshot.all[].viewColumn` 一起带上），重开的 `openWith` 带 `viewColumn`，随后用内部命令 `moveActiveEditor` 挪回原下标。新增 T-130（落回原栏 + 挪回原格）与 T-131（没被激活时不动位置，防误挪用户标签）。受影响的既有用例只有 `openTabs.test.ts::scans_codex_tab_and_parses_conversation_id`——它断言扫描结果的完整形状，按新契约补上 `viewColumn`/`index` 并加了一个普通标签占位以覆盖下标含非 Codex 标签这一前提。其余用例不受影响（`toEqual` 忽略 `undefined`，没有 `viewColumn` 的快照行为不变）。

## Amendments

### 2026-09-27 五次：补齐文档缺口（不改行为）

这一轮只改文档与计划，不动代码——起因是 `$openflow` 状态检测发现 verify 无法通过：receipt 过期、`check-test-plan` 报 14 条缺红证据、`check-build-done` 报 plan-ready 没有 checkbox、`check-verify-prerequisites` 还报 design.md 缺章节与 spec delta 缺 scenario。

| 缺口 | 处理 |
|------|------|
| spec delta 用 `MODIFIED` 改了一个已改名的 requirement，对不上基线 header（`openspec archive` 会拒） | 改为 `## REMOVED Requirements`（旧名「新建会话（每次点击独立面板）」）+ `## ADDED Requirements`（新名「新建会话（直接建会话并打开绑定标签）」），旧 5 条 scenario 的去向写进 `Migration` |
| spec delta 的「标题停在 Codex 默认值的标签在点击那一行时重载」一条 scenario 都没有（`openspec validate` 报 ERROR） | 4 条 scenario 归到该 requirement 下，并按实现补「重载失败也照样把这一行打开」「会话没有打开的标签时按会话 id 打开」 |
| 「新建会话出现后自动进入侧边栏」缺边界 scenario | 补「超过等待上限就放弃」「拉列表失败不算等到了」「多个会话同时在等」 |
| design.md 缺「现状与影响面」「改动文件」两个必填章节 | 补齐（7 个改动点 + 生产/测试文档文件清单），并删掉已退役机制的残留段落（旧判定表、三条触发、`expectedTabTitle` 代码块） |
| plan-ready.md 没有任何 checkbox（`check-build-done` 报 `tasks_not_all_done`） | 重写为带 `- [x]` / `- [ ]` 的任务清单，每个 task 绑定 test-plan 的稳定 ID |
| T-107~T-114、T-120、T-123、T-126~T-131 随机制退役却仍以 `✅ PASS` 参与统计 | 移入「已退役用例（历史）」并标 `❌ 已废弃`，不再进入机器统计 |

### 测试影响分析（2026-09-27 五次：文档缺口修正）

| 测试编号 | 所属 Requirement | 影响 | 说明 |
|----------|-----------------|------|------|
| T-107~T-114 | 未标题标签的标题同步（已退役） | ❌ 废弃 | 后台自动同步退役，`planTabTitleSync` / `expectedTabTitle` 已从代码删除 |
| T-120、T-126~T-131 | 未标题标签的标题同步（已退役） | ❌ 废弃 | 同上；焦点归还与位置还原改由点击路径承担（T-132~T-137） |
| T-123 | 未标题标签的标题同步（已退役） | ❌ 废弃 | `planTabTitleSync` 的候选判定已删除 |
| T-121、T-122、T-124、T-125 | 新建会话（直接建会话并打开绑定标签） | 🔄 断言不变，缺红证据 | 断言在实现之前写好但没有留下跑红记录；build 阶段按 TDD Step 2 逐条重放红并补 `🔴 RED` |
| T-138、T-139 | 点击重载 / 标题同步工具 | 🔄 断言不变，缺红证据 | 同上 |
| T-140~T-144 | 新建会话出现后自动进入侧边栏 | 🔄 断言不变，缺红证据 | 同上 |
| T-101~T-106、T-115~T-119、T-132~T-137、T-145 | 各 requirement | 无影响 | 已带 `🔴 RED ✅ PASS`，断言未变 |

## 红证据补录（Task 8，2026-09-27）

T-121 / T-122 / T-124 / T-125 / T-138 / T-139 / T-140~T-144 这 11 条断言是在实现之前写下的，但没有留下「跑红」的记录。本轮按 TDD Step 2 逐条重放红：把对应实现临时变异 → 单跑该用例确认失败 → 精确恢复实现 → 补 `🔴 RED`。源码净改动为零（四个文件恢复后与基线 sha256 逐字一致），恢复后全量 `npx vitest run` 178/178 绿、`npx tsc --noEmit` 通过。逐条红证据：

| ID | 变异（临时） | 观察到的失败 |
|----|-------------|-------------|
| T-121 | `thread/start` 恒带 cwd | `expected { cwd: null } to deeply equal {}` |
| T-122 | 吞掉 `thread/resume` 失败 | `expected 'thread-5' to be null` |
| T-124 | `PLACEHOLDER_GIT_INFO.sha` 改空串 | `expected { sha: '' } to deeply equal { sha: '0'×40 }` |
| T-125 | extension 不再退到占位值（`{sha:''}`） | `gitInfo.sha` 期望全零、实际为空串 |
| T-138 | `reloadUntitledTab` 去掉「标题仍是 `Codex`」判定 | `expected close not to be called`（已命名标签被关掉重开） |
| T-139 | `resourceKey` 不再拼接 query | `expected '…/local/t1' to be '…/local/t1?'` |
| T-140 | `check()` 里删掉 `deps.refresh()` | `expected 1 to be… `（`refreshes` 期望 1、实际 0） |
| T-141 | 剔除逻辑删掉「标签已关」 | `expected 0 to be…`（`listCalls` 期望 0、实际 1） |
| T-142 | 剔除逻辑删掉「超过等待上限」 | 同上（超上限后仍拉列表） |
| T-143 | 拉列表失败时 `stop()` | `expected false to be true`（`scheduled` 期望 true、实际 false） |
| T-144 | 有一个出现就 `stop()` | `expected false to be true`（t2 还在等，表却停了） |
