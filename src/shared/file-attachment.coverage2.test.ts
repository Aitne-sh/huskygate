/** Coverage2 tests for file-attachment: uncovered lines 431-438, 448, 455-456, 467-488, 554-562, 748, 874-875, 879-880 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlackFileInfo } from './file-attachment.js';
import {
  downloadFiles,
  MAX_FILE_SIZE_BYTES,
  saveLocalFile,
  validateArtifactFile,
} from './file-attachment.js';

const ARTIFACTS_SUBDIR = '_artifacts';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-cov2-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: build a minimal SlackFileInfo targeting an allowed Slack host
// ---------------------------------------------------------------------------
function makeSlackFile(overrides: Partial<SlackFileInfo> = {}): SlackFileInfo {
  return {
    id: 'F-cov2',
    name: 'test.txt',
    mimetype: 'text/plain',
    size: 10,
    urlPrivateDownload: 'https://files.slack.com/F-cov2/download',
    ...overrides,
  };
}

describe('file-attachment coverage2', () => {
  // resolveUniquePath — name collision (lines 554-562)
  describe('resolveUniquePath via saveLocalFile', () => {
    it('appends counter suffix when file already exists', async () => {
      const workdir = tmpDir;
      const batchId = 'batch1';

      // Save first file
      const buf1 = Buffer.from('content1');
      const result1 = await saveLocalFile(buf1, 'test.txt', 'text/plain', workdir, batchId);
      expect(result1.originalName).toBe('test.txt');
      expect(fs.existsSync(result1.localPath)).toBe(true);

      // Save second file with same name — should get _1 suffix
      const buf2 = Buffer.from('content2');
      const result2 = await saveLocalFile(buf2, 'test.txt', 'text/plain', workdir, batchId);
      expect(result2.localPath).toContain('test_1.txt');
      expect(fs.existsSync(result2.localPath)).toBe(true);

      // Save third — should get _2 suffix
      const buf3 = Buffer.from('content3');
      const result3 = await saveLocalFile(buf3, 'test.txt', 'text/plain', workdir, batchId);
      expect(result3.localPath).toContain('test_2.txt');
    });
  });

  // -------------------------------------------------------------------------
  // assertAllowedDownloadUrl — lines 431, 434, 437-438
  // -------------------------------------------------------------------------
  describe('assertAllowedDownloadUrl via downloadFiles', () => {
    it('rejects invalid URL (line 431)', async () => {
      const files = [makeSlackFile({ urlPrivateDownload: 'not-a-valid-url' })];
      const result = await downloadFiles(files, tmpDir, 'job-invalid-url', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('Invalid download URL');
    });

    it('rejects non-https protocol (line 434)', async () => {
      const files = [makeSlackFile({ urlPrivateDownload: 'http://files.slack.com/F1/download' })];
      const result = await downloadFiles(files, tmpDir, 'job-http', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('Download URL must use https');
    });

    it('rejects disallowed host (lines 437-438)', async () => {
      const files = [makeSlackFile({ urlPrivateDownload: 'https://evil.example.com/file.txt' })];
      const result = await downloadFiles(files, tmpDir, 'job-bad-host', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('Download URL host is not allowed');
    });
  });

  // -------------------------------------------------------------------------
  // parseContentLength — line 448 (non-finite parseInt result)
  // -------------------------------------------------------------------------
  describe('parseContentLength via readResponseBodyWithLimit', () => {
    it('treats non-numeric content-length as null and proceeds normally (line 448)', async () => {
      const content = Buffer.from('hello');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': 'not-a-number' }),
          body: null,
          arrayBuffer: () =>
            Promise.resolve(
              content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
            ),
        }),
      );

      const files = [makeSlackFile({ size: 5 })];
      const result = await downloadFiles(files, tmpDir, 'job-bad-cl', 'xoxb-token');
      expect(result.downloaded).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // readResponseBodyWithLimit — content-length exceeds max (lines 455-456)
  // -------------------------------------------------------------------------
  describe('readResponseBodyWithLimit content-length check', () => {
    it('throws when content-length header exceeds MAX_FILE_SIZE_BYTES (lines 455-456)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(MAX_FILE_SIZE_BYTES + 1),
          }),
          body: null,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }),
      );

      const files = [makeSlackFile({ size: 10 })];
      const result = await downloadFiles(files, tmpDir, 'job-cl-exceed', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('File too large');
    });
  });

  // -------------------------------------------------------------------------
  // readResponseBodyWithLimit — streaming body with reader (lines 467-488)
  // -------------------------------------------------------------------------
  describe('readResponseBodyWithLimit streaming reader', () => {
    it('reads file via streaming reader successfully (lines 467-488)', async () => {
      const chunk1 = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      const chunk2 = new Uint8Array([32, 119, 111, 114, 108, 100]); // " world"
      let readCount = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve({ done: false, value: chunk1 });
          if (readCount === 2) return Promise.resolve({ done: false, value: chunk2 });
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn(),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: { getReader: () => mockReader },
        }),
      );

      const files = [makeSlackFile({ size: 11 })];
      const result = await downloadFiles(files, tmpDir, 'job-reader-ok', 'xoxb-token');
      expect(result.downloaded).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      const saved = fs.readFileSync(result.downloaded[0]!.localPath, 'utf8');
      expect(saved).toBe('hello world');
    });

    it('aborts and throws when streaming body exceeds max (lines 476-482)', async () => {
      // Create a chunk that will exceed MAX_FILE_SIZE_BYTES
      const bigChunk = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
      bigChunk.fill(0x41); // 'A'

      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: false, value: bigChunk }),
        cancel: vi.fn().mockResolvedValue(undefined),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: { getReader: () => mockReader },
        }),
      );

      const files = [makeSlackFile({ size: 10 })];
      const result = await downloadFiles(files, tmpDir, 'job-reader-big', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('File too large');
      expect(mockReader.cancel).toHaveBeenCalled();
    });

    it('handles null value chunks from reader (line 474)', async () => {
      let readCount = 0;
      const chunk = new Uint8Array([65, 66]); // "AB"

      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve({ done: false, value: null });
          if (readCount === 2) return Promise.resolve({ done: false, value: chunk });
          return Promise.resolve({ done: true, value: undefined });
        }),
        cancel: vi.fn(),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: { getReader: () => mockReader },
        }),
      );

      const files = [makeSlackFile({ size: 2 })];
      const result = await downloadFiles(files, tmpDir, 'job-reader-null', 'xoxb-token');
      expect(result.downloaded).toHaveLength(1);
      const saved = fs.readFileSync(result.downloaded[0]!.localPath, 'utf8');
      expect(saved).toBe('AB');
    });

    it('ignores reader.cancel() errors when aborting oversized stream (line 479)', async () => {
      const bigChunk = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
      bigChunk.fill(0x42);

      const mockReader = {
        read: vi.fn().mockResolvedValueOnce({ done: false, value: bigChunk }),
        cancel: vi.fn().mockRejectedValue(new Error('cancel failed')),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          body: { getReader: () => mockReader },
        }),
      );

      const files = [makeSlackFile({ size: 10 })];
      const result = await downloadFiles(files, tmpDir, 'job-reader-cancel-err', 'xoxb-token');
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('File too large');
    });
  });

  // -------------------------------------------------------------------------
  // downloadFiles cleanup catch after normalisation error — line 748
  // fsp.unlink throws inside the catch block of normalizeImage failure
  // -------------------------------------------------------------------------
  describe('downloadFiles cleanup catch after normalisation error (line 748)', () => {
    it('ignores fsp.unlink failure when cleaning up after normalizeImage throws', async () => {
      // Craft a HEIC file header so normalizeImage detects it as HEIC and throws
      // (sharp is not mocked in this test file, so the dynamic import will fail)
      const heicContent = Buffer.alloc(64, 0);
      heicContent.write('ftyp', 4, 'ascii');
      heicContent.write('heic', 8, 'ascii');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          body: null,
          arrayBuffer: () =>
            Promise.resolve(
              heicContent.buffer.slice(
                heicContent.byteOffset,
                heicContent.byteOffset + heicContent.byteLength,
              ),
            ),
        }),
      );

      // Make fsp.unlink throw so the catch block at line 747-748 is hit
      vi.spyOn(fsp, 'unlink').mockRejectedValue(new Error('unlink failed'));

      const files = [
        makeSlackFile({
          id: 'F-heic',
          name: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 64,
        }),
      ];

      const result = await downloadFiles(files, tmpDir, 'job-cleanup-catch', 'xoxb-token');
      // normalizeImage should have failed (HEIC without sharp), and cleanup should have been attempted
      expect(result.downloaded).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.reason).toContain('HEIC');
    });
  });

  // -------------------------------------------------------------------------
  // validateArtifactFile
  // -------------------------------------------------------------------------
  describe('validateArtifactFile', () => {
    it('returns 404 when file does not exist', async () => {
      const workdir = tmpDir;
      const jobId = 'j1';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      const result = await validateArtifactFile(workdir, jobId, 'missing.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(404);
    });

    it('returns 403 for path traversal (pre-symlink check)', async () => {
      const workdir = tmpDir;
      const jobId = 'j1';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      const result = await validateArtifactFile(workdir, jobId, '../../../etc/passwd');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    });

    it('returns 404 when realpath fails (symlink to nonexistent target, line 874)', async () => {
      const workdir = tmpDir;
      const jobId = 'j2';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      // Create a symlink to a nonexistent target
      const linkPath = path.join(artDir, 'broken.txt');
      fs.symlinkSync('/nonexistent/target', linkPath);
      const result = await validateArtifactFile(workdir, jobId, 'broken.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(404);
    });

    it('returns 403 when symlink resolves outside artifact dir (line 870-871)', async () => {
      const workdir = tmpDir;
      const jobId = 'j3';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      // Create a file outside artifact dir
      const outsideFile = path.join(tmpDir, 'outside.txt');
      fs.writeFileSync(outsideFile, 'evil');
      // Create a symlink inside artifact dir pointing outside
      const linkPath = path.join(artDir, 'escape.txt');
      fs.symlinkSync(outsideFile, linkPath);
      const result = await validateArtifactFile(workdir, jobId, 'escape.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(403);
    });

    it('returns ok for valid file within artifact dir', async () => {
      const workdir = tmpDir;
      const jobId = 'j4';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      const filePath = path.join(artDir, 'good.txt');
      fs.writeFileSync(filePath, 'hello');
      const result = await validateArtifactFile(workdir, jobId, 'good.txt');
      expect(result.ok).toBe(true);
    });

    it('returns 413 when file exceeds MAX_ARTIFACT_SERVE_BYTES (lines 879-880)', async () => {
      const workdir = tmpDir;
      const jobId = 'j5-large';
      const artDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
      fs.mkdirSync(artDir, { recursive: true });
      const filePath = path.join(artDir, 'huge.bin');
      fs.writeFileSync(filePath, 'small content');

      // Mock fsp.stat to return a size exceeding the 100 MB limit
      const originalStat = fsp.stat;
      vi.spyOn(fsp, 'stat').mockImplementation(async (p, ...args) => {
        const real = await originalStat(p, ...args);
        if (String(p).endsWith('huge.bin')) {
          return { ...real, size: 200 * 1024 * 1024 } as fs.Stats;
        }
        return real;
      });

      const result = await validateArtifactFile(workdir, jobId, 'huge.bin');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(413);
        expect(result.error).toContain('too large');
      }
    });
  });
});
