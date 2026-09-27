# 验证记录：rework-session-sidebar

> 本次 verify（2026-09-27）在 rework-session-sidebar 的实现提交（`f6d1cbe..5a17c65`）之上**重跑**。
> 工作区另有已归档变更 `bind-new-session-tab` 的未提交改动（`src/extension.ts`、`src/session/openTabs.ts`、
> `src/session/rowOpener.ts`、`src/session/tabTitleSync.ts`、`src/session/newSessionWatch.ts` 等），
> 因此测试计数（178）高于上一版记录（114），同一文件里的行号也比上一版更靠后。
>
> 本轮先验后修：第一次 verify 发现 design 改动点 4 的**声明漂移**（`defaultCollapsibleState` 被标
> 「不随改」但实际随改、`toItemNode` 的归档优先 `contextValue` 未声明），按用户决定走了一次
> **`$openflow amend`（2026-09-27）** 只修文档、不改代码；下表与证据均为 amend 之后重跑的结果。

## 0. 状态检测与信号矩阵

`node ~/.codex/hooks/openflow-detect.mjs` 报 `contradictions` 非空，按要求列信号矩阵后逐条核实：

| 信号源 | 可靠度 | 结论 |
|--------|--------|------|
| active_changes = `[rework-session-sidebar]` | high | 1 个活跃变更 |
| test_plan_stats = 47/47 PASS, redMissing 0 | high | 实现已完成 |
| plan_ready_tasks = 11/11 done | high | 计划完成 |
| git_commits = 10 related | high | 已提交 |
| building_marker = false | high | 无残留 build 上下文 |
| superpowers_plan / verify_issues | medium | 存在 |
| **file_resolvability：16 项 not-found** | **low** | **假阴性** |

低可靠度信号的 16 项拆开看：10 项是 `npx vitest run …` **命令行**（不是文件路径），6 项是
「路径 + 注解」被整串当成文件名（`src/session/openTarget.ts [Verified]（新增）` 等）。这 6 个文件
在磁盘上都存在，`ls` 实测：

```
EXISTS src/session/openTarget.ts        EXISTS src/session/rowOpener.ts
EXISTS test/unit/openTarget.test.ts     EXISTS test/unit/rowOpener.test.ts
EXISTS test/unit/extension.test.ts      EXISTS test/unit/packageContributes.test.ts
```

⇒ 低可靠度信号的否定结论不成立，7 个 high/medium 信号一致，路由到 verify。

## 闸门 1：全量测试

```
$ rtk pnpm test        # vitest run（amend 之后重跑）
 Test Files  22 passed (22)
      Tests  178 passed (178)
   Duration  857ms

$ rtk pnpm typecheck   # tsc --noEmit
TypeScript: No errors found   (exit 0)
```

`check-test-plan rework-session-sidebar`（原样输出）：

```json
{
  "pass": true,
  "stats": { "pass": 47, "todo": 0, "fail": 0, "total": 47, "red_missing": 0 },
  "issues": [],
  "all_pass": true,
  "stub_issues": [],
  "red_issues": [],
  "invariant_issues": []
}
```

47 条测试行（42 条 `T-*` + 5 条 `INV-*`）全部 `🔴 RED ✅ PASS`，无桩残留，无缺 RED 证据。

## 闸门 2：场景覆盖率

- 本变更 spec delta 的 scenario 总数：**56**（`REMOVED` 块只有 Reason/Migration，不计入）。
- 映射数：42 条 `T-*` + 5 条 `INV-*` = 47 条选择器，覆盖 56 个 scenario 中的 36 个；
  其余 20 个由 test-plan「既有覆盖」节的既有用例守住（行为未变、requirement 块被整体重写）。
- 覆盖率：**56/56 = 100%**。

逐条对账后，仅名词简写导致的差异（不是缺口）：

