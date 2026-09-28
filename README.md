# Codex Helper

像 Claude 的 VS Code 插件那样管理 Codex 会话：**每个会话都是一个编辑器标签页**，可以分栏、拖到任意列、并排对比，布局随你摆；侧边栏只负责在会话之间快速切换。

Codex 官方扩展（`openai.chatgpt`）把会话藏在面板内部，切换要点好几层，也没法把几个会话摆在一起看。这个扩展把会话列表提到活动栏，并让每个会话都开成独立 tab：一棵树，四个分组，点一下就回到对话，想同时看好几个就拖成多栏。

## 功能

- **Tab / 面板式管理**：每个会话是普通编辑器标签页，可自由分栏、拖拽、并排对比，布局随时调整；侧边栏那一行只负责打开或聚焦对应标签，不会重复开。
- **会话树**：活动栏新增「Codex 会话」视图，按 `置顶` / `最近` / `历史` / `已归档` 四组展示，标题右侧带条数。
- **新建会话**：标题栏 `+` 开出一个空白面板（未绑定会话前不进侧边栏）。
- **归档与删除**：未归档条目悬停出「归档」，已归档条目悬停出「删除」（不可恢复）。删除入口只对已归档会话开放，归档可随时用右键「取消归档」恢复，都不弹确认框。
- **重命名**：通过 `thread/name/set` 写回 Codex，TUI 和官方扩展里同样生效。
- **置顶**：固定在顶部，状态存在扩展的 `globalState` 里，跨窗口生效。
- **运行中标识**：正在执行回合的会话显示旋转图标。
- **目录名描述**：条目描述显示会话工作目录的末级目录名。
- **过滤 / 分页**：按会话名、id 或预览文本筛选；默认拉取最近 50 条，可用 `Codex: 加载更多` 继续翻。
- **自动刷新**：打开/关闭 Codex 标签页时自动刷新，也可配置定时刷新。
- **错误可见**：加载失败时树里显示带重试的错误节点，而不是装成「没有会话」。

## 依赖

需要先安装并登录 Codex 官方扩展 [`openai.chatgpt`](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)（已声明为 `extensionDependencies`，安装本扩展时会自动带上）。要求 VS Code `^1.96.2`。

## 使用

1. 点击活动栏的 Codex 图标，打开「Codex 会话」视图。
2. 单击任意会话打开它；悬停出现「归档」（已归档条目上是「删除」），右键菜单里有打开、重命名、置顶 / 取消置顶、取消归档。
3. 视图标题栏依次是：新建会话、刷新、过滤、清除过滤。

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
| `codexHelper.codexExecutable` | string | `""` | `codex` 可执行文件路径。留空则回退到 Codex 扩展的 `chatgpt.cliExecutable`，再回退到扩展自带二进制。 |
| `codexHelper.pageSize` | number | `50` | 每次拉取的会话条数。 |
| `codexHelper.filterByWorkspaceCwd` | boolean | `false` | 只列出当前工作区目录下的会话。 |
| `codexHelper.autoRefreshSeconds` | number | `0` | 自动刷新间隔（秒），`0` 表示关闭。 |
| `codexHelper.showRunningIndicator` | boolean | `true` | 显示运行中图标并监听 rollout 文件。 |
| `codexHelper.runningStaleSeconds` | number | `300` | 运行状态过期阈值（秒），仅用于 macOS / Windows。 |
| `codexHelper.runningPollSeconds` | number | `5` | 文件监听不可用时的兜底轮询间隔（秒），`0` 表示关闭。 |
| `codexHelper.newSessionReasoningEffort` | string | `"remember"` | 新建会话用哪个思考级别：`remember` 跟随你上次真正用过的级别，`off` 不干预，其余取值（`minimal`/`low`/`medium`/`high`/`xhigh`/`max`）固定用该级别。级别通过 `thread/settings/update` 写在新建会话自己身上（`threads.reasoning_effort`），不改全局配置；写不进去时只是这个会话没有默认档，不影响新建。 |

## 工作原理

扩展以 stdio 启动 `codex app-server`，走 NDJSON JSON-RPC 读写会话：列表与状态用 `thread/list`、`thread/loaded/list`、`thread/turns/list`，改名 / 归档 / 删除用对应的 `thread/*` 方法。打开会话时构造 Codex 内部的会话 URI 交给 `chatgpt.conversationEditor`；由于 Codex 不允许同一文档开多个编辑器，已开标签会被聚焦而不是重复打开。运行状态由「最新回合未终止」且「rollout 文件被存活的 app-server 进程持有」共同判定（Linux 走 `/proc` 归属扫描，macOS / Windows 退化为时间近似）。

## 已知限制

- 置顶存在本扩展的 `globalState`：协议里没有可写槽位，不会同步到 TUI 或其他机器。
- 「已归档」分组只加载一页（`codexHelper.pageSize`），不参与「加载更多」。
- 归档 / 取消归档 / 删除需要独占该会话：Codex 的 app-server 还持有它时会报 `already has an active writer`，点击前会先预检并给出说明。出路是用 Codex 自己的入口，或 Reload Window 后重试。重命名不受影响。
- 「新建会话」首选路径会多起一个一次性的 `codex app-server` 子进程（约 1 秒）并依赖一条实测的调用顺序；失败会自动回退成空白面板（不报错）。
- 标题修正（点条目时的「关掉重开」）会重载一次面板，**未发送的草稿和滚动位置会丢**（会话内容不丢），且只在点击时触发。
- 空会话在发出第一条消息前不进 `thread/list`，因此 `+` 之后的行要等一会儿才出现。
- macOS / Windows 上的运行判定只是时间近似：超过 `runningStaleSeconds` 无写入的长回合会被显示为非运行中。
- 回退到 Codex 自带二进制时只支持 `x64` / `arm64`；其他平台请用 `codexHelper.codexExecutable` 显式指定路径。

## 开发

```bash
pnpm install
pnpm build       # esbuild 打包到 dist/extension.js
pnpm test        # vitest 单元测试
pnpm typecheck   # tsc --noEmit
```

按 `F5` 启动扩展开发宿主。

### 发版

版本号的唯一来源是 `package.json` 的 `version`，发版只改这一处：

```bash
pnpm version patch        # 或 minor / major：改 package.json 并打 tag
pnpm build
# pnpm 10+ 默认拦下依赖的 postinstall，@vscode/vsce-sign 需要显式放行
pnpm dlx --allow-build=@vscode/vsce-sign @vscode/vsce package  # 产物 vscode-codex-helper-<version>.vsix
code --install-extension vscode-codex-helper-<version>.vsix
```

## 许可

MIT，许可证全文见仓库根目录的 `LICENSE` 文件。
