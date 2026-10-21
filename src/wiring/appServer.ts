import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import {
  CLIENT_NAME,
  createAppServerClient,
  type AppServerClient,
  type ChildProcessLike,
} from '../codex/appServerClient';
import { resolveCodexBinary } from '../codex/binary';
import type { Logger } from '../log';

export interface AppServerLauncherDeps {
  /** 握手时报的版本：唯一来源是 package.json，发版只改那一个文件。 */
  version: string;
  logger: Logger;
}

export interface AppServerLaunchOptions {
  /** stderr 每一行进日志时的前缀。 */
  logTag: string;
  experimentalApi?: boolean;
  /** 拿到真正起出来的子进程（一次性进程要等它退出）。 */
  onSpawn?(child: ChildProcessLike): void;
}

export type AppServerLauncher = (options: AppServerLaunchOptions) => AppServerClient;

function codexBinaryPath(): string {
  return resolveCodexBinary({
    getConfiguration: (section: string) => vscode.workspace.getConfiguration(section),
    getExtension: (id: string) => {
      const extension = vscode.extensions.getExtension(id);
      return extension ? { extensionPath: extension.extensionPath } : undefined;
    },
  });
}

/**
 * 共享的 app-server 与建会话用的一次性 app-server 都从这里造：二进制按当前设置现解析，
 * 两者只差在日志前缀、是否声明实验能力、要不要拿到子进程这几项上。
 */
export function createAppServerLauncher(deps: AppServerLauncherDeps): AppServerLauncher {
  return (options) =>
    createAppServerClient({
      binaryPath: codexBinaryPath(),
      spawn: ((command: string, args: string[], spawnOptions: object) => {
        const child = spawn(command, args, spawnOptions);
        options.onSpawn?.(child as never);
        return child as never;
      }) as never,
      clientInfo: { name: CLIENT_NAME, version: deps.version },
      experimentalApi: options.experimentalApi,
      onStderrLine: (line: string) => deps.logger.info(`[${options.logTag}] ${line}`),
    });
}
