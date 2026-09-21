# 设计：侧边栏只列会话（置顶 / 最近 / 历史），点击已打开的会话聚焦其标签

## 目标

把侧边栏的粒度从「标签 + 会话混装」收敛为**只列会话**：

1. 树只渲染「置顶」「最近」「历史」「已归档」四组：已归档优先；其余会话里置顶的进「置顶」；再其余中 `updatedAt` 最大的 10 个进「最近」；剩下的进「历史」。一个会话永远只有一行；
2. 未绑定会话的标签（`/extension/panel/new?newPanel=<nonce>`）**在任何分组里都不出现**，合成 id `open-tab:<index>` 从系统里消失；
3. 仍然识别「已打开」状态：给会话行打窗口图标，并携带该标签自己的 resource —— 点击时**聚焦**那个已经打开的标签（含远端/带 query 的标签），没有标签 resource 的行按会话 id 打开；
4. 失败语义不变：报错、不回退、不静默新建。
5. 用**两步**表达删除：未归档条目悬停显示「归档」（`thread/archive`，可逆、不确认）；「已归档」分组（默认折叠，放最后）里悬停显示「删除」（`thread/delete`，不确认），并提供「取消归档」；移除冗余的「打开会话」悬停按钮。

## 关键调研结论（改动点依据）

证据三类：本仓库源码、生产日志（本机 VS Code Server 输出通道日志）、上游 Codex 插件产物（`~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64`，压缩 bundle 只能给字符偏移）。

| 结论 | 证据 | 确定性 |
|------|------|--------|
| 现状树有三组，`open` 组来自扫描到的标签 | `src/session/sessionStore.ts:117-130` | `[Verified]` |
| 未绑定面板标签被赋合成 id `open-tab:<index>` | `src/session/sessionStore.ts:86-94` | `[Verified]` |
| 条目点击把 `session.id` 当会话 id 交出去 | `src/ui/treeProvider.ts:161-168` → `src/extension.ts:161-164` | `[Verified]` |
| `openSession(id)` 拼 `/local/<id>` | `src/session/opener.ts:26-33`、`src/codex/conversationUri.ts:26-32` | `[Verified]` |
| 扫描丢掉标签自己的 uri | `src/session/openTabs.ts:32-43`、`src/codex/types.ts:64-69` | `[Verified]` |
| **生产日志**：`conversationId=open-tab:0` → `invalid thread id`（thread/read、thread/resume） | `20260921T222443/exthost1/openai.chatgpt/Codex.log:148,154,160,161` | `[Verified]` |
| **生产日志**：第二次复现 `open-tab:1`…`open-tab:5`，两分钟 211 行 | `20260921T230534/exthost1/openai.chatgpt/Codex.log:53,62,376,377` | `[Verified]` |
| 上游 webview 在面板内新建会话只做内部路由跳转，**不改标签 resource** ⇒ 面板对应的会话在树里只能靠 thread 列表出现 | webview `assets/app-initial-*.js`（`p(\`/local/${t}\`)`）；bundle 偏移 1831965 | `[Verified]` |
| 上游自身也拿不到「面板 → 会话」映射（`conversationId == null` 直接跳过） | bundle 偏移 1688781-1692106（`seedPendingConversationsFromTabs`/`trackTabIfNeeded`） | `[Verified]` |
| 同一 resource 再打开 = 聚焦（`supportsMultipleEditorsPerDocument: false`） | `node_modules/@types/vscode/index.d.ts:11399-11410`、`src/session/opener.ts:4-11` | `[Verified]` |
| 重启后标签 resource 与关闭前一致（上游按各自 uri 重开） | bundle 偏移 1840850 附近（`ensureRestoredConversationTabsResolved`） | `[Verified]` |
| 图标优先级现状：运行中 > 已打开 > 普通 | `src/ui/treeProvider.ts:169-175` | `[Verified]` |
| 分组默认折叠态现状：history 折叠，其余展开 | `src/ui/treeProvider.ts:84-88` | `[Verified]` |

## 决策

沿用既有编号（上一变更用到 D32）。

