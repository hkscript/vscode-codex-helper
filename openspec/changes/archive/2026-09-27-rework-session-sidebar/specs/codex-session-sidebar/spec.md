## MODIFIED Requirements

### Requirement: 会话打开与聚焦

插件 SHALL 通过 VS Code 的 `vscode.openWith` 命令把会话交给 Codex 的会话编辑器打开。对于带有标签 resource 的条目（该会话已经在标签页里打开），插件 SHALL 打开**该标签自己的 resource**，从而聚焦已打开的标签而不是新建；没有标签 resource 的条目 SHALL 按会话 id 打开。对于处于「已归档」状态的条目，打开前 SHALL 先调用 `thread/unarchive`（对齐 Codex 自己的「取消归档并打开」），使打开后的会话回到非归档状态；取消归档失败时 SHALL 报错但**仍然打开**该会话。打开失败时 SHALL 报错，且不得改为新建空会话。

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

#### Scenario: 已打开的会话按它自己的标签 resource 打开

- **GIVEN** 一条会话条目带有标签 resource `openai-codex://route/local/conv-1?projectId=p1`
- **WHEN** 解析该条目的打开目标并执行
- **THEN** `vscode.openWith` 的第一个参数是**该标签自己的 resource**（含 query `projectId=p1`，而不是由 id 重新拼出的无 query URI），第二个参数为 `chatgpt.conversationEditor`，第三个参数中 `preview` 为 `false`

#### Scenario: 远端标签对应的会话按它自己的远端 resource 打开

- **GIVEN** 一条会话条目带有标签 resource `openai-codex://route/remote/conv-r`
- **WHEN** 解析该条目的打开目标并执行
- **THEN** `vscode.openWith` 的第一个参数的 path 为 `/remote/conv-r`，而不是 `/local/conv-r`

#### Scenario: 没有标签 resource 的条目仍按会话 id 打开

- **GIVEN** 一条条目的会话 id 为 `conv-9`，且它没有对应的已打开标签（`tabUri` 为 `null` 或形状不合法）
- **WHEN** 解析该条目的打开目标
- **THEN** 打开目标为「按会话 id 打开」，其 URI 由 `buildConversationUri('conv-9')` 得出

#### Scenario: 打开标签 resource 失败时报错且不新建

- **GIVEN** `vscode.openWith` 对某个标签 resource 调用会抛出错误
- **WHEN** 请求聚焦该标签
- **THEN** 向用户展示含失败原因的错误消息，且全程没有执行过 `chatgpt.newCodexPanel` 命令

#### Scenario: 打开已归档的会话会先取消归档

- **GIVEN** 已归档会话 `t1` 出现在「已归档」组
- **WHEN** 用户点该条目打开会话
- **THEN** 先发出一次 `thread/unarchive`（参数 `{threadId: 't1'}`），随后才打开该会话
- **AND** 列表刷新后 `t1` 不再出现在「已归档」组

#### Scenario: 取消归档失败不阻止打开

- **GIVEN** 已归档会话 `t1`，且 `thread/unarchive` 返回 error
- **WHEN** 用户点该条目打开会话
- **THEN** 向用户展示错误消息
- **AND** 该会话仍被打开（不因为取消归档失败而吞掉打开动作）

## ADDED Requirements

### Requirement: 已打开标签识别（只认已绑定会话的标签）

插件 SHALL 从 VS Code 标签页状态中识别出属于 Codex 会话编辑器的标签，解析其会话 id，并保留该标签页自己的 resource —— 后者是「聚焦这个已打开的标签」唯一可靠的凭据。解析不出会话 id 的标签（尚未绑定会话的新面板）SHALL 被忽略，SHALL NOT 以任何合成身份进入后续链路。

#### Scenario: 识别 Codex 会话标签并解析 id

- **GIVEN** 一个标签的 input 是 custom 编辑器，viewType 为 `chatgpt.conversationEditor`，uri 为 `openai-codex://route/local/01a0becc-10ff-7a00-8574-923d5b93bae0`
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果含一项，其 `conversationId` 为 `01a0becc-10ff-7a00-8574-923d5b93bae0`

#### Scenario: 忽略非 Codex 标签

