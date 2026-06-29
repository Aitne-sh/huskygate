/** Coverage tests for fs-security: openPrivateAppendFile edge cases. */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePrivateFile, openPrivateAppendFile, writePrivateFile } from './fs-security.js';

describe('fs-security coverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(tmpdir(), `hg-fs-sec-${randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('openPrivateAppendFile', () => {
    it('opens file for append and returns fd', () => {
      const filePath = path.join(tmpDir, 'test.log');
      const fd = openPrivateAppendFile(filePath);
      expect(typeof fd).toBe('number');
      expect(fd).toBeGreaterThan(0);
      fs.closeSync(fd);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('handles fchmod failure gracefully', () => {
      const filePath = path.join(tmpDir, 'test2.log');
      const origFchmod = fs.fchmodSync;
      // Temporarily make fchmod throw
      fs.fchmodSync = () => {
        throw new Error('fchmod not supported');
      };
      const fd = openPrivateAppendFile(filePath);
      expect(typeof fd).toBe('number');
      fs.closeSync(fd);
      fs.fchmodSync = origFchmod;
    });
  });

  describe('writePrivateFile', () => {
    it('creates parent directory and writes file', () => {
      const filePath = path.join(tmpDir, 'sub', 'nested', 'file.txt');
      writePrivateFile(filePath, 'hello');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
    });

    it('writes with custom options', () => {
      const filePath = path.join(tmpDir, 'opts.txt');
      writePrivateFile(filePath, 'data', { flag: 'w' });
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('data');
    });
  });

  describe('ensurePrivateFile', () => {
    it('handles chmod failure gracefully', () => {
      const filePath = path.join(tmpDir, 'nofile.txt');
      // File doesn't exist, chmod will fail
      expect(() => ensurePrivateFile(filePath)).not.toThrow();
    });
  });
});
