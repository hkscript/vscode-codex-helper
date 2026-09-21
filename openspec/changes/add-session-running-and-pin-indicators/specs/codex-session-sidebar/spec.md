# codex-session-sidebar 规格变更

## ADDED Requirements

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

## ADDED Requirements` 中的 `### Requirement: 树视图组织、状态标识与过滤` 整体替代，未变更的 scenario 已逐条保留在新 requirement 中。


### Requirement: 树视图组织、状态标识与过滤

侧边栏 SHALL 把会话分为「已打开」「置顶」「历史」三组展示，并支持按关键词过滤。一个会话 SHALL 可以同时出现在「已打开」与「置顶」两组中，「历史」组 SHALL 与前两组互斥。同一会话在不同分组中的树节点 SHALL 使用不同的节点 id。条目 SHALL 以图标呈现「运行中」状态、以描述文本呈现「置顶」状态。「已打开」与「置顶」分组 SHALL 默认展开（不折叠），「历史」分组 SHALL 默认折叠。

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
- **AND** `b` 的 `description` 不含 `📌`

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 树视图组织与过滤

**Reason**: 分组互斥规则被本次变更推翻——置顶会话被打开后不再从「置顶」组移除，因此「同一会话只出现在优先级最高的一组」这条核心约束及其 `Scenario: 已打开优先于置顶，不重复出现` 不再成立。同时条目新增运行中 / 置顶两种状态标识，requirement 的职责范围随之扩大。

**Migration**: 由下方 `
