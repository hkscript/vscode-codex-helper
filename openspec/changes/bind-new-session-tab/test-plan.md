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
T-107: `test/unit/tabTitleSync.test.ts::expected_title_prefers_name_and_truncates_at_thirty` 🔴 RED ✅ PASS
T-108: `test/unit/tabTitleSync.test.ts::expected_title_is_null_without_name_and_preview` 🔴 RED ✅ PASS
T-109: `test/unit/tabTitleSync.test.ts::plans_refresh_for_untitled_tab_of_a_titled_session` 🔴 RED ✅ PASS
T-110: `test/unit/tabTitleSync.test.ts::skips_running_session` 🔴 RED ✅ PASS
T-111: `test/unit/tabTitleSync.test.ts::skips_active_tab` 🔴 RED ✅ PASS
T-112: `test/unit/tabTitleSync.test.ts::skips_already_synced_target_title` 🔴 RED ✅ PASS
T-113: `test/unit/tabTitleSync.test.ts::skips_tab_that_already_has_a_custom_title` 🔴 RED ✅ PASS
T-114: `test/unit/tabTitleSync.test.ts::skips_when_running_state_is_unknown` 🔴 RED ✅ PASS
T-115: `test/unit/commands.test.ts::new_session_opens_bound_tab_when_creation_succeeds` 🔴 RED ✅ PASS
T-116: `test/unit/commands.test.ts::new_session_falls_back_to_blank_panel_when_creation_returns_null` 🔴 RED ✅ PASS
T-117: `test/unit/commands.test.ts::new_session_falls_back_to_blank_panel_when_creation_throws` 🔴 RED ✅ PASS
T-118: `test/unit/openTabs.test.ts::keeps_tab_handle_for_closing` 🔴 RED ✅ PASS
T-119: `test/unit/extension.test.ts::new_session_command_creates_bound_session_with_one_shot_process` 🔴 RED ✅ PASS
T-120: `test/unit/extension.test.ts::title_sync_reopens_untitled_tab_of_an_idle_session` 🔴 RED ✅ PASS

## 额外补充用例（写实现时发现的边界）

T-121: `test/unit/sessionCreator.test.ts::omits_cwd_when_the_workspace_has_none` ✅ PASS
T-122: `test/unit/sessionCreator.test.ts::returns_null_when_resume_fails` ✅ PASS
T-123: `test/unit/tabTitleSync.test.ts::skips_sessions_that_are_not_in_the_list` ✅ PASS
T-124: `test/unit/sessionCreator.test.ts::placeholder_git_info_is_a_non_empty_sha_so_codex_can_persist` ✅ PASS
T-125: `test/unit/extension.test.ts::new_session_still_binds_in_a_non_git_workspace` ✅ PASS
T-126: `test/unit/extension.test.ts::title_sync_runs_on_tab_change_without_reloading_the_tree` ✅ PASS
