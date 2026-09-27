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
| **第二次实测反馈**：0.0.11 装好后标题仍不更新 | 用现场数据定位（用户窗口 `exthost11` 的 Codex 日志 + 真实 `~/.codex`）：建会话这条路是**好的**（16:17:32 建出的会话带全零 sha 占位、面板 16:17:36 `maybe_resume_success`、turn 完成、`getConversationSummary` 返回 preview `你好`）。坏的是同步的**触发**：它只挂在树的 `load()` 上，侧边栏没被重新读取就不会跑。改为三条独立触发（列表刷新 / `onDidChangeTabs` / 3 秒×5 分钟兜底轮询）+ 候选不在缓存时自行拉列表，并补 T-126 | `[Verified]` |
| **第三次实测反馈**：标题同步好了，但点 `+` 要等一会儿、「感觉像没响应」 | 计时（真实环境，多次采样一致）：`initialize` 0.11s / `thread/start` 0.13s / `metadata/update` 0.78s / `resume` 0.17s / 退出 0.01s ≈ **1.2s**；同一进程连做 3 轮 `metadata/update` 都是 0.78s（**per-call 成本**，不是进程初始化），热进程也省不掉。先补「正在创建 Codex 会话…」进度通知消除卡死感；真正的提速只能靠后台预热一个现成会话（另议） | `[Verified]` |
| **第四次实测反馈**：标题同步会在后台把标签重开，而重开默认**抢焦点**——用户在别的编辑器里打字也会被拽到那个 Codex 标签上 | 定位：`close(tab, true)` 的 `preserveFocus` 只管关标签那一下，真正决定抢不抢焦点的是重开那一步；`openWith` 原来只传 `{preview:false}`，按 `@types/vscode` 的 `TextDocumentShowOptions` 语义（`viewColumn` 默认 `Active`、`preserveFocus` 默认不保留焦点）必然夺焦。改为 `{preview:false, preserveFocus:true}`，并把「当前激活标签跳过」那条例限的意图补全（原来只挡住「用户在读这一页」，挡不住「用户在做别的事」）。新增 T-127 | `[Verified]`（参数语义依据类型定义；扩展宿主里的实际焦点行为**待人工实测**） |
| **第五次实测反馈**：装了带 `preserveFocus: true` 的版本（0.0.14 构建 + 开发宿主）之后，**仍然**会激活 Codex 标签、抢走焦点 | 定位：`preserveFocus` 拦不住「新建编辑器被激活」这条路径。旁证：上游 Codex 自己也有 `ensureRestoredConversationTabsResolved()`——遍历所有标签、对每个 Codex 标签 `openWith(..., {preserveFocus:true})`（bundle `out/extension.js`），说明这个选项在上游是「聚焦已开着的标签」时用的；而新建编辑器是另一条路径。修复改为补偿式：重开前记下激活标签（uri + viewColumn + 自定义编辑器的 viewType），整批重开之后用 `vscode.open`/`vscode.openWith` + `preserveFocus:false` 把焦点还回去；焦点没被抢走时什么都不做。新增 T-128/T-129。**注意**：开发宿主的日志（`~/.vscode-server/data/logs/<ts>/remoteagent.log`）确认加载的是本地代码，不是已安装的 0.0.13（用户 17:37:59 已把它卸载），所以这条反馈排除了「测的是旧版本」这个可能 | `[Verified]`（抢焦点确认；还焦点方案**待新一轮人工实测**） |
| **第六次实测反馈**：焦点回来了，但「打开后 codex 标签在最后边了」——重开把标签从原来的格子挪到了组内末尾 | 定位：`openWith` 没带 `viewColumn`（会开在当前激活那一栏）+ 新编辑器永远追加到组内末尾。修复：① 扫描时带上 `viewColumn` / `index`（`scanCodexTabs`），重开带 `viewColumn` 落回原栏；② 重开后用内部命令 `moveActiveEditor` 挪回原下标。该命令在 VS Code 1.96 产物里存在（`Uq="moveActiveEditor"`），参数语义从反编译确认：`{to:"position", by:"tab", value}` 的 `value` 是 1 基下标、越界夹到末尾；**它作用于当前激活编辑器**，所以调用前核对激活标签就是刚重开那个，否则放弃（否则会挪走用户的标签）。新增 T-130/T-131 | `[Verified]`（命令与语义：本机 1.96 产物；位置还原效果**待人工实测**） |
| **第七次实测反馈**：位置对了，但「会闪一下」；另外「新会话点了刷新按钮才会出现在 codex 会话列表中」 | ① 闪是机制的固有代价：让 Codex 重写标题必须让它重新 `resolveCustomEditor`，而原地重解析被 VS Code 挡死——Codex 的 `supportsMultipleEditorsPerDocument: false` 对应内部 `singlePerResource`，`resolveEditor` 会 `findExistingEditorsForResource` 直接返回已开着的编辑器（1.96 产物反编译确认），所以「先关掉」是必要条件。② 新会话不进列表是另一个洞：空会话不在 `thread/list` 里，面板里发第一条消息那一刻没有任何事件通知插件（也不是我们的 webview），而运行状态追踪的候选集只从 `thread/list` 来（`selectCandidates`），所以没人刷新。用户给的方向是「只在点击对应会话条目时重新加载」——据此把整套后台自动同步删掉，改成点击时重载（`rowOpener.reloadUntitledTab`），并加 `newSessionWatch`（3 秒 / 10 分钟上限，标签关掉即放弃）解决新会话出现的问题 | `[Verified]`（原地重解析不可行：1.96 产物；点击重载与新会话轮询**待人工实测**） |

