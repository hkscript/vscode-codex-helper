# 设计：Codex Session Sidebar

## 背景与目标

Codex VS Code 插件（`openai.chatgpt`）把每个 Agent 会话渲染成一个 custom editor 标签页，会话一多标签栏就不可用。本变更新建伴生插件 `vscode-codex-helper`，用一个原生 TreeView 侧边栏接管「浏览 / 搜索 / 打开 / 聚焦 / 重命名 / 置顶」，标签页本身仍由 Codex 插件渲染。

**本插件不复制 Codex 的会话 UI，只做导航层。**

## 关键调研结论（全部有证据）

### 2.1 Codex 插件对外接口

| 事实 | 证据 | 确定性 |
|------|------|--------|
| 插件 ID `openai.chatgpt`，版本 26.908.40401，`engines.vscode: ^1.96.2` | `~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64/package.json` | `[Verified]` |
| 公开命令只有 10 个，会话相关仅 `chatgpt.newCodexPanel` / `chatgpt.openSidebar` / `chatgpt.newChat`，**没有按 id 打开历史会话的命令** | 同上 `contributes.commands` | `[Verified]` |
| `chatgpt.newCodexPanel` 的实现是 `dt.createNewPanel()`，只接受 `{source}` 参数，不接受会话 id | `out/extension.js`，`registerCommand(CIt, async Te=>{…createNewPanel()})` | `[Verified]` |
| 会话面板是 custom editor，viewType `chatgpt.conversationEditor` | `out/extension.js`：`static customEditorViewType="chatgpt.conversationEditor"`，`registerCustomEditorProvider(Hd.customEditorViewType, dt, {…, supportsMultipleEditorsPerDocument:!1})` | `[Verified]` |
| 会话 URI = `scheme=openai-codex`、`authority=route`、`path=/local/<conversationId>` | `out/extension.js`：`ph="openai-codex"`、`oPe="route"`、`pI(t)`、`iPe(t)=pI('/local/'+t)` | `[Verified]` |
| `resolveCustomEditor` **显式支持 `/local/<id>` 路由**：解析出 `conversationId`，拉取会话摘要设置标题，并把 `initialRoute` 设为该路径 | `out/extension.js`：`async resolveCustomEditor(e,r,n){let o=dI(e.uri); … initialRoute: i==null\|\|o.path.startsWith("/local/")?o.path:\`/local/${i}\`}` | `[Verified]` |
| `supportsMultipleEditorsPerDocument: false` ⇒ 同一 URI 再次 `openWith` 复用既有编辑器而不是开第二个 | 同上注册参数 | `[Inferred]`（VS Code 语义，需 spike 实测） |
| Codex 自己的二进制解析顺序是「`chatgpt.cliExecutable` 配置 → `<extensionUri>/bin/<os>-<arch>/codex`」 | `out/extension.js`：`function yI(t,e){let r=mn("cliExecutable");if(r&&r.trim().length>0)return r;let n=fh(e),o=(e??process.platform)==="win32"?"codex.exe":"codex";return Uri.joinPath(t,\`${n}/${o}\`).fsPath}` | `[Verified]` |
| 平台目录映射 `fh()`：os 取 `win32→windows` / `darwin→macos` / `linux·aix·android·freebsd·haiku·openbsd·sunos·cygwin·netbsd→linux`；arch 取 `x64→x86_64` / `arm64→aarch64`，其余抛错 | `out/extension.js` 中 `function fh(t){…return \`bin/${e}-${r}\`}` | `[Verified]` |

**结论**：`vscode.openWith(Uri.parse('openai-codex://route/local/<id>'), 'chatgpt.conversationEditor')` 不是"碰运气的 hack"，而是 Codex 自己 `resolveCustomEditor` 里写死支持的路由分支。风险仍在于它是内部契约而非公开 API。

### 2.2 会话数据源：codex app-server

