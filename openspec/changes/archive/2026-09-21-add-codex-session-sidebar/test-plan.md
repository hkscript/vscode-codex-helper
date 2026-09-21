# 测试计划：add-codex-session-sidebar

<!-- TEST_DIR_HINT: test/unit/ -->
<!-- 测试框架：vitest（全新工程，本变更一并引入）。测试函数名即 it('<名字>') 的字符串字面量。 -->

## 测试映射

<!--
  机器格式（enforcement / Gate / detect 逐行解析，必须保持）：
  每行 = 一个测试用例，`<ID>: `<测试文件>::<测试函数名>``
  状态后缀可选（行尾追加）：🔴 RED / ✅ PASS / ⬜ TODO / ❌ FAIL
-->

T-001: `test/unit/binary.test.ts::resolves_binary_from_codex_extension_path` 🔴 RED ✅ PASS
T-002: `test/unit/binary.test.ts::config_executable_overrides_extension_path` 🔴 RED ✅ PASS
T-003: `test/unit/binary.test.ts::throws_with_extension_id_when_codex_missing` 🔴 RED ✅ PASS
T-004: `test/unit/appServerClient.test.ts::sends_initialize_as_first_message` 🔴 RED ✅ PASS
T-005: `test/unit/appServerClient.test.ts::reassembles_message_split_across_chunks` 🔴 RED ✅ PASS
T-006: `test/unit/appServerClient.test.ts::dispatches_multiple_messages_in_one_chunk` 🔴 RED ✅ PASS
T-007: `test/unit/appServerClient.test.ts::ignores_notifications_without_id` 🔴 RED ✅ PASS
T-008: `test/unit/appServerClient.test.ts::rejects_request_on_server_error` 🔴 RED ✅ PASS
T-009: `test/unit/appServerClient.test.ts::rejects_request_on_timeout_and_clears_entry` 🔴 RED ✅ PASS
T-010: `test/unit/appServerClient.test.ts::dispose_kills_process_and_rejects_pending` 🔴 RED ✅ PASS
T-011: `test/unit/threadApi.test.ts::lists_threads_sorted_by_updated_at_excluding_archived` 🔴 RED ✅ PASS
T-012: `test/unit/threadApi.test.ts::passes_search_term_to_server` 🔴 RED ✅ PASS
T-013: `test/unit/threadApi.test.ts::passes_workspace_cwd_when_filter_enabled` 🔴 RED ✅ PASS
T-014: `test/unit/threadApi.test.ts::passes_cursor_for_next_page` 🔴 RED ✅ PASS
T-015: `test/unit/openTabs.test.ts::scans_codex_tab_and_parses_conversation_id` 🔴 RED ✅ PASS
T-016: `test/unit/openTabs.test.ts::ignores_non_codex_tabs` 🔴 RED ✅ PASS
T-017: `test/unit/openTabs.test.ts::keeps_new_panel_tab_with_null_conversation_id` 🔴 RED ✅ PASS
T-018: `test/unit/opener.test.ts::opens_session_with_conversation_uri_and_view_type` 🔴 RED ✅ PASS
T-019: `test/unit/conversationUri.test.ts::conversation_uri_roundtrips_and_rejects_foreign_uri` 🔴 RED ✅ PASS
T-020: `test/unit/opener.test.ts::shows_error_and_never_creates_new_panel_on_open_failure` 🔴 RED ✅ PASS
T-021: `test/unit/commands.test.ts::sets_thread_name_on_rename` 🔴 RED ✅ PASS
T-022: `test/unit/commands.test.ts::skips_rpc_when_rename_cancelled` 🔴 RED ✅ PASS
T-023: `test/unit/commands.test.ts::shows_error_when_rename_rpc_fails` 🔴 RED ✅ PASS
T-024: `test/unit/pinStore.test.ts::pins_session_into_global_state` 🔴 RED ✅ PASS
T-025: `test/unit/pinStore.test.ts::unpins_session_from_global_state` 🔴 RED ✅ PASS
T-026: `test/unit/pinStore.test.ts::returns_empty_list_when_state_absent` 🔴 RED ✅ PASS
T-027: `test/unit/sessionStore.test.ts::assigns_sessions_to_open_pinned_history_groups` 🔴 RED ✅ PASS
T-028: `test/unit/sessionStore.test.ts::open_group_wins_over_pinned_group` 🔴 RED ✅ PASS
T-029: `test/unit/sessionStore.test.ts::hides_empty_groups` 🔴 RED ✅ PASS
T-030: `test/unit/sessionStore.test.ts::filter_keeps_only_matching_sessions` 🔴 RED ✅ PASS
T-031: `test/unit/sessionStore.test.ts::falls_back_to_preview_when_name_is_null` 🔴 RED ✅ PASS
T-032: `test/unit/treeProvider.test.ts::shows_error_node_with_retry_command_on_load_failure` 🔴 RED ✅ PASS
T-033: `test/unit/treeProvider.test.ts::replaces_error_node_with_sessions_after_retry` 🔴 RED ✅ PASS
T-034: `test/unit/binary.test.ts::falls_back_to_codex_cli_executable_setting` 🔴 RED ✅ PASS
T-035: `test/unit/sessionStore.test.ts::drops_pinned_session_that_no_longer_exists` 🔴 RED ✅ PASS
T-036: `test/unit/sessionStore.test.ts::keeps_open_tab_session_missing_from_thread_list` 🔴 RED ✅ PASS
T-037: `test/unit/commands.test.ts::calls_new_codex_panel_once` 🔴 RED ✅ PASS
T-038: `test/unit/commands.test.ts::shows_error_when_new_session_command_fails` 🔴 RED ✅ PASS
T-039: `test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` 🔴 RED ✅ PASS
T-040: `test/unit/treeProvider.test.ts::expands_open_and_pinned_groups_by_default` 🔴 RED ✅ PASS
INV-001: `test/unit/sessionStore.test.ts::every_session_appears_in_exactly_one_group` covers T-027, T-028, T-029, T-035, T-036 🔴 RED ✅ PASS
INV-002: `test/unit/sessionStore.test.ts::every_rendered_session_matches_active_filter` covers T-030, T-031 🔴 RED ✅ PASS

