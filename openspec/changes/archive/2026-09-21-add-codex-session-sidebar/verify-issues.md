# verify 记录：add-codex-session-sidebar

- 变更：`add-codex-session-sidebar`
- 环境：`/home/hk/github/vscode-codex-helper`（分支 `master`），VS Code 1.126.0（remoteName `wsl`）
- 范围：42 个测试 / 40 个 scenario（含 amend 后新增的 `T-037`~`T-040`）
- 结论：**通过**——闸门 1/2/4 通过，闸门 3 逐条核验全绿（两条方法名漂移已同步），端到端 spike 已实测通过。上一轮的三项未解决里两项已消解、一项按用户确认记录为接受。

## 闸门 1：全量测试

✅ 实跑 `pnpm test`（`vitest run`）：`Test Files 10 passed (10)` / `Tests 42 passed (42)`。`pnpm typecheck`（`tsc --noEmit`）exit 0；`pnpm run build`（esbuild）exit 0，产物 `dist/extension.js` 23.1kb。

## 闸门 2：场景覆盖率

✅ `specs/codex-session-sidebar/spec.md` 的 40 个 `#### Scenario:` 与追溯表 40 条 T 行一一对应（另 2 条 `INV`）；脚本比对：未被追溯的 scenario `[]`、追溯表里 spec 不存在的 scenario `[]`、映射表 42 行且与追溯表 selector 逐行一致。

✅ gate `check-test-plan`：`pass 42 / todo 0 / fail 0 / red_missing 0`；`check-cross-ref`：`42 tests, all covered by plan-ready tasks`。42 行全部同时带 `🔴 RED` 与 `✅ PASS`（`T-039` 的 RED 来自变异校验，凭据见 `test-plan.md`）。

## 端到端 spike（本轮新增，真实运行时证据）

✅ 用一次性探针扩展在真实 VS Code（1.126.0 / wsl remote / Codex 扩展 26.908.40401）里无人值守跑通，`/tmp/openflow-spike/result.json` 原文要点：

```json
{
  "vscodeVersion": "1.126.0", "remoteName": "wsl", "platform": "linux-x64",
  "codexExtension": { "id": "openai.chatgpt", "version": "26.908.40401" },
  "conversationId": "01a0becc-10ff-7a00-8574-923d5b93bae0",
  "calls": [
    { "round": 1, "ok": true, "error": null, "tabCountAfter": 1 },
    { "round": 2, "ok": true, "error": null, "tabCountAfter": 1 }
  ],
  "verdicts": {
    "openWithSucceeded": true, "openWithError": null, "reusedSameTab": true,
    "tabCountBefore": 0, "tabCountAfter": 1,
    "codexTabViewTypes": ["chatgpt.conversationEditor"],
    "viewTypeMatchesExactly": true,
    "codexTabUris": ["openai-codex://route/local/01a0becc-10ff-7a00-8574-923d5b93bae0"]
  },
  "afterTabs": [
    { "label": "查询 VSCode 插件互相调用", "input": "Id",
      "viewType": "chatgpt.conversationEditor",
      "uri": "openai-codex://route/local/01a0becc-10ff-7a00-8574-923d5b93bae0" }
  ]
}
```

这三条同时钉死了三件事：

✅ `vscode.openWith(Uri.parse('openai-codex://route/local/<id>'), 'chatgpt.conversationEditor', {preview:false})` **成功恢复指定历史会话**——新标签的标题 `查询 VSCode 插件互相调用` 正是该 id 的会话名（不是新建的空会话）。这是本变更的核心价值点，此前只有静态推导。

✅ `TabInputCustom.viewType` 实测 = `chatgpt.conversationEditor`，**不带前缀**。design §2.3 的 `[Assumption]`「viewType 原样返回注册时的 viewType」以及 `openTabs.ts` 的判定条件由此证实（此前 `T-015` 把假设值当夹具，无法证伪它）。

✅ 同一 URI 连续调用两次，标签数保持 `1`（`reusedSameTab: true`）→ design D4「同一 URI 复用既有编辑器而非新开」成立。

补充静态旁证（读的是这台机器上实际安装的构建）：Codex 的 `package.json` 里 `customEditors[0].viewType` 就是不带前缀的 `chatgpt.conversationEditor`；客户端里唯一的前缀机制是 `new YTi("mainThreadWebview-")`，专用于 **webview panel** 的编辑器 id，并在 API 边界用 `toExternal()` 剥掉（webview 面板的 markdown/simpleBrowser/browserPreview 才有前缀，且 `contributes.customEditors` 里的 viewType 一律不带前缀）。

