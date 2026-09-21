# 设计：会话运行中标识 + 置顶不被打开状态掏空

## 1. 目标与非目标

目标：
1. 侧边栏条目能显示「该会话是否正在执行回合」。
2. 置顶会话被打开后仍留在「置顶」分组，且条目上能看出它被置顶。

非目标见 `proposal.md` 的 `## Non-goals`。

## 2. 关键调研结论

全部来自 proposal 阶段的实跑 probe（证据见 `proposal.md` 的 `## Verified Facts`），此处只列设计要用到的几条：

| 结论 | 确定性 |
|------|--------|
| 本插件的 app-server 与 ChatGPT 插件的 app-server 是两个独立进程；`thread/list` / `thread/read` 的线程级 `status` 恒为 `notLoaded` | `[Verified]` |
| `thread/turns/list` 跨进程可用，能重建历史回合状态（`completed` / `interrupted` / `failed`） | `[Verified]` |
| **正在执行中的回合，跨进程读到的是 `interrupted` + `completedAt: null`，不是 `inProgress`** | `[Verified]` |
| 进程中途死亡留下的半截回合同样是 `interrupted` + `completedAt: null`，协议层与「正在跑」不可区分 | `[Verified]` |
| 用户主动中断写 `turn_aborted`，因此是 `interrupted` + `completedAt` 非 null | `[Verified]` |
| 存活的 app-server 持有其已加载会话的 rollout 文件 fd，`/proc/<pid>/fd` 可见，Node 内全扫描 2–3ms | `[Verified]` |
| rollout 文件延迟创建：只 `thread/start` 不发回合时 `thread.path` 指向的文件不存在 | `[Verified]` |
| `thread/list` 每条 thread 带 `path`；`sortDirection` 只接受 `asc` / `desc` | `[Verified]` |

## 3. 设计决策

沿用归档变更的编号序列（上一变更止于 D13）。

| 编号 | 决策 | 理由 |
|------|------|------|
| **D14** | 运行判定谓词 = `无终止记录(最新回合) ∧ 归属存活(rollout 文件)`，**不含时间阈值** | 两个必要条件各自解决一半：前者回答「回合结束了没」，后者回答「还有人在跑吗」。时间阈值两个问题都答不准——短了误杀长思考，长了留着崩溃残留 |
| **D15** | `无终止记录(turn)` 定义为 `turn.status === 'inProgress' \|\| (turn.status === 'interrupted' && turn.completedAt == null)` | 实测跨进程编码是后者；前者是同进程编码。两种都吃下，Codex 将来改语义也不失效（proposal Open Risks 第 1 条的缓解） |
| **D16** | 归属存活只在 Linux 实现（扫 `/proc/<pid>/fd`）；macOS / Windows 直接走时间阈值降级 | `lsof` 的开销与权限未验证（`[Unknown]`），Windows 无廉价等价物。不把未验证的方案塞进本变更；要补 macOS 精确探测另开变更 |
| **D17** | 不使用 `thread/resume` 的 `already has an active writer` 报错做跨平台归属探针 | 它**成功时会抢走 writer 锁**，可能让用户随后打不开该会话。副作用未验证的探针不进生产路径 |
| **D18** | 候选预筛：Linux 用「被持有的 rollout 文件」集合，非 Linux 用 `updatedAt` 在阈值内 | 正在跑的会话必然被持有，所以 Linux 下预筛既便宜又完备；把 `thread/turns/list` 的 N 次往返压到个位数 |
| **D19** | 分组不再互斥：`open` 与 `pinned` 可含同一会话；`history` 仍与两者互斥 | 用户诉求。代价是打破上一变更的「一个会话只出现在一个分组」不变量，需要改 spec 与 `INV` |
| **D20** | 树节点 id 改为 `session:<groupId>:<sessionId>` | VS Code 用 `TreeItem.id` 记忆折叠/选中状态（archive lessons D13），重复 id 会撞车 |
| **D21** | 运行中占图标位（`ThemeIcon('loading~spin')`），置顶占 `description` 前缀（`📌`） | TreeItem 只有一个图标位，两种状态必须同时可见。`~spin` 若在 tree item 不生效也只是退化成静态图标，不影响可读性 `[Assumption]` |
| **D22** | `contextValue` 优先级改为 `pinned > open > 普通` | 右键菜单的语义锚点是「置顶与否」：open 且 pinned 的条目必须给「取消置顶」。`package.json` 的 `when` 表达式因此**不需要改** `[Verified]` 现有表达式为 pin→`/^session$/ \|\| session.open`、unpin→`session.pinned` |
| **D23** | 运行集合变化时才触发树刷新 | `refresh → load → update → refresh` 会自激；只在集合真变化时回调，保证一轮收敛 |
| **D24** | 单个会话的回合查询失败按「非运行」处理，不冒泡 | 运行标识是增强信息，不能让一次 RPC 失败把整棵树变成错误节点（与既有「错误可见性」requirement 的边界：那条管的是**列表加载**失败） |
| **D25** | 重算带代际号（generation），迟到的旧结果直接丢弃 | 一次重算要等 N 个 `thread/turns/list` 往返，期间完全可能被新的文件事件再次触发；没有代际号时先发后到的旧结果会把新状态覆盖回去，表现为「跑完了还转圈 / 刚开跑却不转」 |
| **D26**（2026-09-21 amend） | `description` 显示 `cwd` 的**末级目录名**，不显示 `preview`、不显示完整路径 | 侧边栏窄，`description` 从右侧截断，完整路径会把最有辨识度的尾部切掉，末级目录名恰好是尾部。`preview` 对已命名会话是冗余信息（名字才是身份），对未命名会话则本来就在左侧当标题用，不会丢失 |
| **D27**（2026-09-21 amend） | `cwd` 为 `null` 时 `description` 不含目录部分；置顶时恰为 `📌` | 没有的信息不编。这一列语义因此单一：有字就是目录。`` `📌 ${base}` `` 在 base 为空时必须 trim 掉尾随空格，否则渲染出 `📌 ` 带一个看不见的尾巴 |

