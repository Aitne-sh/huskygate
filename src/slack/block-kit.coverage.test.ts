/**
 * Coverage test for block-kit.ts — targets line 509:
 * threadKey.startsWith('dashboard_') branch for origin label
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { SessionSummary } from '../session/manager.js';
import type { ToolName } from '../config/types.js';
import { type ActiveSessionInfo, buildMenuActiveSessionBlocks, buildSessionListBlocks } from './block-kit.js';

describe('block-kit coverage', () => {
  it('shows dashboard origin label for dashboard threadKey', () => {
    const sessions = [
      {
        sessionId: 'active-1',
        threadKey: 'C1:T1',
        tool: 'claude',
        updatedAt: '2025-01-01',
      },
      {
        sessionId: 'other-1',
        threadKey: 'dashboard_abc',
        tool: 'claude',
        updatedAt: '2025-01-01',
      },
    ] as SessionSummary[];
    const blocks = buildSessionListBlocks(sessions, 'active-1');
    const text = JSON.stringify(blocks);
    expect(text).toContain('dashboard');
  });

  it('shows no origin label for non-dashboard threadKey', () => {
    const sessions = [
      {
        sessionId: 'active-1',
        threadKey: 'C1:T1',
        tool: 'claude',
        updatedAt: '2025-01-01',
      },
      {
        sessionId: 'other-1',
        threadKey: 'C2:T2',
        tool: 'gemini',
        updatedAt: '2025-01-01',
      },
    ] as SessionSummary[];
    const blocks = buildSessionListBlocks(sessions, 'active-1');
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('dashboard');
  });
});

describe('buildMenuActiveSessionBlocks — dashboard origin label (line 514)', () => {
  it('shows dashboard origin label in other sessions list', () => {
    const info: ActiveSessionInfo = {
      sessionId: 'active-1',
      tool: 'claude' as ToolName,
      mode: 'write',
      modeExpiresAt: null,
      model: null,
      workdir: '/tmp/work',
      runningJobId: null,
    };
    const sessions: SessionSummary[] = [
      {
        sessionId: 'active-1',
        threadKey: 'C1:T1',
        tool: 'claude',
        updatedAt: '2025-01-01',
      },
      {
        sessionId: 'other-1',
        threadKey: 'dashboard_xyz',
        tool: 'gemini',
        updatedAt: '2025-01-02',
      },
    ];
    const blocks = buildMenuActiveSessionBlocks(info, sessions, 'C1:T1');
    const text = JSON.stringify(blocks);
    expect(text).toContain(':computer: dashboard');
  });
});
