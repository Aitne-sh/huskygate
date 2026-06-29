import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServerRecord } from '../store/mcp-server.js';
import {
  getClaudeGeneratedMcpConfigPath,
  removeClaudeGeneratedMcpConfig,
  writeClaudeMcpConfigToWorkdir,
} from './mcp-writer.js';

const tempDirs: string[] = [];

function createWorkdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huskygate-mcp-writer-'));
  tempDirs.push(dir);
  return dir;
}

function makeServer(
  partial: Partial<McpServerRecord> & Pick<McpServerRecord, 'name' | 'transport' | 'definition'>,
): McpServerRecord {
  return {
    id: partial.id ?? 'id',
    name: partial.name,
    tool: partial.tool ?? 'claude',
    transport: partial.transport,
    definition: partial.definition,
    createdAt: partial.createdAt ?? '2026-03-10T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-03-10T00:00:00.000Z',
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeClaudeMcpConfigToWorkdir', () => {
  it('writes generated Claude config with strict JSON shape', () => {
    const workdir = createWorkdir();
    const filePath = writeClaudeMcpConfigToWorkdir(workdir, [
      makeServer({
        name: 'aws-api',
        transport: 'http',
        definition: {
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      }),
      makeServer({
        name: 'stdio-srv',
        transport: 'stdio',
        definition: { command: 'node', args: ['server.js'] },
      }),
    ]);

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.mcpServers['aws-api']).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret' },
    });
    expect(parsed.mcpServers['stdio-srv']).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('writes an empty config when no servers are enabled', () => {
    const workdir = createWorkdir();
    const filePath = writeClaudeMcpConfigToWorkdir(workdir, []);

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed).toEqual({ mcpServers: {} });
  });

  it('keeps the generated config valid across repeated writes to the same workdir', () => {
    const workdir = createWorkdir();

    writeClaudeMcpConfigToWorkdir(workdir, [
      makeServer({
        name: 'aws-api',
        transport: 'http',
        definition: {
          url: 'https://example.com/first',
        },
      }),
    ]);
    const filePath = writeClaudeMcpConfigToWorkdir(workdir, [
      makeServer({
        name: 'github',
        transport: 'stdio',
        definition: { command: 'node', args: ['server.js'] },
      }),
    ]);

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    expect(parsed).toEqual({
      mcpServers: {
        github: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
    });
  });

  it('removes the generated config file', () => {
    const workdir = createWorkdir();
    const filePath = writeClaudeMcpConfigToWorkdir(workdir, []);
    removeClaudeGeneratedMcpConfig(filePath);
    expect(fs.existsSync(getClaudeGeneratedMcpConfigPath(workdir))).toBe(false);
  });

  it('does not overwrite a pre-existing foreign file at the canonical path', () => {
    const workdir = createWorkdir();
    const canonicalPath = getClaudeGeneratedMcpConfigPath(workdir);
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    fs.writeFileSync(canonicalPath, '{"owner":"user"}\n', 'utf-8');

    const filePath = writeClaudeMcpConfigToWorkdir(workdir, []);

    expect(filePath).not.toBe(canonicalPath);
    expect(fs.readFileSync(canonicalPath, 'utf-8')).toBe('{"owner":"user"}\n');
    expect(
      JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { mcpServers: Record<string, unknown> },
    ).toEqual({ mcpServers: {} });

    removeClaudeGeneratedMcpConfig(filePath);
    expect(fs.existsSync(canonicalPath)).toBe(true);
  });

  it('does not trust a stale owner sidecar for overwrite or cleanup', () => {
    const workdir = createWorkdir();
    const canonicalPath = getClaudeGeneratedMcpConfigPath(workdir);
    const ownerPath = `${canonicalPath}.owner`;
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
    fs.writeFileSync(canonicalPath, '{"owner":"user"}\n', 'utf-8');
    fs.writeFileSync(
      ownerPath,
      `${JSON.stringify({
        managedBy: 'huskygate',
        kind: 'claude-mcp-config',
        version: 1,
        sha256: 'not-the-real-hash',
      })}\n`,
      'utf-8',
    );

    const filePath = writeClaudeMcpConfigToWorkdir(workdir, []);

    expect(filePath).not.toBe(canonicalPath);
    expect(fs.readFileSync(canonicalPath, 'utf-8')).toBe('{"owner":"user"}\n');

    removeClaudeGeneratedMcpConfig(canonicalPath);
    expect(fs.existsSync(canonicalPath)).toBe(true);
    expect(fs.existsSync(ownerPath)).toBe(true);

    removeClaudeGeneratedMcpConfig(filePath);
    expect(fs.existsSync(canonicalPath)).toBe(true);
  });

  it('falls back to a safe generated directory when .huskygate is a symlink', () => {
    const workdir = createWorkdir();
    const outsideDir = createWorkdir();
    const outsideTarget = path.join(outsideDir, 'claude.mcp.json');
    fs.symlinkSync(outsideDir, path.join(workdir, '.huskygate'));

    const filePath = writeClaudeMcpConfigToWorkdir(workdir, []);

    expect(filePath).toContain(`${path.sep}.huskygate-generated${path.sep}`);
    expect(fs.existsSync(outsideTarget)).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { mcpServers: Record<string, unknown> },
    ).toEqual({ mcpServers: {} });
  });
});
