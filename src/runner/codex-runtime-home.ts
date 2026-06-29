/** @module codex-runtime-home — Prepare isolated Codex CLI home directory with seeded config and MCP servers */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serializeTomlSection, updateTomlFile } from '../shared/toml.js';
import type { McpServerRecord } from '../store/mcp-server.js';

const CODEX_RUNTIME_HOME_DIRNAME = '.codex_runtime_home';
const DEFAULT_CODEX_HOME_DIRNAME = '.codex';
const SEEDED_CODEX_FILES = ['auth.json', 'config.json', 'instructions.md'] as const;

export interface CodexRuntimeHomeResult {
  homeDir: string;
  seededFiles: string[];
}

function resolveSourceCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), DEFAULT_CODEX_HOME_DIRNAME);
}

function resolveSourceCodexConfigPath(sourceHome: string): string {
  const configured = process.env.CODEX_MCP_CONFIG_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(os.homedir(), configured);
  }
  return path.join(sourceHome, 'config.toml');
}

async function copyFileIfPresent(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    await copyFile(sourcePath, destPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function readFileIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function buildCodexMcpServers(
  servers: ReadonlyArray<McpServerRecord>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    [...servers]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((server) => {
        const { transport: _t, type: _ty, ...definition } = server.definition;
        return [server.name, definition];
      }),
  );
}

export async function prepareCodexRuntimeHome(
  workdir: string,
  servers?: ReadonlyArray<McpServerRecord>,
): Promise<CodexRuntimeHomeResult> {
  const sourceHome = resolveSourceCodexHome();
  const sourceConfigPath = resolveSourceCodexConfigPath(sourceHome);
  const runtimeHome = path.join(workdir, CODEX_RUNTIME_HOME_DIRNAME);
  await mkdir(runtimeHome, { recursive: true });

  const seededFiles: string[] = [];
  for (const filename of SEEDED_CODEX_FILES) {
    const copied = await copyFileIfPresent(
      path.join(sourceHome, filename),
      path.join(runtimeHome, filename),
    );
    if (copied) seededFiles.push(filename);
  }

  const existingConfig = await readFileIfPresent(sourceConfigPath);
  const serializedServers = servers ? serializeTomlSection(buildCodexMcpServers(servers)) : '';
  const configContent =
    servers === undefined
      ? (existingConfig ?? '')
      : existingConfig
        ? updateTomlFile(existingConfig, buildCodexMcpServers(servers))
        : serializedServers
          ? `${serializedServers}\n`
          : '';
  if (!(servers === undefined && existingConfig === null)) {
    await writeFile(path.join(runtimeHome, 'config.toml'), configContent, { mode: 0o600 });
    seededFiles.push('config.toml');
  }

  return {
    homeDir: runtimeHome,
    seededFiles,
  };
}
