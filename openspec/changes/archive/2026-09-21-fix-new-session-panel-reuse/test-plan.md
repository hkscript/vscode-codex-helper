# 测试计划：fix-new-session-panel-reuse

框架：vitest（`pnpm test` → `vitest run`），用例位于 `test/unit/**/*.test.ts`，`vscode` 由 `vitest.config.ts` alias 到 `test/helpers/fakes.ts`。

## 测试映射

<!--
  机器格式（enforcement / Gate / detect 逐行解析，必须保持）：
  每行 = 一个测试用例，`<ID>: `<测试文件>::<测试函数名>``
  状态后缀可选（行尾追加）：🔴 RED / ✅ PASS / ⬜ TODO / ❌ FAIL；build 逐任务更新。
-->

T-001: `test/unit/conversationUri.test.ts::new_panel_uri_uses_codex_route_with_unique_query` 🔴 RED ✅ PASS
T-002: `test/unit/commands.test.ts::opens_new_panel_uri_with_injected_nonce` 🔴 RED ✅ PASS
T-003: `test/unit/commands.test.ts::two_invocations_open_two_distinct_uris` 🔴 RED ✅ PASS
T-004: `test/unit/commands.test.ts::shows_error_when_new_panel_open_fails` 🔴 RED ✅ PASS
T-005: `test/unit/conversationUri.test.ts::new_panel_uri_is_not_parsed_as_a_conversation` 🔴 RED ✅ PASS

## 追溯表

| ID | 来源 Requirement | Scenario | 测试文件::测试函数 | 类型 |
|----|-----------------|----------|-------------------|------|
| T-001 | REQ: 新建会话 | 每次执行都打开带上本次调用独有 query 的新面板 URI | `test/unit/conversationUri.test.ts::new_panel_uri_uses_codex_route_with_unique_query` | 单元 |
| T-002 | REQ: 新建会话 | 每次执行都打开带上本次调用独有 query 的新面板 URI | `test/unit/commands.test.ts::opens_new_panel_uri_with_injected_nonce` | 单元 |
| T-003 | REQ: 新建会话 | 连续两次执行产生两个互不相同的 URI | `test/unit/commands.test.ts::two_invocations_open_two_distinct_uris` | 单元 |
| T-004 | REQ: 新建会话 | 新建失败时提示错误 | `test/unit/commands.test.ts::shows_error_when_new_panel_open_fails` | 单元 |
| T-005 | REQ: 新建会话 | 带 query 的新面板 URI 不被误判为会话 | `test/unit/conversationUri.test.ts::new_panel_uri_is_not_parsed_as_a_conversation` | 单元 |

## 既有测试的处置

| 既有测试 | 处置 | 原因 |
|----------|------|------|
| `test/unit/commands.test.ts::calls_new_codex_panel_once` | **删除**，由 T-002 / T-003 取代 | 它断言「调用 `chatgpt.newCodexPanel` 恰好一次」正是本次要推翻的行为；「恰好一次调用」的正向部分由 T-002 承接（改成断言 `vscode.openWith` 的参数） |
| `test/unit/commands.test.ts::shows_error_when_new_session_command_fails` | **重写**为 T-004 | 失败来源从 `chatgpt.newCodexPanel` 换成 `vscode.openWith`；断言目标（错误消息含原因 + 命令不抛异常）不变 |
| `test/unit/conversationUri.test.ts` 既有用例 | 保留不动 | 既有会话 URI 契约未变（design 改动点 1 已声明 `buildConversationUri` 不随改） |

## 既有覆盖（本次不新增用例，靠现有回归守住）

`尚未绑定会话的新建标签以未命名项出现在「已打开」组` 是被本变更**带到新 requirement 里**的既有 scenario（行为未变，只是 requirement 块被整体重写），已由上一变更留下的用例覆盖：

| scenario | 既有覆盖用例 |
|----------|--------------|
| 尚未绑定会话的新建标签以未命名项出现在「已打开」组 | `test/unit/sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` |

它没有 `🔴 RED`：本变更没有改这条行为，该用例在本变更之前就是绿的。本变更与它的接触点被单独钉在 T-005（带 query 的新面板 URI 仍解析为 `null`）。

## 人工验收（自动化测试无法覆盖，verify 阶段需人工确认）

1. 打开侧边栏，连点 `+` 三次 → 应出现三个空白的新会话标签页（而不是只有一个）。
2. 在任一空白面板里发一条消息 → 该标签应正常进入会话（路由切到 `/local/<id>`），树上出现对应会话。
3. 关闭全部空白面板后再点 `+` → 仍然开出新的空白面板。

> 第 1 步失败（例如开出空白/异常页面）时的结论与回退路径写在 design.md「边界条件与风险」末段。

## 统计

- 总场景数：5
- 单元测试：5
- 集成测试：0
- 测试文件数：2