- **D33：删除「已打开」分组，侧边栏的粒度统一为「会话」**。该组列的是标签、另外两组列的是会话，两个粒度混在一起必然产生「同一逻辑会话两行」以及「标签行没有会话语义」的问题——用户报告的正是这两点。删除后一个会话永远只有一行（置顶 → 最近 → 历史 唯一归属）。
- **D34：未绑定会话的标签在扫描阶段丢弃，`OpenTab.id` 收紧为非空字符串**。合成 id 不再存在 ⇒ 本 bug 的机制**按构造**消失（而不是靠「记得别把合成 id 当会话」的约定）。代价是空白面板在侧边栏不可见，这是用户显式选择的取舍（D36）。
- **D35：标签的第二个用途是「聚焦凭据」**。扫描出的绑定标签携带自己的 resource；会话行把它交给打开命令，点击即聚焦已打开的标签（含 `/remote/<id>`、带 query 的标签）。没有它就只能按会话 id 重新拼 resource，那会丢掉 query/远端信息。
- **D36：不为空白面板提供任何替代入口**（不加「打开的面板」组、不做提示）。粒度重新讨论应走新变更，避免在这里堆折中方案。
- **D37：`open` 状态保留为行标记**（窗口图标 + contextValue），因为「已打开」信息本身仍然有用；但**图标优先级不变**（运行中 > 已打开），因此「开着且正在跑」的行看到的是转圈图标。这一点写进 spec，避免验收时被误判为 bug。
- **D38（放弃的方案）：保留「已打开」组、只修点击行为。** 放弃理由：那只是把合成 id 的后果堵住，粒度错配仍在（面板行与历史行各一行、无法显示运行状态）；用户已明确选择删组。
- **D39（放弃的方案）：猜「面板 → 会话」映射**（例如「最近新出现的线程」）。上游自己都拿不到；多窗口/多面板下会把行指向错误会话，与既有原则「宁可如实、不要静默撒谎」（D9/D30）冲突。
- **D40：新增「最近」分组：未置顶会话中 `updatedAt` 最大的 10 个，默认展开；「历史」= 其余未置顶会话**。它承担旧「已打开」组本来要承担的「我最近在忙什么」的入口，但粒度是会话而不是标签。取前 10 而不是「今天/7 天内」是为了与已加载页（`codexHelper.pageSize`）无关地保持可预测——不足 10 个时全收，`历史` 组自然消失（沿用「空分组不渲染」）。排序按 `updatedAt` 倒序而不是依赖输入顺序，避免上游排序变化把分组结果变成隐式的。
- **D41：分组顺序固定为「置顶 → 最近 → 历史」**。理由：置顶是用户手工挑选的集合，语义上最该排最前；「最近」是默认工作区，紧随其后；「历史」是长尾。顺序只由 `buildSessionGroups` 的返回顺序与 `GROUP_LABELS` 决定，调整成本一行。
- **D42：删除分成两步——先归档（`thread/archive`），再在「已归档」分组的条目上删除（`thread/delete`）。** 用户既定方向。两条都是上游一等公民接口（`ThreadArchiveParams` / `ThreadDeleteParams` 都只带 `{threadId}`；CLI 也有 `codex archive` / `codex unarchive` / `codex delete` 三个子命令），且归档可逆 ⇒ 误点代价从「丢对话」降为「多一条可恢复的行」。
- **D43：三步操作都不弹确认框。** 用户明确要求删除「无需确认」。安全性由**流程**提供（删除入口只出现在已归档分组，未归档条目根本点不到删除），而不是由对话框提供。既然不要确认框，也不做「按会话名二次输入」之类的变体。
- **D44：新增「已归档」分组（默认折叠，排最后），成员来自 `thread/list {archived: true}`。** 这既是删除的唯一入口，也是撤销归档的地方（`thread/unarchive`）。实测本机就有 15 个已归档会话，说明这条路径本来就在被使用。每组只取一页（`codexHelper.pageSize`，默认 50）；不为「已归档」扩展「加载更多」（列为已知限制）。
- **D45：分组优先级变成「已归档 > 置顶 > 最近 > 历史」。** 归档的会话不再出现在另外三组（否则同一会话又会两行——正是本次要消灭的东西）。置顶状态**不因归档丢失**：`globalState` 里的 id 保留，取消归档后它回到「置顶」组，归档期间在「已归档」行上仍显示 `📌`。
- **D46：归档与取消归档不动标签页；只有删除会关闭该会话的标签页。** 归档可逆，标签继续开着是合理的（Codex 的 webview 收到 `thread/archived` 会显示归档横幅）；删除不可逆，且本插件与 Codex 各跑一个 app-server 子进程、`thread/deleted` 不会跨进程送达 Codex 侧的 webview，留着标签会让它继续 read/resume 一个已删除的会话（与本次修掉的 `open-tab:0` 报错风暴同类）。关闭范围**严格限定**为「解析出的会话 id 等于被删除 id」的标签。
- **D47：悬停按钮的分配 = 归档（未归档条目）/ 删除（已归档条目）；「打开会话」移出悬停区但保留在右键菜单，`取消归档` 也放右键菜单。** 悬停区只放该组最相关的那个动作，保持用户要的「干净」；点击条目本身仍然是打开，命令不丢。
- **D48：打开已归档会话 = 先取消归档再打开。** 用户要求「点击打开 tab 时回到非归档状态」，这也与上游 Codex 自己那条 `localConversation.archived.unarchive`（"Unarchive and open"）一致：面板里的归档横幅就是这个动作。顺序必须是**先取消归档、再打开**（反过来会让面板先以归档态打开、再被刷新成非归档态）；取消归档失败时报错但**继续打开**——用户点的是「打开」，不该被一个失败的前置动作吞掉，且此时状态如实停留在「已归档」。

  实现落点：这一段是「读一行 → 决定目标 → 必要的准备 → 打开」的编排，单独收在 `src/session/rowOpener.ts`（依赖注入，可单测调用顺序），`extension.ts` 只做接线。

