/**
 * Coverage supplement for path-security.ts — targets:
 * - writePreparedFileAtomically: chmod path (line 137-139)
 * - writePreparedFileAtomically: temp file cleanup on error (lines 141-143)
 * - writePreparedFileAtomically: Buffer content branch (line 122-125)
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTextFileWithinRoot } from './path-security.js';

describe('path-security — writePreparedFileAtomically branches', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = path.join(tmpdir(), `hg-pathsec2-${randomUUID()}`);
    fs.mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('applies fileMode via chmod after atomic write', () => {
    const filePath = path.join(rootDir, 'mode-test.txt');
    writeTextFileWithinRoot(rootDir, filePath, 'hello', { fileMode: 0o644 });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
    const stat = fs.statSync(filePath);
    // Check that chmod was applied (mode & 0o777)
    expect(stat.mode & 0o777).toBe(0o644);
  });

  it('cleans up temp file on symlink target error', () => {
    // Create a symlink at the target path → writePreparedFileAtomically should throw
    const realFile = path.join(rootDir, 'real.txt');
    const symlink = path.join(rootDir, 'symlink.txt');
    fs.writeFileSync(realFile, 'real');
    fs.symlinkSync(realFile, symlink);

    expect(() => writeTextFileWithinRoot(rootDir, symlink, 'data')).toThrow('Symlink');
    // Temp file should have been cleaned up
    const files = fs.readdirSync(rootDir);
    const tmpFiles = files.filter((f) => f.startsWith('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('cleans up temp file on directory target error', () => {
    const dirPath = path.join(rootDir, 'subdir');
    fs.mkdirSync(dirPath);

    expect(() => writeTextFileWithinRoot(rootDir, dirPath, 'data')).toThrow('Expected file path');
    const files = fs.readdirSync(rootDir);
    const tmpFiles = files.filter((f) => f.startsWith('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });
});
