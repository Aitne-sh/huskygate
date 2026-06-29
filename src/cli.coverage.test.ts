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
  stopDaemon: vi.fn((): { stopped: true; pid: number } | { error: string } => ({
    stopped: true,
    pid: 2222,
  })),
  getServerStatus: vi.fn(
    (): { running: boolean; pid: number | null; pidFile: string; logFile: string } => ({
      running: true,
      pid: 1111,
      pidFile: '/tmp/huskygate.pid',
      logFile: '/tmp/huskygate.log',
    }),
  ),
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
  })),
  loadDashboardConfig: vi.fn(() => ({
    dashboardSecret: 'dashboard-secret',
    serverApiPort: 3738,
    serverApiSecret: 'api-secret',
    workdirRoot: '/tmp/workdir',
  })),
  createDashboardServer: vi.fn(),
  spawn: vi.fn((): { pid: number | undefined; unref: () => void } => ({
    pid: 3333,
    unref: vi.fn(),
  })),
  execFile: vi.fn(),
  existsSync: vi.fn((_path?: string): boolean => false),
  mkdirSync: vi.fn(),
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  loadCompatibilityEnvFile: vi.fn(() => new Set<string>()),
  checkDaemonReadiness: vi.fn(() => ({ ready: true, missingKeys: [] })),
  SENSITIVE_KEYS: new Set<string>(),
  loadKeychainSecrets: vi.fn(async () => new Map<string, string>()),
  // Banner functions — passthrough with identifiable output
  renderBanner: vi.fn((version: string) => `[banner:${version}]`),
  formatStarted: vi.fn(
    (service: string, details: Record<string, unknown>) =>
      `[started:${service}:${JSON.stringify(details)}]`,
  ),
  formatStopped: vi.fn(
    (service: string, details: Record<string, unknown>) =>
      `[stopped:${service}:${JSON.stringify(details)}]`,
  ),
  formatStatus: vi.fn(
    (service: string, running: boolean, details: Record<string, unknown>) =>
      `[status:${service}:${running}:${JSON.stringify(details)}]`,
  ),
  formatAlreadyRunning: vi.fn(
    (service: string, details: Record<string, unknown>) =>
      `[already-running:${service}:${JSON.stringify(details)}]`,
  ),
  formatAlreadyRunningWithHint: vi.fn(
    (service: string, details: Record<string, unknown>, hints: Record<string, unknown>) =>
      `[already-running-hint:${service}:${JSON.stringify(details)}:${JSON.stringify(hints)}]`,
  ),
  formatRestarted: vi.fn(
    (service: string, details: Record<string, unknown>) =>
      `[restarted:${service}:${JSON.stringify(details)}]`,
  ),
  formatNotRunning: vi.fn((service: string) => `[not-running:${service}]`),
  renderByeBanner: vi.fn(() => '[bye-banner]'),
  formatSetupRequired: vi.fn(
    (missingKeys: string[]) => `[setup-required:${missingKeys.join(',')}]`,
  ),
  formatOverviewTable: vi.fn((rows: [string, string][]) => `[overview-table:${rows.length}]`),
  formatStatusIndicator: vi.fn(
    (running: boolean, pid: number | null) => `[status-indicator:${running}:${pid}]`,
  ),
  formatVersionHeader: vi.fn((version: string) => `[version-header:${version}]`),
  formatHint: vi.fn((action: string, command: string) => `[hint:${action}:${command}]`),
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

vi.mock('./index.js', () => ({
  main: mocked.main,
}));

vi.mock('./utils/logger.js', () => ({
  logger: {
    error: mocked.loggerError,
  },
}));

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

vi.mock('./utils/keychain.js', () => ({
  loadKeychainSecrets: mocked.loadKeychainSecrets,
}));

vi.mock('./dashboard/server.js', () => ({
  createDashboardServer: mocked.createDashboardServer,
}));

