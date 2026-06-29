/** Coverage2 tests for cli.ts: uncovered branches — restart dashboard-already-running,
 * restart dashboard error, restart server error, keychain commands */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.1.0-test';
});

const mocked = vi.hoisted(() => ({
  main: vi.fn().mockResolvedValue(undefined),
  loggerError: vi.fn(),
  startDaemon: vi.fn(
    async (): Promise<
      | { pid: number; restarted?: boolean }
      | { alreadyRunning: true; pid: number }
      | { error: string }
    > => ({ pid: 1111 }),
  ),
  stopDaemon: vi.fn(() => ({ stopped: true, pid: 2222 })),
  getServerStatus: vi.fn(() => ({
    running: true,
    pid: 1111,
    pidFile: '/tmp/huskygate.pid',
    logFile: '/tmp/huskygate.log',
  })),
  getPidFilePath: vi.fn(() => '/tmp/huskygate.pid'),
  readPidFile: vi.fn((): number | null => null),
  isProcessRunning: vi.fn(() => false),
  writePidFile: vi.fn(),
  removePidFile: vi.fn(),
  findPidOnPort: vi.fn((): number | null => null),
  waitForProcessAlive: vi.fn(async () => true),
  portReleaseDelay: vi.fn(async () => {}),
  loadConfig: vi.fn(() => ({
    dashboardSecret: 'dashboard-secret',
    serverApiPort: 3738,
    serverApiSecret: 'api-secret',
    workdirRoot: '/tmp/workdir',
    dashboardCookieSecure: true,
  })),
  loadDashboardConfig: vi.fn(() => ({
    dashboardSecret: 'dashboard-secret',
    serverApiPort: 3738,
    serverApiSecret: 'api-secret',
    workdirRoot: '/tmp/workdir',
    dashboardCookieSecure: true,
  })),
  createDashboardServer: vi.fn(),
  spawn: vi.fn(() => ({ pid: 3333 as number | undefined, unref: vi.fn() })),
  execFile: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  closeSync: vi.fn(),
  loadCompatibilityEnvFile: vi.fn(() => new Set<string>()),
  checkDaemonReadiness: vi.fn(() => ({ ready: true, missingKeys: [] })),
  SENSITIVE_KEYS: new Set<string>(),
  loadKeychainSecrets: vi.fn(async () => new Map<string, string>()),
  renderBanner: vi.fn((v: string) => `[banner:${v}]`),
  formatStarted: vi.fn((s: string) => `[started:${s}]`),
  formatStopped: vi.fn((s: string) => `[stopped:${s}]`),
  formatStatus: vi.fn((s: string, r: boolean) => `[status:${s}:${r}]`),
  formatAlreadyRunning: vi.fn((s: string) => `[already:${s}]`),
  formatAlreadyRunningWithHint: vi.fn((s: string) => `[hint:${s}]`),
  formatRestarted: vi.fn((s: string) => `[restarted:${s}]`),
  formatNotRunning: vi.fn((s: string) => `[not:${s}]`),
  renderByeBanner: vi.fn(() => '[bye]'),
  formatSetupRequired: vi.fn((keys: string[]) => `[setup:${keys.join(',')}]`),
  formatOverviewTable: vi.fn(() => '[overview-table]'),
  formatStatusIndicator: vi.fn((r: boolean, p: number | null) => `[indicator:${r}:${p}]`),
  formatVersionHeader: vi.fn((v: string) => `[version:${v}]`),
  formatHint: vi.fn((a: string, c: string) => `[hint:${a}:${c}]`),
  getKeychainProvider: vi.fn(() => ({
    platform: 'test',
    isAvailable: vi.fn(async () => true),
    listKeys: vi.fn(async () => ['KEY_1', 'KEY_2']),
  })),
  runSetup: vi.fn(async () => undefined),
}));

