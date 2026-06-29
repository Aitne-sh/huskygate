/** Coverage tests for path-security: atomic writes, requireExisting, removeExisting. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  prepareFilePathWithinRoot,
  readTextFileWithinRoot,
  removeExistingFileWithinRoot,
  resolveExistingPathWithinRoot,
  writeTextFileWithinRoot,
} from './path-security.js';

describe('path-security coverage', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = path.join(tmpdir(), `hg-pathsec-${randomUUID()}`);
    fs.mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe('writeTextFileWithinRoot', () => {
    it('writes file within root', () => {
      const filePath = path.join(rootDir, 'test.txt');
      const result = writeTextFileWithinRoot(rootDir, filePath, 'hello');
      expect(fs.readFileSync(result, 'utf-8')).toBe('hello');
    });

    it('creates nested directories', () => {
      const filePath = path.join(rootDir, 'a', 'b', 'test.txt');
      writeTextFileWithinRoot(rootDir, filePath, 'nested');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested');
    });

    it('throws when requireExisting and file does not exist', () => {
      const filePath = path.join(rootDir, 'missing.txt');
      expect(() =>
        writeTextFileWithinRoot(rootDir, filePath, 'data', { requireExisting: true }),
      ).toThrow('does not exist');
    });

    it('succeeds when requireExisting and file exists', () => {
      const filePath = path.join(rootDir, 'existing.txt');
      fs.writeFileSync(filePath, 'old');
      writeTextFileWithinRoot(rootDir, filePath, 'new', { requireExisting: true });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new');
    });

    it('overwrites existing file', () => {
      const filePath = path.join(rootDir, 'overwrite.txt');
      fs.writeFileSync(filePath, 'old');
      writeTextFileWithinRoot(rootDir, filePath, 'new');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new');
    });

    it('rejects path escaping root', () => {
      const filePath = path.join(rootDir, '..', 'escape.txt');
      expect(() => writeTextFileWithinRoot(rootDir, filePath, 'data')).toThrow('escapes root');
    });
  });

  describe('readTextFileWithinRoot', () => {
    it('reads file within root', () => {
      const filePath = path.join(rootDir, 'read.txt');
      fs.writeFileSync(filePath, 'content');
      const result = readTextFileWithinRoot(rootDir, filePath);
      expect(result).toBe('content');
    });

    it('throws for non-existent file', () => {
      const filePath = path.join(rootDir, 'missing.txt');
      expect(() => readTextFileWithinRoot(rootDir, filePath)).toThrow();
    });
  });

  describe('removeExistingFileWithinRoot', () => {
    it('removes file within root', () => {
      const filePath = path.join(rootDir, 'remove.txt');
      fs.writeFileSync(filePath, 'data');
      removeExistingFileWithinRoot(rootDir, filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('throws when target is a directory', () => {
      const dirPath = path.join(rootDir, 'subdir');
      fs.mkdirSync(dirPath);
      expect(() => removeExistingFileWithinRoot(rootDir, dirPath)).toThrow('Expected file path');
    });
  });

  describe('prepareFilePathWithinRoot', () => {
    it('rejects when target is a symlink', () => {
      const realFile = path.join(rootDir, 'real.txt');
      const symlink = path.join(rootDir, 'link.txt');
      fs.writeFileSync(realFile, 'data');
      fs.symlinkSync(realFile, symlink);
      expect(() => prepareFilePathWithinRoot(rootDir, symlink)).toThrow('Symlink');
    });

    it('rejects when target is a directory', () => {
      const dirPath = path.join(rootDir, 'subdir');
      fs.mkdirSync(dirPath);
      expect(() => prepareFilePathWithinRoot(rootDir, dirPath)).toThrow('Expected file path');
    });
  });

  describe('resolveExistingPathWithinRoot', () => {
    it('rejects symlink target', () => {
      const realFile = path.join(rootDir, 'real.txt');
      const symlink = path.join(rootDir, 'link.txt');
      fs.writeFileSync(realFile, 'data');
      fs.symlinkSync(realFile, symlink);
      expect(() => resolveExistingPathWithinRoot(rootDir, symlink)).toThrow('Symlink');
    });
  });
});