| spec scenario（原文） | test-plan 里的映射 |
|----------------------|-------------------|
| 保留每个标签页自己的 resource（含 query 与 scheme 差异） | T-002（表内写作「保留每个标签页自己的 resource」） |
| 条目描述显示会话所在目录的末级名称 | 既有覆盖：`treeProvider.test.ts::description_shows_cwd_basename` |
| 空分组不渲染分组节点 | 既有覆盖：`sessionStore.test.ts::hides_empty_groups`（机械更新） |
| 关键词过滤只保留匹配项 | 既有覆盖：`sessionStore.test.ts::filter_keeps_only_matching_sessions` |
| 无名会话用首条消息作为显示标题 | 既有覆盖：`sessionStore.test.ts::falls_back_to_preview_when_name_is_null` |
| 置顶的会话已从服务端消失时不显示幽灵条目 | 既有覆盖：`sessionStore.test.ts::drops_pinned_session_that_no_longer_exists` |
| 运行状态随会话数据一起传递给条目 | 既有覆盖：`sessionStore.test.ts::marks_sessions_present_in_running_set`（机械更新） |
| 尚未绑定会话的新建面板不进侧边栏 | T-010（同一入口：扫描丢弃 + 建树不产生行） |

## 闸门 3：设计一致性

### 3.1 改动文件对账

本变更的**净范围**是 `git diff f6d1cbe..5a17c65 --name-only`（`5a17c65` 是本变更最后一个提交）：

```
23 个代码/测试文件：README.md package.json src/codex/threadApi.ts src/codex/types.ts src/commands.ts
  src/extension.ts src/session/openTabs.ts src/session/openTarget.ts src/session/opener.ts
  src/session/rowOpener.ts src/session/sessionStore.ts src/ui/treeProvider.ts test/helpers/fakes.ts
  test/unit/{commands,extension,openTabs,openTarget,opener,packageContributes,rowOpener,sessionStore,threadApi,treeProvider}.test.ts
12 项：.openflow/* docs/superpowers/plans/2026-09-21-rework-session-sidebar.md openspec/changes/rework-session-sidebar/**
```

与 design「改动文件」的 23 条**逐一对应**：无「表里有但没改」，也无「改了但不在表」。✅

说明：`git diff f6d1cbe...HEAD` 还会带上后一变更 `bind-new-session-tab` 的文件
（`src/session/tabTitleSync.ts`、`src/session/newSessionWatch.ts`、`src/session/sessionCreator.ts`、
`src/session/writerLock.ts`、`src/codex/appServerClient.ts`、`src/codex/noRetryPatch.ts`、`resources/*`、
其 openspec 与计划文档），这些**不参与**本变更的对账。

### 3.2 `check-design-consistency`（amend 之后，原样摘录）

```json
{ "pass": true, "design_exists": true, "design_file_count": 22, "blockers": [] }
```

`warnings`（6 条，原样）：

1. 改动点归属：`src/ui/treeProvider.ts` 的 `toGroupNode`（第 70 行）未被任何改动点声明，但 diff 落点在此方法内（第 81 行）——方法归属漂移，人工核对是否插错方法
2. 声称未落地：改动点 2 声明的 `src/codex/types.ts::OpenTab` 在 src/codex/types.ts 里找不到该方法声明
3. 声称未落地：改动点 2 声明的 `src/codex/types.ts::SessionItem` 在 src/codex/types.ts 里找不到该方法声明
4. 声称未落地：改动点 2 声明的 `src/codex/types.ts::SessionGroupId` 在 src/codex/types.ts 里找不到该方法声明
5. 声称未落地：改动点 2 声明改 `test/helpers/fakes.ts::makeOpenTab`，但 test/helpers/fakes.ts 在本次变更中没有任何改动
6. 声称未落地：改动点 3 声明的 `src/session/sessionStore.ts::GROUP_LABELS` 在 src/session/sessionStore.ts 里找不到该方法声明

（amend 前还有第 7 条：`treeProvider.ts::getTreeItem` 找不到方法声明——它仍在，且**不可能靠改 design 消除**，
详见 3.4(c)。）

### 3.3 gate 的 `change_point_verdicts`（原文要点，未改写）

