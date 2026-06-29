/** @module dashboard/server — HTTP server for the HuskyGate dashboard SPA. */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import { resolve } from 'node:path';

import { findPidOnPort } from '../server/daemon.js';
import { TTLS } from '../shared/constants.js';
import { timingSafeEqualString } from '../shared/security.js';
import { errorMessage } from '../utils/error.js';
import { terminateProcess } from '../utils/platform.js';
import { renderApp } from './app.js';
import { clearDashboardCookie, isDashboardAuthed, setDashboardCookie } from './auth.js';
import { DashboardDb } from './db.js';
import { dashLog, json, parseJson, parseUrl, readBody } from './http.js';
import { createProxySSE, createProxySSEGet, createProxyToServerApi } from './proxy.js';
import type { RouteContext } from './route-context.js';

/* ── route handlers ── */
import { handleAgentRoutes } from './routes/agents.js';
import { handleChatRoutes } from './routes/chat.js';
import { handleDevAliasRoutes } from './routes/dev-aliases.js';
import { handleEventTriggerRoutes } from './routes/event-triggers.js';
import { handleFilesystemRoutes } from './routes/filesystem.js';
import { handleMcpRoutes } from './routes/mcp.js';
import { handleMetricsRoutes } from './routes/metrics.js';
import { handleOndemandTaskRoutes } from './routes/ondemand-tasks.js';
import { handleOrchestratorRoutes } from './routes/orchestrator.js';
import { handleScheduleTaskRoutes } from './routes/schedule-tasks.js';
import { handleSessionMcpRoutes } from './routes/session-mcp.js';
import { handleSessionRoutes } from './routes/sessions.js';
import { handleSettingsRoutes } from './routes/settings.js';
import { handleSetupRoutes, isSetupComplete } from './routes/setup.js';
import { handleSkillRoutes } from './routes/skills.js';
import { handleStatusRoutes } from './routes/status.js';

/* ── O-3: Rate limiter for bootstrap endpoint ── */
const BOOTSTRAP_MAX_ATTEMPTS = 5;
const BOOTSTRAP_WINDOW_MS = TTLS.bootstrapWindow;

function createBootstrapRateLimiter(): (ip: string) => boolean {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  let lastGc = Date.now();
  return (ip: string): boolean => {
    const now = Date.now();

    // Periodic GC: purge expired entries to prevent unbounded Map growth
    if (now - lastGc > BOOTSTRAP_WINDOW_MS) {
      for (const [key, entry] of attempts) {
        if (now >= entry.resetAt) attempts.delete(key);
      }
      lastGc = now;
    }

    const entry = attempts.get(ip);
    if (entry && now < entry.resetAt) {
      entry.count++;
      return entry.count > BOOTSTRAP_MAX_ATTEMPTS;
    }
    attempts.set(ip, { count: 1, resetAt: now + BOOTSTRAP_WINDOW_MS });
    return false;
  };
}

/* ── O-4: CSRF header name for state-changing requests ── */
const CSRF_HEADER = 'x-csrf-protection';
const CSRF_HEADER_VALUE = '1';

/** HTTP methods that require CSRF protection. */
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface DashboardServerOptions {
  port: number;
  version: string;
  dataDir: string;
  serverApiPort: number;
  serverApiSecret: string;
  dashboardSecret: string;
  dashboardBootstrapToken?: string;
  workdirRoot: string;
  /** Allow insecure (non-Secure) cookies. Only effective in development. */
  allowInsecureCookie?: boolean;
}

let dashboardProcessHandlerRefs = 0;
let dashboardUncaughtExceptionHandler: ((err: Error) => void) | null = null;
let dashboardUnhandledRejectionHandler: ((reason: unknown) => void) | null = null;

function attachDashboardProcessHandlers(): void {
  if (dashboardProcessHandlerRefs === 0) {
    dashboardUncaughtExceptionHandler = (err) => {
      try {
        dashLog('error', 'uncaught_exception', { error: errorMessage(err), stack: err.stack });
      } catch {
        process.stderr.write(
          `FATAL dashboard uncaught_exception: ${err?.message ?? String(err)}\n`,
        );
      }
      process.exit(1);
    };
    dashboardUnhandledRejectionHandler = (reason) => {
      try {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        dashLog('error', 'unhandled_rejection', { error: errorMessage(err), stack: err.stack });
      } catch {
        process.stderr.write(`FATAL dashboard unhandled_rejection: ${String(reason)}\n`);
      }
      process.exit(1);
    };
    process.on('uncaughtException', dashboardUncaughtExceptionHandler);
    process.on('unhandledRejection', dashboardUnhandledRejectionHandler);
  }
  dashboardProcessHandlerRefs++;
}

