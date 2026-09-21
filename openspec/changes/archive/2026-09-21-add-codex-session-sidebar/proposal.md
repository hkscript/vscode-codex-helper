# Codex Session Sidebar（vscode-codex-helper）

## Why

Codex VS Code 插件（`openai.chatgpt`）的每个 Agent 会话都是一个独立的编辑器标签页（custom editor，viewType `chatgpt.conversationEditor`）。会话一多，标签页就挤满编辑器区：看不出哪个标签对应哪个会话、找不回昨天那条对话、关掉就等于丢失入口。Codex 插件对外只暴露 10 个命令，其中与会话相关的只有 `chatgpt.newCodexPanel`（新建）、`chatgpt.openSidebar`、`chatgpt.newChat`，**没有任何"列出历史会话"或"按 id 打开指定会话"的公开命令**，所以这个问题在 Codex 插件内部无解。本变更新建一个轻量伴生插件，用侧边栏树视图接管 Codex 的会话浏览与标签页导航，对标 Claude Code 插件的 sessions 侧边栏体验。

## What Changes

- 新建 VS Code 插件工程 `vscode-codex-helper`（TypeScript + esbuild），`extensionDependencies` 声明依赖 `openai.chatgpt`
- 新增 Activity Bar 视图容器 + **TreeView** 会话列表，分两组：**已打开**（当前窗口的 Codex 标签页）与**历史会话**
- 会话数据经 **Codex app-server JSON-RPC** 获取：启动 `codex app-server proxy` 子进程，以 stdio speak JSON-RPC，调用 `thread/list`（历史）与 `thread/loaded/list`（活跃）
- 点击历史会话 → `vscode.openWith(Uri.parse('openai-codex://route/local/<threadId>'), 'chatgpt.conversationEditor')` 在编辑器中恢复该会话
- 点击已打开会话 → 用 `vscode.window.tabGroups` 定位并聚焦对应标签页
- 搜索过滤：视图标题栏提供关键词过滤（按会话名 / id 匹配）
- 会话重命名：右键 → 输入新名 → `thread/name/set` 写回 Codex（对 Codex TUI / 插件同样可见，非本插件私有）
- 置顶 / 收藏：本插件 `globalState` 持久化，置顶项排在列表顶部
- 手动刷新命令 + 可配置的自动轮询间隔
- 错误可见性：codex 二进制缺失、app-server 启动失败、RPC 超时时，树中展示明确的错误节点与重试入口，不静默留白

## Impact

- Affected specs: `codex-session-sidebar`（新增 capability）
- Affected code: 全新工程，无存量代码。关键新增文件（spec 阶段细化）：`package.json` 的 `contributes.views`/`viewsContainers`/`commands`/`configuration`、app-server RPC 客户端、TreeDataProvider、标签页对账、会话打开器
- 外部依赖（均已核实存在）：
  - `[Verified]` Codex 插件 `openai.chatgpt` v26.908.40401，`engines.vscode: ^1.96.2`
  - `[Verified]` 随插件分发的 codex 二进制：`<codex-ext>/bin/linux-x86_64/codex`，含 `app-server proxy` 子命令；用户亦可通过 `chatgpt.cliExecutable` 配置自定义路径
  - `[Verified]` app-server 协议（由 `codex app-server generate-json-schema` 生成）包含 `thread/list`、`thread/loaded/list`、`thread/read`、`thread/items/list`、`thread/name/set`、`thread/metadata/update`、`thread/archive`、`thread/delete`
  - `[Verified]` Codex 会话面板是 custom editor，viewType `chatgpt.conversationEditor`；URI 由 `scheme=openai-codex`、`authority=route`、`path=/local/<conversationId>` 构成（见 `out/extension.js` 中 `pI()` / `iPe()` / `createNewPanel()`）
- 运行环境：WSL2 下的 VS Code Remote（vscode-server 1.126.0），插件与 codex 二进制同在 remote 侧

## Success Criteria（验收条件）

1. 侧边栏出现 Codex 会话视图；历史会话按最近更新倒序列出，条目显示会话名与相对时间
2. 在过滤框输入关键词后，树只保留名称匹配的会话；清空后恢复全量
3. 点击一条历史会话，打开的标签页是**该会话本身**（会话内容与 id 一致），而不是新建空会话
4. 当前窗口已打开的 Codex 标签页在"已打开"分组中列出；点击后聚焦到对应标签页而非重复打开
5. 右键重命名后，列表立即显示新名称；重启 VS Code 后新名称仍在（说明已写回 Codex，而非仅本地缓存）
6. 置顶的会话重启后仍排在列表顶部
7. 把 codex 可执行文件路径配置成不存在的值时，树显示明确错误信息与"重试"节点，不是空列表
8. 视图标题栏点「新建会话」后，Codex 新建出一个会话面板，侧边栏「已打开」组立刻出现一条未命名项（标题取自标签页），点它可回到那个新会话
9. 打开侧边栏时，「已打开」与「置顶」分组默认展开，「历史」分组默认折叠

## Scope Boundaries

**在范围内**：会话的浏览、搜索、打开、聚焦、重命名、置顶收藏。

**不在范围内**：