| 改动点 | 声明（`文件::符号`） | gate 判定 |
|--------|--------------------|-----------|
| 1 | `openTabs.ts::scanCodexTabs`（随改）；`conversationUri.ts::parseConversationId`、`buildConversationUri`（不随改） | ✅ |
| 2 | `types.ts::OpenTab`；`types.ts::SessionItem`；`types.ts::SessionGroupId`；`fakes.ts::makeOpenTab` | ⚠️ |
| 3 | `sessionStore.ts::buildSessionGroups`（随改）；`sessionStore.ts::GROUP_LABELS`（随改）；`sessionItemLabel`、`matchesFilter`（不随改） | ⚠️ |
| 4 | `treeProvider.ts::getTreeItem`；`treeProvider.ts::toItemNode`（随改）；`treeProvider.ts::defaultCollapsibleState`（随改）；`getChildren`、`cwdBasename`（不随改） | ⚠️ |
| 5 | `openTarget.ts::resolveOpenTarget`、`readSessionRow`；`rowOpener.ts::createRowOpener` | ✅ |
| 6 | `opener.ts::revealTab`（随改）；`openSession`（不随改） | ✅ |
| 7 | `extension.ts::activate`（随改）；`deactivate`、`sessionIdOf`、`commands.ts::createNewSessionCommand`（不随改） | ✅ |
| 8 | `threadApi.ts::deleteThread`、`archiveThread`、`unarchiveThread`、`listThreads`（随改）；`setThreadName`、`listTurns`、`listLoadedThreadIds`（不随改） | ✅ |
| 9 | `commands.ts::createArchiveSessionCommand`、`createUnarchiveSessionCommand`、`createDeleteSessionCommand`、`registerCommands`（随改）；`createRenameSessionCommand`、`createNewSessionCommand`（不随改） | ✅ |
| 10 | `openTabs.ts::selectTabsForConversation` | ✅ |
| 11 | `extension.ts::activate`（+ `package.json` 声明式贡献，无选择器） | ✅ |

改动点 4 的 `details` 原文（amend 之后）：`getTreeItem` → `hit: false`「该文件里找不到此方法声明」；
`toItemNode` → `hit: true, actual: "toItemNode@90"`；`defaultCollapsibleState` → `hit: true,
actual: "defaultCollapsibleState@84"`；`getChildren` / `cwdBasename` → 不随改。

### 3.4 6 条 warning 逐条核对（含代码证据）

**（a）改动点 2 的三条类型声明 + 改动点 3 的 `GROUP_LABELS`：gate 解析器误报。**
gate 的方法声明解析（`parseMethodDecls` → `scanBraceDecls`）只认函数/方法形状，不认
`export interface` / `export type` / `export const`。这 4 个符号都存在且都已按设计改完：

| 声明 | 实际代码 | 证据 |
|------|---------|------|
| `types.ts::OpenTab` | `export interface OpenTab`@65 | `id: string`@72（收紧非空）、`uri: UriLike`@79（新增） |
| `types.ts::SessionItem` | `export interface SessionItem`@98 | `archived: boolean`@108、`tabUri: UriLike \| null`@113（新增） |
| `types.ts::SessionGroupId` | `export type SessionGroupId`@116 | 值已为 `'pinned' \| 'recent' \| 'history' \| 'archived'` |
| `sessionStore.ts::GROUP_LABELS` | `export const GROUP_LABELS`@16 | 四组齐全：pinned/recent/history/archived（@17-20） |

**（b）`test/helpers/fakes.ts::makeOpenTab`「本次变更没有任何改动」：gate 内部过滤误报。**
gate 收集 hunk 时执行 `!isTestFilePath(h.file)`，测试文件被排除出 hunk 表，但它仍然对测试文件
声明做「有没有改动」判定 ⇒ 必然误报。实测该文件确实改了：

```
$ rtk git diff f6d1cbe..5a17c65 --name-only | grep fakes
test/helpers/fakes.ts
$ rtk git diff f6d1cbe..5a17c65 -- test/helpers/fakes.ts   # hunk @@ -172,8 +172,12 @@
-export function makeOpenTab(id: string | null, tabLabel = 'tab'): OpenTab {
-  return { id, tabLabel };
+export function makeOpenTab(id: string, tabLabel = 'tab'): OpenTab {
+  const uri = createFakeUriApi().file(`/local/${id}`).with({ scheme: 'openai-codex', authority: 'route', query: '' });
+  return { id, tabLabel, uri };
```

