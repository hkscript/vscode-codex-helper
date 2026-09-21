# 重做侧边栏：置顶 / 最近 / 历史三组 + 会话删除入口

## Why

起因是一个已用生产日志坐实的 bug：侧边栏「已打开」组里那行 `Codex` 是**未绑定会话的新面板标签**，它解析不出会话 id，于是树里给它一个**合成 id** `open-tab:<index>`（`src/session/sessionStore.ts:86-94`），而点击这一行会把这个合成 id 当会话 id 用（`src/ui/treeProvider.ts:161-168` → `src/extension.ts:161-164` → `src/session/opener.ts:26-33`），真的去打开 `openai-codex://route/local/open-tab:0` —— 一个不存在的会话。Codex 输出通道日志里能直接看到：`conversationId=open-tab:0` 后紧跟 `Request failed … invalid thread id … found \`o\` at 1`（method=thread/read、thread/resume）；第二次复现时 id 连着 `open-tab:1`…`open-tab:5`，两分钟 211 行。

但更根本的问题是**这一组本身的粒度错了**：它在列「标签」，另外两组在列「会话」。用户补充的现象正是它的必然结果——新建的会话在「已打开」里叫 `Codex`，对话之后真正的会话出现在「历史」、运行图标也在「历史」那一行，「已打开」里那行始终不变。

用户因此给出取舍：**去掉「已打开」分组，未绑定会话的面板行不再显示**。侧边栏回到「一组会话一份」的语义：置顶 + 历史。

随后用户补充：**新增一个「最近」分组，默认展开，显示最近 10 个会话**——用会话粒度的「最近在忙什么」替代被删掉的「已打开」组。

第三条补充：**鼠标悬停到会话条目上显示按钮**——未归档条目上悬停显示「归档」，已归档条目上悬停显示「删除」；**要真正删除必须先归档，再在已归档条目上删除**（删除不弹确认框）。同时移除冗余的「打开会话」悬停按钮（点击条目本身就能打开）。

## What Changes

- **删除「已打开」分组，改为「置顶 / 最近 / 历史」三组**：`SessionGroupId` 变为 `'pinned' | 'recent' | 'history'`，归属唯一确定且互斥 —— 置顶优先；其余会话中 `updatedAt` 最大的 10 个进「最近」；剩下的进「历史」。一个会话在树里永远只有一行。**BREAKING**（对侧边栏可见结构而言）
- **「最近」与「置顶」默认展开，「历史」默认折叠**（沿用既有 `defaultCollapsibleState`：只有 `history` 折叠）。
- **新增「已归档」分组**（默认折叠、排最后），成员来自 `thread/list {archived: true}`；它是删除的唯一入口，也是撤销归档的地方。
- **两步删除**：未归档条目悬停显示**归档**（`codexHelper.archiveSession` → `thread/archive {threadId}`，图标 `$(archive)`）；「已归档」条目悬停显示**删除**（`codexHelper.deleteSession` → `thread/delete {threadId}`，图标 `$(trash)`）。两个动作都**不弹确认框**（用户明确要求；防误删靠「必须先归档」这道流程闸）。已归档条目另有右键菜单「取消归档」（`thread/unarchive`）。
- **移除「打开会话」悬停按钮**：`codexHelper.openSession` 的 inline 贡献删除、移入右键菜单 `1_modification`；点击条目本身仍然是打开。
- **分组优先级**：已归档 > 置顶 > 最近 > 历史；置顶状态跨归档保留（归档期间行上仍显示 `📌`，取消归档后回到「置顶」组）。
- **命令成功后的动作**：归档/取消归档只刷新列表（**不动标签页**）；删除成功才关闭显示该会话的标签页（跨进程删除不会通知 Codex 侧的 webview，留着标签会让它 continue read/resume 一个已删除的会话），并刷新。失败只报错，不做任何清理。
- **未绑定会话的标签在扫描阶段就被丢弃**：`OpenTab.id` 由 `string | null` 收紧为 `string`，合成 id `open-tab:<index>` 从系统里彻底消失。这是**按构造消除**本 bug 的机制，而不是再加一条「别把合成 id 当会话用」的约定。
- **保留「已打开」状态，但只作为行的标记**：扫描到的标签用于 (a) 给对应会话行打 `open` 标记（窗口图标）、(b) 把该标签自己的 resource 交给打开命令。点击时优先打开该 resource ⇒ **聚焦**已经打开的标签（含远端 `/remote/<id>`、带 query 的标签），而不是再开一个；没有标签 resource 的行仍按会话 id 打开。
- 面板里的会话在侧边栏表现为「历史」里的一行（可能带窗口图标与运行图标）；`+` 开出的空白面板在侧边栏**完全不可见**——这是用户显式选择的取舍。
- 失败语义不变：报错、不回退委派、不静默新建。
- README 记录两条限制：空白面板不进侧边栏；上游不暴露「面板 → 会话」映射（其自身的 chat session provider 对 `conversationId == null` 的标签同样直接跳过）。
- 测试：改写 `sessionStore` / `treeProvider` 的分组用例（三组 → 两组），新增「未绑定面板不产生任何行」「已打开会话落在历史组并携带标签 resource」「取消置顶后回到历史组」等用例。

