# Codex Helper

在 VS Code 侧边栏里浏览、打开、重命名和置顶 Codex 会话，并一眼看出哪个会话正在运行。

Codex 官方扩展（`openai.chatgpt`）把历史会话藏在面板内部，切换要点好几层。这个扩展把会话列表提到活动栏：一棵树，四个分组，点一下就回到对话。

## 功能

- **会话树**：活动栏新增「Codex 会话」视图，按 `置顶` / `最近` / `历史` / `已归档` 四组展示，每组标题右侧显示条数。一个会话只出现一行：已归档优先，其次置顶，其余里最近更新的 10 个进「最近」，剩下的进「历史」。
- **打开会话**：单击树节点即可打开或聚焦对应的 Codex 会话标签页（复用 Codex 自己的会话编辑器，不是只读预览）。已经开着标签的条目会**聚焦那个标签**而不是再开一个；「已归档」里的条目打开时会先取消归档。
- **新建会话**：视图标题栏的 `+`，每次点击开出一个独立的空白面板（未绑定会话前不出现在侧边栏）。
- **归档与删除（两步）**：未归档条目悬停出现「归档」按钮；归档后可展开「已归档」分组，在那里悬停出现「删除」按钮。三个动作都不弹确认框——防误删靠流程（删除入口只对已归档会话开放），归档本身可逆（右键「取消归档」）。
- **重命名**：改名通过 `thread/name/set` 写回 Codex，TUI 和官方扩展里同样生效，不是本地别名。
- **置顶**：常用会话固定在顶部，状态保存在扩展的 `globalState` 里，跨窗口生效；置顶条目的描述带 `📌` 前缀。
- **运行中标识**：正在执行回合的会话显示旋转图标（`loading~spin`），一眼看出哪个对话还在跑。
- **目录名描述**：条目描述显示该会话工作目录的末级目录名（如 `vscode-codex-helper`），比首条消息更能区分同类会话；没有目录信息时不显示描述。
- **过滤**：按会话名、会话 id 或预览文本筛选，三个分组用同一套匹配规则。
- **分页加载**：默认拉取最近 50 条，通过 `Codex: 加载更多` 继续往下翻。
- **自动跟随标签页**：打开/关闭 Codex 标签页时树自动刷新；也可配置定时刷新。
- **错误可见**：加载失败时树里显示一个带重试的错误节点，而不是装成「没有会话」。

## 依赖

需要先安装并登录 Codex 官方扩展 [`openai.chatgpt`](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)（已声明为 `extensionDependencies`，安装本扩展时会自动带上）。

要求 VS Code `^1.96.2`。

## 使用

1. 点击活动栏的 Codex 图标，打开「Codex 会话」视图。
2. 单击任意会话打开它；把鼠标移到条目上会出现「归档」（已归档条目上是「删除」），右键菜单里有打开、重命名、置顶 / 取消置顶、取消归档。
3. 视图标题栏依次是：新建会话、刷新、过滤、清除过滤。

会话列表来自 `codex app-server`：扩展在首次需要数据时才拉起这个子进程，并在扩展停用时关掉它。

## 命令

所有命令都可以在命令面板（`Ctrl/Cmd+Shift+P`）里直接调用。