- **GIVEN** 标签集合中含一个普通文本编辑器标签和一个 viewType 为 `other.editor` 的 custom 标签
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果为空数组

#### Scenario: 尚未绑定会话的新面板标签被忽略

- **GIVEN** 标签集合中有一个 Codex custom 标签，其 uri 为 `openai-codex://route/extension/panel/new?newPanel=n1`
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果为空数组（该标签不产生任何条目，也不产生任何合成 id）

#### Scenario: 保留每个标签页自己的 resource（含 query 与 scheme 差异）

- **GIVEN** 已打开标签中有两个 Codex custom 标签，一个的 uri 为 `openai-codex://route/local/conv-1?projectId=p1`，另一个的 uri 为 `openai-codex://route/remote/conv-r`
- **WHEN** 调用 `scanCodexTabs`
- **THEN** 结果中两项各自的 `uri` 分别等于这两个标签自己的 uri（path 与 query 原样保留，不被裁剪、不被重拼）

### Requirement: 会话置顶与取消置顶后的归位

插件 SHALL 把置顶的会话 id 持久化在插件自身的全局状态中，并让置顶会话排在列表前部。置顶会话 SHALL NOT 因为该会话被打开而从「置顶」分组移除；取消置顶后该会话 SHALL 按最近度归入「最近」或「历史」分组（无论它是否开着标签）。

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

#### Scenario: 取消置顶的已打开会话按最近度归位

- **GIVEN** 会话 `a` 既被置顶又已经在标签页里打开，且它是未置顶会话里最近更新的一个
- **WHEN** 对 `a` 执行取消置顶并重新构建树数据
- **THEN** 「置顶」组不再含 `a`
- **AND** `a` 出现在「最近」组，且该行仍带「已打开」标记（它有标签 resource）

### Requirement: 树视图分组、状态标识与过滤

侧边栏 SHALL 把会话分为「置顶」「最近」「历史」「已归档」四组展示，并支持按关键词过滤。一个会话 SHALL 只在树中出现一行，归属按以下优先级唯一确定：已归档的会话归「已归档」组；其余会话中置顶的归「置顶」组；再其余中 `updatedAt` 最大的 10 个归「最近」组；剩下的归「历史」组。尚未绑定会话的新面板标签 SHALL NOT 出现在任何分组里。条目的节点 id SHALL 为 `session:<分组>:<会话id>`，且「已归档」组中条目的 `contextValue` SHALL 为 `session.archived`（其余组沿用 `session` / `session.open` / `session.pinned`）。条目 SHALL 以图标呈现状态：运行中的会话用运行图标，已经在标签页里打开的会话用「已打开」图标，其余用普通图标（即运行中优先级高于已打开）。已打开的条目 SHALL 把该标签自己的 resource 一并交给打开命令。条目的描述文本 SHALL 呈现该会话所在目录的**末级目录名**，并在会话被置顶时以 `📌` 作为前缀；会话没有目录信息时，描述文本 SHALL 不含目录部分。「置顶」与「最近」分组 SHALL 默认展开，「历史」与「已归档」分组 SHALL 默认折叠。

#### Scenario: 三组分别归位

- **GIVEN** 会话 `a` 被置顶、会话 `b` 未置顶且最近更新、会话 `c` 未置顶且很早更新
- **WHEN** 构建树数据（会话总数超过 10）
- **THEN** `a` 在「置顶」组、`b` 在「最近」组、`c` 在「历史」组

#### Scenario: 已归档的会话只出现在已归档分组

- **GIVEN** `thread/list`（`archived: false`）返回会话 `b`、`c`，`thread/list`（`archived: true`）返回会话 `z`（`z` 的 `updatedAt` 最大并已被置顶）
- **WHEN** 构建树数据
- **THEN** `z` 出现在「已归档」组
- **AND** 「置顶」「最近」「历史」三组都不含 `z`

#### Scenario: 置顶的已归档会话仍在已归档分组且带置顶标识

- **GIVEN** 已归档会话 `z` 同时被置顶
- **WHEN** 请求 `z` 的 TreeItem
- **THEN** 其 `description` 以 `📌` 开头
- **AND** 其 `contextValue` 为 `session.archived`

#### Scenario: 最近分组只取最近更新的 10 个未置顶会话

