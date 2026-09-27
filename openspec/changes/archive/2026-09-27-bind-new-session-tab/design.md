# 设计：新建会话直接绑定标签 + 未标题标签同步

## 1. 为什么是"建会话 + 重新 resolve"，而不是"改标题"

三层约束叠加，只有一条路可走：

1. **标题写死在 resolve 那一刻。** 上游只有两处 `title` 赋值，都在 `resolveCustomEditor`：同步取 `summary.preview`，异步（仅当 URI 带会话 id）取 `thread/list` 的 `name?.trim() || preview` 再截断 30 字符。
2. **VS Code 不允许外部改标签标题**（`TabGroups` 只有 `close`；`Tab.label` 只读）。
3. **空白面板的 URI 没有会话 id**，两条路径都进不去 ⇒ 永远停在 `Codex`。

所以：让标题正确 = 让 Codex 有机会**重新 resolve 一个带会话 id 的标签**。

## 2. `+` 的新流程

```
点击 +
  ├─ 探测 gitInfo（工作区第一个 folder 的 HEAD/remote）
  │     └─ 探测不到 → 用全零 sha 占位（Codex 前端只读 branch/originUrl，占位不可见）
  ├─ 起一个一次性 codex app-server 子进程
  │     initialize → thread/start {cwd} → thread/metadata/update {gitInfo} → thread/resume
  │     （resume 让 Codex 自己把 rollout 头落盘，≈18KB）
  ├─ dispose 子进程并等它真的退出（writer 锁随进程消失，超时 2s 兜底）
  └─ openWith(buildConversationUri(id), chatgpt.conversationEditor, {preview:false})
```

为什么落盘必须在**一次性进程**里做：`thread/resume` 会持有该会话的 writer 锁，只要那个进程活着，Codex 面板（另一个 app-server 进程）的 resume 就会被拒 `already has an active writer`；`thread/unsubscribe` 实测放不掉。用一次性进程，锁随进程退出而释放。

为什么必须写 `gitInfo` 才能落盘：`thread/start` 后直接 resume 报 `no rollout found`；一次成功的 `metadata/update` 之后 resume 才会成功。`name/set` 会把会话名固定住、顶掉 Codex 的自动标题，所以不能用；`settings/update`、`increment_elicitation`、`resume{history/path}` 要么要求 `experimentalApi`、要么根本不是有效触发器（都实测过）。于是只剩 `metadata/update`，而它要求至少一个字段：能探测到真实 git 信息就写真实的，探测不到就写**全零 sha 占位**（`0…0`，git 里表示「没有对象」；Codex 前端只读 `branch`/`originUrl`，sha 不上界面）。

空会话不会进 `thread/list`，所以"点了 + 没聊就关掉"不会在侧边栏留下垃圾行。

## 3. 标题修正：只在点击那一行时重载

判定散在两处：`createRowOpener` 负责「这一行有没有标签 resource」，`reloadUntitledTab` 负责「那个标签该不该重载」。条件只有三条：

| 条件 | 取值 | 落在哪 |
|------|------|--------|
| 这一行解析出的打开目标是标签 | `resolveOpenTarget(row).kind === 'tab'` | `rowOpener.ts::createRowOpener` |
| 那个标签的标题仍是 Codex 默认值 | `tabLabel === CODEX_DEFAULT_TAB_TITLE`（只动"还没被 Codex 起过名"的标签，不碰改名导致的漂移） | `extension.ts::reloadUntitledTab` |
| 标签带句柄 | `handle !== undefined`（关标签只能靠它自己的句柄） | `extension.ts::reloadUntitledTab` |

命中后：`tabGroups.close(handle, true)` → `vscode.openWith(标签自己的 uri, chatgpt.conversationEditor, {viewColumn, preview:false})` → `moveActiveEditor {to:'position', by:'tab', value: 原下标 + 1}` 放回原位。返回 `true` 表示「已经重载好了（重开后它就是激活标签，不用再聚焦）」；返回 `false` 表示没什么可重载或重载没做成，`createRowOpener` 继续走 `revealTab` / `openSession`——**重载失败绝不吞掉这次点击**。

