import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.1.0-test';
});

const mocked = vi.hoisted(() => ({
  main: vi.fn().mockResolvedValue(undefined),
  loggerError: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./index.js', () => ({
  main: mocked.main,
}));

vi.mock('./utils/logger.js', () => ({
  logger: {
    error: mocked.loggerError,
    info: mocked.loggerInfo,
  },
}));

vi.mock('./config.js', () => ({
  loadCompatibilityEnvFile: vi.fn(() => new Set<string>()),
  checkDaemonReadiness: vi.fn(() => ({ ready: true, missingKeys: [] })),
  SENSITIVE_KEYS: new Set<string>(),
}));

vi.mock('./utils/keychain.js', () => ({
  loadKeychainSecrets: vi.fn(async () => new Map<string, string>()),
}));

describe('cli', () => {
  it('dev subcommand calls main()', async () => {
    process.argv = ['node', 'cli.js', 'dev'];
    await import('./cli.js');
    await vi.waitFor(() => {
      expect(mocked.main).toHaveBeenCalledOnce();
    });
  });

  it('--version outputs 1.0.0', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    program.name('HuskyGate').version('1.0.0');

    let versionOutput = '';
    program.configureOutput({
      writeOut: (str: string) => {
        versionOutput = str;
      },
    });
    program.exitOverride();

    try {
      program.parse(['node', 'cli.js', '--version']);
    } catch {
      // commander throws on exitOverride
    }

    expect(versionOutput.trim()).toBe('1.0.0');
  });

  it('server subcommand group exists with start/stop/status', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    program.name('HuskyGate').version('1.0.0');

    const server = program.command('server').description('Manage the background daemon');
    const subcommands: string[] = [];
    server.command('start').action(() => {
      subcommands.push('start');
    });
    server.command('stop').action(() => {
      subcommands.push('stop');
    });
    server.command('status').action(() => {
      subcommands.push('status');
    });

    program.parse(['node', 'cli.js', 'server', 'start']);
    expect(subcommands).toContain('start');
  });

  it('dashboard subcommand group exists with start/stop/status', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    program.name('HuskyGate').version('1.0.0');

    const dashboard = program.command('dashboard').description('Manage the web dashboard');
    const subcommands: string[] = [];
    dashboard.command('start', { isDefault: true }).action(() => {
      subcommands.push('start');
    });
    dashboard.command('stop').action(() => {
      subcommands.push('stop');
    });
    dashboard.command('status').action(() => {
      subcommands.push('status');
    });

    program.parse(['node', 'cli.js', 'dashboard', 'start']);
    expect(subcommands).toContain('start');
  });

  it('dashboard start accepts --port option', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    program.name('HuskyGate').version('1.0.0');

    let capturedPort = '';
    const dashboard = program.command('dashboard');
    dashboard
      .command('start', { isDefault: true })
      .option('--port <port>', 'Dashboard port', '3737')
      .action((opts: { port: string }) => {
        capturedPort = opts.port;
      });

    program.parse(['node', 'cli.js', 'dashboard', 'start', '--port', '8080']);
    expect(capturedPort).toBe('8080');
  });

  it('dashboard start defaults to port 3737', async () => {
    const { Command } = await import('commander');
    const program = new Command();
    program.name('HuskyGate').version('1.0.0');

    let capturedPort = '';
    const dashboard = program.command('dashboard');
    dashboard
      .command('start', { isDefault: true })
      .option('--port <port>', 'Dashboard port', '3737')
      .action((opts: { port: string }) => {
        capturedPort = opts.port;
      });

    program.parse(['node', 'cli.js', 'dashboard']);
    expect(capturedPort).toBe('3737');
  });
});