| 事实 | 证据 | 确定性 |
|------|------|--------|
| Codex 插件随包分发 codex 二进制：`<codexExt>/bin/linux-x86_64/codex` | `ls` 该目录 | `[Verified]` |
| `codex app-server proxy` **依赖已运行的 daemon**，socket 在 `~/.codex/app-server-control/app-server-control.sock`；未运行时直接报 `failed to connect to socket` | 实跑 probe，stderr 原文 | `[Verified]` |
| `codex app-server`（不带子命令）在 **stdio 上跑一个独立 app-server**，协议是 NDJSON（每行一条 JSON-RPC 消息） | 实跑 probe 成功完成 initialize + 3 次请求 | `[Verified]` |
| `initialize` 握手：`params = {clientInfo:{name,version}}`，返回 `{userAgent, codexHome, platformFamily, platformOs}` | probe 实测返回 `{"userAgent":"…","codexHome":"/home/hk/.codex",…}` | `[Verified]` |
| `thread/list` 参数：`limit / cursor / sortKey / sortDirection / archived / searchTerm / cwd / sourceKinds / modelProviders / sectionId / originators / useStateDbOnly`，全部可选 | `codex app-server generate-json-schema` 产出的 `ThreadListParams` | `[Verified]` |
| `sortKey` 枚举：`created_at / updated_at / recency_at / section_position`；`sortDirection` 默认 descending | `ThreadSortKey` / `ThreadListParams.sortDirection` | `[Verified]` |
| `thread/list` 返回 `{data: Thread[], nextCursor, backwardsCursor}` | `ThreadListResponse` + probe 实测 | `[Verified]` |
| `Thread` 必含 `id / preview / cwd / createdAt / updatedAt / modelProvider / source / status / sessionId / turns / cliVersion / ephemeral / projectId`，可选 `name / model / recencyAt / path / …` | `Thread` schema + probe 实测样本 | `[Verified]` |
| `searchTerm` 是**服务端**对"提取出的会话标题"做子串过滤 | `ThreadListParams.searchTerm` 描述 + probe 实测（传 `VSCode` 命中 1 条） | `[Verified]` |
| `source` 可区分会话来源（probe 样本里 VS Code 会话为 `"vscode"`） | probe 实测 | `[Verified]` |
| `thread/loaded/list` 返回 `{data: string[], nextCursor}`——当前**内存中已加载**的 thread id | `ThreadLoadedListResponse` + probe 实测返回 `{"data":[],"nextCursor":null}` | `[Verified]` |
| `thread/name/set` 参数 `{threadId, name}`，返回空对象——**重命名写回 Codex** | `ThreadSetNameParams` / `ThreadSetNameResponse` | `[Verified]` |
| `thread/metadata/update` **只能 patch `gitInfo`**，无法存放置顶/收藏 | `ThreadMetadataUpdateParams` 只有 `threadId` + `gitInfo` | `[Verified]` |

### 2.3 VS Code API

| 事实 | 证据 | 确定性 |
|------|------|--------|
| `TabInputCustom` 暴露 `uri: Uri` 与 `viewType: string`，可用于识别 Codex 标签页 | `vscode.d.ts:18001-18015` | `[Verified]` |
| 本机 VS Code 1.126.0，Node 20.20.2，pnpm 可用 | `code --version` / `node --version` / `which pnpm` | `[Verified]` |
| `TabInputCustom.viewType` 原样返回注册时的 viewType（不带 `mainThreadWebview-` 前缀） | —— | `[Assumption]`（spike 实测确认） |

## 架构

```
                    ┌──────────────── vscode-codex-helper ────────────────┐
                    │                                                     │
 Activity Bar  ───► │  CodexSessionTreeProvider (TreeDataProvider)        │
                    │        ▲                    ▲                       │
                    │        │ SessionItem[]      │ 命令                  │
                    │   SessionStore ◄────────────┴── commands.ts         │
                    │    ▲     ▲      ▲                                   │
                    │    │     │      └── PinStore (globalState)          │
                    │    │     └───────── OpenTabScanner (tabGroups)      │
                    │    └─────────────── ThreadApi                       │
                    │                       └── AppServerClient           │
                    └───────────────────────────┬─────────────────────────┘
                                                │ spawn + NDJSON JSON-RPC
                                     `codex app-server` (子进程)
                                                │
                         ┌──────────────────────┴───────────────┐
             SessionOpener ── vscode.openWith ──► Codex 插件的 conversationEditor
```

### 3.1 模块职责