**（c）`treeProvider.ts::getTreeItem`「找不到该方法声明」：gate 解析器缺陷（已用 gate 自己的解析器实测）。**
把 gate 的 `parseMethodDecls` 抽出来直接跑 `src/ui/treeProvider.ts`，得到的声明只有 8 个：

```
onDidChangeTreeData@48  cwdBasename@59  createSessionTreeProvider@65  toGroupNode@70
defaultCollapsibleState@84  toItemNode@90  toErrorNode@116  getChildren@129
```

`getTreeItem`@143、`refresh`@190、`onDidChangeTreeData`@194 **都不在列表里**。原因是
`scanBraceDecls` → `isFreshStatementStart`：这三个是「前面是空行、且名字前无修饰符」的对象字面量
简写方法（`getTreeItem(node) { … }`），反查时只夹着空行 ⇒ 过滤后 `gap` 为空 ⇒ 被判成「不是新鲜语句
起点」而丢弃；`getChildren`@129 因为带 `async` 修饰符才走通了另一条分支。

**代码证据（改动确实落在 `getTreeItem` 体内）**：design 改动点 4 要的就是「条目的命令参数带上标签
resource」，而 `item.command.arguments` 正是在 `getTreeItem` 里组装的——

```
src/ui/treeProvider.ts:143   getTreeItem(node: SessionTreeNode): vscode.TreeItem {
src/ui/treeProvider.ts:163-179   item.command = { command: 'codexHelper.openSession', title: '打开会话',
                                 arguments: [{ sessionId: node.session.id, label: node.label,
                                               tabUri: node.session.tabUri, archived: node.session.archived }] };
```

⇒ 声明目标已落地；⚠️ 是解析器看不见该方法所致，不是「改动落错方法」。
（**此处修正上一版记录**：上一版把命令参数判成在 `toItemNode` 里组装、据此认定「真漂移」；
`toItemNode`@90-114 只组装树节点数据（`id`/`label`/`description`/`contextValue`/`session`），
不碰 `item.command`。）

**（d）归属漂移 warning（`toGroupNode`@70，hunk 起点 81）：doc 注释的误归属。**
`--unified=0` 下该文件的 hunk 是 `HEAD:25+1`、`HEAD:81+1`、`HEAD:85+1`、`HEAD:91+9`、`HEAD:168+11`。
第 81 行是 `defaultCollapsibleState` 的**文档注释**，而它的声明在第 84 行（hunk 起点之后），
所以 gate 的「向上找最近前驱声明」落到了 `toGroupNode`@70 —— `toGroupNode` 本身（@70-78）
没有被改动，这是误归属。hunk@85 被正确判给 `defaultCollapsibleState`@84，hunk@91 判给
`toItemNode`@90（两者现在都在 design 里声明为「随改」，故 ① 不再报）。

### 3.5 改动点逐条核验（固定格式，逐条读 amend 之后的当前代码）

