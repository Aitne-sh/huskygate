/**
 * Coverage tests for mcp-preflight-driver.ts — targets:
 * - getPreflightDriver default case (line 337)
 * - Claude driver cleanup error path (lines 183-188)
 * - Gemini driver generic failure format (lines 96-97)
 * - Codex driver getStateKeys (lines 113-118)
 * - Approval flow isApprovalRerun paths (line 405)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolName } from '../config.js';
import type { Runner } from '../runner/runner.js';
import type { JobPreflightContext } from './mcp-preflight.js';

const mocked = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  writeClaudeMcpConfigToWorkdir: vi.fn(() => '/tmp/mcp.json'),
  removeClaudeGeneratedMcpConfig: vi.fn(),
  runClaudeMcpAuthPreflight: vi.fn(),
  markClaudeMcpPreflightVerified: vi.fn((s: Record<string, unknown>) => s),
  formatClaudeMcpApprovalPrompt: vi.fn(() => 'prompt'),
  formatClaudeMcpAuthRequiredMessage: vi.fn((s: string) => `req:${s}`),
  formatClaudeMcpAuthGenericFailureMessage: vi.fn(() => 'generic-fail'),
  formatClaudeMcpAuthLoopPreventionMessage: vi.fn(() => 'loop'),
  formatCodexMcpApprovalPrompt: vi.fn(() => 'codex prompt'),
  formatCodexMcpAuthRequiredMessage: vi.fn((s: string) => `codex:${s}`),
  formatCodexMcpAuthGenericFailureMessage: vi.fn(() => 'codex-generic'),
  formatCodexMcpAuthLoopPreventionMessage: vi.fn(() => 'codex-loop'),
  runCodexMcpAuthPreflight: vi.fn(),
  isCodexMcpPreflightVerified: vi.fn(() => false),
  markCodexMcpPreflightVerified: vi.fn((s: Record<string, unknown>) => s),
  formatGeminiMcpApprovalPrompt: vi.fn(() => 'gemini prompt'),
  formatGeminiMcpAuthRequiredMessage: vi.fn((s: string) => `gemini:${s}`),
  formatGeminiMcpAuthGenericFailureMessage: vi.fn(() => 'gemini-generic'),
  formatGeminiMcpAuthLoopPreventionMessage: vi.fn(() => 'gemini-loop'),
  runGeminiMcpAuthPreflight: vi.fn(),
  isGeminiMcpPreflightVerified: vi.fn(() => false),
  markGeminiMcpPreflightVerified: vi.fn((s: Record<string, unknown>) => s),
  prepareCodexRuntimeHome: vi.fn(async () => ({ homeDir: '/tmp/h', seededFiles: [] })),
  getDriverEnv: vi.fn(() => ({})),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: mocked.loggerInfo, warn: mocked.loggerWarn, error: mocked.loggerError },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../workdir/mcp-writer.js', () => ({
  writeClaudeMcpConfigToWorkdir: mocked.writeClaudeMcpConfigToWorkdir,
  removeClaudeGeneratedMcpConfig: mocked.removeClaudeGeneratedMcpConfig,
}));

vi.mock('./tools/claude.js', () => ({
  CLAUDE_MCP_AUTH_BYPASS_SERVER_KEY: 'claude_mcp_auth_bypass_server',
  CLAUDE_MCP_AUTH_VERIFIED_SERVER_KEY: 'claude_mcp_auth_verified_server',
  formatClaudeMcpApprovalPrompt: mocked.formatClaudeMcpApprovalPrompt,
  formatClaudeMcpAuthGenericFailureMessage: mocked.formatClaudeMcpAuthGenericFailureMessage,
  formatClaudeMcpAuthLoopPreventionMessage: mocked.formatClaudeMcpAuthLoopPreventionMessage,
  formatClaudeMcpAuthRequiredMessage: mocked.formatClaudeMcpAuthRequiredMessage,
  markClaudeMcpPreflightVerified: mocked.markClaudeMcpPreflightVerified,
  runClaudeMcpAuthPreflight: mocked.runClaudeMcpAuthPreflight,
  isClaudeMcpPreflightBypassed: vi.fn(() => false),
  isClaudeMcpPreflightVerified: vi.fn(() => false),
  evaluateClaudeMcpAuthPreflight: vi.fn(),
}));

vi.mock('./tools/codex.js', () => ({
  CODEX_MCP_AUTH_VERIFIED_SERVER_KEY: 'codex_mcp_auth_verified_server',
  formatCodexMcpApprovalPrompt: mocked.formatCodexMcpApprovalPrompt,
  formatCodexMcpAuthGenericFailureMessage: mocked.formatCodexMcpAuthGenericFailureMessage,
  formatCodexMcpAuthLoopPreventionMessage: mocked.formatCodexMcpAuthLoopPreventionMessage,
  formatCodexMcpAuthRequiredMessage: mocked.formatCodexMcpAuthRequiredMessage,
  isCodexMcpPreflightVerified: mocked.isCodexMcpPreflightVerified,
  markCodexMcpPreflightVerified: mocked.markCodexMcpPreflightVerified,
  runCodexMcpAuthPreflight: mocked.runCodexMcpAuthPreflight,
  CODEX_MCP_AUTH_AUTO_RERUN_KEY: 'codex_mcp_auth_auto_rerun',
}));

vi.mock('./tools/gemini.js', () => ({
  GEMINI_MCP_AUTH_APPROVAL_RERUN_KEY: 'gemini_mcp_auth_approval_rerun',
  GEMINI_MCP_AUTH_VERIFIED_SERVER_KEY: 'gemini_mcp_auth_verified_server',
  formatGeminiMcpApprovalPrompt: mocked.formatGeminiMcpApprovalPrompt,
  formatGeminiMcpAuthGenericFailureMessage: mocked.formatGeminiMcpAuthGenericFailureMessage,
  formatGeminiMcpAuthLoopPreventionMessage: mocked.formatGeminiMcpAuthLoopPreventionMessage,
  formatGeminiMcpAuthRequiredMessage: mocked.formatGeminiMcpAuthRequiredMessage,
  isGeminiMcpPreflightVerified: mocked.isGeminiMcpPreflightVerified,
  markGeminiMcpPreflightVerified: mocked.markGeminiMcpPreflightVerified,
  runGeminiMcpAuthPreflight: mocked.runGeminiMcpAuthPreflight,
}));

vi.mock('../runner/codex-runtime-home.js', () => ({
  prepareCodexRuntimeHome: mocked.prepareCodexRuntimeHome,
}));

vi.mock('./mcp-preflight-utils.js', () => ({
  getDriverEnv: mocked.getDriverEnv,
}));

import {
  createClaudePreflightDriver,
  createCodexPreflightDriver,
  createGeminiPreflightDriver,
  getPreflightDriver,
} from './mcp-preflight-driver.js';

describe('mcp-preflight-driver coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPreflightDriver', () => {
    it('returns null for unknown tool', () => {
      expect(getPreflightDriver('unknown' as ToolName)).toBeNull();
    });

    it('returns driver for claude', () => {
      const d = getPreflightDriver('claude');
      expect(d).not.toBeNull();
      expect(d?.tool).toBe('claude');
    });

    it('returns driver for codex', () => {
      const d = getPreflightDriver('codex');
      expect(d).not.toBeNull();
      expect(d?.tool).toBe('codex');
    });

    it('returns driver for gemini', () => {
      const d = getPreflightDriver('gemini');
      expect(d).not.toBeNull();
      expect(d?.tool).toBe('gemini');
    });
  });

  describe('Claude driver', () => {
    it('cleanup logs warning on removeClaudeGeneratedMcpConfig error', async () => {
      mocked.removeClaudeGeneratedMcpConfig.mockImplementation(() => {
        throw new Error('rm fail');
      });
      const driver = createClaudePreflightDriver();
      // First set up to create mcpConfigPath
      await driver.setup?.(
        { job: { workdir: '/tmp/w' }, selectedMcpServers: [] } as unknown as JobPreflightContext,
        'auth',
      );
      driver.cleanup?.({ job_id: 'j1' });
      expect(mocked.loggerWarn).toHaveBeenCalledWith(
        'claude_generated_mcp_cleanup_failed',
        expect.objectContaining({ error: 'rm fail' }),
      );
    });

    it('cleanup does nothing when no mcpConfigPath', () => {
      const driver = createClaudePreflightDriver();
      driver.cleanup?.({ job_id: 'j1' });
      expect(mocked.removeClaudeGeneratedMcpConfig).not.toHaveBeenCalled();
    });

    it('isApprovalRerun returns true when explicit', () => {
      const driver = createClaudePreflightDriver();
      expect(driver.isApprovalRerun?.(true, {})).toBe(true);
    });

    it('isApprovalRerun returns true when claude_mcp_auth_approval_completed', () => {
      const driver = createClaudePreflightDriver();
      expect(driver.isApprovalRerun?.(false, { claude_mcp_auth_approval_completed: true })).toBe(
        true,
      );
    });

    it('runPreflight handles generic failure (non-auth)', async () => {
      mocked.runClaudeMcpAuthPreflight.mockResolvedValue({
        ok: false,
        exitCode: 1,
        errorKind: 'other',
        events: [],
        requiredServer: null,
        interactiveFailure: false,
        tokenRefreshFailed: false,
      });
      const driver = createClaudePreflightDriver();
      const result = await driver.runPreflight({} as Runner, {}, '/tmp/w', 'auth');
      expect(result.ok).toBe(false);
      expect(result.failure?.kind).toBe('claude_mcp_auth_preflight_failed');
    });

    it('markFailure clears session_id when claudeSessionIdPreStored', () => {
      const driver = createClaudePreflightDriver();
      const result = driver.markFailure?.({ session_id: 'xyz' }, {
        claudeSessionIdPreStored: true,
      } as unknown as JobPreflightContext);
      if (!result) throw new Error('expected result');
      expect(result.session_id).toBeUndefined();
    });

    it('markFailure returns toolState unchanged when claudeSessionIdPreStored is false (line 134)', () => {
      const driver = createClaudePreflightDriver();
      const toolState = { session_id: 'xyz', other: 'val' };
      const result = driver.markFailure?.(toolState, {
        claudeSessionIdPreStored: false,
      } as unknown as JobPreflightContext);
      if (!result) throw new Error('expected result');
      expect(result).toBe(toolState);
      expect(result.session_id).toBe('xyz');
    });
  });

  describe('Codex driver', () => {
    it('getStateKeys returns codex-specific keys', () => {
      const driver = createCodexPreflightDriver();
      const keys = driver.getStateKeys('auth');
      expect(keys.verified).toBe('codex_mcp_auth_verified_server');
    });

    it('codex driver has no isApprovalRerun', () => {
      const driver = createCodexPreflightDriver();
      expect(driver.isApprovalRerun).toBeUndefined();
    });

    it('runPreflight handles generic failure (non-auth)', async () => {
      mocked.runCodexMcpAuthPreflight.mockResolvedValue({
        ok: false,
        exitCode: 1,
        errorKind: 'other',
        events: [],
        requiredServer: null,
        requiredResourceUrl: null,
      });
      const driver = createCodexPreflightDriver();
      const result = await driver.runPreflight({} as Runner, {}, '/tmp/w', 'auth');
      expect(result.ok).toBe(false);
      expect(result.failure?.kind).toBe('codex_mcp_auth_preflight_failed');
      expect(mocked.formatCodexMcpAuthGenericFailureMessage).toHaveBeenCalled();
    });
  });

  describe('Gemini driver', () => {
    it('runPreflight handles generic failure', async () => {
      mocked.runGeminiMcpAuthPreflight.mockResolvedValue({
        ok: false,
        exitCode: 1,
        events: [],
        requiredServer: null,
        interactiveFailure: false,
      });
      const driver = createGeminiPreflightDriver();
      const result = await driver.runPreflight({} as Runner, {}, '/tmp/w', 'auth');
      expect(result.ok).toBe(false);
      expect(result.failure?.kind).toBe('gemini_mcp_auth_preflight_failed');
      expect(mocked.formatGeminiMcpAuthGenericFailureMessage).toHaveBeenCalled();
    });
  });
});