- **GIVEN** `thread/list` 返回 12 个未置顶会话，`updatedAt` 依次为 120、119、…、109
- **WHEN** 构建树数据
- **THEN** 「最近」组恰好含 `updatedAt` 最大的 10 个（120…111），按更新时间倒序排列
- **AND** 「历史」组含剩下的 2 个（110、109）

#### Scenario: 未置顶会话不足 10 个时最近分组全收

- **GIVEN** `thread/list` 返回 3 个未置顶会话
- **WHEN** 构建树数据
- **THEN** 3 个全部在「最近」组
- **AND** 结果中不含「历史」分组节点

#### Scenario: 置顶的会话不出现在最近分组

- **GIVEN** 会话 `a` 既被置顶又是未置顶会话里最近更新的一个
- **WHEN** 构建树数据
- **THEN** 「置顶」组含 `a`
- **AND** 「最近」组不含 `a`

#### Scenario: 最近与历史互斥

- **GIVEN** `thread/list` 返回 12 个未置顶会话
- **WHEN** 构建树数据
- **THEN** 没有任何会话同时出现在「最近」与「历史」两组

#### Scenario: 已打开的会话出现在最近或历史分组

- **GIVEN** 会话 `b` 未置顶且最近更新，且有对应的已打开标签
- **WHEN** 构建树数据
- **THEN** `b` 出现在「最近」组，其 `open` 为 `true`
- **AND** 树中没有任何名为「已打开」的分组节点

#### Scenario: 尚未绑定会话的新面板不产生任何条目

- **GIVEN** 已打开标签只有一个未绑定会话的新面板标签（`conversationId` 为 `null`）
- **AND** `thread/list` 返回两条会话 `b`、`c`
- **WHEN** 构建树数据
- **THEN** 结果中不含任何来自该标签的条目
- **AND** 「最近」组含 `b` 与 `c`

#### Scenario: 置顶会话被打开后仍保留在置顶组且只有一行

- **GIVEN** 会话 `a` 既被置顶又已经在标签页里打开
- **WHEN** 构建树数据
- **THEN** 「置顶」组含 `a`，其余两组不含 `a`
- **AND** 树中 `a` 只出现一次

#### Scenario: 条目节点 id 含分组段

- **GIVEN** 会话 `a` 被置顶
- **WHEN** 请求 `a` 的 TreeItem
- **THEN** 其 `id` 为 `session:pinned:a`

#### Scenario: 已打开条目把标签 resource 交给打开命令

- **GIVEN** 会话 `b` 未置顶，其标签 resource 为 `openai-codex://route/local/b`
- **WHEN** 请求 `b` 的 TreeItem
- **THEN** 其 `command.arguments` 内携带该标签的 resource
- **AND** 未打开的会话（没有标签）该字段为 `null`

#### Scenario: 运行中的条目使用运行图标

- **GIVEN** 会话 `a` 在运行集合中，会话 `b` 不在
- **WHEN** 请求两者的 TreeItem
- **THEN** `a` 的图标 id 为 `loading~spin`
- **AND** `b` 的图标 id 为原有的 `window`（已打开）或 `comment-discussion`（未打开）

#### Scenario: 开着且正在运行的会话显示运行图标

- **GIVEN** 会话 `a` 既有已打开的标签，又在运行集合中
- **WHEN** 请求 `a` 的 TreeItem
- **THEN** 其图标 id 为 `loading~spin`（运行中优先于已打开）

#### Scenario: 置顶的条目显示置顶标识

- **GIVEN** 会话 `a` 被置顶、会话 `b` 未被置顶
- **WHEN** 请求两者的 TreeItem
- **THEN** `a` 的 `description` 以 `📌` 开头
- **AND** `a` 的 `description` 在 `📌` 之后为 `a` 所在目录的末级目录名
- **AND** `b` 的 `description` 不含 `📌`

#### Scenario: 条目描述显示会话所在目录的末级名称

- **GIVEN** 会话 `a` 的 `cwd` 为 `/home/hk/github/vscode-codex-helper`
- **WHEN** 请求 `a` 的 TreeItem
- **THEN** 其 `description` 为 `vscode-codex-helper`
- **AND** 其 `description` 不含该会话的首条消息文本

