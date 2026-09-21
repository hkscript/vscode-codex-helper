# 设计：连点「+」每次都能新开一个会话面板

## 目标

让 `codexHelper.newSession`（视图标题栏的 `+`）**每次执行都新开一个标签页**，而不是在「已存在一个未使用的新会话面板」时静默无反应；同时保持既有语义：失败只报错、不抛回命令层、不静默回退成别的东西。

## 关键调研结论（改动点依据）

证据分两类：本仓库源码（可点击）与本机已安装的 Codex 插件产物（`~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64`，压缩 bundle，只能给字符偏移）。

| 结论 | 证据 | 确定性 |
|------|------|--------|
| 现在的 `+` 无参数委派 `chatgpt.newCodexPanel` | `src/commands.ts:79-86` | `[Verified]` |
| Codex 的处理器无参数时执行 `dt.createNewPanel()` | bundle 偏移 2045402 附近 | `[Verified]` |
| `createNewPanel()` 的 resource 是**常量**：`pI("/extension/panel/new")`，`pI` = `Uri.file(path).with({scheme:'openai-codex',authority:'route',query})` | bundle 偏移 1840628、1688047 | `[Verified]` |
| Codex 注册自定义编辑器 provider 时 `supportsMultipleEditorsPerDocument: false`；该标志为 false 时同一 resource 再打开是「把已有编辑器移过去」而不是新建标签 | bundle 偏移 2045402 附近；`node_modules/@types/vscode/index.d.ts:11404-11406` | `[Verified]` |
| **因此**：`+` 的第二次点击必然被 VS Code 折叠成对同一个标签的操作——这就是「没反应」的全部原因，与本插件其余逻辑无关 | 上三行合并推出 | `[Verified]` |
| Codex webview 把文档 URI 的 `path + query` 当初始路由：`dI(uri)` 返回 `path: path + (query?'?'+query:'')`，`resolveCustomEditor` 用它做 `initialRoute`，经 `<meta name="initial-route">` 注入 webview | bundle 偏移 1688047、1815934、1837436 | `[Verified]` |
| webview 的路由匹配只看 pathname：路由表是 `<Route path="/extension/panel/new">`，初始路由经 `<Navigate to={原始字符串}/>` / `useLocation()` 按标准 URL 解析（pathname 与 search 分离），`_b({pathname, search})` 对 `/extension/panel/new` 判为 `new-thread-panel` 与 search 无关 | `webview/assets/app-initial-a190b16fc630.js`（`kst`、`EA`、`k2n`、`_b`）；`webview/assets/app-initial-1e5ee25fb4ec.js`（`<Route path="/extension/panel/new">`） | `[Verified]` |
| 本插件的标签扫描只看 `/local/<id>`、`/remote/<id>`，new-panel 路由（含 query）仍解析为 `id: null`，树上继续显示为「未命名的新建项」 | `src/codex/conversationUri.ts:31-42`、`src/session/openTabs.ts:34-38` | `[Verified]` |
| 本机 Codex 版本没有「多开空白面板」的上游入口（显式注册的 VS Code 命令只有 7 条，`newChat` 走侧边栏 webview） | bundle 全文 `registerCommand(` 扫描 + 偏移 2045402 | `[Verified]` |

## 决策

沿用上一变更的决策编号（archive `add-session-running-and-pin-indicators/design.md` 到 D27）。