## 4. 架构

```
extension.activate()
  ├─ load()  ── thread/list ──► threads[]（含 path / updatedAt）
  │     └─ buildSessionGroups({threads, openTabs, pinnedIds, runningIds, filter})
  │                                              ▲
  └─ runningTracker ────────────────────────────┘ snapshot()
        ├─ processScan.scanHeldRollouts()   (linux) → Map<threadId, pid>
        ├─ runningState.selectCandidates()               → Thread[]
        ├─ threadApi.listTurns(id, limit 1, desc)        → Turn | undefined
        ├─ runningState.computeRunningIds()              → Set<string>
        └─ watch(候选 rollout 文件) ──去抖 300ms──► 重算 ──集合变化──► onChange() → provider.refresh()
                                  └─ watch 失败 → 轮询兜底
```

模块职责（新增三个文件，全部走注入式依赖，可在 node 里单测——沿用 archive lessons「业务判定收进纯模块」的模式）：

| 模块 | 职责 | 依赖注入点 |
|------|------|-----------|
| `src/session/processScan.ts` | 扫 `/proc` 得到「被存活 codex 进程持有的 rollout」映射 | `readdirSync` / `readlinkSync` / `readFileSync` |
| `src/session/runningState.ts` | 纯函数：无终止记录判定、候选筛选、运行集合计算 | 无（纯函数，`now` 与阈值由参数传入） |
| `src/session/runningTracker.ts` | 编排：扫描 → 查询 → 计算 → 监听 → 变化回调 | `scan` / `listTurns` / `watch` / `setInterval` / `now` |

## 5. 现状与影响面

本变更改的是**已落盘的存量代码**（上一变更 `add-codex-session-sidebar` 的产物，已归档）。以下每个改动点都沿生产链路追踪了上下游。

**并行路径总体结论**：`[Verified]` `grep -rn "function.*\(New\|Old\|V2\|Legacy\)" src/` 只命中 `src/commands.ts::createNewSessionCommand`（「新建会话」命令，与本变更无关），**本变更涉及的五个存量文件中不存在带 `New`/`Old`/`V2` 后缀的并行兄弟实现**；也不存在命名不同但逻辑对等的第二套分组/渲染实现——`buildSessionGroups` 是唯一的分组入口（`[Verified]` 调用方只有 `src/extension.ts:88` 与测试），`createSessionTreeProvider` 是唯一的树数据源（`[Verified]` 调用方只有 `src/extension.ts:96` 与测试）。因此各改动点下不再逐条列 `- 并行路径：`。