## Impact

- Affected specs: `codex-session-sidebar` 的五处 requirement ——「已打开标签页识别」「会话打开与聚焦」「会话置顶」「树视图组织、状态标识与过滤」「新建会话（每次点击独立面板）」
- Affected code:
  - `src/codex/types.ts`（`OpenTab` / `SessionItem` / `SessionGroupId`）
  - `src/codex/threadApi.ts`（`deleteThread`）
  - `src/session/openTabs.ts`（丢弃未绑定面板、保留 resource）
  - `src/session/openTarget.ts`（新增：打开目标判定）
  - `src/session/sessionStore.ts`（两组 + open 标记 + 标签 resource）
  - `src/ui/treeProvider.ts`（命令参数带标签 resource）
  - `src/session/opener.ts`（新增按 resource 聚焦入口）
  - `src/commands.ts`（`createDeleteSessionCommand`）
  - `src/extension.ts`（接线：删除、取消置顶、关闭标签、刷新）
  - `package.json`（命令与菜单贡献）
  - `test/**`、`README.md`

## Verified Facts

证据三类：本仓库源码、生产日志（本机 VS Code Server 输出通道日志）、上游 Codex 插件产物（`~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64`，压缩 bundle 只能给字符偏移）。

| 事实 | 证据 | 确定性 |
|------|------|--------|
| 未绑定面板标签在树里被赋合成 id `open-tab:<index>` | `src/session/sessionStore.ts:86-94` | `[Verified]` |
| 条目点击把 `session.id` 交给 `codexHelper.openSession` | `src/ui/treeProvider.ts:161-168` | `[Verified]` |
| `openSession(id)` 用 `buildConversationUri(id)` 拼 `/local/<id>` | `src/session/opener.ts:26-33`、`src/codex/conversationUri.ts:26-32` | `[Verified]` |
| 扫描丢掉了标签页自己的 uri（只留 `{id, tabLabel}`） | `src/session/openTabs.ts:32-43`、`src/codex/types.ts:64-69` | `[Verified]` |
| **生产日志**：Codex 收到 `conversationId=open-tab:0` 并被 app-server 拒绝 `invalid thread id … found \`o\` at 1` | `~/.vscode-server/data/logs/20260921T222443/exthost1/openai.chatgpt/Codex.log:148,154,160,161` | `[Verified]` |
| **生产日志**：第二次复现，`open-tab:1`…`open-tab:5`，两分钟 211 行相关日志 | `~/.vscode-server/data/logs/20260921T230534/exthost1/openai.chatgpt/Codex.log:53,62,376,377` | `[Verified]` |
| 上游 new-panel 路由 `/extension/panel/new` 与会话路由 `/local/<id>` 是不同 resource | bundle `out/extension.js` 偏移 1688047（`pI`/`iPe`）、1840628（`createNewPanel`） | `[Verified]` |
| 上游 webview 在面板内新建会话是 React Router 内部导航（`p(\`/local/${t}\`)`），**不改标签 resource** | webview `assets/app-initial-*.js`；bundle 偏移 1831965（`case"navigate-in-new-editor-tab"`，只有 `replaceCurrentEditor` 才换 resource 并 dispose 旧面板） | `[Verified]` |
| 上游自己也拿不到「面板 → 会话」映射：`trackTabIfNeeded` 对 `conversationId == null` 直接 return | bundle 偏移 1688781-1692106 | `[Verified]` |
| `supportsMultipleEditorsPerDocument: false` ⇒ 同一 resource 再打开是聚焦/移动已有编辑器 | `node_modules/@types/vscode/index.d.ts:11399-11410`、`src/session/opener.ts:4-11` | `[Verified]` |
| 上游激活时会按**各自 uri** 重开所有 `openai-codex` 标签 ⇒ 重启后标签 resource 与关闭前一致 | bundle 偏移 1840850 附近 | `[Verified]` |
| 分组、图标、contextValue 的现状实现 | `src/session/sessionStore.ts:117-130`（三组固定顺序）、`src/ui/treeProvider.ts:84-88,90-112,169-175` | `[Verified]` |
| 上游支持归档与硬删除：`thread/archive` / `thread/unarchive` / `thread/delete` 三个方法，参数都只有 `{threadId}` | `codex app-server generate-json-schema` 产物 `v2/ThreadArchiveParams.json`、`ThreadUnarchiveParams.json`、`ThreadDeleteParams.json`、`ClientRequest.json` 的方法枚举（24 个 `thread/*` 方法） | `[Verified]` |
| 已归档会话可查询：`thread/list` 的 `archived` 是布尔过滤器（"when set to true, only archived threads are returned"） | `codex app-server generate-json-schema` 产物 `v2/ThreadListParams.json`（`archived` 字段描述） | `[Verified]` |
| **实测**本机：`thread/list {archived:false}` 返回 50 条、`{archived:true}` 返回 **15** 条已归档会话（只读查询，未改任何数据） | `node` 脚本直连 `codex app-server`（`initialize` 后两次 `thread/list`） | `[Verified]` |
| CLI 侧同样是三件事：`codex archive <session>` / `codex unarchive <session>` / `codex delete <session>`（后者说明为 "Permanently delete a saved session"） | `codex archive --help`、`codex unarchive --help`、`codex delete --help` | `[Verified]` |
| 可用的 codicon 名只有 `archive` / `trash`（**没有** `unarchive`），故「取消归档」放在右键菜单不带图标、删除用 `$(trash)` | 本机 `codicon.css` 的类名清单 | `[Verified]` |
| 上游自己也在用 `thread/delete`（清理预热线程） | `~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64/out/extension.js` 偏移 1704830 | `[Verified]` |
| 上游对 `thread/deleted` 通知的处理：清理内部跟踪；webview 收到后重置该会话的本地会话状态。**没有**关闭对应的编辑器标签 | 同上 bundle 偏移 1714443（host 的 `thread/deleted` 分支）、webview `assets/app-initial-*.js` 的 `thread/archived`/`thread/deleted` 分支 | `[Verified]` |
| 本插件与 Codex 插件各自跑一个 `codex app-server` 子进程（跨进程状态） | `src/extension.ts:43-66` | `[Verified]` |
| 现有菜单贡献：`openSession` 只在 `inline@1` 组；`renameSession`/`pinSession`/`unpinSession` 在 `1_modification` 组 | `package.json` 的 `contributes.menus["view/item/context"]` | `[Verified]` |

