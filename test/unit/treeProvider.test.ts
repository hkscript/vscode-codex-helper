import { describe, expect, it } from 'vitest';
import type { SessionGroup } from '../../src/codex/types';
import { buildSessionGroups } from '../../src/session/sessionStore';
import {
  createSessionTreeProvider,
  cwdBasename,
  type SessionGroupNode,
  type SessionItemNode,
} from '../../src/ui/treeProvider';
import { ThemeIcon, TreeItemCollapsibleState, makeOpenTab, makeThread } from '../helpers/fakes';

/** Renders one group's item nodes through the provider, the way the tree does. */
async function sessionNodes(groups: SessionGroup[], groupId: string) {
  const provider = createSessionTreeProvider({ load: async () => groups });
  const roots = await provider.getChildren();
  const group = roots.find(
    (node): node is SessionGroupNode => node.kind === 'group' && node.group.id === groupId,
  );
  if (!group) throw new Error(`missing group node: ${groupId}`);
  const children = await provider.getChildren(group);
  const nodes = children.filter((node): node is SessionItemNode => node.kind === 'session');
  expect(nodes, `${groupId} 组没有渲染出会话条目`).toHaveLength(children.length);
  return { provider, nodes };
}

function twoSessions(): SessionGroup[] {
  return buildSessionGroups({
    threads: [
      makeThread({ id: 't1', name: '价格排查', updatedAt: 20 }),
      makeThread({ id: 't2', name: '代码审查', updatedAt: 10 }),
    ],
    openTabs: [],
    pinnedIds: [],
  });
}