function detachDashboardProcessHandlers(): void {
  if (dashboardProcessHandlerRefs === 0) return;
  dashboardProcessHandlerRefs--;
  if (dashboardProcessHandlerRefs > 0) return;

  if (dashboardUncaughtExceptionHandler) {
    process.off('uncaughtException', dashboardUncaughtExceptionHandler);
    dashboardUncaughtExceptionHandler = null;
  }
  if (dashboardUnhandledRejectionHandler) {
    process.off('unhandledRejection', dashboardUnhandledRejectionHandler);
    dashboardUnhandledRejectionHandler = null;
  }
}

function renderAuthBootstrapPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>HuskyGate Dashboard Login</title>
</head>
<body>
  <p>Authenticating dashboard session...</p>
  <script>
    (async function () {
      const renderMessage = (text) => {
        const p = document.createElement('p');
        p.textContent = text;
        document.body.replaceChildren(p);
      };
      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get('token');
      if (!token) {
        renderMessage('Missing token. Start dashboard from CLI and open the provided URL.');
        return;
      }
      // Immediately clear the token from the URL to prevent leakage via
      // browser history, bookmarks, or shoulder surfing.
      history.replaceState(null, '', '/auth');
      try {
        const res = await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const message = typeof data.error === 'string' ? data.error : 'Authentication failed';
          throw new Error(message);
        }
        window.location.replace('/');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        renderMessage(message);
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Create and start the Dashboard HTTP server.
 *
 * This is the sole public export — tests and CLI entry points rely on it.
 * All route logic lives in `./routes/*.ts`; this module is a thin facade
 * that wires up auth, DB lifecycle, and the route handler chain.
 */
export function createDashboardServer(options: DashboardServerOptions): Server {
  const {
    port,
    version,
    dataDir,
    serverApiPort,
    serverApiSecret,
    dashboardSecret,
    dashboardBootstrapToken,
    workdirRoot,
    allowInsecureCookie,
  } = options;

  const serverApiBase = `http://127.0.0.1:${serverApiPort}`;
  const proxyToServerApi = createProxyToServerApi(serverApiBase, serverApiSecret);
  const proxySSE = createProxySSE(serverApiBase, serverApiSecret);
  const proxySSEGet = createProxySSEGet(serverApiBase, serverApiSecret);

  const dbPath = resolve(dataDir, 'orchestrator.db');
  const logPath = resolve(dataDir, 'huskygate.log');
  const dashboardLogPath = resolve(dataDir, 'dashboard.log');
  let activeBootstrapToken = dashboardBootstrapToken ?? null;
  const isBootstrapRateLimited = createBootstrapRateLimiter();

  let dashDb: DashboardDb | null = null;

  function getDb(): DashboardDb {
    if (!dashDb) {
      dashDb = new DashboardDb(dbPath);
    }
    return dashDb;
  }

  /* ── shared context for all route handlers ── */
  const ctx: RouteContext = {
    version,
    dataDir,
    workdirRoot,
    dashboardSecret,
    serverApiBase,
    logPath,
    dashboardLogPath,
    getDb,
    proxyToServerApi,
    proxySSE,
    proxySSEGet,
  };

  /* ── ordered route handler chain ── */
  const handlers = [
    handleSetupRoutes,
    handleStatusRoutes,
    handleMetricsRoutes,
    handleSessionMcpRoutes,
    handleSessionRoutes,
    handleSettingsRoutes,
    handleChatRoutes,
    handleDevAliasRoutes,
    handleEventTriggerRoutes,
    handleMcpRoutes,
    handleAgentRoutes,
    handleOndemandTaskRoutes,
    handleOrchestratorRoutes,
    handleScheduleTaskRoutes,
    handleSkillRoutes,
    handleFilesystemRoutes,
  ];

  // Global error handlers — prevent silent crashes in the dashboard process.
  // Register them once per process and remove them when the last dashboard server closes.
  attachDashboardProcessHandlers();

  /* ── Security response headers (applied to every response) ── */
  const securityHeaders: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  };
  if (!allowInsecureCookie) {
    // HSTS only when serving over HTTPS (Secure cookies enabled)
    securityHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const { pathname, query } = parseUrl(req.url);

    // Apply security headers to every response
    for (const [header, value] of Object.entries(securityHeaders)) {
      res.setHeader(header, value);
    }

    try {
      // GET /auth → consume #token in browser and exchange for auth cookie
      if (req.method === 'GET' && pathname === '/auth') {
        const html = renderAuthBootstrapPage();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(html);
        return;
      }

      // POST /api/auth/bootstrap → exchange one-time bootstrap token for cookie.
      if (req.method === 'POST' && pathname === '/api/auth/bootstrap') {
        const clientIp = req.socket.remoteAddress ?? 'unknown';
        if (isBootstrapRateLimited(clientIp)) {
          json(res, 429, { error: 'Too many attempts. Try again later.' });
          return;
        }

        const body = await readBody(req);
        const parsed = parseJson<{ token?: string }>(body);
        const token = parsed?.token;
        if (typeof token !== 'string' || !token) {
          json(res, 400, { error: 'token is required' });
          return;
        }

        const expectedBootstrapToken = activeBootstrapToken ?? '';
        const matchesBootstrapToken = timingSafeEqualString(token, expectedBootstrapToken);
        if (activeBootstrapToken === null || !matchesBootstrapToken) {
          json(res, 401, { error: 'Unauthorized' });
          return;
        }
        activeBootstrapToken = null;

        setDashboardCookie(res, dashboardSecret, { allowInsecureCookie });
        json(res, 200, { ok: true });
        return;
      }

      // GET / → SPA (requires auth cookie), redirects to /setup if unconfigured
      if (req.method === 'GET' && pathname === '/') {
        if (!isDashboardAuthed(req, dashboardSecret)) {
          json(res, 401, {
            error: 'Unauthorized. Open dashboard via CLI: npx huskygate dashboard start',
          });
          return;
        }

        // Redirect to setup wizard if not yet configured
        try {
          const configStore = getDb().config;
          const setupComplete = await isSetupComplete(configStore, dataDir);
          if (!setupComplete) {
            res.writeHead(302, { Location: '/setup' });
            res.end();
            return;
          }
        } catch {
          // If setup check fails (e.g. DB issue), proceed to SPA rather than blocking
        }

        const html = renderApp({ version });
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }

      // All /api/* and /setup require auth cookie
      if (
        (pathname.startsWith('/api/') || pathname === '/setup') &&
        !isDashboardAuthed(req, dashboardSecret)
      ) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      // O-4: CSRF protection — state-changing /api/* must include custom header
      if (
        pathname.startsWith('/api/') &&
        CSRF_PROTECTED_METHODS.has(req.method ?? '') &&
        req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE
      ) {
        json(res, 403, { error: 'Missing CSRF protection header' });
        return;
      }

      // POST /api/auth/logout → clear session cookie
      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        clearDashboardCookie(res, { allowInsecureCookie });
        json(res, 200, { ok: true });
        return;
      }

      // Dispatch to route handlers
      for (const handler of handlers) {
        if (await handler(ctx, req, res, pathname, query)) return;
      }

      // 404
      json(res, 404, { error: 'Not Found' });
    } catch (err) {
      const message = errorMessage(err);
      const stack = err instanceof Error ? err.stack : undefined;
      if (message === 'Body too large' || message === 'File too large') {
        json(res, 413, { error: 'Request body too large' });
      } else if (
        message.startsWith('File too large (') ||
        message.startsWith('File type not allowed')
      ) {
        json(res, 400, { error: message });
      } else {
        dashLog('error', 'unhandled_request_error', {
          method: req.method,
          url: req.url,
          error: message,
          stack,
        });
        json(res, 500, { error: 'Internal server error' });
      }
    }
  });

  let eaddrinuseRetried = false;
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      if (eaddrinuseRetried) {
        dashLog('error', 'dashboard_port_in_use_fatal', { port, msg: 'retry also failed' });
        process.exit(1);
      }
      dashLog('warn', 'dashboard_port_in_use', { port, action: 'attempting_recovery' });
      const stalePid = findPidOnPort(port);
      if (stalePid !== null) {
        dashLog('info', 'killing_stale_process', { pid: stalePid, port });
        try {
          terminateProcess(stalePid);
        } catch {
          /* already gone */
        }
        eaddrinuseRetried = true;
        setTimeout(() => {
          server.listen(port, '127.0.0.1', () => {
            dashLog('info', 'dashboard_started', { port, recovered: true });
          });
        }, 1000);
        return;
      }
      dashLog('error', 'dashboard_port_in_use_fatal', { port, msg: 'no stale process found' });
      process.exit(1);
    }
    // Non-EADDRINUSE server errors (EACCES, EADDRNOTAVAIL, etc.) are fatal.
    dashLog('error', 'dashboard_server_error', { port, code: err.code, error: errorMessage(err) });
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    dashLog('info', 'dashboard_started', { port });
  });

  server.on('close', () => {
    if (dashDb) {
      try {
        dashDb.close();
      } catch (err) {
        dashLog('warn', 'dashboard_db_close_on_shutdown_error', { error: errorMessage(err) });
      }
      dashDb = null;
    }
    detachDashboardProcessHandlers();
  });

  return server;
}
