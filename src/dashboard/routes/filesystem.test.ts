import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../route-context.js';

const { execFileMock, platformFlags, jsonMock, parseJsonMock, readBodyMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  platformFlags: { isMacOS: false, isLinux: false, isWindows: false },
  jsonMock: vi.fn(),
  parseJsonMock: vi.fn(),
  readBodyMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../http.js', () => ({
  json: jsonMock,
  parseJson: parseJsonMock,
  readBody: readBodyMock,
}));

vi.mock('../../utils/platform.js', () => ({
  getPowerShell: () => 'powershell',
  get isMacOS() {
    return platformFlags.isMacOS;
  },
  get isLinux() {
    return platformFlags.isLinux;
  },
  get isWindows() {
    return platformFlags.isWindows;
  },
}));

import { handleFilesystemRoutes } from './filesystem.js';

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

function makeRes(): ServerResponse {
  return {} as ServerResponse;
}

function makeCtx(): RouteContext {
  return {} as RouteContext;
}

describe('handleFilesystemRoutes', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    platformFlags.isMacOS = false;
    platformFlags.isLinux = false;
    platformFlags.isWindows = false;
    jsonMock.mockReset();
    parseJsonMock.mockReset();
    readBodyMock.mockReset();
    readBodyMock.mockResolvedValue('{}');
    parseJsonMock.mockReturnValue({});
  });

  it('returns false for unmatched route', async () => {
    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('GET'),
      makeRes(),
      '/api/not-handled',
      new URLSearchParams(),
    );
    expect(handled).toBe(false);
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('handles macOS picker success and normalizes trailing slash', async () => {
    platformFlags.isMacOS = true;
    const initialPath = '/Users/shuto/"Work"\nInbox';
    parseJsonMock.mockReturnValue({ initialPath });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string) => void;
      callback(null, '/Users/shuto/work/\n');
      return { stdin: null } as never;
    });

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    const [, osascriptArgs] = execFileMock.mock.calls[0] ?? [];
    const serializedArgs = JSON.stringify(osascriptArgs);
    expect(serializedArgs).toContain(Buffer.from(initialPath, 'utf-8').toString('base64'));
    expect(serializedArgs).not.toContain(initialPath);
    expect(execFileMock).toHaveBeenCalledWith(
      'osascript',
      expect.arrayContaining([
        '-e',
        'use framework "Foundation"',
        '-e',
        expect.stringContaining('initWithBase64EncodedString'),
      ]),
      expect.any(Object),
      expect.any(Function),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: '/Users/shuto/work' });
  });

  it('returns cancelled when picker reports error', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr?: string) => void;
      const err = Object.assign(new Error('User canceled.'), { code: 1 });
      callback(err, '', 'User canceled.');
      return { stdin: null } as never;
    });

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { cancelled: true });
  });

  it('returns 500 when picker reports unexpected execution error', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr?: string) => void;
      callback(new Error('osascript failed'), '', 'AppleScript execution failed');
      return { stdin: null } as never;
    });

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 500, {
      error: 'Failed to open directory picker: AppleScript execution failed',
    });
  });

  it('uses linux kdialog fallback when zenity does not return a path', async () => {
    platformFlags.isLinux = true;
    parseJsonMock.mockReturnValue({ initialPath: '/home/shuto' });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const command = args[0] as string;
      const callback = args[3] as (err: Error | null, stdout: string) => void;
      if (command === 'zenity') {
        callback(new Error('zenity failed'), '');
        return { stdin: null } as never;
      }
      callback(null, '/home/shuto/projects\n');
      return { stdin: null } as never;
    });

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'zenity',
      expect.arrayContaining(['--file-selection', '--directory']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      'kdialog',
      expect.arrayContaining(['--getexistingdirectory', '/home/shuto']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: '/home/shuto/projects' });
  });

  it('handles windows picker branch', async () => {
    platformFlags.isWindows = true;
    parseJsonMock.mockReturnValue({ initialPath: "C:\\Users\\shuto\\O'Hara" });
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string) => void;
      callback(null, 'C:\\Users\\shuto\\Workspace\r\n');
      return { stdin: null } as never;
    });

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', '-EncodedCommand']),
      expect.any(Object),
      expect.any(Function),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, {
      path: 'C:\\Users\\shuto\\Workspace',
    });
  });

  it('preserves Windows drive root path without stripping backslash', async () => {
    platformFlags.isWindows = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string) => void;
      callback(null, 'C:\\\r\n');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: 'C:\\' });
  });

  it('strips trailing backslash from non-root Windows paths', async () => {
    platformFlags.isWindows = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string) => void;
      callback(null, 'C:\\Users\\test\\\r\n');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: 'C:\\Users\\test' });
  });

  it('returns 500 for unsupported platform', async () => {
    // All platform flags are false (default) — simulates unsupported platform

    const handled = await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    expect(handled).toBe(true);
    expect(jsonMock).toHaveBeenCalledTimes(1);
    expect((jsonMock.mock.calls[0] ?? [])[1]).toBe(500);
    expect(String((jsonMock.mock.calls[0] ?? [])[2]?.error ?? '')).toContain(
      'Unsupported platform:',
    );
  });
});
