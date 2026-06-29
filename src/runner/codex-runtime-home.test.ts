import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareCodexRuntimeHome } from './codex-runtime-home.js';

describe('prepareCodexRuntimeHome', () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }

    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('copies auth and config files into a per-workdir runtime home', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'codex-home-src-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    tempDirs.push(sourceHome, workdir);

    await mkdir(sourceHome, { recursive: true });
    await writeFile(path.join(sourceHome, 'auth.json'), '{"token":"abc"}\n', { mode: 0o600 });
    await writeFile(path.join(sourceHome, 'config.toml'), 'model = "o3"\n', { mode: 0o600 });
    await writeFile(path.join(sourceHome, 'config.json'), '{"legacy":true}\n', { mode: 0o600 });
    await writeFile(path.join(sourceHome, 'state_5.sqlite'), 'should-not-copy', { mode: 0o600 });

    process.env.CODEX_HOME = sourceHome;
    const result = await prepareCodexRuntimeHome(workdir);

    expect(result.homeDir).toBe(path.join(workdir, '.codex_runtime_home'));
    expect(result.seededFiles).toEqual(['auth.json', 'config.json', 'config.toml']);
    await expect(readFile(path.join(result.homeDir, 'auth.json'), 'utf-8')).resolves.toContain(
      'abc',
    );
    await expect(readFile(path.join(result.homeDir, 'config.toml'), 'utf-8')).resolves.toContain(
      'model',
    );
    await expect(readFile(path.join(result.homeDir, 'config.json'), 'utf-8')).resolves.toContain(
      'legacy',
    );
    await expect(readFile(path.join(result.homeDir, 'state_5.sqlite'), 'utf-8')).rejects.toThrow();
  });

  it('creates an empty runtime home when the source home has no seed files', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'codex-home-empty-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    tempDirs.push(sourceHome, workdir);

    process.env.CODEX_HOME = sourceHome;
    const result = await prepareCodexRuntimeHome(workdir);

    expect(result.seededFiles).toEqual([]);
    await expect(readFile(path.join(result.homeDir, 'auth.json'), 'utf-8')).rejects.toThrow();
  });

  it('falls back to $HOME/.codex when CODEX_HOME is not set', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-default-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    const sourceHome = path.join(homeDir, '.codex');
    tempDirs.push(homeDir, workdir);

    delete process.env.CODEX_HOME;
    await mkdir(sourceHome, { recursive: true });
    await writeFile(path.join(sourceHome, 'instructions.md'), '# instructions\n');

    const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    const result = await prepareCodexRuntimeHome(workdir);

    expect(result.seededFiles).toEqual(['instructions.md']);
    await expect(
      readFile(path.join(result.homeDir, 'instructions.md'), 'utf-8'),
    ).resolves.toContain('instructions');

    homedirSpy.mockRestore();
  });

  it('rethrows copy failures other than missing source files', async () => {
    const sourceHome = path.join(os.tmpdir(), `codex-home-error-${Date.now()}`);
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    tempDirs.push(sourceHome, workdir);

    await writeFile(sourceHome, 'not a directory\n');
    process.env.CODEX_HOME = sourceHome;

    await expect(prepareCodexRuntimeHome(workdir)).rejects.toThrow();
  });

  it('renders DB-backed MCP servers while preserving non-MCP TOML sections', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'codex-home-db-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    tempDirs.push(sourceHome, workdir);

    await mkdir(sourceHome, { recursive: true });
    await writeFile(
      path.join(sourceHome, 'config.toml'),
      [
        'model = "o3"',
        '',
        '[mcp_servers.old]',
        'command = "legacy"',
        '',
        '[profiles.default]',
        'verbosity = "high"',
      ].join('\n'),
      { mode: 0o600 },
    );

    process.env.CODEX_HOME = sourceHome;
    const result = await prepareCodexRuntimeHome(workdir, [
      {
        id: 'srv-1',
        name: 'aws-api',
        tool: 'codex',
        transport: 'http',
        definition: {
          url: 'https://example.com/mcp',
          bearerTokenEnvVar: 'AWS_TOKEN',
          envHttpHeaders: {
            Authorization: 'AWS_TOKEN',
          },
        },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);

    const runtimeConfig = await readFile(path.join(result.homeDir, 'config.toml'), 'utf-8');
    expect(runtimeConfig).toContain('model = "o3"');
    expect(runtimeConfig).toContain('[profiles.default]');
    expect(runtimeConfig).toContain('[mcp_servers.aws-api]');
    expect(runtimeConfig).toContain('bearer_token_env_var = "AWS_TOKEN"');
    expect(runtimeConfig).toContain('env_http_headers = { Authorization = "AWS_TOKEN" }');
    expect(runtimeConfig).not.toContain('[mcp_servers.old]');
  });

  it('clears runtime MCP sections when a later DB selection is empty', async () => {
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'codex-home-db-'));
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-home-work-'));
    tempDirs.push(sourceHome, workdir);

    await mkdir(sourceHome, { recursive: true });
    await writeFile(
      path.join(sourceHome, 'config.toml'),
      [
        'model = "o3"',
        '',
        '[mcp_servers.old]',
        'command = "legacy"',
        '',
        '[profiles.default]',
        'verbosity = "high"',
      ].join('\n'),
      { mode: 0o600 },
    );

    process.env.CODEX_HOME = sourceHome;
    await prepareCodexRuntimeHome(workdir, [
      {
        id: 'srv-1',
        name: 'aws-api',
        tool: 'codex',
        transport: 'http',
        definition: {
          url: 'https://example.com/mcp',
        },
        createdAt: '2026-03-10T00:00:00.000Z',
        updatedAt: '2026-03-10T00:00:00.000Z',
      },
    ]);

    const result = await prepareCodexRuntimeHome(workdir, []);
    const runtimeConfig = await readFile(path.join(result.homeDir, 'config.toml'), 'utf-8');

    expect(runtimeConfig).toContain('model = "o3"');
    expect(runtimeConfig).toContain('[profiles.default]');
    expect(runtimeConfig).not.toContain('[mcp_servers.aws-api]');
    expect(runtimeConfig).not.toContain('[mcp_servers.old]');
  });
});
