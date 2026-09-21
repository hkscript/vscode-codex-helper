import * as vscode from 'vscode';
import type { SessionGroup, SessionGroupId, SessionItem } from '../codex/types';

/**
 * TreeDataProvider for the session sidebar.
 *
 * Error handling is deliberate: a failed load yields exactly one error node with
 * a retry command. Returning an empty array would be indistinguishable from
 * "you have no sessions", which hides the real problem (spec: 错误可见性).
 */

export interface SessionGroupNode {
  kind: 'group';
  id: string;
  label: string;
  contextValue: 'group';
  group: SessionGroup;
}

export interface SessionItemNode {
  kind: 'session';
  id: string;
  label: string;
  description?: string;
  contextValue: 'session' | 'session.open' | 'session.pinned';
  session: SessionItem;
}

export interface SessionErrorNode {
  kind: 'error';
  id: string;
  label: string;
  contextValue: 'error';
  command: { command: string; title: string };
  error: Error;
}

export type SessionTreeNode = SessionGroupNode | SessionItemNode | SessionErrorNode;

export interface SessionTreeProviderDeps {
  load(): Promise<SessionGroup[]>;
}

export interface SessionTreeProvider {
  getChildren(element?: SessionTreeNode): Promise<SessionTreeNode[]>;
  getTreeItem(node: SessionTreeNode): vscode.TreeItem;
  refresh(): void;
  onDidChangeTreeData(listener: () => void): { dispose(): void };
}

/**
 * Last segment of a session's working directory.
 *
 * The sidebar is narrow and `description` truncates from the right, so a full
 * path loses exactly the part that tells sessions apart (design D26). Accepts
 * both separators and ignores a trailing one; the root directory and the empty
 * string have no meaningful last segment and yield `undefined` (D27).
 */
export function cwdBasename(cwd: string | null | undefined): string | undefined {
  if (!cwd) return undefined;
  const segments = cwd.split(/[/\\]+/).filter((segment) => segment.length > 0);
  return segments.at(-1);
}

export function createSessionTreeProvider(
  deps: SessionTreeProviderDeps,
): SessionTreeProvider {
  const emitter = new vscode.EventEmitter<void>();

  function toGroupNode(group: SessionGroup): SessionGroupNode {
    return {
      kind: 'group',
      id: `group:${group.id}`,
      label: group.label,
      contextValue: 'group',
      group,
    };
  }

  /**
   * 分组节点的**默认**折叠状态（design D13）：常用两组展开，历史长尾收起。
   * 只给默认值——用户手动折叠/展开后由 VS Code 按 TreeItem.id 记忆，本插件不重置。
   */
  function defaultCollapsibleState(group: SessionGroup): vscode.TreeItemCollapsibleState {
    return group.id === 'history'
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded;
  }

  function toItemNode(session: SessionItem, groupId: SessionGroupId): SessionItemNode {
    // 置顶优先于已打开：右键菜单的语义锚点是「置顶与否」，
    // 已打开且已置顶的条目必须给出「取消置顶」（D22）。
    const contextValue = session.pinned
      ? ('session.pinned' as const)
      : session.open
        ? ('session.open' as const)
        : ('session' as const);
    const base = cwdBasename(session.cwd);
    // 图标位归运行状态，置顶只能占 description 前缀（D21）。
    // 没有目录时 trimEnd 掉 `📌 ` 的尾随空格（D27）。
    const description = session.pinned ? `📌 ${base ?? ''}`.trimEnd() : base;
    return {
      kind: 'session',
      // 同一会话可能同时出现在已打开与置顶两组；id 不带分组段会让
      // VS Code 拿同一个 id 记两行的折叠/选中状态（D20）。
      id: `session:${groupId}:${session.id}`,
      label: session.label,
      description,
      contextValue,
      session,
    };
  }

  function toErrorNode(error: unknown): SessionErrorNode {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: 'error',
      id: 'error',
      label: `加载失败：${reason}`,
      contextValue: 'error',
      command: { command: 'codexHelper.refresh', title: '重试' },
      error: error instanceof Error ? error : new Error(reason),
    };
  }

  return {
    async getChildren(element?: SessionTreeNode): Promise<SessionTreeNode[]> {
      if (element?.kind === 'group') {
        return element.group.sessions.map((session) => toItemNode(session, element.group.id));
      }
      if (element) return [];

      try {
        const groups = await deps.load();
        return groups.map(toGroupNode);
      } catch (error) {
        return [toErrorNode(error)];
      }
    },

    getTreeItem(node: SessionTreeNode): vscode.TreeItem {
      if (node.kind === 'group') {
        const item = new vscode.TreeItem(node.label, defaultCollapsibleState(node.group));
        item.id = node.id;
        item.contextValue = node.contextValue;
        item.description = `${node.group.sessions.length}`;
        return item;
      }
      if (node.kind === 'error') {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.id = node.id;
        item.contextValue = node.contextValue;
        item.command = node.command;
        item.iconPath = new vscode.ThemeIcon('error');
        return item;
      }
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = node.id;
      item.contextValue = node.contextValue;
      item.description = node.description;
      item.command = {
        command: 'codexHelper.openSession',
        title: '打开会话',
        // A payload rather than the node itself: the context menu hands the
        // command the node while a click hands it these arguments, and
        // `extension.ts` normalizes both shapes.
        arguments: [{ sessionId: node.session.id, label: node.label }],
      };
      item.iconPath = new vscode.ThemeIcon(
        node.session.running
          ? 'loading~spin'
          : node.session.open
            ? 'window'
            : 'comment-discussion',
      );
      return item;
    },

    refresh(): void {
      emitter.fire();
    },

    onDidChangeTreeData(listener: () => void) {
      return emitter.event(listener);
    },
  };
}
