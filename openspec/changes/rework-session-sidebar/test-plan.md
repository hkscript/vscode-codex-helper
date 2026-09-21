# 测试计划：rework-session-sidebar

框架：vitest（`pnpm test` → `vitest run`），用例位于 `test/unit/**/*.test.ts`，`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`；`package.json` 的贡献用 `readFileSync` 读文件后断言（不引入 JSON 导入的类型配置）。

## 测试映射

<!--
  机器格式（enforcement / Gate / detect 逐行解析，必须保持）：
  每行 = 一个测试用例，`<ID>: `<测试文件>::<测试函数名>``
  状态后缀可选（行尾追加）：🔴 RED / ✅ PASS / ⬜ TODO / ❌ FAIL；build 逐任务更新。
-->

T-001: `test/unit/openTabs.test.ts::drops_tab_without_conversation_id` 🔴 RED ✅ PASS
T-002: `test/unit/openTabs.test.ts::keeps_each_tab_own_resource` 🔴 RED ✅ PASS
T-003: `test/unit/openTarget.test.ts::open_session_row_resolves_to_its_tab_resource` 🔴 RED ✅ PASS
T-004: `test/unit/openTarget.test.ts::keeps_remote_row_on_its_own_resource` 🔴 RED ✅ PASS
T-005: `test/unit/openTarget.test.ts::falls_back_to_conversation_id_without_usable_tab_resource` 🔴 RED ✅ PASS
T-006: `test/unit/opener.test.ts::reveals_open_tab_with_its_own_resource` 🔴 RED ✅ PASS
T-007: `test/unit/opener.test.ts::shows_error_and_never_creates_new_panel_when_revealing_tab` 🔴 RED ✅ PASS
T-008: `test/unit/sessionStore.test.ts::renders_pinned_recent_history_and_archived_groups` 🔴 RED ✅ PASS
T-009: `test/unit/sessionStore.test.ts::open_session_row_lands_in_recent_with_open_mark` 🔴 RED ✅ PASS
T-010: `test/unit/sessionStore.test.ts::drops_unbound_new_panel_tab` 🔴 RED ✅ PASS
T-011: `test/unit/sessionStore.test.ts::pinned_open_session_keeps_single_pinned_row` 🔴 RED ✅ PASS
T-012: `test/unit/sessionStore.test.ts::unpinning_moves_open_session_to_recent` 🔴 RED ✅ PASS
T-013: `test/unit/sessionStore.test.ts::drops_open_tab_whose_thread_is_missing` 🔴 RED ✅ PASS
T-014: `test/unit/treeProvider.test.ts::item_id_carries_group_segment` 🔴 RED ✅ PASS
T-015: `test/unit/treeProvider.test.ts::open_session_row_passes_tab_resource` 🔴 RED ✅ PASS
T-016: `test/unit/treeProvider.test.ts::running_icon_wins_over_open_icon` 🔴 RED ✅ PASS
T-017: `test/unit/treeProvider.test.ts::session_without_cwd_has_empty_description` 🔴 RED ✅ PASS
T-018: `test/unit/treeProvider.test.ts::expands_pinned_and_recent_collapses_history_and_archived` 🔴 RED ✅ PASS
T-019: `test/unit/extension.test.ts::open_session_command_prefers_the_tab_resource` 🔴 RED ✅ PASS
T-020: `test/unit/sessionStore.test.ts::recent_group_takes_ten_most_recent_unpinned` 🔴 RED ✅ PASS
T-021: `test/unit/sessionStore.test.ts::recent_group_holds_all_when_fewer_than_ten` 🔴 RED ✅ PASS
T-022: `test/unit/sessionStore.test.ts::pinned_session_leaves_recent_group` 🔴 RED ✅ PASS
T-023: `test/unit/sessionStore.test.ts::recent_and_history_are_disjoint` 🔴 RED ✅ PASS
T-024: `test/unit/threadApi.test.ts::sends_thread_delete_with_thread_id` 🔴 RED ✅ PASS
T-025: `test/unit/threadApi.test.ts::sends_thread_archive_with_thread_id` 🔴 RED ✅ PASS
T-026: `test/unit/threadApi.test.ts::sends_thread_unarchive_with_thread_id` 🔴 RED ✅ PASS
T-027: `test/unit/threadApi.test.ts::lists_archived_threads_when_asked` 🔴 RED ✅ PASS
T-028: `test/unit/commands.test.ts::archives_session_without_confirmation` 🔴 RED ✅ PASS
T-029: `test/unit/commands.test.ts::deletes_archived_session_without_confirmation` 🔴 RED ✅ PASS
T-030: `test/unit/commands.test.ts::unarchives_session` 🔴 RED ✅ PASS
T-031: `test/unit/commands.test.ts::shows_error_when_archive_fails` 🔴 RED ✅ PASS
T-032: `test/unit/commands.test.ts::shows_error_when_delete_fails` 🔴 RED ✅ PASS
T-033: `test/unit/packageContributes.test.ts::archive_inline_on_sessions_delete_inline_on_archived` 🔴 RED ✅ PASS
T-035: `test/unit/extension.test.ts::delete_closes_only_the_matching_tab` 🔴 RED ✅ PASS
T-036: `test/unit/sessionStore.test.ts::archived_threads_land_in_archived_group_only` 🔴 RED ✅ PASS
T-037: `test/unit/sessionStore.test.ts::pinned_archived_session_still_marked_pinned` 🔴 RED ✅ PASS
T-038: `test/unit/treeProvider.test.ts::archived_row_uses_archived_context_value` 🔴 RED ✅ PASS
T-039: `test/unit/openTabs.test.ts::selects_open_tabs_of_a_conversation` 🔴 RED ✅ PASS
T-040: `test/unit/rowOpener.test.ts::archived_row_unarchives_before_opening` 🔴 RED ✅ PASS
T-041: `test/unit/rowOpener.test.ts::opens_even_when_unarchive_fails` 🔴 RED ✅ PASS
T-042: `test/unit/treeProvider.test.ts::archived_row_passes_archived_flag` 🔴 RED ✅ PASS
T-043: `test/unit/packageContributes.test.ts::sidebar_title_is_not_duplicated` 🔴 RED ✅ PASS

