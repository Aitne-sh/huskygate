import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureDirectoryWithinRoot,
  prepareFilePathWithinRoot,
  readTextFileWithinRoot,
  removeExistingFileWithinRoot,
  resolveExistingPathWithinRoot,
  writeTextFileWithinRoot,
} from './path-security.js';

describe('path-security', () => {
  const tempRoots: string[] = [];

  /** Create a temp dir and resolve through realpathSync to avoid macOS /var → /private/var. */
  function makeTempRoot(prefix: string): string {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
    tempRoots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ── ensureDirectoryWithinRoot ──

  describe('ensureDirectoryWithinRoot', () => {
    it('creates nested directories and returns the real path', () => {
      const root = makeTempRoot('ps-ensure-');
      const result = ensureDirectoryWithinRoot(root, path.join(root, 'a', 'b', 'c'));
      expect(existsSync(result)).toBe(true);
      expect(lstatSync(result).isDirectory()).toBe(true);
      expect(result).toBe(path.join(root, 'a', 'b', 'c'));
    });

    it('rejects a target path that escapes the root via ../', () => {
      const root = makeTempRoot('ps-ensure-escape-');
      expect(() => ensureDirectoryWithinRoot(root, path.join(root, '..', 'escape'))).toThrow(
        'escapes root',
      );
    });

    it('rejects a symlink segment in the path', () => {
      const root = makeTempRoot('ps-ensure-symlink-');
      const outside = makeTempRoot('ps-ensure-outside-');
      mkdirSync(path.join(root, 'legit'), { recursive: true });
      symlinkSync(outside, path.join(root, 'legit', 'link'));
      expect(() =>
        ensureDirectoryWithinRoot(root, path.join(root, 'legit', 'link', 'sub')),
      ).toThrow('Symlink');
    });

    it('rejects a symlink root directory', () => {
      const root = makeTempRoot('ps-ensure-symroot-');
      const realDir = path.join(root, 'real');
      mkdirSync(realDir);
      const link = path.join(root, 'sym');
      symlinkSync(realDir, link);
      expect(() => ensureDirectoryWithinRoot(link, path.join(link, 'sub'))).toThrow('Symlink root');
    });

    it('applies mode option to created directories', () => {
      const root = makeTempRoot('ps-ensure-mode-');
      const result = ensureDirectoryWithinRoot(root, path.join(root, 'secure'), { mode: 0o700 });
      const stat = lstatSync(result);
      // On some filesystems the umask may affect the mode, so check the key bits
      expect(stat.mode & 0o777).toBe(0o700);
    });
  });

  // ── resolveExistingPathWithinRoot ──

  describe('resolveExistingPathWithinRoot', () => {
    it('resolves an existing regular file', () => {
      const root = makeTempRoot('ps-resolve-');
      const filePath = path.join(root, 'test.txt');
      writeFileSync(filePath, 'hello');
      const result = resolveExistingPathWithinRoot(root, filePath);
      expect(result).toBe(filePath);
    });

    it('resolves an existing directory', () => {
      const root = makeTempRoot('ps-resolve-dir-');
      const dir = path.join(root, 'sub');
      mkdirSync(dir);
      const result = resolveExistingPathWithinRoot(root, dir);
      expect(result).toBe(dir);
    });

    it('rejects a symlink target', () => {
      const root = makeTempRoot('ps-resolve-sym-');
      const outside = makeTempRoot('ps-resolve-outside-');
      const outsideFile = path.join(outside, 'secret.txt');
      writeFileSync(outsideFile, 'secret');
      symlinkSync(outsideFile, path.join(root, 'link.txt'));
      expect(() => resolveExistingPathWithinRoot(root, path.join(root, 'link.txt'))).toThrow(
        'Symlink',
      );
    });

    it('rejects a path that escapes via ../', () => {
      const root = makeTempRoot('ps-resolve-escape-');
      const outside = makeTempRoot('ps-resolve-esc-out-');
      const outsideFile = path.join(outside, 'file.txt');
      writeFileSync(outsideFile, 'data');
      expect(() =>
        resolveExistingPathWithinRoot(
          root,
          path.join(root, '..', path.basename(outside), 'file.txt'),
        ),
      ).toThrow('escapes root');
    });

    it('throws when the file does not exist', () => {
      const root = makeTempRoot('ps-resolve-noent-');
      expect(() =>
        resolveExistingPathWithinRoot(root, path.join(root, 'nonexistent.txt')),
      ).toThrow();
    });
  });

  // ── prepareFilePathWithinRoot ──

  describe('prepareFilePathWithinRoot', () => {
    it('creates parent directories and returns the prepared path', () => {
      const root = makeTempRoot('ps-prepare-');
      const result = prepareFilePathWithinRoot(root, path.join(root, 'a', 'b', 'file.txt'));
      expect(existsSync(path.dirname(result))).toBe(true);
      expect(result).toBe(path.join(root, 'a', 'b', 'file.txt'));
    });

    it('returns the path when target file already exists (regular file)', () => {
      const root = makeTempRoot('ps-prepare-exist-');
      const filePath = path.join(root, 'existing.txt');
      writeFileSync(filePath, 'content');
      const result = prepareFilePathWithinRoot(root, filePath);
      expect(result).toBe(filePath);
    });

    it('rejects when the target is a symlink', () => {
      const root = makeTempRoot('ps-prepare-sym-');
      const outside = makeTempRoot('ps-prepare-outside-');
      const outsideFile = path.join(outside, 'target.txt');
      writeFileSync(outsideFile, 'target');
      symlinkSync(outsideFile, path.join(root, 'link.txt'));
      expect(() => prepareFilePathWithinRoot(root, path.join(root, 'link.txt'))).toThrow('Symlink');
    });

    it('rejects when the target is a directory', () => {
      const root = makeTempRoot('ps-prepare-dir-');
      mkdirSync(path.join(root, 'subdir'));
      expect(() => prepareFilePathWithinRoot(root, path.join(root, 'subdir'))).toThrow(
        'Expected file path',
      );
    });

    it('rejects when a parent segment is a symlink', () => {
      const root = makeTempRoot('ps-prepare-parsym-');
      const outside = makeTempRoot('ps-prepare-parout-');
      symlinkSync(outside, path.join(root, 'linked-parent'));
      expect(() =>
        prepareFilePathWithinRoot(root, path.join(root, 'linked-parent', 'file.txt')),
      ).toThrow('Symlink');
    });

    it('rejects path escaping via ../', () => {
      const root = makeTempRoot('ps-prepare-escape-');
      expect(() => prepareFilePathWithinRoot(root, path.join(root, '..', 'escape.txt'))).toThrow(
        'escapes root',
      );
    });
  });

  // ── writeTextFileWithinRoot ──

  describe('writeTextFileWithinRoot', () => {
    it('writes a file atomically and returns the written path', () => {
      const root = makeTempRoot('ps-write-');
      const filePath = path.join(root, 'output.txt');
      const result = writeTextFileWithinRoot(root, filePath, 'hello world');
      expect(result).toBe(filePath);
      expect(readFileSync(filePath, 'utf-8')).toBe('hello world');
    });

    it('creates parent directories as needed', () => {
      const root = makeTempRoot('ps-write-nested-');
      const filePath = path.join(root, 'a', 'b', 'nested.txt');
      writeTextFileWithinRoot(root, filePath, 'nested');
      expect(readFileSync(filePath, 'utf-8')).toBe('nested');
    });

    it('rejects writing through a symlinked parent', () => {
      const root = makeTempRoot('ps-write-sym-');
      const outside = makeTempRoot('ps-write-outside-');
      symlinkSync(outside, path.join(root, 'escape'));
      expect(() =>
        writeTextFileWithinRoot(root, path.join(root, 'escape', 'file.txt'), 'data'),
      ).toThrow('Symlink');
    });

    it('rejects overwriting a symlinked file', () => {
      const root = makeTempRoot('ps-write-symfile-');
      const outside = makeTempRoot('ps-write-symout-');
      const outsideFile = path.join(outside, 'target.txt');
      writeFileSync(outsideFile, 'original');
      symlinkSync(outsideFile, path.join(root, 'linked.txt'));
      expect(() =>
        writeTextFileWithinRoot(root, path.join(root, 'linked.txt'), 'overwrite'),
      ).toThrow('Symlink');
      // Verify original was not modified
      expect(readFileSync(outsideFile, 'utf-8')).toBe('original');
    });

    it('respects requireExisting option', () => {
      const root = makeTempRoot('ps-write-reqexist-');
      expect(() =>
        writeTextFileWithinRoot(root, path.join(root, 'nonexistent.txt'), 'data', {
          requireExisting: true,
        }),
      ).toThrow('does not exist');
    });
  });

  // ── readTextFileWithinRoot ──

  describe('readTextFileWithinRoot', () => {
    it('reads a regular file', () => {
      const root = makeTempRoot('ps-read-');
      const filePath = path.join(root, 'readable.txt');
      writeFileSync(filePath, 'content');
      expect(readTextFileWithinRoot(root, filePath)).toBe('content');
    });

    it('rejects reading through a symlink', () => {
      const root = makeTempRoot('ps-read-sym-');
      const outside = makeTempRoot('ps-read-outside-');
      const outsideFile = path.join(outside, 'secret.txt');
      writeFileSync(outsideFile, 'secret');
      symlinkSync(outsideFile, path.join(root, 'link.txt'));
      expect(() => readTextFileWithinRoot(root, path.join(root, 'link.txt'))).toThrow('Symlink');
    });
  });

  // ── removeExistingFileWithinRoot ──

  describe('removeExistingFileWithinRoot', () => {
    it('removes a regular file and returns the resolved path', () => {
      const root = makeTempRoot('ps-remove-');
      const filePath = path.join(root, 'delete-me.txt');
      writeFileSync(filePath, 'bye');
      const result = removeExistingFileWithinRoot(root, filePath);
      expect(result).toBe(filePath);
      expect(existsSync(filePath)).toBe(false);
    });

    it('rejects removing a symlink', () => {
      const root = makeTempRoot('ps-remove-sym-');
      const outside = makeTempRoot('ps-remove-outside-');
      const outsideFile = path.join(outside, 'keep.txt');
      writeFileSync(outsideFile, 'keep');
      symlinkSync(outsideFile, path.join(root, 'link.txt'));
      expect(() => removeExistingFileWithinRoot(root, path.join(root, 'link.txt'))).toThrow(
        'Symlink',
      );
      // Verify original was not deleted
      expect(existsSync(outsideFile)).toBe(true);
    });

    it('rejects removing a directory', () => {
      const root = makeTempRoot('ps-remove-dir-');
      mkdirSync(path.join(root, 'subdir'));
      expect(() => removeExistingFileWithinRoot(root, path.join(root, 'subdir'))).toThrow(
        'Expected file path',
      );
    });
  });
});