| 命令 | 标题 | 入口 |
| --- | --- | --- |
| `codexHelper.newSession` | Codex: 新建会话 | 视图标题栏 `+` |
| `codexHelper.refresh` | Codex: 刷新会话列表 | 视图标题栏 |
| `codexHelper.setFilter` | Codex: 过滤会话 | 视图标题栏 |
| `codexHelper.clearFilter` | Codex: 清除过滤 | 视图标题栏 |
| `codexHelper.openSession` | Codex: 打开会话 | 单击节点 / 右键菜单 |
| `codexHelper.renameSession` | Codex: 重命名会话 | 右键菜单 |
| `codexHelper.pinSession` | Codex: 置顶会话 | 右键菜单 |
| `codexHelper.unpinSession` | Codex: 取消置顶 | 右键菜单（已置顶项） |
| `codexHelper.archiveSession` | Codex: 归档会话 | 悬停按钮（未归档条目） |
| `codexHelper.unarchiveSession` | Codex: 取消归档 | 右键菜单（已归档条目） |
| `codexHelper.deleteSession` | Codex: 删除会话 | 悬停按钮（已归档条目） |
| `codexHelper.loadMore` | Codex: 加载更多 | 命令面板 |

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `codexHelper.codexExecutable` | string | `""` | `codex` 可执行文件路径。留空则回退到 Codex 扩展的 `chatgpt.cliExecutable`，再回退到 Codex 扩展自带二进制。 |
| `codexHelper.pageSize` | number | `50` | 每次从 `codex app-server` 拉取的会话条数。 |
| `codexHelper.filterByWorkspaceCwd` | boolean | `false` | 开启后只列出当前工作区目录下的会话。 |
| `codexHelper.autoRefreshSeconds` | number | `0` | 自动刷新间隔（秒），`0` 表示关闭。 |
| `codexHelper.showRunningIndicator` | boolean | `true` | 在正在执行回合的会话上显示运行图标。关闭后不再做运行判定，也不监听 rollout 文件。 |
| `codexHelper.runningStaleSeconds` | number | `300` | 运行状态的过期阈值（秒）。仅用于无法探测进程归属的平台（macOS / Windows）：超过该时长没有写入的会话不再显示为运行中。Linux 上由进程归属判定，不使用该阈值。 |
| `codexHelper.runningPollSeconds` | number | `5` | 文件监听不可用时的兜底轮询间隔（秒）。`0` 表示关闭兜底轮询。 |

## 工作原理

- **数据源**：以 stdio 启动 `codex app-server`，走 NDJSON JSON-RPC。列表与状态用 `thread/list`（按 `archived` 分别拉未归档与已归档两批）、`thread/loaded/list`、`thread/turns/list`；改名与归档三件套用 `thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/delete`；新建会话用 `thread/start` + `thread/metadata/update` + `thread/resume`（见下一条）。
- **打开会话**：构造 Codex 内部的会话 URI（`openai-codex://route/local/<id>`），用 `vscode.openWith` 交给 `chatgpt.conversationEditor`。已经开着标签的条目改用**那个标签自己的 resource**（含它的 query / remote 前缀）去打开——Codex 的自定义编辑器不允许同一文档开多个编辑器，所以这是「聚焦已有标签」而不是新建；「已归档」的条目先调一次 `thread/unarchive`（对齐 Codex 面板里的「取消归档并打开」），失败只报错、仍然打开。
- **新建会话（首选：直接建会话 + 开绑定标签）**：起一个**一次性** `codex app-server` 子进程，依次执行 `thread/start` → `thread/metadata/update`（写入工作区真实 gitInfo；目录不是 git 仓库时写全零 sha 占位，见「已知限制」）→ `thread/resume`。最后这步会让 Codex 自己把 rollout 头落盘，随后用 `openai-codex://route/local/<id>` 打开标签 —— 标签从出生就绑定会话：标题由 Codex 自己写，侧边栏点那一行会**聚焦这个标签**而不是再开一个。子进程必须**退出后**才打开标签：`thread/resume` 会持有该会话的 writer 锁，锁没放开时 Codex 面板的 resume 会被拒 `already has an active writer`（`thread/unsubscribe` 放不掉，只有进程退出才行）。这条链路实测约 **1.2 秒**（`initialize` 0.11s + `thread/start` 0.13s + `metadata/update` 0.78s + `resume` 0.17s + 退出 0.01s），期间会显示一个「正在创建 Codex 会话…」的进度通知；那 0.78s 是**每次调用都要付**的（同一进程连续三轮实测一致），热进程省不掉，只能靠后台预热隐藏。
- **新建会话（回退：空白面板）**：建会话任一步失败时，回退成打开 Codex 的 new-panel 路由 `/extension/panel/new`，每次额外带一个 `?newPanel=<随机值>` 的 query（不报错，用户至少有面板可用）。Codex 自己的 `chatgpt.newCodexPanel` 用的是固定 resource，在「同一文档只允许一个编辑器」的限制下连点只会聚焦同一个标签；换个 query 等于换个 resource，才能真正多开。
- **标签标题同步**：Codex 只在**打开标签那一刻**写标题（先取首条消息，随后用 `thread/list` 的名字覆盖，超过 30 字截断加 `…`），VS Code 又不允许外部改别的扩展的标签标题。所以标题还停在常量 `Codex`、而它绑定的会话已经有名字/首条消息时，本插件会在**该会话没在跑、且那个标签不是当前激活标签**时把标签关掉、用**它自己的 resource** 重开一次，让 Codex 重新 resolve 并自己把标题写上（见「已知限制」里的代价）。触发有三条：每次列表刷新之后、每次标签变化（切标签/开关标签）时各跑一次，另有一条**每 3 秒、最多 5 分钟**的兜底轮询——前两条都可能因为「树没被重新读取」而漏掉，只挂在树刷新上会导致切走再回来标题照旧（线上踩过）。
- **标签只作为标记**：扫描 `window.tabGroups`，识别 view type 为 `chatgpt.conversationEditor` 的标签页并解析出会话 id。标签**不再产生独立的行**——它只给对应会话行打「已打开」标记（窗口图标）并带上该标签自己的 resource。还没绑定会话的新面板解析不出会话 id，直接跳过（因此空白面板不进侧边栏，点 `+` 后请到编辑器标签栏找它）。
- **归档与删除**：归档 = `thread/archive`，取消归档 = `thread/unarchive`，删除 = `thread/delete`（不可恢复）。归档只是个标记，不动标签页；删除成功后本扩展会关掉显示该会话的标签页——本扩展与 Codex 各跑一个 app-server 子进程，删除通知不会跨进程送达 Codex 那侧的 webview，留着标签会让它继续去读一个已删除的会话。
- **二进制解析**：`codexHelper.codexExecutable` → `chatgpt.cliExecutable` → `<codex 扩展>/bin/<os>-<arch>/codex`，与 Codex 扩展自身的解析顺序保持一致。
- **运行状态判定**：某个会话「正在跑」的判据是「最新回合没有终止记录」**且**「它的 rollout 文件被存活的 codex app-server 进程持有」。Linux 上归属探测通过扫描 `/proc/<pid>/fd` 得到，不依赖时间阈值，长思考的回合不会被误判为已停止；macOS / Windows 无法探测归属，退化为「最近 `runningStaleSeconds` 秒内有过写入」的时间近似。扩展监听 rollout 文件的写入来即时重算，监听建立失败时用 `runningPollSeconds` 轮询兜底。