| 模块 | 职责 | 依赖 vscode API？ |
|------|------|-------------------|
| `src/codex/binary.ts` | 解析 codex 可执行文件路径（`codexHelper.codexExecutable` → `chatgpt.cliExecutable` → Codex 插件目录 → 报错），含平台目录映射 | 是（`extensions.getExtension`、`workspace.getConfiguration`） |
| `src/codex/appServerClient.ts` | spawn 子进程、NDJSON 分帧、`initialize` 握手、请求/响应路由、超时、dispose | 否（纯 Node，便于单测） |
| `src/codex/threadApi.ts` | `listThreads` / `listLoadedThreadIds` / `setThreadName` 的类型化封装 | 否 |
| `src/codex/conversationUri.ts` | `buildConversationUri(id)` / `parseConversationId(uri)` | 仅 `Uri`（可注入） |
| `src/session/pinStore.ts` | 置顶集合的读写（`Memento`） | 仅 `Memento` 接口（可注入 fake） |
| `src/session/openTabs.ts` | 从 `tabGroups` 提取已打开的 Codex 会话 id | 是（可注入 tabGroups 快照） |
| `src/session/sessionStore.ts` | 合并 thread 列表 + 已打开 id + 置顶集合 + 关键词 → 分组后的 `SessionItem[]` | 否（纯函数，核心逻辑） |
| `src/session/opener.ts` | `openSession(id)` → `executeCommand('vscode.openWith', …)` | 是（可注入 executeCommand） |
| `src/ui/treeProvider.ts` | `TreeDataProvider` 实现：分组节点、会话节点、错误节点、加载更多节点 | 是 |
| `src/commands.ts` | 注册全部命令，串联上述模块 | 是 |
| `src/extension.ts` | `activate` / `deactivate` 装配 | 是 |

**可测试性原则**：所有业务判定（分组、去重、排序、过滤、分帧、参数构造）放进不依赖 `vscode` 运行时的纯模块；触碰 vscode API 的部分只做薄转发，用注入的 fake 单测。

### 3.2 关键设计决策

| # | 决策 | 理由 | 被否决的方案 |
|---|------|------|--------------|
| D1 | 用 `codex app-server`（自起子进程）而非 `app-server proxy` | proxy 需要已运行的 daemon，实测未运行时直接失败；自起进程无外部前置条件 | `app-server proxy`：依赖 daemon 生命周期，不可控 |
| D2 | NDJSON 逐行解析，不用 Content-Length 分帧 | probe 实测服务端就是按行输出 | LSP 风格 header 分帧：与实测不符 |
| D3 | 懒启动：首次需要数据时才 spawn，`deactivate` 时 kill | 避免每个窗口常驻一个大进程；v1 不做空闲回收（定时器 + 竞态成本高于收益） | 激活即启动；空闲自动回收（列入后续工作） |
| D4 | 「打开」与「聚焦」走同一条 `openWith` 调用 | Codex 注册时 `supportsMultipleEditorsPerDocument:false`，同 URI 复用既有编辑器 | 单独实现 focus 逻辑：VS Code 没有直接 focus tab 的 API |
| D5 | 置顶存本插件 `globalState` | `thread/metadata/update` 只能改 `gitInfo`，协议层没有可用的自定义元数据位 | 写回 Codex：协议不支持 |
| D6 | 重命名走 `thread/name/set`，写回 Codex | 协议原生支持，改名对 Codex 自身 UI 同样可见 | 本地别名：会与 Codex 显示的名字分叉 |
| D7 | 关键词过滤**双层**：向服务端传 `searchTerm` 扩大召回，本地再用同一 `matchesFilter` 统一判定所有分组 | 已打开/置顶分组不走 `thread/list`，必须本地过滤；统一判定才能保证「过滤后每一项都匹配」这条不变量 | 纯本地过滤：搜不到未加载的历史。纯服务端过滤：已打开/置顶组不受控 |
| D8 | 分组优先级 已打开 > 置顶 > 历史，一个会话只出现一次；**置顶列表不是会话来源**——只被置顶而服务端与标签页都查无此人的 id 直接丢弃 | 避免同一会话在树里出现两遍造成状态歧义；避免删除会话后留下点不开的幽灵条目 | 允许重复出现：点击行为与未读标记会分叉。以 pin 列表为来源：会造出幽灵条目 |
| D9 | 打开失败不降级为新建会话，只弹错误 | 用户显式决策；静默开一个空会话比失败更有害 | 回退 `chatgpt.newCodexPanel`：假装成功 |
| D10 | 排序用 `sortKey: 'updated_at'` + 默认降序 | 与「最近用过的排前面」直觉一致；`created_at` 是服务端默认但不符合需求 | 本地排序：无法跨分页正确排序 |
| D11 | 二进制解析**复刻 Codex 自己的 `yI()` + `fh()`**，并在最前面插入本插件自己的 `codexHelper.codexExecutable` | 与 Codex 行为一致，用户为 Codex 配过的 `chatgpt.cliExecutable` 自动生效；平台映射是同一段逻辑，写死 `linux-x86_64` 并不更省事却更脆 | 硬编码 `bin/linux-x86_64`：换机器/换架构即失效 |
| D12 | 「新建会话」直接委派给 Codex 的 `chatgpt.newCodexPanel`（无参调用），本插件不自建面板、也不重复触发刷新 | 新建面板是 Codex 自己的职责，我们只提供入口；`extension.ts` 已订阅 `onDidChangeTabs`，新标签出现会自动刷新树，命令里再刷新一次就是双刷 | `chatgpt.newChat`：走 webview 侧的新建聊天，语义与「新建 Codex 会话面板」不同（Codex 自己的标题栏按钮用的是 `newCodexPanel`）。本插件 `createTreeView` 之外自建 webview 面板：与 Codex 的会话管理分叉 |
| D13 | 分组节点的默认折叠状态按组区分：「已打开」「置顶」为 `Expanded`，「历史」为 `Collapsed` | 用户最关心「正在用的」与「钉住的」，这两组通常只有个位数；历史是长尾，默认收起才不至于把树撑爆 | 全部分组折叠：每次都要手动展开，常用路径多一次点击。全部分组展开：历史动辄几十条，首屏噪音压倒有效信息 |

