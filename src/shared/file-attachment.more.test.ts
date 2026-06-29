import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadedFile, SlackFileInfo } from './file-attachment.js';
import {
  archiveOutputFiles,
  buildArtifactResponseHeaders,
  downloadFiles,
  guessMimeType,
  isPreviewableArtifactImageMimeType,
  listAllArtifacts,
  normalizeImage,
  validateArtifactFile,
} from './file-attachment.js';

vi.mock('sharp', () => {
  throw new Error('sharp is not installed');
});

describe('file-attachment additional coverage', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('handles missing sharp import for HEIC and non-HEIC images', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attachment-more-'));

    const heicPath = path.join(tmpDir, 'IMG_1000.jpg');
    const heicHeader = Buffer.alloc(64, 0);
    heicHeader.write('ftyp', 4, 'ascii');
    heicHeader.write('heic', 8, 'ascii');
    fs.writeFileSync(heicPath, heicHeader);
    const heicFile: DownloadedFile = {
      originalName: 'IMG_1000.jpg',
      localPath: heicPath,
      relativePath: 'IMG_1000.jpg',
      mimetype: 'image/jpeg',
      size: 64,
    };

    await expect(normalizeImage(heicFile, tmpDir)).rejects.toThrow(
      'HEIC image detected but the conversion library (sharp) is not available',
    );

    const pngPath = path.join(tmpDir, 'picture.png');
    const pngHeader = Buffer.alloc(64, 0);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    fs.writeFileSync(pngPath, pngHeader);
    const pngFile: DownloadedFile = {
      originalName: 'picture.png',
      localPath: pngPath,
      relativePath: 'picture.png',
      mimetype: 'image/png',
      size: 64,
    };

    const result = await normalizeImage(pngFile, tmpDir);
    expect(result).toBe(pngFile);
  });

  it('returns a download error when redirect response lacks Location header', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attachment-more-'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers(),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'redirect.txt',
        mimetype: 'text/plain',
        size: 12,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-redirect', 'xoxb-token');
    expect(result.downloaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('Redirect 302 without Location header');
  });

  it('rejects redirects to non-HTTPS hosts', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attachment-more-'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ location: 'http://example.com/file.txt' }),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F3',
        name: 'redirect-http.txt',
        mimetype: 'text/plain',
        size: 10,
        urlPrivateDownload: 'https://files.slack.com/F3/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-redirect-http', 'xoxb-token');
    expect(result.downloaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('Redirect to disallowed protocol: http:');
  });

  it('rejects redirects to non-allowlisted hosts', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attachment-more-'));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ location: 'https://example.com/file.txt' }),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F4',
        name: 'redirect-host.txt',
        mimetype: 'text/plain',
        size: 10,
        urlPrivateDownload: 'https://files.slack.com/F4/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-redirect-host', 'xoxb-token');
    expect(result.downloaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('Redirect to disallowed host');
  });

  it('ignores local cleanup failure after image normalization error', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attachment-more-'));
    const heicHeader = Buffer.alloc(64, 0);
    heicHeader.write('ftyp', 4, 'ascii');
    heicHeader.write('heic', 8, 'ascii');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: () =>
          Promise.resolve(
            heicHeader.buffer.slice(
              heicHeader.byteOffset,
              heicHeader.byteOffset + heicHeader.byteLength,
            ),
          ),
      }),
    );
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('unlink failed');
    });

    const files: SlackFileInfo[] = [
      {
        id: 'F2',
        name: 'IMG_2000.jpg',
        mimetype: 'image/jpeg',
        size: 64,
        urlPrivateDownload: 'https://files.slack.com/F2/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-cleanup-fail', 'xoxb-token');
    expect(result.downloaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('HEIC image detected');
  });

  it('validates artifact file paths and metadata safely', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-validate-'));
    const artifactDir = path.join(tmpDir, '_artifacts', 'job1');
    fs.mkdirSync(artifactDir, { recursive: true });
    const filePath = path.join(artifactDir, 'report.txt');
    fs.writeFileSync(filePath, 'hello');

    const ok = await validateArtifactFile(tmpDir, 'job1', 'report.txt');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.contentType).toBe('text/plain');
      expect(ok.stat.size).toBe(5);
    }

    const forbidden = await validateArtifactFile(tmpDir, 'job1', '../secrets.txt');
    expect(forbidden).toEqual({ ok: false, status: 403, error: 'Forbidden' });

    const missing = await validateArtifactFile(tmpDir, 'job1', 'missing.txt');
    expect(missing).toEqual({ ok: false, status: 404, error: 'File not found' });
  });

  it('returns not found when realpath fails on artifact file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-validate-'));
    const artifactDir = path.join(tmpDir, '_artifacts', 'job2');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Create a dangling symlink — realpath will fail since the target doesn't exist
    const danglingLink = path.join(artifactDir, 'blob.bin');
    fs.symlinkSync('/nonexistent/path/that/does/not/exist', danglingLink);

    const notFound = await validateArtifactFile(tmpDir, 'job2', 'blob.bin');
    expect(notFound).toEqual({ ok: false, status: 404, error: 'File not found' });
  });

  it('returns forbidden when symlink resolution escapes artifact directory', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-validate-'));
    const artifactDir = path.join(tmpDir, '_artifacts', 'job3');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Create a file outside the artifact directory and symlink to it
    const outsideDir = path.join(tmpDir, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(outsideFile, 'secret data');

    const symlinkPath = path.join(artifactDir, 'escape.txt');
    fs.symlinkSync(outsideFile, symlinkPath);

    const forbidden = await validateArtifactFile(tmpDir, 'job3', 'escape.txt');
    expect(forbidden).toEqual({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('forces active artifact content to download with nosniff and sandbox headers', () => {
    expect(buildArtifactResponseHeaders('report.svg', 'image/svg+xml', 128)).toEqual({
      'Content-Type': 'image/svg+xml',
      'Content-Length': '128',
      'Content-Disposition': 'attachment; filename="report.svg"',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    expect(buildArtifactResponseHeaders('report.html', 'text/html', 64)).toEqual({
      'Content-Type': 'text/html',
      'Content-Length': '64',
      'Content-Disposition': 'attachment; filename="report.html"',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
  });

  it('allows inline rendering only for raster artifact images', () => {
    expect(isPreviewableArtifactImageMimeType('image/png')).toBe(true);
    expect(isPreviewableArtifactImageMimeType('image/svg+xml')).toBe(false);
    expect(buildArtifactResponseHeaders('image.png', 'image/png', 32)).toEqual({
      'Content-Type': 'image/png',
      'Content-Length': '32',
      'Content-Disposition': 'inline; filename="image.png"',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('archives output files and handles partial archive failures', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-archive-'));
    const outputDir = path.join(tmpDir, '_output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'a.txt'), 'aaa');
    fs.writeFileSync(path.join(outputDir, 'b.txt'), 'bbb');

    const copySpy = vi.spyOn(fs, 'copyFileSync');
    copySpy.mockImplementation(((src: string, dest: string) => {
      if (src.endsWith('b.txt')) {
        throw new Error('copy failed');
      }
      return fs.writeFileSync(dest, fs.readFileSync(src));
    }) as never);
    const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {
      throw new Error('rmdir failed');
    });

    const archived = archiveOutputFiles(tmpDir, 'job-archived');
    expect(archived).toHaveLength(1);
    expect(archived[0]?.filename).toBe('a.txt');
    expect(fs.existsSync(path.join(tmpDir, '_artifacts', 'job-archived', 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'b.txt'))).toBe(true);

    copySpy.mockRestore();
    rmdirSpy.mockRestore();
  });

  it('lists all artifacts and skips invalid entries', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-list-'));
    expect(listAllArtifacts(tmpDir)).toEqual([]);

    const root = path.join(tmpDir, '_artifacts');
    const jobA = path.join(root, 'job-a');
    const jobB = path.join(root, 'job-b');
    fs.mkdirSync(jobA, { recursive: true });
    fs.mkdirSync(jobB, { recursive: true });
    fs.writeFileSync(path.join(root, 'not-a-dir.txt'), 'x');
    fs.writeFileSync(path.join(jobA, 'result.json'), '{"ok":true}');
    fs.writeFileSync(path.join(jobA, '.hidden'), 'x');
    fs.writeFileSync(path.join(jobA, 'empty.txt'), '');
    fs.mkdirSync(path.join(jobA, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(jobB, 'report.pdf'), '%PDF');

    const statSpy = vi.spyOn(fs, 'statSync');
    statSpy.mockImplementation(((p: string) => {
      if (p.endsWith('report.pdf')) {
        throw new Error('stat failed');
      }
      return fs.lstatSync(p) as fs.Stats;
    }) as never);

    const listed = listAllArtifacts(tmpDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.jobId).toBe('job-a');
    expect(listed[0]?.files[0]?.filename).toBe('result.json');
    expect(listed[0]?.files[0]?.mimeType).toBe('application/json');
    statSpy.mockRestore();
  });

  it('guesses fallback MIME type for unknown extension', () => {
    expect(guessMimeType('archive.unknownext')).toBe('application/octet-stream');
  });
});
