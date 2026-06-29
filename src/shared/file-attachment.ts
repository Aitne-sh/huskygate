/** @module file-attachment — Slack file download, validation, image normalisation, artifact archiving, and safe serving */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { errorMessage } from '../utils/error.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { logger } from '../utils/logger.js';
import { RETRY_LIMITS, SIZE_LIMITS, TIMEOUTS, TTLS } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackFileInfo {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  urlPrivateDownload: string;
}

export interface DownloadedFile {
  originalName: string;
  localPath: string;
  relativePath: string;
  mimetype: string;
  size: number;
}

export interface FileAttachmentError {
  fileName: string;
  reason: string;
  userReason?: string;
}

export interface FileAttachmentResult {
  downloaded: DownloadedFile[];
  errors: FileAttachmentError[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_FILE_SIZE_BYTES = SIZE_LIMITS.maxFileSize;
export const MAX_TOTAL_FILE_SIZE_BYTES = SIZE_LIMITS.maxTotalFileSize;
const DOWNLOAD_TIMEOUT_MS = TIMEOUTS.download;
export const ATTACHMENTS_SUBDIR = '_attachments';
export const OUTPUT_SUBDIR = '_output';
const ARTIFACTS_SUBDIR = '_artifacts';
/** Maximum number of artifact files to upload per notification. Shared across all task types. */
export const MAX_FILE_UPLOADS = SIZE_LIMITS.maxFileUploads;
const MAX_FILENAME_LENGTH = SIZE_LIMITS.maxFilenameLength;

// ---------------------------------------------------------------------------
// MIME allow-list
// ---------------------------------------------------------------------------

const ALLOWED_MIME_PREFIXES = ['image/', 'text/'] as const;

const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/x-shellscript',
  'application/javascript',
  'application/typescript',
  'application/x-python-code',
  'application/x-ruby',
  'application/sql',
  'application/graphql',
  'application/x-httpd-php',
  'application/xhtml+xml',
  'application/toml',
  'application/x-toml',
  // Microsoft Office
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.ms-excel', // .xls
  'application/msword', // .doc
]);

export function isMimeAllowed(mimetype: string): boolean {
  const lower = mimetype.toLowerCase();
  for (const prefix of ALLOWED_MIME_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return ALLOWED_MIME_EXACT.has(lower);
}

// ---------------------------------------------------------------------------
// Image format detection (magic number)
// ---------------------------------------------------------------------------

export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'heif'
  | 'tiff'
  | 'bmp'
  | 'unknown';

/** HEIF brand codes that indicate HEIC/HEIF container */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/**
 * Check if a 4-byte brand string is a HEIC variant (vs HEIF).
 */
function isHeicBrand(brand: string): boolean {
  return brand.startsWith('hei') || brand.startsWith('hev');
}

/**
 * Detect actual image format from magic bytes.
 * Slack's reported mimetype/extension cannot be trusted (iOS HEIC → .jpg issue).
 *
 * Requires at least 12 bytes; pass more (e.g. 64) to improve HEIC detection
 * via compatible brand scanning in the ftyp box.
 */
export function detectImageFormat(buffer: Buffer): ImageFormat {
  if (buffer.length < 12) return 'unknown';

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }

  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'gif';
  }

  // WebP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  // HEIC/HEIF: ISO BMFF container — "ftyp" at offset 4-7
  // Structure: [4-byte box size][ftyp][major brand][minor version][compatible brands...]
  // Some iPhones use 'isom' as major brand with 'heic' only in compatible brands.
  if (
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  ) {
    // Check major brand at offset 8-11
    const majorBrand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (HEIF_BRANDS.has(majorBrand)) {
      return isHeicBrand(majorBrand) ? 'heic' : 'heif';
    }

    // Scan compatible brands (offset 16+ in the ftyp box)
    // Box size is big-endian uint32 at offset 0
    const boxSize = buffer.readUInt32BE(0);
    const scanEnd = Math.min(boxSize, buffer.length);
    for (let i = 16; i + 4 <= scanEnd; i += 4) {
      const compatBrand = buffer
        .subarray(i, i + 4)
        .toString('ascii')
        .toLowerCase();
      if (HEIF_BRANDS.has(compatBrand)) {
        return isHeicBrand(compatBrand) ? 'heic' : 'heif';
      }
    }

    // ftyp present but no recognized HEIF brand — still an ISO BMFF container.
    // No JPEG/PNG/GIF/WebP/BMP/TIFF ever has ftyp, so this is almost certainly
    // a HEIC/HEIF variant with an unusual brand. Treat as HEIC.
    return 'heic';
  }

  // TIFF: 49 49 2A 00 (little-endian) or 4D 4D 00 2A (big-endian)
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return 'tiff';
  }

  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'bmp';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Image normalisation (HEIC→JPEG, EXIF rotation fix)
