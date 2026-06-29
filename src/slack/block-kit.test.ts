import type {
  ActionsBlock,
  ContextBlock,
  HeaderBlock,
  MarkdownBlock,
  SectionBlock,
} from '@slack/types';
import { describe, expect, it } from 'vitest';
import type { PendingMcpAuthBypassApproval, PendingToolApproval } from '../context/app-types.js';
import type { SessionSummary } from '../session/manager.js';
import type { DevAlias } from '../store/dev-alias.js';
import {
  ACTION_MCP_AUTH_APPROVE,
  ACTION_MCP_AUTH_REJECT,
  ACTION_MENU_DEV_SELECT,
  ACTION_MENU_EXIT,
  ACTION_MENU_NEW_SESSION,
  ACTION_MENU_RESET,
  ACTION_MENU_SESSION_CLEAR,
  ACTION_MENU_SESSION_CLEAR_ALL,
  ACTION_MENU_SESSION_DELETE,
  ACTION_MENU_SESSION_LIST,
  ACTION_MENU_STOP,
  ACTION_MENU_TOOL_SELECT,
  ACTION_MODE_SELECT,
  ACTION_SESSION_RESUME,
  ACTION_TOOL_APPROVE,
  ACTION_TOOL_REJECT,
  type ActiveSessionInfo,
  buildApprovalResolvedBlocks,
  buildMcpAuthApprovalBlocks,
  buildMenuActiveSessionBlocks,
  buildMenuNoSessionBlocks,
  buildModeSelectBlocks,
  buildSessionClearBlocks,
  buildSessionListBlocks,
  buildToolApprovalBlocks,
  decodeActionValue,
  encodeActionValue,
} from './block-kit.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePendingToolApproval(overrides?: Partial<PendingToolApproval>): PendingToolApproval {
  return {
    sessionKey: 'sk-1',
    tool: 'claude',
    deniedTools: ['bash'],
    requestedToolName: 'Bash',
    requestedToolArgs: { command: 'rm -rf /' },
    approvedCodexToolCalls: [],
    skipGeminiMcpPreflightOnce: false,
    prompt: 'do something',
    userId: 'U123',
    requestId: 'req-abc',
    expiresAt: Date.now() + 120_000,
    ...overrides,
  };
}

function makePendingMcpAuth(
  overrides?: Partial<PendingMcpAuthBypassApproval>,
): PendingMcpAuthBypassApproval {
  return {
    sessionKey: 'sk-2',
    tool: 'claude',
    server: 'aws-api',
    action: 'retry_with_preauth',
    prompt: 'deploy',
    userId: 'U456',
    requestId: 'req-xyz',
    expiresAt: Date.now() + 120_000,
    ...overrides,
  };
}

