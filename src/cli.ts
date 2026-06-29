/** @module cli — Commander-based CLI: start/stop/restart/status for server + dashboard. */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  formatAlreadyRunning,
  formatAlreadyRunningWithHint,
  formatHint,
  formatNotRunning,
  formatOverviewTable,
  formatRestarted,
  formatSetupRequired,
  formatStarted,
  formatStatus,
  formatStatusIndicator,
  formatStopped,
  formatVersionHeader,
  renderBanner,
  renderByeBanner,
} from './cli/banner.js';
import { checkDaemonReadiness, loadCompatibilityEnvFile } from './config.js';
import { main } from './index.js';
import { errorMessage } from './utils/error.js';
import { logger } from './utils/logger.js';
import { getDetachedSpawnOptions, openBrowser, terminateProcess } from './utils/platform.js';

function loadEnvFile(): ReadonlySet<string> {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return new Set();
  }
  return loadCompatibilityEnvFile(process.cwd(), process.env);
}

const program = new Command();

declare const __APP_VERSION__: string;

program
  .name('HuskyGate')
  .version(__APP_VERSION__)
  .description('Slack Remote LLM CLI Orchestrator')
  .option('-d, --data-dir <path>', 'Data directory path (env: HUSKYGATE_DATA_DIR)');

program.hook('preAction', () => {
  const opts = program.opts<{ dataDir?: string }>();
  if (opts.dataDir) {
    process.env.HUSKYGATE_DATA_DIR = resolve(opts.dataDir);
  }
});

function getDataDir(): string {
  return process.env.HUSKYGATE_DATA_DIR || resolve(process.cwd(), 'data');
}

/** Print the overview table shown after start/restart. Falls back gracefully on config errors. */
async function printStartOverview(serverApiPort?: number): Promise<void> {
  let port = serverApiPort;
  if (port === undefined) {
    try {
      const { loadBootstrapConfig } = await import('./config.js');
      port = loadBootstrapConfig().serverApiPort;
    } catch {
      port = 3738;
    }
  }
  console.log('');
  console.log(
    formatOverviewTable([
      ['Server API', `http://127.0.0.1:${port}`],
      ['Platform', `${process.platform} ${process.arch} · node ${process.version}`],
      ['Data dir', getDataDir()],
    ]),
  );
  console.log('');
}

async function startForeground(): Promise<void> {
  loadEnvFile();

  // Pre-check config readiness for actionable error messages
  const { loadKeychainSecrets } = await import('./utils/keychain.js');
  const { SENSITIVE_KEYS } = await import('./config.js');
  const keychainSecrets = await loadKeychainSecrets(SENSITIVE_KEYS);
  const readiness = checkDaemonReadiness({ secureStoreValues: keychainSecrets });
  if (!readiness.ready) {
    console.log('');
    console.log(formatSetupRequired(readiness.missingKeys));
    console.log('');
    process.exit(1);
  }

  try {
    await main();
  } catch (err) {
    logger.error('fatal', { error: errorMessage(err) });
    process.exit(1);
  }
}

// ── Internal helpers ──

/**
 * Spawn the dashboard background process.
 * Returns PID + URL on success, or { alreadyRunning } / { error }.
 */
async function startDashboardProcess(
  port: number,
  opts?: { force?: boolean },
): Promise<
  | { pid: number; url: string; restarted?: boolean }
  | { alreadyRunning: true; pid: number; url: string }
  | { error: string }