### 3.3 数据流

```
refresh()
  ├─ ThreadApi.listThreads({limit, sortKey:'updated_at', archived:false,
  │                         searchTerm?, cwd?, cursor?})        → Thread[]
  ├─ ThreadApi.listLoadedThreadIds()                            → string[]（仅用于状态标记）
  ├─ OpenTabScanner.scan(tabGroups)                             → OpenTab[]{id, tabLabel}
  ├─ PinStore.list()                                            → string[]
  └─ SessionStore.buildSessionGroups({threads, openTabs, pinnedIds, filter}) → SessionGroup[]
         ├─ 已打开：openTabs ∩ 已知 thread（未知 id 也保留，用 tab 标签兜底）
         ├─ 置顶  ：pins − 已打开
         └─ 历史  ：threads − 已打开 − 置顶
```

### 3.4 配置项

| key | 类型 | 默认 | 说明 |
|-----|------|------|------|
| `codexHelper.codexExecutable` | string | `""` | 覆盖 codex 可执行文件路径；空则回退到 `chatgpt.cliExecutable`，再空则从 Codex 插件目录按平台解析 |
| `codexHelper.pageSize` | number | `50` | `thread/list` 每页条数 |
| `codexHelper.filterByWorkspaceCwd` | boolean | `false` | 为 true 时把当前工作区路径作为 `cwd` 过滤传给服务端 |
| `codexHelper.autoRefreshSeconds` | number | `0` | `>0` 时按该间隔自动刷新；`0` 关闭 |

### 3.5 命令

| command | 标题 | 入口 |
|---------|------|------|
| `codexHelper.refresh` | Codex: 刷新会话列表 | 视图标题栏 |
| `codexHelper.openSession` | Codex: 打开会话 | 树节点点击 |
| `codexHelper.renameSession` | Codex: 重命名会话 | 右键 |
| `codexHelper.pinSession` / `codexHelper.unpinSession` | Codex: 置顶 / 取消置顶 | 右键 |
| `codexHelper.setFilter` / `codexHelper.clearFilter` | Codex: 过滤会话 / 清除过滤 | 视图标题栏 |
| `codexHelper.loadMore` | Codex: 加载更多 | 历史组末尾节点 |
| `codexHelper.newSession` | Codex: 新建会话 | 视图标题栏 |

## 现状与影响面