vi.mock('./cli/banner.js', () => ({
  renderBanner: mocked.renderBanner,
  renderByeBanner: mocked.renderByeBanner,
  formatStarted: mocked.formatStarted,
  formatStopped: mocked.formatStopped,
  formatStatus: mocked.formatStatus,
  formatAlreadyRunning: mocked.formatAlreadyRunning,
  formatAlreadyRunningWithHint: mocked.formatAlreadyRunningWithHint,
  formatRestarted: mocked.formatRestarted,
  formatNotRunning: mocked.formatNotRunning,
  formatSetupRequired: mocked.formatSetupRequired,
  formatOverviewTable: mocked.formatOverviewTable,
  formatStatusIndicator: mocked.formatStatusIndicator,
  formatVersionHeader: mocked.formatVersionHeader,
  formatHint: mocked.formatHint,
}));
vi.mock('./index.js', () => ({ main: mocked.main }));
vi.mock('./utils/logger.js', () => ({ logger: { error: mocked.loggerError } }));
vi.mock('./server/daemon.js', () => ({
  startDaemon: mocked.startDaemon,
  stopDaemon: mocked.stopDaemon,
  getServerStatus: mocked.getServerStatus,
  getPidFilePath: mocked.getPidFilePath,
  readPidFile: mocked.readPidFile,
  isProcessRunning: mocked.isProcessRunning,
  writePidFile: mocked.writePidFile,
  removePidFile: mocked.removePidFile,
  findPidOnPort: mocked.findPidOnPort,
  waitForProcessAlive: mocked.waitForProcessAlive,
  portReleaseDelay: mocked.portReleaseDelay,
}));
vi.mock('./config.js', () => ({
  loadConfig: mocked.loadConfig,
  loadDashboardConfig: mocked.loadDashboardConfig,
  loadBootstrapConfig: mocked.loadDashboardConfig,
  loadCompatibilityEnvFile: mocked.loadCompatibilityEnvFile,
  checkDaemonReadiness: mocked.checkDaemonReadiness,
  SENSITIVE_KEYS: mocked.SENSITIVE_KEYS,
}));
vi.mock('./dashboard/server.js', () => ({ createDashboardServer: mocked.createDashboardServer }));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn, execFile: mocked.execFile }));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mocked.existsSync,
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 99),
    closeSync: mocked.closeSync,
    readFileSync: mocked.readFileSync,
  };
});
vi.mock('./utils/fs-security.js', () => ({
  ensurePrivateDirectory: vi.fn(),
  ensurePrivateFile: vi.fn(),
  openPrivateAppendFile: vi.fn(() => 99),
  writePrivateFile: vi.fn(),
}));
vi.mock('./utils/keychain.js', () => ({
  getKeychainProvider: mocked.getKeychainProvider,
  loadKeychainSecrets: mocked.loadKeychainSecrets,
}));

vi.mock('./setup/setup-command.js', () => ({
  runSetup: mocked.runSetup,
}));