#### Scenario: 没有目录信息的会话不显示描述

- **GIVEN** 会话 `t8` 的 `cwd` 为 `null`（`thread/list` 未返回该信息）
- **WHEN** 请求 `t8` 的 TreeItem
- **THEN** 其 `description` 为空
- **AND** 若 `t8` 同时被置顶，则其 `description` 恰为 `📌`，末尾不带多余空白

#### Scenario: 已打开且已置顶的条目右键菜单给出取消置顶

- **GIVEN** 会话 `a` 既被置顶又有已打开的标签
- **WHEN** 构建 `a` 的条目
- **THEN** 其 `contextValue` 为 `session.pinned`（对应「取消置顶」菜单项），而不是 `session.open`

#### Scenario: 空分组不渲染分组节点

- **GIVEN** 没有任何置顶会话，且 `thread/list` 返回空列表
- **WHEN** 构建树数据
- **THEN** 结果中不含任何分组节点

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
- **AND** `thread/list` 返回的列表中不含 `t9`
- **WHEN** 构建树数据
- **THEN** 结果中不含 `t9` 的任何条目

#### Scenario: 已打开但服务端列表里没有的会话不渲染

- **GIVEN** 有一个已打开的 Codex 标签对应会话 `t8`，而 `thread/list` 返回的列表中不含 `t8`
- **WHEN** 构建树数据
- **THEN** 结果中不含 `t8` 的任何条目（标题与目录都来自服务端数据，侧边栏不再用标签标题兜底造行）

#### Scenario: 运行状态随会话数据一起传递给条目

- **GIVEN** 构建树数据时传入的运行集合为 `{a}`
- **WHEN** 构建完成
- **THEN** 会话 `a` 的 `running` 为 `true`，其余会话的 `running` 为 `false`

#### Scenario: 置顶与最近分组默认展开历史与已归档分组默认折叠

- **GIVEN** 构建结果同时含「置顶」「最近」「历史」三个分组
- **WHEN** 请求各分组节点的 TreeItem
- **THEN** 「置顶」与「最近」分组的 `collapsibleState` 为 `Expanded`，「历史」分组的 `collapsibleState` 为 `Collapsed`

### Requirement: 新建会话（每次点击独立面板，不进侧边栏）

插件 SHALL 提供一个「新建会话」命令，每次执行都通过 `vscode.openWith` 打开 Codex 的 new-thread-panel 路由（`openai-codex://route/extension/panel/new`）并携带一个**本次调用独有**的 `newPanel` query，使连续多次执行各自打开一个独立标签页；创建失败时 SHALL 提示错误，且 SHALL NOT 把异常抛回命令层。插件 SHALL NOT 再通过 `chatgpt.newCodexPanel` 委派新建——该入口固定使用同一个 resource，在 `supportsMultipleEditorsPerDocument: false` 下无法开出第二个标签。

该面板在绑定会话之前 SHALL NOT 出现在侧边栏的任何分组里（见「树视图分组、状态标识与过滤」）；这是为「侧边栏只列会话」付出的代价，用户仍可在编辑器标签栏里找到它。

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

#### Scenario: 尚未绑定会话的新建面板不进侧边栏

- **GIVEN** 已打开标签中有一个 `conversationId` 为 `null` 的新建会话标签，标签标题为 `Codex`
- **AND** `thread/list` 返回的列表中不含该标签对应的会话
- **WHEN** 构建树数据
- **THEN** 结果中不含该标签的任何条目（不产生「未命名」占位行，也不产生合成 id）

#### Scenario: 带 query 的新面板 URI 不被误判为会话

- **GIVEN** URI 为 `openai-codex://route/extension/panel/new?newPanel=n1`
- **WHEN** 解析该 URI 的会话 id
- **THEN** 得到 `null`（该标签因此不会进入侧边栏）

### Requirement: 侧边栏标题

侧边栏标题 SHALL 由「活动栏容器标题」与「视图名」组成且重复词只出现一次：容器标题 SHALL 为 `Codex`，视图名 SHALL 为 `会话`。视图 SHALL NOT 声明 `contextualTitle` —— VS Code 会把容器标题与视图名/上下文标题一起渲染成 `<容器标题>: <视图名>` 形态，两段都写「会话」会让标题栏显示成 `CODEX 会话: 会话`。

