/** Coverage3 tests for keychain: uncovered lines 61-62 (macOS isAvailable catch), 145-146 (Linux isAvailable catch) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('keychain coverage3 — macOS isAvailable exception (lines 61-62)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('macOS provider returns false when security command throws', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        throw new Error('command not found');
      }),
    }));

    vi.doMock('./platform.js', () => ({
      getPowerShell: () => 'powershell',
      isMacOS: true,
      isLinux: false,
      isWindows: false,
    }));

    vi.doMock('../shared/constants.js', () => ({
      TIMEOUTS: { keychainOp: 5000 },
    }));

    vi.doMock('./logger.js', () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    vi.resetModules();
    const { getKeychainProvider, resetKeychainProvider } = await import('./keychain.js');
    resetKeychainProvider();
    const provider = getKeychainProvider();
    expect(provider.platform).toBe('macos');
    const result = await provider.isAvailable();
    expect(result).toBe(false);
    resetKeychainProvider();

    vi.doUnmock('node:child_process');
    vi.doUnmock('./platform.js');
    vi.doUnmock('../shared/constants.js');
    vi.doUnmock('./logger.js');
  });
});

describe('keychain coverage3 — Linux isAvailable exception (lines 145-146)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('Linux provider returns false when secret-tool command throws', async () => {
    vi.doMock('node:child_process', () => ({
      execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        throw new Error('command not found');
      }),
    }));

    vi.doMock('./platform.js', () => ({
      getPowerShell: () => 'powershell',
      isMacOS: false,
      isLinux: true,
      isWindows: false,
    }));

    vi.doMock('../shared/constants.js', () => ({
      TIMEOUTS: { keychainOp: 5000 },
    }));

    vi.doMock('./logger.js', () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    vi.resetModules();
    const { getKeychainProvider, resetKeychainProvider } = await import('./keychain.js');
    resetKeychainProvider();
    const provider = getKeychainProvider();
    expect(provider.platform).toBe('linux');
    const result = await provider.isAvailable();
    expect(result).toBe(false);
    resetKeychainProvider();

    vi.doUnmock('node:child_process');
    vi.doUnmock('./platform.js');
    vi.doUnmock('../shared/constants.js');
    vi.doUnmock('./logger.js');
  });
});