INV-001: `test/unit/openTarget.test.ts::every_row_opens_its_own_source` covers T-003, T-004, T-005 🔴 RED ✅ PASS
INV-002: `test/unit/sessionStore.test.ts::no_unbound_panel_row_ever_rendered` covers T-001, T-008, T-010, T-013 🔴 RED ✅ PASS
INV-003: `test/unit/sessionStore.test.ts::every_thread_renders_exactly_once` covers T-008, T-020, T-021, T-022, T-023, T-036, T-037 🔴 RED ✅ PASS
INV-004: `test/unit/extension.test.ts::destructive_actions_never_ask_and_only_delete_closes_tabs` covers T-028, T-029, T-030, T-035 🔴 RED ✅ PASS
INV-005: `test/unit/rowOpener.test.ts::unarchive_only_for_archived_rows_before_opening` covers T-040, T-041 🔴 RED ✅ PASS

## 追溯表

| ID | 来源 Requirement | Scenario | 类型 |
|----|-----------------|----------|------|
| T-001 | 已打开标签识别 | 尚未绑定会话的新面板标签被忽略 | 单元 |
| T-002 | 已打开标签识别 | 保留每个标签页自己的 resource | 单元 |
| T-003 | 会话打开与聚焦 | 已打开的会话按它自己的标签 resource 打开 | 单元 |
| T-004 | 会话打开与聚焦 | 远端标签对应的会话按它自己的远端 resource 打开 | 单元 |
| T-005 | 会话打开与聚焦 | 没有标签 resource 的条目仍按会话 id 打开 | 单元 |
| T-006 | 会话打开与聚焦 | 已打开的会话按它自己的标签 resource 打开 | 单元 |
| T-007 | 会话打开与聚焦 | 打开标签 resource 失败时报错且不新建 | 单元 |
| T-008 | 树视图分组 | 三组分别归位 / 已归档的会话只出现在已归档分组 | 单元 |
| T-009 | 树视图分组 | 已打开的会话出现在最近或历史分组 | 单元 |
| T-010 | 树视图分组 | 尚未绑定会话的新面板不产生任何条目 | 单元（核心回归） |
| T-011 | 树视图分组 | 置顶会话被打开后仍保留在置顶组且只有一行 | 单元 |
| T-012 | 会话置顶与取消置顶后的归位 | 取消置顶的已打开会话按最近度归位 | 单元 |
| T-013 | 树视图分组 | 已打开但服务端列表里没有的会话不渲染 | 单元 |
| T-014 | 树视图分组 | 条目节点 id 含分组段 | 单元 |
| T-015 | 树视图分组 | 已打开条目把标签 resource 交给打开命令 | 单元 |
| T-016 | 树视图分组 | 开着且正在运行的会话显示运行图标 | 单元 |
| T-017 | 树视图分组 | 没有目录信息的会话不显示描述 | 单元 |
| T-018 | 树视图分组 | 置顶与最近分组默认展开历史与已归档分组默认折叠 | 单元 |
| T-019 | 会话打开与聚焦 | 已打开的会话按它自己的标签 resource 打开（接线层） | 集成 |
| T-020 | 树视图分组 | 最近分组只取最近更新的 10 个未置顶会话 | 单元 |
| T-021 | 树视图分组 | 未置顶会话不足 10 个时最近分组全收 | 单元 |
| T-022 | 树视图分组 | 置顶的会话不出现在最近分组 | 单元 |
| T-023 | 树视图分组 | 最近与历史互斥 | 单元 |
| T-024 | 会话归档与删除 | 删除已归档会话不弹确认直接执行 | 单元 |
| T-025 | 会话归档与删除 | 归档不弹确认直接执行 | 单元 |
| T-026 | 会话归档与删除 | 取消归档 | 单元 |
| T-027 | 树视图分组 | 已归档的会话只出现在已归档分组（列表来源） | 单元 |
| T-028 | 会话归档与删除 | 归档不弹确认直接执行（命令层） | 单元 |
| T-029 | 会话归档与删除 | 删除已归档会话不弹确认直接执行（命令层） | 单元 |
| T-030 | 会话归档与删除 | 取消归档（命令层） | 单元 |
| T-031 | 会话归档与删除 | 归档失败时报错且不改变本地状态 | 单元 |
| T-032 | 会话归档与删除 | 删除失败时报错且不改变本地状态 | 单元 |
| T-033 | 会话归档与删除 | 未归档条目提供归档按钮、已归档条目提供删除按钮 | 单元（清单契约） |
| T-035 | 会话归档与删除 | 删除只关闭被删会话自己的标签 | 集成 |
| T-036 | 树视图分组 | 已归档的会话只出现在已归档分组 | 单元 |
| T-037 | 树视图分组 | 置顶的已归档会话仍在已归档分组且带置顶标识 | 单元 |
| T-038 | 树视图分组 | 置顶的已归档会话仍在已归档分组（contextValue） | 单元 |
| T-039 | 会话归档与删除 | 删除只关闭被删会话自己的标签（标签定位） | 单元 |
| T-040 | 会话打开与聚焦 | 打开已归档的会话会先取消归档 | 单元 |
| T-041 | 会话打开与聚焦 | 取消归档失败不阻止打开 | 单元 |
| T-042 | 会话打开与聚焦 | 打开已归档的会话会先取消归档（条目携带归档标记） | 单元 |
| T-043 | 侧边栏标题 | 侧边栏标题不出现重复的「会话」 | 单元（清单契约） |
| INV-001 | 会话打开与聚焦 | 任意一行都指向它自己的来源对象 | 不变量 |
| INV-002 | 已打开标签识别 | 任何分组都不出现未绑定面板行 | 不变量 |
| INV-003 | 树视图分组 | 每个会话恰好渲染一行（已归档 / 置顶 / 最近 / 历史 唯一归属） | 不变量 |
| INV-004 | 会话归档与删除 | 三条命令都不弹确认；只有删除关标签；归档与取消归档不改动标签页 | 不变量 |
| INV-005 | 会话打开与聚焦 | 只有归档行在打开前取消归档（且失败不阻止打开） | 不变量 |

