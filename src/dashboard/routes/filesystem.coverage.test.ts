/**
 * Additional coverage for dashboard/routes/filesystem.ts
 * Targets uncovered branches: macOS no initialPath, Linux zenity success, picker cancellation edge cases, empty stdout
 */
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

describe('handleFilesystemRoutes — additional coverage', () => {
  it('macOS picker without initialPath uses simple AppleScript', async () => {
    platformFlags.isMacOS = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(null, '/Users/shuto/work\n', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );

    const [, osascriptArgs] = execFileMock.mock.calls[0] ?? [];
    const serialized = JSON.stringify(osascriptArgs);
    expect(serialized).not.toContain('initWithBase64EncodedString');
    expect(serialized).toContain('choose folder');
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: '/Users/shuto/work' });
  });

  it('returns cancelled when stdout is empty', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(null, '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { cancelled: true });
  });

  it('preserves unix root path /', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(null, '/\n', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: '/' });
  });

  it('Linux zenity success path (no kdialog fallback)', async () => {
    platformFlags.isLinux = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const command = args[0] as string;
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      if (command === 'zenity') {
        callback(null, '/home/user/projects\n', '');
        return { stdin: null } as never;
      }
      callback(new Error('should not be called'), '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { path: '/home/user/projects' });
    // Should only call zenity, not kdialog
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('Linux without initialPath does not add --filename arg to zenity', async () => {
    platformFlags.isLinux = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(null, '/home/user\n', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    const zenityArgs = execFileMock.mock.calls[0]?.[1] as string[];
    expect(zenityArgs).not.toContainEqual(expect.stringContaining('--filename='));
  });

  it('Windows without initialPath uses simpler PowerShell script', async () => {
    platformFlags.isWindows = true;
    parseJsonMock.mockReturnValue({});
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(null, 'C:\\Users\\test\r\n', '');
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

  it('handles picker cancellation via exit code 1 and empty stderr', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error('exit 1'), { code: 1 });
      callback(err, '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { cancelled: true });
  });

  it('treats killed process as non-cancellation (error)', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error('Killed'), { killed: true, code: 1 });
      callback(err, '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({
        error: expect.stringContaining('Failed to open directory picker'),
      }),
    );
  });

  it('treats signal-terminated process as non-cancellation (error)', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error('Signal'), { signal: 'SIGTERM', code: 1 });
      callback(err, '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({
        error: expect.stringContaining('Failed to open directory picker'),
      }),
    );
  });

  it('uses error message instead of stderr when stderr is empty in failure', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      callback(new Error('internal error'), '', '');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(
      expect.anything(),
      500,
      expect.objectContaining({
        error: expect.stringContaining('internal error'),
      }),
    );
  });

  it('recognizes "cancelled" in stderr as cancellation', async () => {
    platformFlags.isMacOS = true;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout: string, stderr: string) => void;
      const err = Object.assign(new Error('cancelled'), { code: -1 });
      callback(err, '', 'User cancelled the operation');
      return { stdin: null } as never;
    });

    await handleFilesystemRoutes(
      makeCtx(),
      makeReq('POST'),
      makeRes(),
      '/api/filesystem/pick-directory',
      new URLSearchParams(),
    );
    expect(jsonMock).toHaveBeenCalledWith(expect.anything(), 200, { cancelled: true });
  });
});