### 改动点 1：分组不再互斥，并透传运行标记
- 目标：`src/session/sessionStore.ts::buildSessionGroups`

上游：`src/extension.ts::load`（`[Verified]` `src/extension.ts:88`）。下游：`src/ui/treeProvider.ts::getChildren` → `toItemNode`。
链路末端：树节点。**粒度核对**：链路末端的身份是 `TreeItem.id`，改动把「一个会话一行」变成「一个会话可能两行」，所以末端的 id 粒度必须从 `session:<id>` 跟着改成 `session:<group>:<id>`（见改动点 2），否则 VS Code 会拿同一个 id 记两行的状态。
`[Verified]` 现状：`src/session/sessionStore.ts:60` 的 `taken` 集合被 open / pinned / history 三段共用，`:92` 的 `if (taken.has(id)) continue;` 正是「打开即从置顶消失」的成因。
改法：`taken` 降级为「history 排除集」；pinned 段不再看 `taken`，只保留「服务端查不到就丢弃」这一条（`:94` `if (!thread) continue;`，archive lessons D8 要求保留）。
新增入参 `runningIds?: Iterable<string>`，在 `toItem` 里落到 `SessionItem.running`。

### 改动点 2：条目节点 id、图标、描述、contextValue
- 目标：`src/ui/treeProvider.ts::toItemNode`
- 目标：`src/ui/treeProvider.ts::getTreeItem`

上游：`getChildren`（`[Verified]` `src/ui/treeProvider.ts:107` `element.group.sessions.map(toItemNode)`）——分组 id 在这里可得，`toItemNode` 需要多收一个 `groupId` 参数。
下游：VS Code 树渲染 + `package.json` 的 `view/item/context` 菜单（靠 `contextValue` 匹配）。
链路末端：`TreeItem.id`（折叠/选中状态记忆）与右键菜单可见性。
`[Verified]` 现状：`:84` `id: 'session:${session.id}'`；`:77-81` contextValue 优先级 open > pinned；`:147` `iconPath = new ThemeIcon(session.open ? 'window' : 'comment-discussion')`；`:86` description 在 `preview === label` 时为 `undefined`。
改法：id 加分组段（D20）；contextValue 改为 pinned > open（D22）；running 时图标换 `loading~spin`（D21）；description 前缀 `📌`（D21）。

**2026-09-21 amend 追加**：description 的**内容**从 `session.preview` 改为 `session.cwd` 的末级目录名（D26/D27）。

