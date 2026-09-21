/**
 * Client for `codex app-server` speaking NDJSON JSON-RPC over stdio.
 *
 * Protocol facts (probed against the shipped binary, see design.md §2.2):
 *  - one JSON-RPC message per line, no Content-Length framing;
 *  - `initialize` must complete before any other request;
 *  - the server pushes notifications without an `id` (configWarning, …) that
 *    must never be mistaken for a response.
 */

export interface ChildProcessLike {
  pid?: number;
  stdin: { write(chunk: string): unknown } | null;
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null;
  on(event: 'exit' | 'error' | string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: string): unknown;
}

export interface SpawnLike {
  (
    command: string,
    args: string[],
    options: { stdio: ['pipe', 'pipe', 'pipe'] },
  ): ChildProcessLike;
}

export interface AppServerClientOptions {
  binaryPath: string;
  spawn: SpawnLike;
  requestTimeoutMs?: number;
  clientInfo?: { name: string; version: string };
  onStderrLine?: (line: string) => void;
}

export interface InitializeResult {
  userAgent: string | null;
}

export interface AppServerClient {
  start(): Promise<InitializeResult>;
  request<T>(method: string, params?: unknown): Promise<T>;
  dispose(): void;
  /** in-flight requests currently occupying the routing table (diagnostics) */
  pendingCount(): number;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_CLIENT_INFO = { name: 'vscode-codex-helper', version: '0.0.1' };

interface PendingRequest {
  method: string;
  timer: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface JsonRpcMessage {
  id?: unknown;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export function createAppServerClient(options: AppServerClientOptions): AppServerClient {
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO;

  const pending = new Map<number, PendingRequest>();
  let child: ChildProcessLike | null = null;
  let nextId = 0;
  let buffer = '';
  let disposed = false;
  let initialized = false;
  let startPromise: Promise<InitializeResult> | null = null;

  function rejectAll(reason: string): void {
    for (const [id, entry] of [...pending.entries()]) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(`${entry.method} failed: ${reason}`));
    }
  }

  function settle(message: JsonRpcMessage): void {
    const id = message.id;
    // Notifications (no `id`) are server chatter, never a reply to us.
    if (typeof id !== 'number') return;
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    if (message.error) {
      entry.reject(new Error(`${entry.method} failed: ${message.error.message ?? 'unknown error'}`));
      return;
    }
    entry.resolve(message.result ?? null);
  }

  function consume(text: string): void {
    buffer += text;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          settle(JSON.parse(line) as JsonRpcMessage);
        } catch {
          options.onStderrLine?.(`unparseable app-server message: ${line}`);
        }
      }
      index = buffer.indexOf('\n');
    }
  }

  function consumeStderr(chunk: unknown): void {
    const text = String(chunk);
    for (const line of text.split('\n')) {
      if (line.trim().length > 0) options.onStderrLine?.(line.trim());
    }
  }

  function write(message: unknown): void {
    child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  /** Low-level send: caller is responsible for start()/dispose() state. */
  function send<T>(method: string, params: unknown): Promise<T> {
    const id = ++nextId;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} failed: request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        method,
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    write(params === undefined ? { id, method } : { id, method, params });
    return promise;
  }

  function start(): Promise<InitializeResult> {
    if (disposed) {
      return Promise.reject(new Error('app-server client disposed'));
    }
    if (startPromise) return startPromise;

    startPromise = new Promise<InitializeResult>((resolve, reject) => {
      const spawned = options.spawn(options.binaryPath, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child = spawned;
      spawned.stdout?.on('data', (chunk) => consume(String(chunk)));
      spawned.stderr?.on('data', consumeStderr);
      spawned.on('exit', (code) => rejectAll(`app-server exited with code ${String(code)}`));
      spawned.on('error', (error) => rejectAll(`app-server failed: ${String(error)}`));

      send<{ userAgent?: string }>('initialize', { clientInfo }).then(
        (result) => {
          initialized = true;
          resolve({ userAgent: result?.userAgent ?? null });
        },
        (error: Error) => {
          // A failed handshake leaves no usable session: drop the process so a
          // later retry can spawn a fresh one.
          startPromise = null;
          spawned.kill();
          child = null;
          reject(error);
        },
      );
    });
    return startPromise;
  }

  return {
    start,
    request<T>(method: string, params?: unknown): Promise<T> {
      if (disposed) {
        return Promise.reject(new Error('app-server client disposed'));
      }
      // Once the handshake is done the route entry must be registered in the
      // same tick as the write, otherwise a fast reply can arrive before the
      // entry exists and be dropped as an unknown id.
      if (initialized) {
        return send<T>(method, params);
      }
      return start().then(() => send<T>(method, params));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      initialized = false;
      rejectAll('app-server client disposed');
      const spawned = child;
      child = null;
      startPromise = null;
      spawned?.kill();
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}
