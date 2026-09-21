# 会话运行中标识 + 置顶不被打开状态掏空

## Why

侧边栏现在看不出「哪个会话正在跑」——用户要逐个点开标签页才知道 Codex 是否还在执行回合，多窗口/多会话并行时尤其盲。同时现有分组优先级是 `open > pinned > history`，一个会话被打开后就从「置顶」组消失，用户主动置顶的入口反而在最需要的时候不见了，且条目上没有任何置顶痕迹，无法区分「这条只是打开着」还是「这条我特意置顶过」。

## What Changes

- **新增运行中判定（回合状态 + 归属存活，双信号，无时间阈值）**：
  - 回合状态用 `thread/turns/list {threadId, limit: 1, sortDirection: 'desc'}` 主动查询。实测：跨进程读到的**正在执行中的回合**报 `status: "interrupted"` 且 `completedAt: null`——`inProgress` 只存在于持有该回合的那个进程的内存视图里，别的进程看不到（原提案的假设已被实测推翻）。判定用的谓词因此是「**最新回合 `interrupted` 且 `completedAt` 为 null**」＝ 没有任何终止记录。
  - 「没有终止记录」有两种成因：正在跑，或进程中途死了。用**归属存活**信号区分：该会话的 rollout 文件是否被一个存活的 codex app-server 进程持有（Linux 扫 `/proc/<pid>/fd`，实测 2–3ms）。
  - 两个信号同时成立才显示运行中标识。**时间阈值不参与判定**，长思考的写入间隙天然不影响结果。
- **新增候选预筛**：一次 `/proc` 扫描即可拿到「当前被存活进程持有的 rollout 文件」集合 = 各进程已加载的会话集合（实测 ChatGPT 插件的 app-server pid 12990 持有 4 个，对应它开着的 4 个会话）。正在跑的会话必然在这个集合里，所以候选通常个位数，再对候选发 `thread/turns/list`。
- **新增运行状态订阅**：对候选会话的 rollout 文件建立 `fs.watch`（带去抖），文件追加时重新查询并刷新树；watcher 建立失败时退化为定时轮询兜底。
- **非 Linux 平台降级**：拿不到 `/proc` 的平台（macOS / Windows）用「最新回合 `interrupted` + `completedAt` 为 null + rollout 文件 mtime 在宽松阈值内（分钟级）」近似，并在 spec 里写清各平台行为差异。
- **改分组规则（BREAKING，影响现有 spec）**：置顶会话不再被「已打开」组掏空——同一会话可同时出现在「已打开」和「置顶」两组。这会推翻现有 spec 的 `Scenario: 已打开优先于置顶，不重复出现`，并要求树节点 id 按分组区分（`session:open:<id>` / `session:pinned:<id>`），否则 VS Code 按 `TreeItem.id` 记忆折叠状态的机制会撞车（archive lessons D13）。
- **新增条目标识呈现**：运行中用图标位表示（非运行中保持现有 `window` / `comment-discussion` 图标）；置顶用 `description` 文字后缀表示，两种状态可同时显现。
- **保持不变**：「置顶列表不作为会话来源」仍然成立——服务端查不到的陈旧置顶 id 继续丢弃，不显示幽灵条目（archive lessons D8）。过滤谓词对新增的重复行同样适用。

## Impact