- 目标：`src/ui/treeProvider.ts::toItemNode`（同一个改动点，本次改的是它计算 `description` 的那两行）
- 目标：`src/ui/treeProvider.ts::cwdBasename`（新增的导出纯函数，同文件）
- 并行路径：无 —— `[Verified]` `grep -n "description" src/` 只命中 `treeProvider.ts` 的 `:84/:86/:93/:131/:145`，其中 `:131` 是分组节点的条数（与会话条目无关，不随改）
- 数据来源已存在：`[Verified]` `SessionItem.cwd`（`src/codex/types.ts:76`，`string | null`）由 `src/session/sessionStore.ts:76` 的 `thread?.cwd ?? null` 填充；`Thread.cwd` 是必填 `string`（`types.ts:37`），因此 `cwd` 为 `null` 当且仅当该行来自「服务端查不到的已打开标签」
- 末级目录名的取法必须同时吃下 `/` 与 `\` 分隔符、忽略尾随分隔符；`/`（根目录）与空串都归入「没有目录部分」
`[Verified]` 菜单无需改：`package.json:119-127` 的 pin/unpin `when` 表达式在新优先级下语义仍正确。

### 改动点 3：新增回合列表 API
- 目标：`src/codex/threadApi.ts::createThreadApi`

上游：`src/session/runningTracker.ts`（新增）。下游：`AppServerClient.request` → codex 子进程。
链路末端：JSON-RPC 请求参数。`[Verified]` `sortDirection` 传 `descending` 会被服务端拒绝（`-32600`），必须是 `desc`。
改法：在返回对象里新增 `listTurns(threadId, limit = 1)`，参数 `{threadId, limit, sortDirection: 'desc'}`，返回 `data[0]`（最新回合）或 `undefined`。
`[Verified]` 现有三个方法 `listThreads` / `listLoadedThreadIds` / `setThreadName` 的调用方分别在 `src/extension.ts:81,160`、无、`src/extension.ts:109`——新增方法不影响它们。

### 改动点 4：类型扩展
- 目标：`src/codex/types.ts::Thread`
- 目标：`src/codex/types.ts::SessionItem`

`[Verified]` 现状：`Thread`（`:33-40`）没有 `path`；`SessionItem`（`:55-63`）有 `pinned` / `open` 无 `running`。
改法：`Thread` 增加 `path?: string | null`；新增 `TurnStatus` 联合类型与 `Turn` 接口（`id` / `status` / `startedAt` / `completedAt`）；`SessionItem` 增加 `running: boolean`。
兼容性：`makeThread` fixture（`test/helpers/fakes.ts:164`）用 `Partial<Thread>`，`path` 设为可选即不破坏既有 10 个测试文件；同文件另加一个 `makeTurn` fixture（与 `makeThread` / `makeOpenTab` 同级），供运行判定与追踪器的测试造回合数据。

### 改动点 5：进程归属扫描（新增文件）
- 目标：`src/session/processScan.ts::scanHeldRollouts`

上游：`runningTracker`。下游：候选筛选与运行判定。
链路末端：`Map<threadId, pid>`。
`[Verified]` 扫描规则实测有效：遍历 `/proc/<pid>`，`cmdline` 同时含 `codex` 与 `app-server` 的进程，读其 `/proc/<pid>/fd/*` 的 readlink，匹配 `rollout-…-<uuid>.jsonl` 取 uuid。
容错：`/proc` 在扫描过程中随时可能有进程消失，任一 `readdir` / `readlink` / `readFile` 抛错都必须跳过该项而不是中断整轮。

### 改动点 6：运行状态计算（新增文件）
- 目标：`src/session/runningState.ts::hasNoTerminalRecord`
- 目标：`src/session/runningState.ts::selectCandidates`
- 目标：`src/session/runningState.ts::computeRunningIds`

纯函数，无副作用；`now` 与 `staleSeconds` 由参数传入，便于测时间分支。

**mtime 代理**：降级路径需要「rollout 文件最后写入时间」，实现上直接用 `thread.updatedAt`——`[Verified]` probe 实测 `updatedAt`(1789970309) 与该文件 mtime(1789970309.49) 一致。这样既省掉一次 `stat` 系统调用，又让 `computeRunningIds` 保持纯函数（不碰文件系统）。
**「文件不存在」怎么处理**：不额外 `stat`。Linux 路径上不存在的文件不可能被任何进程持有 ⇒ 自然判非运行；降级路径上「没发过回合」与「文件未创建」是同一件事，由「回合列表为空 ⇒ 非运行」吸收（design §6.1 第 9/15 行）。`path` 为 `null` 时直接跳过该会话。

### 改动点 7：编排与接线（新增文件 + 存量接线）
- 目标：`src/session/runningTracker.ts::createRunningTracker`
- 目标：`src/extension.ts::activate`
- 目标：`src/extension.ts::load`
- 目标：`package.json::configuration`

`[Verified]` 现状：`src/extension.ts:80-94` 的 `load()` 是唯一的数据装配点；`:173-176` 已有 `autoRefreshSeconds` 定时刷新机制可参照。
链路末端：`provider.refresh()`。**自激风险**：`refresh → load → tracker.update → onChange → refresh`，靠 D23「集合变化才回调」收敛。
`[Verified]` `deactivate()`（`:180-185`）目前只清 `autoRefresh` 与 `appServer`，新增的 watcher / 轮询定时器必须一并回收，否则扩展卸载后仍有 inotify 句柄。
`[Verified]` `package.json:130-152` 已有 4 个配置项，新增 3 个同级属性。

### 10 类影响面逐类排查

| 类别 | 结论 | 证据 / 确定性 |
|------|------|--------------|
| 查询/数据加载粒度 | 新增 N 次 `thread/turns/list`（N = 候选数）。Linux 下预筛后实测候选 = 被持有会话数（当前机器为 4） | `[Verified]` probe |
| 本地状态/缓存键 | 不新增持久化。置顶仍存 `codexHelper.pinnedSessionIds`（`src/session/pinStore.ts:9`），运行集合只在内存 | `[Verified]` |
| 状态隔离/并发 | 运行集合按 threadId 隔离；一次 `update` 内的多个 `listTurns` 并发上限 4，避免把 app-server 打满 | `[Inferred]` |
| 数据流/副作用 | 新增的唯一副作用是 `fs.watch` 句柄与轮询定时器，`deactivate` 必须回收 | `[Verified]` 现有 `deactivate` 未覆盖 |
| 接口契约 | `thread/turns/list` 的参数与返回是新依赖的外部契约；`sortDirection` 枚举已实测 | `[Verified]` |
| 数据结构/存储格式 | `SessionItem` 加字段属向后兼容；`Thread.path` 可选 | `[Verified]` |
| 依赖/调用方 | `buildSessionGroups` / `createSessionTreeProvider` 的调用方各只有 extension 与测试 | `[Verified]` grep |
| 性能/资源 | `/proc` 全扫描 2–3ms；watcher 数量 = 候选数；无常驻轮询（watch 可用时） | `[Verified]` probe |
| 错误/边界处理 | rollout 文件不存在（延迟创建）、扫描中进程消失、`listTurns` 失败——三处都必须吞错降级 | `[Verified]` 前两条实测，第三条见 D24 |
| 兼容/迁移 | 非 Linux 平台行为不同（阈值降级），需在配置项描述里写明 | `[Inferred]` |

## 6. 状态叉乘矩阵

### 6.1 运行判定（改动点 6，新引入的多条件守卫）

维度：最新回合状态 {`inProgress`, `interrupted`, `completed`, `failed`, 无回合} × `completedAt` {null, 非 null} × 归属存活 {持有, 未持有, 探测不可用(非 Linux)}

| # | 回合状态 | completedAt | 归属 | 预期 | 覆盖 T-id |
|---|----------|-------------|------|------|-----------|
| 1 | inProgress | null | 持有 | 运行中 | T-001 |
| 2 | interrupted | null | 持有 | 运行中 | T-002 |
| 2b | interrupted | null | 持有（且 mtime 已远超阈值） | 运行中——阈值在 Linux 路径上不参与判定 | T-005 |
| 3 | completed | 非 null | 持有 | 非运行 | T-003 |
| 4 | interrupted | 非 null | 持有 | 非运行 | T-003 |
| 5 | failed | 非 null | 持有 | 非运行 | T-003 |
| 6 | inProgress | null | 未持有 | 非运行 | T-004 |
| 7 | interrupted | null | 未持有 | 非运行 | T-004 |
| 8 | completed | 非 null | 未持有 | 非运行 | INV-001 |
| 9 | 无回合 | — | 持有 | 非运行 | T-006 |
| 10 | 无回合 | — | 未持有 | 非运行 | INV-001 |
| 11 | interrupted | null | 探测不可用 + mtime 在阈值内 | 运行中 | T-009 |
| 12 | interrupted | null | 探测不可用 + mtime 超阈值 | 非运行 | T-010 |
| 13 | completed | 非 null | 探测不可用 + mtime 在阈值内 | 非运行 | INV-001 |
| 14 | inProgress | 非 null（协议上不应出现） | 任意 | 非运行（`completedAt` 非 null 即视为已终止） | INV-001 |
| 15 | 任意 | 任意 | 持有但 rollout 路径为空/文件不存在 | 非运行且不抛错 | T-007 |

空白格：无。第 8/10/13/14 行由 `INV-001` 的全组合遍历覆盖（它按本表同一套维度叉乘，逐格与独立推导的谓词比对）。

### 6.2 分组归属（改动点 1，既有守卫语义变更）

维度：hasOpenTab {是, 否} × pinned {是, 否} × inThreadList {是, 否}

| # | hasOpenTab | pinned | inThreadList | 已打开组 | 置顶组 | 历史组 | 覆盖 T-id |
|---|-----------|--------|--------------|---------|--------|--------|-----------|
| 1 | 是 | 是 | 是 | 有 | **有（本次改动点）** | 无 | T-022 |
| 2 | 是 | 是 | 否 | 有 | 无（服务端查不到，D8） | 无 | INV-002 |
| 3 | 是 | 否 | 是 | 有 | 无 | 无 | INV-002 |
| 4 | 是 | 否 | 否 | 有 | 无 | 无 | INV-002 |
| 5 | 否 | 是 | 是 | 无 | 有 | 无 | INV-002 |
| 6 | 否 | 是 | 否 | 无 | 无（幽灵置顶丢弃） | 无 | INV-002 |
| 7 | 否 | 否 | 是 | 无 | 无 | 有 | INV-002 |
| 8 | 否 | 否 | 否 | 无 | 无 | 无 | INV-002 |

空白格：无。第 1 行是本次语义翻转（原为「置顶组无」），其余行必须保持原行为——这正是 `INV-002` 要钉死的。取消置顶后的行间迁移（第 1 行 → 第 3 行）由 `T-023` 单独覆盖，`running` 标记的透传由 `T-024` 覆盖。

### 6.3 条目描述（2026-09-21 amend 新增，D26/D27）

维度：`cwd` 形态 {正常路径, 带尾随分隔符, 根目录 `/`, `null`} × `pinned` {是, 否}

| # | cwd | pinned | 预期 description | 覆盖 T-id |
|---|-----|--------|------------------|-----------|
| 1 | `/home/hk/github/vscode-codex-helper` | 否 | `vscode-codex-helper` | T-030 |
| 2 | `/home/hk/github/vscode-codex-helper` | 是 | `📌 vscode-codex-helper` | T-027 |
| 3 | `/home/hk/github/vscode-codex-helper/` | 否 | `vscode-codex-helper`（尾随分隔符不产生空名） | INV-003 |
| 4 | `/home/hk/github/vscode-codex-helper/` | 是 | `📌 vscode-codex-helper` | INV-003 |
| 5 | `/` | 否 | 空 | INV-003 |
| 6 | `/` | 是 | `📌`（不带尾随空格） | INV-003 |
| 7 | `null` | 否 | 空 | T-031 |
| 8 | `null` | 是 | `📌`（不带尾随空格） | T-031 |

空白格：无。第 5–8 行是本次最容易写错的一组——`` `📌 ${base ?? ''}` `` 在 `base` 为空时会留下一个看不见的尾随空格，`INV-003` 按本表同一套维度叉乘，逐格与独立推导的期望值比对，并断言遍历计数。

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Codex 升级后把运行中回合改报 `inProgress` | D15 的谓词同时接受两种编码 |
| `loading~spin` 在 TreeItem 不播放动画 `[Assumption]` | 退化为静态图标，语义不丢；测试只断言图标 id |
| `fs.watch` 在 WSL2 / 网络盘不可靠 `[Unknown]` | 轮询兜底（`codexHelper.runningPollSeconds`，默认 5s），watch 抛错即启用 |
| 非 Linux 平台判定不如 Linux 准确 | 配置项描述写明；阈值默认 300s（宁可短暂多显示，不误杀长思考） |
| 刷新自激 | D23：运行集合变化才回调 |
| gate 的改动点归属对账在本仓库空转（archive lessons 坑 1：只有 `master` 一个 ref，`git diff master...HEAD` 为空） | build 起始时写 `.openflow/gate.config.json` 的 `base_branch` 指向本变更基线 `d97b060`，让对账拿得到变更集 |

## 改动文件

存量文件（改）：

- `src/codex/types.ts`
- `src/codex/threadApi.ts`
- `src/session/sessionStore.ts`
- `src/ui/treeProvider.ts`
- `src/extension.ts`
- `package.json`
- `test/helpers/fakes.ts`
- `test/unit/threadApi.test.ts`
- `test/unit/sessionStore.test.ts`
- `test/unit/treeProvider.test.ts`

新增文件：

- `src/session/processScan.ts`
- `src/session/runningState.ts`
- `src/session/runningTracker.ts`
- `test/unit/processScan.test.ts`
- `test/unit/runningState.test.ts`
- `test/unit/runningTracker.test.ts`