> {
  const { loadBootstrapConfig } = await import('./config.js');
  const config = loadBootstrapConfig();
  const dashboardSecret = config.dashboardSecret;

  const {
    readPidFile,
    isProcessRunning,
    writePidFile,
    removePidFile,
    waitForProcessAlive,
    portReleaseDelay,
  } = await import('./server/daemon.js');
  const { spawn } = await import('node:child_process');
  const { closeSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const { ensurePrivateDirectory, ensurePrivateFile, openPrivateAppendFile } = await import(
    './utils/fs-security.js'
  );

  const dataDir = getDataDir();
  const pidPath = resolve(dataDir, 'dashboard.pid');
  const logPath = resolve(dataDir, 'dashboard.log');
  const dashboardBootstrapToken = randomBytes(24).toString('base64url');

  // Check if already running
  const existingPid = readPidFile(pidPath);
  const alreadyRunning = existingPid !== null && isProcessRunning(existingPid);
  if (alreadyRunning) {
    if (!opts?.force) {
      return { alreadyRunning: true, pid: existingPid, url: `http://localhost:${port}` };
    }
    // Force mode: stop existing process first
    await stopDashboardProcess(port);
    await portReleaseDelay();
  }

  // Clean up stale PID file
  if (existsSync(pidPath)) {
    removePidFile(pidPath);
  }

  // Ensure data dir exists
  const logDir = dirname(logPath);
  ensurePrivateDirectory(logDir);

  const logFd = openPrivateAppendFile(logPath);

  const child = spawn(
    process.execPath,
    [process.argv[1] ?? '', 'dashboard-serve', '--port', String(port)],
    getDetachedSpawnOptions({
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: process.cwd(),
      env: {
        ...process.env,
        DASHBOARD_SECRET: dashboardSecret,
        DASHBOARD_BOOTSTRAP_TOKEN: dashboardBootstrapToken,
        SERVER_API_SECRET: config.serverApiSecret,
      },
    }),
  );

  closeSync(logFd);
  ensurePrivateFile(logPath);

  if (child.pid === undefined) {
    return { error: 'Failed to start dashboard process' };
  }

  writePidFile(pidPath, child.pid);
  child.unref();

  // Health check: wait briefly and verify process didn't crash immediately
  const alive = await waitForProcessAlive(child.pid);
  if (!alive) {
    removePidFile(pidPath);
    try {
      const { readFileSync } = await import('node:fs');
      const logContent = readFileSync(logPath, 'utf-8');
      const tail = logContent.split('\n').filter(Boolean).slice(-5).join('\n');
      return { error: `Dashboard exited immediately after start:\n${tail}` };
    } catch {
      return { error: 'Dashboard exited immediately after start' };
    }
  }

  const url = `http://localhost:${port}/auth#token=${encodeURIComponent(dashboardBootstrapToken)}`;
  return alreadyRunning ? { pid: child.pid, url, restarted: true } : { pid: child.pid, url };
}

/**
 * Stop the dashboard process.
 * Returns stopped PID info, or null if dashboard was not running.
 */
async function stopDashboardProcess(port: number): Promise<{ pid: number; port?: number } | null> {
  const { readPidFile, isProcessRunning, removePidFile, findPidOnPort } = await import(
    './server/daemon.js'
  );

  const dataDir = getDataDir();
  const pidPath = resolve(dataDir, 'dashboard.pid');

  const pid = readPidFile(pidPath);
  if (pid !== null && isProcessRunning(pid)) {
    try {
      terminateProcess(pid);
    } catch {
      // Process may have already exited
    }
    removePidFile(pidPath);
    return { pid };
  }

  // PID file stale/missing — try port-based detection as fallback
  if (!Number.isNaN(port)) {
    const portPid = findPidOnPort(port);
    if (portPid !== null) {
      try {
        terminateProcess(portPid);
      } catch {
        // Process may have already exited
      }
      if (existsSync(pidPath)) {
        removePidFile(pidPath);
      }
      return { pid: portPid, port };
    }
  }

  if (existsSync(pidPath)) {
    removePidFile(pidPath);
  }
  return null;
}

// ── Commands ──

program
  .command('setup')
  .description('Interactive first-time setup (create Slack App + configure tokens)')
  .option('--no-open', 'Do not auto-open browser')
  .option('--manifest-only', 'Print Slack App manifest JSON and exit')
  .option('--status', 'Check if setup has been completed')
  .option('--reset', 'Clear all setup-related configuration (with confirmation)')
  .action(
    async (opts: { open: boolean; manifestOnly?: boolean; status?: boolean; reset?: boolean }) => {
      loadEnvFile();
      const { runSetup } = await import('./setup/setup-command.js');
      await runSetup({
        open: opts.open,
        manifestOnly: opts.manifestOnly,
        status: opts.status,
        reset: opts.reset,
      });
    },
  );

program
  .command('dev')
  .description('Start the server in foreground (development)')
  .action(startForeground);

// ── Top-level start / stop / restart / status ──

program
  .command('start')
  .description('Start server and dashboard')
  .option('--port <port>', 'Dashboard port', '3737')
  .option('--no-open', 'Do not auto-open browser')
  .option('-f, --force', 'Stop existing processes before starting')
  .action(async (opts: { port: string; open: boolean; force?: boolean }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(`Invalid port: ${opts.port}`);
      process.exit(1);
    }

    const force = opts.force ?? false;
    const version = String(program.version());

    // Check if daemon config is complete before attempting to start it
    const { loadKeychainSecrets } = await import('./utils/keychain.js');
    const { SENSITIVE_KEYS } = await import('./config.js');
    const keychainSecrets = await loadKeychainSecrets(SENSITIVE_KEYS);
    const readiness = checkDaemonReadiness({ secureStoreValues: keychainSecrets });

    if (!readiness.ready) {
      // Config incomplete — start dashboard only so users can configure via UI
      const dashResult = await startDashboardProcess(port, { force });

      console.log(renderBanner(version));
      if ('error' in dashResult) {
        console.error(dashResult.error);
        console.log('');
        console.log(formatSetupRequired(readiness.missingKeys));
      } else if ('alreadyRunning' in dashResult) {
        console.log(formatSetupRequired(readiness.missingKeys, dashResult.url));
      } else {
        console.log(formatSetupRequired(readiness.missingKeys, dashResult.url));
        if (opts.open) {
          await openBrowser(dashResult.url);
        }
      }
      return;
    }

    const { startDaemon } = await import('./server/daemon.js');
    const serverResult = await startDaemon({ force });
    if ('error' in serverResult) {
      console.error(serverResult.error);
      process.exit(1);
    }

    const dashResult = await startDashboardProcess(port, { force });

    console.log(renderBanner(version));
    if ('alreadyRunning' in serverResult) {
      console.log(
        formatAlreadyRunningWithHint(
          'Server',
          { PID: serverResult.pid },
          {
            restart: 'huskygate restart',
            force: 'huskygate start --force',
          },
        ),
      );
    } else if (serverResult.restarted) {
      console.log(formatRestarted('Server', { PID: serverResult.pid }));
    } else {
      console.log(formatStarted('Server', { PID: serverResult.pid }));
    }

    if ('alreadyRunning' in dashResult) {
      console.log(
        formatAlreadyRunningWithHint(
          'Dashboard',
          { PID: dashResult.pid, URL: dashResult.url },
          {
            restart: 'huskygate restart',
            force: 'huskygate start --force',
          },
        ),
      );
    } else if ('error' in dashResult) {
      console.error(dashResult.error);
    } else {
      const dashFormatter = dashResult.restarted ? formatRestarted : formatStarted;
      console.log(dashFormatter('Dashboard', { PID: dashResult.pid, URL: dashResult.url }));
    }

    // Overview
    await printStartOverview();
    console.log(formatHint('To stop', 'huskygate stop'));

    if (!('alreadyRunning' in dashResult) && !('error' in dashResult) && opts.open) {
      await openBrowser(dashResult.url);
    }
  });

