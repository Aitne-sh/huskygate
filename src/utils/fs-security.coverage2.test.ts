/** Coverage2 tests for fs-security: uncovered line 14 (ensurePrivateDirectory chmod catch) */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePrivateDirectory, PRIVATE_DIR_MODE } from './fs-security.js';

describe('fs-security coverage2', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `hg-fs-sec2-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ensurePrivateDirectory — chmod catch (line 14)', () => {
    it('creates directory with private mode', () => {
      const dirPath = path.join(tmpDir, 'private-dir');
      ensurePrivateDirectory(dirPath);
      expect(fs.existsSync(dirPath)).toBe(true);
      const stat = fs.statSync(dirPath);
      expect(stat.mode & 0o777).toBe(PRIVATE_DIR_MODE);
    });

    it('handles existing directory without error', () => {
      const dirPath = path.join(tmpDir, 'existing-dir');
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
      // Call again — should tighten permissions without error
      expect(() => ensurePrivateDirectory(dirPath)).not.toThrow();
    });
  });
});