## 既有测试的处置

| 既有测试 | 处置 | 原因 |
|----------|------|------|
| `test/unit/sessionStore.test.ts::assigns_sessions_to_open_pinned_history_groups` | **重写**为 T-008 | 分组语义整体变化（四组、已归档优先） |
| `test/unit/sessionStore.test.ts::keeps_open_tab_session_missing_from_thread_list` | **重写**为 T-013（行为反转） | 不再用标签标题为服务端没有的会话造行 |
| `test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` | **删除**，由 T-010 取代 | 它断言的正是要删掉的未绑定面板占位行 |
| `test/unit/sessionStore.test.ts::pinned_session_stays_in_pinned_group_when_open` | **重写**为 T-011 | 断言从「两行」改为「单行 + open 标记」 |
| `test/unit/sessionStore.test.ts::unpinning_removes_pinned_row_but_keeps_open_row` | **重写**为 T-012 | 「已打开」组已删除 |
| `test/unit/sessionStore.test.ts::group_membership_matrix_holds_for_all_combinations` | **重写**为 INV-002 / INV-003 | 8 格矩阵不再成立；新矩阵覆盖「未绑定面板 × 已归档 × 置顶 × 最近」 |
| `test/unit/sessionStore.test.ts::hides_empty_groups`、`marks_sessions_present_in_running_set` | 机械更新（分组 id / 夹具） | 断言目标不变 |
| `test/unit/treeProvider.test.ts::expands_open_and_pinned_groups_by_default` | **重写**为 T-018 | 默认折叠态改为「置顶、最近展开；历史、已归档折叠」 |
| `test/unit/treeProvider.test.ts::same_session_gets_distinct_node_ids_per_group` | **重写**为 T-014 | 一个会话不再出现在两组；改为钉住 `session:<分组>:<id>` 形状 |
| `test/unit/treeProvider.test.ts::session_without_cwd_has_empty_description` | **重写**为 T-017 | 旧 setup 依赖被删除的「已打开兜底行」 |
| `test/unit/treeProvider.test.ts::running_session_uses_spinner_icon`、`pinned_session_description_starts_with_pin_marker`、`open_and_pinned_item_context_value_is_pinned` | 机械更新（夹具 / 分组来源） | 断言目标不变（图标 id、`📌` 前缀、`session.pinned`） |
| `test/unit/openTabs.test.ts::keeps_new_panel_tab_with_null_conversation_id` | **重写**为 T-001（行为反转） | 未绑定面板从「保留」改为「丢弃」 |
| `test/unit/threadApi.test.ts`、`test/unit/commands.test.ts`、`test/unit/opener.test.ts`、`test/unit/conversationUri.test.ts` 既有用例 | 保留不动 | 新增的方法与命令不改既有行为；`registerCommands` 只是多注册三个命令 |
| `test/helpers/fakes.ts` | 扩展 | `makeOpenTab` 不再接受 `null` id；`window.tabGroups` 增加 `close`、`window.showWarningMessage` 增加（用于断言「没有弹确认」） |

