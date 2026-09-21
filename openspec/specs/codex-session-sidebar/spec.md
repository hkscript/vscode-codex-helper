# codex-session-sidebar Specification

## Purpose
TBD - created by archiving change add-codex-session-sidebar. Update Purpose after archive.

## Requirements

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

插件 SHALL 把置顶的会话 id 持久化在插件自身的全局状态中，并让置顶会话排在列表前部。置顶会话 SHALL NOT 因为该会话被打开而从「置顶」分组移除。

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

#### Scenario: 取消置顶后已打开的那一行仍然保留

- **GIVEN** 会话 `a` 既被置顶又有已打开的标签，「已打开」与「置顶」两组各有一行 `a`
- **WHEN** 对 `a` 执行取消置顶并重新构建树数据
- **THEN** 「置顶」组不再含 `a`，「已打开」组仍含 `a`

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

### Requirement: 会话运行状态识别

插件 SHALL 判定每个会话当前是否正在执行回合，判定依据 SHALL 为「最新回合没有终止记录」与「该会话的 rollout 文件被存活的 codex 进程持有」两个条件的合取。在能够探测进程归属的平台上，判定 SHALL NOT 依赖时间阈值。单个会话的回合查询失败或数据缺失 SHALL 降级为「非运行」，不得影响其他会话或整棵树的渲染。

#### Scenario: 最新回合为 inProgress 且归属进程存活时判定为运行中

- **GIVEN** 会话 `t1` 的最新回合 `status` 为 `inProgress`、`completedAt` 为 `null`
- **AND** `t1` 的 rollout 文件被一个存活的 codex 进程持有
- **WHEN** 计算运行集合
- **THEN** 运行集合包含 `t1`

#### Scenario: 跨进程读到的运行中回合编码为 interrupted 且 completedAt 为空

- **GIVEN** 会话 `t1` 的最新回合 `status` 为 `interrupted`、`completedAt` 为 `null`
- **AND** `t1` 的 rollout 文件被一个存活的 codex 进程持有
- **WHEN** 计算运行集合
- **THEN** 运行集合包含 `t1`

#### Scenario: 最新回合已终止时判定为非运行

- **GIVEN** 会话 `t1` 的最新回合分别为 `completed`、`failed`、`interrupted` 且三者的 `completedAt` 均非空
- **AND** `t1` 的 rollout 文件被存活进程持有
- **WHEN** 分别计算运行集合
- **THEN** 三种情况下运行集合都不包含 `t1`

#### Scenario: 无终止记录但没有存活进程持有时判定为非运行

- **GIVEN** 会话 `t1` 的最新回合 `status` 为 `interrupted`、`completedAt` 为 `null`
- **AND** 没有任何存活的 codex 进程持有 `t1` 的 rollout 文件
- **WHEN** 计算运行集合
- **THEN** 运行集合不包含 `t1`

#### Scenario: 长时间无写入不改变运行判定

- **GIVEN** 会话 `t1` 的最新回合无终止记录，且其 rollout 文件的修改时间已远早于陈旧阈值
- **AND** `t1` 的 rollout 文件仍被存活进程持有
- **WHEN** 计算运行集合
- **THEN** 运行集合仍包含 `t1`

#### Scenario: 没有任何回合记录的会话判定为非运行

- **GIVEN** 会话 `t1` 的回合查询返回空列表
- **AND** `t1` 的 rollout 文件被存活进程持有
- **WHEN** 计算运行集合
- **THEN** 运行集合不包含 `t1`

#### Scenario: rollout 文件缺失时判定为非运行且不抛错

- **GIVEN** 会话 `t1` 的 `path` 为 `null`，会话 `t2` 的 `path` 指向一个不存在的文件
- **WHEN** 计算运行集合
- **THEN** 计算过程不抛出异常，且运行集合既不含 `t1` 也不含 `t2`

#### Scenario: 单个会话的回合查询失败不影响其他会话

- **GIVEN** 候选会话为 `t1` 与 `t2`，`t1` 的回合查询抛出错误
- **AND** `t2` 的最新回合无终止记录且被存活进程持有
- **WHEN** 计算运行集合
- **THEN** 运行集合包含 `t2` 且不包含 `t1`，计算过程不向上抛错

#### Scenario: 无法探测进程归属的平台在阈值内视为运行中