- Affected specs: `codex-session-sidebar`（`树视图组织与过滤`、`会话置顶` 两个 requirement 需修订；新增「会话运行状态」requirement）
- Affected code:
  - `src/codex/types.ts`（`Thread` 增加 `path`；新增 `Turn` / `TurnStatus`；`SessionItem` 增加 `running`）
  - `src/codex/threadApi.ts`（新增 `listTurns`，透传 `path`）
  - `src/session/sessionStore.ts`（分组优先级与 `taken` 去重逻辑）
  - `src/ui/treeProvider.ts`（节点 id、图标、description、contextValue）
  - 新增归属存活探测模块（`/proc` 扫描 + 平台分支，解析逻辑可单测）
  - 新增运行状态聚合模块（预筛 → 查询 → 判定，注入式依赖，可单测）
  - 新增 rollout 文件监听模块（`fs.watch` + 去抖 + 轮询兜底 + ENOENT 处理）
  - `src/extension.ts`（接线：候选筛选、watcher 生命周期、刷新触发）
  - `package.json`（兜底轮询间隔、非 Linux 兜底阈值等配置项；置顶菜单 `when` 表达式随 contextValue 变化调整）
  - 测试：`test/unit/sessionStore.test.ts`、`test/unit/treeProvider.test.ts` 需改（重复行、新标识）

## Verified Facts

在写本提案前实跑验证（铁律 1）。运行中场景用两个独立 app-server 子进程复现：P1 起线程并发起回合，P2 在回合执行中查询。

| 事实 | 证据 | 确定性 |
|------|------|--------|
| 本插件自起的 `app-server` 与 ChatGPT 插件的 `app-server`（pid 12990）是两个独立进程，无共享 daemon | `ps aux` + `~/.codex/app-server-control/` 不存在 | `[Verified]` |
| **线程级**状态跨进程不可用：`thread/list` / `thread/read` 的 `status` 恒为 `notLoaded`，`thread/loaded/list` 恒为空 | probe 实跑 | `[Verified]` |
| **回合级**历史状态跨进程可用：`thread/turns/list` 能重建 `completed` / `interrupted` / `failed`，带 `startedAt` / `completedAt`；`interrupted` 与 rollout 的 `turn_aborted` 记录一一对应 | 单线程实测 10 个回合（completed ×8 / interrupted ×1 / failed ×1） | `[Verified]` |
| **正在执行中的回合，跨进程读到的是 `interrupted` + `completedAt: null`，不是 `inProgress`** | 两轮独立复现：P1 `turn/start` 自己返回 `status: inProgress`，同一时刻 P2 查同一线程得到 `interrupted / completedAt:null` | `[Verified]` |
| 进程中途死亡留下的半截回合，事后读到的同样是 `interrupted` + `completedAt: null`——与「正在跑」在协议层不可区分 | 杀掉 P1 后事后查询两条测试线程，均为 `interrupted / completedAt:null` | `[Verified]` |
| 正常中断（用户按停止）写 `turn_aborted`，因此是 `interrupted` + `completedAt` **非 null**——与上一行可区分 | 历史回合 `01a0c280`：`interrupted`，`startedAt 1789969606 / completedAt 1789969619` | `[Verified]` |
| **存活的 app-server 会持有它所加载会话的 rollout 文件 fd**：`/proc/<pid>/fd` 下可见；实测新建线程在 `turn/start` 之后出现 fd（`totalHeld` 4→5），进程退出后消失 | `/proc` 全扫描（Node 内 **2–3ms**） | `[Verified]` |
| rollout 文件**延迟创建**：只 `thread/start` 不发回合时，`thread.path` 指向的文件 4 秒后仍不存在；首个回合开始后才创建 | probe 分 200ms / 1.5s / 4s 三次检查 `existsSync` | `[Verified]` |
| 同一线程同时只能有一个 writer：对已被别的进程加载的线程调 `thread/resume` 会报 `-32600 thread <id> already has an active writer` | 对 pid 12990 持有的线程实跑 resume | `[Verified]` |
| `sortDirection` 只接受 `asc` / `desc`（传 `descending` 报 `-32600`） | probe 实测错误原文 | `[Verified]` |
| 服务端通知 `turn/started` / `turn/completed` 只推给发起该回合的连接（P2 全程没收到任何 turn 通知） | 两轮 probe 里 P2 的通知流为空 | `[Verified]` |

> 附带发现：实测期间用户的 mc-gateway 返回 `503 No available channel`，两轮回合都在开跑后约 4 秒进入 `Reconnecting...`。这不影响本次结论（观测点在回合存活期间），但说明网关当时不可用。

