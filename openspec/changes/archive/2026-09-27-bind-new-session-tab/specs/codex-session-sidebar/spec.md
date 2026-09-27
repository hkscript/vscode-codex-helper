## REMOVED Requirements

### Requirement: 新建会话（每次点击独立面板）

**Reason**: 空白面板的 resource 不带会话 id（`openai-codex://route/extension/panel/new?newPanel=<nonce>`），标签标题永远停在 `Codex`；而且面板里聊出来的会话在侧边栏是另一行，点那一行会再开一个标签、和当前面板对不上。用户要求的「直接建会话，让标签从出生就绑定会话」把「每次点击打开一个独立空白面板」这一条整体推翻。

**Migration**: 由本变更 `## ADDED Requirements` 的 `### Requirement: 新建会话（直接建会话并打开绑定标签）` 替代。原 5 条 scenario 的去向：`每次执行都打开带上本次调用独有 query 的新面板 URI` → 改写为 `建会话成功后打开绑定标签`；`连续两次执行产生两个互不相同的 URI` → 不再需要（每次建的是不同会话，resource 天然互不相同）；`新建失败时提示错误` → 被推翻（建会话失败回退空白面板且不报错，见 `建会话失败时回退空白面板且不报错`）；`尚未绑定会话的新建标签以未命名项出现在「已打开」组` → 由另一变更「已打开标签识别（只认已绑定会话的标签）」取代；`带 query 的新面板 URI 不被误判为会话` → 保留（空白面板仍是回退路径，`已打开标签页识别` 的 `忽略非 Codex 标签` 覆盖）。

## ADDED Requirements

### Requirement: 新建会话（直接建会话并打开绑定标签）

点击「新建会话」时，插件 SHALL 优先走「直接建会话」：用一次性 `codex app-server` 子进程依次执行 `thread/start`、`thread/metadata/update`（携带工作区真实的 gitInfo）、`thread/resume`，等该子进程退出后，用该会话 id 的会话 URI（`vscode.openWith` + `chatgpt.conversationEditor`）打开标签——使标签从出生就绑定会话，标题由 Codex 自己写。

插件 SHALL NOT 用 `thread/name/set` 作为让 Codex 落盘的触发器。工作区不是 git 仓库（探测不到真实 gitInfo）时，插件 SHALL 改用**全零 sha 占位**（`PLACEHOLDER_GIT_INFO`）继续建会话 —— 该占位只落在 `gitInfo.sha`，而 Codex 前端只读 `branch` / `originUrl`，故不可见；「目录没有 git」不得让新建会话退化。只有建会话任一步失败时，才回退为打开今天这个空白面板（`/extension/panel/new` 带唯一 nonce），且 SHALL NOT 报错打断用户（建会话失败不是用户动作的失败）。

本命令与「会话打开与聚焦」中「打开失败不得回退新建」不冲突：那条约束限定的是**打开既有会话失败**时的行为，本条是**用户显式发起**的新建入口。

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

### Requirement: 标题停在 Codex 默认值的标签在点击那一行时重载

Codex 只在 `resolveCustomEditor` 那一刻写标签标题，而 VS Code 没有「原地重新解析」的能力（Codex 的自定义编辑器 `supportsMultipleEditorsPerDocument: false` ⇒ 同一 resource 再 resolve 只会返回已开着的编辑器）。因此插件 SHALL 只在**用户点击侧边栏上那一行**时修正标题：该行的会话已经有打开的标签、且该标签的标题仍是 Codex 默认值（`Codex`）时，SHALL 关掉它并**用它自己的 resource** 重新打开（让 Codex 重新 resolve 并自己写标题），然后把它放回原来的栏与组内位置。标签标题已经不是默认值时 SHALL NOT 重载（只聚焦）；重载失败 SHALL 退化为聚焦/打开，不得让这一行点不开。插件 SHALL NOT 在后台自动重载标签——那会在用户正在别处干活时闪一下。

