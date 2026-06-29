import { describe, expect, it } from 'vitest';
import { escapeHtml, renderApp } from './app.js';

describe('renderApp', () => {
  const html = renderApp({ version: '1.2.3' });

  it('returns valid HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes version string', () => {
    expect(html).toContain('v1.2.3');
  });

  it('includes 6-tab navigation', () => {
    expect(html).toContain('data-tab="overview"');
    expect(html).toContain('data-tab="sessions"');
    expect(html).toContain('data-tab="logs"');
    expect(html).toContain('data-tab="settings"');
    expect(html).toContain('data-tab="dev"');
    expect(html).toContain('data-tab="chat"');
  });

  it('includes tab panels', () => {
    expect(html).toContain('id="tab-overview"');
    expect(html).toContain('id="tab-sessions"');
    expect(html).toContain('id="tab-logs"');
    expect(html).toContain('id="tab-settings"');
    expect(html).toContain('id="tab-dev"');
    expect(html).toContain('id="tab-chat"');
  });

  it('includes daemon control buttons', () => {
    expect(html).toContain('btn-daemon-start');
    expect(html).toContain('btn-daemon-stop');
    expect(html).toContain('daemonStart()');
    expect(html).toContain('daemonStop()');
  });

  it('includes API paths in client JS', () => {
    expect(html).toContain('/api/status');
    expect(html).toContain('/api/sessions');
    expect(html).toContain('/api/logs');
    expect(html).toContain('/api/settings');
    expect(html).toContain('/api/daemon/start');
    expect(html).toContain('/api/daemon/stop');
  });

  it('includes glassmorphism CSS', () => {
    expect(html).toContain('backdrop-filter');
    expect(html).toContain('blur(6px)');
  });

  it('includes auto-refresh interval', () => {
    expect(html).toContain('setInterval');
    expect(html).toContain('5000');
  });

  it('includes escapeHtml in client script', () => {
    expect(html).toContain('function escapeHtml');
  });

  it('includes markdown rendering functions', () => {
    expect(html).toContain('function renderMarkdown');
    expect(html).toContain('function renderInline');
    expect(html).toContain('function renderMdTable');
  });

  it('includes toggleThinkingPreamble function', () => {
    expect(html).toContain('function toggleThinkingPreamble');
  });

  it('does not include deprecated wrapThinkingPreamble helper', () => {
    expect(html).not.toContain('function wrapThinkingPreamble');
  });

  it('includes wrapProcessNarration function for Codex process separation', () => {
    expect(html).toContain('function wrapProcessNarration');
  });

  it('setBubbleContent detects process-end separator', () => {
    expect(html).toContain('<!-- process-end -->');
    expect(html).toContain('wrapProcessNarration');
  });

  it('includes thinking preamble CSS classes', () => {
    expect(html).toContain('.thinking-preamble');
    expect(html).toContain('.thinking-preamble-label');
    expect(html).toContain('.thinking-preamble-content');
    expect(html).toContain('.thinking-toggle');
    expect(html).toContain('hr.thinking-divider');
  });

  it('includes nested UL in OL CSS', () => {
    expect(html).toContain('.chat-bubble ol > li > ul');
  });

  it('includes favicon and apple-touch-icon', () => {
    expect(html).toContain('rel="icon" type="image/png"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it('includes tool cards', () => {
    expect(html).toContain('Claude');
    expect(html).toContain('Codex');
    expect(html).toContain('Gemini');
    expect(html).toContain('tool-card');
  });

  it('includes log level filter chips', () => {
    expect(html).toContain('data-level="info"');
    expect(html).toContain('data-level="warn"');
    expect(html).toContain('data-level="error"');
    expect(html).toContain('data-level="debug"');
  });

  it('includes log search input', () => {
    expect(html).toContain('log-search');
    expect(html).toContain('Search...');
  });

  it('includes sessions table with delete and clear all', () => {
    expect(html).toContain('sessions-tbody');
    expect(html).toContain('deleteSession');
    expect(html).toContain('clearAllSessions');
    expect(html).toContain('Clear All Sessions');
  });

  it('includes settings save/reset buttons', () => {
    expect(html).toContain('saveSettings()');
    expect(html).toContain('loadSettings()');
  });

  it('includes settings nav layout', () => {
    expect(html).toContain('settings-layout');
    expect(html).toContain('id="settings-nav"');
    expect(html).toContain('id="settings-subnav"');
    expect(html).toContain('id="settings-form-panel"');
  });

  it('includes settings nav CSS classes', () => {
    expect(html).toContain('.settings-nav');
    expect(html).toContain('.settings-nav-item');
    expect(html).toContain('.settings-subnav');
    expect(html).toContain('.settings-subnav-item');
    expect(html).toContain('.settings-form-panel');
    expect(html).toContain('.settings-form-title');
  });

  it('includes SETTINGS_CATEGORIES constant', () => {
    expect(html).toContain('var SETTINGS_CATEGORIES');
  });

  it('includes settings navigation functions', () => {
    expect(html).toContain('function selectSettingsCategory');
    expect(html).toContain('function selectSettingsSub');
    expect(html).toContain('function renderSettingsNav');
    expect(html).toContain('function renderSettingsSubNav');
    expect(html).toContain('function renderSettingsForm');
    expect(html).toContain('function renderSettingsTable');
  });

  it('includes settingsToolIcons configuration', () => {
    expect(html).toContain('var settingsToolIcons');
  });

  it('includes toast notification system', () => {
    expect(html).toContain('toast-container');
    expect(html).toContain('function toast');
  });

  it('includes sidebar with hash routing', () => {
    expect(html).toContain('href="#overview"');
    expect(html).toContain('href="#sessions"');
    expect(html).toContain('href="#logs"');
    expect(html).toContain('href="#settings"');
    expect(html).toContain('href="#dev"');
    expect(html).toContain('href="#chat"');
    expect(html).toContain('hashchange');
  });

  it('uses warm cream theme background', () => {
    expect(html).toContain('#F5F1E8');
  });

  it('includes dev tab elements', () => {
    expect(html).toContain('dev-alias-list');
    expect(html).toContain('dev-modal');
    expect(html).toContain('devShowCreateModal()');
    expect(html).toContain('devLoadAliases');
    expect(html).toContain('devDeleteAlias');
    expect(html).toContain('devSaveAlias');
    expect(html).toContain('/api/dev-aliases');
  });

  it('includes chat tab elements', () => {
    expect(html).toContain('chat-layout');
    expect(html).toContain('chat-tree');
    expect(html).toContain('chat-sidebar-header');
    expect(html).toContain('chat-messages');
    expect(html).toContain('chat-input');
    expect(html).toContain('chat-send-btn');
  });

  it('includes chat tree UI elements', () => {
    expect(html).toContain('chat-sidebar-title');
    expect(html).toContain('chat-new-session-btn');
    expect(html).toContain('chatCreateSession()');
  });

  it('includes chat main header with delete button', () => {
    expect(html).toContain('chat-main-header');
    expect(html).toContain('chat-main-delete-btn');
    expect(html).toContain('chatDeleteCurrentSession()');
    expect(html).toContain('Delete Session');
  });

  it('includes tool picker modal', () => {
    expect(html).toContain('chat-tool-modal');
    expect(html).toContain('chat-tool-modal-overlay');
    expect(html).toContain('chatCreateWithTool');
    expect(html).toContain('chatCloseToolModal');
    expect(html).toContain('Select a tool');
  });

  it('includes chat API paths', () => {
    expect(html).toContain('/api/chat/sessions');
    expect(html).toContain('/api/chat/');
    expect(html).toContain('/messages');
    expect(html).toContain('/send');
  });

  it('includes fetchSSE function', () => {
    expect(html).toContain('function fetchSSE');
  });

  it('includes chat client functions', () => {
    expect(html).toContain('chatToggleTool');
    expect(html).toContain('chatSelectSession');
    expect(html).toContain('chatSend');
    expect(html).toContain('chatLoadMessages');
    expect(html).toContain('chatDoSend');
    expect(html).toContain('chatStop');
    expect(html).toContain('refreshChatTree');
    expect(html).toContain('chatCreateSession');
    expect(html).toContain('chatDeleteSession');
    expect(html).toContain('chatCreateWithTool');
    expect(html).toContain('chatCloseToolModal');
    expect(html).toContain('chatDeleteCurrentSession');
    expect(html).toContain('chatUpdateMainHeader');
  });

  it('includes chat polling functions', () => {
    expect(html).toContain('chatStartPoll');
    expect(html).toContain('chatStopPoll');
    expect(html).toContain('chatPollNewMessages');
    expect(html).toContain('chatLastMessageId');
  });

  it('includes new messages API path', () => {
    expect(html).toContain('/messages/new?after=');
  });

  it('includes chat keyboard handling', () => {
    expect(html).toContain("e.key === 'Enter'");
    expect(html).toContain('e.shiftKey');
  });

  it('uses only defined SHARED_ICON keys', () => {
    const iconBlock = html.match(/var SHARED_ICON = \{([\s\S]*?)\n\s*};/);
    expect(iconBlock).not.toBeNull();

    const iconBody = iconBlock?.[1] || '';
    const definedKeys = Array.from(iconBody.matchAll(/\n\s*([A-Za-z0-9_]+)\s*:/g)).map((m) => m[1]);

    const aliases = Array.from(
      html.matchAll(/\b(?:var|let|const)\s+([A-Za-z0-9_]+)\s*=\s*SHARED_ICON\s*;/g),
    ).map((m) => m[1]);

    const usedKeys = new Set<string>();
    for (const m of html.matchAll(/SHARED_ICON\.([A-Za-z0-9_]+)/g)) {
      const key = m[1];
      if (key) usedKeys.add(key);
    }
    for (const alias of aliases) {
      const re = new RegExp(`\\b${alias}\\.([A-Za-z0-9_]+)`, 'g');
      for (const m of html.matchAll(re)) {
        const key = m[1];
        if (key) usedKeys.add(key);
      }
    }

    const missingKeys = Array.from(usedKeys).filter((key) => !definedKeys.includes(key));
    expect(missingKeys).toEqual([]);
  });

  it('does not embed any secrets in HTML', () => {
    expect(html).not.toContain('__HG_TOKEN');
    expect(html).not.toContain('X-HG-Token');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('returns unchanged string when no special chars', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes single quote', () => {
    expect(escapeHtml("x'y")).toBe('x&#39;y');
  });
});