本变更是**全新工程**：`/home/hk/github/vscode-codex-helper` 在本设计成稿时除 `openspec/`、`.claude/`、`.agents/`（`openspec init` 生成）外为空。

（2026-09-21 amend 更正：build 期间已 `git init` 并在 `master` 上按 task 逐个提交，原文「不是 git 仓库 `[Verified]`」已过期——如今仓库历史本身就是本变更，这也是闸门 3 的基准分支探测（`git diff <base>...HEAD`）拿不到变更集、21 条改动点 warning 全为空转的原因，详见 `verify-issues.md`。）

因此不存在"上游调用方 / 下游消费方 / 并行路径"意义上的存量链路——**所有改动点都是新建文件**，声明中的选择器指向本变更创建的文件与方法（build 后已落盘）。

外部影响面分析的对象是**被依赖的两个外部系统**：Codex 插件与 codex app-server。

### 改动点 1：codex 可执行文件定位
- 目标：`src/codex/binary.ts::resolveCodexBinary`
- 目标：`src/codex/binary.ts::resolvePlatformBinDir`

上游：`AppServerClient.start()` 调用。下游：`child_process.spawn` 的第一个参数。
链路末端：子进程启动成功/失败。解析顺序为 `codexHelper.codexExecutable` → `chatgpt.cliExecutable` → `extensions.getExtension('openai.chatgpt').extensionPath + /bin/<os>-<arch>/<codex|codex.exe>` → 抛错。
`[Verified]` 目标路径存在：`~/.vscode-server/extensions/openai.chatgpt-26.908.40401-linux-x64/bin/linux-x86_64/codex`。
`[Verified]` 目录名含版本号，因此**必须**用 `extensionPath` 动态解析，不能硬编码。
`[Verified]` `resolvePlatformBinDir` 复刻 Codex 的 `fh()` 映射（见 §关键调研结论表）；本变更只在 `linux-x86_64` 上实测，其他平台是等价移植、未实测。

### 改动点 2：app-server JSON-RPC 客户端
- 目标：`src/codex/appServerClient.ts::start`
- 目标：`src/codex/appServerClient.ts::request`
- 目标：`src/codex/appServerClient.ts::consume`
- 目标：`src/codex/appServerClient.ts::dispose`

上游：`ThreadApi` 的三个方法。下游：codex 子进程 stdin/stdout。
链路末端：子进程生命周期 + 在途请求的 Promise。
`[Verified]` 分帧格式为 NDJSON；`[Verified]` 必须先 `initialize` 才能发业务请求；`[Verified]` 服务端会主动推 `configWarning`、`remoteControl/status/changed` 等**无 id 的通知**，分帧器必须忽略它们而不能当成响应。
并发/隔离：请求 id 自增，`Map<string, resolver>` 路由；`dispose` 必须 reject 所有在途请求，否则调用方永久挂起。

### 改动点 3：会话 URI 编解码
- 目标：`src/codex/conversationUri.ts::buildConversationUri`
- 目标：`src/codex/conversationUri.ts::parseConversationId`

`[Verified]` 编码规则必须与 Codex 的 `pI()` 完全一致：`Uri.file('/local/<id>').with({scheme:'openai-codex', authority:'route'})`。
`[Verified]` 解码规则对齐 Codex 的 `dI()`：scheme 必须是 `openai-codex`、authority 必须是 `route`、path 去掉前导 `/` 后按 `/` 切分，`[0]` 为 `local` 或 `remote` 时 `[1]` 即 conversationId；任一不满足返回 `null`。
接口契约：这是与 Codex 插件之间**唯一的隐式契约**，是本变更最大的破坏性风险点（见 §6）。

### 改动点 4：已打开标签页扫描
- 目标：`src/session/openTabs.ts::scanCodexTabs`

上游：`SessionStore.buildSessionGroups` 与 `onDidChangeTabs` 事件。下游：树的「已打开」分组。
`[Verified]` 判定条件：`tab.input instanceof TabInputCustom && input.viewType === 'chatgpt.conversationEditor'`，再用 `parseConversationId(input.uri)` 取 id。
边界：解析不出 id（如 `/extension/panel/new` 尚未落到具体会话）的标签必须保留为「未命名新会话」而不是丢弃，否则用户刚新建的标签在树里消失。