- 批量标签整理（一键关闭全部 Codex 标签 / 只留当前 / 移到独立编辑器组）—— 本次未选入 v1
- 在本插件内渲染会话内容或发送消息（对话交互仍由 Codex 插件自己的编辑器承担）
- 归档 / 删除会话（协议支持，但 v1 不做，避免误删）
- 修改 Codex 插件本身，或向 OpenAI 提 API 需求
- 多 VS Code 窗口之间的会话状态同步
- remote / cloud 会话、非 Linux 平台的二进制定位（v1 只保证 WSL2 + linux-x86_64 路径）

## Constraints

- `[Verified]` 技术栈：TypeScript + VS Code Extension API + esbuild 打包；UI 采用原生 TreeView，不用 webview
- `[Verified]` `engines.vscode` 不低于 `^1.96.2`（与 Codex 插件对齐）
- `[Verified]` 项目目录当前为空且**不是 git 仓库**，需要初始化
- `[Assumption]` 开发机已具备 Node.js + npm/pnpm，可运行 `vsce`/`esbuild`
- `[Assumption]` VS Code Extension Host 可以 spawn 长驻子进程并保持 stdio 管道

## Risks（已与用户确认的取舍）

| 风险 | 说明 | 处置 |
|------|------|------|
| **内部 URI 契约可能失效** | `openai-codex://route/local/<id>` + `chatgpt.conversationEditor` 是从 Codex 插件 bundle 反推的内部契约，非公开 API。Codex 升级后可能改 scheme、路由或 viewType，届时"打开会话"会直接失效 | 用户明确选择**只用内部 URI、不做命令回退**。`[Assumption]` "不回退"指不降级成 `chatgpt.newCodexPanel` 开新会话；打开失败时仍应给出明确错误提示（spec 阶段确认） |
| **打开行为仅经源码推导，未经运行时验证** | `[Inferred]` `vscode.openWith` 路径是读 bundle 得出的结论，尚未在真实 VS Code 中跑通 | spec/build 阶段**第一件事**就是做最小可行验证（在空插件里执行一次 openWith），跑不通则整个变更需重新定位 |
| **app-server 协议为 experimental** | `codex app-server` 在 CLI help 中标注 `[experimental]`，方法签名可能变动 | 依赖 `generate-json-schema` 产出的契约，spec 阶段固化所用字段；只用 `thread/list` 等读接口 + `thread/name/set`，减少暴露面 |
| **二进制路径硬编码** | `bin/linux-x86_64/codex` 随 Codex 插件版本号变化（目录名含版本） | 通过 `vscode.extensions.getExtension('openai.chatgpt').extensionPath` 动态解析，并允许 `chatgpt.cliExecutable` / 本插件配置覆盖 |

## Open Questions（spec 阶段需消解）

## Amendments

### 2026-09-21 — 声明与代码对齐（amend #2，纯文档）

- 原因：verify 闸门 3 的逐条核验发现两条改动点声明的方法名与代码实际标识符不一致（`appServerClient.ts::handleStdoutChunk` 实际为 `consume`、`sessionStore.ts::build` 实际为 `buildSessionGroups`），按 verify 硬规则属「未按设计落地」。
- 处置：**同步声明到代码**（不改代码、不动测试，零行为影响）——`## 现状与影响面` 的改动点 2 / 改动点 5 选择器、§3.3 数据流里的 `SessionStore.build(...)`、改动点 4 的上游引用一并更正；`pins` 入参名同步为实际的 `pinnedIds`。
- 影响：无测试影响（选择器只是文档对账用的声明，不是测试选择器）；已有测试 0 改 0 废。

### 2026-09-21 — 追加「新建会话」入口与分组默认展开

- 原因：verify 阶段用户提出两条新需求（原话：「需要有新建会话」「置顶和已打开默认不要折叠」）
- 摘要：
  - 新增 `codexHelper.newSession` 命令（视图标题栏入口），委派 Codex 自带的 `chatgpt.newCodexPanel` 创建会话面板；失败时报错、不抛回命令层。与 D9「打开既有会话失败时不得回退新建」互补，不冲突（design D12 / 改动点 10）
  - 分组节点的默认折叠状态按组区分：「已打开」「置顶」为展开、「历史」为折叠（design D13 / 改动点 8）
- 验收条件由 7 条增至 9 条：追加第 8、9 条，原有 1–7 条未做任何修改
- 测试影响：已有 38 条测试 0 个需修改、0 个需废弃；新增 4 条（`T-037`~`T-040`），详见 `test-plan.md` 的 `## Amendments`
- 范围外提示：本次未引入「新建会话」的模板/初始 cwd/来源选择等参数，也不改变「打开失败不回退新建」的既有行为

- `[Unknown]` `thread/list` 的分页与返回字段确切形状（limit/cursor/sortKey 语义、是否含 cwd/工作区信息）—— 需从 schema bundle 精读或实调一次
- `[Unknown]` 置顶/收藏是存本插件 `globalState`，还是借 `thread/metadata/update` 写回 Codex
- `[Unknown]` `thread/loaded/list` 返回的"已加载"线程能否与 `tabGroups` 中的标签页一一对账（标签页是否暴露其 URI）
- `[Unknown]` 是否需要按当前工作区过滤历史会话（会话是否记录 cwd）