## Open Risks

按铁律 3 先反对自己：

- **判定谓词依赖「`interrupted` + `completedAt: null`」这个反直觉的编码**。它是实测出来的，不是文档承诺的；Codex 升级后若把运行中的回合改报 `inProgress`（更符合语义），判定会全面失效。缓解：谓词写成「最新回合没有终止记录」——`inProgress` **或** (`interrupted` 且 `completedAt` 为 null) 都算候选，两种编码都能吃下。
- **归属存活是平台相关的**：Linux `/proc` 已实测（2–3ms）；macOS 需 `lsof -p <pid>`，开销与权限 `[Unknown]`；Windows 无廉价等价物。`thread/resume` 的 writer 冲突报错是一条**跨平台**的替代探针，但它成功时会抢走 writer 锁，可能让用户随后打开该会话失败——**副作用未验证，不能贸然采用**，spec 阶段需单独评估（是否有释放路径，如 `thread/unsubscribe`）。
- **「持有 fd」≠「正在跑」**：进程加载会话就会持有（pid 12990 的 4 个都是空闲会话）。它只用于**否定**（没被任何存活进程持有 ⇒ 一定没在跑），不能单独用于肯定。
- **rollout 文件延迟创建**：新建但还没发过回合的会话，`thread.path` 指向不存在的文件。watcher 必须处理 ENOENT（监听父目录或跳过），否则新建会话会让监听器抛错。
- **fs.watch 在 WSL2 / 网络文件系统上的 inotify 可靠性未验证** `[Unknown]`——这是必须有轮询兜底的原因。
- **N 次 RPC 的开销**：每个候选一次 `thread/turns/list` 往返。Linux 下预筛后候选通常个位数；降级路径最坏要发 50 次，需要并发上限与结果缓存。
- **尚未在真实 ChatGPT 面板跑的回合上验证**：本次用两个 probe 进程复现（与插件走的是同一套 app-server 代码路径），真实面板场景留到 build/verify 阶段做一次端到端确认。
- **重复行的交互含义**：同一会话两行，右键菜单、点击打开、重命名都作用于同一 id，行为需一致；取消置顶后置顶组那一行应消失而已打开组那行保留。

## Success Criteria

可验证的验收条件（spec 阶段转 scenario + 测试）：

1. 给定最新回合「无终止记录」（`interrupted` + `completedAt` 为 null，或 `inProgress`）且其 rollout 文件被存活进程持有，列表对应条目显示运行中标识。
2. 给定最新回合为 `completed` / `failed` / `interrupted`（`completedAt` 非 null），不显示运行中标识。
3. 给定「无终止记录」但没有任何存活进程持有该 rollout 文件（进程已被杀），不显示运行中标识。
4. 给定回合长时间无新输出（`completedAt` 为 null + 文件多分钟无写入 + 进程仍持有），**仍然显示运行中标识**——判定不受时间阈值影响。
5. 给定会话已加载但空闲（被持有 fd，最新回合 `completed`），不显示运行中标识。
6. 给定一个已置顶且已打开的会话，「已打开」和「置顶」两组各出现一行，且两行的树节点 id 不相同。
7. 给定一个已置顶的会话，其条目（在任一分组中）显示置顶标识；取消置顶后置顶标识消失、置顶组该行消失、已打开组该行保留。
8. 给定置顶 id 在服务端与标签页都查不到，两组都不出现该条目（既有行为不回退）。
9. rollout 文件写入后，无需手动刷新，树在去抖窗口内自动更新（watcher 不可用时由兜底轮询覆盖）。
10. 给定一个尚未发过回合、rollout 文件不存在的新建会话，不显示运行中标识且不产生监听错误。

## Non-goals