describe('treeProvider', () => {
  it('shows_error_node_with_retry_command_on_load_failure', async () => {
    const provider = createSessionTreeProvider({
      load: async () => {
        throw new Error('spawn ENOENT');
      },
    });

    const roots = await provider.getChildren();

    // 空数组在 UI 上与「没有会话」无法区分，必须是一个可诊断的错误节点
    expect(roots).toHaveLength(1);
    const node = roots[0]!;
    expect(node.kind).toBe('error');
    if (node.kind !== 'error') throw new Error('expected a single error node');
    expect(String(node.label)).toContain('spawn ENOENT');
    expect(node.contextValue).toBe('error');
    expect(node.command.command).toBe('codexHelper.refresh');
    expect(String(provider.getTreeItem(node).label)).toContain('spawn ENOENT');
  });

  it('replaces_error_node_with_sessions_after_retry', async () => {
    let failing = true;
    const provider = createSessionTreeProvider({
      load: async () => {
        if (failing) throw new Error('spawn ENOENT');
        return twoSessions();
      },
    });

    const before = await provider.getChildren();
    expect(before.map((node) => node.contextValue)).toEqual(['error']);

    failing = false;
    provider.refresh();

    const after = await provider.getChildren();
    expect(after.some((node) => node.contextValue === 'error')).toBe(false);

    // 两条会话都在树里可见（历史分组下）
    const sessions = (
      await Promise.all(after.map((node) => provider.getChildren(node)))
    ).flat();
    expect(sessions.map((node) => node.label)).toEqual(['价格排查', '代码审查']);
  });

  // REQ: 树视图组织与过滤 / Scenario: 已打开与置顶分组默认展开
  it('expands_open_and_pinned_groups_by_default', async () => {
    const provider = createSessionTreeProvider({
      load: async () =>
        buildSessionGroups({
          threads: [
            makeThread({ id: 'open-1', name: '正在用的' }),
            makeThread({ id: 'pin-1', name: '钉住的' }),
            makeThread({ id: 'hist-1', name: '很久以前的' }),
          ],
          openTabs: [makeOpenTab('open-1', '正在用的')],
          pinnedIds: ['pin-1'],
        }),
    });

    const roots = await provider.getChildren();
    const groupOf = (id: string): SessionGroupNode => {
      const node = roots.find(
        (candidate): candidate is SessionGroupNode => candidate.kind === 'group' && candidate.group.id === id,
      );
      if (!node) throw new Error(`missing group node: ${id}`);
      return node;
    };

    // 常用两组默认展开，历史长尾默认收起（design D13）
    expect(provider.getTreeItem(groupOf('open')).collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(provider.getTreeItem(groupOf('pinned')).collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(provider.getTreeItem(groupOf('history')).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it('same_session_gets_distinct_node_ids_per_group', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 'pin-1', name: '钉住又开着的' })],
      openTabs: [makeOpenTab('pin-1', '钉住又开着的')],
      pinnedIds: ['pin-1'],
    });

    const open = await sessionNodes(groups, 'open');
    const pinned = await sessionNodes(groups, 'pinned');

    // VS Code 按 TreeItem.id 记忆折叠/选中状态：两行同 id 会互相串台（D20）
    expect(open.nodes[0]!.id).toBe('session:open:pin-1');
    expect(pinned.nodes[0]!.id).toBe('session:pinned:pin-1');
    expect(open.provider.getTreeItem(open.nodes[0]!).id).toBe('session:open:pin-1');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).id).toBe('session:pinned:pin-1');
  });

  it('running_session_uses_spinner_icon', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'busy', name: '正在跑' }),
        makeThread({ id: 'idle', name: '闲着' }),
      ],
      openTabs: [],
      pinnedIds: [],
      runningIds: ['busy'],
    });

    const { provider, nodes } = await sessionNodes(groups, 'history');
    const iconOf = (id: string) =>
      provider.getTreeItem(nodes.find((node) => node.id.endsWith(id))!).iconPath as ThemeIcon;

    expect(iconOf('busy').id).toBe('loading~spin');
    // 非运行的条目图标不变，避免「全都在转」看不出区别
    expect(iconOf('idle').id).toBe('comment-discussion');
  });

  it('pinned_session_description_starts_with_pin_marker', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住的', preview: '钉住的预览', cwd: '/home/hk/meicai/order' }),
        makeThread({ id: 'plain', name: '普通的', preview: '普通的预览', cwd: '/home/hk/github/codex-cli' }),
      ],
      openTabs: [],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const history = await sessionNodes(groups, 'history');

    // 图标位被运行状态占着，置顶只能落在 description 上（D21）
    expect(pinned.nodes[0]!.description).toBe('📌 order');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).description).toBe('📌 order');
    // 没置顶的条目不能平白多出一个图钉，但目录照旧显示
    expect(history.nodes[0]!.description).toBe('codex-cli');
  });

  it('description_shows_cwd_basename', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({
          id: 't1',
          name: '价格排查',
          preview: '帮我看看这个报价',
          cwd: '/home/hk/meicai/price-research',
        }),
      ],
      openTabs: [],
      pinnedIds: [],
    });

    const { nodes } = await sessionNodes(groups, 'history');

    // 侧边栏窄，description 从右侧截断——完整路径会把最有辨识度的尾部切掉（D26）
    expect(nodes[0]!.description).toBe('price-research');
    // 首条消息不再出现在右侧
    expect(String(nodes[0]!.description)).not.toContain('帮我看看这个报价');
  });

  it('session_without_cwd_has_empty_description', async () => {
    // 已打开的标签对应的会话不在 thread/list 里 ⇒ cwd 为 null
    const groups = buildSessionGroups({
      threads: [],
      openTabs: [makeOpenTab('t8', '新会话'), makeOpenTab('t9', '钉住的新会话')],
      pinnedIds: ['t9'],
    });

    const { nodes } = await sessionNodes(groups, 'open');
    const descOf = (id: string) => nodes.find((node) => node.id.endsWith(id))!.description;

    expect(descOf('t8')).toBeUndefined();
    // 没有目录时置顶前缀不能拖着一个看不见的尾随空格（D27）
    expect(descOf('t9')).toBe('📌');
  });

  // INV-003: design §6.3 的 (cwd 形态 × pinned) 8 格全组合
  it('description_matrix_holds_for_all_cwd_and_pinned_combinations', async () => {
    const cwds: Array<[string | null, string | undefined]> = [
      ['/home/hk/github/vscode-codex-helper', 'vscode-codex-helper'],
      ['/home/hk/github/vscode-codex-helper/', 'vscode-codex-helper'],
      ['/', undefined],
      [null, undefined],
    ];
    let withDir = 0;
    let withoutDir = 0;

    for (const [cwd, expectedBase] of cwds) {
      // 先单独钉住取名函数本身，再钉住它被组装进 description 的结果。
      // 逐格用 expect.soft：硬断言会在第一格就中止，矩阵是不是真的跑满 8 格
      // 就看不出来了——而「只红一格」正是假绿的典型形状。
      expect.soft(cwdBasename(cwd), `cwdBasename(${cwd})`).toBe(expectedBase);

      for (const pinned of [true, false]) {
        const groups = buildSessionGroups({
          threads: [makeThread({ id: 't1', name: '目标会话', cwd: cwd ?? undefined })],
          openTabs: cwd === null ? [makeOpenTab('t1', '目标会话')] : [],
          pinnedIds: pinned ? ['t1'] : [],
        });
        // 走真实渲染路径：矩阵要盯住 toItemNode 的组装，而不是在测试里
        // 把同一条公式再写一遍（那样 `📌 ${base}` 的尾随空格永远测不出来）
        const provider = createSessionTreeProvider({ load: async () => groups });
        const roots = await provider.getChildren();
        const rendered = (await Promise.all(roots.map((root) => provider.getChildren(root))))
          .flat()
          .filter((node): node is SessionItemNode => node.kind === 'session')
          .find((node) => node.session.id === 't1');
        expect(rendered, `cwd=${cwd} pinned=${pinned} 没渲染出目标条目`).toBeDefined();
        const description = rendered!.description;

        // 独立推导的期望值：不复用被测实现的组装分支
        const expected = pinned
          ? expectedBase === undefined
            ? '📌'
            : `📌 ${expectedBase}`
          : expectedBase;

        expect.soft(description, `cwd=${cwd} pinned=${pinned}`).toBe(expected);
        // 尾随空格在 UI 里看不见，只能靠完整相等断言钉死
        expect.soft(String(description ?? ''), `cwd=${cwd} pinned=${pinned} 尾随空白`).toBe(
          String(description ?? '').trimEnd(),
        );

        if (expectedBase === undefined) withoutDir += 1;
        else withDir += 1;
      }
    }

    // 反空转护栏：4 种 cwd 形态 × 2 种置顶状态 = 8 格，两类结论都要出现
    expect(withDir + withoutDir).toBe(8);
    expect(withDir).toBe(4);
    expect(withoutDir).toBe(4);
  });

  it('open_and_pinned_item_context_value_is_pinned', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住又开着的' }),
        makeThread({ id: 'plain', name: '普通的' }),
      ],
      openTabs: [makeOpenTab('pin-1', '钉住又开着的'), makeOpenTab('open-only', '只开着的')],
      pinnedIds: ['pin-1'],
    });

    const open = await sessionNodes(groups, 'open');
    const history = await sessionNodes(groups, 'history');
    const contextOf = (nodes: typeof open.nodes, id: string) =>
      nodes.find((node) => node.id.endsWith(id))!.contextValue;

    // package.json 的 unpin 菜单挂在 session.pinned 上：已打开且已置顶必须给「取消置顶」（D22）
    expect(contextOf(open.nodes, 'pin-1')).toBe('session.pinned');
    expect(contextOf(open.nodes, 'open-only')).toBe('session.open');
    expect(contextOf(history.nodes, 'plain')).toBe('session');
  });
});
