/**
 * Coverage tests for codex-runtime-home.ts — targets:
 * - resolveSourceCodexHome with CODEX_HOME env (line 19)
 * - resolveSourceCodexConfigPath with relative CODEX_MCP_CONFIG_PATH (lines 26-27)
 * - resolveSourceCodexConfigPath with absolute path
 * - copyFileIfPresent non-ENOENT error (line 37)
 * - readFileIfPresent non-ENOENT error (line 46-47)
 * - prepareCodexRuntimeHome without servers (line 84-85: existingConfig ?? '')
 * - prepareCodexRuntimeHome with empty serialized servers (line 88-90)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRecord } from '../store/mcp-server.js';

const mocked = vi.hoisted(() => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  serializeTomlSection: vi.fn(() => ''),
  updateTomlFile: vi.fn(() => 'updated-config'),
}));

vi.mock('node:fs/promises', () => ({
  copyFile: mocked.copyFile,
  mkdir: mocked.mkdir,
  readFile: mocked.readFile,
  writeFile: mocked.writeFile,
}));

vi.mock('../shared/toml.js', () => ({
  serializeTomlSection: mocked.serializeTomlSection,
  updateTomlFile: mocked.updateTomlFile,
}));

import { prepareCodexRuntimeHome } from './codex-runtime-home.js';

describe('codex-runtime-home coverage', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CODEX_HOME;
    delete process.env.CODEX_MCP_CONFIG_PATH;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses CODEX_HOME env var when set', async () => {
    process.env.CODEX_HOME = '/custom/codex';
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await prepareCodexRuntimeHome('/tmp/workdir');
    // Should use /custom/codex as source home
    expect(mocked.copyFile).toHaveBeenCalledWith(
      expect.stringContaining('/custom/codex/'),
      expect.any(String),
    );
  });

  it('uses CODEX_MCP_CONFIG_PATH env var (relative path)', async () => {
    process.env.CODEX_MCP_CONFIG_PATH = 'relative/config.toml';
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockResolvedValue('existing-config');

    await prepareCodexRuntimeHome('/tmp/workdir', []);
    // Should resolve relative path against homedir
    expect(mocked.readFile).toHaveBeenCalled();
  });

  it('uses CODEX_MCP_CONFIG_PATH env var (absolute path)', async () => {
    process.env.CODEX_MCP_CONFIG_PATH = '/absolute/config.toml';
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockResolvedValue('');

    await prepareCodexRuntimeHome('/tmp/workdir', []);
    expect(mocked.readFile).toHaveBeenCalledWith('/absolute/config.toml', 'utf-8');
  });

  it('rethrows non-ENOENT copyFile errors', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    await expect(prepareCodexRuntimeHome('/tmp/workdir')).rejects.toThrow('EPERM');
  });

  it('rethrows non-ENOENT readFile errors', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    await expect(prepareCodexRuntimeHome('/tmp/workdir')).rejects.toThrow('EACCES');
  });

  it('handles servers=undefined with existingConfig=null', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result0 = await prepareCodexRuntimeHome('/tmp/workdir');
    // servers=undefined, existingConfig=null → skip writing config.toml
    expect(mocked.writeFile).not.toHaveBeenCalled();
    expect(result0.seededFiles).not.toContain('config.toml');
  });

  it('handles servers=undefined with existingConfig present', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockResolvedValue('existing-content');

    await prepareCodexRuntimeHome('/tmp/workdir');
    // servers=undefined, existingConfig present → write existingConfig as-is
    expect(mocked.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('config.toml'),
      'existing-content',
      expect.any(Object),
    );
  });

  it('handles servers=[] with no existing config (empty serialized)', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.serializeTomlSection.mockReturnValue('');

    await prepareCodexRuntimeHome('/tmp/workdir', []);
    // servers=[], existingConfig=null, serializedServers='' → write empty string
    expect(mocked.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('config.toml'),
      '',
      expect.any(Object),
    );
  });

  it('handles servers=[] with existing config → updateTomlFile', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockResolvedValue('existing-config');
    mocked.updateTomlFile.mockReturnValue('updated-config');

    await prepareCodexRuntimeHome('/tmp/workdir', []);
    expect(mocked.updateTomlFile).toHaveBeenCalledWith('existing-config', {});
    expect(mocked.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('config.toml'),
      'updated-config',
      expect.any(Object),
    );
  });

  it('handles servers with no existing config → new serialized content', async () => {
    mocked.copyFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mocked.serializeTomlSection.mockReturnValue('[mcp]\nserver = true');

    const server = {
      name: 'test-server',
      definition: { transport: 'stdio', type: 'mcp', command: 'node' },
    } as unknown as McpServerRecord;
    await prepareCodexRuntimeHome('/tmp/workdir', [server]);
    expect(mocked.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('config.toml'),
      '[mcp]\nserver = true\n',
      expect.any(Object),
    );
  });

  it('records seeded files on successful copy', async () => {
    mocked.copyFile
      .mockResolvedValueOnce(undefined) // auth.json copied
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) // config.json not found
      .mockResolvedValueOnce(undefined); // instructions.md copied
    mocked.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await prepareCodexRuntimeHome('/tmp/workdir');
    expect(result.seededFiles).toContain('auth.json');
    expect(result.seededFiles).toContain('instructions.md');
    expect(result.seededFiles).not.toContain('config.json');
  });
});
