import { describe, expect, it } from 'vitest';
import { type InstructionContext, buildInstruction, resolveInstruction } from './builder.js';

/* ── Helper ── */

function build(overrides: Partial<InstructionContext> = {}): string {
  return buildInstruction({
    tool: 'claude',
    source: 'chat',
    autoApprove: false,
    allowMcp: true,
    ...overrides,
  });
}

/* ── Identity ── */

describe('buildInstruction — identity', () => {
  it('includes Claude identity for tool=claude', () => {
    const out = build({ tool: 'claude' });
    expect(out).toContain('# Claude Code Workspace Agent');
    expect(out).not.toContain('`!claude`');
  });

  it('includes Codex identity for tool=codex', () => {
    const out = build({ tool: 'codex' });
    expect(out).toContain('# Codex Workspace Agent');
    expect(out).not.toContain('`!codex`');
  });

  it('includes Gemini identity for tool=gemini', () => {
    const out = build({ tool: 'gemini' });
    expect(out).toContain('# Gemini CLI Workspace Agent');
    expect(out).not.toContain('`!gemini`');
  });

  it('does not include Command line for any tool', () => {
    for (const tool of ['claude', 'codex', 'gemini'] as const) {
      const out = build({ tool });
      expect(out).not.toContain('**Command:**');
    }
  });
});

/* ── Core Principles ── */

describe('buildInstruction — core principles', () => {
  it('includes all 5 principles', () => {
    const out = build();
    expect(out).toContain('Follow user instructions precisely');
    expect(out).toContain('end-to-end');
    expect(out).toContain('clarifying questions');
    expect(out).toContain('Match the user');
    expect(out).toContain('actionable deliverables');
  });
});

/* ── MCP Policy ── */

describe('buildInstruction — MCP policy', () => {
  it('outputs MCP_DISABLED when allowMcp=false', () => {
    const out = build({ allowMcp: false });
    expect(out).toContain('MCP tools are NOT available');
    expect(out).not.toContain('pre-approved');
    expect(out).not.toContain('[MCP_TOOL_REQUEST]');
  });

  it('outputs MCP_APPROVAL when allowMcp=true, autoApprove=false', () => {
    const out = build({ allowMcp: true, autoApprove: false });
    expect(out).toContain('[MCP_TOOL_REQUEST]');
    expect(out).not.toContain('pre-approved');
    expect(out).not.toContain('MCP tools are NOT available');
  });

  it('outputs MCP_AUTORUN when allowMcp=true, autoApprove=true', () => {
    const out = build({ allowMcp: true, autoApprove: true });
    expect(out).toContain('pre-approved');
    expect(out).toContain('<tool_execution');
    // Should NOT have the approval-flow request block instruction
    expect(out).not.toContain('Output ONE request block');
    expect(out).not.toContain('MCP tools are NOT available');
  });

  it('MCP_DISABLED ignores autoApprove value', () => {
    const out1 = build({ allowMcp: false, autoApprove: false });
    const out2 = build({ allowMcp: false, autoApprove: true });
    expect(out1).toContain('MCP tools are NOT available');
    expect(out2).toContain('MCP tools are NOT available');
  });
});

/* ── Response Format ── */

describe('buildInstruction — response format', () => {
  it('includes <!-- answer --> marker for source=chat', () => {
    const out = build({ source: 'chat' });
    expect(out).toContain('<!-- answer -->');
  });

  it('omits <!-- answer --> for source=orchestrator', () => {
    const out = build({ source: 'orchestrator' });
    expect(out).not.toContain('<!-- answer -->');
  });

  it('omits <!-- answer --> for source=schedule', () => {
    const out = build({ source: 'schedule' });
    expect(out).not.toContain('<!-- answer -->');
  });

  it('omits <!-- answer --> for source=standalone-task', () => {
    const out = build({ source: 'standalone-task' });
    expect(out).not.toContain('<!-- answer -->');
  });
});

/* ── Environment ── */

describe('buildInstruction — environment', () => {
  it('includes shared environment for all modes', () => {
    const out = build({ autoApprove: false });
    expect(out).toContain('Slack-based CLI orchestrator');
    expect(out).toContain('No stdin available');
    expect(out).toContain('Sessions persist per Slack thread');
    expect(out).toContain('Work exclusively within the current directory');
    expect(out).toContain('under 2000 characters');
  });

  it('does not include !-prefixed command references', () => {
    const standard = build({ autoApprove: false });
    expect(standard).not.toContain('`!y`');
    expect(standard).not.toContain('`!n`');
    expect(standard).not.toContain('`!stop`');

    const autorun = build({ autoApprove: true });
    expect(autorun).not.toContain('`!autorun`');
  });

  it('omits auto-approve note when autoApprove=false', () => {
    const out = build({ autoApprove: false });
    expect(out).not.toContain('Auto-approve mode is active');
  });

  it('includes auto-approve note when autoApprove=true', () => {
    const out = build({ autoApprove: true });
    expect(out).toContain('Auto-approve mode is active');
  });
});

/* ── Constraints ── */