- **GIVEN** 当前平台无法探测进程归属
- **AND** 会话 `t1` 的最新回合无终止记录，其 rollout 文件修改时间距今小于陈旧阈值
- **WHEN** 计算运行集合
- **THEN** 运行集合包含 `t1`

#### Scenario: 无法探测进程归属的平台超过阈值视为非运行

- **GIVEN** 当前平台无法探测进程归属
- **AND** 会话 `t1` 的最新回合无终止记录，其 rollout 文件修改时间距今大于陈旧阈值
- **WHEN** 计算运行集合
- **THEN** 运行集合不包含 `t1`

#### Scenario: 未被任何进程持有的会话不发起回合查询

- **GIVEN** 会话列表含 10 个会话，其中只有 `t1` 的 rollout 文件被存活进程持有
- **AND** 当前平台可以探测进程归属
- **WHEN** 筛选需要查询回合的候选会话
- **THEN** 候选集合只含 `t1`

#### Scenario: 回合查询使用最新一条且按降序排序

- **GIVEN** 需要查询会话 `t1` 的最新回合
- **WHEN** 调用回合列表接口
- **THEN** 请求方法为 `thread/turns/list`，参数为 `{threadId: 't1', limit: 1, sortDirection: 'desc'}`
- **AND** 返回值取 `data[0]`，列表为空时返回 `undefined`

### Requirement: rollout 文件归属探测

在支持 `/proc` 的平台上，插件 SHALL 通过扫描存活进程持有的文件描述符，得出「rollout 文件 → 持有它的 codex 进程」映射；扫描过程中任何单个进程或描述符读取失败 SHALL 被跳过，不得中断整轮扫描。

#### Scenario: 扫描出持有 rollout 文件的 codex 进程

- **GIVEN** 存在进程 `12990`，其 `cmdline` 同时含 `codex` 与 `app-server`
- **AND** 该进程的某个文件描述符指向 `/home/u/.codex/sessions/2026/09/21/rollout-2026-09-21T13-08-48-01a0c25d-e390-7c92-94e1-8c42bbef896c.jsonl`
- **WHEN** 执行归属扫描
- **THEN** 结果中 `01a0c25d-e390-7c92-94e1-8c42bbef896c` 映射到进程 `12990`

#### Scenario: 非 codex 进程持有的 rollout 文件被忽略

- **GIVEN** 进程 `777` 的 `cmdline` 为 `tail -f .../rollout-...-<uuid>.jsonl`，不含 `app-server`
- **WHEN** 执行归属扫描
- **THEN** 结果中不含该 uuid

#### Scenario: 扫描过程中进程消失不影响其余结果

- **GIVEN** 进程 `A` 的描述符读取抛出错误，进程 `B` 正常且持有一个 rollout 文件
- **WHEN** 执行归属扫描
- **THEN** 扫描不抛出异常，且结果包含进程 `B` 持有的那个会话

### Requirement: 运行状态自动刷新

插件 SHALL 监听候选会话 rollout 文件的变化，在去抖窗口结束后重新计算运行集合；重入的重算 SHALL 只采用最新一轮的结果；只有当运行集合发生变化时才 SHALL 通知树刷新。监听建立失败时 SHALL 退化为定时轮询。插件停用时 SHALL 释放全部监听与定时器。

#### Scenario: rollout 文件写入后自动重算并刷新

- **GIVEN** 会话 `t1` 是候选会话且当前不在运行集合中
- **WHEN** `t1` 的 rollout 文件发生写入，且重算后 `t1` 变为运行中
- **THEN** 去抖窗口结束后触发一次变化回调，回调携带的运行集合含 `t1`

#### Scenario: 去抖窗口内的多次写入只触发一次回调

- **GIVEN** 会话 `t1` 的 rollout 文件在去抖窗口内被写入 3 次
- **WHEN** 去抖窗口结束
- **THEN** 变化回调只被触发 1 次

#### Scenario: 运行集合未变化时不触发回调

- **GIVEN** 运行集合当前为 `{t1}`
- **WHEN** 文件变化后重算结果仍为 `{t1}`
- **THEN** 不触发变化回调

#### Scenario: 监听建立失败时退化为轮询

- **GIVEN** 对候选文件建立监听时抛出错误
- **WHEN** 追踪器启动
- **THEN** 追踪器启用定时轮询，并在每个轮询间隔重算一次运行集合