function makeSessionSummary(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    sessionKey: 'sk-3',
    sessionId: 'sess-001',
    threadKey: 'C1:1.0',
    userId: 'U789',
    tool: 'claude',
    mode: 'readonly',
    modeExpiresAt: null,
    workdir: '/tmp/work',
    runningJobId: null,
    startedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T01:00:00Z',
    active: false,
    devAlias: null,
    ...overrides,
  };
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${label} is required`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('encodeActionValue / decodeActionValue', () => {
  it('roundtrips correctly', () => {
    const encoded = encodeActionValue('C1:1.0', 'req-abc');
    const decoded = decodeActionValue(encoded);
    expect(decoded).toEqual({ tk: 'C1:1.0', rid: 'req-abc' });
  });

  it('preserves special characters in threadKey', () => {
    const encoded = encodeActionValue('C123ABC:1234567890.123456', 'id-with-dashes');
    const decoded = decodeActionValue(encoded);
    expect(decoded.tk).toBe('C123ABC:1234567890.123456');
    expect(decoded.rid).toBe('id-with-dashes');
  });

  it('throws on invalid payload shape', () => {
    expect(() => decodeActionValue('{"tk":"C1:1.0"}')).toThrow('Invalid action value');
  });
});

describe('buildToolApprovalBlocks', () => {
  it('produces section + markdown + actions + context blocks', () => {
    const pending = makePendingToolApproval();
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 120);

    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.type).toBe('section');
    expect(blocks[1]?.type).toBe('markdown');
    expect(blocks[2]?.type).toBe('actions');
    expect(blocks[3]?.type).toBe('context');
  });

  it('includes correct action IDs on buttons', () => {
    const pending = makePendingToolApproval();
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const actions = blocks[2] as ActionsBlock;

    expect(actions.elements).toHaveLength(2);
    expect(actions.elements[0]).toMatchObject({
      type: 'button',
      action_id: ACTION_TOOL_APPROVE,
    });
    expect(actions.elements[1]).toMatchObject({
      type: 'button',
      action_id: ACTION_TOOL_REJECT,
    });
  });

  it('encodes threadKey and requestId in button values', () => {
    const pending = makePendingToolApproval({ requestId: 'r42' });
    const blocks = buildToolApprovalBlocks(pending, 'C9:9.9', 30);
    const actions = blocks[2] as ActionsBlock;

    for (const el of actions.elements) {
      if (el.type === 'button') {
        const decoded = decodeActionValue(requireValue(el.value, 'tool approval button value'));
        expect(decoded.tk).toBe('C9:9.9');
        expect(decoded.rid).toBe('r42');
      }
    }
  });

  it('mentions tool name in section text', () => {
    const pending = makePendingToolApproval({ tool: 'gemini', requestedToolName: 'search_web' });
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('gemini');
    expect(section.text?.text).toContain('search_web');
  });

  it('renders arguments in a markdown block with syntax-highlighted JSON', () => {
    const pending = makePendingToolApproval({
      requestedToolArgs: { command: 'rm -rf /', path: '/tmp' },
    });
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const mdBlock = blocks[1] as MarkdownBlock;
    expect(mdBlock.type).toBe('markdown');
    expect(mdBlock.text).toContain('**Arguments:**');
    expect(mdBlock.text).toContain('```json');
    expect(mdBlock.text).toContain('"command"');
  });

  it('renders string arguments with text language hint', () => {
    const pending = makePendingToolApproval({
      requestedToolArgs: 'some plain text args',
    });
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const mdBlock = blocks[1] as MarkdownBlock;
    expect(mdBlock.text).toContain('```text');
    expect(mdBlock.text).toContain('some plain text args');
  });

  it('shows "(not available)" in markdown block when args are null', () => {
    const pending = makePendingToolApproval({ requestedToolArgs: null });
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const mdBlock = blocks[1] as MarkdownBlock;
    expect(mdBlock.text).toContain('(not available)');
  });

  it('does not include arguments in section text (moved to markdown block)', () => {
    const pending = makePendingToolApproval({
      requestedToolArgs: { key: 'value' },
    });
    const blocks = buildToolApprovalBlocks(pending, 'C1:1.0', 60);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).not.toContain('Arguments');
    expect(section.text?.text).not.toContain('```');
  });

  it('includes expiry time in context block', () => {
    const blocks = buildToolApprovalBlocks(makePendingToolApproval(), 'C1:1.0', 45);
    const ctx = blocks[3] as ContextBlock;
    const text = requireValue(ctx.elements[0], 'tool approval context text');
    expect(text).toMatchObject({ type: 'mrkdwn' });
    expect('text' in text && text.text).toContain('45s');
  });

  it('falls back to unknown_tool when requested tool cannot be resolved', () => {
    const blocks = buildToolApprovalBlocks(
      makePendingToolApproval({
        requestedToolName: 'unknown_tool',
        deniedTools: [],
      }),
      'C1:1.0',
      30,
    );
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('unknown_tool');
  });
});

