/**
 * 日志的最小写入面：扩展里由 Output 面板的「Codex Helper」通道（`LogOutputChannel`）承接，
 * 纯逻辑模块只认这个形状，不碰 vscode。
 */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * 包一层「永不抛异常」：日志只是诊断，而通道随 `context.subscriptions` 释放之后再写会抛
 * `Channel has been closed` —— 停用时被 kill 的 app-server 仍可能晚到几行 stderr，
 * 这种写入不能变成扩展宿主里的未捕获异常。
 */
export function createSafeLogger(sink: Logger): Logger {
  const guard =
    (write: (message: string) => void) =>
    (message: string): void => {
      try {
        write(message);
      } catch {
        // 通道已关闭：丢掉这一行
      }
    };
  return {
    info: guard((message) => sink.info(message)),
    warn: guard((message) => sink.warn(message)),
    error: guard((message) => sink.error(message)),
  };
}