program
  .command('stop')
  .description('Stop server and dashboard')
  .option('--port <port>', 'Dashboard port', '3737')
  .action(async (opts: { port: string }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10);

    const dashResult = await stopDashboardProcess(Number.isNaN(port) ? 0 : port);

    const { stopDaemon } = await import('./server/daemon.js');
    const { loadBootstrapConfig } = await import('./config.js');
    const bootstrap = loadBootstrapConfig();
    const serverResult = stopDaemon(bootstrap.serverApiPort);

    console.log(renderByeBanner());
    if (dashResult !== null) {
      const details: Record<string, string | number> = { PID: dashResult.pid };
      if (dashResult.port !== undefined) details.Port = dashResult.port;
      console.log(formatStopped('Dashboard', details));
    } else {
      console.log(formatNotRunning('Dashboard'));
    }

    if ('error' in serverResult) {
      console.log(formatNotRunning('Server'));
    } else {
      console.log(formatStopped('Server', { PID: serverResult.pid }));
    }

    const anythingStopped = dashResult !== null || !('error' in serverResult);
    console.log('');
    console.log(formatHint(anythingStopped ? 'To restart' : 'To start', 'huskygate start'));
  });

program
  .command('restart')
  .description('Restart server and dashboard')
  .option('--port <port>', 'Dashboard port', '3737')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts: { port: string; open: boolean }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(`Invalid port: ${opts.port}`);
      process.exit(1);
    }

    await stopDashboardProcess(port);
    const { startDaemon, stopDaemon } = await import('./server/daemon.js');
    const { loadBootstrapConfig } = await import('./config.js');
    const bootstrap = loadBootstrapConfig();
    stopDaemon(bootstrap.serverApiPort);

    const serverResult = await startDaemon();
    if ('error' in serverResult) {
      console.error(serverResult.error);
      process.exit(1);
    }

    const dashResult = await startDashboardProcess(port);

    const version = String(program.version());
    console.log(renderBanner(version));
    console.log(formatStarted('Server', { PID: serverResult.pid }));

    if ('alreadyRunning' in dashResult) {
      console.log(formatAlreadyRunning('Dashboard', { PID: dashResult.pid, URL: dashResult.url }));
    } else if ('error' in dashResult) {
      console.error(dashResult.error);
    } else {
      console.log(formatStarted('Dashboard', { PID: dashResult.pid, URL: dashResult.url }));
    }

    // Overview
    await printStartOverview(bootstrap.serverApiPort);
    console.log(formatHint('To stop', 'huskygate stop'));

    if (!('alreadyRunning' in dashResult) && !('error' in dashResult) && opts.open) {
      await openBrowser(dashResult.url);
    }
  });