探针是一次性产物：装在 `~/.vscode-server/extensions/hkscript.openflow-spike-0.0.1` 跑完后已移出到 `/tmp/openflow-spike-installed-removed`（可恢复），仓库内无任何残留。

## 闸门 4：场景断言核对

✅ 关键路径逐条核对过：T-035/T-036（幽灵置顶 / 列表外已打开项）GIVEN 与 scenario 同构；T-017 夹具就是 scenario 里的 `/extension/panel/new`；T-020 的 `not.toContain('chatgpt.newCodexPanel')` 检查 fake 实际收到的命令、具备失败能力且与正空间断言配对；T-037 断言 `calls[0]` 严格等于 `['chatgpt.newCodexPanel']`（等价于「不传参数」）；T-039 断言全为正空间（长度 2 + 两个 id 互不相同），失败能力由变异校验实测；T-040 能区分 1 与 2。

✅ 无跨用例委托：`grep -rn "真实断言|见 T-|另一个测试|委托" test/ src/` 0 命中。

✅ `INV-001` / `INV-002` 带反空转护栏（`visible=6`/`dropped=2`、`rendered>0`/`matchedNonEmpty>0`），且 INV-002 用独立推导的谓词复核、不拿被测函数自证。

## 闸门 3：设计一致性

### 改动点逐条核验（读当前代码）

改动点 1（声明 `src/codex/binary.ts::resolveCodexBinary`）：代码落点 = `resolveCodexBinary`@44 → ✅
改动点 1（声明 `src/codex/binary.ts::resolvePlatformBinDir`）：代码落点 = `resolvePlatformBinDir`@35（调用点 @63）→ ✅
改动点 2（声明 `src/codex/appServerClient.ts::start`）：代码落点 = `start`@147（返回对象 @182 暴露）→ ✅
改动点 2（声明 `src/codex/appServerClient.ts::request`）：代码落点 = `request`@183 → ✅
改动点 2（声明 `src/codex/appServerClient.ts::consume`）：代码落点 = `consume`@100（兄弟 `consumeStderr`@117；stdout 监听 @158）→ ✅
改动点 2（声明 `src/codex/appServerClient.ts::dispose`）：代码落点 = `dispose`@195（`rejectAll` @199、`kill` @203）→ ✅
改动点 3（声明 `src/codex/conversationUri.ts::buildConversationUri`）：代码落点 = `buildConversationUri`@16 → ✅
改动点 3（声明 `src/codex/conversationUri.ts::parseConversationId`）：代码落点 = `parseConversationId`@24 → ✅
改动点 4（声明 `src/session/openTabs.ts::scanCodexTabs`）：代码落点 = `scanCodexTabs`@19（viewType 比对 @37、解析 @40）→ ✅
改动点 5（声明 `src/session/sessionStore.ts::buildSessionGroups`）：代码落点 = `buildSessionGroups`@52（三组 81-105、幽灵剔除 @94、统一过滤 115-119）→ ✅
改动点 5（声明 `src/session/sessionStore.ts::matchesFilter`）：代码落点 = `matchesFilter`@33（调用点 @117）→ ✅
改动点 6（声明 `src/session/opener.ts::openSession`）：代码落点 = `createSessionOpener().openSession`@26 → ✅
改动点 7（声明 `src/session/pinStore.ts::pin`）：代码落点 = `createPinStore().pin`@31 → ✅
改动点 7（声明 `src/session/pinStore.ts::unpin`）：代码落点 = `createPinStore().unpin`@36 → ✅
改动点 7（声明 `src/session/pinStore.ts::list`）：代码落点 = `createPinStore().list`@29 → ✅
改动点 8（声明 `src/ui/treeProvider.ts::getChildren`）：代码落点 = `getChildren`@105 → ✅
改动点 8（声明 `src/ui/treeProvider.ts::getTreeItem`）：代码落点 = `getTreeItem`@119（分组默认状态 @121 调 `defaultCollapsibleState`@70）→ ✅
改动点 8（声明 `src/ui/treeProvider.ts::refresh`）：代码落点 = `refresh`@151 → ✅
改动点 9（声明 `src/commands.ts::registerCommands`）：代码落点 = `registerCommands`@89（9 条注册 91-107，含新增 `codexHelper.newSession` @95）→ ✅
改动点 9（声明 `src/extension.ts::activate`）：代码落点 = `activate`@30 → ✅
改动点 9（声明 `src/extension.ts::deactivate`）：代码落点 = `deactivate`@180（`appServer?.dispose()` @183）→ ✅
改动点 10（声明 `src/commands.ts::createNewSessionCommand`）：代码落点 = `createNewSessionCommand`@79（`executeCommand('chatgpt.newCodexPanel')` @82、catch → `showErrorMessage` @84）→ ✅
改动点 10（声明 `src/extension.ts::activate`）：代码落点 = `activate`@30（构造 @114、装配 @132）→ ✅

