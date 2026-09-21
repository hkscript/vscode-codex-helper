## ADDED Requirements

### Requirement: 新建会话（每次点击独立面板）

插件 SHALL 提供一个「新建会话」命令，每次执行都通过 `vscode.openWith` 打开 Codex 的 new-thread-panel 路由（`openai-codex://route/extension/panel/new`）并携带一个**本次调用独有**的 `newPanel` query，使连续多次执行各自打开一个独立标签页；创建失败时 SHALL 提示错误，且 SHALL NOT 把异常抛回命令层。插件 SHALL NOT 再通过 `chatgpt.newCodexPanel` 委派新建——该入口固定使用同一个 resource，在 `supportsMultipleEditorsPerDocument: false` 下无法开出第二个标签。

本命令与「会话打开与聚焦」中「打开失败不得回退新建」不冲突：那条约束限定的是**打开既有会话失败**时的行为，本条是**用户显式发起**的新建入口。

#### Scenario: 每次执行都打开带上本次调用独有 query 的新面板 URI

- **GIVEN** `uriApi.file('/extension/panel/new')` 返回 scheme `openai-codex`、authority `route`、query 为空的基础 URI
- **AND** 注入的 `createNonce()` 返回 `n1`
- **WHEN** 执行 `codexHelper.newSession`
- **THEN** 调用 `vscode.openWith` 恰好一次，第一个参数是 scheme `openai-codex`、authority `route`、path `/extension/panel/new`、query `newPanel=n1` 的 URI，第二个参数为 `chatgpt.conversationEditor`，第三个参数 `preview` 为 `false`

#### Scenario: 连续两次执行产生两个互不相同的 URI

- **GIVEN** 注入的 `createNonce()` 依次返回 `n1`、`n2`
- **WHEN** 连续执行两次 `codexHelper.newSession`
- **THEN** 两次传入 `vscode.openWith` 的 URI 不相等（即不是同一个 resource）
- **AND** 两次的 URI path 都是 `/extension/panel/new`
- **AND** 全程没有执行过 `chatgpt.newCodexPanel` 命令

#### Scenario: 新建失败时提示错误

- **GIVEN** `vscode.openWith` 调用会抛出错误 `no custom editor registered for chatgpt.conversationEditor`
- **WHEN** 执行 `codexHelper.newSession`
- **THEN** 向用户展示含该错误原因的错误消息，且命令本身不抛出异常

#### Scenario: 尚未绑定会话的新建标签以未命名项出现在「已打开」组

- **GIVEN** 已打开标签中有两个 `conversationId` 均为 `null` 的新建会话标签，标签标题均为 `New chat`
- **AND** `thread/list` 返回的列表中不含这两个标签对应的会话
- **WHEN** 构建树数据
- **THEN** 两个标签都出现在「已打开」组，显示标题取自各自标签页的标题，且两项使用互不相同的合成 id（不因 id 都为 `null` 而互相覆盖）

#### Scenario: 带 query 的新面板 URI 不被误判为会话

- **GIVEN** URI 为 `openai-codex://route/extension/panel/new?newPanel=n1`
- **WHEN** 解析该 URI 的会话 id
- **THEN** 得到 `null`（该标签在树上表现为未命名的新建项，而不是某个会话）

## REMOVED Requirements

### Requirement: 新建会话

**Reason**: 原 requirement 要求「通过 Codex 插件自带的 `chatgpt.newCodexPanel` 创建新的会话面板」，并据此写了 `Scenario: 执行命令时调用 Codex 的新建面板命令`。实测证明该入口每次都打开同一个 resource（`pI("/extension/panel/new")`，无 query），而 Codex 注册自定义编辑器时声明 `supportsMultipleEditorsPerDocument: false`——同一 resource 的第二次打开在 VS Code 里是把已有编辑器移过去，因此「连续点击只得到一个面板」是该入口的固有行为，无法通过委派满足新需求。该 scenario 因此被推翻。

**Migration**: 由本变更 `## ADDED Requirements` 中的 `### Requirement: 新建会话（每次点击独立面板）` 整体替代。未变更的 scenario（`新建失败时提示错误`、`尚未绑定会话的新建标签以未命名项出现在「已打开」组`）已逐条保留在新 requirement 中；被推翻的 `执行命令时调用 Codex 的新建面板命令` 由新 requirement 的前两个 scenario 取代（断言 `vscode.openWith` 的参数与两次调用的 URI 互不相同）。
