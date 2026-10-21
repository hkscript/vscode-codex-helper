import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { webviewBuildOptions } from '../../esbuild.webview.mjs';
import {
  SESSION_WEBVIEW_DIR,
  SESSION_WEBVIEW_SCRIPT,
  SESSION_WEBVIEW_STYLE,
} from '../../src/ui/sessionWebviewHtml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('webviewBundle', () => {
  // 直接用 esbuild.mjs 出包的那份参数：产物路径要对得上 HTML 里引用的文件，
  // 打出来的脚本也必须是不依赖任何模块加载器的单个浏览器脚本。
  it('bundles_the_sidebar_into_the_files_the_html_references', async () => {
    const result = await build({
      ...webviewBuildOptions,
      absWorkingDir: root,
      write: false,
      logLevel: 'silent',
    });

    const outdir = path.join(root, ...SESSION_WEBVIEW_DIR);
    const outputs = new Map(
      result.outputFiles.map((file) => [path.relative(outdir, file.path), file.text]),
    );
    expect([...outputs.keys()].sort()).toEqual([SESSION_WEBVIEW_STYLE, SESSION_WEBVIEW_SCRIPT]);

    const script = outputs.get(SESSION_WEBVIEW_SCRIPT)!;
    // 只解析、不执行：import / require 残留或语法错误都会在这里暴露
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/\brequire\(/);
    expect(outputs.get(SESSION_WEBVIEW_STYLE)).toContain('.row-time');
  });
});
