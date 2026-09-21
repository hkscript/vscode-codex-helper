# 连点「+」只能开出一个新会话面板

## Why

侧边栏标题栏的 `+`（`codexHelper.newSession`）在已经存在一个**未使用**的新会话面板时，再点没有可见反应：不会多出标签页，也不会报错。[Verified] 根因在上游 Codex 插件（`openai.chatgpt`）而不是本插件：它的 `createNewPanel()` 每次都用**同一个** resource（`openai-codex://route/extension/panel/new`，无 query）调 `vscode.openWith`，而它注册自定义编辑器 provider 时声明了 `supportsMultipleEditorsPerDocument: false`——同一个 resource 的第二次打开在 VS Code 里不是新建标签，而是把已有那个移过去。

本插件当前只是把 `+` 委派给 `chatgpt.newCodexPanel`（`src/commands.ts:79`），因此原样继承了这条限制，用户看到的就是「点了没反应」。

## What Changes

- **新建会话不再委派 `chatgpt.newCodexPanel`**，改为本插件自己用 `vscode.openWith` 打开 Codex 的 new-thread-panel 路由：路径保持 `Codex` 自己的 `/extension/panel/new`，额外带一个**每次点击都不同**的 query（`newPanel=<uuid>`），使每次点击都是一个新 resource、从而真的新开一个标签页。
- `src/codex/conversationUri.ts` 增加 `NEW_PANEL_PATH` 与 `buildNewPanelUri(uriApi, nonce)`，把这条 URI 契约继续收口在同一个模块里（该模块已复刻 Codex 的 scheme / authority / 路由解析，见 `conversationUri.ts:4`）。
- `src/commands.ts` 的 `createNewSessionCommand` 依赖从 `{executeCommand, showErrorMessage}` 变为 `{executeCommand, showErrorMessage, uriApi, createNonce}`，失败仍然只报错、不抛回命令层、不静默回退。
- `src/extension.ts` 接线：注入 `vscode.Uri` 与 `randomUUID`。
- 测试：`test/unit/conversationUri.test.ts` 增加新面板 URI 的编码用例；`test/unit/commands.test.ts` 的 `calls_new_codex_panel_once` 改为断言「两次点击产生两个互不相同的 URI」。
- 文档：README 的「已知限制 / 与 Codex 的耦合」处记录这条复刻契约与失效时的表现。
- 不再需要「打开既有会话失败不得回退新建」以外的任何新约束——新增命令仍是用户显式发起的新建入口，不改变打开失败时的行为。

## Impact

- Affected specs: `codex-session-sidebar`（`新建会话` requirement 修订：Scenario「执行命令时调用 Codex 的新建面板命令」被新的 URI 契约取代）
- Affected code:
  - `src/codex/conversationUri.ts`（新增 `NEW_PANEL_PATH` / `buildNewPanelUri`）
  - `src/commands.ts`（`createNewSessionCommand` 的依赖与实现）
  - `src/extension.ts`（接线 `uriApi` + `createNonce`）
  - `test/unit/conversationUri.test.ts`、`test/unit/commands.test.ts`
  - `README.md`

## Verified Facts

写本提案前的实跑与反查（铁律 1）。证据分两类：本仓库源码（可点击）与**本机已安装的 Codex 插件产物**（`~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64`，压缩过的 bundle，只能给字符偏移）。