**后台自动同步为什么退役（0.0.14~0.0.16 三轮实测反馈）**：这条路走下来撞了三堵墙——`preserveFocus` 拦不住新建编辑器被激活（抢焦点）、重开丢位置（跑到组内末尾）、用户最终反馈「会闪一下」。逐条补丁（还焦点、`viewColumn` + `moveActiveEditor`）都能修好症状，但结论是：**重载本身就该由用户触发**。让 Codex 重写标题必须让它重新 `resolveCustomEditor`，而原地重解析被 VS Code 挡死——Codex 的 `supportsMultipleEditorsPerDocument: false` 对应内部 `singlePerResource`，`resolveEditor` 找不到「另一个已开着的编辑器」时才会新建（1.96 产物反编译：`if (singlePerResource) { findExistingEditorsForResource(...) ; if (u.length) return {editor: p} }`）。所以「关掉重开」是必要条件，而它的观感代价（内容白一下、草稿丢）只应由点击承担。于是：后台三条触发（`load()` / `onDidChangeTabs` / 轮询）、`planTabTitleSync`、焦点快照与归还、`syncedTitles` 全部删除；重载挪到 `rowOpener`，只在**点击侧边栏上那一行**且该标签标题仍是 `Codex` 时发生。

**位置还要还原（0.0.15 实测反馈，现已并入点击路径）**：重开出来的标签落在组内末尾（用户原话："打开后 codex 标签在最后边了"），而且不给 `viewColumn` 时会开在**当前激活那一栏**里——标签等于搬了家。两处都要补：① `openWith` 带上 `viewColumn = 标签原来的栏`；② 重开之后把它挪回原来的下标。公开 API 没有移动/排序标签的能力，只能用 VS Code 内部命令 `moveActiveEditor`（内置的「Move Editor Left/Right」「Move Editor to Start/End」执行的就是它，id 常量 `Uq="moveActiveEditor"`）；语义取自本机 1.96 产物 `resources/app/out/vs/workbench/workbench.desktop.main.js` 的反编译：`{to:"position", by:"tab", value}` 里 `value` 是 **1 基**下标（`case "position": c=(value??1)-1`），越界夹到 `[0, count-1]`。它作用于**当前激活编辑器**，所以调用前必须先核对激活标签就是刚重开那个；核对不通过就放弃还原位置。命令不存在或被拒时静默跳过：最坏情况是标签留在末尾，标题修正不受影响。

**新建会话的行要等第一条消息（第七次实测反馈）**：空会话不在 `thread/list` 里（它要等面板发出第一条消息才落列表），而那一刻没有任何事件会通知插件——那个 webview 不是我们的；运行状态追踪的候选集也只从 `thread/list` 来（`selectCandidates` 遍历 `update()` 喂进来的列表），所以同样指望不上。表现为「点了 `+` 之后侧边栏没有新行，直到手动点刷新」。修法：建出会话后盯住列表（`newSessionWatch`：3 秒一次、10 分钟上限，标签被关掉就提前放弃，不比对搜索结果），会话一出现就刷新侧边栏。

等待规则本身是纯逻辑，落在 `newSessionWatch.ts::createNewSessionWatch`：`watch(id)` 记下开始时刻并起一个定时器（生产传真的 `setInterval`，单测传可手动触发的假钟）；每拍先剔掉「标签已经关了」和「等满 10 分钟」的 id，无事可等就停表；然后**不带 `searchTerm`** 拉一次 `thread/list`，只要在等的 id 里有任意一个出现就 `refresh()` 一次。拉列表失败不算「等到了」（直接返回，下一拍接着试），有多个会话同时在等时按各自的进度删项，全部删完才停表。计时、IO、刷新都由调用方注入（`extension.ts` 的接线里接 `api().listThreads` / `provider.refresh` / `Date.now`），所以规则本身能在单测里穷举。

## 4. 边界与取舍

- **回退**：只有建会话任一步失败（子进程起不来、`thread/start`/`metadata/update`/`resume` 报错）才走空白面板（今天的行为）；「目录没有 git」不再触发回退。
- **代价**：`+` 多一次子进程（intialize + 3 个请求 + 退出）；第一次同步时标签会重载一次（草稿/滚动位置丢失，会话内容不丢）。
- **不做**：清理"建了但没用"的空会话文件（`thread/list` 不显示，仅占磁盘）；不修会话改名后旧标签的标题漂移。
- **上游依赖**：`start → metadata/update → resume` 这条"让 Codex 自己落盘"的顺序是实测行为，不是文档承诺；任何一步变了就退化成空白面板（可接受），因此不引入新的失败模式。

