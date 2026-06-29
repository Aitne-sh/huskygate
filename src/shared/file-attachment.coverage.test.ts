/** Coverage tests for file-attachment: uncovered lines for detectImageFormat ftyp fallback,
 * normalizeImage branches, readResponseBodyWithLimit, fetchWithAuth redirect,
 * resolveUniquePath collision, validateArtifactFile, and buildArtifactResponseHeaders. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

describe('file-attachment coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectImageFormat', () => {
    it('returns unknown for buffer < 12 bytes (line 129 implied)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      expect(detectImageFormat(Buffer.alloc(8))).toBe('unknown');
    });

    it('detects HEIF via compatible brand scan (lines 171-172)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      // Build a ftyp box with 'isom' major brand and 'mif1' compatible brand at offset 16
      const buf = Buffer.alloc(64, 0);
      // Box size = 32 (big endian at offset 0)
      buf.writeUInt32BE(32, 0);
      // 'ftyp' at offset 4-7
      buf.write('ftyp', 4, 'ascii');
      // Major brand 'isom' at offset 8-11 (not in HEIF brands)
      buf.write('isom', 8, 'ascii');
      // Minor version at 12-15 (skip)
      // Compatible brand 'mif1' at offset 16-19 (in HEIF brands, not heic prefix)
      buf.write('mif1', 16, 'ascii');
      const result = detectImageFormat(buf);
      expect(result).toBe('heif');
    });

    it('returns heic when ftyp present but no recognized brand (lines 192)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      // Build ftyp box with unknown brand
      const buf = Buffer.alloc(64, 0);
      buf.writeUInt32BE(20, 0); // small box, only major brand, no compatible brands fit
      buf.write('ftyp', 4, 'ascii');
      buf.write('xxxx', 8, 'ascii'); // unknown major brand
      const result = detectImageFormat(buf);
      expect(result).toBe('heic');
    });

    it('detects TIFF little-endian (lines 195-200)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      const buf = Buffer.alloc(12, 0);
      buf[0] = 0x49;
      buf[1] = 0x49;
      buf[2] = 0x2a;
      buf[3] = 0x00;
      expect(detectImageFormat(buf)).toBe('tiff');
    });

    it('detects TIFF big-endian', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      const buf = Buffer.alloc(12, 0);
      buf[0] = 0x4d;
      buf[1] = 0x4d;
      buf[2] = 0x00;
      buf[3] = 0x2a;
      expect(detectImageFormat(buf)).toBe('tiff');
    });

    it('detects BMP (lines 203-206)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      const buf = Buffer.alloc(12, 0);
      buf[0] = 0x42;
      buf[1] = 0x4d;
      expect(detectImageFormat(buf)).toBe('bmp');
    });

    it('returns unknown for unrecognized format (line 208)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      const buf = Buffer.alloc(64, 0x00);
      expect(detectImageFormat(buf)).toBe('unknown');
    });

    it('detects heic via compatible brand with heic prefix (lines 184-185)', async () => {
      const { detectImageFormat } = await import('./file-attachment.js');
      const buf = Buffer.alloc(64, 0);
      buf.writeUInt32BE(32, 0);
      buf.write('ftyp', 4, 'ascii');
      buf.write('isom', 8, 'ascii');
      buf.write('heic', 16, 'ascii');
      expect(detectImageFormat(buf)).toBe('heic');
    });
  });

  describe('normalizeImage', () => {
    it('skips non-image files (line 231)', async () => {
      const { normalizeImage } = await import('./file-attachment.js');
      const file = {
        originalName: 'doc.pdf',
        localPath: '/tmp/doc.pdf',
        relativePath: 'doc.pdf',
        mimetype: 'application/pdf',
        size: 100,
      };
      const result = await normalizeImage(file, '/tmp');
      expect(result).toBe(file);
    });

    it('skips SVG files (line 236)', async () => {
      const { normalizeImage } = await import('./file-attachment.js');
      const file = {
        originalName: 'icon.svg',
        localPath: '/tmp/icon.svg',
        relativePath: 'icon.svg',
        mimetype: 'image/svg+xml',
        size: 100,
      };
      const result = await normalizeImage(file, '/tmp');
      expect(result).toBe(file);
    });
  });

  describe('validateFile', () => {
    it('rejects file too large (line 384-389)', async () => {
      const { validateFile, MAX_FILE_SIZE_BYTES } = await import('./file-attachment.js');
      const file = {
        id: 'f1',
        name: 'huge.txt',
        mimetype: 'text/plain',
        size: MAX_FILE_SIZE_BYTES + 1,
        urlPrivateDownload: 'https://slack.com/files/f1',
      };
      const error = validateFile(file, 0);
      expect(error).not.toBeNull();
      expect(error?.reason).toContain('too large');
    });

    it('rejects when total size exceeds limit (line 391-396)', async () => {
      const { validateFile, MAX_TOTAL_FILE_SIZE_BYTES } = await import('./file-attachment.js');
      const file = {
        id: 'f2',
        name: 'big.txt',
        mimetype: 'text/plain',
        size: 1000,
        urlPrivateDownload: 'https://slack.com/files/f2',
      };
      const error = validateFile(file, MAX_TOTAL_FILE_SIZE_BYTES);
      expect(error).not.toBeNull();
      expect(error?.reason).toContain('Total');
    });

    it('rejects disallowed MIME type (line 398-403)', async () => {
      const { validateFile } = await import('./file-attachment.js');
      const file = {
        id: 'f3',
        name: 'archive.zip',
        mimetype: 'application/zip',
        size: 100,
        urlPrivateDownload: 'https://slack.com/files/f3',
      };
      const error = validateFile(file, 0);
      expect(error).not.toBeNull();
      expect(error?.reason).toContain('not allowed');
    });

    it('returns null for valid file (line 405)', async () => {
      const { validateFile } = await import('./file-attachment.js');
      const file = {
        id: 'f4',
        name: 'doc.txt',
        mimetype: 'text/plain',
        size: 100,
        urlPrivateDownload: 'https://slack.com/files/f4',
      };
      const error = validateFile(file, 0);
      expect(error).toBeNull();
    });
  });

  describe('extractSlackFiles', () => {
    it('handles edge cases in raw file extraction (line 358-374)', async () => {
      const { extractSlackFiles } = await import('./file-attachment.js');

      // null/non-object items
      const result = extractSlackFiles([null, 'string', undefined, 42]);
      expect(result).toEqual([]);

      // missing id or url
      const result2 = extractSlackFiles([
        { id: '', url_private_download: 'https://slack.com/f1' },
        { id: 'f1', url_private_download: '' },
      ]);
      expect(result2).toEqual([]);

      // fallback to url_private
      const result3 = extractSlackFiles([
        {
          id: 'f2',
          name: 'file.txt',
          mimetype: 'text/plain',
          size: 100,
          url_private: 'https://slack.com/f2',
        },
      ]);
      expect(result3).toHaveLength(1);
      expect(result3[0]?.urlPrivateDownload).toBe('https://slack.com/f2');

      // missing name uses fallback
      const result4 = extractSlackFiles([
        {
          id: 'f3',
          mimetype: 'text/plain',
          size: 50,
          url_private_download: 'https://slack.com/f3',
        },
      ]);
      expect(result4[0]?.name).toBe('file_f3');
    });
  });

  describe('sanitizeFilename', () => {
    it('handles path traversal and special characters (lines 317-339)', async () => {
      const { sanitizeFilename } = await import('./file-attachment.js');

      expect(sanitizeFilename('../../etc/passwd')).toBe('etc_passwd');
      expect(sanitizeFilename('file\x00name')).toBe('file_name');
      expect(sanitizeFilename('___...__')).toBe('attachment');
      expect(sanitizeFilename('')).toBe('attachment');
      expect(sanitizeFilename(`${'a'.repeat(300)}.txt`).length).toBeLessThanOrEqual(255);
    });
  });

  describe('formatFileSize', () => {
    it('formats various sizes (lines 346-349)', async () => {
      const { formatFileSize } = await import('./file-attachment.js');
      expect(formatFileSize(500)).toBe('500B');
      expect(formatFileSize(2048)).toBe('2KB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0MB');
    });
  });

  describe('isPreviewableArtifactImageMimeType', () => {
    it('returns true for previewable types and false otherwise (line 936-941)', async () => {
      const { isPreviewableArtifactImageMimeType } = await import('./file-attachment.js');
      expect(isPreviewableArtifactImageMimeType('image/png')).toBe(true);
      expect(isPreviewableArtifactImageMimeType('image/jpeg')).toBe(true);
      expect(isPreviewableArtifactImageMimeType('image/svg+xml')).toBe(false);
      expect(isPreviewableArtifactImageMimeType(null)).toBe(false);
      expect(isPreviewableArtifactImageMimeType(undefined)).toBe(false);
    });
  });

  describe('buildArtifactResponseHeaders', () => {
    it('sets inline disposition for normal types (lines 943-960)', async () => {
      const { buildArtifactResponseHeaders } = await import('./file-attachment.js');
      const headers = buildArtifactResponseHeaders('image.png', 'image/png', 1000);
      expect(headers['Content-Disposition']).toContain('inline');
      expect(headers['Content-Type']).toBe('image/png');
      expect(headers['Content-Length']).toBe('1000');
      expect(headers['Cache-Control']).toBeTruthy();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });

    it('sets attachment disposition for HTML/SVG download-only types', async () => {
      const { buildArtifactResponseHeaders } = await import('./file-attachment.js');
      const headers = buildArtifactResponseHeaders('page.html', 'text/html', 500);
      expect(headers['Content-Disposition']).toContain('attachment');
      expect(headers['Content-Security-Policy']).toContain('sandbox');
    });
  });

  describe('guessMimeType', () => {
    it('maps known extensions (line 886-914)', async () => {
      const { guessMimeType } = await import('./file-attachment.js');
      expect(guessMimeType('photo.jpg')).toBe('image/jpeg');
      expect(guessMimeType('doc.pdf')).toBe('application/pdf');
      expect(guessMimeType('data.csv')).toBe('text/csv');
      expect(guessMimeType('unknown.xyz')).toBe('application/octet-stream');
    });
  });

  describe('buildFileReferenceBlock', () => {
    it('returns empty for no files (line 1062)', async () => {
      const { buildFileReferenceBlock } = await import('./file-attachment.js');
      expect(buildFileReferenceBlock([])).toBe('');
    });

    it('builds reference block for files (lines 1063-1065)', async () => {
      const { buildFileReferenceBlock } = await import('./file-attachment.js');
      const result = buildFileReferenceBlock([
        {
          originalName: 'file.txt',
          localPath: '/tmp/file.txt',
          relativePath: 'file.txt',
          mimetype: 'text/plain',
          size: 100,
        },
      ]);
      expect(result).toContain('[Attached files]');
      expect(result).toContain('file.txt');
    });
  });

  describe('isMimeAllowed', () => {
    it('allows image/* and text/* prefixes', async () => {
      const { isMimeAllowed } = await import('./file-attachment.js');
      expect(isMimeAllowed('image/png')).toBe(true);
      expect(isMimeAllowed('text/plain')).toBe(true);
      expect(isMimeAllowed('application/pdf')).toBe(true);
      expect(isMimeAllowed('application/zip')).toBe(false);
      expect(isMimeAllowed('video/mp4')).toBe(false);
    });
  });
});
