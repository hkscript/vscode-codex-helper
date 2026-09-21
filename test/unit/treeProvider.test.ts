import { describe, expect, it } from 'vitest';
import type { SessionGroup } from '../../src/codex/types';
import { buildSessionGroups } from '../../src/session/sessionStore';
import { createSessionTreeProvider, type SessionGroupNode } from '../../src/ui/treeProvider';
import { TreeItemCollapsibleState, makeOpenTab, makeThread } from '../helpers/fakes';

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
});