## 不变量说明

- **INV-001**：对任意 (有无已打开标签 × 是否置顶 × 是否在 thread 列表中) 组合，任一会话 id 在构建结果的全部分组中**恰好出现一次或零次**，绝不出现两次。这是 D8 分组优先级的全称形式——`T-027`/`T-028`/`T-029` 只钉了三个具体格子，组合矩阵的其余格子靠它兜底。
- **INV-002**：对任意过滤关键词与任意分组，构建结果中出现的每一个会话都满足 `matchesFilter(session, keyword)`。因为历史组走服务端 `searchTerm`、已打开/置顶组走本地过滤（D7），两条路径的判定必须收敛到同一个谓词，否则会出现「搜索后仍显示不匹配项」。

## 追溯表

| ID | 来源 Requirement | Scenario | 测试文件::测试函数 | 类型 |
|----|-----------------|----------|-------------------|------|
| T-001 | Codex 可执行文件定位 | 从 Codex 插件安装目录解析二进制路径 | `test/unit/binary.test.ts::resolves_binary_from_codex_extension_path` | 单元 |
| T-002 | Codex 可执行文件定位 | 用户配置优先于插件目录 | `test/unit/binary.test.ts::config_executable_overrides_extension_path` | 单元 |
| T-034 | Codex 可执行文件定位 | 回退到 Codex 自身的 cliExecutable 配置 | `test/unit/binary.test.ts::falls_back_to_codex_cli_executable_setting` | 单元 |
| T-003 | Codex 可执行文件定位 | Codex 插件未安装时报出可诊断的错误 | `test/unit/binary.test.ts::throws_with_extension_id_when_codex_missing` | 单元 |
| T-004 | app-server JSON-RPC 客户端 | 先握手再放行业务请求 | `test/unit/appServerClient.test.ts::sends_initialize_as_first_message` | 单元 |
| T-005 | app-server JSON-RPC 客户端 | 跨 chunk 的半条消息能被正确拼接 | `test/unit/appServerClient.test.ts::reassembles_message_split_across_chunks` | 单元 |
| T-006 | app-server JSON-RPC 客户端 | 一个 chunk 含多条消息时逐条分发 | `test/unit/appServerClient.test.ts::dispatches_multiple_messages_in_one_chunk` | 单元 |
| T-007 | app-server JSON-RPC 客户端 | 无 id 的通知不影响请求路由 | `test/unit/appServerClient.test.ts::ignores_notifications_without_id` | 单元 |
| T-008 | app-server JSON-RPC 客户端 | 服务端返回 error 时请求被拒绝 | `test/unit/appServerClient.test.ts::rejects_request_on_server_error` | 单元 |
| T-009 | app-server JSON-RPC 客户端 | 请求超时被拒绝且不再占用路由表 | `test/unit/appServerClient.test.ts::rejects_request_on_timeout_and_clears_entry` | 单元 |
| T-010 | app-server JSON-RPC 客户端 | dispose 杀死子进程并拒绝所有在途请求 | `test/unit/appServerClient.test.ts::dispose_kills_process_and_rejects_pending` | 单元 |
| T-011 | 会话列表读取 | 默认按最近更新倒序且排除归档 | `test/unit/threadApi.test.ts::lists_threads_sorted_by_updated_at_excluding_archived` | 单元 |
| T-012 | 会话列表读取 | 关键词透传给服务端 | `test/unit/threadApi.test.ts::passes_search_term_to_server` | 单元 |
| T-013 | 会话列表读取 | 开启工作区过滤时传入 cwd | `test/unit/threadApi.test.ts::passes_workspace_cwd_when_filter_enabled` | 单元 |
| T-014 | 会话列表读取 | 用 nextCursor 翻页 | `test/unit/threadApi.test.ts::passes_cursor_for_next_page` | 单元 |
| T-015 | 已打开标签页识别 | 识别 Codex 会话标签并解析 id | `test/unit/openTabs.test.ts::scans_codex_tab_and_parses_conversation_id` | 单元 |
| T-016 | 已打开标签页识别 | 忽略非 Codex 标签 | `test/unit/openTabs.test.ts::ignores_non_codex_tabs` | 单元 |
| T-017 | 已打开标签页识别 | 新建但尚未绑定会话的标签保留为未命名项 | `test/unit/openTabs.test.ts::keeps_new_panel_tab_with_null_conversation_id` | 单元 |
| T-018 | 会话打开与聚焦 | 用正确的 URI 与 viewType 打开会话 | `test/unit/opener.test.ts::opens_session_with_conversation_uri_and_view_type` | 集成 |
| T-019 | 会话打开与聚焦 | 会话 URI 与 Codex 的解析规则互逆 | `test/unit/conversationUri.test.ts::conversation_uri_roundtrips_and_rejects_foreign_uri` | 单元 |
| T-020 | 会话打开与聚焦 | 打开失败时报错且不新建会话 | `test/unit/opener.test.ts::shows_error_and_never_creates_new_panel_on_open_failure` | 集成 |
| T-037 | 新建会话 | 执行命令时调用 Codex 的新建面板命令 | `test/unit/commands.test.ts::calls_new_codex_panel_once` | 集成 |
| T-038 | 新建会话 | 新建失败时提示错误 | `test/unit/commands.test.ts::shows_error_when_new_session_command_fails` | 集成 |
| T-039 | 新建会话 | 尚未绑定会话的新建标签以未命名项出现在「已打开」组 | `test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` | 单元 |
| T-021 | 会话重命名 | 输入新名字后写回 Codex | `test/unit/commands.test.ts::sets_thread_name_on_rename` | 集成 |
| T-022 | 会话重命名 | 用户取消输入时不发请求 | `test/unit/commands.test.ts::skips_rpc_when_rename_cancelled` | 集成 |
| T-023 | 会话重命名 | 重命名失败时提示错误 | `test/unit/commands.test.ts::shows_error_when_rename_rpc_fails` | 集成 |
| T-024 | 会话置顶 | 置顶后写入全局状态 | `test/unit/pinStore.test.ts::pins_session_into_global_state` | 单元 |
| T-025 | 会话置顶 | 取消置顶后从全局状态移除 | `test/unit/pinStore.test.ts::unpins_session_from_global_state` | 单元 |
| T-026 | 会话置顶 | 首次读取时全局状态为空值 | `test/unit/pinStore.test.ts::returns_empty_list_when_state_absent` | 单元 |
| T-027 | 树视图组织与过滤 | 三组分别归位 | `test/unit/sessionStore.test.ts::assigns_sessions_to_open_pinned_history_groups` | 单元 |
| T-028 | 树视图组织与过滤 | 已打开优先于置顶，不重复出现 | `test/unit/sessionStore.test.ts::open_group_wins_over_pinned_group` | 单元 |
| T-029 | 树视图组织与过滤 | 空分组不渲染分组节点 | `test/unit/sessionStore.test.ts::hides_empty_groups` | 单元 |
| T-030 | 树视图组织与过滤 | 关键词过滤只保留匹配项 | `test/unit/sessionStore.test.ts::filter_keeps_only_matching_sessions` | 单元 |
| T-031 | 树视图组织与过滤 | 无名会话用首条消息作为显示标题 | `test/unit/sessionStore.test.ts::falls_back_to_preview_when_name_is_null` | 单元 |
| T-035 | 树视图组织与过滤 | 置顶的会话已从服务端消失时不显示幽灵条目 | `test/unit/sessionStore.test.ts::drops_pinned_session_that_no_longer_exists` | 单元 |
| T-036 | 树视图组织与过滤 | 已打开但不在服务端列表中的会话仍然显示 | `test/unit/sessionStore.test.ts::keeps_open_tab_session_missing_from_thread_list` | 单元 |
| T-040 | 树视图组织与过滤 | 已打开与置顶分组默认展开 | `test/unit/treeProvider.test.ts::expands_open_and_pinned_groups_by_default` | 集成 |
| T-032 | 错误可见性 | 加载失败时展示错误节点而非空列表 | `test/unit/treeProvider.test.ts::shows_error_node_with_retry_command_on_load_failure` | 集成 |
| T-033 | 错误可见性 | 重试成功后恢复正常列表 | `test/unit/treeProvider.test.ts::replaces_error_node_with_sessions_after_retry` | 集成 |
| INV-001 | 树视图组织与过滤（跨场景） | 分组互斥不变量 | `test/unit/sessionStore.test.ts::every_session_appears_in_exactly_one_group` | 不变量 |
| INV-002 | 树视图组织与过滤（跨场景） | 过滤判定收敛不变量 | `test/unit/sessionStore.test.ts::every_rendered_session_matches_active_filter` | 不变量 |