vi.mock('node:child_process', () => ({
  spawn: mocked.spawn,
  execFile: mocked.execFile,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mocked.existsSync,
    mkdirSync: mocked.mkdirSync,
    openSync: mocked.openSync,
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

async function runCli(argv: string[]): Promise<void> {
  vi.resetModules();
  process.argv = ['node', 'cli.js', ...argv];
  await import('./cli.js');
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('cli coverage', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.main.mockResolvedValue(undefined);
    mocked.startDaemon.mockResolvedValue({ pid: 1111 });
    mocked.stopDaemon.mockReturnValue({ stopped: true, pid: 2222 });
    mocked.getServerStatus.mockReturnValue({
      running: true,
      pid: 1111,
      pidFile: '/tmp/huskygate.pid',
      logFile: '/tmp/huskygate.log',
    });
    mocked.readPidFile.mockReturnValue(null);
    mocked.isProcessRunning.mockReturnValue(false);
    mocked.spawn.mockReturnValue({ pid: 3333, unref: vi.fn() });
    mocked.existsSync.mockReturnValue(false);
    mocked.readFileSync.mockReturnValue('');
    mocked.loadConfig.mockReturnValue({
      dashboardSecret: 'dashboard-secret',
      serverApiPort: 3738,
      serverApiSecret: 'api-secret',
    });
    mocked.loadDashboardConfig.mockReturnValue({
      dashboardSecret: 'dashboard-secret',
      serverApiPort: 3738,
      serverApiSecret: 'api-secret',
      workdirRoot: '/tmp/workdir',
    });
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

  it('runs foreground dev command and handles fatal error branch', async () => {
    mocked.existsSync.mockImplementation((path?: string) => !!path?.endsWith('.env'));
    await runCli(['dev']);
    expect(mocked.loadCompatibilityEnvFile).toHaveBeenCalled();
    expect(mocked.main).toHaveBeenCalledOnce();

    mocked.main.mockRejectedValueOnce(new Error('boom'));
    await runCli(['dev']);
    expect(mocked.loggerError).toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles server start/stop/status commands', async () => {
    await runCli(['server', 'start']);
    expect(mocked.startDaemon).toHaveBeenCalledOnce();
    expect(mocked.startDaemon).toHaveBeenCalledWith({ force: undefined });
    expect(mocked.formatStarted).toHaveBeenCalledWith(
      'Server',
      { PID: 1111 },
      'huskygate server stop',
    );

    mocked.startDaemon.mockResolvedValueOnce({ alreadyRunning: true, pid: 9999 });
    await runCli(['server', 'start']);
    expect(mocked.formatAlreadyRunningWithHint).toHaveBeenCalledWith(
      'Server',
      { PID: 9999 },
      {
        restart: 'huskygate server stop && huskygate server start',
        force: 'huskygate server start --force',
      },
    );

    mocked.startDaemon.mockResolvedValueOnce({ error: 'spawn failed' });
    await runCli(['server', 'start']);
    expect(consoleErrSpy).toHaveBeenCalledWith('spawn failed');
    expect(processExitSpy).toHaveBeenCalledWith(1);

    await runCli(['server', 'stop']);
    expect(mocked.stopDaemon).toHaveBeenCalled();
    expect(mocked.formatStopped).toHaveBeenCalledWith(
      'Server',
      { PID: 2222 },
      'huskygate server start',
    );

    mocked.stopDaemon.mockReturnValueOnce({ error: 'not running' });
    await runCli(['server', 'stop']);
    expect(consoleErrSpy).toHaveBeenCalledWith('not running');

    // With config-based port resolution, invalid env values are ignored —
    // stopDaemon always receives the port from loadBootstrapConfig().
    const originalApiPort = process.env.SERVER_API_PORT;
    process.env.SERVER_API_PORT = 'not-a-number';
    await runCli(['server', 'stop']);
    expect(mocked.stopDaemon).toHaveBeenLastCalledWith(3738);
    if (originalApiPort === undefined) {
      delete process.env.SERVER_API_PORT;
    } else {
      process.env.SERVER_API_PORT = originalApiPort;
    }

    mocked.getServerStatus.mockReturnValueOnce({
      running: true,
      pid: 1111,
      pidFile: '/tmp/pid',
      logFile: '/tmp/log',
    });
    await runCli(['server', 'status']);
    expect(mocked.formatStatus).toHaveBeenCalledWith('Server', true, {
      PID: 1111,
      'PID file': '/tmp/pid',
      'Log file': '/tmp/log',
    });

    mocked.getServerStatus.mockReturnValueOnce({
      running: false,
      pid: null,
      pidFile: '/tmp/pid',
      logFile: '/tmp/log',
    });
    await runCli(['server', 'status']);
    expect(mocked.formatStatus).toHaveBeenCalledWith('Server', false, {
      'PID file': '/tmp/pid',
      'Log file': '/tmp/log',
    });
  });

  it('handles dashboard start invalid port and already-running cases', async () => {
    await runCli(['dashboard', 'start', '--port', '99999']);
    expect(consoleErrSpy).toHaveBeenCalledWith('Invalid port: 99999');
    expect(processExitSpy).toHaveBeenCalledWith(1);

    mocked.readPidFile.mockReturnValueOnce(4444);
    mocked.isProcessRunning.mockReturnValueOnce(true);
    await runCli(['dashboard', 'start', '--port', '3737']);
    expect(mocked.formatAlreadyRunningWithHint).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 4444, URL: 'http://localhost:3737' },
      {
        restart: 'huskygate dashboard stop && huskygate dashboard start',
        force: 'huskygate dashboard start --force',
      },
    );
  });

  it('handles dashboard start stale pid, spawn failure, and success/open branch', async () => {
    mocked.readPidFile.mockReturnValueOnce(4444);
    mocked.isProcessRunning.mockReturnValueOnce(false);
    mocked.existsSync.mockImplementation((path?: string) => !!path?.endsWith('dashboard.pid'));
    mocked.spawn.mockReturnValueOnce({ pid: undefined, unref: vi.fn() });
    await runCli(['dashboard', 'start']);
    expect(mocked.removePidFile).toHaveBeenCalled();
    expect(consoleErrSpy).toHaveBeenCalledWith('Failed to start dashboard process');
    expect(processExitSpy).toHaveBeenCalledWith(1);

    mocked.existsSync.mockReturnValue(false);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 5555, unref });
    await runCli(['dashboard', 'start', '--port', '4747']);
    expect(mocked.writePidFile).toHaveBeenCalled();
    expect(unref).toHaveBeenCalled();
    expect(mocked.renderBanner).toHaveBeenCalledWith('0.1.0-test');
    expect(mocked.formatStarted).toHaveBeenCalledWith(
      'Dashboard',
      expect.objectContaining({
        PID: 5555,
        URL: expect.stringContaining('http://localhost:4747/auth#token='),
      }),
      'huskygate dashboard stop',
    );
    // openBrowser uses module-level isWindows/isMacOS constants from platform.ts,
    // so process.platform overrides have no effect here. Platform-specific branches
    // are tested in platform.coverage.test.ts. Here we only verify execFile was called.
    expect(mocked.execFile).toHaveBeenCalled();
  });

  it('handles dashboard start immediate exit with log tail output', async () => {
    mocked.existsSync.mockReturnValue(false);
    mocked.spawn.mockReturnValueOnce({ pid: 9001, unref: vi.fn() });
    mocked.waitForProcessAlive.mockResolvedValueOnce(false);
    mocked.readFileSync.mockReturnValueOnce('line-1\nline-2\n');

    await runCli(['dashboard', 'start', '--port', '5757', '--no-open']);

    expect(mocked.removePidFile).toHaveBeenCalled();
    expect(consoleErrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dashboard exited immediately after start:'),
    );
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('line-1'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles dashboard start immediate exit when log tail cannot be read', async () => {
    mocked.existsSync.mockReturnValue(false);
    mocked.spawn.mockReturnValueOnce({ pid: 9002, unref: vi.fn() });
    mocked.waitForProcessAlive.mockResolvedValueOnce(false);
    mocked.readFileSync.mockImplementationOnce(() => {
      throw new Error('read failed');
    });

    await runCli(['dashboard', 'start', '--port', '5758', '--no-open']);

    expect(consoleErrSpy).toHaveBeenCalledWith('Dashboard exited immediately after start');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles dashboard stop/status and kill error tolerance', async () => {
    mocked.readPidFile.mockReturnValueOnce(null);
    mocked.existsSync.mockReturnValueOnce(true);
    await runCli(['dashboard', 'stop']);
    expect(mocked.removePidFile).toHaveBeenCalled();
    expect(mocked.formatNotRunning).toHaveBeenCalledWith('Dashboard');

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
      throw new Error('already dead');
    }) as never);
    mocked.readPidFile.mockReturnValueOnce(7777);
    mocked.isProcessRunning.mockReturnValueOnce(true);
    await runCli(['dashboard', 'stop']);
    expect(mocked.removePidFile).toHaveBeenCalled();
    expect(mocked.formatStopped).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 7777 },
      'huskygate dashboard start',
    );
    killSpy.mockRestore();

    mocked.readPidFile.mockReturnValueOnce(8888);
    mocked.isProcessRunning.mockReturnValueOnce(true);
    await runCli(['dashboard', 'status']);
    expect(mocked.formatStatus).toHaveBeenCalledWith('Dashboard', true, { PID: 8888 });

    mocked.readPidFile.mockReturnValueOnce(null);
    await runCli(['dashboard', 'status']);
    expect(mocked.formatStatus).toHaveBeenCalledWith('Dashboard', false, {});
  });

  it('handles dashboard stop port fallback branch', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
      throw new Error('already exited');
    }) as never);
    mocked.readPidFile.mockReturnValueOnce(null);
    mocked.findPidOnPort.mockReturnValueOnce(4321);
    mocked.existsSync.mockReturnValueOnce(true);

    await runCli(['dashboard', 'stop', '--port', '4848']);

    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(mocked.removePidFile).toHaveBeenCalled();
    expect(mocked.formatStopped).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 4321, Port: 4848 },
      'huskygate dashboard start',
    );
    killSpy.mockRestore();
  });

  // ─── Top-level start / stop / restart / status ─────────────────────────────

  it('handles top-level start: server + dashboard', async () => {
    mocked.existsSync.mockReturnValue(false);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 5555, unref });

    await runCli(['start', '--port', '4747', '--no-open']);

    expect(mocked.startDaemon).toHaveBeenCalledOnce();
    expect(mocked.startDaemon).toHaveBeenCalledWith({ force: false });
    expect(mocked.renderBanner).toHaveBeenCalledWith('0.1.0-test');
    expect(mocked.formatStarted).toHaveBeenCalledWith('Server', { PID: 1111 });
    expect(mocked.formatStarted).toHaveBeenCalledWith(
      'Dashboard',
      expect.objectContaining({
        PID: 5555,
        URL: expect.stringContaining('http://localhost:4747/auth#token='),
      }),
    );
    expect(mocked.formatOverviewTable).toHaveBeenCalled();
    expect(mocked.formatHint).toHaveBeenCalledWith('To stop', 'huskygate stop');
  });

  it('handles top-level start: server already running shows hint', async () => {
    mocked.startDaemon.mockResolvedValueOnce({ alreadyRunning: true, pid: 9999 });
    mocked.existsSync.mockReturnValue(false);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 5555, unref });

    await runCli(['start', '--no-open']);

    // Should NOT exit — continue to start dashboard
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(mocked.formatAlreadyRunningWithHint).toHaveBeenCalledWith(
      'Server',
      { PID: 9999 },
      { restart: 'huskygate restart', force: 'huskygate start --force' },
    );
  });

  it('handles top-level start: server error exits', async () => {
    mocked.startDaemon.mockResolvedValueOnce({ error: 'spawn failed' });
    await runCli(['start', '--no-open']);

    expect(consoleErrSpy).toHaveBeenCalledWith('spawn failed');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles top-level start: invalid port', async () => {
    await runCli(['start', '--port', '99999']);
    expect(consoleErrSpy).toHaveBeenCalledWith('Invalid port: 99999');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles top-level start: dashboard already running', async () => {
    mocked.readPidFile.mockReturnValueOnce(4444);
    mocked.isProcessRunning.mockReturnValueOnce(true);

    await runCli(['start', '--port', '3737', '--no-open']);

    expect(mocked.startDaemon).toHaveBeenCalled();
    expect(mocked.formatStarted).toHaveBeenCalledWith('Server', { PID: 1111 });
    expect(mocked.formatAlreadyRunningWithHint).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 4444, URL: 'http://localhost:3737' },
      { restart: 'huskygate restart', force: 'huskygate start --force' },
    );
  });

  it('handles top-level start: dashboard error (server still reported)', async () => {
    mocked.existsSync.mockReturnValue(false);
    mocked.spawn.mockReturnValueOnce({ pid: undefined, unref: vi.fn() });

    await runCli(['start', '--port', '3737', '--no-open']);

    expect(mocked.formatStarted).toHaveBeenCalledWith('Server', { PID: 1111 });
    expect(consoleErrSpy).toHaveBeenCalledWith('Failed to start dashboard process');
    // Should NOT exit — server is still running
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('handles top-level stop: dashboard + server', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {}) as never);
    mocked.readPidFile.mockReturnValueOnce(7777);
    mocked.isProcessRunning.mockReturnValueOnce(true);

    await runCli(['stop']);

    expect(mocked.renderByeBanner).toHaveBeenCalled();
    expect(mocked.formatStopped).toHaveBeenCalledWith('Dashboard', { PID: 7777 });
    expect(mocked.formatStopped).toHaveBeenCalledWith('Server', { PID: 2222 });
    expect(mocked.formatHint).toHaveBeenCalledWith('To restart', 'huskygate start');
    killSpy.mockRestore();
  });

  it('handles top-level stop: nothing running', async () => {
    mocked.readPidFile.mockReturnValue(null);
    mocked.stopDaemon.mockReturnValueOnce({ error: 'Server is not running' });

    await runCli(['stop']);

    expect(mocked.renderByeBanner).toHaveBeenCalled();
    expect(mocked.formatNotRunning).toHaveBeenCalledWith('Dashboard');
    expect(mocked.formatNotRunning).toHaveBeenCalledWith('Server');
    expect(mocked.formatHint).toHaveBeenCalledWith('To start', 'huskygate start');
  });

  it('handles top-level restart: stop then start', async () => {
    mocked.existsSync.mockReturnValue(false);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 8888, unref });

    await runCli(['restart', '--port', '4747', '--no-open']);

    // Stop phase called stopDaemon
    expect(mocked.stopDaemon).toHaveBeenCalled();
    // Start phase
    expect(mocked.startDaemon).toHaveBeenCalled();
    expect(mocked.renderBanner).toHaveBeenCalledWith('0.1.0-test');
    expect(mocked.formatStarted).toHaveBeenCalledWith('Server', { PID: 1111 });
    expect(mocked.formatStarted).toHaveBeenCalledWith(
      'Dashboard',
      expect.objectContaining({
        PID: 8888,
        URL: expect.stringContaining('http://localhost:4747/auth#token='),
      }),
    );
    expect(mocked.formatOverviewTable).toHaveBeenCalled();
    expect(mocked.formatHint).toHaveBeenCalledWith('To stop', 'huskygate stop');
  });

  it('handles top-level restart: invalid port', async () => {
    await runCli(['restart', '--port', '-1']);
    expect(consoleErrSpy).toHaveBeenCalledWith('Invalid port: -1');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('handles top-level status: both services', async () => {
    mocked.getServerStatus.mockReturnValueOnce({
      running: true,
      pid: 1111,
      pidFile: '/tmp/pid',
      logFile: '/tmp/log',
    });
    mocked.readPidFile.mockReturnValueOnce(2222);
    mocked.isProcessRunning.mockReturnValueOnce(true);

    await runCli(['status']);

    expect(mocked.formatVersionHeader).toHaveBeenCalledWith('0.1.0-test');
    expect(mocked.formatStatusIndicator).toHaveBeenCalledWith(true, 1111);
    expect(mocked.formatStatusIndicator).toHaveBeenCalledWith(true, 2222);
    expect(mocked.formatOverviewTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['Server', expect.any(String)],
        ['Dashboard', expect.any(String)],
        ['Server API', 'http://127.0.0.1:3738'],
        ['Dashboard URL', 'http://localhost:3737'],
      ]),
    );
  });

  it('handles top-level status: both not running', async () => {
    mocked.getServerStatus.mockReturnValueOnce({
      running: false,
      pid: null,
      pidFile: '/tmp/pid',
      logFile: '/tmp/log',
    });
    mocked.readPidFile.mockReturnValueOnce(null);

    await runCli(['status']);

    expect(mocked.formatVersionHeader).toHaveBeenCalledWith('0.1.0-test');
    expect(mocked.formatStatusIndicator).toHaveBeenCalledWith(false, null);
    expect(mocked.formatStatusIndicator).toHaveBeenCalledWith(false, null);
    // Server API and Dashboard URL should NOT be included when not running
    expect(mocked.formatOverviewTable).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.arrayContaining(['Server API']),
        expect.arrayContaining(['Dashboard URL']),
      ]),
    );
  });

  it('handles dashboard-serve invalid and valid paths', async () => {
    await runCli(['dashboard-serve', '--port', '-1']);
    expect(processExitSpy).toHaveBeenCalledWith(1);

    await runCli(['dashboard-serve', '--port', '3838']);
    expect(mocked.createDashboardServer).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 3838,
        serverApiPort: 3738,
        serverApiSecret: 'api-secret',
        dashboardSecret: 'dashboard-secret',
      }),
    );
  });

  // ─── --force flag tests ──────────────────────────────────────────────────

  it('handles top-level start --force: restarts both server and dashboard', async () => {
    mocked.startDaemon.mockResolvedValueOnce({ pid: 2222, restarted: true });
    mocked.existsSync.mockReturnValue(false);
    // Dashboard: readPidFile returns running PID (force will stop + restart it)
    mocked.readPidFile.mockReturnValueOnce(4444);
    mocked.isProcessRunning.mockReturnValueOnce(true);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {}) as never);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 5555, unref });

    await runCli(['start', '--force', '--port', '3737', '--no-open']);

    expect(mocked.startDaemon).toHaveBeenCalledWith({ force: true });
    expect(mocked.formatRestarted).toHaveBeenCalledWith('Server', { PID: 2222 });
    // Dashboard was force-restarted
    expect(mocked.formatRestarted).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 5555, URL: expect.stringContaining('localhost:3737') },
    );
    expect(mocked.formatOverviewTable).toHaveBeenCalled();
    expect(mocked.formatHint).toHaveBeenCalledWith('To stop', 'huskygate stop');
    killSpy.mockRestore();
  });

  it('handles server start --force: restarts server', async () => {
    mocked.startDaemon.mockResolvedValueOnce({ pid: 3333, restarted: true });
    await runCli(['server', 'start', '--force']);

    expect(mocked.startDaemon).toHaveBeenCalledWith({ force: true });
    expect(mocked.formatRestarted).toHaveBeenCalledWith(
      'Server',
      { PID: 3333 },
      'huskygate server stop',
    );
  });

  it('handles dashboard start --force: restarts dashboard', async () => {
    // Simulate already-running dashboard that will be force-stopped
    mocked.readPidFile.mockReturnValueOnce(4444);
    mocked.isProcessRunning.mockReturnValueOnce(true);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {}) as never);
    mocked.existsSync.mockReturnValue(false);
    const unref = vi.fn();
    mocked.spawn.mockReturnValueOnce({ pid: 6666, unref });

    await runCli(['dashboard', 'start', '--force', '--port', '3737', '--no-open']);

    expect(mocked.formatRestarted).toHaveBeenCalledWith(
      'Dashboard',
      { PID: 6666, URL: expect.stringContaining('localhost:3737') },
      'huskygate dashboard stop',
    );
    killSpy.mockRestore();
  });
});