describe('buildMcpAuthApprovalBlocks', () => {
  it('produces section + actions + context blocks', () => {
    const pending = makePendingMcpAuth();
    const blocks = buildMcpAuthApprovalBlocks(pending, 'C1:1.0', 90);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.type).toBe('section');
    expect(blocks[1]?.type).toBe('actions');
    expect(blocks[2]?.type).toBe('context');
  });

  it('uses MCP-specific action IDs', () => {
    const blocks = buildMcpAuthApprovalBlocks(makePendingMcpAuth(), 'C1:1.0', 60);
    const actions = blocks[1] as ActionsBlock;
    expect(actions.elements[0]).toMatchObject({ action_id: ACTION_MCP_AUTH_APPROVE });
    expect(actions.elements[1]).toMatchObject({ action_id: ACTION_MCP_AUTH_REJECT });
  });

  it('includes server name in section text', () => {
    const pending = makePendingMcpAuth({ server: 'my-server' });
    const blocks = buildMcpAuthApprovalBlocks(pending, 'C1:1.0', 60);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('my-server');
  });

  it('describes retry_with_preauth action', () => {
    const pending = makePendingMcpAuth({ action: 'retry_with_preauth', server: 'svc' });
    const blocks = buildMcpAuthApprovalBlocks(pending, 'C1:1.0', 60);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('Re-authenticate');
  });

  it('describes skip_preflight_once action', () => {
    const pending = makePendingMcpAuth({ action: 'skip_preflight_once', server: 'svc' });
    const blocks = buildMcpAuthApprovalBlocks(pending, 'C1:1.0', 60);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('Skip MCP auth');
  });
});

describe('buildSessionListBlocks', () => {
  it('shows "no sessions" message when empty', () => {
    const blocks = buildSessionListBlocks([], 'C1:1.0');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('section');
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('No sessions');
  });

  it('creates header + section blocks for each session', () => {
    const sessions = [
      makeSessionSummary({ sessionId: 'a', active: true }),
      makeSessionSummary({ sessionId: 'b', active: false }),
    ];
    const blocks = buildSessionListBlocks(sessions, 'C1:1.0');

    // 1 header + 2 session sections
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.type).toBe('header');
  });

  it('adds Resume button only to inactive sessions', () => {
    const sessions = [
      makeSessionSummary({ sessionId: 'active-one', active: true }),
      makeSessionSummary({ sessionId: 'inactive-one', active: false }),
    ];
    const blocks = buildSessionListBlocks(sessions, 'C1:1.0');

    const activeSection = blocks[1] as SectionBlock;
    const inactiveSection = blocks[2] as SectionBlock;

    expect(activeSection.accessory).toBeUndefined();
    expect(inactiveSection.accessory).toMatchObject({
      type: 'button',
      action_id: ACTION_SESSION_RESUME,
    });
  });

  it('encodes sessionId in Resume button value', () => {
    const sessions = [makeSessionSummary({ sessionId: 'my-sess', active: false })];
    const blocks = buildSessionListBlocks(sessions, 'C1:1.0');
    const section = blocks[1] as SectionBlock;
    const btn = section.accessory as { value?: string };
    const decoded = decodeActionValue(requireValue(btn.value, 'resume button value'));
    expect(decoded.rid).toBe('my-sess');
    expect(decoded.tk).toBe('C1:1.0');
  });
});

describe('buildModeSelectBlocks', () => {
  it('produces a section with static_select accessory', () => {
    const blocks = buildModeSelectBlocks('readonly', 'C1:1.0');
    expect(blocks).toHaveLength(1);
    const section = blocks[0] as SectionBlock;
    expect(section.type).toBe('section');
    expect(section.accessory?.type).toBe('static_select');
  });

  it('shows current mode in section text', () => {
    const blocks = buildModeSelectBlocks('write', 'C1:1.0');
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('write');
  });

  it('uses ACTION_MODE_SELECT as action_id', () => {
    const blocks = buildModeSelectBlocks('readonly', 'C1:1.0');
    const section = blocks[0] as SectionBlock;
    expect(section.accessory).toMatchObject({ action_id: ACTION_MODE_SELECT });
  });

  it('has readonly and write options', () => {
    const blocks = buildModeSelectBlocks('readonly', 'C1:1.0');
    const section = blocks[0] as SectionBlock;
    const select = section.accessory as { options?: Array<{ text: { text: string } }> };
    const optionTexts = select.options?.map((o) => o.text.text) ?? [];
    expect(optionTexts).toContain('readonly');
    expect(optionTexts).toContain('write');
  });
});

