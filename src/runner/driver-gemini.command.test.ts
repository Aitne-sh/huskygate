import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalGeminiCommand = process.env.GEMINI_COMMAND;
const originalGeminiBin = process.env.GEMINI_BIN;
const originalShell = process.env.SHELL;
const originalHome = process.env.HOME;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unmock('node:child_process');

  if (originalGeminiCommand === undefined) {
    delete process.env.GEMINI_COMMAND;
  } else {
    process.env.GEMINI_COMMAND = originalGeminiCommand;
  }
  if (originalGeminiBin === undefined) {
    delete process.env.GEMINI_BIN;
  } else {
    process.env.GEMINI_BIN = originalGeminiBin;
  }
  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('GeminiDriver command resolution', () => {
  it('uses command resolved from login shell', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gemini-shell-'));
    const fakeShell = path.join(tempRoot, 'fake-shell.sh');
    await writeFile(fakeShell, '#!/bin/sh\necho /mock/bin/gemini\n', 'utf8');
    await chmod(fakeShell, 0o755);
    process.env.SHELL = fakeShell;

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('/mock/bin/gemini');
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('uses ~/.local/bin/gemini when shell lookup fails and local binary exists', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-'));
    process.env.HOME = tempHome;

    const localBin = path.join(tempHome, '.local', 'bin', 'gemini');
    await mkdir(path.dirname(localBin), { recursive: true });
    await writeFile(localBin, '#!/bin/sh\necho gemini\n', 'utf8');

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe(localBin);
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('falls back to npx when gemini binary is not found', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-'));

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toMatch(/^(npx|gemini)$/);
  });

  it('falls back to plain gemini when npx is unavailable', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-'));

    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('not found');
      }),
    }));

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('gemini');
    expect(driver.getCommandPrefixArgs()).toEqual([]);
  });

  it('ignores blank GEMINI_COMMAND/GEMINI_BIN values', async () => {
    process.env.GEMINI_COMMAND = '   ';
    process.env.GEMINI_BIN = '   ';
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-'));

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toMatch(/^(npx|gemini)$/);
  });

  it('falls back to os.homedir when HOME is blank', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = '   ';

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toMatch(/^(npx|gemini)$/);
  });

  it('uses npx path resolved from login shell', async () => {
    delete process.env.GEMINI_COMMAND;
    delete process.env.GEMINI_BIN;
    process.env.SHELL = '/mock/shell';
    process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'gemini-home-'));

    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn((_command: string, args: string[]) => {
        const joined = args.join(' ');
        if (joined.includes('command -v gemini')) return '';
        if (joined.includes('command -v npx')) return '/mock/bin/npx\n';
        throw new Error(`unexpected command: ${joined}`);
      }),
    }));

    const { GeminiDriver } = await import('./driver-gemini.js');
    const driver = new GeminiDriver();
    expect(driver.buildCommand()).toBe('/mock/bin/npx');
    expect(driver.getCommandPrefixArgs()).toEqual(['--yes', '@google/gemini-cli']);
  });
});
