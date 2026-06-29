/** Coverage tests for keychain providers and helpers. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecFileCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

// Use vi.hoisted so mocks are declared before vi.mock calls
const mocked = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, '', '');
    return { stdin: { write: vi.fn(), end: vi.fn() } };
  }),
  execFileSync: vi.fn(() => 'ok'),
}));

vi.mock('node:child_process', () => ({
  execFile: mocked.execFile,
  execFileSync: mocked.execFileSync,
}));

vi.mock('../shared/constants.js', () => ({
  TIMEOUTS: { keychainOp: 5000 },
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
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

describe('keychain coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // resolvePowerShell is tested indirectly through WindowsKeychainProvider;
  // direct testing is complex due to ESM mock interaction with child_process.

  describe('getKeychainProvider', () => {
    it('returns platform-specific provider', async () => {
      const { getKeychainProvider, resetKeychainProvider } = await import('./keychain.js');
      resetKeychainProvider();
      const provider = getKeychainProvider();
      expect(provider).toBeTruthy();
      expect(provider.platform).toBeTruthy();
    });

    it('caches the provider', async () => {
      const { getKeychainProvider, resetKeychainProvider } = await import('./keychain.js');
      resetKeychainProvider();
      const p1 = getKeychainProvider();
      const p2 = getKeychainProvider();
      expect(p1).toBe(p2);
    });
  });

  describe('setKeychainProvider', () => {
    it('overrides the cached provider', async () => {
      const { getKeychainProvider, setKeychainProvider, resetKeychainProvider } = await import(
        './keychain.js'
      );
      resetKeychainProvider();
      const custom = {
        platform: 'custom',
        isAvailable: async () => true,
        getPassword: async () => 'test',
        setPassword: async () => {},
        deletePassword: async () => true,
        listKeys: async () => [],
      };
      setKeychainProvider(custom);
      expect(getKeychainProvider()).toBe(custom);
      resetKeychainProvider();
    });
  });

  describe('FallbackKeychainProvider', () => {
    it('returns false for isAvailable', async () => {
      const { getKeychainProvider, resetKeychainProvider } = await import('./keychain.js');
      resetKeychainProvider();
      // Set platform to something unsupported
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });

      const provider = getKeychainProvider();
      expect(provider.platform).toBe('fallback');
      expect(await provider.isAvailable()).toBe(false);
      expect(await provider.getPassword('test')).toBeNull();
      await expect(provider.setPassword('key', 'val')).rejects.toThrow('not available');
      expect(await provider.deletePassword('key')).toBe(false);
      expect(await provider.listKeys()).toEqual([]);

      if (origPlatform) {
        Object.defineProperty(process, 'platform', origPlatform);
      }
      resetKeychainProvider();
    });
  });

  describe('loadKeychainSecrets', () => {
    it('returns empty map when keychain is not available', async () => {
      const { loadKeychainSecrets, setKeychainProvider, resetKeychainProvider } = await import(
        './keychain.js'
      );
      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => false,
        getPassword: async () => null,
        setPassword: async () => {},
        deletePassword: async () => false,
        listKeys: async () => [],
      });

      const result = await loadKeychainSecrets(new Set(['KEY1']));
      expect(result.size).toBe(0);
      resetKeychainProvider();
    });

    it('loads secrets from keychain', async () => {
      const { loadKeychainSecrets, setKeychainProvider, resetKeychainProvider } = await import(
        './keychain.js'
      );
      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async (key: string) => (key === 'KEY1' ? 'secret1' : null),
        setPassword: async () => {},
        deletePassword: async () => false,
        listKeys: async () => [],
      });

      const result = await loadKeychainSecrets(new Set(['KEY1', 'KEY2']));
      expect(result.get('KEY1')).toBe('secret1');
      expect(result.has('KEY2')).toBe(false);
      resetKeychainProvider();
    });

    it('handles keychain errors with env fallback logging', async () => {
      const { loadKeychainSecrets, setKeychainProvider, resetKeychainProvider } = await import(
        './keychain.js'
      );
      const originalEnv = process.env.FAIL_KEY;
      process.env.FAIL_KEY = 'fallback-value';

      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async () => {
          throw new Error('keychain error');
        },
        setPassword: async () => {},
        deletePassword: async () => false,
        listKeys: async () => [],
      });

      const result = await loadKeychainSecrets(new Set(['FAIL_KEY']));
      expect(result.size).toBe(0);

      if (originalEnv === undefined) {
        delete process.env.FAIL_KEY;
      } else {
        process.env.FAIL_KEY = originalEnv;
      }
      resetKeychainProvider();
    });

    it('handles keychain errors without env fallback', async () => {
      const { loadKeychainSecrets, setKeychainProvider, resetKeychainProvider } = await import(
        './keychain.js'
      );
      delete process.env.NO_FALLBACK_KEY;

      setKeychainProvider({
        platform: 'test',
        isAvailable: async () => true,
        getPassword: async () => {
          throw new Error('keychain error');
        },
        setPassword: async () => {},
        deletePassword: async () => false,
        listKeys: async () => [],
      });

      const result = await loadKeychainSecrets(new Set(['NO_FALLBACK_KEY']));
      expect(result.size).toBe(0);
      resetKeychainProvider();
    });
  });
});