describe('buildApprovalResolvedBlocks', () => {
  it('shows approved status with check mark', () => {
    const blocks = buildApprovalResolvedBlocks('approved', 'Bash', 'U123');
    expect(blocks).toHaveLength(1);
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('Approved');
    expect(section.text?.text).toContain(':white_check_mark:');
    expect(section.text?.text).toContain('Bash');
    expect(section.text?.text).toContain('<@U123>');
  });

  it('shows rejected status with X mark', () => {
    const blocks = buildApprovalResolvedBlocks('rejected', 'search_web', 'U456');
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('Rejected');
    expect(section.text?.text).toContain(':x:');
    expect(section.text?.text).toContain('search_web');
    expect(section.text?.text).toContain('<@U456>');
  });
});

// ---------------------------------------------------------------------------
// Dashboard / Menu Builders
// ---------------------------------------------------------------------------

function makeDevAlias(overrides?: Partial<DevAlias>): DevAlias {
  return {
    name: 'my-project',
    path: '/home/user/projects/my-project',
    tool: 'claude',
    instructionContent: null,
    createdAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function makeActiveSessionInfo(overrides?: Partial<ActiveSessionInfo>): ActiveSessionInfo {
  return {
    sessionId: 'sess-001',
    tool: 'claude',
    mode: 'readonly',
    modeExpiresAt: null,
    model: null,
    workdir: '/tmp/work',
    runningJobId: null,
    ...overrides,
  };
}

describe('buildMenuNoSessionBlocks', () => {
  it('shows header + prompt + tool buttons when no sessions exist', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0');

    // header, section, actions, context
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[0]?.type).toBe('header');
    expect(blocks[1]?.type).toBe('section');
    expect(blocks[2]?.type).toBe('actions');

    const actions = blocks[2] as ActionsBlock;
    expect(actions.elements).toHaveLength(3);
    const actionIds = actions.elements.map((el) => ('action_id' in el ? el.action_id : ''));
    expect(actionIds).toContain(`${ACTION_MENU_TOOL_SELECT}_gemini`);
    expect(actionIds).toContain(`${ACTION_MENU_TOOL_SELECT}_claude`);
    expect(actionIds).toContain(`${ACTION_MENU_TOOL_SELECT}_codex`);
  });

  it('adds Sessions and Clear buttons when sessions exist', () => {
    const sessions = [
      makeSessionSummary({ sessionId: 'old-sess', active: false }),
      makeSessionSummary({ sessionId: 'older-sess', active: false }),
    ];
    const blocks = buildMenuNoSessionBlocks(sessions, 'C1:1.0');

    const actions = blocks[2] as ActionsBlock;
    // 3 tool buttons + Sessions + Clear = 5 elements
    expect(actions.elements).toHaveLength(5);

    const sessionListBtn = actions.elements.find(
      (el) =>
        el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_SESSION_LIST,
    );
    expect(sessionListBtn).toBeDefined();

    const clearBtn = actions.elements.find(
      (el) =>
        el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_SESSION_CLEAR,
    );
    expect(clearBtn).toBeDefined();
    expect(clearBtn).toMatchObject({ style: 'danger' });
  });

  it('does not add session management buttons when no sessions exist', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0');

    const actions = blocks[2] as ActionsBlock;
    expect(actions.elements).toHaveLength(3); // tools only
  });

  it('does not show inline session list (sessions are on-demand)', () => {
    const sessions = [makeSessionSummary({ sessionId: 'old-sess', active: false })];
    const blocks = buildMenuNoSessionBlocks(sessions, 'C1:1.0');

    // No inline session sections with Resume accessory buttons
    const inlineSessionSections = blocks.filter(
      (b) =>
        b.type === 'section' &&
        'accessory' in b &&
        b.accessory?.type === 'button' &&
        'action_id' in b.accessory &&
        b.accessory.action_id === ACTION_SESSION_RESUME,
    );
    expect(inlineSessionSections).toHaveLength(0);

    // No "Existing Sessions" header
    const existingHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Existing Sessions',
    );
    expect(existingHeader).toBeUndefined();
  });

  it('encodes tool name in button values', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0');
    const actions = blocks[2] as ActionsBlock;

    for (const el of actions.elements) {
      if (el.type === 'button') {
        const payload = JSON.parse(requireValue(el.value, 'tool select button value')) as {
          tk: string;
          tool: string;
        };
        expect(payload.tk).toBe('C1:1.0');
        expect(['gemini', 'claude', 'codex']).toContain(payload.tool);
      }
    }
  });

  it('includes context footer with help hint', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0');
    const contextBlock = blocks.find((b) => b.type === 'context') as ContextBlock;
    expect(contextBlock).toBeDefined();
    const text = requireValue(contextBlock.elements[0], 'menu footer text');
    expect('text' in text && text.text).toContain('!help');
  });

  it('shows session count in footer when sessions exist', () => {
    const sessions = [
      makeSessionSummary({ sessionId: 's1' }),
      makeSessionSummary({ sessionId: 's2' }),
    ];
    const blocks = buildMenuNoSessionBlocks(sessions, 'C1:1.0');
    const contextBlock = blocks.find((b) => b.type === 'context') as ContextBlock;
    const text = requireValue(contextBlock.elements[0], 'menu footer text');
    expect('text' in text && text.text).toContain('2 sessions available');
  });

  it('does not show session count when no sessions', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0');
    const contextBlock = blocks.find((b) => b.type === 'context') as ContextBlock;
    const text = requireValue(contextBlock.elements[0], 'menu footer text');
    expect('text' in text && text.text).not.toContain('sessions available');
  });

  it('uses singular form for 1 session', () => {
    const sessions = [makeSessionSummary({ sessionId: 's1' })];
    const blocks = buildMenuNoSessionBlocks(sessions, 'C1:1.0');
    const contextBlock = blocks.find((b) => b.type === 'context') as ContextBlock;
    const text = requireValue(contextBlock.elements[0], 'menu footer text');
    expect('text' in text && text.text).toContain('1 session available');
  });
});

