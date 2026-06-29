import { afterEach, describe, expect, it, vi } from 'vitest';

const originalCodexCommand = process.env.CODEX_COMMAND;
const originalCodexBin = process.env.CODEX_BIN;

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unmock('node:fs');
  vi.unmock('../utils/platform.js');

  if (originalCodexCommand === undefined) {
    delete process.env.CODEX_COMMAND;
  } else {
    process.env.CODEX_COMMAND = originalCodexCommand;
  }
  if (originalCodexBin === undefined) {
    delete process.env.CODEX_BIN;
  } else {
    process.env.CODEX_BIN = originalCodexBin;
  }
});

describe('CodexDriver command resolution', () => {
  it('falls back to Codex.app bundle command on darwin when available', async () => {
    delete process.env.CODEX_COMMAND;
    delete process.env.CODEX_BIN;

    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: vi.fn(() => true),
      };
    });

    const { CodexDriver } = await import('./driver-codex.js');
    const driver = new CodexDriver();
    expect(driver.buildCommand()).toBe('/Applications/Codex.app/Contents/Resources/codex');
  });

  it('falls back to plain codex when no override or app bundle exists', async () => {
    delete process.env.CODEX_COMMAND;
    delete process.env.CODEX_BIN;

    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: vi.fn(() => false),
      };
    });
    // Prevent PATH-based resolution from finding an installed codex binary
    vi.doMock('../utils/platform.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../utils/platform.js')>();
      return {
        ...actual,
        resolveCommand: vi.fn(() => null),
        findInFallbackDirs: vi.fn(() => null),
      };
    });

    const { CodexDriver } = await import('./driver-codex.js');
    const driver = new CodexDriver();
    expect(driver.buildCommand()).toBe('codex');
  });
});