## 现状与影响面

### 改动点 1：标签扫描只保留已绑定会话的标签，并带上它自己的 resource

- 目标：`src/session/openTabs.ts::scanCodexTabs`
- 并行路径：`src/codex/conversationUri.ts::parseConversationId` → 不随改（解析规则不变，仍对 `/extension/panel/new` 返回 `null`）
- 并行路径：`src/codex/conversationUri.ts::buildConversationUri` → 不随改（无标签 resource 的行仍按会话 id 打开）

上游：`src/extension.ts::activate` 注入的 `tabGroups` 快照（`src/extension.ts:79-88`）。下游：`buildSessionGroups` 的 `openTabs` 入参。链路末端：树的「已打开标记 + 聚焦凭据」不再有未绑定标签这一支。`[Verified]`

### 改动点 2：类型收紧与新增字段

- 目标：`src/codex/types.ts::OpenTab`
- 目标：`src/codex/types.ts::SessionItem`
- 目标：`src/codex/types.ts::SessionGroupId`
- 目标：`test/helpers/fakes.ts::makeOpenTab`

（`makeOpenTab` 是测试夹具，随类型收紧一起改：`id` 不再允许 `null`，并给出默认 resource。）

`OpenTab.id: string`（非空）+ 新增 `uri: UriLike`；`SessionItem` 新增 `tabUri: UriLike | null` 与 `archived: boolean`；`SessionGroupId` 由 `'open' | 'pinned' | 'history'` 变为 `'pinned' | 'recent' | 'history' | 'archived'`。`archived` 必须进 `SessionItem`：打开动作需要知道「这一行是归档的」（D48 要先取消归档），而这个信息在树条目上只剩会话 id 与 resource，无法从后者反推。上游：`scanCodexTabs` / `buildSessionGroups` 的构造点；下游：`treeProvider` 与 `openTarget` / `rowOpener`。类型收紧让「合成 id 进入打开链路」在编译期就不可能。`[Verified]`

### 改动点 3：树数据按「置顶 / 最近 / 历史 / 已归档」四组归位

- 目标：`src/session/sessionStore.ts::buildSessionGroups`
- 目标：`src/session/sessionStore.ts::GROUP_LABELS`
- 并行路径：`src/session/sessionStore.ts::sessionItemLabel` → 不随改（标题仍取 thread 名/预览）
- 并行路径：`src/session/sessionStore.ts::matchesFilter` → 不随改（过滤只看 id/label/preview）

语义变化：分组从「已打开 / 置顶 / 历史」变成「置顶 / 最近 / 历史 / 已归档」，入参增加 `archivedThreads`（来自 `thread/list {archived: true}`）。归属唯一确定且互斥：**已归档优先**（`claimed` 先吃掉已归档 id，保证同一会话不会既在「已归档」又在别处）；其余会话里置顶的进「置顶」；再其余按 `updatedAt` 倒序取前 `RECENT_LIMIT = 10` 个进「最近」；剩下的进「历史」。**已打开的会话不再被排除**，而是把 `open` 与 `tabUri` 标在行上；「已归档」组的行 `archived` 为 `true`，其余组为 `false`。`RECENT_LIMIT` 作为模块常量导出，供测试与后续调整引用。上游：`src/extension.ts::load`；下游：`treeProvider.getTreeItem`、`rowOpener`。`[Verified]`

