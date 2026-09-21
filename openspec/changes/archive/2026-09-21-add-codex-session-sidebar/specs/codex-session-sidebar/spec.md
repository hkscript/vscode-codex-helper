# codex-session-sidebar

## ADDED Requirements

### Requirement: Codex 可执行文件定位

插件 SHALL 在启动 app-server 之前解析出可用的 codex 可执行文件路径，解析顺序为「本插件配置 `codexHelper.codexExecutable` → Codex 插件配置 `chatgpt.cliExecutable` → Codex 插件安装目录下按平台推导的路径」，全部不可用时 SHALL 抛出可诊断的错误。

#### Scenario: 从 Codex 插件安装目录解析二进制路径

- **GIVEN** `codexHelper.codexExecutable` 配置为空字符串
- **AND** 已安装的 Codex 插件 `extensionPath` 为 `/ext/openai.chatgpt-26.908.40401-linux-x64`
- **WHEN** 调用 `resolveCodexBinary`
- **THEN** 返回 `/ext/openai.chatgpt-26.908.40401-linux-x64/bin/linux-x86_64/codex`

#### Scenario: 用户配置优先于插件目录

- **GIVEN** `codexHelper.codexExecutable` 配置为 `/usr/local/bin/codex`
- **AND** Codex 插件已安装
- **WHEN** 调用 `resolveCodexBinary`
- **THEN** 返回 `/usr/local/bin/codex`，不读取插件目录

#### Scenario: 回退到 Codex 自身的 cliExecutable 配置

- **GIVEN** `codexHelper.codexExecutable` 为空
- **AND** `chatgpt.cliExecutable` 配置为 `/opt/codex/codex`
- **WHEN** 调用 `resolveCodexBinary`
- **THEN** 返回 `/opt/codex/codex`，不读取插件目录

#### Scenario: Codex 插件未安装时报出可诊断的错误

- **GIVEN** `codexHelper.codexExecutable` 为空
- **AND** `extensions.getExtension('openai.chatgpt')` 返回 `undefined`
- **WHEN** 调用 `resolveCodexBinary`
- **THEN** 抛出错误，错误消息中包含扩展 id `openai.chatgpt`

### Requirement: app-server JSON-RPC 客户端

插件 SHALL 以子进程方式启动 `codex app-server`，用换行分隔的 JSON-RPC（NDJSON）通信，并在完成 `initialize` 握手后才允许发送业务请求。

#### Scenario: 先握手再放行业务请求

- **GIVEN** 一个未启动的客户端
- **WHEN** 调用 `start()`
- **THEN** 写入子进程 stdin 的第一条消息的 `method` 是 `initialize`，且 `params.clientInfo` 同时含 `name` 与 `version`

#### Scenario: 跨 chunk 的半条消息能被正确拼接

- **GIVEN** 客户端已握手完成且有一个 id 为 `1` 的在途请求
- **WHEN** stdout 先后吐出 `{"jsonrpc":"2.0","id":"1","resu` 和 `lt":{"data":[]}}\n` 两个数据块
- **THEN** 该请求以 `{"data":[]}` 成功兑现

#### Scenario: 一个 chunk 含多条消息时逐条分发

- **GIVEN** 客户端有 id 为 `1` 和 `2` 的两个在途请求
- **WHEN** stdout 一次吐出两行响应（id 分别为 `2` 和 `1`）
- **THEN** 两个请求都被兑现，且各自拿到与自己 id 匹配的结果

#### Scenario: 无 id 的通知不影响请求路由

- **GIVEN** 客户端有一个 id 为 `1` 的在途请求
- **WHEN** stdout 先吐出一条 `{"method":"configWarning","params":{...}}` 通知，再吐出 id 为 `1` 的响应
- **THEN** 通知被忽略，id 为 `1` 的请求正常兑现

#### Scenario: 服务端返回 error 时请求被拒绝

