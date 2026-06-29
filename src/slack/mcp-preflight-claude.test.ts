import { describe, expect, it, vi } from 'vitest';
import { handleClaudePostRunMcpAuth, runClaudeSwitchPreflight } from './mcp-preflight-claude.js';

describe('mcp-preflight-claude', () => {
  it('switch preflight returns immediately when auth server is not configured', async () => {
    const ctx = { config: { claudeMcpAuthServer: null } };
    await expect(
      runClaudeSwitchPreflight(ctx as never, {} as never, 'thread', 'C1', '1.1', 'U1', 'sess-1'),
    ).resolves.toBeUndefined();
  });

  it('post-run handler posts required-auth message on rerun path', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const webClient = { chat: { postMessage } };
    const ctx = {
      config: { claudeMcpAuthServer: null },
      webClient,
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'claude', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
      },
    };

    const out = await handleClaudePostRunMcpAuth(
      ctx as never,
      {
        job: {
          id: 'job-1',
          sessionKey: 'sess-1',
          channelId: 'C1',
          threadTs: '1.1',
          userId: 'U1',
          tool: 'claude',
          mode: 'readonly',
          prompt: 'p',
          workdir: '/tmp/workdir',
          toolState: {},
          createdAt: Date.now(),
        },
        threadKey: 'C1:1.1',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: null,
        selectedMcpServers: [],
      },
      true,
    );

    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: false });
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
