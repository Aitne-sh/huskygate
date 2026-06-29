import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalClaudeCommand = process.env.CLAUDE_COMMAND;
const originalClaudeBin = process.env.CLAUDE_BIN;
const originalShell = process.env.SHELL;
const originalHome = process.env.HOME;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();

  if (originalClaudeCommand === undefined) {
    delete process.env.CLAUDE_COMMAND;
  } else {
    process.env.CLAUDE_COMMAND = originalClaudeCommand;
  }
  if (originalClaudeBin === undefined) {
    delete process.env.CLAUDE_BIN;
  } else {
    process.env.CLAUDE_BIN = originalClaudeBin;
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

describe('ClaudeDriver command resolution', () => {
  it('uses command resolved from login shell', async () => {
    delete process.env.CLAUDE_COMMAND;
    delete process.env.CLAUDE_BIN;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-shell-'));
    const fakeShell = path.join(tempRoot, 'fake-shell.sh');
    await writeFile(fakeShell, '#!/bin/sh\necho /mock/bin/claude\n', 'utf8');
    await chmod(fakeShell, 0o755);
    process.env.SHELL = fakeShell;

    const { ClaudeDriver } = await import('./driver-claude.js');
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe('/mock/bin/claude');
  });

  it('uses ~/.local/bin/claude when shell lookup fails and local binary exists', async () => {
    delete process.env.CLAUDE_COMMAND;
    delete process.env.CLAUDE_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'claude-home-'));
    process.env.HOME = tempHome;

    const localBin = path.join(tempHome, '.local', 'bin', 'claude');
    await mkdir(path.dirname(localBin), { recursive: true });
    await writeFile(localBin, '#!/bin/sh\necho claude\n', 'utf8');

    const { ClaudeDriver } = await import('./driver-claude.js');
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe(localBin);
  });

  it('falls back to plain claude when no detection strategy succeeds', async () => {
    delete process.env.CLAUDE_COMMAND;
    delete process.env.CLAUDE_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = await mkdtemp(path.join(os.tmpdir(), 'claude-home-'));

    const { ClaudeDriver } = await import('./driver-claude.js');
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe('claude');
  });

  it('reuses cached command on subsequent resolutions', async () => {
    delete process.env.CLAUDE_COMMAND;
    delete process.env.CLAUDE_BIN;
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-shell-'));
    const fakeShell = path.join(tempRoot, 'fake-shell.sh');
    await writeFile(fakeShell, '#!/bin/sh\necho /mock/bin/claude\n', 'utf8');
    await chmod(fakeShell, 0o755);
    process.env.SHELL = fakeShell;

    const { ClaudeDriver } = await import('./driver-claude.js');
    const first = new ClaudeDriver();
    expect(first.buildCommand()).toBe('/mock/bin/claude');

    process.env.SHELL = '/definitely/missing-shell';
    const second = new ClaudeDriver();
    expect(second.buildCommand()).toBe('/mock/bin/claude');
  });

  it('falls back to os.homedir when HOME is blank', async () => {
    delete process.env.CLAUDE_COMMAND;
    delete process.env.CLAUDE_BIN;
    process.env.SHELL = '/definitely/missing-shell';
    process.env.HOME = '   ';

    const { ClaudeDriver } = await import('./driver-claude.js');
    const driver = new ClaudeDriver();
    expect(driver.buildCommand()).toBe('claude');
  });
});
