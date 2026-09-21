import { describe, expect, it } from 'vitest';
import type { BinaryDeps } from '../../src/codex/binary';
import { resolveCodexBinary, resolvePlatformBinDir } from '../../src/codex/binary';

function makeDeps(options: {
  codexExecutable?: string;
  cliExecutable?: string;
  extensionPath?: string;
}): BinaryDeps {
  const sections: Record<string, Record<string, unknown>> = {
    codexHelper: { codexExecutable: options.codexExecutable ?? '' },
    chatgpt: { cliExecutable: options.cliExecutable ?? '' },
  };
  return {
    getConfiguration: (section: string) => ({
      get: <T>(key: string): T | undefined => sections[section]?.[key] as T | undefined,
    }),
    getExtension: (id: string) =>
      id === 'openai.chatgpt' && options.extensionPath
        ? { extensionPath: options.extensionPath }
        : undefined,
  };
}

describe('binary', () => {
  it('resolves_binary_from_codex_extension_path', () => {
    const deps = makeDeps({ extensionPath: '/ext/openai.chatgpt-26.908.40401-linux-x64' });

    expect(resolveCodexBinary(deps, 'linux', 'x64')).toBe(
      '/ext/openai.chatgpt-26.908.40401-linux-x64/bin/linux-x86_64/codex',
    );

    // 平台目录映射复刻 Codex 的 fh()：目录名随版本变化，必须动态解析
    expect(resolvePlatformBinDir('linux', 'x64')).toBe('bin/linux-x86_64');
    expect(resolvePlatformBinDir('darwin', 'arm64')).toBe('bin/macos-aarch64');
    expect(resolvePlatformBinDir('win32', 'x64')).toBe('bin/windows-x86_64');
    expect(resolveCodexBinary(deps, 'win32', 'x64')).toBe(
      '/ext/openai.chatgpt-26.908.40401-linux-x64/bin/windows-x86_64/codex.exe',
    );
    // 未知平台不能静默拼一个不存在的目录出来
    expect(() => resolvePlatformBinDir('freebsd', 'mips')).toThrowError(/freebsd-mips/);
  });

  it('config_executable_overrides_extension_path', () => {
    const deps = makeDeps({
      codexExecutable: '/usr/local/bin/codex',
      cliExecutable: '/opt/chatgpt-codex',
      extensionPath: '/ext/openai.chatgpt-26.908.40401-linux-x64',
    });

    expect(resolveCodexBinary(deps, 'linux', 'x64')).toBe('/usr/local/bin/codex');
  });

  it('falls_back_to_codex_cli_executable_setting', () => {
    const deps = makeDeps({
      codexExecutable: '   ',
      cliExecutable: '/opt/chatgpt-codex',
      extensionPath: '/ext/openai.chatgpt-26.908.40401-linux-x64',
    });

    expect(resolveCodexBinary(deps, 'linux', 'x64')).toBe('/opt/chatgpt-codex');
  });

  it('throws_with_extension_id_when_codex_missing', () => {
    const deps = makeDeps({});

    expect(() => resolveCodexBinary(deps, 'linux', 'x64')).toThrowError(/openai\.chatgpt/);
  });
});
