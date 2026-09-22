# 验证记录：bind-new-session-tab

## 自动化

- `npx vitest run` → 21 个文件 / 170 个用例全绿（含本变更新增的 20 条 + 3 条补充边界）。
- `npx tsc --noEmit` → 通过。
- `npm run build` → 通过；`@vscode/vsce package` 产出 `vscode-codex-helper-0.0.10.vsix`。

## 真实协议验证（隔离的 `CODEX_HOME` 副本，未触碰真实会话数据）

用新写的 `createBoundSession` 直接打真实的 codex app-server（`0.154.0-alpha.6.2`）：

1. `createBoundSession` 返回真实 threadId：`01a0c80f-b86e-73c1-823f-c9c4cfaa4661`。
2. rollout 头由 Codex 自己落盘：`sessions/2026/09/22/rollout-2026-09-22T15-41-08-01a0c80f-….jsonl`。
3. 另一个 app-server 进程（模拟 Codex 面板）`thread/resume` → OK，turns = 0。
4. 空会话不出现在 `thread/list`（0 条）⇒ 点 `+` 不聊就关掉不会污染侧边栏。

## 实现期发现的偏差（已回写文档）

| 偏差 | 处理 | 确定性 |
|------|------|--------|
| `thread/metadata/update` 要求至少一个字段，`{threadId}` / `gitInfo:{}` 都被拒（`must include at least one field`） | 改为写**真实** gitInfo；探测不到就整体回退空白面板，不写假数据 | `[Verified]` |
| `thread/name/set` 也能让 resume 成功，但会把会话名固定住、顶掉自动标题（probe：turn 完成后 `list.name` 仍是所设名字） | 明确不用它，写进 design/proposal 的 `[Verified]` 表 | `[Verified]` |
| `thread/settings/update`、`thread/increment_elicitation` 需要 `experimentalApi` capability | 排除这两条路 | `[Verified]` |
| `waitForChildExit` 若在 `dispose()` 之后才挂监听，进程先退出就白等一个 2s 超时（单测 T-119 实测 2006ms） | 改成**先挂监听再 kill**，T-119 恢复到毫秒级 | `[Verified]` |
| 标题同步的判定必须要求标签**带句柄**（否则关不掉），这条前提在最初的纯函数里漏了 | 写入 `planTabTitleSync`，并补 fixture 句柄 | `[Verified]` |
| **用户实测反馈**：在非 git 仓库目录（`/home/hk/ai/hxg21day`）里点 `+` 后标题不更新 | 定位：该目录不是 git 仓库 ⇒ 原设计直接回退空白面板（回退面板解析不出会话 id，标题同步天然覆盖不到）。改为非 git 目录写全零 sha 占位继续建会话（`PLACEHOLDER_GIT_INFO`），并补 T-124/T-125 两条用例 + probe20 端到端验证 | `[Verified]` |

## 未做（明确排除）

- 会话改名导致的旧标签标题漂移（只处理标题仍是 `Codex` 的标签）。
- 清理「建了但没人聊」的空会话文件（不进列表，仅占磁盘）。
