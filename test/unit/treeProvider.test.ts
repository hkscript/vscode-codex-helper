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

    const sessions = (await Promise.all(after.map((node) => provider.getChildren(node)))).flat();
    expect(sessions.map((node) => node.label)).toEqual(['价格排查', '代码审查']);
  });

  // REQ: 树视图分组 / Scenario: 置顶与最近分组默认展开历史与已归档分组默认折叠
  it('expands_pinned_and_recent_collapses_history_and_archived', async () => {
    const provider = createSessionTreeProvider({
      load: async () =>
        buildSessionGroups({
          threads: Array.from({ length: 12 }, (_, index) =>
            makeThread({ id: `t${index + 1}`, name: `会话${index + 1}`, updatedAt: 100 - index }),
          ),
          archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
          openTabs: [],
          pinnedIds: ['t1'],
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

    // 常用两组默认展开；历史与已归档是长尾，默认收起
    expect(provider.getTreeItem(groupOf('pinned')).collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(provider.getTreeItem(groupOf('recent')).collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
    expect(provider.getTreeItem(groupOf('history')).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    expect(provider.getTreeItem(groupOf('archived')).collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  // REQ: 树视图分组 / Scenario: 条目节点 id 含分组段
  it('item_id_carries_group_segment', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 'pin-1', name: '钉住的' })],
      archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
      openTabs: [],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const archived = await sessionNodes(groups, 'archived');

    expect(pinned.nodes[0]!.id).toBe('session:pinned:pin-1');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).id).toBe('session:pinned:pin-1');
    expect(archived.nodes[0]!.id).toBe('session:archived:z1');
  });

  // REQ: 树视图分组 / Scenario: 已打开条目把标签 resource 交给打开命令
  it('open_session_row_passes_tab_resource', async () => {
    const tab = makeOpenTab('t1', '开着的');
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 't1', name: '开着的' }), makeThread({ id: 't2', name: '没开的', updatedAt: 1 })],
      openTabs: [tab],
      pinnedIds: [],
    });

    const { provider, nodes } = await sessionNodes(groups, 'recent');
    const argsOf = (id: string) =>
      (provider.getTreeItem(nodes.find((node) => node.id.endsWith(id))!).command?.arguments?.[0] ?? {}) as {
        tabUri?: unknown;
        archived?: unknown;
      };

    // 已打开的行带上该标签自己的 resource，点击才能聚焦那个标签而不是再开一个
    expect(argsOf('t1').tabUri).toEqual(tab.uri);
    // 没开着的行必须是 null，而不是省略字段（读取端按 null 判定「按会话 id 打开」）
    expect(argsOf('t2').tabUri).toBeNull();
    expect(argsOf('t1').archived).toBe(false);
  });

  // REQ: 会话打开与聚焦 / Scenario: 打开已归档的会话会先取消归档（条目携带归档标记）
  it('archived_row_passes_archived_flag', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 't1', name: '普通的' })],
      archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
      openTabs: [],
      pinnedIds: [],
    });

    const archived = await sessionNodes(groups, 'archived');
    const args = archived.provider.getTreeItem(archived.nodes[0]!).command?.arguments?.[0] as {
      archived?: unknown;
      sessionId?: unknown;
    };

    // 打开这一行要先取消归档，所以树必须把「归档」这个事实传下去
    expect(args.archived).toBe(true);
    expect(args.sessionId).toBe('z1');
  });

  // REQ: 树视图分组 / Scenario: 置顶的已归档会话仍在已归档分组（contextValue）
  it('archived_row_uses_archived_context_value', async () => {
    const groups = buildSessionGroups({
      threads: [makeThread({ id: 't1', name: '普通的' })],
      archivedThreads: [makeThread({ id: 'z1', name: '归档的', updatedAt: 900 })],
      openTabs: [],
      pinnedIds: ['z1'],
    });

    const archived = await sessionNodes(groups, 'archived');
    // 归档优先于置顶：右键菜单要给出「取消归档」，而不是「取消置顶」
    expect(archived.nodes[0]!.contextValue).toBe('session.archived');
    expect(archived.nodes[0]!.description).toBe('📌 vscode-codex-helper');
  });

  // REQ: 树视图分组 / Scenario: 开着且正在运行的会话显示运行图标
  it('running_icon_wins_over_open_icon', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'busy', name: '跑着又开着', updatedAt: 3 }),
        makeThread({ id: 'open', name: '只开着', updatedAt: 2 }),
        makeThread({ id: 'idle', name: '闲着', updatedAt: 1 }),
      ],
      openTabs: [makeOpenTab('busy', '跑着又开着'), makeOpenTab('open', '只开着')],
      pinnedIds: [],
      runningIds: ['busy'],
    });

    const { provider, nodes } = await sessionNodes(groups, 'recent');
    const iconOf = (id: string) =>
      provider.getTreeItem(nodes.find((node) => node.id.endsWith(id))!).iconPath as ThemeIcon;

    expect(iconOf('busy').id).toBe('loading~spin');
    expect(iconOf('open').id).toBe('window');
    expect(iconOf('idle').id).toBe('comment-discussion');
  });

  // REQ: 树视图分组 / Scenario: 没有目录信息的会话不显示描述
  it('session_without_cwd_has_empty_description', async () => {
    // 服务端没给出目录（空字符串）⇒ 描述里没有目录部分
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 't8', name: '没有目录的', cwd: '' }),
        makeThread({ id: 't9', name: '没有目录又置顶的', cwd: '', updatedAt: 1 }),
      ],
      openTabs: [],
      pinnedIds: ['t9'],
    });

    const recent = await sessionNodes(groups, 'recent');
    const pinned = await sessionNodes(groups, 'pinned');
    const descOf = (nodes: typeof recent.nodes, id: string) =>
      nodes.find((node) => node.id.endsWith(id))!.description;

    expect(descOf(recent.nodes, 't8')).toBeUndefined();
    // 没有目录时置顶前缀不能拖着一个看不见的尾随空格（D27）
    expect(descOf(pinned.nodes, 't9')).toBe('📌');
  });

  it('pinned_session_description_starts_with_pin_marker', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住的', preview: '钉住的预览', cwd: '/home/hk/meicai/order' }),
        makeThread({ id: 'plain', name: '普通的', preview: '普通的预览', cwd: '/home/hk/github/codex-cli', updatedAt: 1 }),
      ],
      openTabs: [],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const recent = await sessionNodes(groups, 'recent');

    // 图标位被运行状态占着，置顶只能落在 description 上（D21）
    expect(pinned.nodes[0]!.description).toBe('📌 order');
    expect(pinned.provider.getTreeItem(pinned.nodes[0]!).description).toBe('📌 order');
    // 没置顶的条目不能平白多出一个图钉，但目录照旧显示
    expect(recent.nodes[0]!.description).toBe('codex-cli');
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

    const { nodes } = await sessionNodes(groups, 'recent');

    // 侧边栏窄，description 从右侧截断——完整路径会把最有辨识度的尾部切掉（D26）
    expect(nodes[0]!.description).toBe('price-research');
    expect(String(nodes[0]!.description)).not.toContain('帮我看看这个报价');
  });

  // INV-003（描述矩阵）：(cwd 形态 × pinned) 8 格全组合
  it('description_matrix_holds_for_all_cwd_and_pinned_combinations', async () => {
    const cwds: Array<[string, string | undefined]> = [
      ['/home/hk/github/vscode-codex-helper', 'vscode-codex-helper'],
      ['/home/hk/github/vscode-codex-helper/', 'vscode-codex-helper'],
      ['/', undefined],
      ['', undefined],
    ];
    let withDir = 0;
    let withoutDir = 0;

    for (const [cwd, expectedBase] of cwds) {
      // 先单独钉住取名函数本身，再钉住它被组装进 description 的结果。
      // 逐格用 expect.soft：硬断言会在第一格就中止，矩阵是不是真的跑满 8 格就看不出来了。
      expect.soft(cwdBasename(cwd), `cwdBasename(${cwd})`).toBe(expectedBase);

      for (const pinned of [true, false]) {
        const groups = buildSessionGroups({
          threads: [makeThread({ id: 't1', name: '目标会话', cwd })],
          openTabs: [],
          pinnedIds: pinned ? ['t1'] : [],
        });
        // 走真实渲染路径：矩阵要盯住 toItemNode 的组装，而不是在测试里把同一条公式再写一遍
        const provider = createSessionTreeProvider({ load: async () => groups });
        const roots = await provider.getChildren();
        const rendered = (await Promise.all(roots.map((root) => provider.getChildren(root))))
          .flat()
          .filter((node): node is SessionItemNode => node.kind === 'session')
          .find((node) => node.session.id === 't1');
        expect(rendered, `cwd=${cwd} pinned=${pinned} 没渲染出目标条目`).toBeDefined();
        const description = rendered!.description;

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

    expect(withDir + withoutDir).toBe(8);
    expect(withDir).toBe(4);
    expect(withoutDir).toBe(4);
  });

  it('pinned_open_session_context_value_is_pinned', async () => {
    const groups = buildSessionGroups({
      threads: [
        makeThread({ id: 'pin-1', name: '钉住又开着的' }),
        makeThread({ id: 'open-only', name: '只开着的', updatedAt: 1 }),
        makeThread({ id: 'plain', name: '普通的', updatedAt: 0 }),
      ],
      openTabs: [makeOpenTab('pin-1', '钉住又开着的'), makeOpenTab('open-only', '只开着的')],
      pinnedIds: ['pin-1'],
    });

    const pinned = await sessionNodes(groups, 'pinned');
    const recent = await sessionNodes(groups, 'recent');
    const contextOf = (nodes: typeof pinned.nodes, id: string) =>
      nodes.find((node) => node.id.endsWith(id))!.contextValue;

    // package.json 的 unpin 菜单挂在 session.pinned 上：已打开且已置顶必须给「取消置顶」（D22）
    expect(contextOf(pinned.nodes, 'pin-1')).toBe('session.pinned');
    expect(contextOf(recent.nodes, 'open-only')).toBe('session.open');
    expect(contextOf(recent.nodes, 'plain')).toBe('session');
  });
});
