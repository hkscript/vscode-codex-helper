# 经验记录：add-codex-session-sidebar

## 设计决策

| 决策 | 结果 | 说明 |
|------|------|------|
| D1 自起裸 `codex app-server` 子进程，不用 `app-server proxy` | ✅ | proxy 依赖已运行的 daemon；裸 `app-server` 实跑通过（`initialize` + `thread/list` 拿到 6 条真实会话），无外部前置条件 |
| D3 懒启动 + `deactivate` 回收子进程 | ✅ | 每窗口一个 250MB 二进制，侧边栏没被打开时零成本；`deactivate` 里 `dispose()` 回收 |
| D4「打开」与「聚焦」共用 `openWith` | ✅ | **实测证实**：同一 URI 连调两次，标签数保持 1（`reusedSameTab: true`） |
| D7 关键词过滤双层（服务端 `searchTerm` 扩大召回 + 本地同一谓词统一判定） | ✅ | `INV-002` 用独立推导的谓词复核，保证「显示出来的每一项都匹配」 |
| D8 置顶列表不作为会话来源（既不在服务端也无标签页的 id 直接丢弃） | ✅ | 由 `T-035` 钉住；状态矩阵第 11/12 行正是它暴露出来的行为 |
| D9 打开失败不得回退成新建 | ✅ | 与新增的「新建会话」是两条不同调用点（一条禁止、一条执行），spec 与 design D12 都写明了这层关系 |
| D12 新建会话委派 `chatgpt.newCodexPanel`（无参） | ✅ | Codex 的 handler 用 `Te?.source` 可选链取参，无参调用安全；不为它额外触发刷新，靠已订阅的 `onDidChangeTabs` |
| D13 分组默认展开（open/pinned `Expanded`、history `Collapsed`） | ✅ | 只提供默认值，用户手动折叠后的状态交给 VS Code 按 `TreeItem.id` 记忆 |

## 测试模式

| 模式 | 效果 | 代码位置 |
|------|------|----------|
| 业务判定收进纯模块，`vscode` 整体 alias 成 stand-in | ✅ | `vitest.config.ts` 的 alias + `test/helpers/fakes.ts`；10 个测试文件 42 个用例全部在 node 里跑，无需 GUI |
| 组合不变量 + 反空转护栏 | ✅ | `test/unit/sessionStore.test.ts::every_session_appears_in_exactly_one_group`（末尾断言 `visible=6`/`dropped=2`，防止循环被写成永不进循环的假绿） |
| 负空间断言必须配正空间断言 | ✅ | `test/unit/opener.test.ts::shows_error_and_never_creates_new_panel_on_open_failure`：既断言 `resolves.toBe(false)` + 错误消息含会话 id，又断言命令列表不含 `chatgpt.newCodexPanel` |
| 回归守卫用变异校验证明失败能力 | ✅ | `T-039`：把 `open-tab:${index}` 临时写成常量 → `expected length 2 but got 1` → 立刻还原；凭据记在 `test-plan.md` 的「RED 凭据」节 |

## 踩过的坑

1. **greenfield 仓库让「改动点归属对账」整段空转**。本仓库只有 `master` 一个 ref 且 HEAD 就在其上，gate 的基准分支探测取到 `master` ⇒ `git diff master...HEAD` 为空 ⇒ `check-design-consistency` 把 21~23 条声明全判成「该文件在本次变更中没有任何改动」（warning 级、`blockers` 为空，很容易被当成"改动没落地"）。解决：定性为「gate 看不到变更集」，按 verify.md 指定的兜底逐条人工核验并把结论写进 `verify-issues.md`；想恢复自动化对账，就在 build 起始时配 `.openflow/gate.config.json` 的 `base_branch` 指向变更前基线（本仓库可用空树提交作基线，命令已记在 verify-issues.md）。

2. **Codex enforcement hook 表达不了 build.md 自己要求的记账写回**。task-build 只允许改「该 task `Files:` 里声明的文件或选择器文件」，而 build 流程要求写 test-plan 的 `🔴 RED`/`✅ PASS` 后缀与 plan-ready 的 checkbox，两者直接冲突。解决：把这些文件（含变异校验要临时碰的 `src/session/sessionStore.ts`）**显式声明进该 task 的 `Files:` 并注明理由**——比用 shell 绕过 hook 透明得多，也让 review 的人一眼看到"这次触碰是流程性的"。

