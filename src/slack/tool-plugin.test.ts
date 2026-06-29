import { describe, expect, it, vi } from 'vitest';

async function loadModule() {
  vi.resetModules();
  return import('./tool-plugin.js');
}

describe('tool-plugin registry', () => {
  it('registers and returns plugin by tool name', async () => {
    const { getToolPlugin, registerToolPlugin } = await loadModule();

    const plugin = {
      name: 'claude',
      getMcpAuthServer: () => null,
      clearMcpAuthState: (state: Record<string, unknown>) => state,
      createApprovalGate: () => ({ __brand: 'ApprovalGate' }),
      evaluateToolUse: (gate: unknown) => ({ shouldBlock: false, gate }),
      buildPermissionDeniedSummary: () => null,
      detectVoluntaryStop: () => null,
    };

    registerToolPlugin(plugin as never);
    expect(getToolPlugin('claude')).toBe(plugin);
  });

  it('throws when plugin is not registered', async () => {
    const { getToolPlugin } = await loadModule();
    expect(() => getToolPlugin('gemini')).toThrow(/No plugin registered for tool: gemini/);
  });
});