#### Scenario: 候选集合变化时释放不再需要的监听

- **GIVEN** 上一轮候选为 `{t1, t2}`，已各自建立监听
- **WHEN** 新一轮候选变为 `{t2, t3}`
- **THEN** `t1` 的监听被释放，`t3` 的监听被建立，`t2` 的监听不被重建

#### Scenario: 重入的重算只采用最新一轮结果

- **GIVEN** 第一轮重算的回合查询尚未返回
- **WHEN** 第二轮重算被触发并先行返回结果
- **THEN** 第一轮迟到的结果被丢弃，运行集合以第二轮为准

#### Scenario: 释放追踪器时回收全部监听与定时器

- **GIVEN** 追踪器已建立 2 个文件监听与 1 个轮询定时器
- **WHEN** 释放追踪器
- **THEN** 2 个监听全部被释放，定时器被清除

### Requirement: 树视图组织、状态标识与过滤

侧边栏 SHALL 把会话分为「已打开」「置顶」「历史」三组展示，并支持按关键词过滤。一个会话 SHALL 可以同时出现在「已打开」与「置顶」两组中，「历史」组 SHALL 与前两组互斥。同一会话在不同分组中的树节点 SHALL 使用不同的节点 id。条目 SHALL 以图标呈现「运行中」状态；条目的描述文本 SHALL 呈现该会话所在目录的**末级目录名**，并在会话被置顶时以 `📌` 作为前缀；会话没有目录信息时，描述文本 SHALL 不含目录部分。「已打开」与「置顶」分组 SHALL 默认展开（不折叠），「历史」分组 SHALL 默认折叠。

#### Scenario: 三组分别归位

- **GIVEN** 会话 `a` 有对应的已打开标签、会话 `b` 被置顶、会话 `c` 两者都不是
- **WHEN** 构建树数据
- **THEN** `a` 在「已打开」组、`b` 在「置顶」组、`c` 在「历史」组

#### Scenario: 置顶会话被打开后仍保留在置顶组

- **GIVEN** 会话 `a` 既被置顶又有已打开的标签
- **WHEN** 构建树数据
- **THEN** 「已打开」组含 `a`，「置顶」组同样含 `a`
- **AND** 「历史」组不含 `a`

#### Scenario: 同一会话在两组中的树节点 id 不同

- **GIVEN** 会话 `a` 同时出现在「已打开」与「置顶」两组
- **WHEN** 请求这两个条目的 TreeItem
- **THEN** 两者的 `id` 分别为 `session:open:a` 与 `session:pinned:a`，互不相同

#### Scenario: 运行中的条目使用运行图标

- **GIVEN** 会话 `a` 在运行集合中，会话 `b` 不在
- **WHEN** 请求两者的 TreeItem
- **THEN** `a` 的图标 id 为 `loading~spin`
- **AND** `b` 的图标 id 仍为原有的 `window`（已打开）或 `comment-discussion`（未打开）

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

- **GIVEN** 有一个已打开的 Codex 标签对应会话 `t8`，且 `thread/list` 返回的列表中不含 `t8`（因此其 `cwd` 为 `null`）
- **WHEN** 请求 `t8` 的 TreeItem
- **THEN** 其 `description` 为空
- **AND** 若 `t8` 同时被置顶，则其 `description` 恰为 `📌`，末尾不带多余空白

#### Scenario: 已打开且已置顶的条目右键菜单给出取消置顶

- **GIVEN** 会话 `a` 既被置顶又有已打开的标签
- **WHEN** 构建「已打开」组中 `a` 的条目
- **THEN** 其 `contextValue` 为 `session.pinned`（对应「取消置顶」菜单项），而不是 `session.open`

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

#### Scenario: 运行状态随会话数据一起传递给条目

- **GIVEN** 构建树数据时传入的运行集合为 `{a}`
- **WHEN** 构建完成
- **THEN** 会话 `a` 的 `running` 为 `true`，其余会话的 `running` 为 `false`

#### Scenario: 已打开与置顶分组默认展开

- **GIVEN** 构建结果同时含「已打开」「置顶」「历史」三个分组
- **WHEN** 请求各分组节点的 TreeItem
- **THEN** 「已打开」与「置顶」分组的 `collapsibleState` 为 `Expanded`，「历史」分组的 `collapsibleState` 为 `Collapsed`
