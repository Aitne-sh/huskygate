/**
 * Coverage supplement for keychain.ts — Windows provider paths.
 * Uses vi.mock to simulate Windows platform and cmdkey/PowerShell behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeychainProvider } from './keychain.js';

type ExecFileCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

const mocked = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, '', '');
    return { stdin: { write: vi.fn(), end: vi.fn() } };
  }),
}));

vi.mock('node:child_process', () => ({
  execFile: mocked.execFile,
}));

vi.mock('../shared/constants.js', () => ({
  TIMEOUTS: { keychainOp: 5000 },
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./platform.js', () => ({
  getPowerShell: () => 'powershell',
  isMacOS: false,
  isLinux: false,
  isWindows: true,
}));

describe('Windows KeychainProvider coverage', () => {
  let getKeychainProvider: () => KeychainProvider;
  let resetKeychainProvider: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('./keychain.js');
    getKeychainProvider = mod.getKeychainProvider;
    resetKeychainProvider = mod.resetKeychainProvider;
    resetKeychainProvider();
  });

  afterEach(() => {
    resetKeychainProvider();
  });

  it('creates Windows provider when isWindows is true', () => {
    const provider = getKeychainProvider();
    expect(provider.platform).toBe('windows');
  });

  it('isAvailable returns true when cmdkey succeeds', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, 'current credentials', '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    expect(await provider.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when cmdkey fails', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb({ code: 'EXIT_1' } as NodeJS.ErrnoException, '', 'error');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it('isAvailable returns false when cmdkey throws', async () => {
    mocked.execFile.mockImplementation(() => {
      throw new Error('not found');
    });
    const provider = getKeychainProvider();
    expect(await provider.isAvailable()).toBe(false);
  });

  it('getPassword returns value from PowerShell stdout', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, 'my-secret-value\n', '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const result = await provider.getPassword('TEST_KEY');
    expect(result).toBe('my-secret-value');
  });

  it('getPassword returns null when PowerShell fails', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb({ code: 'EXIT_1' } as NodeJS.ErrnoException, '', 'error');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const result = await provider.getPassword('TEST_KEY');
    expect(result).toBeNull();
  });

  it('getPassword returns null when PowerShell returns empty', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, '', '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const result = await provider.getPassword('TEST_KEY');
    expect(result).toBeNull();
  });

  it('setPassword calls PowerShell CredWrite with stdin', async () => {
    const stdinWrite = vi.fn();
    const stdinEnd = vi.fn();
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, '', '');
        return { stdin: { write: stdinWrite, end: stdinEnd } };
      },
    );
    const provider = getKeychainProvider();
    await provider.setPassword('TEST_KEY', 'secret');
    expect(stdinWrite).toHaveBeenCalledWith('secret');
    expect(stdinEnd).toHaveBeenCalled();
  });

  it('setPassword throws when PowerShell exits non-zero', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb({ code: 'EXIT_1' } as NodeJS.ErrnoException, '', 'error');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    await expect(provider.setPassword('TEST_KEY', 'secret')).rejects.toThrow('Failed to store key');
  });

  it('deletePassword returns true when cmdkey succeeds', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, '', '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const result = await provider.deletePassword('TEST_KEY');
    expect(result).toBe(true);
  });

  it('deletePassword returns false when cmdkey fails', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb({ code: 'EXIT_1' } as NodeJS.ErrnoException, '', 'error');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const result = await provider.deletePassword('TEST_KEY');
    expect(result).toBe(false);
  });

  it('listKeys parses cmdkey output', async () => {
    const cmdkeyOutput = [
      'Currently stored credentials:',
      '',
      '    Target: LegacyGeneric:target=huskygate:KEY_ONE',
      '    Type: Generic',
      '',
      '    Target: LegacyGeneric:target=huskygate:KEY_TWO',
      '    Type: Generic',
      '',
      '    Target: other:service:unrelated',
      '    Type: Generic',
    ].join('\n');
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(null, cmdkeyOutput, '');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const keys = await provider.listKeys();
    expect(keys).toEqual(['KEY_ONE', 'KEY_TWO']);
  });

  it('listKeys returns empty when cmdkey fails', async () => {
    mocked.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb({ code: 'EXIT_1' } as NodeJS.ErrnoException, '', 'error');
        return { stdin: { write: vi.fn(), end: vi.fn() } };
      },
    );
    const provider = getKeychainProvider();
    const keys = await provider.listKeys();
    expect(keys).toEqual([]);
  });
});
