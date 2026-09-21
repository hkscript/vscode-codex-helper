# Codex Helper

在 VS Code 侧边栏里浏览、打开、重命名和置顶 Codex 会话，并一眼看出哪个会话正在运行。

Codex 官方扩展（`openai.chatgpt`）把历史会话藏在面板内部，切换要点好几层。这个扩展把会话列表提到活动栏：一棵树，三个分组，点一下就回到对话。

## 功能

- **会话树**：活动栏新增「Codex 会话」视图，按 `已打开` / `置顶` / `历史` 三组展示，每组标题右侧显示条数。「已打开」与「置顶」可以同时包含同一个会话——置顶不会因为会话被打开而失效；「历史」与前两组互斥。
- **打开会话**：单击树节点即可打开或聚焦对应的 Codex 会话标签页（复用 Codex 自己的会话编辑器，不是只读预览）。
- **新建会话**：视图标题栏的 `+`，委派 Codex 的新建面板命令。
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
2. 单击任意会话打开它；右键菜单里有重命名、置顶 / 取消置顶。
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
| `codexHelper.openSession` | Codex: 打开会话 | 单击节点 / 右键 |
| `codexHelper.renameSession` | Codex: 重命名会话 | 右键菜单 |
| `codexHelper.pinSession` | Codex: 置顶会话 | 右键菜单 |
| `codexHelper.unpinSession` | Codex: 取消置顶 | 右键菜单（已置顶项） |
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

- **数据源**：以 stdio 启动 `codex app-server`，走 NDJSON JSON-RPC，使用 `thread/list`、`thread/loaded/list`、`thread/name/set`、`thread/turns/list` 四个方法。
- **打开会话**：构造 Codex 内部的会话 URI（`openai-codex://route/local/<id>`），用 `vscode.openWith` 交给 `chatgpt.conversationEditor`。Codex 的自定义编辑器不允许同一文档开多个编辑器，所以「聚焦已打开的」和「打开已关闭的」是同一次调用。
- **新建会话**：同样走 `vscode.openWith`，打开 Codex 的 new-panel 路由 `/extension/panel/new`，但每次额外带一个 `?newPanel=<随机值>` 的 query。Codex 自己的 `chatgpt.newCodexPanel` 用的是固定 resource，在「同一文档只允许一个编辑器」的限制下连点只会聚焦同一个标签；换个 query 等于换个 resource，才能真正多开。
- **已打开分组**：扫描 `window.tabGroups`，识别 view type 为 `chatgpt.conversationEditor` 的标签页并解析出会话 id；还没绑定会话的新面板也会作为未命名会话列出。
- **二进制解析**：`codexHelper.codexExecutable` → `chatgpt.cliExecutable` → `<codex 扩展>/bin/<os>-<arch>/codex`，与 Codex 扩展自身的解析顺序保持一致。
- **运行状态判定**：某个会话「正在跑」的判据是「最新回合没有终止记录」**且**「它的 rollout 文件被存活的 codex app-server 进程持有」。Linux 上归属探测通过扫描 `/proc/<pid>/fd` 得到，不依赖时间阈值，长思考的回合不会被误判为已停止；macOS / Windows 无法探测归属，退化为「最近 `runningStaleSeconds` 秒内有过写入」的时间近似。扩展监听 rollout 文件的写入来即时重算，监听建立失败时用 `runningPollSeconds` 轮询兜底。

## 已知限制

- 置顶信息保存在本扩展的 `globalState`：Codex 协议里没有可写的槽位（`thread/metadata/update` 只能改 `gitInfo`）。因此置顶不会同步到 TUI 或其他机器。
- 置顶的会话如果在服务端已不存在，会被静默丢弃，不会留下空行。
- 「加载更多」目前只在命令面板里，树底部没有额外的按钮节点。
- 打开会话失败时只报错，不会退回「新建空会话」——那样看起来像成功，实际会丢掉用户的对话。
- 「新建会话」复刻了 Codex 的 new-panel 路由与 `newPanel` query（见「工作原理」）。如果 Codex 升级后改了这条路由、或不再容忍 query，症状是 `+` 开出一个空白/异常页面；此时应改回委派 `chatgpt.newCodexPanel`（代价是只能开一个）。
- 回退到 Codex 自带二进制时，只支持 `x64` / `arm64` 架构上的 Windows、macOS 和类 Unix 系统；其他平台请用 `codexHelper.codexExecutable` 显式指定路径。
- 运行判定在 macOS / Windows 上只是时间近似：长思考的回合若超过 `runningStaleSeconds`（默认 300 秒）没有写入，会被显示为非运行中。Linux 上没有这个问题。
- 一个会话同时出现在「已打开」与「置顶」两组时会有两行，各自记住自己的折叠与选中状态——它们用不同的树节点 id，这是刻意为之，否则 VS Code 会拿同一个 id 同时管两行。

## 开发

```bash
pnpm install
pnpm build       # esbuild 打包到 dist/extension.js
pnpm test        # vitest 单元测试
pnpm typecheck   # tsc --noEmit
```

按 `F5` 启动扩展开发宿主。

## 许可

MIT，许可证全文见仓库根目录的 `LICENSE` 文件。
