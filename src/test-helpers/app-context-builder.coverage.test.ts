/** Coverage tests for test-helpers/app-context-builder: uncovered lines 146, 150
 * (createSessionForThread, createStandaloneSession mocks) */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('app-context-builder coverage', () => {
  it('createSessionForThread mock generates session with composite key (line 146)', async () => {
    const { makeTestAppContext } = await import('./app-context-builder.js');
    const ctx = makeTestAppContext();

    const session = ctx.sessionManager.createSessionForThread('T1', 'U1', 'claude');
    expect(session).toBeDefined();
    expect(session.sessionKey).toContain('T1');
    expect(session.tool).toBe('claude');
  });

  it('createStandaloneSession mock generates session summary (line 150)', async () => {
    const { makeTestAppContext } = await import('./app-context-builder.js');
    const ctx = makeTestAppContext();

    const summary = ctx.sessionManager.createStandaloneSession('codex', 'U1', 'write');
    expect(summary).toBeDefined();
    expect(summary.tool).toBe('codex');
  });
});