// ---------------------------------------------------------------------------

/**
 * Normalise an image file:
 * - Detect actual format via magic bytes (Slack mimetype is unreliable)
 * - Convert HEIC/HEIF → JPEG via sharp
 * - Re-encode other images to fix EXIF rotation / header issues
 * - Non-image files pass through unchanged
 *
 * Throws on HEIC detection + conversion failure (caller should treat as error).
 * For non-HEIC failures, returns original file with a warning log.
 */
export async function normalizeImage(
  file: DownloadedFile,
  workdir: string,
): Promise<DownloadedFile> {
  // Skip non-image files
  if (!file.mimetype.toLowerCase().startsWith('image/')) {
    return file;
  }

  // SVG is not a raster format — skip
  if (file.mimetype.toLowerCase() === 'image/svg+xml') {
    return file;
  }

  // Read header to detect actual format (64 bytes for HEIC compatible brand scanning)
  const fh = await fsp.open(file.localPath, 'r');
  const header = Buffer.alloc(64);
  const { bytesRead } = await fh.read(header, 0, 64, 0);
  await fh.close();

  const actualFormat = detectImageFormat(header.subarray(0, bytesRead));
  const isHeic = actualFormat === 'heic' || actualFormat === 'heif';

  // Dynamic import of sharp (graceful failure if missing)
  interface SharpPipeline {
    rotate(): SharpPipeline;
    jpeg(opts?: { quality?: number }): SharpPipeline;
    toBuffer(): Promise<Buffer>;
  }
  let sharpFn: (input: string, options?: { failOn?: string }) => SharpPipeline;
  try {
    const mod = await import('sharp');
    sharpFn = mod.default as unknown as typeof sharpFn;
  } catch {
    if (isHeic) {
      throw new Error(
        'HEIC image detected but the conversion library (sharp) is not available. Please convert to JPEG/PNG before sending.',
      );
    }
    logger.warn('sharp_import_failed', { file: file.originalName });
    return file;
  }

  try {
    const outputBuffer = await sharpFn(file.localPath, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer();

    // Determine new path (change extension to .jpg if needed)
    const currentExt = path.extname(file.localPath).toLowerCase();
    let newPath = file.localPath;

    if (currentExt !== '.jpg' && currentExt !== '.jpeg') {
      newPath = `${file.localPath.slice(0, file.localPath.length - currentExt.length)}.jpg`;
    }

    fs.writeFileSync(newPath, outputBuffer);

    // Remove old file if path changed
    if (newPath !== file.localPath && fs.existsSync(file.localPath)) {
      fs.unlinkSync(file.localPath);
    }

    return {
      originalName: file.originalName,
      localPath: newPath,
      relativePath: path.relative(workdir, newPath),
      mimetype: 'image/jpeg',
      size: outputBuffer.length,
    };
  } catch (err) {
    if (isHeic) {
      throw new Error('Unable to process HEIC image. Please convert to JPEG/PNG before sending.');
    }
    if (actualFormat === 'unknown') {
      // File doesn't match any known image format AND sharp can't process it.
      // This often means Slack returned HTML/error page instead of the actual image.
      throw new Error(`Image file is corrupted or in an unsupported format: ${file.originalName}`);
    }
    logger.warn('image_normalize_failed', {
      file: file.originalName,
      error: errorMessage(err),
    });
    return file;
  }
}

// ---------------------------------------------------------------------------
// Filename sanitisation
// ---------------------------------------------------------------------------

export function sanitizeFilename(name: string): string {
  // Strip directory components (path traversal prevention)
  let sanitized = name.replace(/[/\\]/g, '_');
  // Remove .. sequences
  sanitized = sanitized.replace(/\.\./g, '_');
  // Replace non-ASCII and control characters with underscore
  sanitized = sanitized.replace(/[^\x20-\x7E]/g, '_');
  // Collapse consecutive underscores
  sanitized = sanitized.replace(/_+/g, '_');
  // Trim leading/trailing underscores and dots
  sanitized = sanitized.replace(/^[_. ]+|[_. ]+$/g, '');
  // Fallback for empty result
  if (!sanitized) {
    sanitized = 'attachment';
  }
  // Truncate to limit
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(sanitized);
    const base = sanitized.slice(0, MAX_FILENAME_LENGTH - ext.length);
    sanitized = base + ext;
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Extract SlackFileInfo from raw event files
// ---------------------------------------------------------------------------

export function extractSlackFiles(rawFiles: unknown[]): SlackFileInfo[] {
  const result: SlackFileInfo[] = [];
  for (const raw of rawFiles) {
    if (typeof raw !== 'object' || raw === null) continue;
    const file = raw as Record<string, unknown>;
    const id = typeof file.id === 'string' ? file.id : '';
    const name = typeof file.name === 'string' ? file.name : '';
    const mimetype = typeof file.mimetype === 'string' ? file.mimetype : '';
    const size = typeof file.size === 'number' ? file.size : 0;
    const urlPrivateDownload =
      typeof file.url_private_download === 'string'
        ? file.url_private_download
        : typeof file.url_private === 'string'
          ? file.url_private
          : '';
    if (!id || !urlPrivateDownload) continue;
    result.push({ id, name: name || `file_${id}`, mimetype, size, urlPrivateDownload });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validate a single file
// ---------------------------------------------------------------------------

export function validateFile(
  file: SlackFileInfo,
  currentTotalSize: number,
): FileAttachmentError | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      fileName: file.name,
      reason: `File too large (${formatFileSize(file.size)}, max ${formatFileSize(MAX_FILE_SIZE_BYTES)})`,
      userReason: `File too large (max ${formatFileSize(MAX_FILE_SIZE_BYTES)}).`,
    };
  }
  if (currentTotalSize + file.size > MAX_TOTAL_FILE_SIZE_BYTES) {
    return {
      fileName: file.name,
      reason: `Total attachment size would exceed ${formatFileSize(MAX_TOTAL_FILE_SIZE_BYTES)}`,
      userReason: `Total attachment size limit exceeded (max ${formatFileSize(MAX_TOTAL_FILE_SIZE_BYTES)}).`,
    };
  }
  if (!isMimeAllowed(file.mimetype)) {
    return {
      fileName: file.name,
      reason: `File type not allowed: ${file.mimetype}`,
      userReason: 'File type not supported.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fetch with auth-preserving redirect
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = RETRY_LIMITS.httpRedirects;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Domains allowed as download destinations.
 * Redirects to hosts outside this list are rejected to prevent SSRF.
 */
const ALLOWED_DOWNLOAD_DOMAINS = ['slack.com', 'slack-files.com'] as const;

function isAllowedDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_DOWNLOAD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function assertAllowedDownloadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid download URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Download URL must use https: ${parsed.protocol}`);
  }
  if (!isAllowedDownloadHost(parsed.hostname)) {
    throw new Error(`Download URL host is not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

function fileTooLargeError(maxBytes: number): Error {
  return new Error(`File too large (download exceeds ${formatFileSize(maxBytes)})`);
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = parseContentLength(response.headers?.get?.('content-length') ?? null);
  if (contentLength !== null && contentLength > maxBytes) {
    throw fileTooLargeError(maxBytes);
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw fileTooLargeError(maxBytes);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore cancellation errors */
      }
      throw fileTooLargeError(maxBytes);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

/**
 * Fetch that manually follows redirects so the Authorization header
 * is preserved across cross-origin hops.
 *
 * Node.js (and browsers) strip Authorization on cross-origin redirects
 * per the Fetch Standard.  Slack's url_private_download often redirects
 * to a different host (edge-xxx.slack-files.com), causing the header to
 * be silently dropped and Slack to return an HTML login page.
 */
async function fetchWithAuth(
  url: string,
  initialHeaders: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = assertAllowedDownloadUrl(url).toString();

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      headers: initialHeaders,
      signal,
      redirect: 'manual',
    });

    logger.info('fetch_with_auth_hop', {
      hop: i,
      url: currentUrl,
      status: response.status,
      contentType: response.headers?.get?.('content-type') ?? '',
      location: response.headers?.get?.('location') ?? '',
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect ${response.status} without Location header`);
      }
      // Resolve relative URLs against the current URL
      const resolved = new URL(location, currentUrl);

      // Enforce strict destination allow-list to prevent SSRF.
      if (resolved.protocol !== 'https:') {
        throw new Error(`Redirect to disallowed protocol: ${resolved.protocol}`);
      }
      if (!isAllowedDownloadHost(resolved.hostname)) {
        throw new Error(`Redirect to disallowed host: ${resolved.hostname}`);
      }
      currentUrl = resolved.toString();
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

// ---------------------------------------------------------------------------
// Resolve unique local path (handle name collisions)
// ---------------------------------------------------------------------------

function resolveUniquePath(dir: string, filename: string): string {
  let candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${counter}${ext}`);
    counter++;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Save a local file buffer to workdir (used by Dashboard upload)
// ---------------------------------------------------------------------------

/**
 * Save a raw file buffer to the workdir attachments directory.
 * Reuses the same validation/normalisation pipeline as Slack downloads.
 *
 * @param buffer    Raw file bytes
 * @param fileName  Original filename from the client
 * @param mimetype  MIME type from the client
 * @param workdir   Session workdir
 * @param batchId   Directory name under _attachments (e.g. "dash_1708500000000")
 * @returns         DownloadedFile metadata
 * @throws          On validation failure or normalisation error
 */
export async function saveLocalFile(
  buffer: Buffer,
  fileName: string,
  mimetype: string,
  workdir: string,
  batchId: string,
): Promise<DownloadedFile> {
  const normalizedMime = mimetype.toLowerCase();
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large (${formatFileSize(buffer.length)}, max ${formatFileSize(MAX_FILE_SIZE_BYTES)})`,
    );
  }
  if (!isMimeAllowed(mimetype)) {
    throw new Error(`File type not allowed: ${mimetype}`);
  }
  if (normalizedMime.startsWith('image/') && normalizedMime !== 'image/svg+xml') {
    const actualFormat = detectImageFormat(buffer.subarray(0, Math.min(buffer.length, 64)));
    if (actualFormat === 'unknown') {
      throw new Error(`Image file is corrupted or in an unsupported format: ${fileName}`);
    }
  }

  const attachDir = path.join(workdir, ATTACHMENTS_SUBDIR, batchId);
  fs.mkdirSync(attachDir, { recursive: true });

  const sanitized = sanitizeFilename(fileName);
  const localPath = resolveUniquePath(attachDir, sanitized);
  fs.writeFileSync(localPath, buffer);

  let file: DownloadedFile = {
    originalName: fileName,
    localPath,
    relativePath: path.relative(workdir, localPath),
    mimetype,
    size: buffer.length,
  };

  try {
    file = await normalizeImage(file, workdir);
  } catch (normErr) {
    // Clean up written file on normalisation failure
    try {
      fs.unlinkSync(localPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw normErr;
  }

  return file;
}

// ---------------------------------------------------------------------------
// Download files to workdir
// ---------------------------------------------------------------------------

const DOWNLOAD_CONCURRENCY = 3;

export async function downloadFiles(
  files: SlackFileInfo[],
  workdir: string,
  jobId: string,
  botToken: string,
): Promise<FileAttachmentResult> {
  const downloaded: DownloadedFile[] = [];
  const errors: FileAttachmentError[] = [];

  if (files.length === 0) return { downloaded, errors };

  const attachDir = path.join(workdir, ATTACHMENTS_SUBDIR, jobId);
  fs.mkdirSync(attachDir, { recursive: true });

  // Phase 1: Sequential validation (depends on cumulative totalSize)
  let totalSize = 0;
  const validated: Array<{ file: SlackFileInfo; localPath: string }> = [];
  const allocatedPaths = new Set<string>();
  for (const file of files) {
    const validationError = validateFile(file, totalSize);
    if (validationError) {
      errors.push(validationError);
      continue;
    }
    totalSize += file.size;
    const sanitized = sanitizeFilename(file.name);
    // resolveUniquePath checks the filesystem, but files haven't been written yet.
    // Track allocated paths in-memory to avoid collisions within the same batch.
    let localPath = resolveUniquePath(attachDir, sanitized);
    if (allocatedPaths.has(localPath)) {
      const ext = path.extname(sanitized);
      const base = sanitized.slice(0, sanitized.length - ext.length);
      let counter = 1;
      do {
        localPath = path.join(attachDir, `${base}_${counter}${ext}`);
        counter++;
      } while (allocatedPaths.has(localPath) || fs.existsSync(localPath));
    }
    allocatedPaths.add(localPath);
    validated.push({ file, localPath });
  }

  // Phase 2: Parallel download + normalize with concurrency limit
  const downloadOne = async (item: { file: SlackFileInfo; localPath: string }): Promise<void> => {
    const { file, localPath } = item;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

      let fileBuffer: Buffer;
      try {
        const response = await fetchWithAuth(
          file.urlPrivateDownload,
          { Authorization: `Bearer ${botToken}` },
          controller.signal,
        );

        if (!response.ok) {
          errors.push({
            fileName: file.name,
            reason: `Download failed: HTTP ${response.status}`,
            userReason: 'Failed to download file from Slack.',
          });
          return;
        }

        const contentType = response.headers?.get?.('content-type') ?? '';
        if (contentType.includes('text/html') && !file.mimetype.startsWith('text/html')) {
          errors.push({
            fileName: file.name,
            reason:
              'File download failed (Slack returned an authentication page). Please verify the bot token has the files:read scope.',
            userReason: 'Failed to download file from Slack.',
          });
          logger.warn('file_download_html_redirect', {
            file_id: file.id,
            file_name: file.name,
            expected_mimetype: file.mimetype,
            response_content_type: contentType,
          });
          return;
        }

        fileBuffer = await readResponseBodyWithLimit(response, MAX_FILE_SIZE_BYTES);
      } finally {
        clearTimeout(timer);
      }
      await fsp.writeFile(localPath, fileBuffer);

      let downloadedFile: DownloadedFile = {
        originalName: file.name,
        localPath,
        relativePath: path.relative(workdir, localPath),
        mimetype: file.mimetype,
        size: fileBuffer.length,
      };

      try {
        downloadedFile = await normalizeImage(downloadedFile, workdir);
      } catch (normErr) {
        errors.push({
          fileName: file.name,
          reason: errorMessage(normErr),
          userReason: 'File could not be processed after download.',
        });
        try {
          await fsp.unlink(localPath);
        } catch {
          /* ignore cleanup errors */
        }
        return;
      }

      downloaded.push(downloadedFile);
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? 'Download timed out'
          : `Download failed: ${errorMessage(err)}`;
      errors.push({
        fileName: file.name,
        reason,
        userReason:
          err instanceof Error && err.name === 'AbortError'
            ? 'Download timed out'
            : 'Failed to download file from Slack.',
      });
      logger.warn('file_download_error', {
        file_id: file.id,
        file_name: file.name,
        error: reason,
      });
    }
  };

  // Simple concurrency pool: process DOWNLOAD_CONCURRENCY items at a time
  for (let i = 0; i < validated.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = validated.slice(i, i + DOWNLOAD_CONCURRENCY);
    await Promise.all(batch.map(downloadOne));
  }

  return { downloaded, errors };
}

// ---------------------------------------------------------------------------
// Output file types & scanning
// ---------------------------------------------------------------------------

export interface OutputFile {
  localPath: string;
  filename: string;
  size: number;
}

const MAX_OUTPUT_FILES = SIZE_LIMITS.maxOutputFiles;
const MAX_OUTPUT_FILE_SIZE = SIZE_LIMITS.maxOutputFileSize;

export function scanOutputFiles(workdir: string): OutputFile[] {
  const outputDir = path.join(workdir, OUTPUT_SUBDIR);
  if (!fs.existsSync(outputDir)) return [];

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  const files: OutputFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(outputDir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) continue;
    if (stat.size > MAX_OUTPUT_FILE_SIZE) {
      logger.warn('output_file_too_large', { file: entry.name, size: stat.size });
      continue;
    }
    files.push({ localPath: fullPath, filename: entry.name, size: stat.size });
    if (files.length >= MAX_OUTPUT_FILES) break;
  }

  return files;
}

// ---------------------------------------------------------------------------
// Artifact types & archiving
// ---------------------------------------------------------------------------

export interface ArchivedFile {
  localPath: string;
  filename: string;
  size: number;
  mimeType: string;
}

// ---------------------------------------------------------------------------
// Artifact file serving — shared safety checks
// ---------------------------------------------------------------------------

const MAX_ARTIFACT_SERVE_BYTES = SIZE_LIMITS.maxArtifactServe;

export type ArtifactValidation =
  | { ok: true; filePath: string; stat: fs.Stats; contentType: string }
  | { ok: false; status: number; error: string };

/**
 * Validate an artifact file path for safe serving.
 * Performs path traversal prevention, symlink resolution, existence and size checks.
 * Used by both the API server and the dashboard server.
 */
export async function validateArtifactFile(
  workdir: string,
  jobId: string,
  filename: string,
): Promise<ArtifactValidation> {
  const artifactDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
  const filePath = path.resolve(artifactDir, filename);
  const resolvedArtifactDir = path.resolve(artifactDir);

  // Path traversal check (before symlink resolution)
  if (!filePath.startsWith(resolvedArtifactDir + path.sep)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  try {
    await fsp.access(filePath);
  } catch {
    return { ok: false, status: 404, error: 'File not found' };
  }

  // Symlink resolution check (async to avoid blocking the event loop)
  try {
    const realFilePath = await fsp.realpath(filePath);
    const realArtifactDir = await fsp.realpath(resolvedArtifactDir);
    if (!realFilePath.startsWith(realArtifactDir + path.sep)) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
  } catch {
    return { ok: false, status: 404, error: 'File not found' };
  }

  const stat = await fsp.stat(filePath);
  if (stat.size > MAX_ARTIFACT_SERVE_BYTES) {
    return { ok: false, status: 413, error: 'File too large to serve' };
  }

  return { ok: true, filePath, stat, contentType: guessMimeType(filename) };
}

/** Map common extensions to MIME types. */
export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.doc': 'application/msword',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  return map[ext] ?? 'application/octet-stream';
}

const DOWNLOAD_ONLY_ARTIFACT_MIME_TYPES = new Set([
  'application/xhtml+xml',
  'image/svg+xml',
  'text/html',
]);

const PREVIEWABLE_ARTIFACT_IMAGE_MIME_TYPES = new Set([
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/x-icon',
]);

function isDownloadOnlyArtifactMimeType(contentType: string): boolean {
  return DOWNLOAD_ONLY_ARTIFACT_MIME_TYPES.has(contentType.toLowerCase());
}

export function isPreviewableArtifactImageMimeType(mimeType: string | null | undefined): boolean {
  return (
    typeof mimeType === 'string' &&
    PREVIEWABLE_ARTIFACT_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
  );
}

export function buildArtifactResponseHeaders(
  filename: string,
  contentType: string,
  size: number,
): Record<string, string> {
  const downloadOnly = isDownloadOnlyArtifactMimeType(contentType);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(size),
    'Content-Disposition': `${downloadOnly ? 'attachment' : 'inline'}; filename="${encodeURIComponent(filename)}"`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (downloadOnly) {
    headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  }
  return headers;
}

/**
 * Archive output files from `_output/` to `_artifacts/{jobId}/`.
 * Files are copied (not moved) then removed from `_output/`.
 * Returns the list of archived files or empty array on failure.
 */
export function archiveOutputFiles(workdir: string, jobId: string): ArchivedFile[] {
  const outputFiles = scanOutputFiles(workdir);
  if (outputFiles.length === 0) return [];

  const artifactDir = path.join(workdir, ARTIFACTS_SUBDIR, jobId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const archived: ArchivedFile[] = [];
  for (const file of outputFiles) {
    const destPath = path.join(artifactDir, file.filename);
    try {
      fs.copyFileSync(file.localPath, destPath);
      fs.unlinkSync(file.localPath);
      archived.push({
        localPath: destPath,
        filename: file.filename,
        size: file.size,
        mimeType: guessMimeType(file.filename),
      });
    } catch (err) {
      logger.warn('archive_output_file_failed', {
        file: file.filename,
        error: errorMessage(err),
      });
    }
  }

  // Clean up the now-empty _output/ directory
  if (archived.length > 0) {
    try {
      fs.rmdirSync(path.join(workdir, OUTPUT_SUBDIR));
    } catch {
      // Ignore: dir may not be empty if some files failed to archive
    }
  }

  return archived;
}

/** TTL cache for listAllArtifacts — avoids rescanning the filesystem on every call. */
const artifactListCache = new ExpiringMap<
  string,
  Array<{ jobId: string; files: ArchivedFile[] }>
>();
const ARTIFACT_CACHE_TTL_MS = TTLS.artifactCache;

/**
 * List all archived artifact files across all jobs for a session workdir.
 * Returns files grouped by jobId. Results are cached for 5 seconds.
 */
export function listAllArtifacts(workdir: string): Array<{ jobId: string; files: ArchivedFile[] }> {
  const cached = artifactListCache.get(workdir);
  if (cached) return cached;

  const artifactsRoot = path.join(workdir, ARTIFACTS_SUBDIR);
  if (!fs.existsSync(artifactsRoot)) return [];

  const result: Array<{ jobId: string; files: ArchivedFile[] }> = [];
  const jobDirs = fs.readdirSync(artifactsRoot, { withFileTypes: true });

  for (const dir of jobDirs) {
    if (!dir.isDirectory()) continue;
    const jobDir = path.join(artifactsRoot, dir.name);
    const entries = fs.readdirSync(jobDir, { withFileTypes: true });
    const files: ArchivedFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(jobDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size === 0) continue;
        files.push({
          localPath: fullPath,
          filename: entry.name,
          size: stat.size,
          mimeType: guessMimeType(entry.name),
        });
      } catch {
        /* skip unreadable files */
      }
    }
    if (files.length > 0) {
      result.push({ jobId: dir.name, files });
    }
  }

  artifactListCache.set(workdir, result, ARTIFACT_CACHE_TTL_MS);
  return result;
}

// ---------------------------------------------------------------------------
// Build file reference block for prompt expansion
// ---------------------------------------------------------------------------

export function buildFileReferenceBlock(files: DownloadedFile[]): string {
  if (files.length === 0) return '';
  const lines = files.map((f) => `- ${f.relativePath} (${f.mimetype}, ${formatFileSize(f.size)})`);
  return `\n[Attached files]\n${lines.join('\n')}`;
}