async function runCli(argv: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ['node', 'cli.js', ...argv];
  await import('./cli.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('cli coverage2', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.startDaemon.mockResolvedValue({ pid: 1111 });
    mocked.stopDaemon.mockReturnValue({ stopped: true, pid: 2222 });
    mocked.readPidFile.mockReturnValue(null);
    mocked.isProcessRunning.mockReturnValue(false);
    mocked.spawn.mockReturnValue({ pid: 3333, unref: vi.fn() });
    mocked.existsSync.mockReturnValue(false);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('restart — dashboard already running', () => {
    it('shows already-running for dashboard during restart', async () => {
      mocked.readPidFile.mockReturnValueOnce(4444);
      mocked.isProcessRunning.mockReturnValueOnce(true);
      // Second spawn for dashboard start returns already running
      mocked.readPidFile.mockReturnValueOnce(5555);
      mocked.isProcessRunning.mockReturnValueOnce(true);

      await runCli(['restart', '--port', '3737', '--no-open']);

      expect(mocked.formatAlreadyRunning).toHaveBeenCalledWith(
        'Dashboard',
        expect.objectContaining({ PID: 5555 }),
      );
    });
  });

  describe('restart — dashboard error', () => {
    it('shows error when dashboard fails to start during restart', async () => {
      mocked.existsSync.mockReturnValue(false);
      mocked.spawn.mockReturnValueOnce({ pid: undefined, unref: vi.fn() });

      await runCli(['restart', '--port', '3737', '--no-open']);

      expect(consoleErrSpy).toHaveBeenCalledWith('Failed to start dashboard process');
    });
  });

  describe('restart — server error', () => {
    it('exits when server fails to start during restart', async () => {
      mocked.startDaemon.mockResolvedValueOnce({ error: 'server spawn failed' });

      await runCli(['restart', '--port', '3737', '--no-open']);

      expect(consoleErrSpy).toHaveBeenCalledWith('server spawn failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('keychain commands', () => {
    it('handles keychain status', async () => {
      await runCli(['keychain', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Platform'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available'));
    });

    it('handles keychain list', async () => {
      await runCli(['keychain', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Keys in keychain'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('KEY_1'));
    });

    it('handles keychain list when unavailable', async () => {
      mocked.getKeychainProvider.mockReturnValueOnce({
        platform: 'test',
        isAvailable: vi.fn(async () => false),
        listKeys: vi.fn(async () => []),
      });

      await runCli(['keychain', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not available'));
    });

    it('handles keychain list with no keys', async () => {
      mocked.getKeychainProvider.mockReturnValueOnce({
        platform: 'test',
        isAvailable: vi.fn(async () => true),
        listKeys: vi.fn(async () => []),
      });

      await runCli(['keychain', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No keys'));
    });

    it('handles keychain status when unavailable', async () => {
      mocked.getKeychainProvider.mockReturnValueOnce({
        platform: 'test',
        isAvailable: vi.fn(async () => false),
        listKeys: vi.fn(async () => []),
      });

      await runCli(['keychain', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Available: no'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('fall back'));
    });
  });

  describe('top-level start with browser open', () => {
    it('opens browser when --open is not disabled', async () => {
      mocked.existsSync.mockReturnValue(false);
      const unref = vi.fn();
      mocked.spawn.mockReturnValueOnce({ pid: 7777, unref });

      await runCli(['start', '--port', '3737']);

      // openBrowser calls execFile
      expect(mocked.execFile).toHaveBeenCalled();
    });
  });

  describe('preAction hook: --data-dir sets HUSKYGATE_DATA_DIR', () => {
    it('sets HUSKYGATE_DATA_DIR from --data-dir option', async () => {
      const original = process.env.HUSKYGATE_DATA_DIR;
      await runCli(['--data-dir', '/tmp/custom-data', 'status']);

      expect(process.env.HUSKYGATE_DATA_DIR).toContain('custom-data');
      // Restore
      if (original === undefined) {
        delete process.env.HUSKYGATE_DATA_DIR;
      } else {
        process.env.HUSKYGATE_DATA_DIR = original;
      }
    });
  });

  describe('printStartOverview fallback port on config error', () => {
    it('uses fallback port when loadBootstrapConfig throws in printStartOverview', async () => {
      mocked.existsSync.mockReturnValue(false);
      const unref = vi.fn();
      mocked.spawn.mockReturnValueOnce({ pid: 5555, unref });

      // loadDashboardConfig (aliased as loadBootstrapConfig) is called:
      //   1st: in startDashboardProcess -> returns config normally
      //   2nd: in printStartOverview -> should throw to hit lines 65-66
      let callCount = 0;
      mocked.loadDashboardConfig.mockImplementation(() => {
        callCount++;
        if (callCount >= 2) {
          throw new Error('config not ready');
        }
        return {
          dashboardSecret: 'dashboard-secret',
          serverApiPort: 3738,
          serverApiSecret: 'api-secret',
          workdirRoot: '/tmp/workdir',
          dashboardCookieSecure: true,
        };
      });

      await runCli(['start', '--port', '3737', '--no-open']);

      // printStartOverview should still complete (using fallback port 3738)
      expect(mocked.formatOverviewTable).toHaveBeenCalled();

      // Restore
      mocked.loadDashboardConfig.mockReturnValue({
        dashboardSecret: 'dashboard-secret',
        serverApiPort: 3738,
        serverApiSecret: 'api-secret',
        workdirRoot: '/tmp/workdir',
        dashboardCookieSecure: true,
      });
    });
  });

  describe('startForeground readiness check failure', () => {
    it('prints setup-required and exits when daemon is not ready', async () => {
      mocked.checkDaemonReadiness.mockReturnValueOnce({
        ready: false,
        missingKeys: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'],
      });

      await runCli(['dev']);

      expect(mocked.formatSetupRequired).toHaveBeenCalledWith([
        'SLACK_BOT_TOKEN',
        'SLACK_APP_TOKEN',
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('setup command', () => {
    it('invokes runSetup with correct options', async () => {
      await runCli(['setup', '--manifest-only']);

      expect(mocked.runSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          manifestOnly: true,
        }),
      );
    });

    it('invokes runSetup with --status flag', async () => {
      await runCli(['setup', '--status']);

      expect(mocked.runSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          status: true,
        }),
      );
    });

    it('invokes runSetup with --reset flag', async () => {
      await runCli(['setup', '--reset']);

      expect(mocked.runSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          reset: true,
        }),
      );
    });

    it('invokes runSetup with --no-open flag', async () => {
      await runCli(['setup', '--no-open']);

      expect(mocked.runSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          open: false,
        }),
      );
    });
  });

  describe('top-level start: not-ready — dashboard-only mode', () => {
    it('starts dashboard only when daemon is not ready and shows setup-required with dashboard error', async () => {
      mocked.checkDaemonReadiness.mockReturnValueOnce({
        ready: false,
        missingKeys: ['SLACK_BOT_TOKEN'],
      });
      mocked.existsSync.mockReturnValue(false);
      mocked.spawn.mockReturnValueOnce({ pid: undefined, unref: vi.fn() });

      await runCli(['start', '--port', '3737', '--no-open']);

      expect(mocked.renderBanner).toHaveBeenCalled();
      expect(consoleErrSpy).toHaveBeenCalledWith('Failed to start dashboard process');
      expect(mocked.formatSetupRequired).toHaveBeenCalledWith(['SLACK_BOT_TOKEN']);
    });

    it('starts dashboard only when daemon is not ready and dashboard already running', async () => {
      mocked.checkDaemonReadiness.mockReturnValueOnce({
        ready: false,
        missingKeys: ['ALLOWED_USER_IDS'],
      });
      mocked.readPidFile.mockReturnValueOnce(4444);
      mocked.isProcessRunning.mockReturnValueOnce(true);

      await runCli(['start', '--port', '3737', '--no-open']);

      expect(mocked.renderBanner).toHaveBeenCalled();
      expect(mocked.formatSetupRequired).toHaveBeenCalledWith(
        ['ALLOWED_USER_IDS'],
        'http://localhost:3737',
      );
    });

    it('starts dashboard only when daemon is not ready and dashboard starts successfully', async () => {
      mocked.checkDaemonReadiness.mockReturnValueOnce({
        ready: false,
        missingKeys: ['SLACK_APP_TOKEN'],
      });
      mocked.existsSync.mockReturnValue(false);
      const unref = vi.fn();
      mocked.spawn.mockReturnValueOnce({ pid: 6666, unref });

      await runCli(['start', '--port', '4040', '--no-open']);

      expect(mocked.renderBanner).toHaveBeenCalled();
      expect(mocked.formatSetupRequired).toHaveBeenCalledWith(
        ['SLACK_APP_TOKEN'],
        expect.stringContaining('http://localhost:4040'),
      );
      // Should NOT call startDaemon since readiness check failed
      expect(mocked.startDaemon).not.toHaveBeenCalled();
    });

    it('opens browser when not-ready dashboard starts and --open is not disabled', async () => {
      mocked.checkDaemonReadiness.mockReturnValueOnce({
        ready: false,
        missingKeys: ['SLACK_BOT_TOKEN'],
      });
      mocked.existsSync.mockReturnValue(false);
      const unref = vi.fn();
      mocked.spawn.mockReturnValueOnce({ pid: 7777, unref });

      await runCli(['start', '--port', '4141']);

      expect(mocked.execFile).toHaveBeenCalled();
    });
  });

  describe('status command: loadBootstrapConfig catch (line 491)', () => {
    it('falls back to default port when config loading fails', async () => {
      mocked.loadDashboardConfig.mockImplementation(() => {
        throw new Error('config load error');
      });
      mocked.getServerStatus.mockReturnValueOnce({
        running: true,
        pid: 1111,
        pidFile: '/tmp/pid',
        logFile: '/tmp/log',
      });
      mocked.readPidFile.mockReturnValueOnce(null);

      await runCli(['status']);

      expect(mocked.formatVersionHeader).toHaveBeenCalled();
      // Despite config error, should show the table with default port 3738
      expect(mocked.formatOverviewTable).toHaveBeenCalledWith(
        expect.arrayContaining([['Server API', 'http://127.0.0.1:3738']]),
      );

      // Restore
      mocked.loadDashboardConfig.mockReturnValue({
        dashboardSecret: 'dashboard-secret',
        serverApiPort: 3738,
        serverApiSecret: 'api-secret',
        workdirRoot: '/tmp/workdir',
        dashboardCookieSecure: true,
      });
    });
  });
});