## Open Risks

按铁律 3 先反对自己：

- **「10 个」是对已加载页取的，不是全库**：`thread/list` 默认一次 50 条（`codexHelper.pageSize`），「最近」在这 50 条里排序取前 10。若用户把 `pageSize` 改小（例如 5），「最近」就只有 5 个——这是 D40 选择的代价（可预测优先于动态）。`[Verified]`（`src/extension.ts:92-110`、`src/codex/threadApi.ts`）
- **分组顺序（置顶 → 最近 → 历史）是本变更自行定的**：用户只说了「增加一个最近分组、默认展开、显示最近 10 个」。若更希望「最近」排在最前，改动只是 `buildSessionGroups` 的返回顺序与 `GROUP_LABELS`。`[Assumption]`
- **没有确认框的代价**：归档可逆，误点无害；但删除不可逆，误点就没了。防线是「删除入口只出现在已归档分组」——要误删必须先误归档、再展开已归档组、再点到删除。用户明确要求如此。`[Verified]`
- **「已归档」组只取一页**：与该组一起加载的是 `thread/list {archived:true}` 的一页（`codexHelper.pageSize`，默认 50），不扩展「加载更多」。本机现有 15 条，够用；将来归档很多时该组显示不全（列为已知限制）。`[Verified]`
- **删除会关闭该会话的标签页**：Codex 自己的 host 在 `thread/deleted` 时只清理内部跟踪、不关标签；但本插件与 Codex 各跑一个 app-server 子进程，删除通知不会跨进程送达 Codex 那侧的 webview——留着标签会让它继续 read/resume 一个已删除的会话（与本次修掉的 `open-tab:0` 报错风暴同类）。归档/取消归档则**不动标签**。`[Inferred]`
- **分组顺序仍是「置顶 → 最近 → 历史 → 已归档」**（已归档排最后并默认折叠）。若想把它排到最前，改动只是 `buildSessionGroups` 的返回顺序。`[Assumption]`
- **代价：空白面板在侧边栏彻底不可见**。用户点了 `+` 之后侧边栏没有任何变化，只能靠编辑器标签栏找回。这是用户显式要求的取舍；本变更不提供替代入口（不新增「打开的面板」组、不做通知）。若将来又需要入口，应作为新变更重新讨论粒度。`[Verified]`
- **不能再靠「已打开」组区分「正开着哪个会话」**：已打开会话现在混在「历史」里，只靠窗口图标区分；且**运行中**会话因图标优先级更高显示转圈图标，所以「开着且在跑」的会话看不到窗口图标。这是既有图标优先级的延续，spec 里显式写明（避免验收时被当成 bug）。`[Verified]`
- **已打开但服务端列表里没有的会话不再有行**：旧实现靠「已打开」组兜底显示（标题取标签标题）。取消该组后这类会话消失（无标题/cwd 来源）。判定为可接受：它是「幽灵行」的另一面，与 D8「陈旧置顶丢弃」同一条原则。`[Inferred]`
- **本变更前点出来的 `/local/open-tab:N` 坏标签**不由本插件清理（上游认为它是无效会话），用户手动关闭即可。`[Verified]`
- 方案依赖「标签 resource 重启后不变」（否则聚焦会落空）。缓解：上游 `ensureRestoredConversationTabsResolved` 就是按各自 uri 重开；即便 resource 变了，打开的也只是另一个标签，不会伪造会话。`[Inferred]`
