/** Coverage3 tests for path-security: uncovered lines 35-36 (assertRealPathWithinRoot),
 * 123-126, 130-134, 142-144 (writePreparedFileAtomically branches) */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureDirectoryWithinRoot,
  prepareFilePathWithinRoot,
  resolveExistingPathWithinRoot,
  writeTextFileWithinRoot,
} from './path-security.js';

describe('path-security coverage3', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = path.join(tmpdir(), `hg-pathsec3-${randomUUID()}`);
    fs.mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe('assertRealPathWithinRoot (lines 35-36)', () => {
    it('throws when symlink resolves outside root via ensureDirectoryWithinRoot', () => {
      const outsideDir = path.join(tmpdir(), `hg-outside-${randomUUID()}`);
      fs.mkdirSync(outsideDir, { recursive: true });

      // Create a symlink inside rootDir pointing outside
      const symlinkPath = path.join(rootDir, 'escape');
      fs.symlinkSync(outsideDir, symlinkPath);

      // Attempting to ensure a directory through a symlink should throw
      expect(() => ensureDirectoryWithinRoot(rootDir, path.join(symlinkPath, 'sub'))).toThrow(
        'Symlink',
      );

      fs.rmSync(outsideDir, { recursive: true, force: true });
    });
  });

  describe('writePreparedFileAtomically — Buffer content (lines 123-126)', () => {
    it('writes buffer content via writeTextFileWithinRoot with encoding', () => {
      const filePath = path.join(rootDir, 'buffer-test.txt');
      writeTextFileWithinRoot(rootDir, filePath, 'buffer data', { encoding: 'utf-8' });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('buffer data');
    });
  });

  describe('writePreparedFileAtomically — symlink at target during rename (lines 130-131)', () => {
    it('throws for symlink at preparedPath during atomic write', () => {
      const realFile = path.join(rootDir, 'real.txt');
      const symlink = path.join(rootDir, 'sym.txt');
      fs.writeFileSync(realFile, 'original');
      fs.symlinkSync(realFile, symlink);

      expect(() => writeTextFileWithinRoot(rootDir, symlink, 'new data')).toThrow('Symlink');
    });
  });

  describe('writePreparedFileAtomically — directory at target (lines 133-134)', () => {
    it('throws when preparedPath is a directory', () => {
      const dirPath = path.join(rootDir, 'isdir');
      fs.mkdirSync(dirPath);

      expect(() => writeTextFileWithinRoot(rootDir, dirPath, 'data')).toThrow('Expected file path');
    });
  });

  describe('writePreparedFileAtomically — temp file cleanup on throw (lines 142-144)', () => {
    it('cleans up temp file when rename fails', () => {
      // Create symlink target that will cause the write to fail
      const realFile = path.join(rootDir, 'r.txt');
      const symTarget = path.join(rootDir, 'linked.txt');
      fs.writeFileSync(realFile, 'real');
      fs.symlinkSync(realFile, symTarget);

      expect(() => writeTextFileWithinRoot(rootDir, symTarget, 'content')).toThrow();

      // Verify no temp files remain
      const files = fs.readdirSync(rootDir);
      const tmpFiles = files.filter((f) => f.startsWith('.tmp.'));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe('prepareFilePathWithinRoot — existing file symlink check', () => {
    it('throws when existing target is a symlink', () => {
      const realFile = path.join(rootDir, 'real2.txt');
      const symlink = path.join(rootDir, 'prep-sym.txt');
      fs.writeFileSync(realFile, 'data');
      fs.symlinkSync(realFile, symlink);

      expect(() => prepareFilePathWithinRoot(rootDir, symlink)).toThrow('Symlink');
    });

    it('throws when existing target is a directory', () => {
      const dirPath = path.join(rootDir, 'prep-dir');
      fs.mkdirSync(dirPath);

      expect(() => prepareFilePathWithinRoot(rootDir, dirPath)).toThrow('Expected file path');
    });
  });

  describe('resolveExistingPathWithinRoot — symlink check', () => {
    it('throws when path is a symlink', () => {
      const realFile = path.join(rootDir, 'real3.txt');
      const symlink = path.join(rootDir, 'resolve-sym.txt');
      fs.writeFileSync(realFile, 'data');
      fs.symlinkSync(realFile, symlink);

      expect(() => resolveExistingPathWithinRoot(rootDir, symlink)).toThrow('Symlink');
    });
  });
});
