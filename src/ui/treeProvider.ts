import * as vscode from 'vscode';
import type { SessionGroup, SessionItem } from '../codex/types';

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

  function toItemNode(session: SessionItem): SessionItemNode {
    const contextValue = session.open
      ? ('session.open' as const)
      : session.pinned
        ? ('session.pinned' as const)
        : ('session' as const);
    return {
      kind: 'session',
      id: `session:${session.id}`,
      label: session.label,
      description: session.preview === session.label ? undefined : session.preview,
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
        return element.group.sessions.map(toItemNode);
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
      item.iconPath = new vscode.ThemeIcon(node.session.open ? 'window' : 'comment-discussion');
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
