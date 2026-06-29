import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('./platform.js', () => ({
  getPowerShell: () => 'powershell',
  get isMacOS() {
    return process.platform === 'darwin';
  },
  get isLinux() {
    return process.platform === 'linux';
  },
  get isWindows() {
    return process.platform === 'win32';
  },
}));

import type { KeychainProvider } from './keychain.js';
import {
  getKeychainProvider,
  loadKeychainSecrets,
  resetKeychainProvider,
  setKeychainProvider,
} from './keychain.js';
import { logger } from './logger.js';

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function exitCodeError(code: number): Error & { code: number } {
  const err = new Error(`exit ${code}`) as Error & { code: number };
  err.code = code;
  return err;
}

describe('keychain', () => {
  beforeEach(() => {
    resetKeychainProvider();
    execFileMock.mockReset();
    setPlatform(ORIGINAL_PLATFORM);
  });

  afterEach(() => {
    resetKeychainProvider();
    setPlatform(ORIGINAL_PLATFORM);
    delete process.env.BAD_KEY;
  });

  describe('getKeychainProvider', () => {
    it('returns a provider with platform field', () => {
      const provider = getKeychainProvider();
      expect(provider.platform).toBeDefined();
      expect(typeof provider.isAvailable).toBe('function');
      expect(typeof provider.getPassword).toBe('function');
      expect(typeof provider.setPassword).toBe('function');
      expect(typeof provider.deletePassword).toBe('function');
      expect(typeof provider.listKeys).toBe('function');
    });

    it('caches provider across calls', () => {
      const p1 = getKeychainProvider();
      const p2 = getKeychainProvider();
      expect(p1).toBe(p2);
    });

    it('returns fresh provider after reset', () => {
      const p1 = getKeychainProvider();
      resetKeychainProvider();
      const p2 = getKeychainProvider();
      expect(p1).not.toBe(p2);
    });
  });

  describe('setKeychainProvider', () => {
    it('overrides the default provider', () => {
      const custom: KeychainProvider = {
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async () => 'secret',
        setPassword: async () => {},
        deletePassword: async () => true,
        listKeys: async () => ['A'],
      };
      setKeychainProvider(custom);
      expect(getKeychainProvider()).toBe(custom);
    });
  });

  describe('loadKeychainSecrets', () => {
    it('returns empty map when keychain is not available', async () => {
      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => false,
        getPassword: async () => null,
        setPassword: async () => {},
        deletePassword: async () => false,
        listKeys: async () => [],
      });

      const secrets = await loadKeychainSecrets(new Set(['KEY_A', 'KEY_B']));
      expect(secrets.size).toBe(0);
    });

    it('loads keys from available keychain', async () => {
      const store = new Map<string, string>([
        ['KEY_A', 'val_a'],
        ['KEY_C', 'val_c'],
      ]);

      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async (key) => store.get(key) ?? null,
        setPassword: async () => {},
        deletePassword: async () => true,
        listKeys: async () => [...store.keys()],
      });

      const secrets = await loadKeychainSecrets(new Set(['KEY_A', 'KEY_B', 'KEY_C']));
      expect(secrets.size).toBe(2);
      expect(secrets.get('KEY_A')).toBe('val_a');
      expect(secrets.get('KEY_C')).toBe('val_c');
      expect(secrets.has('KEY_B')).toBe(false);
    });

    it('handles getPassword errors gracefully', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      process.env.BAD_KEY = 'env-secret';
      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async (key) => {
          if (key === 'BAD_KEY') throw new Error('keychain locked');
          return 'ok';
        },
        setPassword: async () => {},
        deletePassword: async () => true,
        listKeys: async () => [],
      });

      const secrets = await loadKeychainSecrets(new Set(['GOOD_KEY', 'BAD_KEY']));
      expect(secrets.get('GOOD_KEY')).toBe('ok');
      expect(secrets.has('BAD_KEY')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        'keychain_env_fallback',
        expect.objectContaining({ count: 1, keys: ['BAD_KEY'] }),
      );
      warnSpy.mockRestore();
    });
  });

  describe('FallbackKeychainProvider', () => {
    it('uses built-in fallback provider on unsupported platform', async () => {
      setPlatform('freebsd');
      const provider = getKeychainProvider();
      expect(provider.platform).toBe('fallback');
      expect(await provider.isAvailable()).toBe(false);
      expect(await provider.getPassword('any')).toBeNull();
      expect(await provider.deletePassword('any')).toBe(false);
      expect(await provider.listKeys()).toEqual([]);
      await expect(provider.setPassword('k', 'v')).rejects.toThrow(
        'Keychain is not available on this platform',
      );
    });

    it('uses WindowsKeychainProvider on win32', () => {
      setPlatform('win32');
      const provider = getKeychainProvider();
      expect(provider.platform).toBe('windows');
    });

    it('reports not available and returns nulls', async () => {
      // Force fallback by setting platform we control via reset
      resetKeychainProvider();
      const fallback: KeychainProvider = {
        platform: 'fallback',
        isAvailable: async () => false,
        getPassword: async () => null,
        setPassword: async () => {
          throw new Error('not available');
        },
        deletePassword: async () => false,
        listKeys: async () => [],
      };
      setKeychainProvider(fallback);

      const provider = getKeychainProvider();
      expect(await provider.isAvailable()).toBe(false);
      expect(await provider.getPassword('any')).toBeNull();
      expect(await provider.deletePassword('any')).toBe(false);
      expect(await provider.listKeys()).toEqual([]);
      await expect(provider.setPassword('k', 'v')).rejects.toThrow('not available');
    });
  });

  describe('MacOSKeychainProvider', () => {
    it('handles isAvailable, getPassword, deletePassword, and listKeys', async () => {
      setPlatform('darwin');
      execFileMock
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, '  secret-value\n', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(
            null,
            [
              '"svce"<blob>="huskygate"',
              '"acct"<blob>="KEY_A"',
              '"svce"<blob>="other-service"',
              '"acct"<blob>="IGNORED"',
              '"svce"<blob>="huskygate"',
              '"acct"<blob>="KEY_B"',
            ].join('\n'),
            '',
          );
          return { stdin: null } as never;
        });

      const provider = getKeychainProvider();
      expect(provider.platform).toBe('macos');
      expect(await provider.isAvailable()).toBe(true);
      expect(await provider.getPassword('KEY_A')).toBe('secret-value');
      expect(await provider.deletePassword('KEY_A')).toBe(true);
      expect(await provider.listKeys()).toEqual(['KEY_A', 'KEY_B']);
    });

    it('returns null/false/[] on non-zero exit codes', async () => {
      setPlatform('darwin');
      execFileMock
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(44), '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(44), '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(44), '', '');
          return { stdin: null } as never;
        });

      const provider = getKeychainProvider();
      expect(await provider.getPassword('MISSING')).toBeNull();
      expect(await provider.deletePassword('MISSING')).toBe(false);
      expect(await provider.listKeys()).toEqual([]);
    });

    it('throws when setPassword fails', async () => {
      setPlatform('darwin');
      execFileMock.mockImplementationOnce((...args: unknown[]) => {
        const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
        cb(exitCodeError(2), '', '');
        return { stdin: null } as never;
      });

      const provider = getKeychainProvider();
      await expect(provider.setPassword('API_KEY', 'secret')).rejects.toThrow(
        'Failed to store key "API_KEY" in macOS keychain (exit 2)',
      );
    });

    it('passes secret as -w argument to security CLI', async () => {
      setPlatform('darwin');
      execFileMock.mockImplementationOnce((...args: unknown[]) => {
        const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
        cb(null, '', '');
        return { stdin: null } as never;
      });

      const provider = getKeychainProvider();
      await provider.setPassword('API_KEY', 'mac-secret');

      expect(execFileMock).toHaveBeenCalledWith(
        'security',
        ['add-generic-password', '-s', 'huskygate', '-a', 'API_KEY', '-U', '-w', 'mac-secret'],
        expect.any(Object),
        expect.any(Function),
      );
    });
  });

  describe('LinuxKeychainProvider', () => {
    it('handles isAvailable, getPassword, deletePassword, and listKeys', async () => {
      setPlatform('linux');
      execFileMock
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, 'linux-secret\n', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(null, '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(
            null,
            ['attribute.key = KEY_A', 'something else', 'attribute.key = KEY_B'].join('\n'),
            '',
          );
          return { stdin: null } as never;
        });

      const provider = getKeychainProvider();
      expect(provider.platform).toBe('linux');
      expect(await provider.isAvailable()).toBe(true);
      expect(await provider.getPassword('KEY_A')).toBe('linux-secret');
      expect(await provider.deletePassword('KEY_A')).toBe(true);
      expect(await provider.listKeys()).toEqual(['KEY_A', 'KEY_B']);
    });

    it('returns null/false/[] when command exits non-zero', async () => {
      setPlatform('linux');
      execFileMock
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(7), '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(7), '', '');
          return { stdin: null } as never;
        })
        .mockImplementationOnce((...args: unknown[]) => {
          const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
          cb(exitCodeError(7), '', '');
          return { stdin: null } as never;
        });

      const provider = getKeychainProvider();
      expect(await provider.getPassword('MISSING')).toBeNull();
      expect(await provider.deletePassword('MISSING')).toBe(false);
      expect(await provider.listKeys()).toEqual([]);
    });

    it('writes secret to stdin when storing password', async () => {
      setPlatform('linux');
      const stdinWrite = vi.fn();
      const stdinEnd = vi.fn();
      execFileMock.mockImplementationOnce((...args: unknown[]) => {
        const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
        cb(null, '', '');
        return {
          stdin: {
            write: stdinWrite,
            end: stdinEnd,
          },
        } as never;
      });

      const provider = getKeychainProvider();
      await provider.setPassword('API_KEY', 'linux-secret');
      expect(stdinWrite).toHaveBeenCalledWith('linux-secret');
      expect(stdinEnd).toHaveBeenCalledTimes(1);
    });

    it('throws when storing password fails', async () => {
      setPlatform('linux');
      const stdinWrite = vi.fn();
      const stdinEnd = vi.fn();
      execFileMock.mockImplementationOnce((...args: unknown[]) => {
        const cb = args[3] as (err: Error | null, stdout?: string, stderr?: string) => void;
        cb(exitCodeError(9), '', '');
        return {
          stdin: {
            write: stdinWrite,
            end: stdinEnd,
          },
        } as never;
      });

      const provider = getKeychainProvider();
      await expect(provider.setPassword('API_KEY', 'linux-secret')).rejects.toThrow(
        'Failed to store key "API_KEY" in Linux keychain (exit 9)',
      );
    });
  });
});
