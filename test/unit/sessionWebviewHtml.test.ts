import { describe, expect, it } from 'vitest';
import { sessionWebviewHtml } from '../../src/ui/sessionWebviewHtml';

describe('sessionWebviewHtml', () => {
  it('renders_only_the_toolbar_as_the_new_session_entry', () => {
    const html = sessionWebviewHtml({
      nonce: 'test-nonce',
      cspSource: 'vscode-webview://test',
      scriptUri: 'https://webview.test/sidebar.js',
      styleUri: 'https://webview.test/sidebar.css',
    });

    expect(html).not.toContain('id="new-session"');
    expect(html).not.toContain('New session');
  });
});
