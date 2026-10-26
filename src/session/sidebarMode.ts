import type { UriApi } from '../codex/types';

export interface SidebarModeDeps {
  enabled(): boolean;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  openExternal(uri: unknown): Promise<boolean>;
  uriApi: UriApi;
}

export interface SidebarMode {
  newSession(): Promise<boolean>;
  openSession(id: string): Promise<boolean>;
}

/**
 * Codex 已加载侧边栏的快速入口。
 *
 * `chatgpt.newChat` 在现有 Webview 内新建会话；URI handler 则聚焦同一个 Webview
 * 并导航到 `/local/<id>`。返回 false 表示当前模式不是 sidebar，或 Codex 没有接受
 * 这个入口，调用方应回退到原来的编辑器标签路径。
 */
export function createSidebarMode(deps: SidebarModeDeps): SidebarMode {
  return {
    async newSession(): Promise<boolean> {
      if (!deps.enabled()) return false;
      try {
        await deps.executeCommand('chatgpt.newChat');
        return true;
      } catch {
        return false;
      }
    },

    async openSession(id: string): Promise<boolean> {
      if (!deps.enabled()) return false;
      try {
        const uri = deps.uriApi.parse(
          `vscode://openai.chatgpt/local/${encodeURIComponent(id)}`,
        );
        return await deps.openExternal(uri);
      } catch {
        return false;
      }
    },
  };
}