### 改动点 5：会话合并与分组
- 目标：`src/session/sessionStore.ts::buildSessionGroups`
- 目标：`src/session/sessionStore.ts::matchesFilter`

上游：`refresh()`。下游：`CodexSessionTreeProvider.getChildren`。
状态隔离：三分组互斥，优先级 已打开 > 置顶 > 历史（D8）。
数据结构：`SessionItem { id, label, preview, cwd, updatedAt, pinned, openTabState }`。
这是本变更唯一的**多条件组合**逻辑（打开 × 置顶 × 匹配关键词 × 是否在 thread 列表中），必须有不变量测试（见 test-plan 的 `INV-001` / `INV-002`）。

**会话来源规则**：一个会话只要 `inThreadList` 或 `hasOpenTab` 任一为真就算「存在」。**只被置顶、但既不在服务端列表也没有标签页的 id 是陈旧置顶，必须丢弃**，不能凭 pin 列表凭空造出条目。

#### 状态叉乘矩阵（hasOpenTab × pinned × inThreadList × matchesFilter）

| # | hasOpenTab | pinned | inThreadList | matchesFilter | 预期 | 覆盖 T-id |
|---|---|---|---|---|------|-----------|
| 1 | Y | Y | Y | Y | 已打开组 | T-028 |
| 2 | Y | Y | Y | N | 不显示 | INV-002 |
| 3 | Y | Y | N | Y | 已打开组 | INV-001 |
| 4 | Y | Y | N | N | 不显示 | INV-002 |
| 5 | Y | N | Y | Y | 已打开组 | T-027 |
| 6 | Y | N | Y | N | 不显示 | INV-002 |
| 7 | Y | N | N | Y | 已打开组（新建未绑定 / 服务端未收录） | T-036 |
| 8 | Y | N | N | N | 不显示 | INV-002 |
| 9 | N | Y | Y | Y | 置顶组 | T-027 |
| 10 | N | Y | Y | N | 不显示 | INV-002 |
| 11 | N | Y | N | Y | **不显示**（陈旧置顶） | T-035 |
| 12 | N | Y | N | N | 不显示 | T-035 + INV-002 |
| 13 | N | N | Y | Y | 历史组 | T-027 |
| 14 | N | N | Y | N | 不显示 | T-030 |
| 15 | N | N | N | Y | 不可达：三个来源都为假的 id 不会进入 `build` 的输入 | — |
| 16 | N | N | N | N | 不可达：同上 | — |

第 11/12 行是这张矩阵新暴露出来的行为——仅靠 `INV-001`（至多出现一次）和 `INV-002`（显示的都匹配）都无法证伪一个幽灵条目，所以必须有 `T-035` 显式钉住。

**未命名新建标签（`id === null`）**是 `hasOpenTab=Y` 的子情形，不构成新维度（对应矩阵第 3、7 行）。差别只在 id 为空，因此实现用合成 id `open-tab:<index>` 保证"恰好出现一次"仍成立——这条由 `T-039` 显式钉住（两个 `id` 均为 `null` 的标签必须各占一项、不互相覆盖）。新增的「新建会话」入口把这条路径从边角提到了主路径，所以它从"顺带被覆盖"升级为独立 scenario；矩阵本身不新增列。

### 改动点 6：会话打开
- 目标：`src/session/opener.ts::openSession`

下游：Codex 插件的 `resolveCustomEditor`。
链路末端：编辑器标签页。
`[Verified]` 调用形态：`executeCommand('vscode.openWith', uri, 'chatgpt.conversationEditor', {preview:false, viewColumn})`。
错误处理：`executeCommand` reject 时展示错误消息，**不**回退到 `chatgpt.newCodexPanel`（D9）。

### 改动点 7：置顶存储
- 目标：`src/session/pinStore.ts::pin`
- 目标：`src/session/pinStore.ts::unpin`
- 目标：`src/session/pinStore.ts::list`

存储格式：`globalState` 下 key `codexHelper.pinnedSessionIds`，值为 `string[]`。
兼容/迁移：首次读取为 `undefined` 时返回空数组。

### 改动点 8：树视图
- 目标：`src/ui/treeProvider.ts::getChildren`
- 目标：`src/ui/treeProvider.ts::getTreeItem`
- 目标：`src/ui/treeProvider.ts::refresh`

