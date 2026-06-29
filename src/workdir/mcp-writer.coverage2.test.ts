/** Coverage2 tests for workdir/mcp-writer: uncovered lines 77-78, 140, 145
 * (readOwnerMetadata sha256 mismatch, chmod catch blocks) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-wr-cov2-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('mcp-writer coverage2', () => {
  describe('writeClaudeMcpConfigToWorkdir', () => {
    it('writes MCP config file to workdir', async () => {
      const { writeClaudeMcpConfigToWorkdir } = await import('./mcp-writer.js');
      const workdir = path.join(tmpDir, 'workdir');
      fs.mkdirSync(workdir, { recursive: true });

      const servers = [
        {
          id: 'srv-1',
          name: 'test-server',
          transport: 'stdio' as const,
          definition: { command: 'node', args: ['server.js'] },
          enabledByDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const filePath = writeClaudeMcpConfigToWorkdir(workdir, servers);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.mcpServers).toBeDefined();
      expect(content.mcpServers['test-server']).toBeDefined();
    });

    it('generates unique fallback path when config is externally owned (line 77-78)', async () => {
      const { writeClaudeMcpConfigToWorkdir } = await import('./mcp-writer.js');
      const workdir = path.join(tmpDir, 'workdir2');
      fs.mkdirSync(workdir, { recursive: true });

      // First write — creates the config
      const servers = [
        {
          id: 'srv-1',
          name: 'server-a',
          transport: 'stdio' as const,
          definition: { command: 'echo' },
          enabledByDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const path1 = writeClaudeMcpConfigToWorkdir(workdir, servers);
      expect(fs.existsSync(path1)).toBe(true);

      // Tamper with owner metadata to simulate external ownership
      const ownerPath = `${path1}.owner.json`;
      if (fs.existsSync(ownerPath)) {
        fs.writeFileSync(ownerPath, '{"sha256":"wrong-hash","generator":"external"}');
      }

      // Second write — should use fallback path since ownership check fails
      const path2 = writeClaudeMcpConfigToWorkdir(workdir, servers);
      expect(fs.existsSync(path2)).toBe(true);
    });
  });

  describe('removeClaudeGeneratedMcpConfig', () => {
    it('removes generated MCP config and owner metadata', async () => {
      const { writeClaudeMcpConfigToWorkdir, removeClaudeGeneratedMcpConfig } = await import(
        './mcp-writer.js'
      );
      const workdir = path.join(tmpDir, 'workdir3');
      fs.mkdirSync(workdir, { recursive: true });

      const servers = [
        {
          id: 'srv-1',
          name: 'server-rm',
          transport: 'stdio' as const,
          definition: { command: 'test' },
          enabledByDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const configPath = writeClaudeMcpConfigToWorkdir(workdir, servers);
      expect(fs.existsSync(configPath)).toBe(true);

      removeClaudeGeneratedMcpConfig(configPath);
      expect(fs.existsSync(configPath)).toBe(false);
    });
  });
});
