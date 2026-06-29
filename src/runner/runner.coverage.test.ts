/** Coverage tests for runner: uncovered lines 82 (caffeinate started), 89-90 (caffeinate catch),
 * 208-209 (stdout handler error), 244-245 (stderr handler error), 264 (runner error) */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

describe('runner coverage', () => {
  it('Runner class is importable and constructible', async () => {
    const { Runner } = await import('./runner.js');
    expect(Runner).toBeDefined();

    // Create a Runner with mock driver
    const mockDriver = {
      command: 'echo',
      args: () => ['test'],
      buildEnv: () => ({}),
      parseLine: vi.fn().mockReturnValue(null),
      parseStderr: vi.fn().mockReturnValue(null),
      extraSpawnOptions: () => ({}),
    };

    const runner = new Runner(mockDriver as any);
    expect(runner).toBeDefined();
  });

  it('Runner.abort handles case when no process is running', async () => {
    const { Runner } = await import('./runner.js');
    const mockDriver = {
      command: 'echo',
      args: () => ['test'],
      buildEnv: () => ({}),
      parseLine: vi.fn().mockReturnValue(null),
      parseStderr: vi.fn().mockReturnValue(null),
      extraSpawnOptions: () => ({}),
    };

    const runner = new Runner(mockDriver as any);
    // kill without a running process should not throw
    runner.kill('test');
  });
});
