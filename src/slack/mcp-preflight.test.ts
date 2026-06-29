import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  runClaudeSwitchPreflight: vi.fn(),
  runGeminiSwitchPreflight: vi.fn(),
  runCodexSwitchPreflight: vi.fn(),
}));

vi.mock('./mcp-preflight-claude.js', () => ({
  runClaudeSwitchPreflight: mocked.runClaudeSwitchPreflight,
  runClaudeJobPreflight: vi.fn(),
  handleClaudePostRunMcpAuth: vi.fn(),
}));

vi.mock('./mcp-preflight-gemini.js', () => ({
  runGeminiSwitchPreflight: mocked.runGeminiSwitchPreflight,
  prepareGeminiJobRuntime: vi.fn(),
  runGeminiJobPreflight: vi.fn(),
  handleGeminiPostRunMcpAuth: vi.fn(),
}));

vi.mock('./mcp-preflight-codex.js', () => ({
  runCodexSwitchPreflight: mocked.runCodexSwitchPreflight,
  runCodexJobPreflight: vi.fn(),
  handleCodexPostRunMcpAuth: vi.fn(),
}));

describe('maybeRunSwitchPreflight', () => {
  it('dispatches to claude preflight', async () => {
    const { maybeRunSwitchPreflight } = await import('./mcp-preflight.js');
    await maybeRunSwitchPreflight(
      { switchPreflightBarriers: new Map() } as never,
      {} as never,
      'claude',
      'th',
      'C1',
      '1.1',
      'U1',
      'sess',
    );
    expect(mocked.runClaudeSwitchPreflight).toHaveBeenCalledOnce();
  });

  it('dispatches to gemini preflight', async () => {
    const { maybeRunSwitchPreflight } = await import('./mcp-preflight.js');
    await maybeRunSwitchPreflight(
      { switchPreflightBarriers: new Map() } as never,
      {} as never,
      'gemini',
      'th',
      'C1',
      '1.1',
      'U1',
      'sess',
    );
    expect(mocked.runGeminiSwitchPreflight).toHaveBeenCalledOnce();
  });

  it('dispatches to codex preflight', async () => {
    const { maybeRunSwitchPreflight } = await import('./mcp-preflight.js');
    await maybeRunSwitchPreflight(
      { switchPreflightBarriers: new Map() } as never,
      {} as never,
      'codex',
      'th',
      'C1',
      '1.1',
      'U1',
      'sess',
    );
    expect(mocked.runCodexSwitchPreflight).toHaveBeenCalledOnce();
  });

  it('returns early for unknown tool names', async () => {
    const { maybeRunSwitchPreflight } = await import('./mcp-preflight.js');
    mocked.runClaudeSwitchPreflight.mockClear();
    mocked.runGeminiSwitchPreflight.mockClear();
    mocked.runCodexSwitchPreflight.mockClear();
    const ctx = { switchPreflightBarriers: new Map() };
    await maybeRunSwitchPreflight(
      ctx as never,
      {} as never,
      'unknown-tool' as never,
      'th',
      'C1',
      '1.1',
      'U1',
      'sess',
    );
    expect(ctx.switchPreflightBarriers.size).toBe(0);
    expect(mocked.runClaudeSwitchPreflight).not.toHaveBeenCalled();
    expect(mocked.runGeminiSwitchPreflight).not.toHaveBeenCalled();
    expect(mocked.runCodexSwitchPreflight).not.toHaveBeenCalled();
  });
});
