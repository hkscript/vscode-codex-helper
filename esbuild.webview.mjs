// 侧边栏 webview 的构建参数，esbuild.mjs 出包和 webviewBundle 测试共用这一份：
// 产物路径要对得上 src/ui/sessionWebviewHtml.ts 的 SESSION_WEBVIEW_*，改了哪边测试都会拦下。
export const webviewBuildOptions = {
  entryPoints: ['src/ui/webview/sidebar.ts', 'src/ui/webview/sidebar.css'],
  bundle: true,
  outdir: 'dist/webview',
  // 在 webview 的浏览器环境里跑：单个不依赖模块加载器的脚本
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
};