上一轮标记方法名不一致的两条已在 amend #2 同步到代码实际标识符（`handleStdoutChunk`→`consume`、`build`→`buildSessionGroups`，另外 §3.3 数据流的 `SessionStore.build(...)` 与改动点 4 的上游引用、`pins`→`pinnedIds` 一并更正）。同步后 22 条声明全部与代码一致，无 ⚠️ 残留。

### gate 自动化对账的基线问题（已按用户确认记录为接受）

`check-design-consistency` 的变更集来自 `git diff <base>...HEAD` + 工作区 + 暂存区；base 由 gate 探测（`.openflow/gate.config.json` 的 `base_branch`，否则依次试 `main`/`master`/…）。本仓库只有 `master` 一个 ref 且 HEAD 就在 `master` 上 → `git diff master...HEAD --name-only` 输出 0 行 → 23 条 warning 全落在「该文件在本次变更中没有任何改动」这个文件级分支（`blockers` 为空，无归属漂移/完整性告警）。

证据：`git rev-parse HEAD` == `git rev-parse master`；`git diff master...HEAD --name-only | wc -l` = `0`；`git for-each-ref` 仅 `refs/heads/master`；9 个 `src/` 文件均为本变更历史里新增（`git log --diff-filter=A`：binary.ts `d42f73a`、appServerClient.ts `c942c4d`、conversationUri.ts `054b02d`、openTabs.ts `cd6bcc2`、sessionStore.ts `a7e4c45`、opener.ts `b9abcf0`、pinStore.ts `72cf634`、treeProvider.ts `14bfd7a`、commands.ts `3da09dc`、extension.ts `054b02d`）。

✅ 记录：本仓库是 greenfield（全部代码都是本变更新增），即使配上变更前基线，自动化归属核对也只能得到「声明的方法确实存在于声明的文件里」这一等价结论——与上面逐条核验的信息量相同（无法再区分「改 A 落到 ANew」，因为不存在 ANew）。经用户确认，本轮以**人工逐条核验 + 运行时 spike** 作为该自动化对账的替代证据。

想要以后也能跑自动化对账时的启用方式（两行，在 build 阶段或工作流外执行）：
```bash
git branch openflow-baseline "$(git commit-tree "$(git hash-object -t tree /dev/null)" -m 'openflow: pre-change baseline (empty tree)')"
printf '%s\n' '{"base_branch":"openflow-baseline"}' > .openflow/gate.config.json
```

## 已知残余风险（已记录，不阻塞本轮 verify）

- `thread/name/set`（重命名写回）只经单测与官方 schema 验证，尚未对真实 app-server 实调一次；`thread/list` 的真机协议形状已由本次探针（initialize + thread/list 返回 6 条真实会话）验证。
- 侧边栏的树渲染（分组节点、图标、菜单项）只在 fake 的 `vscode` 模块下由单测覆盖，未在真实 UI 里人工走查；`openWith` 与 viewType 判定已由探针在真实运行时验证。
- `registerCommands` 的注册表本身没有被任何测试断言（命令 id 写错只有人工点按钮才发现）——与既有 8 条命令的覆盖方式一致；要收紧可加一条断言注册 id 集合的用例（约 10 行）。

## 闸门 6：凭据写入

✅ 上述五项齐备后写入 `verify-result.json`（`testRuns: full-suite exitCode 0`、`scenarioCoverage: 40/40`、`designConsistency.blockers: []`、`userConfirmation.received: true`），并经 `write-verify-receipt` 复核前置条件与工作区指纹。