- 不做运行进度/耗时/token 展示，只做「是否运行中」这一个布尔标识。
- 不接管或代理 ChatGPT 插件的 app-server 连接，不改用 `app-server proxy` / daemon 模式。
- 不做「等待审批 / 等待输入」等细分状态（`ThreadStatus.activeFlags` 里有，但那是线程级状态，跨进程拿不到）。
- 不改置顶的存储位置（仍在本插件 `globalState`）。
- 不引入手动置顶排序。

## Amendments

### 2026-09-21 — 条目描述由首条消息改为会话目录

**原因**：用户在 build 完成后的验收中提出，条目右侧的描述文本应显示会话所在目录，而不是会话的首条消息（`thread.preview`）。

**摘要**：

- `TreeItem.description` 的内容从 `thread.preview` 改为 `thread.cwd` 的**末级目录名**（用户在 amend 中确认选择：末级目录名，而非完整路径或 `~` 缩写）。
- 会话拿不到目录（已打开的标签对应的会话不在 `thread/list` 中，`cwd` 为 `null`）时，描述为空；若该会话同时被置顶，描述恰为 `📌`，不带尾随空白。
- `📌` 置顶前缀的位置与语义不变。

**BREAKING**：`description` 不再显示 `thread.preview`。原先「有 `name` 的会话在右侧显示首条消息」这一行为被移除。没有 `name` 的会话不受影响——它们的 `preview` 本来就用作左侧标题（`Scenario: 无名会话用首条消息作为显示标题`），仍然可见。

**已知取舍（amend 时向用户说明并确认）**：

1. 开启 `codexHelper.filterByWorkspaceCwd` 时列表只剩当前工作区的会话，所有行的目录名相同，这一列不再提供区分度。该配置默认关闭。
2. 已命名的会话在树上不再能看到首条消息。判断依据是「既然起了名字，名字就是这个会话的身份」。

**顺带修复**：`specs/codex-session-sidebar/spec.md` 中 `## REMOVED Requirements` 的 `**Migration**` 字段在 spec 阶段被写坏——其文本尾部（以 `` ## ADDED Requirements` `` 开头的一行）被落在了文件第 161 行，夹在 ADDED 段中间伪装成一个二级标题，而文件末尾的 `**Migration**:` 只剩一个未闭合的反引号。`openspec validate --strict` 对此不报错。本次 amend 将该行归位。

### 2026-09-21 — 补 T-008 缺失的「抛错」路径

**原因**：verify 闸门 4 核对「断言有没有失败能力」时发现，scenario「单个会话的回合查询失败不影响其他会话」的 GIVEN 写的是回合查询**抛出错误**，而唯一映射到它的测试把失败建模为「turns map 里缺键」——钉的是纯函数的数据缺失分支，真正处理 reject 的 `src/session/runningTracker.ts:131-136` 的 try/catch 没有任何测试覆盖。变异校验：移除该 try/catch 后 74 个既有测试全绿。

**摘要**：

- 新增一条测试用例（`T-032`）：用真会 reject 的 `listTurns` 钉住抛错隔离——抛错会话判非运行、其他会话照常运行、异常不向上逃逸。
- **不改需求**：requirement 与 scenario 原文已经正确写明了这条约束，缺的是测试而不是规格。因此本次 amend 不修改 `specs/**`，也不新增 scenario，scenario 总数仍为 41。
- **不改设计**：不新增生产代码路径——`src/session/runningTracker.ts:131-136` 的 try/catch 早已实现且行为正确，Task 9 的「最小实现」就是把它加回，净改动为 0。`design.md` 的「现状与影响面」与 `## 改动文件` 无需同步。
- T-008 保留原样：它钉的「数据缺失时隔离」是同一 scenario 的另一条真实边界，仍有失败能力。

**已知取舍**：`schedule()` 用 `void recompute()` 丢弃 promise，所以 try/catch 一旦缺失，失败形态是 unhandled rejection（整轮重算静默失效）而不是显式报错。本次只补测试钉住现状，不改这个调度结构——改它属于另一个变更（例如给 `recompute` 加显式的错误上报）。
