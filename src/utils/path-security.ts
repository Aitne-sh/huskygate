/** @module path-security — Helpers for safe path materialization under a trusted root. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface TrustedRootPaths {
  logicalRoot: string;
  realRoot: string;
}

function isResolvedPathWithinDirectory(targetPath: string, directory: string): boolean {
  return targetPath === directory || targetPath.startsWith(`${directory}${path.sep}`);
}

function getTrustedRootPaths(rootDir: string): TrustedRootPaths {
  const logicalRoot = path.resolve(rootDir);
  const rootStat = fs.lstatSync(logicalRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Symlink root not allowed: ${logicalRoot}`);
  }
  return {
    logicalRoot,
    realRoot: fs.realpathSync(logicalRoot),
  };
}

function assertLogicalPathWithinRoot(targetPath: string, logicalRoot: string): void {
  if (!isResolvedPathWithinDirectory(targetPath, logicalRoot)) {
    throw new Error(`Path escapes root: ${targetPath}`);
  }
}

function assertRealPathWithinRoot(targetPath: string, realRoot: string): void {
  if (!isResolvedPathWithinDirectory(targetPath, realRoot)) {
    throw new Error(`Path escapes root after resolution: ${targetPath}`);
  }
}

export function ensureDirectoryWithinRoot(
  rootDir: string,
  targetDir: string,
  options?: { mode?: number },
): string {
  const { logicalRoot, realRoot } = getTrustedRootPaths(rootDir);
  const resolvedTarget = path.resolve(targetDir);
  assertLogicalPathWithinRoot(resolvedTarget, logicalRoot);

  const relative = path.relative(logicalRoot, resolvedTarget);
  let current = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const nextPath = path.join(current, segment);
    if (fs.existsSync(nextPath)) {
      const stat = fs.lstatSync(nextPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink path not allowed: ${nextPath}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Expected directory: ${nextPath}`);
      }
    } else {
      fs.mkdirSync(nextPath, { mode: options?.mode });
    }
    current = fs.realpathSync(nextPath);
    assertRealPathWithinRoot(current, realRoot);
  }
  return current;
}

export function resolveExistingPathWithinRoot(rootDir: string, targetPath: string): string {
  const { logicalRoot, realRoot } = getTrustedRootPaths(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  assertLogicalPathWithinRoot(resolvedTarget, logicalRoot);

  const stat = fs.lstatSync(resolvedTarget);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlink path not allowed: ${resolvedTarget}`);
  }

  const realTarget = fs.realpathSync(resolvedTarget);
  assertRealPathWithinRoot(realTarget, realRoot);
  return realTarget;
}

export function prepareFilePathWithinRoot(
  rootDir: string,
  targetPath: string,
  options?: { dirMode?: number },
): string {
  const { logicalRoot } = getTrustedRootPaths(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  assertLogicalPathWithinRoot(resolvedTarget, logicalRoot);

  const realParent = ensureDirectoryWithinRoot(rootDir, path.dirname(resolvedTarget), {
    mode: options?.dirMode,
  });
  const preparedPath = path.join(realParent, path.basename(resolvedTarget));
  if (fs.existsSync(preparedPath)) {
    const stat = fs.lstatSync(preparedPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink path not allowed: ${preparedPath}`);
    }
    if (stat.isDirectory()) {
      throw new Error(`Expected file path: ${preparedPath}`);
    }
  }
  return preparedPath;
}

function writePreparedFileAtomically(
  preparedPath: string,
  content: string | Buffer,
  options?: { encoding?: BufferEncoding; mode?: number },
): string {
  const parentDir = path.dirname(preparedPath);
  const tmpPath = path.join(parentDir, `.tmp.${randomUUID()}`);
  try {
    if (typeof content === 'string') {
      fs.writeFileSync(tmpPath, content, {
        encoding: options?.encoding ?? 'utf-8',
        mode: options?.mode,
      });
    } else {
      fs.writeFileSync(tmpPath, content, {
        mode: options?.mode,
      });
    }
    if (fs.existsSync(preparedPath)) {
      const stat = fs.lstatSync(preparedPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink path not allowed: ${preparedPath}`);
      }
      if (stat.isDirectory()) {
        throw new Error(`Expected file path: ${preparedPath}`);
      }
    }
    fs.renameSync(tmpPath, preparedPath);
    if (options?.mode !== undefined) {
      fs.chmodSync(preparedPath, options.mode);
    }
    return preparedPath;
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

export function writeTextFileWithinRoot(
  rootDir: string,
  targetPath: string,
  content: string,
  options?: {
    dirMode?: number;
    fileMode?: number;
    encoding?: BufferEncoding;
    requireExisting?: boolean;
  },
): string {
  const preparedPath = prepareFilePathWithinRoot(rootDir, targetPath, {
    dirMode: options?.dirMode,
  });
  if (options?.requireExisting && !fs.existsSync(preparedPath)) {
    throw new Error(`Path does not exist: ${preparedPath}`);
  }
  return writePreparedFileAtomically(preparedPath, content, {
    encoding: options?.encoding,
    mode: options?.fileMode,
  });
}

export function readTextFileWithinRoot(
  rootDir: string,
  targetPath: string,
  encoding: BufferEncoding = 'utf-8',
): string {
  return fs.readFileSync(resolveExistingPathWithinRoot(rootDir, targetPath), encoding);
}

export function removeExistingFileWithinRoot(rootDir: string, targetPath: string): string {
  const resolvedPath = resolveExistingPathWithinRoot(rootDir, targetPath);
  const stat = fs.lstatSync(resolvedPath);
  if (stat.isDirectory()) {
    throw new Error(`Expected file path: ${resolvedPath}`);
  }
  fs.unlinkSync(resolvedPath);
  return resolvedPath;
}