### 改动点 4：树条目的命令参数带上标签 resource

- 目标：`src/ui/treeProvider.ts::getTreeItem`
- 并行路径：`src/ui/treeProvider.ts::getChildren` → 不随改
- 并行路径：`src/ui/treeProvider.ts::cwdBasename` → 不随改
- 并行路径：`src/ui/treeProvider.ts::defaultCollapsibleState` → 不随改（`history` 折叠、其余展开，两组时语义不变）

上游：`buildSessionGroups` 的行数据；下游：`resolveOpenTarget`。图标与 contextValue 的既有优先级保持不变。`[Verified]`

### 改动点 5：打开目标的判定与「点哪行去哪」的编排

- 目标：`src/session/openTarget.ts::resolveOpenTarget`
- 目标：`src/session/openTarget.ts::readSessionRow`
- 目标：`src/session/rowOpener.ts::createRowOpener`

`readSessionRow` 把两种节点形状（tree item 的 `{sessionId, label, tabUri, archived}` 与右键菜单的 `{session: {...}}`）归一成 `{id, tabUri, archived}`；`resolveOpenTarget` 只做判定（resource 优先、会话 id 兜底，返回判别联合或 `null`）；`createRowOpener` 负责编排：目标为空 → 返回 `false`；行是归档的 → 先 `deps.unarchive(id)`（失败不阻止后续，错误已由注入方上报）；最后按目标 kind 调 `revealTab` 或 `openSession`。上游：`treeProvider` 的命令参数与右键菜单；下游：`extension.ts` 的打开处理器（`unarchive` 接到归档命令、`revealTab`/`openSession` 接到 opener）。`[Verified]`（`rowOpener.ts` 为新文件）

### 改动点 6：opener 增加按 resource 聚焦的入口

- 目标：`src/session/opener.ts::revealTab`
- 并行路径：`src/session/opener.ts::openSession` → 不随改（无标签 resource 的行按会话 id 打开；失败语义不变）

下游：`vscode.openWith(resource, 'chatgpt.conversationEditor', {preview:false})`；失败只报错（`无法打开 Codex 标签页：<原因>`），不回退新建（与 D30 同一条线）。`[Verified]`

### 改动点 7：接线

- 目标：`src/extension.ts::activate`
- 并行路径：`src/extension.ts::deactivate` → 不随改
- 并行路径：`src/extension.ts::sessionIdOf` → 不随改（置顶/重命名仍用它取 id）
- 并行路径：`src/commands.ts::createNewSessionCommand` → 不随改（`+` 仍按 nonce 开独立面板，只是面板不进侧边栏）

上游：命令注册；下游：`rowOpener`（`createRowOpener` 的三个依赖分别接到 `unarchiveSession` 命令、`opener.revealTab`、`opener.openSession`）。`[Verified]`

### 改动点 8：app-server 层新增归档/取消归档/删除与已归档列表

- 目标：`src/codex/threadApi.ts::deleteThread`
- 目标：`src/codex/threadApi.ts::archiveThread`
- 目标：`src/codex/threadApi.ts::unarchiveThread`
- 目标：`src/codex/threadApi.ts::listThreads`
- 并行路径：`src/codex/threadApi.ts::setThreadName` → 不随改（同为 `thread/*` 的写法范式）
- 并行路径：`src/codex/threadApi.ts::listTurns` → 不随改
- 并行路径：`src/codex/threadApi.ts::listLoadedThreadIds` → 不随改

`listThreads` 的入参增加 `archived?: boolean`（默认 `false`，写入 `thread/list` 的 `archived` 字段），从而复用同一条查询路径拿已归档会话；`archiveThread` / `unarchiveThread` / `deleteThread` 都是「一次 `client.request` + `{threadId}`」的薄封装。参数形状取自 `codex app-server generate-json-schema`（`ThreadArchiveParams` / `ThreadUnarchiveParams` / `ThreadDeleteParams`），不自己发明字段。上游：`ThreadApi` 接口；下游：三个命令实现与 `extension.ts::load`。`[Verified]`（已实测本机 `thread/list {archived:true}` 返回 15 条）

### 改动点 9：归档 / 取消归档 / 删除三个命令