## 统计

- 总场景数：40
- 单元测试：29
- 集成测试：11
- 不变量：2
- 测试文件数：10
- 稳定行总数：42（40 个 T + 2 个 INV）

## Amendments

### 2026-09-21 — 追加「新建会话」与分组默认展开

原因：用户在 verify 阶段提出两条新需求——(1) 侧边栏需要有「新建会话」入口；(2) 「置顶」与「已打开」分组默认不要折叠。

对应改动：

- 新增 requirement「新建会话」（3 个 scenario）→ 新增 `T-037` / `T-038` / `T-039`
- 「树视图组织与过滤」新增 scenario「已打开与置顶分组默认展开」→ 新增 `T-040`
- 顺带修正：统计中「测试文件数」由 9 改为实际值 10（verify 记录的可疑项）

### 测试影响分析（2026-09-21，改文档前完成）

| 测试编号 | 所属 Requirement | 影响 | 说明 |
|----------|-----------------|------|------|
| T-020 | 会话打开与聚焦 | 无影响 | 断言的是 opener 打开既有会话失败时不调用 `chatgpt.newCodexPanel`（D9）；新需求是用户显式新建的另一条调用点，两者不冲突，已在 design D12 与 spec 里写明 |
| T-029 | 树视图组织与过滤 | 无影响 | 断言分组是否存在，不涉及 `collapsibleState` |
| T-032 | 错误可见性 | 无影响 | 只对错误节点调用 `getTreeItem`，不碰分组节点 |
| T-033 | 错误可见性 | 无影响 | 只断言 `contextValue` 与子节点 label |
| T-017 / T-036 / INV-001 | 已打开标签页识别 / 树视图组织与过滤 | 无影响 | 「未绑定会话的新建标签保留为未命名项」已实现且有断言；本次只是把它提升为显式 scenario 并新增同层测试 `T-039` |
| 其余 33 条 | — | 无影响 | 不改任何既有 scenario 的预期行为，无 BREAKING |