## 既有覆盖（本次不新增用例，靠现有回归守住）

以下 scenario 的**行为**未变（requirement 块被整体重写），由既有用例覆盖，因此没有 `🔴 RED`：

| scenario | 既有覆盖用例 |
|----------|--------------|
| 识别 Codex 会话标签并解析 id / 忽略非 Codex 标签 | `test/unit/openTabs.test.ts::scans_codex_tab_and_parses_conversation_id`、`ignores_non_codex_tabs` |
| 用正确的 URI 与 viewType 打开会话 / 打开失败时报错且不新建会话 | `test/unit/opener.test.ts::opens_session_with_conversation_uri_and_view_type`、`shows_error_and_never_creates_new_panel_on_open_failure` |
| 会话 URI 与 Codex 的解析规则互逆 / 带 query 的新面板 URI 不被误判为会话 | `test/unit/conversationUri.test.ts` 既有用例 |
| 置顶后写入全局状态 / 取消置顶后从全局状态移除 / 首次读取时全局状态为空值 | `test/unit/pinStore.test.ts` 既有用例 |
| 每次执行都打开带上本次调用独有 query 的新面板 URI / 连续两次执行产生两个互不相同的 URI / 新建失败时提示错误 | `test/unit/commands.test.ts`、`test/unit/conversationUri.test.ts` 既有用例 |
| 运行中的条目使用运行图标 / 置顶的条目显示置顶标识 / 条目描述显示目录末级名 / 已打开且已置顶的条目右键菜单给出取消置顶 / 空分组不渲染 / 关键词过滤 / 无名会话标题 / 幽灵置顶 / 运行状态传递 | `test/unit/sessionStore.test.ts`、`test/unit/treeProvider.test.ts` 既有用例（分组夹具机械更新） |