- 目标：`src/commands.ts::createArchiveSessionCommand`
- 目标：`src/commands.ts::createUnarchiveSessionCommand`
- 目标：`src/commands.ts::createDeleteSessionCommand`
- 并行路径：`src/commands.ts::createRenameSessionCommand` → 不随改（作为「失败只报错、取消不发请求」的范式引用）
- 并行路径：`src/commands.ts::createNewSessionCommand` → 不随改
- 并行路径：`src/commands.ts::registerCommands` → 随改（注册三个新命令并接进 `CommandHandlers`）

三个命令同构：注入 `threadApi` 与 `showErrorMessage`，**没有任何确认/输入依赖**（这就是「无确认」的实现保证——命令层根本没有弹框的入口）；`sessionId` 缺失直接返回 `false`；调用成功返回 `true`，失败只 `showErrorMessage` 并返回 `false`（不把异常抛回命令层）。上游：`package.json` 的菜单贡献；下游：`extension.ts`（只看返回值决定是否刷新/关标签）。`[Verified]`

### 改动点 10：关闭被删会话的标签页

- 目标：`src/session/openTabs.ts::selectTabsForConversation`

上游：`vscode.window.tabGroups` 快照（与 `scanCodexTabs` 同一份数据结构，另带原始 tab 句柄）；下游：`vscode.window.tabGroups.close(<命中的标签>)`。判定复用 `parseConversationId`，因此只有 id 完全匹配的标签会被关。`[Verified]`

### 改动点 11：接线（三个命令的处理器与菜单贡献）

- 目标：`src/extension.ts::activate`

`activate` 注册三个处理器：`archiveSession` / `unarchiveSession` 成功后只 `provider.refresh()`；`deleteSession` 成功后 `pinStore.unpin(id)` + 关闭命中标签 + `provider.refresh()`（置顶状态在删除时失去意义；归档时**不**碰置顶，见 D45）。`load()` 改为并行发两次 `thread/list`（`archived: false` 与 `true`），把两批会话一起交给 `buildSessionGroups`。`[Verified]`

同一改动点还包含 `package.json` 的**声明式贡献**（该文件没有方法可供 `文件::方法名` 选择器锚定，故不写选择器行）：

- `contributes.commands` 新增 `codexHelper.archiveSession`（「Codex: 归档会话」，`$(archive)`）、`codexHelper.unarchiveSession`（「Codex: 取消归档」）、`codexHelper.deleteSession`（「Codex: 删除会话」，`$(trash)`）；
- `contributes.menus["view/item/context"]`：`archiveSession` → `inline@1`，`deleteSession` → `inline@2`（`when` 限定 `viewItem == session.archived`），`unarchiveSession` → `1_modification@0`（同样限定已归档条目），`archiveSession` 的 `when` 用 `viewItem =~ /^session/ && viewItem != session.archived`；
- `openSession` 从 `inline@1` 移到 `1_modification@1`（保持可发现，不再占悬停区）。`[Verified]`

### 生产链路影响表

| 影响面 | 上游/调用方 | 下游/消费方 | 链路末端 | 粒度是否一致 |
|--------|-------------|-------------|----------|--------------|
| 树的分组 | `buildSessionGroups` | `treeProvider` 渲染 | 一个会话一行 | ✅ 一致（删除标签粒度的那一组，新增「最近 10 个」的会话粒度分组） |
| 行点击 | `resolveOpenTarget` | `vscode.openWith` → Codex 自定义编辑器 | 一个 resource 一个编辑器 | ✅ 一致：有标签 resource 的行聚焦该标签，否则按会话 id |
| 「已打开」标记 | `scanCodexTabs` | 行的 `open` / 图标 / contextValue | 会话 ↔ 标签按会话 id 对应 | ✅ 一致（未绑定标签不再参与） |
| `+` 新建面板 | `createNewSessionCommand` | `vscode.openWith(/extension/panel/new?newPanel=<nonce>)` | 每次点击一个新 resource | ✅ 不变；面板不进侧边栏（D36 取舍） |
| 归档 / 取消归档 | `codexHelper.archiveSession` / `unarchiveSession` → `thread/archive` / `thread/unarchive` | app-server 线程存储 + 「已归档」分组 | 一次操作 = 一个 threadId | ✅ 一致：标签与置顶都不动 |
| 删除会话 | `codexHelper.deleteSession` → `thread/delete`（只对已归档条目开放） | app-server 线程存储 + 本插件的 `globalState`（置顶）+ `tabGroups` | 一次删除 = 一个 threadId | ✅ 一致：只动该 threadId 对应的记录与标签 |