```
改动点 1（声明 `src/session/openTabs.ts::scanCodexTabs`）：代码落点 = scanCodexTabs@41 → ✅
  （`const id = parseConversationId(input.uri); if (!id) continue;`@60-61；`uri: input.uri`@66）
改动点 1（声明 `src/codex/conversationUri.ts::parseConversationId`）：不随改 → 记录：解析规则未变，仍只认 /local|/remote
改动点 1（声明 `src/codex/conversationUri.ts::buildConversationUri`）：不随改 → 记录：无标签 resource 的行仍走它
改动点 2（声明 `src/codex/types.ts::OpenTab`）：代码落点 = OpenTab@65（interface） → ✅
  （`id: string`@72 收紧，`uri: UriLike`@79 新增；消费点 `sessionStore.ts:73` `tabUriByThreadId.set(tab.id, tab.uri)`）
改动点 2（声明 `src/codex/types.ts::SessionItem`）：代码落点 = SessionItem@98（interface） → ✅
  （`archived`@108、`tabUri`@113；构造点 `sessionStore.ts:75-87` `toItem()`）
改动点 2（声明 `src/codex/types.ts::SessionGroupId`）：代码落点 = SessionGroupId@116（type） → ✅
  （四值联合；消费点 `sessionStore.ts:123-126`、`treeProvider.ts:90`）
改动点 2（声明 `test/helpers/fakes.ts::makeOpenTab`）：代码落点 = makeOpenTab@176 → ✅
  （签名收紧为 `id: string`，返回体加 `uri`；消费点 `test/unit/sessionStore.test.ts` 等夹具）
改动点 3（声明 `src/session/sessionStore.ts::buildSessionGroups`）：代码落点 = buildSessionGroups@61 → ✅
  （已归档优先 @90-97、置顶 @99-107、最近取 RECENT_LIMIT @111-115、历史 @117-119；四组返回 @121-134）
改动点 3（声明 `src/session/sessionStore.ts::GROUP_LABELS`）：代码落点 = GROUP_LABELS@16（const） → ✅
  （四组标签 @17-20，被 `buildSessionGroups` 的返回 @123-126 调用）
改动点 3（声明 `src/session/sessionStore.ts::sessionItemLabel`）：不随改 → 记录：标题仍取 thread 名/预览
改动点 3（声明 `src/session/sessionStore.ts::matchesFilter`）：不随改 → 记录：过滤仍只看 id/label/preview
改动点 4（声明 `src/ui/treeProvider.ts::getTreeItem`）：代码落点 = getTreeItem@143 → ✅
  （`item.command.arguments` 带上 `tabUri`/`archived`@163-179）
改动点 4（声明 `src/ui/treeProvider.ts::toItemNode`，随改）：代码落点 = toItemNode@90 → ✅
  （`session.archived` → `contextValue = 'session.archived'`@93-94；被 getTreeItem@161/176 消费）
改动点 4（声明 `src/ui/treeProvider.ts::defaultCollapsibleState`，随改）：代码落点 = defaultCollapsibleState@84 → ✅
  （`group.id === 'history' || group.id === 'archived'`@85；被 getTreeItem@145 调用）
改动点 4（声明 `src/ui/treeProvider.ts::getChildren`）：不随改 → 记录：`groups.map(toGroupNode)`@137 未变
改动点 4（声明 `src/ui/treeProvider.ts::cwdBasename`）：不随改 → 记录：@59-63 未变
改动点 5（声明 `src/session/openTarget.ts::resolveOpenTarget`）：代码落点 = resolveOpenTarget@54 → ✅
改动点 5（声明 `src/session/openTarget.ts::readSessionRow`）：代码落点 = readSessionRow@34 → ✅
改动点 5（声明 `src/session/rowOpener.ts::createRowOpener`）：代码落点 = createRowOpener@29 → ✅
  （编排体 `openRow`@30-38：先 `deps.unarchive`@34，再 `openSession`/`revealTab`@35-37）
改动点 6（声明 `src/session/opener.ts::revealTab`）：代码落点 = revealTab@64 → ✅
  （实现里就是 `vscode.openWith(uri, …)`@67-69；调用点 `extension.ts:497`）
改动点 6（声明 `src/session/opener.ts::openSession`）：不随改 → 记录：失败语义不变（报错、不回退新建）
改动点 7/11（声明 `src/extension.ts::activate`）：代码落点 = activate@77 → ✅
  （`load()` 两次 `listThreads`@311-322、`createRowOpener` 接线@491-501、三个处理器@510-533）
改动点 7（声明 `src/extension.ts::deactivate` / `sessionIdOf`）：不随改 → 记录：本次未触及
改动点 7（声明 `src/commands.ts::createNewSessionCommand`）：不随改 → 记录：`+` 仍按 nonce 开独立面板
改动点 8（声明 `src/codex/threadApi.ts::listThreads`）：代码落点 = listThreads@40 → ✅（`archived: query.archived ?? false`@46）
改动点 8（声明 `src/codex/threadApi.ts::archiveThread`）：代码落点 = archiveThread@67 → ✅
改动点 8（声明 `src/codex/threadApi.ts::unarchiveThread`）：代码落点 = unarchiveThread@71 → ✅
改动点 8（声明 `src/codex/threadApi.ts::deleteThread`）：代码落点 = deleteThread@75 → ✅
改动点 8（声明 `setThreadName` / `listTurns` / `listLoadedThreadIds`）：不随改 → 记录：@61-63 / @81-88 / @56-59 未变
改动点 9（声明 `src/commands.ts::createArchiveSessionCommand`）：代码落点 = createArchiveSessionCommand@242 → ✅
改动点 9（声明 `src/commands.ts::createUnarchiveSessionCommand`）：代码落点 = createUnarchiveSessionCommand@251 → ✅
改动点 9（声明 `src/commands.ts::createDeleteSessionCommand`）：代码落点 = createDeleteSessionCommand@264 → ✅
改动点 9（声明 `src/commands.ts::registerCommands`）：代码落点 = registerCommands@277 → ✅（三条新命令注册 @284-292）
改动点 9（声明 `createRenameSessionCommand` / `createNewSessionCommand`）：不随改 → 记录：范式引用，本次未改
改动点 10（声明 `src/session/openTabs.ts::selectTabsForConversation`）：代码落点 = selectTabsForConversation@80 → ✅
  （`parseConversationId(input.uri) !== conversationId` 过滤 @94；调用点 `extension.ts:210`、关标签 `extension.ts:528-531`）
改动点 11（声明 `package.json` 声明式贡献，无选择器）：`contributes.commands` 三条 @46-70、
  `view/item/context`：archive→`inline@1`、delete→`inline@2`（`viewItem == session.archived`）、
  openSession 移到 `1_modification@0`、unarchive→`1_modification@1` → ✅（T-033 直接断言该文件）
```