## 已知限制

- 置顶信息保存在本扩展的 `globalState`：Codex 协议里没有可写的槽位（`thread/metadata/update` 只能改 `gitInfo`）。因此置顶不会同步到 TUI 或其他机器。
- 置顶的会话如果在服务端已不存在，会被静默丢弃，不会留下空行。
- 「加载更多」目前只在命令面板里，树底部没有额外的按钮节点。
- 「已归档」分组只加载一页（`codexHelper.pageSize`，默认 50 条），不参与「加载更多」；归档数量很大时该组显示不全。
- 删除（`thread/delete`）不可恢复，且不弹确认框：删除入口只出现在「已归档」分组里，要误删得先归档再展开该组。归档可用 `thread/unarchive`（右键「取消归档」，或直接点开该条目）恢复。
- 归档 / 取消归档 / 删除需要**独占**这个会话：只要 Codex 那侧的 app-server 还持有它（打开过它、或它正在跑），本插件（另一个 app-server 进程）就会拿到 `already has an active writer`。抢不到也放不掉——`thread/resume` 会被同样拒绝，`thread/unsubscribe` 由非持有者发只影响自己的订阅，**关掉标签页也不释放**（持有者是 Codex 的 app-server 进程，不是那个标签，实测关掉很久仍失败）。所以这三个动作**点击时先预检**：用运行状态判定那份 `/proc` 归属扫描看一眼是不是被别的 codex 进程持有，命中就直接说明、不发那个注定被拒的请求（请求真被拒时给同一句说明兜底）。出路是用 Codex 自己的入口，或者 Reload Window 让 Codex 的 app-server 退出之后再归档。重命名不受影响（`thread/name/set` 不需要独占）。
- **回退路径**（建会话失败）下，侧边栏无法知道「那个空白面板正在显示哪个会话」：Codex 的 webview 在面板内新建会话时只做内部路由跳转，不改标签的 resource（上游自己的 chat session provider 也拿不到这个映射）。所以回退面板里开始的会话在侧边栏表现为「最近」/「历史」里的一行，而不是与那个面板绑定的一行；它的标签标题也会一直停在 `Codex`（同步逻辑只处理能解析出会话 id 的标签）。
- 打开会话失败时只报错，不会退回「新建空会话」——那样看起来像成功，实际会丢掉用户的对话。
- 「新建会话」的首选路径会多起一个一次性的 `codex app-server` 子进程（实测约 1 秒），并且依赖一条实测出来的调用顺序：`thread/start` 之后必须有一次成功的 `thread/metadata/update`（`thread/start` 本身不落盘），`thread/resume` 才会成功并把 rollout 写出来；少了它 resume 直接报 `no rollout found`。Codex 升级若改了这套行为，`+` 会自动回退成空白面板（不报错），修复点是重新确认这条序列。另外两条被实测排除的路：`thread/name/set` 也能让 resume 成功，但会把会话名固定住、顶掉自动标题，**不能**用；`thread/settings/update`、`thread/increment_elicitation`、`thread/resume{history/path}` 都要求 `experimentalApi` 能力或另有副作用，也不行。
- 目录不是 git 仓库时，落盘触发器要写的 `gitInfo` 用一个占位值：**全零 sha**（`000…0`，git 里表示「没有对象」的规范写法）。之所以不用假分支名：Codex 前端只读 `gitInfo.branch` / `originUrl`（webview bundle 里就是 `e?.branch?.trim()` / `e?.originUrl?.trim()`），sha 不出现在任何界面上，所以占位对用户不可见；而 app-server 要求 gitInfo 至少有一个字段，这个槽位必须填点什么。
- 标签标题同步是「关掉重开」：命中时会重载一次面板，**未发送的草稿和滚动位置会丢**（会话内容不丢）。所以它只在会话空闲、且那个标签不是当前激活标签时动手；运行状态判定不可用时（`codexHelper.showRunningIndicator` 关掉）不自动同步。会话改名导致的旧标签标题漂移也不会被同步——只有标题还是 `Codex` 的标签会被处理。
- 回退路径复刻了 Codex 的 new-panel 路由与 `newPanel` query（见「工作原理」）。如果 Codex 升级后改了这条路由、或不再容忍 query，症状是回退时 `+` 开出一个空白/异常页面；此时应改回委派 `chatgpt.newCodexPanel`（代价是只能开一个）。
- 回退到 Codex 自带二进制时，只支持 `x64` / `arm64` 架构上的 Windows、macOS 和类 Unix 系统；其他平台请用 `codexHelper.codexExecutable` 显式指定路径。
- 运行判定在 macOS / Windows 上只是时间近似：长思考的回合若超过 `runningStaleSeconds`（默认 300 秒）没有写入，会被显示为非运行中。Linux 上没有这个问题。

## 开发

```bash
pnpm install
pnpm build       # esbuild 打包到 dist/extension.js
pnpm test        # vitest 单元测试
pnpm typecheck   # tsc --noEmit
```

按 `F5` 启动扩展开发宿主。

### 发版

版本号的**唯一来源**是 `package.json` 的 `version`（`codex app-server` 握手时上报的 clientInfo 也在运行时从这里读取），所以发版只改这一处：

```bash
pnpm version patch        # 或 minor / major：改 package.json 并打 tag
pnpm build
# pnpm 10+ 默认拦下依赖的 postinstall，@vscode/vsce-sign 需要显式放行
pnpm dlx --allow-build=@vscode/vsce-sign @vscode/vsce package  # 产物 vscode-codex-helper-<version>.vsix
code --install-extension vscode-codex-helper-<version>.vsix    # 装到当前窗口所在的一端
```

## 许可

MIT，许可证全文见仓库根目录的 `LICENSE` 文件。
