import { build } from 'esbuild';
import { webviewBuildOptions } from './esbuild.webview.mjs';

await Promise.all([
  build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    logLevel: 'info',
  }),
  build({
    ...webviewBuildOptions,
    sourcemap: true,
    logLevel: 'info',
  }),
]);
