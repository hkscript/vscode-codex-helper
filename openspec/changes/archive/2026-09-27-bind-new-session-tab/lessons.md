# 经验记录：bind-new-session-tab

## 设计决策

| 决策 | 结果 | 说明 |
|------|------|------|
| 用**一次性** `codex app-server` 子进程建会话，而不是复用常驻 client | ✅ | `thread/resume` 会持有该会话的 writer 锁，常驻进程活着时 Codex 面板（另一进程）的 resume 必被拒 `already has an active writer`，`thread/unsubscribe` 放不掉；一次性进程退出即释放。落点 `src/session/sessionCreator.ts:85` + 退出闸 `waitForChildExit` |
| 用 `thread/metadata/update {gitInfo}` 触发落盘，不用 `thread/name/set` | ✅ | probe 实测：`name/set` 能把 rollout 落盘，但会把会话名固定住、顶掉 Codex 的自动标题（turn 完成后 `list.name` 仍是所设名字）；`metadata/update` 是唯一既非破坏性又能落盘的状态写入 |
| 非 git 工作区写**全零 sha 占位**而不是放弃建会话 | ✅ | `thread/metadata/update` 要求至少一个字段，`{threadId}` 与 `gitInfo:{}` 都被拒；Codex 前端只读 `branch`/`originUrl`，sha 不上界面，所以占位对用户不可见 |
| 标题修正只能靠「关标签 + 用同一 resource 重开」 | ✅（但代价受限） | VS Code 没有原地重新解析；Codex 自定义编辑器 `supportsMultipleEditorsPerDocument:false` ⇒ `singlePerResource`，同 resource 再 resolve 只会拿回已开着的编辑器。因此重开是**必要条件**，而它的观感代价（白一下、草稿丢）只应由用户点击承担 → 后台自动同步整条退役 |
| 重开必须带 `viewColumn` 并用 `moveActiveEditor` 挪回组内下标 | ✅ | 不带 `viewColumn` 会开在当前激活栏；新编辑器永远追加到组内末尾。`moveActiveEditor` 作用于**当前激活编辑器**，所以挪之前必须核对激活的正是刚重开那个，否则宁可不挪 |
| 空会话不进 `thread/list` 且无事件通知 → 用有界轮询兜 | ✅ | `newSessionWatch`：3 秒一拍、10 分钟上限、标签关掉即放弃、不比对搜索结果（用户开着过滤不等于会话没出现） |

## 测试模式

| 模式 | 效果 | 代码位置 |
|------|------|----------|
| 假子进程逐条回包：把 app-server 协议当契约测，不碰真进程 | ✅ | `test/helpers/fakes.ts`、`test/unit/sessionCreator.test.ts` |
| 注入式纯逻辑：计时器、时钟、IO、刷新全部由调用方注入，单测手动 tick | ✅ | `src/session/newSessionWatch.ts` + `test/unit/newSessionWatch.test.ts`（6 条覆盖收敛/关标签/超时/失败重试/多会话） |
| **变异重放红**：断言已存在、实现已写好、但缺「跑红记录」时，把实现临时变回去看它红，再精确恢复 | ✅ | 做法与逐条失败输出见 `test-plan.md`「红证据补录（Task 8）」；四个被变异文件恢复后与基线 sha256 逐字一致 |
| 已退役用例用 `- \`T-xxx: …\`` 前缀留档 | ✅ | 既保留审计轨迹，又不进机器统计（见 `test-plan.md`「已退役用例（历史）」） |

## 踩过的坑

1. **`waitForChildExit` 必须先挂监听再 kill**：反过来时进程可能在监听装上之前就退出，白等一个 2 秒超时（单测实测 2006ms）。解决方案：先 `waitForChildExit(child)` 拿到 promise，再 `dispose()`/kill，最后 `await`；T-106 的耗时断言把这条钉住了。
2. **`git diff` 看不见未跟踪的新文件**：gate 因此判「改动点 6 声明改 `newSessionWatch.ts`，但该文件在本次变更中没有任何改动」（`check-design-consistency` 唯一 warning，`change_point_verdicts` 改动点 6 因此 ⚠️）。解决方案：把「文件存在 + 被 `src/extension.ts:346` 调用 + 单测全绿」作为反证写进 `verify-issues.md` 并请用户确认；**不要**用 `git add -N` 绕过——intent-to-add 之后若直接 `git commit` 会落成空文件。根治办法是让实现进入提交。
3. **spec delta 用 `MODIFIED` 改一个已经改过名的 requirement，`openspec archive` 会拒**（`MODIFIED failed for header ... - not found`），而且 `openspec validate` 只给 INFO 不报 ERROR——不主动看 INFO 就会一直带到 close 才炸。解决方案：改成 `## REMOVED Requirements`（旧名，带 Reason/Migration）+ `## ADDED Requirements`（新名）。
4. **`MODIFIED` 块必须包含基线里的全部 scenario 名**（`findMissingCurrentScenarios` 会拒绝漏掉任何一条，避免归档时静默丢场景）；改了行为就把同名 scenario 的正文改写，别改名、别删。
5. **plan-ready 的 checkbox 是全文扫的**：正文里写字面量方括号会让 `check-build-done` 认为还有未完成任务（`tasks_not_all_done`）。解决方案：说明文字里不要出现方括号任务项的字面形态。
6. **design.md 的声明行语法对理由很挑**：`- 并行路径：\`file::method\` → 不随改（理由）` 的理由部分不能出现右括号——`client()` 这种写法会让整行解析失败，gate 直接判 blocker。解决方案：理由里去掉括号。
7. **receipt 的指纹把 HEAD 也算进去**：verify 之后若提交代码，`check-verify-ready` 立刻报 `receipt-stale-head` + `receipt-stale-fingerprint`，而 `archive-verified` 会在归档前复核 receipt。解决方案：先 close 归档再提交，或先提交再重跑 verify。
8. **新会话的第一个回合没有任何事件通知插件**（面板 webview 不是我们的；运行状态候选集只来自 `thread/list`）：所以「点了 `+` 侧边栏没新行」不能靠事件修，只能靠有界轮询。这也是「先做证据、再做结论」的一个例子——先把信号源列全（事件 / 列表 / 标签），再决定机制。

## 可复用代码模式

- `src/session/newSessionWatch.ts`：**依赖全注入的有界轮询**（`now` / `setInterval` / `listThreadIds` / `openTabIds` / `refresh`），规则纯逻辑、可在单测里手动 tick 穷举边界（收敛即停、标签关掉即停、超上限即停、拉列表失败不算等到）。
- `src/session/sessionCreator.ts::waitForChildExit`：**先挂监听再 kill，超时兜底且永不抛**——凡是「必须等子进程退出才能继续」的场景都能直接复用。
- `src/session/rowOpener.ts::createRowOpener`：**可选依赖降级**（`reloadUntitledTab?` 返回 `false` 就退回 `revealTab`），让「新机制失败」永远不会让主路径打不开。
- `test-plan.md` 的「已退役用例（历史）」小节：用列表前缀破坏机器行语法，同时保留 `T-xxx` 编号与废弃原因，兼顾审计与统计。
- 变异重放红的操作模板：一次性施加同文件组的变异 → 逐条 `npx vitest run <file> -t <用例名>` 留失败输出 → 一次性精确恢复 → `sha256sum -c` 对基线核验 → 全量套件复绿。注意变异之间会互相带出别条用例的红（本次 T-144 就被 T-140 的变异带红过），**每条红都必须在自己的断言上**，否则单独重跑。
