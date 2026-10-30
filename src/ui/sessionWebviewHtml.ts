/**
 * Markup skeleton for the session sidebar webview.
 *
 * The extension side is deliberately dumb about the DOM: the webview script
 * (`webview/sidebar.ts`) owns the layout (search row, directory filter, grouped
 * list, context menu) and only exchanges plain messages with the provider. The
 * script and stylesheet are bundled by esbuild into the extension's own
 * `dist/webview/`, so the page loads them through `webview.asWebviewUri` no
 * matter which workspace the sidebar is opened in.
 */

/** esbuild.webview.mjs 把 `src/ui/webview` 打到扩展目录下的这里；两边对不上 webviewBundle 测试会挂。 */
export const SESSION_WEBVIEW_DIR = ['dist', 'webview'] as const;
export const SESSION_WEBVIEW_SCRIPT = 'sidebar.js';
export const SESSION_WEBVIEW_STYLE = 'sidebar.css';

export interface SessionWebviewHtmlOptions {
  nonce: string;
  cspSource: string;
  /** `asWebviewUri` 转换后的脚本 / 样式地址。 */
  scriptUri: string;
  styleUri: string;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function sessionWebviewHtml({
  nonce,
  cspSource,
  scriptUri,
  styleUri,
}: SessionWebviewHtmlOptions): string {
  // 没有任何内联样式 / 脚本：样式只认扩展自己的资源，脚本只认带本次 nonce 的那一个
  const csp = `default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />
<link rel="stylesheet" href="${escapeAttribute(styleUri)}" />
</head>
<body>
  <div class="search-row">
    <button id="cwd-filter" class="filter-btn" title="按工作目录过滤" aria-label="按工作目录过滤">
      <span id="cwd-filter-icon"></span>
    </button>
    <span id="cwd-chip" class="chip hidden">
      <span id="cwd-chip-prefix">过滤</span>
      <span id="cwd-chip-label" class="chip-label"></span>
      <button id="cwd-chip-clear" title="清除目录过滤" aria-label="清除目录过滤"></button>
    </span>
    <input id="search" type="text" placeholder="搜标题..." autocomplete="off" spellcheck="false" aria-label="搜标题" />
    <button id="clear-search" class="icon-btn hidden" title="清除搜索" aria-label="清除搜索"></button>
    <button id="search-icon" class="search-icon" title="选择搜索范围" aria-label="选择搜索范围"></button>
  </div>

  <div id="list" class="list" role="tree"></div>
  <div id="cwd-menu" class="menu hidden" role="menu"></div>
  <div id="search-mode-menu" class="menu hidden" role="menu"></div>
  <div id="ctx-menu" class="menu hidden" role="menu"></div>
  <div id="session-tooltip" class="tooltip hidden" role="tooltip"></div>

  <script nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(scriptUri)}"></script>
</body>
</html>`;
}
