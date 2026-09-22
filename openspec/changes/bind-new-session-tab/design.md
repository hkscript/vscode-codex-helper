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

## 3. 未标题标签同步

触发与判定（全部为纯函数，便于单测）：

| 条件 | 取值 |
|------|------|
| 标签属于 Codex 会话编辑器且能解析出会话 id | `scanCodexTabs` 已经保证 |
| 标签当前标题等于 Codex 默认值 | `label === 'Codex'`（只动"还没被 Codex 起过名"的标签，不碰改名导致的漂移） |
| 会话在列表里有目标标题 | `name?.trim() \|\| preview` 非空 |
| 目标标题与该标签当前标题不同 | —— |
| 会话不在运行 | `runningIds !== null && !runningIds.has(id)`（运行状态不可知时不动） |
| 该标签不是当前激活标签 | `activeTabGroup.activeTab` 的 resource 与之不同 |
| 该会话的这个目标标题没同步过 | `synced: Map<sessionId, expectedTitle>` |

命中后：`tabGroups.close(tab)` → `openWith(tab 自己的 uri)`，并记下 `synced.set(id, expected)`。

触发（三条并行，都不能省）：

1. `load()` 之后 —— 数据最新，零额外请求；
2. `tabGroups.onDidChangeTabs` —— 切标签/开关标签时直接跑，**不依赖树可见**；
3. 兜底轮询 —— 存在候选标签时每 3 秒复查、5 分钟封顶（事件可能因为「侧边栏没被重新读取」而漏掉，线上就是这么漏的）。

候选会话不在本地缓存（`threads`）里时，同步自己拉一次 `thread/list`，不去指望 `load()`。

对应的上游标题规则复刻为一个函数：

```ts
// Uke(t) = t ? (t.length > 30 ? t.slice(0,30) + '…' : t) : 'Codex'
export function expectedTabTitle(thread): string | null {
  const label = thread?.name?.trim() || thread?.preview || '';
  if (!label) return null;
  return label.length > 30 ? label.slice(0, 30) + '…' : label;
}
```

## 4. 边界与取舍

- **回退**：只有建会话任一步失败（子进程起不来、`thread/start`/`metadata/update`/`resume` 报错）才走空白面板（今天的行为）；「目录没有 git」不再触发回退。
- **代价**：`+` 多一次子进程（intialize + 3 个请求 + 退出）；第一次同步时标签会重载一次（草稿/滚动位置丢失，会话内容不丢）。
- **不做**：清理"建了但没用"的空会话文件（`thread/list` 不显示，仅占磁盘）；不修会话改名后旧标签的标题漂移。
- **上游依赖**：`start → metadata/update → resume` 这条"让 Codex 自己落盘"的顺序是实测行为，不是文档承诺；任何一步变了就退化成空白面板（可接受），因此不引入新的失败模式。
