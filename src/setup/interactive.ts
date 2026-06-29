/** @module interactive — Readline-based interactive prompts for setup wizard. */

import { type Interface as ReadlineInterface, createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { isWindows } from '../utils/platform.js';

/** Thrown when the user cancels setup via Ctrl+C or EOF. */
export class SetupCancelledError extends Error {
  constructor() {
    super('Setup cancelled');
    this.name = 'SetupCancelledError';
  }
}

export interface PromptOptions {
  message: string;
  mask?: boolean;
  validate?: (input: string) => string | null;
}

export interface SetupPrompter {
  prompt(options: PromptOptions): Promise<string>;
  confirm(message: string): Promise<boolean>;
  waitForEnter(message: string): Promise<void>;
  printStep(stepNumber: number, totalSteps: number, title: string): void;
  printSuccess(message: string): void;
  printWarning(message: string): void;
  printError(message: string): void;
  printInfo(message: string): void;
  close(): void;
}

/**
 * Create a setup prompter for interactive CLI input.
 *
 * Accepts injectable streams for testability. Falls back to `process.stdin` / `process.stdout`.
 * On non-TTY inputs (piped, CI), throws with a clear error.
 */
export function createSetupPrompter(
  input?: NodeJS.ReadableStream,
  output?: NodeJS.WritableStream,
): SetupPrompter {
  const stdin = input ?? process.stdin;
  const stdout = output ?? process.stdout;

  // Non-interactive detection (skip for injected test streams)
  if (!input && !('isTTY' in stdin && (stdin as NodeJS.ReadStream).isTTY)) {
    throw new Error(
      'Interactive terminal required for setup.\n' +
        'Use the dashboard wizard instead: huskygate dashboard start',
    );
  }

  // Detect if we can reliably mask individual characters.
  // On Windows cmd.exe, per-character masking via output transform is unreliable.
  const canMaskPerChar = !isWindows || !!input; // Allow masking in tests

  function createReadlineForPrompt(mask: boolean): ReadlineInterface {
    if (mask && canMaskPerChar) {
      const maskedOutput = new Writable({
        write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
          const text = chunk.toString();
          // Replace printable chars (except control chars / newlines) with dots
          // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control character matching for terminal masking
          const masked = text.replace(/[^\n\r\x1b\x07\x08]/g, '\u2022');
          (stdout as NodeJS.WritableStream).write(masked);
          callback();
        },
      });
      return createInterface({ input: stdin, output: maskedOutput, terminal: true });
    }
    return createInterface({ input: stdin, output: stdout, terminal: !mask });
  }

  /**
   * Prompt for a single line of input. Rejects with SetupCancelledError
   * if the readline is closed before the user answers (Ctrl+C / EOF).
   */
  function askLine(rl: ReadlineInterface, query: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      rl.question(query, (answer) => {
        if (!settled) {
          settled = true;
          resolve(answer);
        }
      });
      rl.once('close', () => {
        if (!settled) {
          settled = true;
          reject(new SetupCancelledError());
        }
      });
    });
  }

  return {
    async prompt(options: PromptOptions): Promise<string> {
      const { message, mask = false, validate } = options;

      // Show "(input hidden)" hint on Windows when masking
      const suffix = mask && !canMaskPerChar ? ' (input hidden)' : '';
      const query = `  ${message}${suffix}: `;

      const rl = createReadlineForPrompt(mask);
      try {
        const raw = await askLine(rl, query);
        // Take only the first line (handle accidental multi-line paste)
        const [firstLine = ''] = raw.split('\n');
        const trimmed = firstLine.trim();

        if (raw.includes('\n')) {
          (stdout as NodeJS.WritableStream).write(
            '  (multi-line input detected — using first line only)\n',
          );
        }

        if (validate) {
          const errorMsg = validate(trimmed);
          if (errorMsg) {
            throw new Error(errorMsg);
          }
        }
        return trimmed;
      } finally {
        rl.close();
      }
    },

    async confirm(message: string): Promise<boolean> {
      const rl = createReadlineForPrompt(false);
      try {
        const answer = await askLine(rl, `  ${message} [y/N] `);
        return answer.trim().toLowerCase() === 'y';
      } finally {
        rl.close();
      }
    },

    async waitForEnter(message: string): Promise<void> {
      const rl = createReadlineForPrompt(false);
      try {
        await askLine(rl, `  ${message}`);
      } finally {
        rl.close();
      }
    },

    printStep(stepNumber: number, totalSteps: number, title: string): void {
      (stdout as NodeJS.WritableStream).write(
        `\n  --- Step ${stepNumber} of ${totalSteps}: ${title} ---\n\n`,
      );
    },

    printSuccess(message: string): void {
      (stdout as NodeJS.WritableStream).write(`  + ${message}\n`);
    },

    printWarning(message: string): void {
      (stdout as NodeJS.WritableStream).write(`  ! ${message}\n`);
    },

    printError(message: string): void {
      (stdout as NodeJS.WritableStream).write(`  x ${message}\n`);
    },

    printInfo(message: string): void {
      (stdout as NodeJS.WritableStream).write(`  ${message}\n`);
    },

    close(): void {
      // No persistent resources to clean up
    },
  };
}