重开 SHALL 带 `viewColumn`（标签原来那一栏），并在重开后把它放回原来的组内下标；该动作 SHALL 只在「当前激活的正是刚打开那个标签」时执行（照错标签会把用户的标签挪走），命令不可用或身份核对不过时 SHALL 静默跳过（位置不还原，标题修正不受影响）。

#### Scenario: 点这一行就把标题还停在 Codex 的标签重载一次

- **GIVEN** 会话 `t1` 的标签标题为 `Codex`，它在第 2 栏、组内第 2 格（下标 1）
- **WHEN** 用户点击侧边栏上 `t1` 那一行
- **THEN** 插件先关闭该标签，再用该标签自己的 resource 打开它（带 `viewColumn` 为第 2 栏）
- **AND** 重开后发一次 `moveActiveEditor`，参数为 `{to:'position', by:'tab', value: 原下标 + 1}`（该命令 1 基）
- **AND** 不再额外聚焦一次该标签（重开后它就是激活标签）

#### Scenario: 标题已经正确的标签点开时只聚焦

- **GIVEN** 会话 `t1` 的标签标题已是 `修复登录超时`
- **WHEN** 用户点击 `t1` 那一行
- **THEN** 插件不关闭该标签，只用该标签自己的 resource 聚焦它

#### Scenario: 重载失败也照样把这一行打开

- **GIVEN** 会话 `t1` 的标签标题为 `Codex`，但关闭该标签或重新打开它失败了
- **WHEN** 用户点击 `t1` 那一行
- **THEN** 插件退化为聚焦/打开该标签自己的 resource（重载失败不吞掉这次点击）
- **AND** 报告重载失败的原因，但不改变「这一行能点开」这个结果

#### Scenario: 会话没有打开的标签时按会话 id 打开

- **GIVEN** 会话 `t1` 当前没有任何打开的标签
- **WHEN** 用户点击 `t1` 那一行
- **THEN** 插件按会话 id 打开标签（新开的标签本来就由 Codex 自己写标题），不做重载

### Requirement: 新建会话出现后自动进入侧边栏

空会话不出现在 `thread/list` 里，所以在面板里发出第一条消息之前，新建的会话不会出现在侧边栏，也没有事件通知插件。插件 SHALL 在成功建出会话之后盯住列表（默认每 3 秒一次、最多 10 分钟，标签被关掉就提前放弃）：只要还在等的会话里有一个出现在列表里 SHALL 刷新侧边栏。该轮询 SHALL NOT 带搜索过滤（用户开着过滤不代表会话没出现），并在无事可等时停止。

#### Scenario: 新会话出现后自动刷新侧边栏

- **GIVEN** 用户点了 `+`，插件建出会话 `t1` 并打开了它的标签
- **AND** `t1` 还没出现在 `thread/list` 里
- **WHEN** 用户在面板里发出第一条消息，`t1` 出现在列表里
- **THEN** 插件在下一拍轮询里发现它，并刷新侧边栏，`t1` 这行出现（用户不需要手动刷新）

#### Scenario: 建完就关掉标签不再等

- **GIVEN** 新建的会话 `t1` 的标签已被用户关掉，且它还没进列表
- **WHEN** 轮询下一拍执行
- **THEN** 插件放弃等待（不再拉列表、不再轮询）

#### Scenario: 超过等待上限就放弃

- **GIVEN** 新建的会话 `t1` 一直没有出现在 `thread/list` 里，而它的标签还开着
- **WHEN** 等满上限（10 分钟）
- **THEN** 插件不再为 `t1` 轮询（不刷新、不拉列表）

#### Scenario: 拉列表失败不算「等到了」，下一拍接着试

- **GIVEN** 插件正在等 `t1` 进列表
- **WHEN** 这一拍拉取会话列表失败（app-server 忙/重启中）
- **THEN** 插件保持等待，下一拍继续

#### Scenario: 多个会话同时在等时按各自的进度处理

- **GIVEN** 插件同时在等 `t1` 与 `t2` 进列表
- **WHEN** 这一拍只有 `t2` 出现在列表里
- **THEN** 插件刷新一次侧边栏，并继续等 `t1`
