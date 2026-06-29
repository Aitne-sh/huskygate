/** Coverage tests for mcp-writer: uncovered lines 55-56, 59-66, 69-72, 143-148, 153-155 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRecord } from '../store/mcp-server.js';

vi.mock('../utils/path-security.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/path-security.js')>(
    '../utils/path-security.js',
  );
  return actual;
});

let tmpDir: string;

describe('mcp-writer coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-writer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('writeClaudeMcpConfigToWorkdir', () => {
    it('writes config and owner file to workdir (full happy path)', async () => {
      const { writeClaudeMcpConfigToWorkdir } = await import('./mcp-writer.js');
      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test-server',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node', args: ['server.js'] },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const filePath = writeClaudeMcpConfigToWorkdir(tmpDir, servers);
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(content.mcpServers).toHaveProperty('test-server');
      expect(content.mcpServers['test-server'].type).toBe('stdio');

      // Owner file should exist
      expect(fs.existsSync(`${filePath}.owner`)).toBe(true);
    });

    it('generates fallback path when existing file is not owned (lines 99-102)', async () => {
      const { writeClaudeMcpConfigToWorkdir, getClaudeGeneratedMcpConfigPath } = await import(
        './mcp-writer.js'
      );

      // First write — creates owned file
      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test-server',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node', args: ['server.js'] },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeClaudeMcpConfigToWorkdir(tmpDir, servers);

      // Tamper with the file content so ownership check fails
      const canonicalPath = getClaudeGeneratedMcpConfigPath(tmpDir);
      fs.writeFileSync(canonicalPath, '{"tampered": true}');

      // Second write should use a fallback path
      const filePath2 = writeClaudeMcpConfigToWorkdir(tmpDir, servers);
      expect(filePath2).not.toBe(canonicalPath);
      expect(fs.existsSync(filePath2)).toBe(true);
    });
  });

  describe('removeClaudeGeneratedMcpConfig', () => {
    it('removes owned config files (lines 141-161)', async () => {
      const {
        writeClaudeMcpConfigToWorkdir,
        removeClaudeGeneratedMcpConfig,
        getClaudeGeneratedMcpConfigPath,
      } = await import('./mcp-writer.js');

      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test-server',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node' },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeClaudeMcpConfigToWorkdir(tmpDir, servers);

      const configPath = getClaudeGeneratedMcpConfigPath(tmpDir);
      expect(fs.existsSync(configPath)).toBe(true);

      // Remove by workdir path (not file path) — triggers recursive removal
      removeClaudeGeneratedMcpConfig(tmpDir);
      expect(fs.existsSync(configPath)).toBe(false);
    });

    it('handles missing owner file gracefully (line 151)', async () => {
      const {
        removeClaudeGeneratedMcpConfig,
        getClaudeGeneratedMcpConfigPath: _getClaudeGeneratedMcpConfigPath,
      } = await import('./mcp-writer.js');

      // Create just the config file without owner
      const configDir = path.join(tmpDir, '.huskygate');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'claude.mcp.json');
      fs.writeFileSync(configPath, '{}');

      // Should not throw, should not delete (no owner file)
      removeClaudeGeneratedMcpConfig(configPath);
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('removes owner file when config file is missing (lines 152-154)', async () => {
      const { removeClaudeGeneratedMcpConfig } = await import('./mcp-writer.js');

      const configDir = path.join(tmpDir, '.huskygate');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'claude.mcp.json');
      const ownerPath = `${configPath}.owner`;
      fs.writeFileSync(ownerPath, '{}');
      // Config file does not exist

      removeClaudeGeneratedMcpConfig(configPath);
      expect(fs.existsSync(ownerPath)).toBe(false);
    });

    it('does not remove config file if not owned (line 156-157)', async () => {
      const {
        writeClaudeMcpConfigToWorkdir,
        removeClaudeGeneratedMcpConfig,
        getClaudeGeneratedMcpConfigPath,
      } = await import('./mcp-writer.js');

      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test-server',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node' },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeClaudeMcpConfigToWorkdir(tmpDir, servers);

      const configPath = getClaudeGeneratedMcpConfigPath(tmpDir);
      // Tamper with file to break ownership
      fs.writeFileSync(configPath, '{"tampered": true}');

      removeClaudeGeneratedMcpConfig(configPath);
      // File should still exist since ownership check fails
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });

  describe('readOwnerMetadata edge cases', () => {
    it('returns null for symlink files (lines 58-59)', async () => {
      const {
        writeClaudeMcpConfigToWorkdir,
        removeClaudeGeneratedMcpConfig,
        getClaudeGeneratedMcpConfigPath,
      } = await import('./mcp-writer.js');

      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test-server',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node' },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      writeClaudeMcpConfigToWorkdir(tmpDir, servers);

      const configPath = getClaudeGeneratedMcpConfigPath(tmpDir);

      // Replace config file with symlink
      const realFile = path.join(tmpDir, 'real-file');
      fs.writeFileSync(realFile, fs.readFileSync(configPath));
      fs.unlinkSync(configPath);
      fs.symlinkSync(realFile, configPath);

      // removeClaudeGeneratedMcpConfig should not delete symlinked file
      removeClaudeGeneratedMcpConfig(configPath);
      // The symlink target should still exist
      expect(fs.existsSync(realFile)).toBe(true);
    });

    it('returns null for invalid owner metadata (lines 62-69)', async () => {
      const { removeClaudeGeneratedMcpConfig } = await import('./mcp-writer.js');

      const configDir = path.join(tmpDir, '.huskygate');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'claude.mcp.json');
      const ownerPath = `${configPath}.owner`;
      fs.writeFileSync(configPath, '{"test": true}');
      // Invalid owner metadata (wrong managedBy)
      fs.writeFileSync(
        ownerPath,
        JSON.stringify({ managedBy: 'other', kind: 'test', version: 1, sha256: 'abc' }),
      );

      removeClaudeGeneratedMcpConfig(configPath);
      // Should not delete since ownership fails
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });

  describe('chooseClaudeGeneratedDirectory fallback (lines 89-93)', () => {
    it('uses fallback dir when canonical dir creation fails', async () => {
      const { writeClaudeMcpConfigToWorkdir } = await import('./mcp-writer.js');

      // Create a file where the directory should be, blocking mkdir
      const blockingFile = path.join(tmpDir, '.huskygate');
      // Make .huskygate a regular file instead of a directory
      fs.writeFileSync(blockingFile, 'blocking');

      const servers: McpServerRecord[] = [
        {
          id: 'srv-1',
          name: 'test',
          tool: 'claude',
          transport: 'stdio',
          definition: { command: 'node' },

          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const filePath = writeClaudeMcpConfigToWorkdir(tmpDir, servers);
      // Should use the fallback directory
      expect(filePath).toContain('.huskygate-generated');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
