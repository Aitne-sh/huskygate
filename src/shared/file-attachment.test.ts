import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENTS_SUBDIR,
  type DownloadedFile,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_FILE_SIZE_BYTES,
  OUTPUT_SUBDIR,
  type SlackFileInfo,
  buildFileReferenceBlock,
  detectImageFormat,
  downloadFiles,
  extractSlackFiles,
  formatFileSize,
  isMimeAllowed,
  normalizeImage,
  sanitizeFilename,
  saveLocalFile,
  scanOutputFiles,
  validateFile,
} from './file-attachment.js';

// ---------------------------------------------------------------------------
// extractSlackFiles
// ---------------------------------------------------------------------------

describe('extractSlackFiles', () => {
  it('extracts valid files from raw event data', () => {
    const raw = [
      {
        id: 'F1',
        name: 'screenshot.png',
        mimetype: 'image/png',
        size: 1024,
        url_private_download: 'https://files.slack.com/F1/download',
      },
    ];
    const result = extractSlackFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'F1',
      name: 'screenshot.png',
      mimetype: 'image/png',
      size: 1024,
      urlPrivateDownload: 'https://files.slack.com/F1/download',
    });
  });

  it('falls back to url_private when url_private_download is missing', () => {
    const raw = [
      {
        id: 'F2',
        name: 'data.csv',
        mimetype: 'text/csv',
        size: 512,
        url_private: 'https://files.slack.com/F2/private',
      },
    ];
    const result = extractSlackFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.urlPrivateDownload).toBe('https://files.slack.com/F2/private');
  });

  it('returns empty array for empty input', () => {
    expect(extractSlackFiles([])).toEqual([]);
  });

  it('skips non-object entries', () => {
    expect(extractSlackFiles([null, undefined, 42, 'string'])).toEqual([]);
  });

  it('skips entries missing id or download URL', () => {
    const raw = [
      {
        id: '',
        name: 'bad.txt',
        mimetype: 'text/plain',
        size: 10,
        url_private_download: 'https://x',
      },
      { id: 'F3', name: 'bad2.txt', mimetype: 'text/plain', size: 10 },
    ];
    expect(extractSlackFiles(raw)).toEqual([]);
  });

  it('skips entries when id is not a string', () => {
    const raw = [
      {
        id: 1234,
        name: 'bad-id.txt',
        mimetype: 'text/plain',
        size: 10,
        url_private_download: 'https://x',
      },
      {
        id: 'F6',
        name: 'good-id.txt',
        mimetype: 'text/plain',
        size: 10,
        url_private_download: 'https://x',
      },
    ];
    const result = extractSlackFiles(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('F6');
  });

  it('uses fallback name when name is missing', () => {
    const raw = [
      { id: 'F4', mimetype: 'text/plain', size: 100, url_private_download: 'https://x' },
    ];
    const result = extractSlackFiles(raw);
    expect(result[0]?.name).toBe('file_F4');
  });

  it('handles missing mimetype and size gracefully', () => {
    const raw = [{ id: 'F5', name: 'test.bin', url_private_download: 'https://x' }];
    const result = extractSlackFiles(raw);
    expect(result[0]?.mimetype).toBe('');
    expect(result[0]?.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isMimeAllowed
// ---------------------------------------------------------------------------

describe('isMimeAllowed', () => {
  it('allows image types', () => {
    expect(isMimeAllowed('image/png')).toBe(true);
    expect(isMimeAllowed('image/jpeg')).toBe(true);
    expect(isMimeAllowed('image/gif')).toBe(true);
    expect(isMimeAllowed('image/webp')).toBe(true);
    expect(isMimeAllowed('image/svg+xml')).toBe(true);
  });

  it('allows text types', () => {
    expect(isMimeAllowed('text/plain')).toBe(true);
    expect(isMimeAllowed('text/csv')).toBe(true);
    expect(isMimeAllowed('text/html')).toBe(true);
    expect(isMimeAllowed('text/markdown')).toBe(true);
  });

  it('allows specific application types', () => {
    expect(isMimeAllowed('application/pdf')).toBe(true);
    expect(isMimeAllowed('application/json')).toBe(true);
    expect(isMimeAllowed('application/xml')).toBe(true);
    expect(isMimeAllowed('application/x-yaml')).toBe(true);
    expect(isMimeAllowed('application/javascript')).toBe(true);
  });

  it('allows Office MIME types', () => {
    expect(
      isMimeAllowed('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    ).toBe(true);
    expect(
      isMimeAllowed('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe(true);
    expect(isMimeAllowed('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(
      true,
    );
    expect(isMimeAllowed('application/vnd.ms-powerpoint')).toBe(true);
    expect(isMimeAllowed('application/vnd.ms-excel')).toBe(true);
    expect(isMimeAllowed('application/msword')).toBe(true);
  });

  it('rejects blocked types', () => {
    expect(isMimeAllowed('application/octet-stream')).toBe(false);
    expect(isMimeAllowed('application/zip')).toBe(false);
    expect(isMimeAllowed('application/x-executable')).toBe(false);
    expect(isMimeAllowed('video/mp4')).toBe(false);
    expect(isMimeAllowed('audio/mpeg')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isMimeAllowed('Image/PNG')).toBe(true);
    expect(isMimeAllowed('TEXT/PLAIN')).toBe(true);
    expect(isMimeAllowed('Application/PDF')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectImageFormat
// ---------------------------------------------------------------------------

describe('detectImageFormat', () => {
  it('detects JPEG magic number', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    expect(detectImageFormat(buf)).toBe('jpeg');
  });

  it('detects PNG magic number', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    expect(detectImageFormat(buf)).toBe('png');
  });

  it('detects GIF magic number', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x47;
    buf[1] = 0x49;
    buf[2] = 0x46;
    buf[3] = 0x38;
    expect(detectImageFormat(buf)).toBe('gif');
  });

  it('detects WebP magic number', () => {
    const buf = Buffer.alloc(12);
    // RIFF
    buf[0] = 0x52;
    buf[1] = 0x49;
    buf[2] = 0x46;
    buf[3] = 0x46;
    // WEBP at offset 8
    buf[8] = 0x57;
    buf[9] = 0x45;
    buf[10] = 0x42;
    buf[11] = 0x50;
    expect(detectImageFormat(buf)).toBe('webp');
  });

  it('detects HEIC (ftyp + heic brand)', () => {
    const buf = Buffer.alloc(12);
    // ftyp at offset 4
    buf.write('ftyp', 4, 'ascii');
    // heic brand at offset 8
    buf.write('heic', 8, 'ascii');
    expect(detectImageFormat(buf)).toBe('heic');
  });

  it('detects HEIC (ftyp + heix brand)', () => {
    const buf = Buffer.alloc(12);
    buf.write('ftyp', 4, 'ascii');
    buf.write('heix', 8, 'ascii');
    expect(detectImageFormat(buf)).toBe('heic');
  });

  it('detects HEIF (ftyp + mif1 brand)', () => {
    const buf = Buffer.alloc(12);
    buf.write('ftyp', 4, 'ascii');
    buf.write('mif1', 8, 'ascii');
    expect(detectImageFormat(buf)).toBe('heif');
  });

  it('detects HEIF (ftyp + msf1 brand)', () => {
    const buf = Buffer.alloc(12);
    buf.write('ftyp', 4, 'ascii');
    buf.write('msf1', 8, 'ascii');
    expect(detectImageFormat(buf)).toBe('heif');
  });

  it('detects TIFF little-endian', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x49;
    buf[1] = 0x49;
    buf[2] = 0x2a;
    buf[3] = 0x00;
    expect(detectImageFormat(buf)).toBe('tiff');
  });

  it('detects TIFF big-endian', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x4d;
    buf[1] = 0x4d;
    buf[2] = 0x00;
    buf[3] = 0x2a;
    expect(detectImageFormat(buf)).toBe('tiff');
  });

  it('detects BMP', () => {
    const buf = Buffer.alloc(12);
    buf[0] = 0x42;
    buf[1] = 0x4d;
    expect(detectImageFormat(buf)).toBe('bmp');
  });

  it('detects HEIC via compatible brands when major brand is isom', () => {
    // Simulate: box_size=36, ftyp, major=isom, minor_version=0, compat=[isom, heic]
    const buf = Buffer.alloc(36, 0);
    buf.writeUInt32BE(36, 0); // box size
    buf.write('ftyp', 4, 'ascii');
    buf.write('isom', 8, 'ascii'); // major brand (not in HEIF_BRANDS)
    // minor version at 12-15 (zeros)
    buf.write('isom', 16, 'ascii'); // compatible brand 1
    buf.write('heic', 20, 'ascii'); // compatible brand 2 → detected!
    expect(detectImageFormat(buf)).toBe('heic');
  });

  it('detects HEIF via compatible brands when major brand is mp41', () => {
    const buf = Buffer.alloc(28, 0);
    buf.writeUInt32BE(28, 0);
    buf.write('ftyp', 4, 'ascii');
    buf.write('mp41', 8, 'ascii'); // major brand (not in HEIF_BRANDS)
    buf.write('mif1', 16, 'ascii'); // compatible brand → HEIF
    expect(detectImageFormat(buf)).toBe('heif');
  });

  it('falls back to heic for ftyp with unrecognised brands', () => {
    // ftyp present but no recognized brand → still ISO BMFF, treat as HEIC
    const buf = Buffer.alloc(20, 0);
    buf.writeUInt32BE(20, 0);
    buf.write('ftyp', 4, 'ascii');
    buf.write('isom', 8, 'ascii');
    buf.write('iso2', 16, 'ascii');
    expect(detectImageFormat(buf)).toBe('heic');
  });

  it('returns unknown for unrecognised bytes', () => {
    const buf = Buffer.alloc(12, 0x00);
    expect(detectImageFormat(buf)).toBe('unknown');
  });

  it('returns unknown for buffer shorter than 12 bytes', () => {
    const buf = Buffer.alloc(4);
    expect(detectImageFormat(buf)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// normalizeImage
// ---------------------------------------------------------------------------

vi.mock('sharp', () => {
  const mockSharp = vi.fn((inputPath: string, _opts?: unknown) => {
    // Read the input file to produce some output
    const inputData = fs.readFileSync(inputPath);
    return {
      rotate: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from(`normalized-${inputData.length}`)),
    };
  });
  return { default: mockSharp };
});

describe('normalizeImage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes through non-image files unchanged', async () => {
    const filePath = path.join(tmpDir, 'data.csv');
    fs.writeFileSync(filePath, 'a,b,c');
    const file: DownloadedFile = {
      originalName: 'data.csv',
      localPath: filePath,
      relativePath: 'data.csv',
      mimetype: 'text/csv',
      size: 5,
    };

    const result = await normalizeImage(file, tmpDir);
    expect(result).toBe(file); // same reference — untouched
  });

  it('passes through SVG files unchanged', async () => {
    const filePath = path.join(tmpDir, 'icon.svg');
    fs.writeFileSync(filePath, '<svg></svg>');
    const file: DownloadedFile = {
      originalName: 'icon.svg',
      localPath: filePath,
      relativePath: 'icon.svg',
      mimetype: 'image/svg+xml',
      size: 11,
    };

    const result = await normalizeImage(file, tmpDir);
    expect(result).toBe(file);
  });

  it('converts HEIC bytes disguised as .jpg to JPEG (primary use case)', async () => {
    // Simulate iOS HEIC file with .jpg extension
    const filePath = path.join(tmpDir, 'IMG_1234.jpg');
    const heicHeader = Buffer.alloc(64, 0);
    heicHeader.write('ftyp', 4, 'ascii');
    heicHeader.write('heic', 8, 'ascii');
    fs.writeFileSync(filePath, heicHeader);

    const file: DownloadedFile = {
      originalName: 'IMG_1234.jpg',
      localPath: filePath,
      relativePath: 'IMG_1234.jpg',
      mimetype: 'image/jpeg', // Slack lies about this
      size: 64,
    };

    const result = await normalizeImage(file, tmpDir);
    expect(result.mimetype).toBe('image/jpeg');
    expect(result.localPath).toContain('.jpg');
    // sharp was called → output is "normalized-64"
    expect(result.size).toBe(Buffer.from('normalized-64').length);
  });

  it('re-encodes PNG images (EXIF fix)', async () => {
    const filePath = path.join(tmpDir, 'screenshot.png');
    const pngHeader = Buffer.alloc(64, 0);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    fs.writeFileSync(filePath, pngHeader);

    const file: DownloadedFile = {
      originalName: 'screenshot.png',
      localPath: filePath,
      relativePath: 'screenshot.png',
      mimetype: 'image/png',
      size: 64,
    };

    const result = await normalizeImage(file, tmpDir);
    expect(result.mimetype).toBe('image/jpeg');
    // Extension changed from .png to .jpg
    expect(result.localPath.endsWith('.jpg')).toBe(true);
    expect(result.relativePath.endsWith('.jpg')).toBe(true);
    // Old .png file should be removed
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('keeps .jpg extension for JPEG files', async () => {
    const filePath = path.join(tmpDir, 'photo.jpg');
    const jpegHeader = Buffer.alloc(64, 0);
    jpegHeader[0] = 0xff;
    jpegHeader[1] = 0xd8;
    jpegHeader[2] = 0xff;
    fs.writeFileSync(filePath, jpegHeader);

    const file: DownloadedFile = {
      originalName: 'photo.jpg',
      localPath: filePath,
      relativePath: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 64,
    };

    const result = await normalizeImage(file, tmpDir);
    expect(result.localPath).toBe(filePath); // same path
    expect(result.mimetype).toBe('image/jpeg');
  });

  it('returns original file when sharp fails on non-HEIC image', async () => {
    const { default: sharpMock } = await import('sharp');
    const mockedSharp = vi.mocked(sharpMock);
    mockedSharp.mockImplementationOnce(
      () =>
        ({
          rotate: vi.fn().mockReturnThis(),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockRejectedValue(new Error('corrupt image')),
        }) as never,
    );

    const filePath = path.join(tmpDir, 'broken.png');
    const pngHeader = Buffer.alloc(64, 0);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    fs.writeFileSync(filePath, pngHeader);

    const file: DownloadedFile = {
      originalName: 'broken.png',
      localPath: filePath,
      relativePath: 'broken.png',
      mimetype: 'image/png',
      size: 64,
    };

    const result = await normalizeImage(file, tmpDir);
    // Non-HEIC failure → returns original file
    expect(result).toBe(file);
  });

  it('throws when sharp fails on HEIC image', async () => {
    const { default: sharpMock } = await import('sharp');
    const mockedSharp = vi.mocked(sharpMock);
    mockedSharp.mockImplementationOnce(
      () =>
        ({
          rotate: vi.fn().mockReturnThis(),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockRejectedValue(new Error('heic decode error')),
        }) as never,
    );

    const filePath = path.join(tmpDir, 'IMG_5678.jpg');
    const heicHeader = Buffer.alloc(64, 0);
    heicHeader.write('ftyp', 4, 'ascii');
    heicHeader.write('heic', 8, 'ascii');
    fs.writeFileSync(filePath, heicHeader);

    const file: DownloadedFile = {
      originalName: 'IMG_5678.jpg',
      localPath: filePath,
      relativePath: 'IMG_5678.jpg',
      mimetype: 'image/jpeg',
      size: 64,
    };

    await expect(normalizeImage(file, tmpDir)).rejects.toThrow('Unable to process HEIC image');
  });

  it('throws when sharp fails on unknown format (e.g. HTML disguised as image)', async () => {
    const { default: sharpMock } = await import('sharp');
    const mockedSharp = vi.mocked(sharpMock);
    mockedSharp.mockImplementationOnce(
      () =>
        ({
          rotate: vi.fn().mockReturnThis(),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi
            .fn()
            .mockRejectedValue(new Error('Input file contains unsupported image format')),
        }) as never,
    );

    const filePath = path.join(tmpDir, 'IMG_1234.jpg');
    // HTML content (e.g. Slack auth redirect page)
    fs.writeFileSync(filePath, '<!DOCTYPE html><html><body>Login required</body></html>');

    const file: DownloadedFile = {
      originalName: 'IMG_1234.jpg',
      localPath: filePath,
      relativePath: 'IMG_1234.jpg',
      mimetype: 'image/jpeg',
      size: 100,
    };

    await expect(normalizeImage(file, tmpDir)).rejects.toThrow('Image file is corrupted');
  });
});

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('returns name unchanged for safe filenames', () => {
    expect(sanitizeFilename('screenshot.png')).toBe('screenshot.png');
    expect(sanitizeFilename('data-file_v2.csv')).toBe('data-file_v2.csv');
  });

  it('strips path separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFilename('foo/bar\\baz.txt')).toBe('foo_bar_baz.txt');
  });

  it('removes .. sequences', () => {
    expect(sanitizeFilename('..file..name.txt')).toBe('file_name.txt');
  });

  it('replaces non-ASCII characters', () => {
    expect(sanitizeFilename('file\u3042name.txt')).toBe('file_name.txt');
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizeFilename('a___b.txt')).toBe('a_b.txt');
  });

  it('trims leading/trailing underscores and dots', () => {
    expect(sanitizeFilename('___file.txt')).toBe('file.txt');
    expect(sanitizeFilename('file.txt...')).toBe('file.txt');
  });

  it('returns "attachment" for empty or invalid names', () => {
    expect(sanitizeFilename('')).toBe('attachment');
    expect(sanitizeFilename('...')).toBe('attachment');
    expect(sanitizeFilename('___')).toBe('attachment');
  });

  it('truncates long filenames preserving extension', () => {
    const longName = `${'a'.repeat(250)}.png`;
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('truncates long filenames without extension', () => {
    const longName = 'a'.repeat(250);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512B');
    expect(formatFileSize(0)).toBe('0B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1KB');
    expect(formatFileSize(245 * 1024)).toBe('245KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0MB');
    expect(formatFileSize(3.2 * 1024 * 1024)).toBe('3.2MB');
  });
});

// ---------------------------------------------------------------------------
// validateFile
// ---------------------------------------------------------------------------

describe('validateFile', () => {
  const validFile: SlackFileInfo = {
    id: 'F1',
    name: 'test.png',
    mimetype: 'image/png',
    size: 1024,
    urlPrivateDownload: 'https://example.com',
  };

  it('returns null for valid files', () => {
    expect(validateFile(validFile, 0)).toBeNull();
  });

  it('rejects files exceeding max size', () => {
    const large = { ...validFile, size: MAX_FILE_SIZE_BYTES + 1 };
    const err = validateFile(large, 0);
    expect(err).not.toBeNull();
    expect(err?.reason).toContain('too large');
  });

  it('rejects when total size would exceed limit', () => {
    const err = validateFile(
      { ...validFile, size: 10 * 1024 * 1024 },
      MAX_TOTAL_FILE_SIZE_BYTES - 1,
    );
    expect(err).not.toBeNull();
    expect(err?.reason).toContain('Total attachment size');
  });

  it('rejects non-allowed MIME types', () => {
    const blocked = { ...validFile, mimetype: 'application/zip' };
    const err = validateFile(blocked, 0);
    expect(err).not.toBeNull();
    expect(err?.reason).toContain('not allowed');
  });
});

// ---------------------------------------------------------------------------
// saveLocalFile
// ---------------------------------------------------------------------------

describe('saveLocalFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-local-file-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes non-image files to the attachments directory', async () => {
    const file = await saveLocalFile(
      Buffer.from('hello'),
      'report.txt',
      'text/plain',
      tmpDir,
      'dash_1',
    );

    expect(file.originalName).toBe('report.txt');
    expect(file.mimetype).toBe('text/plain');
    expect(file.size).toBe(5);
    expect(file.relativePath).toContain(`${ATTACHMENTS_SUBDIR}/dash_1/report.txt`);
    expect(fs.existsSync(file.localPath)).toBe(true);
  });

  it('rejects files larger than MAX_FILE_SIZE_BYTES', async () => {
    await expect(
      saveLocalFile(
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
        'large.bin',
        'text/plain',
        tmpDir,
        'dash_2',
      ),
    ).rejects.toThrow('File too large');
  });

  it('rejects disallowed MIME types', async () => {
    await expect(
      saveLocalFile(Buffer.from('zip'), 'archive.zip', 'application/zip', tmpDir, 'dash_3'),
    ).rejects.toThrow('File type not allowed: application/zip');
  });

  it('rejects spoofed raster images whose magic bytes are unknown', async () => {
    await expect(
      saveLocalFile(
        Buffer.from('not-a-real-image'),
        'fake.png',
        'image/png',
        tmpDir,
        'dash_fake_png',
      ),
    ).rejects.toThrow('Image file is corrupted or in an unsupported format: fake.png');

    expect(fs.existsSync(path.join(tmpDir, ATTACHMENTS_SUBDIR, 'dash_fake_png'))).toBe(false);
  });

  it('allows SVG uploads without raster magic-byte validation', async () => {
    const file = await saveLocalFile(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'vector.svg',
      'image/svg+xml',
      tmpDir,
      'dash_svg',
    );

    expect(file.mimetype).toBe('image/svg+xml');
    expect(file.originalName).toBe('vector.svg');
    expect(fs.existsSync(file.localPath)).toBe(true);
  });

  it('removes the written file when image normalization fails', async () => {
    const sharpMod = await import('sharp');
    const sharpMock = sharpMod.default as unknown as ReturnType<typeof vi.fn>;
    sharpMock.mockImplementationOnce(() => {
      throw new Error('sharp failure');
    });

    await expect(
      saveLocalFile(
        Buffer.from('invalid-image-bytes'),
        'broken.png',
        'image/png',
        tmpDir,
        'dash_4',
      ),
    ).rejects.toThrow('Image file is corrupted or in an unsupported format');

    const attachDir = path.join(tmpDir, ATTACHMENTS_SUBDIR, 'dash_4');
    if (fs.existsSync(attachDir)) {
      expect(fs.readdirSync(attachDir)).toEqual([]);
    }
  });

  it('ignores cleanup unlink errors and rethrows the original normalization error', async () => {
    const sharpMod = await import('sharp');
    const sharpMock = sharpMod.default as unknown as ReturnType<typeof vi.fn>;
    sharpMock.mockImplementationOnce(() => {
      throw new Error('sharp failure');
    });
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      throw new Error('unlink failed');
    });
    const heicHeader = Buffer.alloc(64, 0);
    heicHeader.write('ftyp', 4, 'ascii');
    heicHeader.write('heic', 8, 'ascii');

    await expect(
      saveLocalFile(heicHeader, 'broken-again.png', 'image/png', tmpDir, 'dash_5'),
    ).rejects.toThrow('Unable to process HEIC image. Please convert to JPEG/PNG before sending.');

    expect(unlinkSpy).toHaveBeenCalledOnce();
    unlinkSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// buildFileReferenceBlock
// ---------------------------------------------------------------------------

describe('buildFileReferenceBlock', () => {
  it('returns empty string for no files', () => {
    expect(buildFileReferenceBlock([])).toBe('');
  });

  it('builds formatted reference block', () => {
    const files: DownloadedFile[] = [
      {
        originalName: 'screenshot.png',
        localPath: '/tmp/work/_attachments/abc/screenshot.png',
        relativePath: '_attachments/abc/screenshot.png',
        mimetype: 'image/png',
        size: 245 * 1024,
      },
      {
        originalName: 'data.csv',
        localPath: '/tmp/work/_attachments/abc/data.csv',
        relativePath: '_attachments/abc/data.csv',
        mimetype: 'text/csv',
        size: 12 * 1024,
      },
    ];

    const result = buildFileReferenceBlock(files);
    expect(result).toContain('[Attached files]');
    expect(result).toContain('- _attachments/abc/screenshot.png (image/png, 245KB)');
    expect(result).toContain('- _attachments/abc/data.csv (text/csv, 12KB)');
  });
});

// ---------------------------------------------------------------------------
// scanOutputFiles
// ---------------------------------------------------------------------------

describe('scanOutputFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-output-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when _output/ does not exist', () => {
    expect(scanOutputFiles(tmpDir)).toEqual([]);
  });

  it('returns OutputFile[] for files in _output/', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    fs.writeFileSync(path.join(outputDir, 'result.svg'), '<svg></svg>');

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe('result.svg');
    expect(result[0]?.localPath).toBe(path.join(outputDir, 'result.svg'));
    expect(result[0]?.size).toBeGreaterThan(0);
  });

  it('excludes dot files', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    fs.writeFileSync(path.join(outputDir, '.hidden'), 'secret');
    fs.writeFileSync(path.join(outputDir, 'visible.txt'), 'hello');

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe('visible.txt');
  });

  it('excludes empty files', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    fs.writeFileSync(path.join(outputDir, 'empty.txt'), '');
    fs.writeFileSync(path.join(outputDir, 'notempty.txt'), 'data');

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe('notempty.txt');
  });

  it('excludes subdirectories', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    fs.mkdirSync(path.join(outputDir, 'subdir'));
    fs.writeFileSync(path.join(outputDir, 'file.txt'), 'content');

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe('file.txt');
  });

  it('truncates at MAX_OUTPUT_FILES (10)', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    for (let i = 0; i < 15; i++) {
      fs.writeFileSync(path.join(outputDir, `file_${String(i).padStart(2, '0')}.txt`), `data${i}`);
    }

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(10);
  });

  it('excludes files larger than 50 MB', () => {
    const outputDir = path.join(tmpDir, OUTPUT_SUBDIR);
    fs.mkdirSync(outputDir);
    // Create a small valid file
    fs.writeFileSync(path.join(outputDir, 'small.txt'), 'ok');
    // Stub statSync to report huge size for the oversized file
    const oversizedPath = path.join(outputDir, 'huge.bin');
    fs.writeFileSync(oversizedPath, 'x');
    const origStatSync = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((p, opts) => {
      const stat = origStatSync(p as string, opts as undefined);
      if (String(p) === oversizedPath) {
        return { ...stat, size: 60 * 1024 * 1024 } as fs.Stats;
      }
      return stat;
    });

    const result = scanOutputFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.filename).toBe('small.txt');
  });
});

// ---------------------------------------------------------------------------
// downloadFiles (with fetch mock)
// ---------------------------------------------------------------------------

describe('downloadFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-attach-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads files successfully', async () => {
    const fileContent = Buffer.from('hello world');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          fileContent.buffer.slice(
            fileContent.byteOffset,
            fileContent.byteOffset + fileContent.byteLength,
          ),
        ),
    });
    vi.stubGlobal('fetch', mockFetch);

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'test.txt',
        mimetype: 'text/plain',
        size: 11,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job1', 'xoxb-token');

    expect(result.downloaded).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.downloaded[0]?.relativePath).toBe(
      path.join(ATTACHMENTS_SUBDIR, 'job1', 'test.txt'),
    );

    const firstDownloaded = result.downloaded[0] as NonNullable<(typeof result.downloaded)[0]>;
    const savedContent = fs.readFileSync(firstDownloaded.localPath);
    expect(savedContent.toString()).toBe('hello world');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://files.slack.com/F1/download',
      expect.objectContaining({
        headers: { Authorization: 'Bearer xoxb-token' },
        redirect: 'manual',
      }),
    );

    vi.unstubAllGlobals();
  });

  it('returns empty result for empty files array', async () => {
    const result = await downloadFiles([], tmpDir, 'job1', 'xoxb-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('detects HTML redirect response from Slack (auth failure)', async () => {
    const htmlContent = Buffer.from('<!DOCTYPE html><html><body>Login</body></html>');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: () =>
          Promise.resolve(
            htmlContent.buffer.slice(
              htmlContent.byteOffset,
              htmlContent.byteOffset + htmlContent.byteLength,
            ),
          ),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'presentation.pptx',
        mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: 1024,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
      {
        id: 'F2',
        name: 'IMG_1234.jpg',
        mimetype: 'image/jpeg',
        size: 2048,
        urlPrivateDownload: 'https://files.slack.com/F2/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-html', 'xoxb-bad-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.reason).toContain('authentication page');
    expect(result.errors[1]?.reason).toContain('authentication page');
    expect(result.errors[0]?.userReason).toBe('Failed to download file from Slack.');
    expect(result.errors[1]?.userReason).toBe('Failed to download file from Slack.');

    vi.unstubAllGlobals();
  });

  it('follows cross-origin redirects with Authorization header preserved', async () => {
    const fileContent = Buffer.from('real file data');
    const mockFetch = vi
      .fn()
      // First call: redirect
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'https://edge-xxx.slack-files.com/actual-file' }),
      })
      // Second call: actual file
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        arrayBuffer: () =>
          Promise.resolve(
            fileContent.buffer.slice(
              fileContent.byteOffset,
              fileContent.byteOffset + fileContent.byteLength,
            ),
          ),
      });
    vi.stubGlobal('fetch', mockFetch);

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'photo.txt',
        mimetype: 'text/plain',
        size: 14,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-redirect', 'xoxb-token');

    expect(result.downloaded).toHaveLength(1);
    expect(result.errors).toHaveLength(0);

    // First call: original URL with manual redirect
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://files.slack.com/F1/download',
      expect.objectContaining({
        headers: { Authorization: 'Bearer xoxb-token' },
        redirect: 'manual',
      }),
    );

    // Second call: redirect target with Authorization preserved
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://edge-xxx.slack-files.com/actual-file',
      expect.objectContaining({
        headers: { Authorization: 'Bearer xoxb-token' },
        redirect: 'manual',
      }),
    );

    vi.unstubAllGlobals();
  });

  it('fails on too many redirects', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'https://edge-1.slack-files.com/redirect' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'loop.txt',
        mimetype: 'text/plain',
        size: 10,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-loop', 'xoxb-token');

    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('Too many redirects');

    vi.unstubAllGlobals();
  });

  it('skips files that fail validation', async () => {
    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'huge.bin',
        mimetype: 'image/png',
        size: MAX_FILE_SIZE_BYTES + 1,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job1', 'xoxb-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('too large');
  });

  it('reports HTTP errors gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'forbidden.png',
        mimetype: 'image/png',
        size: 100,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job1', 'xoxb-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('HTTP 403');

    vi.unstubAllGlobals();
  });

  it('reports fetch exceptions gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'fail.png',
        mimetype: 'image/png',
        size: 100,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job1', 'xoxb-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('network error');

    vi.unstubAllGlobals();
  });

  it('handles AbortError for timeouts', async () => {
    const abortError = new DOMException('signal is aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'slow.png',
        mimetype: 'image/png',
        size: 100,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job1', 'xoxb-token');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toBe('Download timed out');

    vi.unstubAllGlobals();
  });

  it('handles filename collisions with _N suffix', async () => {
    const fileContent = Buffer.from('data');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            fileContent.buffer.slice(
              fileContent.byteOffset,
              fileContent.byteOffset + fileContent.byteLength,
            ),
          ),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'report.txt',
        mimetype: 'text/plain',
        size: 4,
        urlPrivateDownload: 'https://files.slack.com/F1',
      },
      {
        id: 'F2',
        name: 'report.txt',
        mimetype: 'text/plain',
        size: 4,
        urlPrivateDownload: 'https://files.slack.com/F2',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job2', 'xoxb-token');
    expect(result.downloaded).toHaveLength(2);
    const fileNames = result.downloaded.map((f) => f.relativePath.split('/').pop());
    expect(fileNames).toEqual(expect.arrayContaining(['report.txt', 'report_1.txt']));

    vi.unstubAllGlobals();
  });

  it('continues downloading remaining files when one fails', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        const content = Buffer.from('ok');
        return Promise.resolve({
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
            ),
        });
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'fail.txt',
        mimetype: 'text/plain',
        size: 10,
        urlPrivateDownload: 'https://files.slack.com/F1',
      },
      {
        id: 'F2',
        name: 'ok.txt',
        mimetype: 'text/plain',
        size: 2,
        urlPrivateDownload: 'https://files.slack.com/F2',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job3', 'xoxb-token');
    expect(result.downloaded).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.downloaded[0]?.originalName).toBe('ok.txt');
    expect(result.errors[0]?.fileName).toBe('fail.txt');

    vi.unstubAllGlobals();
  });

  it('catches normalizeImage failure and cleans up the file', async () => {
    // Make sharp throw for this HEIC image (simulates corrupt HEIC)
    const { default: sharpMock } = await import('sharp');
    const mockedSharp = vi.mocked(sharpMock);
    mockedSharp.mockImplementationOnce(
      () =>
        ({
          rotate: vi.fn().mockReturnThis(),
          jpeg: vi.fn().mockReturnThis(),
          toBuffer: vi.fn().mockRejectedValue(new Error('heic decode error')),
        }) as never,
    );

    // Craft a HEIC file header so normalizeImage detects it as HEIC and throws
    const heicContent = Buffer.alloc(64, 0);
    heicContent.write('ftyp', 4, 'ascii');
    heicContent.write('heic', 8, 'ascii');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            heicContent.buffer.slice(
              heicContent.byteOffset,
              heicContent.byteOffset + heicContent.byteLength,
            ),
          ),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F1',
        name: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: 64,
        urlPrivateDownload: 'https://files.slack.com/F1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-norm', 'xoxb-token');
    expect(result.downloaded).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('HEIC');

    vi.unstubAllGlobals();
  });

  it('rejects file content that exceeds MAX_FILE_SIZE_BYTES even when metadata is small', async () => {
    const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 1);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: () =>
          Promise.resolve(
            oversized.buffer.slice(
              oversized.byteOffset,
              oversized.byteOffset + oversized.byteLength,
            ),
          ),
      }),
    );

    const files: SlackFileInfo[] = [
      {
        id: 'F-size-1',
        name: 'small-meta.bin',
        mimetype: 'text/plain',
        size: 1,
        urlPrivateDownload: 'https://files.slack.com/F-size-1/download',
      },
    ];

    const result = await downloadFiles(files, tmpDir, 'job-size-limit', 'xoxb-token');
    expect(result.downloaded).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('File too large');

    vi.unstubAllGlobals();
  });
});
