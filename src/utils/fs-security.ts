/** @module fs-security — Helpers to create files and directories with restrictive permissions. */
import fs from 'node:fs';
import { dirname } from 'node:path';

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function ensurePrivateDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  try {
    fs.chmodSync(dirPath, PRIVATE_DIR_MODE);
  } catch {
    // Best-effort tightening for existing directories.
  }
}

export function ensurePrivateFile(filePath: string): void {
  try {
    fs.chmodSync(filePath, PRIVATE_FILE_MODE);
  } catch {
    // Best-effort tightening for existing files.
  }
}

export function writePrivateFile(
  filePath: string,
  data: string,
  options?: Omit<fs.WriteFileOptions, 'mode'>,
): void {
  ensurePrivateDirectory(dirname(filePath));
  fs.writeFileSync(filePath, data, { ...options, mode: PRIVATE_FILE_MODE });
  ensurePrivateFile(filePath);
}

export function openPrivateAppendFile(filePath: string): number {
  ensurePrivateDirectory(dirname(filePath));
  const fd = fs.openSync(filePath, 'a', PRIVATE_FILE_MODE);
  try {
    fs.fchmodSync(fd, PRIVATE_FILE_MODE);
  } catch {
    ensurePrivateFile(filePath);
  }
  return fd;
}
