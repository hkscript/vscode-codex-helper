## MODIFIED Requirements

### Requirement: 新建会话（直接建会话并打开绑定标签）

点击「新建会话」时，插件 SHALL 优先走「直接建会话」：用一次性 `codex app-server` 子进程依次执行 `thread/start`、`thread/metadata/update`（携带工作区真实的 gitInfo）、`thread/resume`，等该子进程退出后，用该会话 id 的会话 URI（`vscode.openWith` + `chatgpt.conversationEditor`）打开标签——使标签从出生就绑定会话，标题由 Codex 自己写。

插件 SHALL NOT 用 `thread/name/set` 作为让 Codex 落盘的触发器。工作区不是 git 仓库（探测不到真实 gitInfo）时，插件 SHALL 改用**全零 sha 占位**（`PLACEHOLDER_GIT_INFO`）继续建会话 —— 该占位只落在 `gitInfo.sha`，而 Codex 前端只读 `branch` / `originUrl`，故不可见；「目录没有 git」不得让新建会话退化。只有建会话任一步失败时，才回退为打开今天这个空白面板（`/extension/panel/new` 带唯一 nonce），且 SHALL NOT 报错打断用户（建会话失败不是用户动作的失败）。

#### Scenario: 建会话成功后打开绑定标签

- **GIVEN** 工作区能探测到 gitInfo（分支 `main`）
- **WHEN** 用户触发「新建会话」
- **THEN** 插件以 `thread/start` 建会话，随后发出 `thread/metadata/update`（参数含 `threadId` 与该 gitInfo）与 `thread/resume`
- **AND** 子进程退出后，以 `vscode.openWith` 打开 `openai-codex://route/local/<id>`，viewType 为 `chatgpt.conversationEditor`，`preview` 为 `false`

#### Scenario: 非 git 工作区仍然建会话并打开绑定标签

- **GIVEN** 工作区不是 git 仓库（探测不到任何真实 gitInfo 字段）
- **WHEN** 用户触发「新建会话」
- **THEN** 插件照常执行 `thread/start` → `thread/metadata/update` → `thread/resume`，其中 `gitInfo` 为 `{sha: '0000000000000000000000000000000000000000'}`（全零占位，保证 app-server 的「至少一个字段」与落盘都成立）
- **AND** 以 `vscode.openWith` 打开 `openai-codex://route/local/<id>`，而不是空白面板

#### Scenario: 建会话任一步失败时回退空白面板

- **GIVEN** `thread/start` 或 `thread/resume` 返回错误
- **WHEN** 用户触发「新建会话」
- **THEN** 插件回退打开 `/extension/panel/new`（带新 nonce）

#### Scenario: 建会话失败时回退空白面板且不报错

- **GIVEN** `thread/start` 返回错误
- **WHEN** 用户触发「新建会话」
- **THEN** 插件回退打开 `/extension/panel/new`（带新 nonce）
- **AND** 不展示错误消息（不打断用户）

#### Scenario: 落盘后必须等子进程退出才打开标签

- **GIVEN** 一次性子进程已经完成 `thread/resume`，但进程尚未退出
- **WHEN** 建会话流程结束
- **THEN** 插件先等待该子进程退出（上限 2 秒），再调用 `vscode.openWith` 打开标签

## ADDED Requirements

### Requirement: 未标题标签的标题同步

对于标题仍是 Codex 默认值（`Codex`）的**已绑定**标签，当它对应的会话已出现在会话列表里、且能算出非空的目标标题时，插件 SHALL 在「该会话不在运行、该标签不是当前激活标签、该会话的这个目标标题尚未同步过」的前提下，关闭该标签并**用它自己的 resource** 重新打开，让 Codex 重新 resolve 并自己写标题。

目标标题 SHALL 与上游规则一致：`name?.trim() || preview`，为空则不动；长度超过 30 时截断并追加 `…`。运行状态不可知（未启用运行状态跟踪）时 SHALL NOT 自动同步。同一会话的同一目标标题 SHALL 最多同步一次。

#### Scenario: 未标题标签被同步成会话标题

- **GIVEN** 会话 `t1` 的标签标题为 `Codex`，会话列表里 `t1` 的名字为 `修复登录超时`
- **AND** `t1` 不在运行，且该标签不是当前激活标签
- **WHEN** 列表刷新
- **THEN** 插件先关闭该标签，再用该标签自己的 resource 打开它
- **AND** 同一个目标标题不会再次触发同步

#### Scenario: 标签标题超过 30 字符时按上游规则截断

- **GIVEN** 会话 `t1` 的名字为 40 个字符
- **WHEN** 计算目标标题
- **THEN** 目标标题为前 30 个字符加 `…`

#### Scenario: 运行中的会话不自动同步

- **GIVEN** 会话 `t1` 的标签标题为 `Codex`，且 `t1` 正在运行
- **WHEN** 列表刷新
- **THEN** 不关闭、也不重开该标签

#### Scenario: 当前激活标签不自动同步

- **GIVEN** 标题为 `Codex` 的标签就是当前激活标签，且它对应的会话已有目标标题
- **WHEN** 列表刷新
- **THEN** 不关闭、也不重开该标签

#### Scenario: 已有自定义标题的标签不被动

- **GIVEN** 某个已绑定标签的标题是 `修复登录超时`（不是 `Codex`）
- **WHEN** 列表刷新
- **THEN** 不关闭、也不重开该标签

#### Scenario: 会话没有标题时不同步

- **GIVEN** 会话 `t1` 的标签标题为 `Codex`，且 `t1` 既没有名字也没有 preview
- **WHEN** 列表刷新
- **THEN** 不关闭、也不重开该标签