### 3.6 用户确认清单（**待用户显式确认**）

| 改动点 | 声明 | 代码落点 | 方法匹配 | AI 判断依据 | 备注 |
|--------|------|---------|---------|------------|------|
| 1 | `openTabs.ts::scanCodexTabs` | `scanCodexTabs`@41 | ✅ | `@60-61` 未绑定标签 `continue`；`@66` 带上 `input.uri` | gate ✅ |
| 2 | `types.ts::OpenTab` | `OpenTab`@65 | ✅ | `id: string`@72、`uri`@79；消费点 `sessionStore.ts:73` | gate ⚠️（解析器不认 interface） |
| 2 | `types.ts::SessionItem` | `SessionItem`@98 | ✅ | `archived`@108、`tabUri`@113；构造点 `sessionStore.ts:75-87` | gate ⚠️（同上） |
| 2 | `types.ts::SessionGroupId` | `SessionGroupId`@116 | ✅ | 四值联合；消费点 `sessionStore.ts:123-126` | gate ⚠️（同上） |
| 2 | `fakes.ts::makeOpenTab` | `makeOpenTab`@176 | ✅ | 签名收紧 + 返回 `uri`；diff hunk `@@ -172,8 +172,12 @@` 正落此处 | gate ⚠️（测试文件被排除出 hunk 表） |
| 3 | `sessionStore.ts::buildSessionGroups` | `buildSessionGroups`@61 | ✅ | 已归档优先 `@90-97`、最近取 10 `@111-115`、四组 `@121-134` | gate ✅ |
| 3 | `sessionStore.ts::GROUP_LABELS` | `GROUP_LABELS`@16 | ✅ | 四组标签 `@17-20`，被 `@123-126` 调用 | gate ⚠️（解析器不认 const） |
| 4 | `treeProvider.ts::getTreeItem` | `getTreeItem`@143 | ✅ | `item.command.arguments` 带 `tabUri`/`archived` `@163-179` | gate ⚠️（解析器漏掉无修饰符的简写方法，实测已证） |
| 4 | `treeProvider.ts::toItemNode`（**amend 后已声明为随改**） | `toItemNode`@90 | ✅ | `session.archived` → `contextValue` `@93-94`，由 `getTreeItem`@161 消费 | gate ✅ |
| 4 | `treeProvider.ts::defaultCollapsibleState`（**amend 后已声明为随改**） | `defaultCollapsibleState`@84 | ✅ | `@85` `group.id === 'history' || group.id === 'archived'` | gate ✅（代码与 spec/T-018 一致） |
| 4 | `treeProvider.ts::getChildren` / `cwdBasename` | 未改 | ✅ | 声明为不随改，实测未触及 | gate ✅ |
| 5 | `openTarget.ts::readSessionRow` / `resolveOpenTarget` | 各自函数体 | ✅ | 归一到 `{id,tabUri,archived}`，目标判定 resource 优先 | gate ✅ |
| 5 | `rowOpener.ts::createRowOpener` | `createRowOpener`@29 | ✅ | `openRow`@30-38：`unarchive`@34 在打开之前，失败不阻断 | gate ✅ |
| 6 | `opener.ts::revealTab` | `revealTab`@64 | ✅ | `vscode.openWith(uri, …)`@67-69；接线 `extension.ts:497` | gate ✅ |
| 7/11 | `extension.ts::activate` | `activate`@77 | ✅ | 两次 `thread/list`@311-322、`rowOpener` 接线@491-501、三处理器@510-533 | gate ✅ |
| 8 | `threadApi.ts` 四方法 | `listThreads`@40 / `archiveThread`@67 / `unarchiveThread`@71 / `deleteThread`@75 | ✅ | `archived: query.archived ?? false`@46；三个薄封装各一次 `client.request` | gate ✅ |
| 9 | `commands.ts` 三个工厂 + `registerCommands` | @242 / @251 / @264 / @277 | ✅ | 三个工厂共用 `createSessionActionCommand`（无确认/输入依赖），注册 `@284-292` | gate ✅ |
| 10 | `openTabs.ts::selectTabsForConversation` | @80 | ✅ | `parseConversationId !== conversationId` 过滤@94；调用 `extension.ts:210`、关标签@528-531 | gate ✅ |