- **D28：不再委派 `chatgpt.newCodexPanel`，改为本插件自己打开 new-panel 路由，并在 query 上带一个本次调用独有的 nonce。** 这是「同一 resource 只能有一个编辑器」的唯一可行绕法：换 resource 才能换标签；换 path 会让路由失配，只有 query 既能区分 resource、又不影响路由匹配（见上表）。
- **D29：query 键固定为 `newPanel`，值由注入的 `createNonce()` 提供（生产用 `crypto.randomUUID()`）。** 用注入而不是模块内直接调 `randomUUID`，是为了让「两次点击得到两个不同 URI」这条正是不变量能在单测里被钉死——它是这次 bug 的核心，不能被测试盲区放过。
- **D30：失败只报错，不回退委派、不静默重试。** 与 D12/既有 `opener.ts` 的失败语义一致：静默换成另一个入口会让用户以为「新建成功」，而实际打开的东西可能不是他要的。
- **D31：URI 契约继续收口在 `src/codex/conversationUri.ts`。** 该模块已经复刻了 Codex 的 scheme / authority / 会话路径解析（`conversationUri.ts:4-7` 注释即此约定），new-panel 路由没有理由另开一处。
- **D32（放弃的方案）：先 `chatgpt.newCodexPanel` 一次，之后用自造 URI。** 放弃理由：让「第一次点击的面板」和「第二次之后的面板」属于两套来源，URI 形态不一致；而当上游将来提供多开能力时，要删的是一整块分支而不是一个函数。行为简单可预期优先。

## 现状与影响面

### 改动点 1：新增 new-panel URI 构造

- 目标：`src/codex/conversationUri.ts::buildNewPanelUri`
- 并行路径：`src/codex/conversationUri.ts::buildConversationUri` → 不随改（打开既有会话的 resource 必须保持「每个会话一个 URI」的既有语义，与本变更无关）

上游：`src/commands.ts::createNewSessionCommand`（唯一调用方）。下游：`vscode.openWith` 的第一个参数。
链路末端：VS Code 的自定义编辑器 resource 身份——**这正是本次 bug 的链路末端**：资源的粒度决定标签页数量。新增的 `NEW_PANEL_PATH = '/extension/panel/new'` 让 resource 的 path 与 Codex 自己的常量逐字一致，只在 query 上做区分，因此链路末端从「一个常量 resource」变成「每次调用一个 resource」。
`[Verified]` 目标文件存在且已复刻 Codex 的 URI 契约：`src/codex/conversationUri.ts:1-42`。

### 改动点 2：新建会话命令改为自建 URI

- 目标：`src/commands.ts::createNewSessionCommand`
- 并行路径：`src/session/opener.ts::openSession` → 不随改（打开既有会话失败时**不得**回退新建，是上一变更守住的语义；本变更不碰它）

上游：`src/extension.ts::activate` 里注册的 `codexHelper.newSession` 处理器；下游：`vscode.commands.executeCommand('vscode.openWith', uri, 'chatgpt.conversationEditor', {preview: false})`。
失败路径的处理与现在一致：捕获后 `showErrorMessage('新建会话失败：<原因>')`，命令本身 resolve。
`[Verified]` 现状实现与测试分别在 `src/commands.ts:67-86`、`test/unit/commands.test.ts:58-90`。

### 改动点 3：接线注入 `uriApi` 与 `createNonce`

- 目标：`src/extension.ts::activate`

上游：VS Code 扩展激活。下游：`createNewSessionCommand` 的依赖对象。
`[Verified]` 现状接线在 `src/extension.ts:143-147`；`vscode.Uri` 已在同文件 `:135`（`opener`）注入过，`randomUUID` 来自 `node:crypto`（`src/extension.ts:1-2` 已在用 `node:` 前缀的内置模块）。

### 生产链路影响表

| 影响面 | 上游/调用方 | 下游/消费方 | 链路末端 | 粒度是否一致 |
|--------|-------------|-------------|----------|--------------|
| new-panel 标签页 | `codexHelper.newSession` 命令（视图标题栏 `+`） | VS Code 自定义编辑器 → Codex webview | 每个 resource 一个编辑器 | ✅ 一致：一次命令 = 一个 resource = 一个标签 |
| 树上「未命名新建项」 | `scanCodexTabs` 扫 `tabGroups` | `buildSessionGroups` → 树节点 | 会话 id 为 `null` 的合成节点 | ✅ 不变：new-panel 路由解析仍为 `null`，多开只会多出多行未命名项 |
| Codex 侧的「未绑定会话」状态 | Codex 自己的 `resolveCustomEditor` | Codex 的 `editorPanels` 映射（按 panel 实例） | 每个 editor 实例一条记录 | ✅ 一致：Codex 按面板实例记账，不按 URI 去重 |