### 10 类 checklist 逐类排查

| 类别 | 结论 | 证据 |
|------|------|------|
| 查询/数据加载粒度 | 「最近」只对**本页已加载**的会话排序取前 10；改 `codexHelper.pageSize` 会让「最近」的候选池变大，但 10 的上限与排序规则不变。本变更不发新的 app-server 请求 | `src/extension.ts:92-110`、`src/codex/threadApi.ts`（`sortKey: updated_at`） |
| 本地状态/缓存键 | 不涉及（置顶仍以会话 id 为键） | `src/session/pinStore.ts` |
| 状态隔离/并发 | 标签只影响对应会话行的标记；未绑定标签被丢弃 ⇒ 不存在跨行串扰 | `src/session/openTabs.ts`、`src/session/sessionStore.ts` |
| 数据流/副作用 | 副作用仍是「打开一个编辑器」，参数从「反推的会话 resource」改为「该行自己的标签 resource（若有）」 | `src/session/opener.ts`、`src/session/openTarget.ts` |
| 接口契约 | 复用既有契约：viewType `chatgpt.conversationEditor`、`{preview:false}` | `src/codex/conversationUri.ts:10` |
| 数据结构/存储格式 | 类型收紧 + 每行一个字段，不落盘、不跨进程 | `src/codex/types.ts` |
| 依赖/调用方 | `scanCodexTabs` 唯一调用方 `extension.ts:80`；`buildSessionGroups` 唯一调用方 `extension.ts:103`；`createSessionOpener` 唯一调用方 `extension.ts:136` | `grep -rn`（见核对报告） |
| 性能/资源 | 少渲染若干行；「最近」是一次 O(n log n) 排序（n = 当前页大小，默认 50）；扫描无额外 IO | `src/session/sessionStore.ts`、`src/session/openTabs.ts` |
| 错误/边界处理 | `openWith` reject → 报错含原因；`tabUri` 缺失/形状不合法 → 退回会话 id；两者皆无 → 不动作 | 新增用例覆盖 |
| 兼容/迁移 | 侧边栏结构变化（少一组）是本变更的目的；既有坏标签（`/local/open-tab:N`）不由本插件清理 | 生产日志 `Codex.log:376-377` |
| 破坏性操作 | 删除不可逆，但只对已归档条目开放（两步流程即防线）；三个命令都不弹确认框；失败不做任何清理 | 由 T-028~T-032、INV-004 钉住 |
| 用户可见入口 | 归档按钮在未归档条目的悬停区；删除按钮只在已归档条目的悬停区；`openSession` 移出悬停区但保留在右键菜单；`取消归档` 在右键菜单 | 由 T-033 钉住（直接断言 `package.json` 贡献） |
| 归档是否可逆 | 已归档条目可取消归档，且置顶状态跨归档保留（归档期间显示 `📌`，取消归档后回到「置顶」组） | 由 T-036、T-037 钉住 |

### 并行路径排查

- 同文件兄弟方法：`sessionStore.ts` 的 `sessionItemLabel`/`matchesFilter`、`treeProvider.ts` 的 `getChildren`/`cwdBasename`/`defaultCollapsibleState`、`opener.ts` 的 `openSession`、`extension.ts` 的 `deactivate`/`sessionIdOf` 均已在改动点小节显式声明。
- 命名不同但逻辑对等：`src/extension.ts:22-27` 的 `sessionIdOf`（只认 id，供置顶/重命名）与新增 `resolveOpenTarget`（资源优先）是同一入口的两半；打开链路全部改走后者，`sessionIdOf` 保留不随改。
- 上游对等入口：Codex 的 `chatgpt.newCodexPanel`（固定 resource，无法多开）不采用；`navigate-in-new-editor-tab` 是上游 webview→host 的内部消息，本插件无法调用。`[Verified]`

## 改动文件