不随改路径的豁免理由（design 原文照录，均在 3.5 逐条核验为「未触及」）：
`parseConversationId` / `buildConversationUri`（URI 契约不变）、`sessionItemLabel` / `matchesFilter`
（标题/过滤规则不变）、`getChildren` / `cwdBasename`（渲染路径不变）、`openSession`（失败语义不变）、
`deactivate` / `sessionIdOf` / `createNewSessionCommand` / `setThreadName` / `listTurns` /
`listLoadedThreadIds` / `createRenameSessionCommand`（本次需求未触及）。

### 3.7 本轮 amend 记录（2026-09-27）与处置

1. **已修：design 改动点 4 的声明漂移。** 改动点 4 的标题改为「树条目的命令参数、归档优先级与默认
   折叠态」；`toItemNode` 与 `defaultCollapsibleState` 从「未声明 / 不随改」改成
   **随改**（`design.md` 改动点 4）；正文里「contextValue 的既有优先级保持不变」也改成了
   「contextValue 变为归档优先」。
2. **顺带修正一处悬空引用**：design 边界条件表两处引用**不存在**的测试号 `T-034`
   （test-plan 的编号是 T-033 → T-035），改成 `T-025 / T-028 / INV-004` 与
   `T-026 / T-030 / INV-004`；`grep -rn "T-034"` 现已无命中。
3. **同步产物**：`proposal.md` 追加 `## Amendments`（原因 / 摘要 / 测试影响）；
   `test-plan.md` 追加「测试影响分析 (2026-09-27)」——**0 条需修改、0 条废弃、0 条新增**，
   47 行选择器与 `🔴 RED ✅ PASS` 后缀全部保留不动；
   `plan-ready.md` 的 Task 5 加一行修订说明（该 task 目标本就覆盖这两处，无 task/测试变更）。
4. **校验**：`openspec validate rework-session-sidebar --strict` → `Change 'rework-session-sidebar' is valid`；
   `check-cross-ref` → `pass: true`（47 tests 全部绑到 task）；`check-amend-count` → `amend_count: 2`（无警告）；
   `check-design-consistency` → `pass: true, blockers: []`。
5. **无未决项**：剩余 6 条 warning 与 1 条 ⚠️（`getTreeItem`）全部是 gate 解析/过滤机制的假阴性，
   均已给出可复核的代码证据（3.4 (a)(b)(c)），不阻塞归档。

## 闸门 4：场景断言核对

三个必查项逐项落地：

1. **GIVEN 对齐**：抽查用例的夹具都建立了 scenario 的前置条件（见下表「GIVEN」列），没有出现
   「scenario 写归档态、夹具却给普通态」这类错格。