#### Scenario: 侧边栏标题不出现重复的「会话」

- **GIVEN** 扩展清单 `package.json` 的 `contributes.viewsContainers.activitybar` 与 `contributes.views.codexHelper`
- **WHEN** 读取该容器的 `title` 与其中视图的 `name` / `contextualTitle`
- **THEN** 容器 `title` 为 `Codex`，视图 `name` 为 `会话`
- **AND** 该视图未声明 `contextualTitle`
- **AND** 把两者拼成标题栏文案（`Codex: 会话`）时「会话」只出现一次

### Requirement: 会话归档与删除（先归档再删除）

侧边栏 SHALL 用「先归档、再删除」两步表达删除意图：

插件 SHALL 为**未归档**的会话条目提供「归档会话」悬停按钮（`view/item/context` 的 `inline` 组，图标 `$(archive)`），执行时直接调用 app-server 的 `thread/archive`（参数 `{threadId}`），SHALL NOT 请求用户确认（归档可逆）。插件 SHALL NOT 为未归档条目提供删除入口。

插件 SHALL 为「已归档」分组中的条目提供「删除会话」悬停按钮（图标 `$(trash)`），执行时直接调用 `thread/delete`（参数 `{threadId}`），SHALL NOT 请求用户确认 —— 「必须先归档」本身就是防误删的那道闸，删除只对已归档会话开放。已归档条目 SHALL 另提供「取消归档」（`thread/unarchive`）入口，使归档可逆。

三个命令成功后 SHALL 刷新侧边栏；失败时 SHALL 展示错误消息且不改变本地状态（不取消置顶、不关标签、不刷新）。插件 SHALL NOT 再为条目提供「打开会话」悬停按钮（点击条目本身即为打开，该命令保留在右键菜单中）。归档与取消归档 SHALL NOT 改动标签页；只有删除成功 SHALL 关闭显示该会话的标签页，其它标签 SHALL 不受影响。

#### Scenario: 未归档条目提供归档按钮、已归档条目提供删除按钮

- **GIVEN** 扩展清单 `package.json` 的 `contributes.menus["view/item/context"]`
- **WHEN** 读取 `view == codexHelper.sessions` 下的会话条目贡献
- **THEN** `codexHelper.archiveSession` 出现在未归档条目的 `inline` 组（图标 `$(archive)`）
- **AND** `codexHelper.deleteSession` 只出现在 `session.archived` 条目的 `inline` 组（图标 `$(trash)`），不出现在未归档条目上
- **AND** `codexHelper.openSession` 不出现在 `inline` 组，但仍出现在非 inline 的菜单组里

#### Scenario: 归档不弹确认直接执行

- **GIVEN** 未归档会话 `t1`
- **WHEN** 点该条目的归档按钮
- **THEN** 恰好发出一次 `thread/archive`，参数为 `{threadId: 't1'}`
- **AND** 全程没有弹出任何警告/确认对话框

#### Scenario: 删除已归档会话不弹确认直接执行

- **GIVEN** 已归档会话 `t1`
- **WHEN** 点该条目的删除按钮
- **THEN** 恰好发出一次 `thread/delete`，参数为 `{threadId: 't1'}`
- **AND** 全程没有弹出任何警告/确认对话框

#### Scenario: 取消归档

- **GIVEN** 已归档会话 `t1`
- **WHEN** 执行取消归档
- **THEN** 恰好发出一次 `thread/unarchive`，参数为 `{threadId: 't1'}`

#### Scenario: 归档失败时报错且不改变本地状态

- **GIVEN** `thread/archive` 返回 error
- **WHEN** 归档会话 `t1`
- **THEN** 向用户展示错误消息，且列表未刷新、没有标签被关闭

#### Scenario: 删除失败时报错且不改变本地状态

- **GIVEN** `thread/delete` 返回 error
- **WHEN** 删除已归档会话 `t1`
- **THEN** 向用户展示错误消息，且列表未刷新、没有标签被关闭

#### Scenario: 归档与取消归档不改动标签页