## 未做（明确排除）

- 会话改名导致的旧标签标题漂移（只处理标题仍是 `Codex` 的标签）。
- 清理「建了但没人聊」的空会话文件（不进列表，仅占磁盘）。

## 验证记录（2026-09-27 第四次 verify，含 Task 8 红证据补录）

### 闸门 1：全量测试

```
$ pnpm test
 Test Files  22 passed (22)
      Tests  178 passed (178)
$ pnpm typecheck    # tsc --noEmit，无输出 = 通过
```

test-plan：`{"pass": true, "stats": {"pass": 29, "todo": 0, "fail": 0, "total": 29, "red_missing": 0}}`，`all_pass: true`。29 条机器行全部 `🔴 RED ✅ PASS`；16 条已退役用例移出机器统计（见 test-plan.md「已退役用例（历史）」）。

### 闸门 2：场景覆盖率

本变更 spec delta 的 scenario 总数：**14**（`## REMOVED Requirements` 的 1 条只有 Reason/Migration，不计入；`## ADDED Requirements` 三个 requirement 合计 5 + 4 + 5）。

| Requirement | Scenario | 覆盖用例 |
|-------------|----------|----------|
| 新建会话（直接建会话并打开绑定标签） | 建会话成功后打开绑定标签 | T-101 |
| 同上 | 非 git 工作区仍然建会话并打开绑定标签 | T-124、T-125 |
| 同上 | 建会话任一步失败时回退空白面板 | T-102、T-116、T-117 |
| 同上 | 建会话失败时回退空白面板且不报错 | T-116、T-117（T-117 断言 `showErrorMessage` 未被调用） |
| 同上 | 落盘后必须等子进程退出才打开标签 | T-106、T-119 |
| 标题停在 Codex 默认值的标签在点击那一行时重载 | 点这一行就把标题还停在 Codex 的标签重载一次 | T-132、T-137 |
| 同上 | 标题已经正确的标签点开时只聚焦 | T-138 |
| 同上 | 重载失败也照样把这一行打开 | T-134 |
| 同上 | 会话没有打开的标签时按会话 id 打开 | T-136 |
| 新建会话出现后自动进入侧边栏 | 新会话出现后自动刷新侧边栏 | T-140、T-145 |
| 同上 | 建完就关掉标签不再等 | T-141 |
| 同上 | 超过等待上限就放弃 | T-142 |
| 同上 | 拉列表失败不算「等到了」，下一拍接着试 | T-143 |
| 同上 | 多个会话同时在等时按各自的进度处理 | T-144 |

覆盖率：**14/14 = 100%**。

### 闸门 3：设计一致性

```
$ node ~/.codex/hooks/openflow-gate.mjs check-design-consistency bind-new-session-tab
pass: true
blockers: []
warnings:
  - 声称未落地：改动点 6 声明改 `src/session/newSessionWatch.ts::createNewSessionWatch`，
    但 src/session/newSessionWatch.ts 在本次变更中没有任何改动——未实现，或文件路径写错
change_point_verdicts: 改动点 1 ✅ / 2 ✅ / 3 ✅ / 4 ✅ / 5 ✅ / 6 ⚠️ / 7 ✅
```

改动点逐条核验（落点 = **调用点**，不是定义行）：