下游：VS Code 树渲染。
错误/边界：数据加载失败时 `getChildren` 返回单个错误节点（带重试 command），不得返回空数组——空数组在 UI 上与「没有会话」无法区分。
空分组不渲染分组节点。
`getTreeItem` 对分组节点按组给出**默认**折叠状态：「已打开」「置顶」为 `Expanded`，「历史」为 `Collapsed`（D13）。这是"默认值"而非"每次刷新强制展开"——用户手动折叠/展开后的状态由 VS Code 按 `TreeItem.id` 自行记忆，本插件不做程序化重置（`[Inferred]` VS Code 语义，不写测试钉它）。

### 改动点 9：命令注册与装配
- 目标：`src/commands.ts::registerCommands`
- 目标：`src/extension.ts::activate`
- 目标：`src/extension.ts::deactivate`

`deactivate` 必须 dispose `AppServerClient`，否则子进程泄漏。

### 改动点 10：新建会话命令
- 目标：`src/commands.ts::createNewSessionCommand`
- 目标：`src/extension.ts::activate`

上游：视图标题栏按钮（`package.json` 的 `menus.view/title`）。
下游：Codex 插件的 `chatgpt.newCodexPanel` 命令 → 新建的会话面板标签页。
链路末端：新标签页出现 → `onDidChangeTabs` → `provider.refresh()` → 尚未绑定会话的标签以未命名项落入「已打开」组（该分支由改动点 4/5 已有逻辑承担，见改动点 5 的矩阵说明）。
`[Verified]` Codex 的 handler 形如 `registerCommand("chatgpt.newCodexPanel", async Te=>{Te?.source===…, dt.createNewPanel()})`（`out/extension.js`）——参数用了可选链，**无参调用安全**；我们不传 `{source}`，以免误触发它自己的推广/登录标记分支。
错误处理：`executeCommand` reject 时展示错误消息，**不**把异常抛回命令层；**不**自行新建面板或静默重试。
与 D9 的关系：D9 约束「打开既有会话失败时不得回退成新建」；本改动点是用户显式的新建入口，两者互补而非矛盾（spec 的「新建会话」requirement 里也写了这句）。
不改动 `sessionStore` / `openTabs` 的任何判定——未命名标签的处理沿用改动点 4/5 的既有分支（T-039 把它显式钉住）。

### 10 类 checklist 排查

| 类别 | 结论 |
|------|------|
| 查询/数据加载粒度 | 分页加载（`limit` + `nextCursor`），非一次性全量；`loadMore` 追加而非替换 |
| 本地状态/缓存键 | 仅 `globalState['codexHelper.pinnedSessionIds']` 一个键；粒度为会话 id，与列表粒度一致 |
| 状态隔离/并发 | 并发 `refresh` 用单飞（in-flight 复用）避免重复 spawn；请求 id 自增保证响应不串 |
| 数据流/副作用 | 唯一写操作是 `thread/name/set`（写回 Codex）与 pin 写 `globalState`；新建会话是「委派」给 Codex 的 `chatgpt.newCodexPanel`（本插件不自己落盘、不改 Codex 状态）；其余全是读 |
| 接口契约 | 两处外部契约：app-server JSON-RPC（有生成的 schema，较稳）、`openai-codex://` URI + viewType（内部契约，不稳） |
| 数据结构/存储格式 | pin 列表是纯 `string[]`，未来加字段需迁移——v1 先接受 |
| 依赖/调用方 | `extensionDependencies: ["openai.chatgpt"]`；Codex 被禁用时 `getExtension` 返回 `undefined` → 错误节点 |
| 性能/资源 | 每窗口一个 codex 子进程（二进制 250 MB）；懒启动，`deactivate` 回收；自动刷新默认关闭 |
| 错误/边界处理 | 二进制缺失、spawn 失败、initialize 超时、RPC error、openWith 失败——五条路径都必须可见 |
| 兼容/迁移 | Codex 升级可能改 URI 契约；`engines.vscode ^1.96.2` 与 Codex 对齐 |

### 并行路径排查

全新工程，不存在 `New`/`Old`/`V2` 并行实现，也不存在命名不同但逻辑对等的既有路径 `[Verified]`（工作区除 `openspec/`、`.claude/`、`.agents/` 外为空）。