### 10 类 checklist 逐类排查

| 类别 | 结论 | 证据 |
|------|------|------|
| 查询/数据加载粒度 | 不涉及（本命令不发 app-server 请求） | `src/commands.ts:79-86` 无 threadApi 依赖 |
| 本地状态/缓存键 | 不涉及（本插件没有以 URI 为键的缓存） | `src/session/pinStore.ts` 以会话 id 为键 |
| 状态隔离/并发 | **有影响且已评估**：多次点击各自独立 resource，互不覆盖 | `supportsMultipleEditorsPerDocument` 语义（`@types/vscode/index.d.ts:11404`） |
| 数据流/副作用 | 副作用仅「打开一个编辑器」，与现在同类 | `src/session/opener.ts` 同款调用 |
| 接口契约 | 复刻 Codex URI 契约：scheme `openai-codex` + authority `route` + path `/extension/panel/new` + query | bundle 偏移 1688047（`pI`/`dI`） |
| 数据结构/存储格式 | 不涉及持久化；仅 VS Code 自己会记住打开的标签 | — |
| 依赖/调用方 | 唯一调用方是 `extension.ts` 的注册处；无其他调用方 | `grep -rn "createNewSessionCommand" src test` |
| 性能/资源 | 每次点击多一个标签页 = 多一个 webview，这是用户主动要求的语义 | — |
| 错误/边界处理 | `openWith` 抛错（viewType 未注册 / Codex 未安装）→ 报错不抛异常；nonce 为空字符串是注入方的问题，不影响 resource 唯一性之外的语义 | `test/unit/commands.test.ts` 既有失败用例 |
| 兼容/迁移 | 旧标签（无 query 的 `/extension/panel/new`）与新标签共存不冲突（不同 resource） | `@types/vscode/index.d.ts:11404` |

### 并行路径排查

- 同文件同前缀兄弟方法：`conversationUri.ts` 里 `buildConversationUri` 与新 `buildNewPanelUri` 同前缀，已在上文逐条声明（`不随改`）。
- 命名不同但逻辑对等的并行路径：`src/session/opener.ts::openSession` 是「打开既有会话」的另一条 `vscode.openWith` 路径，已声明为 `不随改`。
- 上游 Codex 侧的并行入口 `chatgpt.newChat`（打开侧边栏新会话）**不采用**：它进的是侧边栏 webview 而不是编辑器标签，与 `+` 的既有语义不符；本插件不改它、也不调用它。

## 改动文件

- `src/codex/conversationUri.ts` [Verified]
- `src/commands.ts` [Verified]
- `src/extension.ts` [Verified]
- `test/unit/conversationUri.test.ts` [Verified]
- `test/unit/commands.test.ts` [Verified]
- `README.md` [Verified]

## 边界条件与风险

| 边界 | 预期行为 | 状态 |
|------|----------|------|
| 连续点击 N 次 | N 个不同 resource → N 个标签页 | 由 T-003 钉住（N=2） |
| Codex 未安装 / viewType 未注册 → `openWith` reject | 报错消息含原因，命令 resolve | 由 T-004 钉住 |
| 新面板 URI 进入标签扫描 | `id: null`，树上多一行未命名项 | 由 T-005 钉住 |
| 用户手动关掉某个空白面板后再点 `+` | 新 nonce → 仍是新标签（不会复用到已关闭的 resource） | `[Inferred]`（resource 由 nonce 决定，与已关闭标签无关） |

**仍然存在、且必须在验收里人工确认的风险**：带 query 的 new-panel 路由**在真实 VS Code 里是否能正常渲染成空白新会话面板**，本环境无法自动驱动 webview，只能靠人工点击验证（见 test-plan 的「人工验收」节）。若这一步失败，症状是「`+` 开出一个空白/异常页面」，此时应当退回委派方案并在 README 记录上游限制。