```
改动点 1（声明 `src/session/sessionCreator.ts::createBoundSession`）：代码落点 = createBoundSession 调用点 src/extension.ts:170 → ✅
改动点 1（声明 `src/session/sessionCreator.ts::waitForChildExit`）：代码落点 = waitForChildExit 调用点 src/extension.ts:177 → ✅
改动点 2（声明 `src/commands.ts::createNewSessionCommand`）：代码落点 = createNewSessionCommand 调用点 src/extension.ts:470 → ✅
改动点 3（声明 `src/extension.ts::createBoundSessionInOneShot`）：代码落点 = createBoundSessionInOneShot 调用点 src/extension.ts:480 → ✅
改动点 3（声明 `src/extension.ts::gitInfoForWorkspace`）：代码落点 = gitInfoForWorkspace 调用点 src/extension.ts:152 → ✅
改动点 4（声明 `src/session/openTabs.ts::scanCodexTabs`）：代码落点 = scanCodexTabs 调用点 src/extension.ts:195 → ✅
改动点 5（声明 `src/extension.ts::reloadUntitledTab`）：代码落点 = reloadUntitledTab 注入点 src/extension.ts:500（`createRowOpener` 的 deps）→ ✅
改动点 5（声明 `src/extension.ts::putTabBack`）：代码落点 = putTabBack 调用点 src/extension.ts:298（在 `reloadUntitledTab` 内）→ ✅
改动点 5（声明 `src/session/rowOpener.ts::createRowOpener`）：代码落点 = createRowOpener 调用点 src/extension.ts:491 → ✅
改动点 6（声明 `src/session/newSessionWatch.ts::createNewSessionWatch`）：代码落点 = createNewSessionWatch 调用点 src/extension.ts:346 → ⚠️（见下）
改动点 6（声明 `src/extension.ts::deactivate`）：代码落点 = deactivate 内的收尾调用 src/extension.ts:602 `newSessionWatch?.stop();` → ✅
改动点 7（声明 `src/session/tabTitleSync.ts::resourceKey`）：代码落点 = resourceKey 调用点 src/extension.ts:229 / :247 / :275 / :276 → ✅
```

不随改的并行路径及理由（声明里的理由直接引用）：

- `src/commands.ts::createRenameSessionCommand` / `src/commands.ts::registerCommands`：属 rework-session-sidebar 变更，其 design.md 已声明（前者「失败只报错、取消不发请求」的范式引用，后者注册三个新命令）。
- `src/extension.ts::client`：本变更不碰它，那里的 spawn 包装来自前序提交 f246373。
- `src/session/tabTitleSync.ts::expectedTabTitle`：已随「后台自动同步」一起删除，本变更反向收缩（`grep -rn "expectedTabTitle\|planTabTitleSync" src/ test/` 无结果）。

**遗留 ⚠️（需用户裁定）**：`src/session/newSessionWatch.ts` 是本轮新增的**未跟踪**文件，`git diff --name-only` 看不见未跟踪文件，所以 gate 判它「在本次变更中没有任何改动」。反证：文件确实存在（`src/session/newSessionWatch.ts:33` 导出 `createNewSessionWatch`），且被 `src/extension.ts:346` 调用；单测 6 条全绿。消除该 ⚠️ 的办法是让文件进入 diff（提交，或 `git add -N`——后者有「提交时可能落空文件」的坑，不建议）。

### 闸门 4：场景断言核对

| 核对项 | 结果 |
|--------|------|
| T-101 ↔「建会话成功后打开绑定标签」 | ✅ GIVEN 对齐（`cwd=/repo` + 真实 gitInfo）；THEN 断言调用序列 `initialize → thread/start → thread/metadata/update{gitInfo} → thread/resume` 与 `openWith` 参数（`preview:false`）一致 |
| T-140 / T-145 ↔「新会话出现后自动刷新侧边栏」 | ✅ GIVEN 对齐（T-145 真的接上 3 秒轮询并让 `thread/list` 首次不含、随后含 `tid-new`）；THEN 断言 `refreshes > 0` 且轮询随后停表 |
| 必查 1：GIVEN 对齐 | ✅ T-125 用「既没有 `vscode.git` 也没有 Codex 扩展」构造真正的非 git 前提，而不是只改断言 |
| 必查 2：断言失败能力 | ✅ 29 行全部带 `🔴 RED`；其中 11 条是本次按 Task 8 逐条变异重放的（变异与失败输出见 test-plan.md「红证据补录」） |
| 必查 3：无跨用例委托 | ✅ 抽查 T-145（接线层）与 T-101（单元层）各自持有真对象断言，注释中无「真实断言见 T-xxx」式委托 |