## 改动文件

（2026-09-21 amend 更新：清单内文件均已落盘，原「当前均不存在 / 工作区为空」的描述已过期；同时补列此前漏掉的 `resources/codex.svg`。以下全部为本次变更新增的文件。）

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `esbuild.mjs`
- `.gitignore`
- `src/extension.ts`
- `src/commands.ts`
- `src/codex/binary.ts`
- `src/codex/appServerClient.ts`
- `src/codex/threadApi.ts`
- `src/codex/conversationUri.ts`
- `src/codex/types.ts`
- `src/session/openTabs.ts`
- `src/session/pinStore.ts`
- `src/session/sessionStore.ts`
- `src/session/opener.ts`
- `src/ui/treeProvider.ts`
- `test/helpers/fakes.ts`
- `test/unit/binary.test.ts`
- `test/unit/appServerClient.test.ts`
- `test/unit/conversationUri.test.ts`
- `test/unit/threadApi.test.ts`
- `test/unit/openTabs.test.ts`
- `test/unit/pinStore.test.ts`
- `test/unit/sessionStore.test.ts`
- `test/unit/opener.test.ts`
- `test/unit/treeProvider.test.ts`
- `test/unit/commands.test.ts`
- `resources/codex.svg`
- `.vscode/launch.json`（2026-09-21 追加：F5「Run Extension」调试宿主配置，`preLaunchTask` 走 `npm: build`）

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| **`openai-codex://` + `chatgpt.conversationEditor` 是内部契约** | Codex 升级后「打开会话」整体失效 | 契约集中在 `conversationUri.ts` 一个文件；build 的**第一个任务**是 spike 实测；失败时明确报错（D9） |
| **spike 若不通过，v1 价值缩水** | 只剩只读浏览 | Task 1 是独立的、可先行验证的任务；不通过则停下来重新决策，不继续写下游代码 |
| `codex app-server` 标注 experimental | 方法签名可能变 | 只用 3 个方法；类型定义来自官方 `generate-json-schema`；启动失败有可见错误 |
| 每窗口一个 250 MB 二进制子进程 | 内存占用 | 懒启动 + `deactivate` 回收；空闲回收列入后续 |
| `TabInputCustom.viewType` 前缀问题 | 已打开分组恒为空 | spike 一并实测；`openTabs.ts` 的判定做成可配置常量 |
| 服务端 `searchTerm` 只匹配标题，本地匹配 `name ?? preview` | 少量召回差异 | 本地统一判定（D7）；`INV-002` 保证「显示出来的每一项都匹配」 |

## 不在本变更范围

批量标签整理、会话内容渲染与发消息、归档/删除会话、修改 Codex 插件、多窗口同步、remote/cloud 会话、app-server 空闲回收。

平台支持澄清：二进制定位按 Codex 的 `fh()` 映射实现（因为写死 `linux-x86_64` 并不更省事），但**只在 `linux-x86_64`（WSL2）上实测**，其余平台不做验证承诺。

## 确定性汇总

- `[Assumption]` `TabInputCustom.viewType` 不带前缀 → Task 1 spike 消解
- `[Assumption]` 同 URI 二次 `openWith` 复用既有编辑器（D4）→ Task 1 spike 消解
- `[Assumption]` 服务端 `searchTerm` 对无名会话按 preview 提取标题 → 影响仅为召回差异，`INV-002` 兜底
- `[Assumption]` 开发机可运行 pnpm + esbuild + vitest（`pnpm` 已 `[Verified]` 存在，具体包未装）
- `[Verified]` `chatgpt.newCodexPanel` 的 handler 形如 `async Te=>{Te?.source===…, dt.createNewPanel()}`（Codex `out/extension.js`），参数走可选链 → **无参调用安全**，新建会话不需要额外 spike
- `[Inferred]` 用户手动折叠后的分组状态由 VS Code 按 `TreeItem.id` 记忆，刷新不重置（VS Code 语义）→ 若实测发现刷新会重置，D13 退化为「每次渲染都按组给默认值」，行为不会变差，故不写测试钉它
- 其余判断均为 `[Verified]` 或由本设计裁定的 `[Inferred]`
