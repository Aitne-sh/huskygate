/** Coverage tests for platform: openBrowser Linux branch with $BROWSER env var. */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('platform coverage', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalBrowser = process.env.BROWSER;

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalBrowser === undefined) {
      delete process.env.BROWSER;
    } else {
      process.env.BROWSER = originalBrowser;
    }
    vi.restoreAllMocks();
  });

  describe('openBrowser Linux with $BROWSER env', () => {
    it('uses $BROWSER env var when set on Linux', async () => {
      const mockExecFile = vi.fn();
      vi.doMock('node:child_process', () => ({
        execFile: mockExecFile,
        execFileSync: vi.fn(),
      }));

      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.BROWSER = '/usr/bin/firefox';

      vi.resetModules();
      const { openBrowser } = await import('./platform.js');
      await openBrowser('https://example.com');

      expect(mockExecFile).toHaveBeenCalledWith('/usr/bin/firefox', ['https://example.com']);

      vi.doUnmock('node:child_process');
    });
  });

  describe('findInFallbackDirs', () => {
    it('returns null when binary is not found', async () => {
      const { findInFallbackDirs } = await import('./platform.js');
      const result = findInFallbackDirs('nonexistent-binary-xyz-123');
      expect(result).toBeNull();
    });
  });

  describe('getDetachedSpawnOptions', () => {
    it('returns options on Unix without windowsHide', async () => {
      const { getDetachedSpawnOptions } = await import('./platform.js');
      const base = { detached: true, stdio: 'pipe' as const };
      const result = getDetachedSpawnOptions(base);
      if (process.platform !== 'win32') {
        expect(result).toEqual(base);
      }
    });
  });
});