- **GIVEN** 客户端有一个 id 为 `1` 的在途请求
- **WHEN** stdout 吐出 `{"jsonrpc":"2.0","id":"1","error":{"code":-32601,"message":"method not found"}}`
- **THEN** 该请求以包含 `method not found` 的错误被拒绝

#### Scenario: 请求超时被拒绝且不再占用路由表

- **GIVEN** 客户端已握手完成，超时阈值为 50 毫秒
- **WHEN** 发出一个请求且服务端始终不响应
- **THEN** 该请求在超时后被拒绝，且其 id 从在途请求表中移除

#### Scenario: dispose 杀死子进程并拒绝所有在途请求

- **GIVEN** 客户端有 2 个在途请求
- **WHEN** 调用 `dispose()`
- **THEN** 子进程被 kill，且两个请求都以「客户端已关闭」错误被拒绝

### Requirement: 会话列表读取

插件 SHALL 通过 `thread/list` 读取历史会话，默认按最近更新倒序、排除已归档会话，并支持关键词、工作区目录过滤与分页。

#### Scenario: 默认按最近更新倒序且排除归档

- **GIVEN** 配置 `codexHelper.pageSize` 为 `50`
- **WHEN** 调用 `listThreads({})`
- **THEN** 发送的 `thread/list` 参数中 `sortKey` 为 `updated_at`、`archived` 为 `false`、`limit` 为 `50`

#### Scenario: 关键词透传给服务端

- **GIVEN** 当前过滤关键词为 `vscode`
- **WHEN** 调用 `listThreads({ searchTerm: 'vscode' })`
- **THEN** 发送的参数中 `searchTerm` 为 `vscode`

#### Scenario: 开启工作区过滤时传入 cwd

- **GIVEN** `codexHelper.filterByWorkspaceCwd` 为 `true` 且工作区路径为 `/home/u/proj`
- **WHEN** 构造 `thread/list` 参数
- **THEN** 参数中 `cwd` 为 `/home/u/proj`

#### Scenario: 用 nextCursor 翻页

- **GIVEN** 上一页响应的 `nextCursor` 为 `abc`
- **WHEN** 调用 `listThreads({ cursor: 'abc' })`
- **THEN** 发送的参数中 `cursor` 为 `abc`

### Requirement: 已打开标签页识别

插件 SHALL 从 VS Code 标签页状态中识别出属于 Codex 会话编辑器的标签，并解析其会话 id。

#### Scenario: 识别 Codex 会话标签并解析 id

- **GIVEN** 一个标签的 input 是 custom 编辑器，viewType 为 `chatgpt.conversationEditor`，uri 为 `openai-codex://route/local/01a0becc-10ff-7a00-8574-923d5b93bae0`
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果含一项，其 `conversationId` 为 `01a0becc-10ff-7a00-8574-923d5b93bae0`

#### Scenario: 忽略非 Codex 标签

- **GIVEN** 标签集合中含一个普通文本编辑器标签和一个 viewType 为 `other.editor` 的 custom 标签
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果为空数组

#### Scenario: 新建但尚未绑定会话的标签保留为未命名项

- **GIVEN** 一个 Codex custom 标签的 uri 为 `openai-codex://route/extension/panel/new`
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果含一项，其 `conversationId` 为 `null`，且保留该标签的显示标题

### Requirement: 会话打开与聚焦

插件 SHALL 通过 VS Code 的 `vscode.openWith` 命令把指定会话交给 Codex 的会话编辑器打开；打开失败时 SHALL 报错，且不得改为新建空会话。

#### Scenario: 用正确的 URI 与 viewType 打开会话

- **GIVEN** 会话 id 为 `01a0becc-10ff-7a00-8574-923d5b93bae0`
- **WHEN** 调用 `openSession(id)`
- **THEN** 以 `vscode.openWith` 命令发起调用，第一个参数的字符串形式为 `openai-codex://route/local/01a0becc-10ff-7a00-8574-923d5b93bae0`，第二个参数为 `chatgpt.conversationEditor`，第三个参数中 `preview` 为 `false`