3. **回归守卫天生拿不到 RED**。`T-039` 断言的是先前 task 已实现的「两个 `id: null` 标签各占一项」，实现还在时它直接绿；而 gate 要求每个 `✅ PASS` 都必须配 `🔴 RED`。解决：做一次变异校验（把合成 id 写坏 → 看到它红 → 立刻还原），把「红的形状 + 还原事实」写进 test-plan，而不是伪造一个 RED 蒙过闸门。

4. **远程 WSL 的 `code` CLI 不支持 `--extensionDevelopmentPath`**。想无人值守起 Extension Development Host 时得到 `Ignoring option 'extensionDevelopmentPath': not supported for code`（WSL 里那个 `code` 是 remote-cli，不转发该选项）。解决：把一次性探针扩展**临时装进 `~/.vscode-server/extensions/<publisher>.<name>-<version>/`**，放一个 autorun 哨兵，`onStartupFinished` 自动跑并把结果写到 `/tmp`；再用 `code --new-window <空目录>`（这个选项支持）开窗口把它带起来，跑完把探针目录移出。整套 GUI 相关的 spike 因此不需要人点一下。

5. **verify 凭据的指纹包含 HEAD**。`lifecycle-fingerprint.mjs` 的 preimage 里有 `HEAD\0<sha>`，所以顺序必须是**先提交、再 `write-verify-receipt`**；反过来会让凭据立刻 stale、`check-verify-ready` 直接拒绝。豁免名单只有 `.openflow/phase`、`.openflow/building` 与变更目录下的 `verify-issues.md`/`verify-result.json`/`lessons.md`/`tasks.md`。

6. **补列 `resources/codex.svg` 不会造成对账 blocker**。gate 的 `FILE_PATH_RE` 不含 `svg`，`collectPaths`/`extractFilePaths` 还会跳过 `.md` 与 `openspec/` 前缀 ⇒ design「改动文件」里补一个 svg 是安全的，不会因为 git 侧看不到它而被判「清单里有但没改」。

7. **「读机器上实际安装的构建」能提前钉死假设**。判定 `TabInputCustom.viewType` 是否带前缀时，客户端 `vscode-dts/vscode.d.ts`（随安装分发）+ 客户端 bundle 里唯一的前缀机制 `new YTi("mainThreadWebview-")`（只服务 webview panel，并在 API 边界用 `toExternal()` 剥掉）已足以定论，运行时探针随后证实。比读编辑器源码更贴近运行时事实，且成本极低（`/mnt/c` 下可直接读 Windows 侧安装）。

## 可复用代码模式

- `src/codex/appServerClient.ts`：NDJSON 分帧 + 请求 id 路由 + 超时清理 + `dispose` 拒绝在途请求的极简 JSON-RPC over stdio 客户端（`consume`/`settle`/`send`/`start`），任何"spawn 子进程讲行分隔协议"的场景可照抄。
- `src/session/sessionStore.ts`：多来源合并成**互斥**分组的纯函数，并用合成 id（`open-tab:<index>`）给「没有 id 的来源」兜底，使「每个 id 恰好出现一次」这条不变量仍成立。
- `src/codex/binary.ts::resolvePlatformBinDir`：复刻宿主扩展的平台目录映射（win32→windows、darwin→macos、linux/aix/android/freebsd/…→linux；x64→x86_64、arm64→aarch64），避免硬编码带版本号的安装目录。
- `test/helpers/fakes.ts` + `vitest.config.ts` 的 `vscode` alias：一套注入式 fake（UriApi / Memento / `child_process.spawn` / vscode 模块 stand-in），让"必须 import vscode"的模块照样能在 node 里单测。
- `src/ui/treeProvider.ts::defaultCollapsibleState`：TreeItem 的**默认**折叠状态按组区分，只给默认值、不覆盖用户已做的展开/折叠选择。
- `/tmp/openflow-spike/extension.js`（一次性、未入库）：autorun 探针写法——`onStartupFinished` + 哨兵文件 + 结果落盘 + 可选 `require` 被测扩展产物，用于任何"必须真 GUI 才能验"的契约。