## 现状与影响面

改动点逐个声明「文件路径::方法名」，`check-design-consistency` 按这份声明做归属对账。

### 改动点 1：`+` 建会话水线（一次性 app-server）

- 目标：`src/session/sessionCreator.ts::createBoundSession`
- 并行路径：`src/session/sessionCreator.ts::waitForChildExit` → 随改（子进程退出是这条水线的最后一步，改成先挂监听再 kill）

### 改动点 2：命令层「建会话优先、空白面板兜底」

- 目标：`src/commands.ts::createNewSessionCommand`
- 并行路径：`src/commands.ts::createRenameSessionCommand` → 不随改（属 rework-session-sidebar 变更：它自己的 design.md 已声明该方法是「失败只报错、取消不发请求」的范式引用）
- 并行路径：`src/commands.ts::registerCommands` → 不随改（同上，属 rework-session-sidebar 变更）

### 改动点 3：一次性子进程与 gitInfo 探测的接线

- 目标：`src/extension.ts::createBoundSessionInOneShot`
- 并行路径：`src/extension.ts::gitInfoForWorkspace` → 随改（探测不到真实 gitInfo 时退到全零 sha 占位）
- 并行路径：`src/extension.ts::client` → 不随改（本变更不碰它：那里的 spawn 包装来自前序提交 f246373「drop the Codex fetch retries when a tab opens」）

### 改动点 4：扫描带出标签句柄、栏号与组内下标

- 目标：`src/session/openTabs.ts::scanCodexTabs`

同一次改动还包含一处**非方法**改动：`src/codex/types.ts` 的 `OpenTab` 接口新增 `handle` / `viewColumn` / `index` 三个可选字段（`src/codex/types.ts:85` / `:90` / `:94`）。接口不是方法，写不进 `- 目标：` 声明行（声明语法只认 `文件::方法名`），故在此以正文登记；`src/codex/types.ts` 仍在 `## 改动文件` 里。

### 改动点 5：点击那一行时重载标题过时的标签

- 目标：`src/extension.ts::reloadUntitledTab`
- 并行路径：`src/extension.ts::putTabBack` → 随改（重开后用 `moveActiveEditor` 放回原下标）
- 并行路径：`src/session/rowOpener.ts::createRowOpener` → 随改（有 `reloadUntitledTab` 时先重载，返回 `false` 再退到 `revealTab`）

### 改动点 6：新会话进列表前的等待轮询

- 目标：`src/session/newSessionWatch.ts::createNewSessionWatch`
- 并行路径：`src/extension.ts::deactivate` → 随改（回收等待轮询，与 `autoRefresh` / `runningTracker` 走同一条收尾路径）

### 改动点 7：标题同步工具收缩为常量 + resource 身份

- 目标：`src/session/tabTitleSync.ts::resourceKey`
- 并行路径：`src/session/tabTitleSync.ts::expectedTabTitle` → 不随改（已删除：后台自动同步整条机制退役，目标标题计算不再需要）

## 改动文件

生产代码：

- `src/session/sessionCreator.ts`（新增：一次性 app-server 的建会话水线）
- `src/session/tabTitleSync.ts`（收缩：只留 `CODEX_DEFAULT_TAB_TITLE` 与 `resourceKey`）
- `src/session/openTabs.ts`（扫描带出 `handle` / `viewColumn` / `index`）
- `src/session/rowOpener.ts`（点击路径先问一次 `reloadUntitledTab`）
- `src/session/newSessionWatch.ts`（新增：等新会话进列表的轮询规则）
- `src/codex/types.ts`（`OpenTab` 增加三个字段）
- `src/commands.ts`（`createNewSessionCommand` 改为建会话优先）
- `src/extension.ts`（接线：一次性子进程、gitInfo 探测、点击重载、等待轮询）

测试与文档：

- `test/unit/sessionCreator.test.ts`、`test/unit/tabTitleSync.test.ts`、`test/unit/openTabs.test.ts`、`test/unit/rowOpener.test.ts`、`test/unit/newSessionWatch.test.ts`、`test/unit/commands.test.ts`、`test/unit/extension.test.ts`、`test/helpers/fakes.ts`
- `README.md`、`package.json`（工作原理与已知限制、版本号）
