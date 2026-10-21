import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import * as vscode from 'vscode';
import { CODEX_EXTENSION_ID } from '../codex/binary';
import { createNoRetryPatcher, createPatchOnOpen } from '../codex/noRetryPatch';
import type { Logger } from '../log';

/**
 * 打开标签页时顺带确保 Codex 扩展的「不重试」补丁已打上（design D50）。
 * 它是 fire-and-forget 的后台动作：幂等、带备份、失败只记日志，绝不拖慢或阻断打开。
 */
export function wirePatchOnOpen(deps: { enabled(): boolean; logger: Logger }): () => void {
  return createPatchOnOpen({
    enabled: deps.enabled,
    patcher: createNoRetryPatcher({
      extensionPath: () => vscode.extensions.getExtension(CODEX_EXTENSION_ID)?.extensionPath,
      readFile: (path) => readFile(path, 'utf8'),
      writeFile: (path, content) => writeFile(path, content, 'utf8'),
      copyFile: (from, to) => copyFile(from, to),
      exists: async (path) => {
        try {
          await access(path);
          return true;
        } catch {
          return false;
        }
      },
      compiles: (content) => {
        try {
          new Script(content);
          return true;
        } catch {
          return false;
        }
      },
      log: (message) => deps.logger.info(message),
    }),
    notify: (message) => void vscode.window.showInformationMessage(message),
    log: (message) => deps.logger.error(message),
  });
}