program
  .command('status')
  .description('Show server and dashboard status')
  .option('--port <port>', 'Dashboard port', '3737')
  .action(async (opts: { port: string }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10) || 3737;
    const version = String(program.version());

    const { getServerStatus, getPidFilePath, readPidFile, isProcessRunning } = await import(
      './server/daemon.js'
    );

    // Server status
    const serverStatus = getServerStatus(getPidFilePath());

    // Dashboard status
    const dataDir = getDataDir();
    const dashPidPath = resolve(dataDir, 'dashboard.pid');
    const dashPid = readPidFile(dashPidPath);
    const dashRunning = dashPid !== null && isProcessRunning(dashPid);

    // Server API port from config
    let serverApiPort = 3738;
    try {
      const { loadBootstrapConfig } = await import('./config.js');
      const bootstrap = loadBootstrapConfig();
      serverApiPort = bootstrap.serverApiPort;
    } catch {
      // Use default if config can't be loaded
    }

    console.log('');
    console.log(formatVersionHeader(version));
    console.log('');

    const rows: [string, string][] = [
      ['Server', formatStatusIndicator(serverStatus.running, serverStatus.pid)],
      ['Dashboard', formatStatusIndicator(dashRunning, dashPid)],
    ];

    if (serverStatus.running) {
      rows.push(['Server API', `http://127.0.0.1:${serverApiPort}`]);
    }
    if (dashRunning) {
      rows.push(['Dashboard URL', `http://localhost:${port}`]);
    }

    rows.push(
      ['Platform', `${process.platform} ${process.arch} · node ${process.version}`],
      ['Data dir', dataDir],
      ['PID file', serverStatus.pidFile],
      ['Log file', serverStatus.logFile],
    );

    console.log(formatOverviewTable(rows));
    console.log('');
  });

// ── server subcommand ──

const server = program.command('server').description('Manage the background daemon');

server
  .command('start')
  .description('Start the background daemon')
  .option('-f, --force', 'Stop existing process before starting')
  .action(async (opts: { force?: boolean }) => {
    const { startDaemon } = await import('./server/daemon.js');
    const result = await startDaemon({ force: opts.force });
    if ('alreadyRunning' in result) {
      console.log(
        formatAlreadyRunningWithHint(
          'Server',
          { PID: result.pid },
          {
            restart: 'huskygate server stop && huskygate server start',
            force: 'huskygate server start --force',
          },
        ),
      );
      return;
    }
    if ('error' in result) {
      console.error(result.error);
      process.exit(1);
    }
    if (result.restarted) {
      console.log(formatRestarted('Server', { PID: result.pid }, 'huskygate server stop'));
    } else {
      console.log(formatStarted('Server', { PID: result.pid }, 'huskygate server stop'));
    }
  });

server
  .command('stop')
  .description('Stop the background daemon')
  .action(async () => {
    loadEnvFile();
    const { stopDaemon } = await import('./server/daemon.js');
    const { loadBootstrapConfig } = await import('./config.js');
    const bootstrap = loadBootstrapConfig();
    const result = stopDaemon(bootstrap.serverApiPort);
    if ('error' in result) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(formatStopped('Server', { PID: result.pid }, 'huskygate server start'));
  });

server
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const { getServerStatus, getPidFilePath } = await import('./server/daemon.js');
    const status = getServerStatus(getPidFilePath());
    const details: Record<string, string | number> = {};
    if (status.pid !== null) details.PID = status.pid;
    details['PID file'] = status.pidFile;
    details['Log file'] = status.logFile;
    console.log(formatStatus('Server', status.running, details));
  });

// ── dashboard subcommand ──

const dashboard = program.command('dashboard').description('Manage the web dashboard');