2. **断言具备失败能力**：抽查的断言都是**正向等值/计数**（`toEqual([...])`、`toBe(1)`、`toBe(8)` 等），
   不是 `never()` / `assertNull` / 「不抛异常」形状；配套的「反空转护栏」（`checked === N`、
   `successCloseRuns === 1`、`opened === 8`）保证循环真的跑满所有格子。
   每条 `✅ PASS` 都带 `🔴 RED`（`check-test-plan` 报 `red_missing: 0`）；RED 原始输出见 build 期间记录
   （例如 T-040 的 `expected false to be true`、INV-004 的
   `删除成功应当关掉匹配标签: expected +0 to be 1`），本表只做形状与 GIVEN 的复核。
3. **不存在跨用例委托**：
   ```
   $ grep -rn "真实断言\|见 T-\|另一个测试\|详见 T-\|由 T-.*覆盖" test/
   (无命中)
   ```

| 用例 | GIVEN 对齐 | 断言失败能力 | 结论 |
|------|-----------|-------------|------|
| T-010 `drops_unbound_new_panel_tab` | ✅ 真实链路：`/extension/panel/new?newPanel=n1` 标签 → `scanCodexTabs` → `buildSessionGroups`，且 `thread/list` 有两条会话（`manyThreads(2)`） | ✅ `expect(scanned).toEqual([])`、`filter(id.startsWith('open-tab:')).toEqual([])`、`ids('recent')===['t1','t2']`——旧实现（合成 `open-tab:0`）必红 | 断言方向与 scenario 一致 |
| T-040 `archived_row_unarchives_before_opening` | ✅ 夹具 `{sessionId:'t1', archived:true}`，另有带 `tabUri` 的变体（「已归档 + 已打开标签」） | ✅ `calls` 精确等值 `['unarchive:t1','openSession:t1']`；带标签变体 `['unarchive:t1','reloadUntitledTab:…','revealTab:…']`——顺序错即红 | 顺序断言直接对应「先取消归档，随后才打开」 |
| T-041 `opens_even_when_unarchive_fails` + INV-005 | ✅ INV-005 覆盖 `archived × withTab × unarchiveOk` = 8 格 | ✅ 未归档行必须 `unarchiveCalls === []`；打开动作必须存在且排在最后 | 「失败不阻止打开」在持有真对象的这一侧断言，无委托 |
| INV-004 `destructive_actions_never_ask_and_only_delete_closes_tabs` | ✅ 3 命令 × 成败 = 6 格，每格 `vi.clearAllMocks()` 后用假 app-server 真回包 | ✅ 失败格断言「不关标签/不动置顶/不刷新」；成功格断言「只有删除关标签 + 清置顶 + 归档/取消归档不关标签」；护栏 `checked===6 && successCloseRuns===1` | 三条命令 × 成败的矩阵，无跨用例委托 |
| INV-003 `every_thread_renders_exactly_once` | ✅ `pinned × archived × size` = 8 格，每格构造真 `threads`/`archivedThreads`/`openTabs` | ✅ 每格断言 `occurrences(target) === 1` 且四种归属逐格判定；护栏 `checked===8` 且四种归属都真的出现过 | 「一个会话一行」的跨组合不变量，非纯 `never()` 形状 |

## 人工验收（自动化测不到，需人在真实 VS Code 里过一遍）

见 test-plan.md「人工验收」11 步；其中第 2/3/6/8/11 步是本变更的核心可见行为
（空白面板不进侧边栏、点开聚焦标签、归档→删除两步、点开已归档先取消归档）。

## 待用户确认

本轮 verify 的四个闸门全部完成，**无未决问题 ✅**：amend 已把 design 改动点 4 的声明漂移修掉
（`check-design-consistency` 的 `blockers` 为空），其余 6 条 warning 与它对 `getTreeItem` 的那条
「找不到方法声明」判定都是 gate 解析/过滤机制的假阴性（有代码证据，见 3.4 (a)(b)(c)）。

**在用户显式确认「全部改动点按设计落地」之前，不写入 `verify-result.json`、不生成 receipt。**
