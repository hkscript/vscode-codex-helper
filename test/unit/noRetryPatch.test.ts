import { describe, expect, it, vi } from 'vitest';
import {
  NO_RETRY_BACKUP_SUFFIX,
  NO_RETRY_FROM,
  NO_RETRY_TO,
  createNoRetryPatcher,
  createPatchOnOpen,
  patchNoRetryText,
  readPatchState,
  type EnsureOutcome,
  type NoRetryPatchDeps,
} from '../../src/codex/noRetryPatch';

const DIR = '/ext/openai.chatgpt-26.908.40401-linux-x64';
const TARGET = `${DIR}/out/extension.js`;
const BACKUP = `${TARGET}${NO_RETRY_BACKUP_SUFFIX}`;
const ORIGINAL = `var mh="codex_vscode",mPe="vscode://codex/",${NO_RETRY_FROM},gI=class{}`;

interface World {
  files: Map<string, string>;
  io: { writes: number; copies: number };
  logs: string[];
  deps: NoRetryPatchDeps;
}

/** 内存文件系统替身：把补丁逻辑的 IO 全部关在测试里。 */
function makeWorld(
  options: {
    content?: string;
    backup?: string;
    extensionPath?: string | undefined;
    compiles?: (content: string) => boolean;
  } = {},
): World {
  const files = new Map<string, string>();
  if (options.content !== undefined) files.set(TARGET, options.content);
  if (options.backup !== undefined) files.set(BACKUP, options.backup);

  const io = { writes: 0, copies: 0 };
  const logs: string[] = [];
  const extensionPath = 'extensionPath' in options ? options.extensionPath : DIR;

  const deps: NoRetryPatchDeps = {
    extensionPath: () => extensionPath,
    readFile: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    writeFile: async (path, content) => {
      io.writes += 1;
      files.set(path, content);
    },
    copyFile: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`ENOENT: ${from}`);
      io.copies += 1;
      files.set(to, value);
    },
    exists: async (path) => files.has(path),
    compiles: options.compiles ?? (() => true),
    log: (message) => logs.push(message),
  };

  return { files, io, logs, deps };
}

describe('noRetryPatch', () => {
  it('read_patch_state_recognises_patched_unpatched_and_unknown', () => {
    expect(readPatchState(`a,${NO_RETRY_FROM},b`)).toBe('unpatched');
    expect(readPatchState(`a,${NO_RETRY_TO},b`)).toBe('patched');
    // 常量形状变了（上游换版本/改打包）→ unknown，绝不猜着改
    expect(readPatchState('a,pj=3,hyt=100,gyt=2e3,b')).toBe('unknown');
  });

  it('patch_text_replaces_only_the_exact_target_string', () => {
    expect(patchNoRetryText(`a,${NO_RETRY_FROM},b`)).toBe(`a,${NO_RETRY_TO},b`);
    expect(patchNoRetryText('a,pj=3,b')).toBeNull();
    expect(patchNoRetryText(`a,${NO_RETRY_TO},b`)).toBeNull();
  });

  it('ensure_patches_once_creates_backup_and_caches_the_result', async () => {
    const world = makeWorld({ content: ORIGINAL });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('patched-now');
    expect(world.files.get(TARGET)).toContain(NO_RETRY_TO);
    // 备份必须是上游原版
    expect(world.files.get(BACKUP)).toBe(ORIGINAL);
    expect(world.io).toEqual({ writes: 1, copies: 1 });

    // 幂等：后续调用复用第一次结果，不再碰磁盘
    await expect(patcher.ensure()).resolves.toBe('patched-now');
    expect(world.io).toEqual({ writes: 1, copies: 1 });
  });

  it('ensure_leaves_a_patched_file_and_its_backup_untouched', async () => {
    const world = makeWorld({ content: `a,${NO_RETRY_TO},b` });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('already');
    expect(world.io).toEqual({ writes: 0, copies: 0 });
  });

  it('ensure_keeps_an_existing_backup_instead_of_overwriting_it', async () => {
    const world = makeWorld({ content: ORIGINAL, backup: '上游原版' });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('patched-now');
    expect(world.files.get(BACKUP)).toBe('上游原版');
    expect(world.io.copies).toBe(0);
  });

  it('ensure_skips_without_touching_disk_when_the_extension_is_missing', async () => {
    const world = makeWorld({ content: ORIGINAL, extensionPath: undefined });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('skipped');
    expect(world.io).toEqual({ writes: 0, copies: 0 });
    expect(world.logs.join('\n')).toContain('未找到 Codex 扩展');
  });

  it('ensure_reports_unknown_when_the_target_string_is_gone', async () => {
    const world = makeWorld({ content: 'var pj=3,hyt=100,gyt=2e3;' });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('unknown');
    expect(world.io).toEqual({ writes: 0, copies: 0 });
    expect(world.logs.join('\n')).toContain('未找到目标串');
  });

  it('ensure_rolls_back_when_the_patched_text_fails_the_syntax_baseline', async () => {
    const world = makeWorld({
      content: ORIGINAL,
      // 基线可编译，打完补丁反而编译不过 → 必须回滚
      compiles: (content) => !content.includes(NO_RETRY_TO),
    });
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('failed');
    expect(world.files.get(TARGET)).toBe(ORIGINAL);
    expect(world.logs.join('\n')).toContain('回滚');
  });

  it('ensure_fails_without_throwing_when_reading_fails', async () => {
    const world = makeWorld();
    const patcher = createNoRetryPatcher(world.deps);

    await expect(patcher.ensure()).resolves.toBe('failed');
    expect(world.io).toEqual({ writes: 0, copies: 0 });
  });
});

describe('createPatchOnOpen', () => {
  function fakePatcher(outcome: EnsureOutcome): { ensure: ReturnType<typeof vi.fn> } {
    return { ensure: vi.fn(async () => outcome) };
  }

  it('stays_synchronous_and_notifies_only_once', async () => {
    const patcher = fakePatcher('patched-now');
    const notify = vi.fn();
    const hook = createPatchOnOpen({ enabled: () => true, patcher, notify, log: () => {} });

    hook();
    // 同步返回：打开标签的动作不会被补丁检查拖住
    expect(notify).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    hook();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does_nothing_when_disabled', async () => {
    const patcher = fakePatcher('patched-now');
    const hook = createPatchOnOpen({ enabled: () => false, patcher, notify: vi.fn(), log: () => {} });

    hook();
    await Promise.resolve();

    expect(patcher.ensure).not.toHaveBeenCalled();
  });

  it('never_throws_when_the_patcher_rejects', async () => {
    const logs: string[] = [];
    const hook = createPatchOnOpen({
      enabled: () => true,
      patcher: {
        ensure: vi.fn(async () => {
          throw new Error('EACCES: permission denied');
        }),
      },
      notify: vi.fn(),
      log: (message) => logs.push(message),
    });

    expect(() => hook()).not.toThrow();
    await vi.waitFor(() => expect(logs.join('\n')).toContain('EACCES'));
  });

  it('never_throws_when_the_enabled_switch_itself_throws', () => {
    const hook = createPatchOnOpen({
      enabled: () => {
        throw new Error('config exploded');
      },
      patcher: fakePatcher('patched-now'),
      notify: vi.fn(),
      log: () => {},
    });

    expect(() => hook()).not.toThrow();
  });
});
