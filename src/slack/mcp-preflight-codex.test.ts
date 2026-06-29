import { describe, expect, it, vi } from 'vitest';
import { handleCodexPostRunMcpAuth, runCodexSwitchPreflight } from './mcp-preflight-codex.js';

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: vi.fn().mockResolvedValue({
    homeDir: '/tmp/workdir/.codex_runtime_home',
    seededFiles: ['config.toml'],
  }),
}));

describe('mcp-preflight-codex', () => {
  it('switch preflight returns immediately when auth server is not configured', async () => {
    const ctx = { config: { codexMcpAuthServer: null } };
    await expect(
      runCodexSwitchPreflight(ctx as never, {} as never, 'C1', '1.1', 'sess-1'),
    ).resolves.toBeUndefined();
  });

  it('post-run handler posts required-auth message on rerun path', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true });
    const webClient = { chat: { postMessage } };
    const ctx = {
      config: { codexMcpAuthServer: null },
      webClient,
      mcpServerStore: {
        listByTool: vi.fn(() => []),
      },
      sessionManager: {
        getSessionSummary: vi.fn().mockReturnValue({ tool: 'codex', sessionId: 'S1' }),
        getActiveSessionSummary: vi.fn().mockReturnValue(null),
      },
    };

    const out = await handleCodexPostRunMcpAuth(
      ctx as never,
      {
        job: {
          id: 'job-1',
          sessionKey: 'sess-1',
          channelId: 'C1',
          threadTs: '1.1',
          userId: 'U1',
          tool: 'codex',
          mode: 'readonly',
          prompt: 'p',
          workdir: '/tmp/workdir',
          toolState: {},
          createdAt: Date.now(),
        },
        threadKey: 'C1:1.1',
        mcpAuthRequiredServer: 'aws-api',
        mcpAuthRequiredResourceUrl: 'https://auth.example',
        selectedMcpServers: [],
      },
      true,
    );

    expect(out).toEqual({ autoRerunScheduled: false, autoAuthFailureReported: false });
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