| 事实 | 证据 | 确定性 |
|------|------|--------|
| 本插件 `+` 目前不传参数直接委派 `chatgpt.newCodexPanel` | `src/commands.ts:79-86` | `[Verified]` |
| Codex 的 `chatgpt.newCodexPanel` 处理器在无参数时只做两件事：判断 `Te?.source` 是否为推广来源，然后 `dt.createNewPanel()` | `out/extension.js` 偏移 2045402 附近：`registerCommand(CIt,async Te=>{Te?.source===PIt&&…,dt.createNewPanel()})` | `[Verified]` |
| `createNewPanel()` 每次都打开同一个 resource：`pI("/extension/panel/new")`，`viewColumn` 取当前活动文本编辑器或 `Active` | `out/extension.js` 偏移 1840628 附近：`async createNewPanel(){let e=pI("/extension/panel/new"),r=…activeTextEditor?.viewColumn??Ie.ViewColumn.Active;await Ie.commands.executeCommand("vscode.openWith",e,t.customEditorViewType,{viewColumn:r,preserveFocus:!1,preview:!1})}` | `[Verified]` |
| `pI()` 是 `Uri.file(path).with({scheme:'openai-codex',authority:'route',query})`——路径是常量字面量，因此**每次调用的 resource 完全相同** | `out/extension.js` 偏移 1688047 附近：`function pI(t){…return nPe.Uri.file(r).with({scheme:ph,authority:oPe,query:n})}` | `[Verified]` |
| Codex 注册自定义编辑器 provider 时声明 `supportsMultipleEditorsPerDocument: false` | `out/extension.js` 偏移 2045402 附近：`registerCustomEditorProvider(Hd.customEditorViewType,dt,{…},!1)` | `[Verified]` |
| 该标志为 false 时，「同一 resource 再开一次」在 VS Code 里不是新建标签，而是把已有编辑器**移过去**（=用户视角的「没反应」） | `node_modules/@types/vscode/index.d.ts:11404-11406`（官方 API 文档原文） | `[Verified]` |
| Codex 的 webview 把文档 URI 的 `path + query` 当作初始路由：`dI(uri)` 返回 `path: n + (query ? '?'+query : '')`，`resolveCustomEditor` 用 `o.path` 作为 `initialRoute` 注入 `<meta name="initial-route">` | `out/extension.js` 偏移 1688047（`dI`）、1815934（`editorPanels.set(…,{initialRoute:…o.path})`）、1837436（`initialRouteMetaTag`） | `[Verified]` |
| webview 侧读该 meta 并用它做导航：`kst()` 返回 meta 内容，`<Navigate to={初始路由}>`/`useLocation()` 按标准 URL 解析（pathname 与 search 分离），路由表是 `<Route path="/extension/panel/new">`，只按 pathname 匹配 | `webview/assets/app-initial-a190b16fc630.js`（`kst`,`EA`、`k2n` 的 `<Navigate to={o}/>`、`_b({pathname,search})`）、`webview/assets/app-initial-1e5ee25fb4ec.js`（`<Route path="/extension/panel/new">`） | `[Verified]` |
| 本插件的标签扫描对「未绑定会话的新面板」是安全的：`parseConversationId` 只看 `/local/<id>`、`/remote/<id>` 前缀，`/extension/panel/new` 一律得到 `null`，树上仍显示为未命名项 | `src/codex/conversationUri.ts:33-42`、`src/session/openTabs.ts:36-38` | `[Verified]` |
| 上游 Codex 目前只有 VS Code 命令 7 条（`addFileToThread` / `addToThread` / `dumpNuxState` / `implementTodo` / `openCommandMenu` / `openSidebar` / `resetNuxState`）由 `registerCommand` 显式注册；`newChat` / `newCodexPanel` 走另一处注册，二者都**不能**创建第二个空白面板（`newChat` 走侧边栏 webview） | `out/extension.js` 全文 `registerCommand(` 扫描 + 偏移 2045402 的两处注册 | `[Verified]` |

## Open Risks

按铁律 3 先反对自己：

- **本方案依赖 Codex 的 URI 契约**（scheme / authority / 路由字面量 / query 不影响路由匹配）。这才是真正的风险点，而不是「多加一个 query」本身。缓解：契约继续收口在 `conversationUri.ts`，并在 README 写明失效表现（+ 开出空白页或停留在其他路由 → 说明 Codex 改了路由或 query 语义）。`[Assumption]` 尚未在真实 VS Code 里点过带 query 的面板（本环境无法自动驱动 webview），spec 阶段必须把这条列为需要人工点击验证的验收项，不能声称已验证。
- **可能踩到 Codex 对 `new-thread-panel` 路由的 search 解析**。若上游对该路由读取某些 search 参数（如 `projectId` / `hostId`），我们只加一个自有键 `newPanel`，理论上不冲突，但没有上游承诺。`[Inferred]`（依据：`_b()` 只对 thread 路由解析 `projectId`/`hostId`）。
- **是否存在更合适的上游入口**：本机这一版（26.908.40401）里没有。若将来 Codex 提供「多开空白面板」的命令，应当切回委派、删掉这条自造 URI——这条要写进 design 的决策与 lessons，避免后来者以为自造 URI 是长期方案。`[Verified]`（扫过全部 `registerCommand`）。
- **行为变更**：第一次点击的面板从「Codex 自己创建的 `/extension/panel/new`」变成「本插件创建的 `/extension/panel/new?newPanel=<uuid>`」，两者在 Codex 侧等价（同一路由、同一 provider），但标签页的 resource 不再相同——如果上游某处按 resource 精确匹配这个常量 URI（本机版本里 `findPanelByWebview` 按 webview 反查，不按 URI），会有细微差异。`[Assumption]`
