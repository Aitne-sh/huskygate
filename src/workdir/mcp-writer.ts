/** @module mcp-writer — Atomic write and ownership tracking of Claude MCP config files in workdirs */
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { McpServerRecord } from '../store/mcp-server.js';
import { ensureDirectoryWithinRoot, prepareFilePathWithinRoot } from '../utils/path-security.js';

const GENERATED_DIR = '.huskygate';
const GENERATED_SAFE_FALLBACK_DIR = '.huskygate-generated';
const GENERATED_FILE = 'claude.mcp.json';
const GENERATED_FALLBACK_PREFIX = 'claude.mcp.generated';
const OWNER_SUFFIX = '.owner';
const OWNER_METADATA_VERSION = 1;

interface GeneratedOwnerMetadata {
  managedBy: 'huskygate';
  kind: 'claude-mcp-config';
  version: number;
  sha256: string;
}

export function getClaudeGeneratedMcpConfigPath(workdir: string): string {
  return path.join(workdir, GENERATED_DIR, GENERATED_FILE);
}

function getClaudeGeneratedMcpOwnerPath(filePath: string): string {
  return `${filePath}${OWNER_SUFFIX}`;
}

function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function buildOwnerMetadata(content: string): string {
  const metadata: GeneratedOwnerMetadata = {
    managedBy: 'huskygate',
    kind: 'claude-mcp-config',
    version: OWNER_METADATA_VERSION,
    sha256: computeSha256(content),
  };
  return `${JSON.stringify(metadata)}\n`;
}

function readOwnerMetadata(filePath: string): GeneratedOwnerMetadata | null {
  const ownerPath = getClaudeGeneratedMcpOwnerPath(filePath);
  if (!existsSync(filePath) || !existsSync(ownerPath)) {
    return null;
  }
  try {
    if (lstatSync(filePath).isSymbolicLink() || lstatSync(ownerPath).isSymbolicLink()) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(ownerPath, 'utf-8')) as Partial<GeneratedOwnerMetadata>;
    if (
      parsed.managedBy !== 'huskygate' ||
      parsed.kind !== 'claude-mcp-config' ||
      parsed.version !== OWNER_METADATA_VERSION ||
      typeof parsed.sha256 !== 'string' ||
      !parsed.sha256
    ) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    if (computeSha256(content) !== parsed.sha256) {
      return null;
    }
    return parsed as GeneratedOwnerMetadata;
  } catch {
    return null;
  }
}

function isClaudeGeneratedMcpConfigOwned(filePath: string): boolean {
  return readOwnerMetadata(filePath) !== null;
}

function chooseClaudeGeneratedDirectory(workdir: string): string {
  const canonicalDir = path.join(workdir, GENERATED_DIR);
  try {
    return ensureDirectoryWithinRoot(workdir, canonicalDir, { mode: 0o700 });
  } catch {
    return ensureDirectoryWithinRoot(workdir, path.join(workdir, GENERATED_SAFE_FALLBACK_DIR), {
      mode: 0o700,
    });
  }
}

function chooseClaudeGeneratedMcpConfigPath(workdir: string): string {
  const generatedDir = chooseClaudeGeneratedDirectory(workdir);
  const canonicalPath = path.join(generatedDir, GENERATED_FILE);
  if (!existsSync(canonicalPath) || isClaudeGeneratedMcpConfigOwned(canonicalPath)) {
    return canonicalPath;
  }
  return path.join(generatedDir, `${GENERATED_FALLBACK_PREFIX}.${Date.now()}.${randomUUID()}.json`);
}

function buildClaudeServerDefinition(server: McpServerRecord): Record<string, unknown> {
  const { transport: _transport, type: _type, ...definition } = server.definition;
  return {
    type: server.transport,
    ...definition,
  };
}

export function writeClaudeMcpConfigToWorkdir(
  workdir: string,
  servers: ReadonlyArray<McpServerRecord>,
): string {
  const filePath = chooseClaudeGeneratedMcpConfigPath(workdir);
  const generatedDir = path.dirname(filePath);
  const safeFilePath = prepareFilePathWithinRoot(generatedDir, filePath, { dirMode: 0o700 });

  const mcpServers = Object.fromEntries(
    [...servers]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((server) => [server.name, buildClaudeServerDefinition(server)]),
  );
  const content = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  const ownerContent = buildOwnerMetadata(content);
  const suffix = randomUUID();
  const tmpPath = `${safeFilePath}.tmp.${suffix}`;
  const ownerPath = getClaudeGeneratedMcpOwnerPath(safeFilePath);
  const ownerTmpPath = `${ownerPath}.tmp.${suffix}`;
  writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  writeFileSync(ownerTmpPath, ownerContent, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmpPath, safeFilePath);
  renameSync(ownerTmpPath, ownerPath);
  try {
    chmodSync(safeFilePath, 0o600);
  } catch {
    /* non-critical on Windows NTFS */
  }
  try {
    chmodSync(ownerPath, 0o600);
  } catch {
    /* non-critical on Windows NTFS */
  }
  return safeFilePath;
}

export function removeClaudeGeneratedMcpConfig(workdirOrFilePath: string): void {
  if (!workdirOrFilePath.endsWith('.json')) {
    removeClaudeGeneratedMcpConfig(getClaudeGeneratedMcpConfigPath(workdirOrFilePath));
    removeClaudeGeneratedMcpConfig(
      path.join(workdirOrFilePath, GENERATED_SAFE_FALLBACK_DIR, GENERATED_FILE),
    );
    return;
  }
  const filePath = workdirOrFilePath;
  const ownerPath = getClaudeGeneratedMcpOwnerPath(filePath);
  if (!existsSync(ownerPath)) return;
  if (!existsSync(filePath)) {
    rmSync(ownerPath, { force: true });
    return;
  }
  if (!isClaudeGeneratedMcpConfigOwned(filePath)) {
    return;
  }
  rmSync(filePath, { force: true });
  rmSync(ownerPath, { force: true });
}