#### Scenario: 会话 URI 与 Codex 的解析规则互逆

- **GIVEN** 任意合法会话 id
- **WHEN** 先 `buildConversationUri(id)` 再 `parseConversationId(uri)`
- **THEN** 得到原始 id；且对 scheme 不是 `openai-codex` 或 authority 不是 `route` 的 uri，`parseConversationId` 返回 `null`

#### Scenario: 打开失败时报错且不新建会话

- **GIVEN** `vscode.openWith` 调用会抛出错误
- **WHEN** 调用 `openSession(id)`
- **THEN** 向用户展示含该会话 id 的错误消息，且全程没有执行过 `chatgpt.newCodexPanel` 命令

### Requirement: 新建会话

插件 SHALL 提供一个「新建会话」命令，通过 Codex 插件自带的 `chatgpt.newCodexPanel` 命令创建新的会话面板；创建失败时 SHALL 提示错误，且 SHALL NOT 把异常抛回命令层。

本命令与「会话打开与聚焦」中「打开失败不得回退新建」不冲突：那条约束限定的是**打开既有会话失败**时的行为，本条是**用户显式发起**的新建入口。

#### Scenario: 执行命令时调用 Codex 的新建面板命令

- **GIVEN** 已注册 `codexHelper.newSession` 命令
- **WHEN** 执行该命令
- **THEN** 调用 `chatgpt.newCodexPanel` 命令恰好一次，且不传任何参数

#### Scenario: 新建失败时提示错误

- **GIVEN** `chatgpt.newCodexPanel` 调用会抛出错误 `command 'chatgpt.newCodexPanel' not found`
- **WHEN** 执行该命令
- **THEN** 向用户展示含该错误原因的错误消息，且命令本身不抛出异常

#### Scenario: 尚未绑定会话的新建标签以未命名项出现在「已打开」组

- **GIVEN** 已打开标签中有两个 `conversationId` 均为 `null` 的新建会话标签，标签标题均为 `New chat`
- **AND** `thread/list` 返回的列表中不含这两个标签对应的会话
- **WHEN** 构建树数据
- **THEN** 两个标签都出现在「已打开」组，显示标题取自各自标签页的标题，且两项使用互不相同的合成 id（不因 id 都为 `null` 而互相覆盖）

### Requirement: 会话重命名

插件 SHALL 支持重命名会话，并通过 `thread/name/set` 把新名字写回 Codex。

#### Scenario: 输入新名字后写回 Codex

- **GIVEN** 会话 id 为 `t1`，用户在输入框中输入 `价格排查`
- **WHEN** 执行重命名命令
- **THEN** 发送 `thread/name/set`，参数为 `{ threadId: 't1', name: '价格排查' }`

#### Scenario: 用户取消输入时不发请求

- **GIVEN** 用户在输入框中按下取消（返回 `undefined`）
- **WHEN** 执行重命名命令
- **THEN** 不发送任何 `thread/name/set` 请求

#### Scenario: 重命名失败时提示错误

- **GIVEN** `thread/name/set` 返回 error
- **WHEN** 执行重命名命令
- **THEN** 向用户展示错误消息，且不修改本地列表中的名称

### Requirement: 会话置顶

插件 SHALL 把置顶的会话 id 持久化在插件自身的全局状态中，并让置顶会话排在列表前部。

#### Scenario: 置顶后写入全局状态

- **GIVEN** 全局状态中 `codexHelper.pinnedSessionIds` 为空
- **WHEN** 对会话 `t1` 执行置顶
- **THEN** 全局状态中 `codexHelper.pinnedSessionIds` 为 `['t1']`
- **AND** 再次对 `t1` 执行置顶后仍为 `['t1']`（幂等，不产生重复项）

#### Scenario: 取消置顶后从全局状态移除

