# Codex Helper

**把 Codex 会话变成编辑器标签页。** 分栏、拖拽、并排对比，布局随你摆；活动栏里的会话面板负责搜索、筛选和一键切换。

> 需要先安装并登录 Codex 官方扩展 [`openai.chatgpt`](https://marketplace.visualstudio.com/items?itemName=openai.chatgpt)，安装本扩展时会自动带上。

## 为什么用它

Codex 官方扩展把会话藏在面板里：切换要点好几层，也没法同时看几个会话。Codex Helper 把会话列表提到活动栏，每个会话开成独立标签页——想并排看就拖成多栏，想切换就点一下。

## ✨ 功能亮点

- 🗂️ **会话即标签页**：每个会话都是普通编辑器标签，可分栏、拖拽、并排对比；已打开的会话会直接聚焦，不会重复开。
- 📋 **分组会话面板**：按「置顶 / 最近 / 历史 / 已归档」分组，显示条数和相对更新时间（`now` / `5m` / `22d`）。
- 🔍 **标题与内容搜索**：点搜索图标切换范围——「搜标题」即时过滤；「搜内容」会在历史对话的用户输入和模型最终回复中查找。
- 📁 **按目录筛选**：多选工作目录，筛选结果按 workspace 记住，重载后自动恢复。
- 👀 **悬停预览**：鼠标停在会话上，显示开头两次和最后一次的提问，以及模型的最后回复。
- 📌 **置顶、重命名、归档、删除**：右键或行尾 `⋯` 一步完成；重命名会写回 Codex，TUI 和官方扩展里同步生效。
- ⏳ **运行中标识**：正在执行的会话显示旋转图标。
- ➕ **快速新建**：标题栏 `+` 新建会话，可自动沿用你上次使用的思考级别。
- 🔄 **分页与自动刷新**：默认每次加载 50 条，底部可「加载更多」；可选定时刷新，侧边栏隐藏时自动暂停。

## 🚀 快速上手

1. 点击活动栏的 **Codex** 图标，打开「Codex 会话」面板。
2. 单击会话即可在编辑器标签中打开；拖动标签即可分栏并排。
3. 右键或点行尾 `⋯`：重命名、置顶、归档；已归档的会话可以删除。
4. 用顶部搜索框查找会话，点漏斗按工作目录筛选。

所有操作也可以在命令面板（`Ctrl/Cmd+Shift+P`）中输入 `Codex:` 调用。

## ⚙️ 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `codexHelper.sessionOpenMode` | `editorTab` | 会话打开方式：`editorTab` 每个会话一个独立标签；`sidebar` 复用 Codex 侧边栏，切换更快。 |
| `codexHelper.newSessionReasoningEffort` | `remember` | 新建会话的思考级别：`remember` 沿用上次用过的级别，`off` 不干预，或固定为 `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。只作用于该会话，不改全局配置。 |
| `codexHelper.pageSize` | `50` | 每次加载的会话条数。 |
| `codexHelper.filterByWorkspaceCwd` | `false` | 只显示当前工作区目录下的会话。 |
| `codexHelper.autoRefreshSeconds` | `0` | 自动刷新间隔（秒），`0` 为关闭。 |
| `codexHelper.showRunningIndicator` | `true` | 显示会话运行中图标。 |
| `codexHelper.runningStaleSeconds` | `300` | macOS / Windows 上判断「运行中」的过期阈值（秒）。 |
| `codexHelper.runningPollSeconds` | `5` | 文件监听不可用时的兜底轮询间隔（秒），`0` 为关闭。 |
| `codexHelper.patchCodexNoRetry` | `true` | 关闭 Codex 面板的请求重试，并把启动超时放宽到 120 秒，减少「Codex could not start」。修改前自动备份，重载窗口后生效。 |
| `codexHelper.codexExecutable` | `""` | `codex` 可执行文件路径；留空时依次使用 Codex 扩展配置和其自带二进制。 |

## ⚠️ 已知限制

- **置顶只存在本地**：保存在本扩展中，不会同步到 TUI 或其他机器。
- **归档 / 删除需要会话空闲**：若 Codex 正占用该会话，会提示 `already has an active writer`，可在 Codex 中操作或重载窗口后重试。重命名不受影响。
- **新会话稍后出现**：空会话在发送第一条消息前不会出现在列表中。
- **标题修正会重载面板**：点击会话触发标题修正时，未发送的草稿和滚动位置会丢失（对话内容不丢）。
- **运行判定**：macOS / Windows 上按最近写入时间近似判断，超长回合可能显示为未运行。
- **平台**：使用 Codex 自带二进制时仅支持 `x64` / `arm64`，其他平台请设置 `codexHelper.codexExecutable`。

## 🔧 工作原理

扩展以 stdio 启动 `codex app-server`，通过 JSON-RPC 读取和修改会话（`thread/list`、`thread/name/set` 等），打开会话时把 Codex 内部的会话 URI 交给官方扩展的编辑器显示。Linux 上通过 `/proc` 判断 rollout 文件是否被活跃进程持有来识别「运行中」。

## 许可

MIT，许可证全文见仓库根目录的 `LICENSE` 文件。