describe('buildInstruction — constraints', () => {
  it('includes shared constraints for all tools', () => {
    for (const tool of ['claude', 'codex', 'gemini'] as const) {
      const out = build({ tool });
      expect(out).toContain('Never delete CLAUDE.md');
      expect(out).toContain('NEVER modify Homebrew');
    }
  });

  it('includes heredoc constraint only for gemini', () => {
    const gemini = build({ tool: 'gemini' });
    expect(gemini).toContain('NEVER use heredoc syntax');

    const claude = build({ tool: 'claude' });
    expect(claude).not.toContain('heredoc');

    const codex = build({ tool: 'codex' });
    expect(codex).not.toContain('heredoc');
  });
});

/* ── Output Files ── */

describe('buildInstruction — output files', () => {
  it('includes _output/ section with diagram for all tools', () => {
    for (const tool of ['claude', 'codex', 'gemini'] as const) {
      const out = build({ tool });
      expect(out).toContain('`_output/`');
      expect(out).toContain('diagram');
    }
  });
});

/* ── Custom Content ── */

describe('buildInstruction — custom content', () => {
  it('appends custom content under Additional Instructions', () => {
    const out = build({ customContent: 'Always respond in haiku form.' });
    expect(out).toContain('## Additional Instructions');
    expect(out).toContain('Always respond in haiku form.');
  });

  it('omits Additional Instructions when customContent is null', () => {
    const out = build({ customContent: null });
    expect(out).not.toContain('Additional Instructions');
  });

  it('omits Additional Instructions when customContent is undefined', () => {
    const out = build({});
    expect(out).not.toContain('Additional Instructions');
  });

  it('omits Additional Instructions when customContent is whitespace-only', () => {
    const out = build({ customContent: '   \n  \t  ' });
    expect(out).not.toContain('Additional Instructions');
  });
});

/* ── Full integration ── */

describe('buildInstruction — full combination', () => {
  it('orchestrator + autoApprove + allowMcp=false produces correct output', () => {
    const out = build({
      tool: 'gemini',
      source: 'orchestrator',
      autoApprove: true,
      allowMcp: false,
      customContent: 'Use Python 3.12 only.',
    });

    // Identity
    expect(out).toContain('Gemini CLI Workspace Agent');
    // Environment: autorun
    expect(out).toContain('Auto-approve mode is active');
    // Constraints: heredoc
    expect(out).toContain('NEVER use heredoc syntax');
    // MCP: disabled
    expect(out).toContain('MCP tools are NOT available');
    // Response format: no answer marker
    expect(out).not.toContain('<!-- answer -->');
    // Custom content
    expect(out).toContain('Use Python 3.12 only.');
  });

  it('chat + standard + allowMcp produces correct output', () => {
    const out = build({
      tool: 'codex',
      source: 'chat',
      autoApprove: false,
      allowMcp: true,
    });

    expect(out).toContain('Codex Workspace Agent');
    expect(out).not.toContain('`!y`');
    expect(out).toContain('[MCP_TOOL_REQUEST]');
    expect(out).toContain('<!-- answer -->');
    expect(out).not.toContain('heredoc');
    expect(out).not.toContain('Additional Instructions');
  });

  it('output ends with a newline', () => {
    const out = build();
    expect(out.endsWith('\n')).toBe(true);
  });
});

/* ── resolveInstruction ── */

describe('resolveInstruction', () => {
  const baseCtx = {
    tool: 'claude' as const,
    source: 'chat' as const,
    autoApprove: false,
    allowMcp: true,
  };

  it('uses buildInstruction with default content as append when disabled', () => {
    const out = resolveInstruction(baseCtx, null, { content: 'Use Python 3.12.', enabled: false });
    // Base prompt sections present
    expect(out).toContain('# Claude Code Workspace Agent');
    expect(out).toContain('## Additional Instructions');
    expect(out).toContain('Use Python 3.12.');
  });

  it('returns custom content as full replacement when enabled', () => {
    const custom = '# My Custom Prompt\n\nDo everything my way.';
    const out = resolveInstruction(baseCtx, null, { content: custom, enabled: true });
    expect(out).toBe(custom);
    // Base prompt sections absent
    expect(out).not.toContain('Claude Code Workspace Agent');
    expect(out).not.toContain('## Environment');
  });

  it('falls back to normal build when enabled but content is empty', () => {
    const out = resolveInstruction(baseCtx, null, { content: '', enabled: true });
    expect(out).toContain('# Claude Code Workspace Agent');
    expect(out).not.toContain('Additional Instructions');
  });

  it('falls back to normal build when enabled but content is whitespace-only', () => {
    const out = resolveInstruction(baseCtx, null, { content: '   \n  ', enabled: true });
    expect(out).toContain('# Claude Code Workspace Agent');
  });

  it('task-specific instructionFile always appends to base prompt even when enabled', () => {
    const out = resolveInstruction(baseCtx, 'Task-specific instruction', {
      content: '# Custom',
      enabled: true,
    });
    // Base prompt present (task-specific = append mode)
    expect(out).toContain('# Claude Code Workspace Agent');
    expect(out).toContain('## Additional Instructions');
    expect(out).toContain('Task-specific instruction');
    // Custom content NOT used (task-specific takes priority)
    expect(out).not.toContain('# Custom');
  });

  it('returns base prompt only when disabled and no content', () => {
    const out = resolveInstruction(baseCtx, null, { content: '', enabled: false });
    expect(out).toContain('# Claude Code Workspace Agent');
    expect(out).not.toContain('Additional Instructions');
  });
});
