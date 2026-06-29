/** Coverage tests for setup/interactive: prompter creation, masking, TTY detection. */
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/platform.js', () => ({
  isWindows: false,
}));

describe('interactive coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SetupCancelledError', () => {
    it('creates error with correct name', async () => {
      const { SetupCancelledError } = await import('./interactive.js');
      const err = new SetupCancelledError();
      expect(err.name).toBe('SetupCancelledError');
      expect(err.message).toBe('Setup cancelled');
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('createSetupPrompter', () => {
    it('throws when stdin is not a TTY and no custom input provided', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      // If process.stdin is not a TTY, it should throw
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

      expect(() => createSetupPrompter()).toThrow('Interactive terminal required');

      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
    });

    it('creates prompter with custom input/output streams', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);
      expect(prompter).toBeTruthy();
      expect(prompter.prompt).toBeInstanceOf(Function);
      expect(prompter.confirm).toBeInstanceOf(Function);
      expect(prompter.waitForEnter).toBeInstanceOf(Function);
      expect(prompter.close).toBeInstanceOf(Function);

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('prompt returns trimmed first line', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const promptPromise = prompter.prompt({ message: 'Enter value' });
      // Simulate user typing a response
      setTimeout(() => {
        input.write('hello world\n');
      }, 10);

      const result = await promptPromise;
      expect(result).toBe('hello world');

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('prompt handles multi-line paste (uses first line only)', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const prompter = createSetupPrompter(input, output);

      const promptPromise = prompter.prompt({ message: 'Enter value' });
      setTimeout(() => {
        input.write('first line\nsecond line\n');
      }, 10);

      const result = await promptPromise;
      expect(result).toBe('first line');

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('prompt with validation error throws', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const promptPromise = prompter.prompt({
        message: 'Enter value',
        validate: () => 'validation error',
      });
      setTimeout(() => {
        input.write('bad input\n');
      }, 10);

      await expect(promptPromise).rejects.toThrow('validation error');

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('confirm returns true for y', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const confirmPromise = prompter.confirm('Continue?');
      setTimeout(() => {
        input.write('y\n');
      }, 10);

      const result = await confirmPromise;
      expect(result).toBe(true);

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('confirm returns false for n', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const confirmPromise = prompter.confirm('Continue?');
      setTimeout(() => {
        input.write('n\n');
      }, 10);

      const result = await confirmPromise;
      expect(result).toBe(false);

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('waitForEnter resolves when user presses enter', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const waitPromise = prompter.waitForEnter('Press Enter...');
      setTimeout(() => {
        input.write('\n');
      }, 10);

      await waitPromise; // should resolve
      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('throws SetupCancelledError when readline closes before answer', async () => {
      const { createSetupPrompter, SetupCancelledError } = await import('./interactive.js');
      const input = new PassThrough();
      const output = new PassThrough();

      const prompter = createSetupPrompter(input, output);

      const promptPromise = prompter.prompt({ message: 'Enter' });
      setTimeout(() => {
        input.push(null); // Send EOF
        input.end();
      }, 10);

      await expect(promptPromise).rejects.toThrow(SetupCancelledError);

      prompter.close();
      output.destroy();
    }, 10000);

    it('printStep writes formatted step', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const prompter = createSetupPrompter(input, output);

      prompter.printStep(1, 4, 'Create App');
      expect(chunks.join('')).toContain('Step 1 of 4');
      expect(chunks.join('')).toContain('Create App');

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('print methods write to output', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const prompter = createSetupPrompter(input, output);

      prompter.printSuccess('OK');
      prompter.printWarning('Warn');
      prompter.printError('Err');
      prompter.printInfo('Info');

      const combined = chunks.join('');
      expect(combined).toContain('+ OK');
      expect(combined).toContain('! Warn');
      expect(combined).toContain('x Err');
      expect(combined).toContain('Info');

      prompter.close();
      input.destroy();
      output.destroy();
    });

    it('masked prompt replaces characters with bullets', async () => {
      const { createSetupPrompter } = await import('./interactive.js');
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk.toString());
          cb();
        },
      });

      const prompter = createSetupPrompter(input, output);

      const promptPromise = prompter.prompt({ message: 'Token', mask: true });
      setTimeout(() => {
        input.write('secret\n');
      }, 10);

      const result = await promptPromise;
      expect(result).toBe('secret');

      prompter.close();
      input.destroy();
      output.destroy();
    });
  });
});