- **GIVEN** 全局状态中 `codexHelper.pinnedSessionIds` 为 `['t1','t2']`
- **WHEN** 对会话 `t1` 执行取消置顶
- **THEN** 全局状态中 `codexHelper.pinnedSessionIds` 为 `['t2']`

#### Scenario: 首次读取时全局状态为空值

- **GIVEN** 全局状态中不存在 `codexHelper.pinnedSessionIds` 键
- **WHEN** 调用 `list()`
- **THEN** 返回空数组而不是抛错

### Requirement: 树视图组织与过滤

侧边栏 SHALL 把会话分为「已打开」「置顶」「历史」三组展示，同一会话只出现在优先级最高的一组中，并支持按关键词过滤。「已打开」与「置顶」分组 SHALL 默认展开（不折叠），「历史」分组 SHALL 默认折叠。

#### Scenario: 三组分别归位

- **GIVEN** 会话 `a` 有对应的已打开标签、会话 `b` 被置顶、会话 `c` 两者都不是
- **WHEN** 构建树数据
- **THEN** `a` 在「已打开」组、`b` 在「置顶」组、`c` 在「历史」组

#### Scenario: 已打开优先于置顶，不重复出现

- **GIVEN** 会话 `a` 既被置顶又有已打开的标签
- **WHEN** 构建树数据
- **THEN** `a` 只出现在「已打开」组，「置顶」组中不含 `a`

#### Scenario: 空分组不渲染分组节点

- **GIVEN** 没有任何已打开的 Codex 标签，且没有置顶会话
- **WHEN** 构建树数据
- **THEN** 结果中不含「已打开」与「置顶」分组节点

#### Scenario: 关键词过滤只保留匹配项

- **GIVEN** 会话 `a` 名为 `价格排查`、会话 `b` 名为 `登录重构`
- **AND** 过滤关键词为 `价格`
- **WHEN** 构建树数据
- **THEN** 结果中只含 `a`

#### Scenario: 无名会话用首条消息作为显示标题

- **GIVEN** 会话 `a` 的 `name` 为 `null`，`preview` 为 `test.jpg 这是啥`
- **WHEN** 构建树数据
- **THEN** `a` 的显示标题为 `test.jpg 这是啥`

#### Scenario: 置顶的会话已从服务端消失时不显示幽灵条目

- **GIVEN** 全局状态中置顶了会话 `t9`
- **AND** `thread/list` 返回的列表中不含 `t9`，且没有任何标签页对应 `t9`
- **WHEN** 构建树数据
- **THEN** 结果中不含 `t9` 的任何条目

#### Scenario: 已打开但不在服务端列表中的会话仍然显示

- **GIVEN** 有一个已打开的 Codex 标签对应会话 `t8`
- **AND** `thread/list` 返回的列表中不含 `t8`
- **WHEN** 构建树数据
- **THEN** `t8` 出现在「已打开」组，其显示标题取自该标签页的标题

#### Scenario: 已打开与置顶分组默认展开

- **GIVEN** 构建结果同时含「已打开」「置顶」「历史」三个分组
- **WHEN** 请求各分组节点的 TreeItem
- **THEN** 「已打开」与「置顶」分组的 `collapsibleState` 为 `Expanded`，「历史」分组的 `collapsibleState` 为 `Collapsed`

### Requirement: 错误可见性

当会话数据无法加载时，侧边栏 SHALL 展示可诊断的错误节点与重试入口，不得静默展示为空列表。

#### Scenario: 加载失败时展示错误节点而非空列表

- **GIVEN** 会话数据加载抛出错误 `spawn ENOENT`
- **WHEN** 树请求根节点
- **THEN** 返回恰好一个错误节点，其标题包含 `spawn ENOENT`，且其 command 为 `codexHelper.refresh`

#### Scenario: 重试成功后恢复正常列表

- **GIVEN** 上一次加载失败，树当前展示错误节点
- **WHEN** 重试并成功取回 2 条会话
- **THEN** 树不再含错误节点，且展示这 2 条会话