汇总：需修改 0 个，需废弃 0 个，新增 4 个（`T-037`~`T-040`）。这 4 行**不带** `🔴 RED` / `✅ PASS` 后缀——RED 凭据必须由 build 阶段按 Step 2 真实产生。

### RED 凭据（build 阶段实测，2026-09-21）

| 测试 | 红的样子（真实输出） | 红的原因是否合格 |
|------|--------------------|-----------------|
| T-037 | `Error: new-session not implemented`（throwing 骨架） | 合格：行为未实现。第一次红其实是 `TypeError: createNewSessionCommand is not a function`（导入错误），按铁律不算数——补了会抛错的骨架后重跑才据以标记 |
| T-038 | `promise rejected "Error: new-session not implemented" instead of resolving` | 合格：行为未实现 |
| T-039 | 变异校验：把 `src/session/sessionStore.ts` 的合成 id `open-tab:${index}` 临时改成常量 `'open-tab'` → `expected [ { id: 'open-tab', … } ] to have a length of 2 but got 1`，随后**立刻还原** | 合格：被测行为一旦消失，断言必然失败。T-039 是**回归守卫**——它断言的「两个 `id: null` 标签各占一项」由 Task 7 已实现，天生不会因新功能变红，因此用变异校验证明失败能力，而不是伪造 RED |
| T-040 | `AssertionError: expected 1 to be 2`（实收 `Collapsed`，期望 `Expanded`） | 合格：行为未实现 |

最终全量结果：10 个测试文件 / 42 个用例全绿；`pnpm typecheck` 与 `pnpm run build` 均通过。
