/** @module dashboard/routes/filesystem — Dashboard API routes for workspace file browsing and stat operations. */
import { type ExecFileException, execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TIMEOUTS } from '../../shared/constants.js';
import { errorMessage } from '../../utils/error.js';
import { getPowerShell, isLinux, isMacOS, isWindows } from '../../utils/platform.js';
import { json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';

const PICK_TIMEOUT_MS = TIMEOUTS.filePicker;
const PICK_EXEC_OPTIONS = { timeout: PICK_TIMEOUT_MS, encoding: 'utf8' } as const;
type PickerExecError = ExecFileException;

function buildMacOsPickerArgs(initialPath?: string): string[] {
  if (!initialPath) {
    return ['-e', 'set f to choose folder with prompt "Select Directory"', '-e', 'POSIX path of f'];
  }

  const encodedInitialPath = Buffer.from(initialPath, 'utf-8').toString('base64');
  return [
    '-e',
    'use framework "Foundation"',
    '-e',
    `set initialPathData to current application's NSData's alloc()'s initWithBase64EncodedString:"${encodedInitialPath}" options:0`,
    '-e',
    "set initialPath to (current application's NSString's alloc()'s initWithData:initialPathData encoding:(current application's NSUTF8StringEncoding)) as text",
    '-e',
    'set f to choose folder with prompt "Select Directory" default location POSIX file initialPath',
    '-e',
    'POSIX path of f',
  ];
}

function isPickerCancellation(err: PickerExecError, stderr: string): boolean {
  if (err.killed || err.signal) return false;

  const details = `${errorMessage(err)}\n${stderr}`.toLowerCase();
  if (
    details.includes('user canceled') ||
    details.includes('user cancelled') ||
    details.includes('canceled') ||
    details.includes('cancelled')
  ) {
    return true;
  }

  const exitCode = err.code;
  return (exitCode === 1 || exitCode === '1') && !stderr.trim();
}

function toPickerFailure(err: PickerExecError, stderr: string): Error {
  const trimmed = stderr.trim();
  return trimmed ? new Error(trimmed) : err;
}

/**
 * Open the OS-native directory picker and return the selected path.
 * Returns `null` when the user cancels.
 */
function openNativeDirectoryPicker(initialPath?: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const handleResult = (err: PickerExecError | null, stdout: string, stderr: string): void => {
      if (err) {
        if (isPickerCancellation(err, stderr)) {
          resolve(null);
          return;
        }
        reject(toPickerFailure(err, stderr));
        return;
      }
      const raw = stdout.trim();
      if (!raw) {
        resolve(null);
        return;
      }
      // Remove trailing path separator(s) but preserve root ('/' on Unix, 'C:\' on Windows)
      resolve(
        raw.length <= 3 && /^[A-Z]:\\?$/i.test(raw)
          ? raw
          : raw === '/'
            ? '/'
            : raw.replace(/[\\/]+$/, ''),
      );
    };

    if (isMacOS) {
      execFile('osascript', buildMacOsPickerArgs(initialPath), PICK_EXEC_OPTIONS, handleResult);
    } else if (isLinux) {
      // Try zenity (GTK) first, fall back to kdialog (KDE)
      const zenityArgs = ['--file-selection', '--directory', '--title=Select Directory'];
      if (initialPath) zenityArgs.push(`--filename=${initialPath}/`);
      execFile('zenity', zenityArgs, PICK_EXEC_OPTIONS, (err, stdout, stderr) => {
        if (!err && stdout.trim()) {
          handleResult(null, stdout, stderr);
          return;
        }
        const kArgs = ['--getexistingdirectory', initialPath || '~'];
        execFile('kdialog', kArgs, PICK_EXEC_OPTIONS, handleResult);
      });
    } else if (isWindows) {
      // Use Base64-encoded command to prevent PowerShell injection via initialPath.
      // Raw string interpolation is unsafe: backtick, $, ; can escape single-quoted context.
      const psScript = initialPath
        ? [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
            `$f.SelectedPath = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String("${Buffer.from(initialPath, 'utf16le').toString('base64')}"))`,
            "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
          ].join('; ')
        : [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
            "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }",
          ].join('; ');
      // -EncodedCommand accepts a Base64-encoded UTF-16LE script, eliminating all
      // metacharacter concerns even if the script itself were to contain user data
      // beyond initialPath.
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      execFile(
        getPowerShell(),
        ['-NoProfile', '-EncodedCommand', encodedCommand],
        PICK_EXEC_OPTIONS,
        handleResult,
      );
    } else {
      reject(new Error(`Unsupported platform: ${process.platform}`));
    }
  });
}

export async function handleFilesystemRoutes(
  _ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _query: URLSearchParams,
): Promise<boolean> {
  // POST /api/filesystem/pick-directory — open native folder picker
  if (req.method === 'POST' && pathname === '/api/filesystem/pick-directory') {
    const body = await readBody(req);
    const parsed = parseJson<{ initialPath?: string }>(body);
    const initialPath = parsed?.initialPath || undefined;

    try {
      const selected = await openNativeDirectoryPicker(initialPath);
      if (selected) {
        json(res, 200, { path: selected });
      } else {
        json(res, 200, { cancelled: true });
      }
    } catch (err) {
      json(res, 500, { error: `Failed to open directory picker: ${errorMessage(err)}` });
    }
    return true;
  }

  return false;
}