describe('buildMenuActiveSessionBlocks', () => {
  it('shows session info and exit button', () => {
    const info = makeActiveSessionInfo();
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    expect(blocks[0]?.type).toBe('header');

    // Session info section
    const infoSection = blocks.find(
      (b) => b.type === 'section' && (b as SectionBlock).text?.text?.includes('Active Session'),
    ) as SectionBlock;
    expect(infoSection).toBeDefined();
    expect(infoSection.text?.text).toContain('sess-001');
    expect(infoSection.text?.text).toContain('claude');
    expect(infoSection.text?.text).toContain('readonly');

    // Exit button
    const actionsBlock = blocks.find((b) => b.type === 'actions') as ActionsBlock;
    expect(actionsBlock).toBeDefined();
    const exitBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_EXIT,
    );
    expect(exitBtn).toBeDefined();
  });

  it('shows mode expiry text when modeExpiresAt is present', () => {
    const info = makeActiveSessionInfo({ mode: 'write', modeExpiresAt: '2026-03-01T00:00:00Z' });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');
    const infoSection = blocks.find(
      (b) => b.type === 'section' && (b as SectionBlock).text?.text?.includes('Active Session'),
    ) as SectionBlock;
    expect(infoSection.text?.text).toContain('expires: 2026-03-01T00:00:00Z');
  });

  it('shows stop button when job is running', () => {
    const info = makeActiveSessionInfo({ runningJobId: 'job-42' });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const actionsBlock = blocks.find((b) => b.type === 'actions') as ActionsBlock;
    const stopBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_STOP,
    );
    expect(stopBtn).toBeDefined();
  });

  it('does not show stop button when idle', () => {
    const info = makeActiveSessionInfo({ runningJobId: null });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const actionsBlock = blocks.find((b) => b.type === 'actions') as ActionsBlock;
    const stopBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_STOP,
    );
    expect(stopBtn).toBeUndefined();
  });

  it('displays model info', () => {
    const info = makeActiveSessionInfo({ model: 'gpt-4o' });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const infoSection = blocks.find(
      (b) => b.type === 'section' && (b as SectionBlock).text?.text?.includes('Model'),
    ) as SectionBlock;
    expect(infoSection.text?.text).toContain('gpt-4o');
  });

  it('shows default when model is null', () => {
    const info = makeActiveSessionInfo({ model: null });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const infoSection = blocks.find(
      (b) => b.type === 'section' && (b as SectionBlock).text?.text?.includes('Model'),
    ) as SectionBlock;
    expect(infoSection.text?.text).toContain('default');
  });

  it('includes mode selector', () => {
    const info = makeActiveSessionInfo({ mode: 'write' });
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const modeSection = blocks.find((b) => {
      const accessory = (b as SectionBlock).accessory;
      return (
        b.type === 'section' &&
        accessory?.type === 'static_select' &&
        accessory !== undefined &&
        'action_id' in accessory &&
        accessory.action_id === ACTION_MODE_SELECT
      );
    });
    expect(modeSection).toBeDefined();
  });

  it('shows other sessions with Resume buttons', () => {
    const info = makeActiveSessionInfo({ sessionId: 'active-sess' });
    const sessions = [
      makeSessionSummary({ sessionId: 'active-sess', active: true }),
      makeSessionSummary({ sessionId: 'other-sess', active: false }),
    ];
    const blocks = buildMenuActiveSessionBlocks(info, sessions, 'C1:1.0');

    // Should have "Other Sessions" header
    const otherHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Other Sessions',
    );
    expect(otherHeader).toBeDefined();

    // Should have a Resume button for other-sess but NOT for active-sess
    const resumeButtons = blocks.filter((b) => {
      const accessory = (b as SectionBlock).accessory;
      return (
        b.type === 'section' &&
        accessory?.type === 'button' &&
        accessory !== undefined &&
        'action_id' in accessory &&
        accessory.action_id === ACTION_SESSION_RESUME
      );
    });
    expect(resumeButtons).toHaveLength(1);
  });

  it('omits other sessions section when none exist', () => {
    const info = makeActiveSessionInfo({ sessionId: 'only-sess' });
    const sessions = [makeSessionSummary({ sessionId: 'only-sess', active: true })];
    const blocks = buildMenuActiveSessionBlocks(info, sessions, 'C1:1.0');

    const otherHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Other Sessions',
    );
    expect(otherHeader).toBeUndefined();
  });

  it('includes New Session and Reset buttons', () => {
    const info = makeActiveSessionInfo();
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const actionsBlock = blocks.find((b) => b.type === 'actions') as ActionsBlock;
    expect(actionsBlock).toBeDefined();

    const newSessionBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_NEW_SESSION,
    );
    expect(newSessionBtn).toBeDefined();

    const resetBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_RESET,
    );
    expect(resetBtn).toBeDefined();
  });

  it('Reset button has danger style', () => {
    const info = makeActiveSessionInfo();
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0');

    const actionsBlock = blocks.find((b) => b.type === 'actions') as ActionsBlock;
    const resetBtn = actionsBlock.elements.find(
      (el) => el.type === 'button' && 'action_id' in el && el.action_id === ACTION_MENU_RESET,
    );
    expect(resetBtn).toMatchObject({ style: 'danger' });
  });

  it('shows dev alias buttons when devAliases provided', () => {
    const info = makeActiveSessionInfo();
    const aliases = [
      makeDevAlias({ name: 'proj-a', tool: 'claude' }),
      makeDevAlias({ name: 'proj-b', tool: 'gemini' }),
    ];
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0', aliases);

    const devHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Dev Environments',
    );
    expect(devHeader).toBeDefined();

    // Find actions block for dev aliases (has action_id starting with ACTION_MENU_DEV_SELECT)
    const devActionsBlock = blocks.find(
      (b) =>
        b.type === 'actions' &&
        (b as ActionsBlock).elements.some(
          (el) =>
            el.type === 'button' &&
            'action_id' in el &&
            typeof el.action_id === 'string' &&
            el.action_id.startsWith(ACTION_MENU_DEV_SELECT),
        ),
    ) as ActionsBlock;
    expect(devActionsBlock).toBeDefined();
    expect(devActionsBlock.elements).toHaveLength(2);
  });

  it('omits dev alias section when devAliases is empty', () => {
    const info = makeActiveSessionInfo();
    const blocks = buildMenuActiveSessionBlocks(info, [], 'C1:1.0', []);

    const devHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Dev Environments',
    );
    expect(devHeader).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Session Clear Blocks
// ---------------------------------------------------------------------------

describe('buildSessionClearBlocks', () => {
  it('shows "no sessions" message when empty', () => {
    const blocks = buildSessionClearBlocks([], 'C1:1.0');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('section');
    const section = blocks[0] as SectionBlock;
    expect(section.text?.text).toContain('No sessions to clear');
  });

  it('creates header + description + session sections + clear-all button', () => {
    const sessions = [
      makeSessionSummary({ sessionId: 'a', tool: 'claude' }),
      makeSessionSummary({ sessionId: 'b', tool: 'gemini' }),
    ];
    const blocks = buildSessionClearBlocks(sessions, 'C1:1.0');

    // header + description + 2 session sections + clear-all actions
    expect(blocks).toHaveLength(5);
    expect(blocks[0]?.type).toBe('header');
    expect((blocks[0] as HeaderBlock).text.text).toBe('Session Cleanup');
    expect(blocks[1]?.type).toBe('section');
    expect(blocks[2]?.type).toBe('section');
    expect(blocks[3]?.type).toBe('section');
    expect(blocks[4]?.type).toBe('actions');
  });

  it('adds Delete button to each session', () => {
    const sessions = [makeSessionSummary({ sessionId: 'sess-x', tool: 'claude' })];
    const blocks = buildSessionClearBlocks(sessions, 'C1:1.0');

    const sessionSection = blocks[2] as SectionBlock;
    expect(sessionSection.accessory).toMatchObject({
      type: 'button',
      style: 'danger',
      action_id: ACTION_MENU_SESSION_DELETE,
    });

    // Check value contains session ID
    const decoded = decodeActionValue((sessionSection.accessory as { value: string }).value);
    expect(decoded.tk).toBe('C1:1.0');
    expect(decoded.rid).toBe('sess-x');
  });

  it('shows active label for active sessions', () => {
    const sessions = [makeSessionSummary({ sessionId: 'active-s', active: true })];
    const blocks = buildSessionClearBlocks(sessions, 'C1:1.0');

    const sessionSection = blocks[2] as SectionBlock;
    expect(sessionSection.text?.text).toContain('active');
  });

  it('includes Clear All button with danger style', () => {
    const sessions = [makeSessionSummary({ sessionId: 'x' })];
    const blocks = buildSessionClearBlocks(sessions, 'C1:1.0');

    const actionsBlock = blocks[blocks.length - 1] as ActionsBlock;
    expect(actionsBlock.type).toBe('actions');
    expect(actionsBlock.elements).toHaveLength(1);

    const clearAllBtn = requireValue(actionsBlock.elements[0], 'clear all button');
    expect(clearAllBtn).toMatchObject({
      type: 'button',
      style: 'danger',
      action_id: ACTION_MENU_SESSION_CLEAR_ALL,
    });

    // Check threadKey in value
    if (clearAllBtn.type === 'button') {
      const payload = JSON.parse(requireValue(clearAllBtn.value, 'clear all button value')) as {
        tk: string;
      };
      expect(payload.tk).toBe('C1:1.0');
    }
  });
});

// ---------------------------------------------------------------------------
// Dev Alias Blocks (via buildMenuNoSessionBlocks)
// ---------------------------------------------------------------------------

describe('dev alias blocks in buildMenuNoSessionBlocks', () => {
  it('omits dev section when no aliases exist', () => {
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0', []);

    const devHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Dev Environments',
    );
    expect(devHeader).toBeUndefined();
  });

  it('shows dev alias buttons with correct action IDs and values', () => {
    const aliases = [
      makeDevAlias({ name: 'frontend', tool: 'claude' }),
      makeDevAlias({ name: 'backend', tool: 'gemini' }),
    ];
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0', aliases);

    const devHeader = blocks.find(
      (b) => b.type === 'header' && (b as HeaderBlock).text.text === 'Dev Environments',
    );
    expect(devHeader).toBeDefined();

    const devActionsBlock = blocks.find(
      (b) =>
        b.type === 'actions' &&
        (b as ActionsBlock).elements.some(
          (el) =>
            el.type === 'button' &&
            'action_id' in el &&
            typeof el.action_id === 'string' &&
            el.action_id.startsWith(ACTION_MENU_DEV_SELECT),
        ),
    ) as ActionsBlock;
    expect(devActionsBlock).toBeDefined();
    expect(devActionsBlock.elements).toHaveLength(2);

    // Check first button
    const firstBtn = requireValue(devActionsBlock.elements[0], 'dev alias button');
    expect(firstBtn).toMatchObject({
      type: 'button',
      action_id: `${ACTION_MENU_DEV_SELECT}_frontend`,
    });
    if (firstBtn.type === 'button') {
      const payload = JSON.parse(requireValue(firstBtn.value, 'dev alias button value')) as {
        tk: string;
        alias: string;
      };
      expect(payload.tk).toBe('C1:1.0');
      expect(payload.alias).toBe('frontend');
    }
  });

  it('shows tool name in button text', () => {
    const aliases = [makeDevAlias({ name: 'myapp', tool: 'codex' })];
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0', aliases);

    const devActionsBlock = blocks.find(
      (b) =>
        b.type === 'actions' &&
        (b as ActionsBlock).elements.some(
          (el) =>
            el.type === 'button' &&
            'action_id' in el &&
            typeof el.action_id === 'string' &&
            el.action_id.startsWith(ACTION_MENU_DEV_SELECT),
        ),
    ) as ActionsBlock;
    const btn = requireValue(devActionsBlock.elements[0], 'dev alias button');
    if (btn.type === 'button') {
      expect(btn.text.text).toContain('myapp');
      expect(btn.text.text).toContain('codex');
    }
  });

  it('chunks dev alias buttons into groups of 5', () => {
    const aliases = Array.from({ length: 7 }, (_, i) =>
      makeDevAlias({ name: `alias-${i}`, tool: 'claude' }),
    );
    const blocks = buildMenuNoSessionBlocks([], 'C1:1.0', aliases);

    // Find all dev alias action blocks
    const devActionBlocks = blocks.filter(
      (b) =>
        b.type === 'actions' &&
        (b as ActionsBlock).elements.some(
          (el) =>
            el.type === 'button' &&
            'action_id' in el &&
            typeof el.action_id === 'string' &&
            el.action_id.startsWith(ACTION_MENU_DEV_SELECT),
        ),
    ) as ActionsBlock[];

    // 7 aliases should produce 2 action blocks (5 + 2)
    expect(devActionBlocks).toHaveLength(2);
    expect(devActionBlocks[0]?.elements).toHaveLength(5);
    expect(devActionBlocks[1]?.elements).toHaveLength(2);
  });
});
