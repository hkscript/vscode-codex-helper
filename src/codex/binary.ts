/**
 * codex executable resolution.
 *
 * Mirrors what the Codex extension itself does (`yI()` / `fh()` in
 * `out/extension.js`), with our own override in front:
 *   `codexHelper.codexExecutable` → `chatgpt.cliExecutable` → `<codex ext>/bin/<os>-<arch>/codex`
 */

export interface BinaryDeps {
  getConfiguration(section: string): { get<T>(key: string): T | undefined };
  getExtension(id: string): { extensionPath: string } | undefined;
}

export const CODEX_EXTENSION_ID = 'openai.chatgpt';

const OS_DIRS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
  aix: 'linux',
  android: 'linux',
  freebsd: 'linux',
  haiku: 'linux',
  openbsd: 'linux',
  sunos: 'linux',
  cygwin: 'linux',
  netbsd: 'linux',
};

const ARCH_DIRS: Record<string, string> = {
  x64: 'x86_64',
  arm64: 'aarch64',
};

export function resolvePlatformBinDir(platform: string, arch: string): string {
  const osDir = OS_DIRS[platform];
  const archDir = ARCH_DIRS[arch];
  if (!osDir || !archDir) {
    throw new Error(`unsupported platform for the codex binary: ${platform}-${arch}`);
  }
  return `bin/${osDir}-${archDir}`;
}

export function resolveCodexBinary(
  deps: BinaryDeps,
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const configured = deps.getConfiguration('codexHelper').get<string>('codexExecutable');
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  const codexSetting = deps
    .getConfiguration('chatgpt')
    .get<string>('cliExecutable');
  if (codexSetting && codexSetting.trim().length > 0) {
    return codexSetting.trim();
  }

  // Resolve the platform directory before the extension lookup so an
  // unsupported platform is reported as such rather than as "codex missing".
  const binDir = resolvePlatformBinDir(platform, arch);
  const extension = deps.getExtension(CODEX_EXTENSION_ID);
  if (!extension) {
    throw new Error(
      `cannot locate the codex executable: extension ${CODEX_EXTENSION_ID} is not installed, ` +
        `and neither codexHelper.codexExecutable nor chatgpt.cliExecutable is set`,
    );
  }

  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  return `${extension.extensionPath}/${binDir}/${executable}`;
}