- **GIVEN** 会话 `t1` 正在标签页里打开
- **WHEN** 归档 `t1` 成功，随后又取消归档成功
- **THEN** 两次操作都没有关闭任何标签页
- **AND** 两次操作都刷新了列表

#### Scenario: 删除只关闭被删会话自己的标签

- **GIVEN** 标签页里同时开着会话 `t1` 与 `t2`，且两者都已归档
- **WHEN** 删除 `t1` 成功
- **THEN** 只有 `t1` 的标签被关闭，`t2` 的标签保持打开
- **AND** 列表刷新

## REMOVED Requirements

### Requirement: 已打开标签页识别

**Reason**: 原 requirement 要求把尚未绑定会话的新面板标签「保留为未命名项」，因此 `OpenTab.id` 允许为 `null`，树里给这类标签合成 id `open-tab:<index>`。生产日志证明该合成 id 会被当作会话 id 打开（`conversationId=open-tab:0` → `invalid thread id`），而用户既定方向是「不显示未绑定面板行」——该 scenario 因此被推翻。

**Migration**: 由本变更 `## ADDED Requirements` 的 `### Requirement: 已打开标签识别（只认已绑定会话的标签）` 替代。被推翻的 `新建但尚未绑定会话的标签保留为未命名项` 由新 requirement 的 `尚未绑定会话的新面板标签被忽略` 取代；`识别 Codex 会话标签并解析 id`、`忽略非 Codex 标签` 两条逐字保留，并新增 `保留每个标签页自己的 resource`。

### Requirement: 会话置顶

**Reason**: 原 requirement 的 `取消置顶后已打开的那一行仍然保留` 建立在「已打开」分组存在的前提上（当时断言该组仍含 `a`）。本变更删除「已打开」组并引入「最近」组，该 scenario 的前提不再存在。

**Migration**: 由 `## ADDED Requirements` 的 `### Requirement: 会话置顶与取消置顶后的归位` 替代：`置顶后写入全局状态`、`取消置顶后从全局状态移除`、`首次读取时全局状态为空值` 三条逐字保留，`取消置顶后已打开的那一行仍然保留` 改写为 `取消置顶的已打开会话按最近度归位`。

### Requirement: 树视图组织、状态标识与过滤

**Reason**: 原 requirement 以「已打开 / 置顶 / 历史」三组为骨架，并包含两条随之失效的 scenario：`同一会话在两组中的树节点 id 不同`（一个会话不再可能出现在两组）与 `已打开但不在服务端列表中的会话仍然显示`（该组被删除后不再有标签标题兜底的行）。用户要求改为「置顶 / 最近 / 历史」三组、一个会话一行。

**Migration**: 由 `## ADDED Requirements` 的 `### Requirement: 树视图分组、状态标识与过滤` 替代。多数 scenario 逐条保留（描述、📌、过滤、无名标题、幽灵置顶、运行状态、空分组、运行/已打开图标、contextValue），新增「三组分别归位」「最近分组只取最近更新的 10 个未置顶会话」「未置顶会话不足 10 个时最近分组全收」「置顶的会话不出现在最近分组」「最近与历史互斥」「已打开的会话出现在最近或历史分组」「尚未绑定会话的新面板不产生任何条目」「已打开但服务端列表里没有的会话不渲染」「置顶与最近分组默认展开历史分组默认折叠」；被推翻的两条在迁移中明确删除。

### Requirement: 新建会话（每次点击独立面板）

**Reason**: 原 requirement 的 `尚未绑定会话的新建标签以未命名项出现在「已打开」组` 断言未绑定面板会产生占位行，与本变更「未绑定面板不进侧边栏」直接冲突。nonce 机制本身未变，故只重写该 requirement 的场景集并改名以便 OpenSpec 归档。

**Migration**: 由 `## ADDED Requirements` 的 `### Requirement: 新建会话（每次点击独立面板，不进侧边栏）` 替代：`每次执行都打开带上本次调用独有 query 的新面板 URI`、`连续两次执行产生两个互不相同的 URI`、`新建失败时提示错误`、`带 query 的新面板 URI 不被误判为会话` 四条逐字保留（最后一条的括号说明改为「因此不会进入侧边栏」），被推翻的占位行 scenario 改写成 `尚未绑定会话的新建面板不进侧边栏`。