dashboard
  .command('start', { isDefault: true })
  .description('Start the dashboard (background)')
  .option('--port <port>', 'Dashboard port', '3737')
  .option('--no-open', 'Do not auto-open browser')
  .option('-f, --force', 'Stop existing process before starting')
  .action(async (opts: { port: string; open: boolean; force?: boolean }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(`Invalid port: ${opts.port}`);
      process.exit(1);
    }

    const result = await startDashboardProcess(port, { force: opts.force });

    if ('alreadyRunning' in result) {
      console.log(
        formatAlreadyRunningWithHint(
          'Dashboard',
          { PID: result.pid, URL: result.url },
          {
            restart: 'huskygate dashboard stop && huskygate dashboard start',
            force: 'huskygate dashboard start --force',
          },
        ),
      );
      return;
    }
    if ('error' in result) {
      console.error(result.error);
      process.exit(1);
    }

    const version = String(program.version());
    console.log(renderBanner(version));
    const formatter = result.restarted ? formatRestarted : formatStarted;
    console.log(
      formatter('Dashboard', { PID: result.pid, URL: result.url }, 'huskygate dashboard stop'),
    );

    if (opts.open) {
      await openBrowser(result.url);
    }
  });

dashboard
  .command('stop')
  .description('Stop the dashboard')
  .option('--port <port>', 'Dashboard port to check for orphaned process', '3737')
  .action(async (opts: { port: string }) => {
    const port = Number.parseInt(opts.port, 10);
    const result = await stopDashboardProcess(Number.isNaN(port) ? 0 : port);

    if (result !== null) {
      const details: Record<string, string | number> = { PID: result.pid };
      if (result.port !== undefined) details.Port = result.port;
      console.log(formatStopped('Dashboard', details, 'huskygate dashboard start'));
    } else {
      console.log(formatNotRunning('Dashboard'));
    }
  });

dashboard
  .command('status')
  .description('Show dashboard status')
  .action(async () => {
    const { readPidFile, isProcessRunning } = await import('./server/daemon.js');

    const dataDir = getDataDir();
    const pidPath = resolve(dataDir, 'dashboard.pid');

    const pid = readPidFile(pidPath);
    const running = pid !== null && isProcessRunning(pid);
    const statusDetails: Record<string, string | number> = {};
    if (pid !== null) statusDetails.PID = pid;
    console.log(formatStatus('Dashboard', running, statusDetails));
  });

// Hidden: actual foreground dashboard server (spawned by 'dashboard start')
program
  .command('dashboard-serve', { hidden: true })
  .option('--port <port>', 'Dashboard port', '3737')
  .action(async (opts: { port: string }) => {
    loadEnvFile();
    const port = Number.parseInt(opts.port, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      process.exit(1);
    }
    const version = String(program.version());
    const dataDir = getDataDir();
    const { loadDashboardConfig } = await import('./config.js');
    const config = loadDashboardConfig();
    const { createDashboardServer } = await import('./dashboard/server.js');
    createDashboardServer({
      port,
      version,
      dataDir,
      serverApiPort: config.serverApiPort,
      serverApiSecret: config.serverApiSecret,
      dashboardSecret: config.dashboardSecret,
      dashboardBootstrapToken: process.env.DASHBOARD_BOOTSTRAP_TOKEN,
      workdirRoot: config.workdirRoot,
      allowInsecureCookie: !config.dashboardCookieSecure,
    });
  });

// ── keychain subcommand ──

const keychain = program.command('keychain').description('Manage OS keychain credentials');

keychain
  .command('status')
  .description('Check keychain availability')
  .action(async () => {
    const { getKeychainProvider } = await import('./utils/keychain.js');
    const kc = getKeychainProvider();
    const available = await kc.isAvailable();
    console.log(`Platform: ${kc.platform}`);
    console.log(`Available: ${available ? 'yes' : 'no'}`);
    if (!available) {
      console.log('Credentials will fall back to .env file.');
    }
  });

keychain
  .command('list')
  .description('List keys stored in keychain')
  .action(async () => {
    const { getKeychainProvider } = await import('./utils/keychain.js');
    const kc = getKeychainProvider();
    const available = await kc.isAvailable();
    if (!available) {
      console.log('Keychain is not available on this platform.');
      return;
    }
    const keys = await kc.listKeys();
    if (keys.length === 0) {
      console.log('No keys stored in keychain.');
    } else {
      console.log(`Keys in keychain (${keys.length}):`);
      for (const key of keys) {
        console.log(`  ${key}`);
      }
    }
  });

program.parse();
