# 新建会话直接绑定标签，标题交给 Codex 自己写

## Why

现在点 `+` 开的是 Codex 的空白面板（resource 固定为 `/extension/panel/new?newPanel=<nonce>`，没有会话 id），于是：

- 标签标题永远停在常量 `Codex` —— Codex 只在 `resolveCustomEditor` 那一刻写标题，空白面板没有会话 id，连那条异步标题刷新路径都进不去；
- 用户在面板里聊出来的会话，在侧边栏里是另一行，点那一行会**再开一个标签**，和当前面板对不上；
- 所以"新建会话后把标题同步成会话名"这件事，在空白面板这条路上没有任何可做的机制。

用户提出的方向是：既然插件本来就能和 app-server 说话，**能不能直接建会话**，让标签从出生就绑定会话，标题由 Codex 自己写。

## What Changes

- **`+` 改为「先建会话，再开绑定标签」**：用一次性 `codex app-server` 子进程执行 `thread/start` → `thread/metadata/update {gitInfo}` → `thread/resume`（`resume` 会让 Codex 把 rollout 头落盘），子进程退出后再用 `openai-codex://route/local/<id>` 打开标签。
  - 标签 URI 自带会话 id ⇒ Codex 打开标签时会走它自己的标题路径：先 `summary.preview`，随后异步用 `thread/list` 的 `name?.trim() || preview` 覆盖，超过 30 字符截断加 `…`。标题从此**由 Codex 自己写**，插件不伪造、不猜。
  - 子进程必须退出：`thread/resume` 会持有该会话的 writer 锁，锁没释放时 Codex 面板的 `resume` 会被拒 `already has an active writer`（`thread/unsubscribe` 也放不掉）。
  - 工作区不是 git 仓库时写**全零 sha 占位**继续建会话（Codex 前端只读 `branch`/`originUrl`，占位不上界面）；只有建会话任一步失败时才**回退到现在的空白面板**。
  - **不得**用 `thread/name/set` 当落盘触发器：实测它会把会话名固定住，顶掉 Codex 的自动标题。
- **新增「未标题标签同步」**：某个已绑定标签的标题仍是 Codex 默认值（`Codex`），而它对应的会话已经出现在列表里且有了标题时，插件在**该会话不运行、该标签不是当前激活标签**的前提下，关闭该标签并**用它自己的 resource 重新打开**——等于给 Codex 一次重新 resolve 的机会，标题由 Codex 写。
  - 目标标题按上游规则计算：`name?.trim() || preview`，为空则不同步；长度 > 30 时截断并追加 `…`。
  - 同一个会话的同一个目标标题只同步一次（防止 open/close 抖动或失败重试打转）。
  - 仍在 `Codex` 默认标题之外的标签一律不动（会话改名导致的标题漂移不在本次范围内）。

## Impact

- Affected specs: `codex-session-sidebar` 的「新建会话（每次点击独立面板）」→ 改为「新建会话（直接建会话并打开绑定标签）」，新增「未标题标签的标题同步」
- Affected code:
  - `src/session/sessionCreator.ts`（新增：一次性 app-server 的建会话编排水线）
  - `src/session/tabTitleSync.ts`（新增：目标标题计算 + 同步计划判定）
  - `src/session/openTabs.ts`（把标签句柄一起带出扫描）
  - `src/codex/types.ts`（`OpenTab.handle`）
  - `src/commands.ts`（`createNewSessionCommand` 改为「建会话优先、空白面板兜底」）
  - `src/extension.ts`（接线：一次性子进程 + gitInfo 探测 + 同步执行）
  - `test/**`、`README.md`

## Verified Facts

全部来自本机实测（隔离的 `CODEX_HOME` 副本，未触碰真实会话数据）+ 上游 bundle 反查。

| 事实 | 证据 | 确定性 |
|------|------|--------|
| 标签标题只有两处赋值，都在 `resolveCustomEditor`（同步 `summary.preview`、异步 `thread/list` 的 `name?.trim()||preview`），空白面板因无会话 id 进不了第二条 | 上游 bundle `out/extension.js`（`r.title=Uke(s)`、`nPreviews().then(...r.title=Uke(l))`、`fetchConversationPreviews`） | `[Verified]` |
| VS Code 不提供「改别的扩展标签标题」的 API（`TabGroups` 只有 `close`，`Tab.label` 只读） | `node_modules/@types/vscode/index.d.ts:18618-18657` | `[Verified]` |
| `thread/start` 后直接 `thread/resume` 报 `no rollout found`；先 `thread/metadata/update {gitInfo}` 再 `resume` 则成功，并把 rollout 落盘（≈18KB） | probe：`plain` 失败 / `delayed`（等 2.5s）失败 / `metadata(gitInfo)` 后 `resume` OK | `[Verified]` |
| `thread/metadata/update` 至少需要一个字段；`{threadId}` 与 `gitInfo:{}` 都被拒 | probe 报错：`must include at least one field` | `[Verified]` |
| `thread/settings/update`、`thread/increment_elicitation` 需要 `experimentalApi` capability，本插件用不了 | probe 报错：`requires experimentalApi capability` | `[Verified]` |
| `thread/start` 在 git 仓库里也不会自己落盘，`thread.gitInfo` 初始为 `null` | probe：`start(cwd=git 仓库) -> rollout: false` | `[Verified]` |
| 落盘后**另一个进程**可以 `resume`（turns=0）并正常 `turn/start`，会话随后出现在 `thread/list`（name/preview = 首条消息） | probe：跨进程 resume OK + turn/completed + `thread/list` 拿到该会话 | `[Verified]` |
| 落盘进程**存活期间**别的进程 resume 会被拒 `already has an active writer`；`thread/unsubscribe` 无效，进程退出后才放行 | probe：4) FAILED → 5) unsubscribe OK → 6) 仍 FAILED → 7) A 退出后 OK | `[Verified]` |
| 空会话（只有 session_meta、没有回合）**不会**出现在 `thread/list` 里 | probe：建会话后 `list 条数: 0`（同进程与新进程都为空） | `[Verified]` |
| `thread/name/set` 会把会话名固定住，首条消息后仍显示所设名字（顶掉自动标题） | probe：name/set("新会话") → turn 完成后 `list` 仍为 `name:"新会话"` | `[Verified]` |
| `gitInfo.branch` 为空串被拒（`gitInfo.branch must not be empty`），`{sha:"0"×40}` 被接受且随后 resume 成功、rollout 落盘 | probe：`branch-empty` 失败 / `sha-only` + resume OK | `[Verified]` |
| `thread/increment_elicitation`、`thread/settings/update`、`thread/resume{history/path}` 都不能替代 `metadata/update`：前两者要求 `experimentalApi` 能力，后两者报「requires experimentalApi」/「no rollout found」/「cannot resume with history while it is already running」 | probe15 / probe16 / probe17 / probe18 | `[Verified]` |
| Codex 前端只用 `gitInfo.branch` 与 `originUrl`（`e?.branch?.trim()` / `e?.originUrl?.trim()`），`sha` 不上界面 | 上游 webview `assets/app-initial-*.js` | `[Verified]` |
| 非 git 目录下「全零 sha 占位 → 落盘 → 另一个进程 resume → 真实回合」整条链路可用 | probe20：resume OK turns=0、turn/completed、`thread/list` 拿到会话 | `[Verified]` |