## 测试影响分析 (2026-09-22)

amend 追加「侧边栏标题」requirement（用户反馈：侧边栏标题栏显示成 `CODEX 会话: 会话`）：

| 测试编号 | 所属 Requirement | 影响 | 说明 |
|----------|-----------------|------|------|
| T-043 | 侧边栏标题 | ➕ 新增 | 新 scenario：容器标题 `Codex` + 视图名 `会话`，且不声明 `contextualTitle` |
| T-033 | 会话归档与删除 | 无影响 | 只断言菜单/命令贡献，不涉及 `viewsContainers`/`views` 标题 |
| 其余 45 条 | — | 无影响 | 本次改动只碰 `package.json` 的两处标题字段 |

## 人工验收（自动化测试无法覆盖，verify 阶段需人工确认）

1. 打开侧边栏：不再有「已打开」分组；「置顶」「最近」默认展开，「历史」「已归档」默认折叠；「最近」里是最近更新的 10 个会话。
2. 点 `+` 新建空白面板：侧边栏不出现任何新行。
3. 在该面板里发一条消息 → 会话出现在「最近」组（带窗口图标，运行时转圈）；点击该行**聚焦回那个标签**，不新开标签；Codex 输出通道日志里不应出现 `conversationId=open-tab:` / `invalid thread id`。
4. 重启 VS Code 后重复第 3 步，行为一致。
5. 鼠标悬停条目：未归档条目只出现「归档」按钮（没有「打开」、没有「删除」）；右键菜单里仍有「打开会话」「重命名」「置顶」。
6. 点「归档」→ 不弹任何确认框，该会话立刻从原分组消失、出现在「已归档」组末尾（折叠状态）。
7. 展开「已归档」→ 悬停某条：出现「删除」按钮；右键菜单里有「取消归档」。点「取消归档」→ 回到「最近」或「历史」（若它原本被置顶，则回到「置顶」）。
8. 点「删除」→ 不弹确认框，会话从「已归档」组消失；若它当时开着标签，该标签被关闭，其它标签不受影响。
9. 归档一个开着标签的会话 → 标签**保持打开**（Codex 面板会显示归档状态），插件不关它。
10. 「已归档」组能列出本机既有的已归档会话（本机实测有 15 个），验证 `thread/list {archived:true}` 接线正确。
11. 点「已归档」组里的某条会话 → 它**先取消归档**再打开：标签打开，随后该行离开「已归档」组（回到「最近」/「历史」，若原本置顶则回到「置顶」）。

## 统计

- 测试行：42 条用例 + 5 条不变量
- 单元测试：36
- 集成测试：5（`test/unit/extension.test.ts`）
- 测试文件数：10
