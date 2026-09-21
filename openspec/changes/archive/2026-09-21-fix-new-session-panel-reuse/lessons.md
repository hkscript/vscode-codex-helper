# 经验记录：fix-new-session-panel-reuse

## 设计决策

| 决策 | 结果 | 说明 |
|------|------|------|
| 新建会话不再委派 `chatgpt.newCodexPanel`，改为自造同路由 + 唯一 query 的 resource（D28） | ✅ | 在 Codex 声明 `supportsMultipleEditorsPerDocument: false` 的前提下，换 resource 是唯一能让 VS Code 开出第二个标签的办法；path 逐字保持 `/extension/panel/new`，webview 的路由匹配（只按 pathname）不受影响 |
| nonce 由注入的 `createNonce()` 提供，不在模块内直接调 `randomUUID`（D29） | ✅ | 「两次点击 = 两个 resource」是本次 bug 的核心不变量，注入后才可能在单测里被完整钉住；否则这条只能靠端到端点击验证 |
| 失败只报错，不回退委派、不静默重试（D30） | ✅ | 静默换成另一个入口会让用户以为「新建成功」，实际打开的可能不是他要的东西——与 `opener.ts` 的失败语义保持同一条线 |
| 放弃「首次委派 + 之后自造」的混合方案（D32） | ✅ | 混合方案会让第一次点击与后续点击的面板来自两套来源、URI 形态不一致；将来上游若支持多开，要删的是一整块分支而不是一个函数 |
| URI 契约继续收口在 `src/codex/conversationUri.ts`（D31） | ✅ | 上游改路由时只需改这一处，README 的「已知限制」也指向同一处 |

## 测试模式

| 模式 | 效果 | 代码位置 |
|------|------|----------|
| 「两次点击必须落到两个 resource」用 `resourceKey()` 全字符串比较 + 去重后计数 | ✅ | `test/unit/commands.test.ts::two_invocations_open_two_distinct_uris`——**注意** `test/helpers/fakes.ts` 的 `makeUri().toString()` 不含 query，用 `toString()` 比较会永远相等（假绿），必须自己拼 `scheme://authority+path?query` |
| 「按命令选择性抛错」的 fake，让失败路径用例在旧实现下也会红 | ✅ | `test/unit/commands.test.ts::shows_error_when_new_panel_open_fails`——第一版写成无差别抛错，旧实现（委派 `chatgpt.newCodexPanel`）也是绿的，等于零失败能力；改成「只有 `vscode.openWith` 抛错」后才取到红 |
| 把「被带到新 requirement 里的既有 scenario」记进 test-plan 的「既有覆盖」节，而不是硬塞一条 T 行 | ✅ | `test-plan.md`——沿用 archive 变更 41/41 的算法（既有行为由既有回归用例覆盖），避免为了凑 RED 造一条没有失败能力的用例 |
| 覆盖率分母只算本变更 spec delta 里的 scenario（REMOVED 块不计入） | ✅ | `verify-issues.md` 闸门 2 节；REMOVED 的旧 scenario 已在 spec delta 的 Reason 里写明为何被推翻 |

## 踩过的坑

1. **gate 的改动点归属会把「下一个声明的 JSDoc / 接口」算进上一个方法**：verify 时 `check-design-consistency` 报了 4 条归属漂移 warning，全部指向 `createRenameSessionCommand`（`src/commands.ts:41`），实际落点是第 69/77/79/84 行——那些行是新函数 `createNewSessionCommand` 的注释块与 `NewSessionCommandDeps` 字段，而新函数声明在第 88 行。**解决方案**：在 `verify-issues.md` 里逐条给代码证据（88 行才是声明、84 行是接口字段且唯一消费者是 93 行的 `deps.createNonce()`、41-63 行零 hunk），并按 gate 的 `⚠️ → 后续 ✅` 解析规则把每条显式标成已处置；不要用「启发式误报」一句话带过。

2. **`check-verify-prerequisites` 会被 verify-issues.md 里任何未闭合的 ⚠️ 阻塞**：闸门内部是个状态机——遇到 `⚠️`/`❌` 开一个条目，之后遇到 `✅` 关闭**最近一个**未关闭条目；文档里只要留一条没有 ✅ 的 ⚠️，`write-verify-receipt` 就报 `1 个 verify 警告（⚠️）未解决`。**解决方案**：每条 ⚠️ 后面补一条写清理由的 ✅ 处置行（哪怕结论是「可接受、不阻塞」），再签 receipt。

3. **`.openflow/gate.config.json` 的 `base_branch` 必须指向本变更基线**（archive 变更坑 1 的延续）：build 一开始就把它改成当时的 HEAD（本次为 `7ea06de`）。否则 `git diff <base>...HEAD` 会把上一个变更的提交全部算进来，改动文件对账变成噪声。**解决方案**：进入 build 的第一件事就是写这个文件；同时也是「未提交改动」能落进 diff 的原因。

4. **负空间断言（T-005 形状）无法区分「守卫被破」与「函数被删」**：`parseConversationId(新面板 URI) === null` 在本变更之前也是绿的，RED 只来自 `buildNewPanelUri` 尚未导出。**解决方案**：不为凑 RED 编造断言，而是把这条边界记进 test-plan 的「既有覆盖」+ verify-issues 的 ⚠️ 处置，并指出 `openTabs.test.ts` 与 `sessionStore.test.ts::shows_unnamed_new_panel_in_open_group` 一起兜底。这是守卫型用例的固有边界，写清楚比假装没有更有价值。

5. **不能靠「调用次数」证明多开能力**：`+` 的旧实现在点第二次时**也**会成功调用 `chatgpt.newCodexPanel`（命令层不报错），问题出在 VS Code 对同一 resource 的编辑器复用。**解决方案**：断言必须落在 resource 身份（scheme/authority/path/query）上，而不是「调用发生了几次」。

6. **`pnpm test -- <名字>` 不会过滤**（archive 变更坑 3 的复现）：单文件跑用 `npx vitest run test/unit/commands.test.ts`，否则看到的是全量结果、容易误判「过滤后依然全绿」。

## 可复用代码模式

- `src/codex/conversationUri.ts::buildNewPanelUri`：自造上游自定义编辑器的 URI 时，「path 逐字照抄 + 用 query 承载我们需要的新身份」。query 是 Codex `dI()` 会带进 `initialRoute`、而 webview 路由只按 pathname 匹配的那部分——在被「同一 resource 只能有一个编辑器」卡住时，这是最小改动面。
- `test/unit/commands.test.ts::makeNewSessionDeps` + `resourceKey()`：命令层测试夹具三件套（记录调用参数的 `executeCommand`、可注入的 nonce 序列、`createFakeUriApi()`），配合 `resourceKey()` 直接断言 VS Code 的 resource 身份，而不是断言「调用了几次」。
- `test/unit/commands.test.ts::shows_error_when_new_panel_open_fails`：失败路径用例的 fake 必须**按命令选择性抛错**——无差别抛错会让用例在旧实现下也是绿的，等于没有失败能力。
- `openspec/changes/*/test-plan.md` 的「## 既有覆盖（本次不新增用例，靠现有回归守住）」小节：当 requirement 块被整体重写、旧 scenario 被带进新块时，用它记录「哪个既有用例覆盖哪条 scenario」，覆盖率分母才站得住。