- `src/codex/types.ts` [Verified]
- `src/session/openTabs.ts` [Verified]
- `src/session/openTarget.ts` [Verified]（新增）
- `src/session/rowOpener.ts` [Verified]（新增）
- `src/session/sessionStore.ts` [Verified]
- `src/ui/treeProvider.ts` [Verified]
- `src/session/opener.ts` [Verified]
- `src/extension.ts` [Verified]
- `src/commands.ts` [Verified]
- `src/codex/threadApi.ts` [Verified]
- `package.json` [Verified]
- `test/helpers/fakes.ts` [Verified]
- `test/unit/openTabs.test.ts` [Verified]
- `test/unit/openTarget.test.ts` [Verified]（新增）
- `test/unit/rowOpener.test.ts` [Verified]（新增）
- `test/unit/sessionStore.test.ts` [Verified]
- `test/unit/treeProvider.test.ts` [Verified]
- `test/unit/opener.test.ts` [Verified]
- `test/unit/threadApi.test.ts` [Verified]
- `test/unit/commands.test.ts` [Verified]
- `test/unit/packageContributes.test.ts` [Verified]（新增）
- `test/unit/extension.test.ts` [Verified]（新增）
- `README.md` [Verified]

## 边界条件与风险

| 边界 | 预期行为 | 状态 |
|------|----------|------|
| 未绑定面板标签（`id` 为 `null`） | 扫描阶段丢弃 ⇒ 任何分组都不渲染 | 由 T-001、T-010、INV-002 钉住 |
| 未置顶会话总数 > 10 | 最近的 10 个进「最近」，其余进「历史」，两组互斥 | 由 T-020、T-023、INV-003 钉住 |
| 未置顶会话总数 ≤ 10 | 全部进「最近」，「历史」组不渲染 | 由 T-021 钉住 |
| 置顶会话同时是最近的会话 | 只进「置顶」组 | 由 T-022 钉住 |
| 已打开会话（有标签 resource） | 出现在「最近」或「历史」组，带窗口图标；点击聚焦该标签 | 由 T-003、T-009、T-015 钉住 |
| 已打开但不在 `thread/list` 的会话 | 不渲染（无标题/cwd 来源） | 由 T-013 钉住 |
| 取消置顶的已打开会话 | 从「置顶」移到「历史」（仍带窗口图标） | 由 T-012 钉住 |
| 开着且在跑的会话 | 显示转圈图标（图标优先级：运行中 > 已打开） | 由 T-016 钉住 |
| 远端标签（`/remote/<id>`） | 打开它自己的 remote resource | 由 T-004 钉住 |
| 无标签 resource 的行 | 按会话 id 打开（`/local/<id>`） | 由 T-005 钉住 |
| `tabUri` 形状不合法 / 两者皆无 | 退回会话 id；都没有则不动作 | 由 T-005 钉住 |
| 聚焦失败（viewType 未注册等） | 报错、不新建、不静默 | 由 T-007 钉住 |
| 点开「已归档」组的条目 | 先 `thread/unarchive`，再打开；刷新后该会话离开「已归档」组 | 由 T-040、T-042、INV-005 钉住 |
| `thread/unarchive` 失败但用户点了打开 | 报错，且**仍然打开**该会话；列表保持它在「已归档」组 | 由 T-041、INV-005 钉住 |
| 点开未归档条目 | 不得发出任何 `thread/unarchive` | 由 T-041、INV-005 钉住 |
| 点归档按钮（未归档条目） | 不弹确认，直接 `thread/archive {threadId}`；成功后刷新；标签不动 | 由 T-025、T-028、T-034、INV-004 钉住 |
| 点删除按钮（已归档条目） | 不弹确认，直接 `thread/delete {threadId}`；成功后刷新 | 由 T-024、T-029、INV-004 钉住 |
| 取消归档 | `thread/unarchive {threadId}`；成功后刷新；标签不动 | 由 T-026、T-030、T-034、INV-004 钉住 |
| 三个命令失败 | 报错；不刷新、不关标签、不改本地状态 | 由 T-031、T-032 钉住 |
| 未归档条目的悬停区 | 只有「归档」；没有「删除」 | 由 T-033 钉住 |
| 被删会话的标签定位 | 只有 `conversationId` 等于被删 id 的标签被选中 | 由 T-039 钉住 |
| 已归档会话的归属 | 只在「已归档」组；置顶的已归档会话也只在「已归档」组（带 📌） | 由 T-036、T-037、INV-003 钉住 |
| 重启后被恢复的标签 | resource 与关闭前一致 ⇒ 点击即聚焦 | 依赖上游 `ensureRestoredConversationTabsResolved`（见调研表）`[Inferred]` |
| 本变更前已开出的 `/local/open-tab:N` 坏标签 | 不由本插件清理（上游认为它无效）；README 说明 | `[Verified]` |
