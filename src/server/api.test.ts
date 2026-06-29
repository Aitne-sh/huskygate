import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import {
  type Server as HttpServer,
  type IncomingHttpHeaders,
  Server,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context/app-context.js';
import { WebhookDispatchError } from '../event/event-router.js';
import { matchChatStatus } from '../shared/route-matchers.js';
import * as toolApproval from '../shared/tool-approval.js';
import { makeTestAppContext } from '../test-helpers/app-context-builder.js';
import {
  CODEX_ANSWER_MARKER,
  PROCESS_END_SEPARATOR,
  createApiServer as createApiServerBase,
  findProcessBoundary,
  injectProcessSeparator,
  matchJobStream,
  matchToolApproval,
  startApiServer as startApiServerBase,
} from './api.js';
import type { NotificationService } from './notification-service.js';
import { jobStreamBuffers } from './state.js';

const mocked = vi.hoisted(() => ({
  dbAll: vi.fn(),
  loggerDebug: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  daemonFindPidOnPort: vi.fn<(port: number) => number | null>(() => null),
}));

vi.mock('../store/database.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: mocked.dbAll,
    }),
  }),
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    debug: mocked.loggerDebug,
    info: mocked.loggerInfo,
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
  },
  setLogLevel: vi.fn(),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./daemon.js', () => ({
  findPidOnPort: mocked.daemonFindPidOnPort,
}));

class MockRequest extends EventEmitter {
  public method: string;
  public url?: string;
  public headers: IncomingHttpHeaders;
  public socket = { remoteAddress: undefined as string | undefined };

  // Buffer data/end events so readBody() can attach listeners after async handler awaits
  private bufferedData: Buffer[] = [];
  private bufferedEnd = false;

  constructor(method: string, url?: string, headers?: Record<string, string>) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers ?? {};
  }

  destroy(): this {
    super.emit('close');
    return this;
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'data' && this.listenerCount('data') === 0) {
      this.bufferedData.push(args[0] as Buffer);
      return true;
    }
    if (event === 'end' && this.listenerCount('end') === 0) {
      this.bufferedEnd = true;
      return true;
    }
    return super.emit(event, ...args);
  }

  override on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    if (event === 'data') {
      for (const chunk of this.bufferedData.splice(0)) {
        listener(chunk);
      }
    }
    if (event === 'end' && this.bufferedEnd) {
      this.bufferedEnd = false;
      listener();
    }
    return this;
  }
}

class MockResponse extends EventEmitter {
  public statusCode = 200;
  public headers: Record<string, string | string[]> = {};
  public body = '';
  public headersSent = false;
  public writableEnded = false;
  private doneResolve!: () => void;
  public readonly done: Promise<void>;

  constructor() {
    super();
    this.done = new Promise<void>((resolve) => {
      this.doneResolve = resolve;
    });
  }

  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    this.headersSent = true;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        this.setHeader(key, value);
      }
    }
    return this;
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(chunk?: string): this {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
    this.doneResolve();
    this.emit('finish');
    return this;
  }
}

interface InvokeOptions {
  method: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  remoteAddress?: string;
}

function invokeRaw(
  server: HttpServer,
  options: InvokeOptions,
): { req: MockRequest; res: MockResponse } {
  const req = new MockRequest(options.method, options.path, options.headers);
  if (options.remoteAddress) req.socket.remoteAddress = options.remoteAddress;
  const res = new MockResponse();
  server.emit('request', req as never, res as unknown as ServerResponse);

  // Body events are emitted synchronously — MockRequest buffers them until
  // readBody() attaches listeners, so there is no race with async handlers.
  if (options.body !== undefined) {
    req.emit('data', Buffer.from(options.body));
  }
  req.emit('end');

  return { req, res };
}

async function invoke(
  server: HttpServer,
  options: InvokeOptions,
): Promise<{ status: number; body: unknown; headers: Record<string, string | string[]> }> {
  const { res } = invokeRaw(server, options);
  await res.done;

  let parsed: unknown = null;
  if (res.body.length > 0) {
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = res.body;
    }
  }
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

interface TestContext {
  ctx: AppContext;
  notificationService: NotificationService;
  notificationSpies: {
    postNotification: ReturnType<typeof vi.fn>;
    listTargets: ReturnType<typeof vi.fn>;
  };
  spies: {
    createStandaloneSession: ReturnType<typeof vi.fn>;
    clearAllSessionsWithCleanup: ReturnType<typeof vi.fn>;
    deleteSessionByIdWithCleanup: ReturnType<typeof vi.fn>;
    getSessionSummaryById: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    updateToolState: ReturnType<typeof vi.fn>;
    listAllSessions: ReturnType<typeof vi.fn>;
    cancelSession: ReturnType<typeof vi.fn>;
    enqueue: ReturnType<typeof vi.fn>;
    saveMessage: ReturnType<typeof vi.fn>;
    prepareWorkdirSkillsOnly: ReturnType<typeof vi.fn>;
    validateCustomWorkdir: ReturnType<typeof vi.fn>;
  };
}

function createNotificationServiceStub(): {
  service: NotificationService;
  spies: TestContext['notificationSpies'];
} {
  const postNotification = vi.fn(async () => ({ ts: 'stub-ts', channel: 'stub-channel' }));
  const listTargets = vi.fn(async () => []);
  return {
    service: {
      postNotification,
      listTargets,
    },
    spies: {
      postNotification,
      listTargets,
    },
  };
}

function createApiServer(input: AppContext | TestContext): HttpServer {
  if ('ctx' in input) {
    return createApiServerBase(input.ctx, input.notificationService);
  }
  return createApiServerBase(input, createNotificationServiceStub().service);
}

function startApiServer(input: AppContext | TestContext): Server {
  if ('ctx' in input) {
    return startApiServerBase(input.ctx, input.notificationService);
  }
  return startApiServerBase(input, createNotificationServiceStub().service);
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  jobStreamBuffers.clear();
  mocked.dbAll.mockReset();
  mocked.loggerDebug.mockReset();
  mocked.loggerInfo.mockReset();
  mocked.loggerWarn.mockReset();
  mocked.loggerError.mockReset();
  mocked.daemonFindPidOnPort.mockReset();
  mocked.daemonFindPidOnPort.mockReturnValue(null);
  vi.restoreAllMocks();
});

function createTestContext(): TestContext {
  const createStandaloneSession = vi.fn((tool: string) => {
    const root = mkdtempSync(join(tmpdir(), 'api-session-'));
    createdDirs.push(root);
    return {
      sessionId: 'a1b2c3d4',
      sessionKey: 'sk_test',
      threadKey: null,
      userId: 'U1',
      tool,
      mode: 'write',
      workdir: join(root, 'default'),
      startedAt: new Date().toISOString(),
    };
  });
  const clearAllSessionsWithCleanup = vi.fn(() => []);
  const deleteSessionByIdWithCleanup = vi.fn(() => null);
  const getSessionSummaryById = vi.fn(() => null);
  const getSession = vi.fn(() => null);
  const updateToolState = vi.fn();
  const listAllSessions = vi.fn(() => []);
  const cancelSession = vi.fn(() => false);
  const enqueue = vi.fn(() => ({ position: 0 }));
  const saveMessage = vi.fn();
  const prepareWorkdirSkillsOnly = vi.fn();
  const validateCustomWorkdir = vi.fn((input: string) => input);
  const { service: notificationService, spies: notificationSpies } =
    createNotificationServiceStub();
  const baseCtx = makeTestAppContext();

  const ctx = makeTestAppContext({
    config: {
      serverApiSecret: 'test-secret',
      serverApiPort: 0,
      allowedUserIds: [],
    },
    sessionManager: {
      ...baseCtx.sessionManager,
      createStandaloneSession,
      clearAllSessionsWithCleanup,
      deleteSessionByIdWithCleanup,
      getSessionSummaryById,
      get: getSession,
      updateToolState,
      listAllSessions,
    } as unknown as AppContext['sessionManager'],
    jobQueue: {
      ...baseCtx.jobQueue,
      cancelSession,
      enqueue,
    } as unknown as AppContext['jobQueue'],
    workdirManager: {
      ...baseCtx.workdirManager,
      prepareWorkdirSkillsOnly,
      validateCustomWorkdir,
      cleanupUnusedSessionWorkdirs: vi.fn(() => 0),
    } as unknown as AppContext['workdirManager'],
    conversationStore: {
      ...baseCtx.conversationStore,
      saveMessage,
    } as unknown as AppContext['conversationStore'],
  });

  return {
    ctx,
    notificationService,
    notificationSpies,
    spies: {
      createStandaloneSession,
      clearAllSessionsWithCleanup,
      deleteSessionByIdWithCleanup,
      getSessionSummaryById,
      getSession,
      updateToolState,
      listAllSessions,
      cancelSession,
      enqueue,
      saveMessage,
      prepareWorkdirSkillsOnly,
      validateCustomWorkdir,
    },
  };
}

function authHeaders(secret = 'test-secret'): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  };
}

function addPendingApproval(
  test: TestContext,
  key: string,
  approval: Record<string, unknown>,
): void {
  (test.ctx.pendingToolApprovals as unknown as Map<string, Record<string, unknown>>).set(
    key,
    approval,
  );
}

function pendingApprovalCount(test: TestContext): number {
  return (test.ctx.pendingToolApprovals as unknown as Map<string, Record<string, unknown>>).size;
}

function clearPendingApprovals(test: TestContext): void {
  (test.ctx.pendingToolApprovals as unknown as Map<string, Record<string, unknown>>).clear();
}

function createPendingApproval(
  overrides: Partial<{
    sessionKey: string;
    tool: 'claude' | 'codex' | 'gemini';
    deniedTools: string[];
    requestedToolName: string | null;
    requestedToolArgs: unknown;
    approvedCodexToolCalls: Array<{ toolName: string; args: unknown }>;
    skipGeminiMcpPreflightOnce: boolean;
    prompt: string;
    userId: string;
    requestId: string;
    expiresAt: number;
  }> = {},
): Record<string, unknown> {
  return {
    sessionKey: 'sk_tool',
    tool: 'codex',
    deniedTools: ['mcp__aws-api__call_aws'],
    requestedToolName: 'mcp__aws-api__call_aws',
    requestedToolArgs: { command: 'echo hello' },
    approvedCodexToolCalls: [],
    skipGeminiMcpPreflightOnce: false,
    prompt: 'run the tool',
    userId: 'U1',
    requestId: 'req-1',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('createApiServer', () => {
  it('matches tool-approval and job-stream routes', () => {
    expect(matchToolApproval('/api/chat/a1b2c3d4/tool-approval')).toBe('a1b2c3d4');
    expect(matchToolApproval('/api/chat/nothex/tool-approval')).toBeNull();

    expect(matchJobStream('/api/chat/a1b2c3d4/job-stream/1111-2222')).toEqual({
      sessionId: 'a1b2c3d4',
      jobId: '1111-2222',
    });
    expect(matchJobStream('/api/chat/a1b2c3d4/job-stream/')).toBeNull();
  });

  it('serves /health without authentication', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, { method: 'GET', path: '/health' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('accepts public webhook routes before bearer authentication', async () => {
    const test = createTestContext();
    const endpoint = {
      id: 'endpoint-1',
      token: 'token1234567890abcd',
      publisherPreset: 'generic',
      verificationType: 'none',
      signatureHeader: null,
      signaturePrefix: null,
      deliveryIdHeader: null,
      eventNameHeader: null,
      secretRef: null,
      maxBodyBytes: 262144,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    const eventRouter = {
      getEndpointByToken: vi.fn(() => endpoint),
      dispatchWebhook: vi.fn(async () => ({
        ok: true,
        endpointId: endpoint.id,
        duplicate: false,
        matchedSubscriptions: 0,
        dispatched: 0,
        skipped: 0,
      })),
    };
    (test.ctx as unknown as { eventRouter: typeof eventRouter }).eventRouter = eventRouter;

    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/webhooks/token1234567890abcd',
      body: JSON.stringify({ ping: true }),
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      ok: true,
      endpointId: 'endpoint-1',
      duplicate: false,
      matchedSubscriptions: 0,
      dispatched: 0,
      skipped: 0,
    });
    expect(eventRouter.getEndpointByToken).toHaveBeenCalledWith('token1234567890abcd');
    expect(eventRouter.dispatchWebhook).toHaveBeenCalled();
  });

  it('returns webhook dispatch errors from the public route without bearer authentication', async () => {
    const test = createTestContext();
    const endpoint = {
      id: 'endpoint-1',
      token: 'token1234567890abcd',
      publisherPreset: 'generic',
      verificationType: 'none',
      signatureHeader: null,
      signaturePrefix: null,
      deliveryIdHeader: null,
      eventNameHeader: null,
      secretRef: null,
      maxBodyBytes: 262144,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    const eventRouter = {
      getEndpointByToken: vi.fn(() => endpoint),
      dispatchWebhook: vi.fn(async () => {
        throw new WebhookDispatchError(503, { error: 'dispatch_failed' });
      }),
    };
    (test.ctx as unknown as { eventRouter: typeof eventRouter }).eventRouter = eventRouter;

    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/webhooks/token1234567890abcd',
      body: JSON.stringify({ ping: true }),
    });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'dispatch_failed' });
  });

  it('returns 403 for GitHub webhook from non-GitHub IP when IP allowlist is active', async () => {
    const test = createTestContext();
    const endpoint = {
      id: 'endpoint-gh',
      token: 'token1234567890abcd',
      publisherPreset: 'github' as const,
      verificationType: 'hmac-sha256' as const,
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: null,
      maxBodyBytes: 262144,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    const eventRouter = {
      getEndpointByToken: vi.fn(() => endpoint),
      dispatchWebhook: vi.fn(async () => ({ ok: true })),
    };
    (test.ctx as unknown as { eventRouter: typeof eventRouter }).eventRouter = eventRouter;
    // Enable tunnel + provide a mock allowlist that rejects all IPs.
    (test.ctx as unknown as { tunnelEnabled: boolean }).tunnelEnabled = true;
    (test.ctx as unknown as { githubIpAllowlist: { isAllowed: () => boolean } }).githubIpAllowlist =
      {
        isAllowed: () => false,
      };

    const server = createApiServer(test.ctx);
    const { res: mockRes } = invokeRaw(server, {
      method: 'POST',
      path: '/webhooks/token1234567890abcd',
      headers: { 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({ action: 'opened' }),
      remoteAddress: '127.0.0.1',
    });
    await mockRes.done;

    expect(mockRes.statusCode).toBe(403);
    expect(JSON.parse(mockRes.body)).toEqual({ error: 'ip_not_allowed' });
    expect(eventRouter.dispatchWebhook).not.toHaveBeenCalled();
  });

  it('allows GitHub webhook from GitHub IP when IP allowlist is active', async () => {
    const test = createTestContext();
    const endpoint = {
      id: 'endpoint-gh',
      token: 'token1234567890abcd',
      publisherPreset: 'github' as const,
      verificationType: 'hmac-sha256' as const,
      signatureHeader: 'x-hub-signature-256',
      signaturePrefix: 'sha256=',
      deliveryIdHeader: 'x-github-delivery',
      eventNameHeader: 'x-github-event',
      secretRef: null,
      maxBodyBytes: 262144,
      enabled: true,
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    };
    const eventRouter = {
      getEndpointByToken: vi.fn(() => endpoint),
      dispatchWebhook: vi.fn(async () => ({ ok: true, deliveryId: 'd1', triggeredCount: 0 })),
    };
    (test.ctx as unknown as { eventRouter: typeof eventRouter }).eventRouter = eventRouter;
    (test.ctx as unknown as { tunnelEnabled: boolean }).tunnelEnabled = true;
    (test.ctx as unknown as { githubIpAllowlist: { isAllowed: () => boolean } }).githubIpAllowlist =
      {
        isAllowed: () => true,
      };

    const server = createApiServer(test.ctx);
    const { res: mockRes } = invokeRaw(server, {
      method: 'POST',
      path: '/webhooks/token1234567890abcd',
      headers: { 'cf-connecting-ip': '192.30.252.1' },
      body: JSON.stringify({ action: 'opened' }),
      remoteAddress: '127.0.0.1',
    });
    await mockRes.done;

    expect(mockRes.statusCode).toBe(202);
    expect(eventRouter.dispatchWebhook).toHaveBeenCalled();
    // Verify dispatch receives the resolved client IP (from CF-Connecting-IP),
    // not the raw socket address (127.0.0.1).
    const dispatchArgs = eventRouter.dispatchWebhook.mock.calls[0] as unknown[];
    expect(dispatchArgs[3]).toBe('192.30.252.1');
  });

  it('returns 401 for authenticated endpoints without bearer token or with malformed header', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);

    const noAuth = await invoke(server, { method: 'GET', path: '/api/chat/sessions' });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toEqual({ error: 'Unauthorized' });

    const malformed = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: { authorization: 'Token test-secret' },
    });
    expect(malformed.status).toBe(401);
    expect(malformed.body).toEqual({ error: 'Unauthorized' });

    const wrongLength = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: { authorization: 'Bearer short' },
    });
    expect(wrongLength.status).toBe(401);
    expect(wrongLength.body).toEqual({ error: 'Unauthorized' });

    const wrongToken = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: { authorization: 'Bearer test-secrex' },
    });
    expect(wrongToken.status).toBe(401);
    expect(wrongToken.body).toEqual({ error: 'Unauthorized' });
  });

  it('dispatches webhook management and event-trigger routes through createApiServer', async () => {
    const test = createTestContext();
    const webhookEndpointStore = {
      list: vi.fn(() => [{ id: 'endpoint-1' }]),
    };
    const eventSubscriptionStore = {
      list: vi.fn(() => [{ id: 'subscription-1' }]),
    };
    const triggeredTaskStore = {
      list: vi.fn(() => [{ id: 'triggered-task-1' }]),
    };
    (test.ctx as unknown as { webhookEndpointStore: unknown }).webhookEndpointStore =
      webhookEndpointStore;
    (test.ctx as unknown as { eventSubscriptionStore: unknown }).eventSubscriptionStore =
      eventSubscriptionStore;
    (test.ctx as unknown as { triggeredTaskStore: unknown }).triggeredTaskStore =
      triggeredTaskStore;

    const server = createApiServer(test.ctx);

    const endpoints = await invoke(server, {
      method: 'GET',
      path: '/api/webhook-endpoints',
      headers: authHeaders(),
    });
    expect(endpoints.status).toBe(200);
    expect(webhookEndpointStore.list).toHaveBeenCalledTimes(1);

    const subscriptions = await invoke(server, {
      method: 'GET',
      path: '/api/event-subscriptions',
      headers: authHeaders(),
    });
    expect(subscriptions.status).toBe(200);
    expect(eventSubscriptionStore.list).toHaveBeenCalledTimes(1);

    const triggeredTasks = await invoke(server, {
      method: 'GET',
      path: '/api/triggered-tasks',
      headers: authHeaders(),
    });
    expect(triggeredTasks.status).toBe(200);
    expect(triggeredTaskStore.list).toHaveBeenCalledTimes(1);
  });

  it('accepts the schedule-manager token only for schedule endpoints', async () => {
    const test = createTestContext();
    const originalScheduleSecret = process.env.HUSKYGATE_API_SECRET;
    process.env.HUSKYGATE_API_SECRET = 'schedule-secret';
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = {
      list: vi.fn(() => []),
    };

    try {
      const server = createApiServer(test.ctx);

      const scheduleRes = await invoke(server, {
        method: 'GET',
        path: '/api/schedules',
        headers: authHeaders('schedule-secret'),
      });
      expect(scheduleRes.status).toBe(200);

      const invalidSchedulePathRes = await invoke(server, {
        method: 'GET',
        path: '/api/schedules/not-a-uuid',
        headers: authHeaders('schedule-secret'),
      });
      expect(invalidSchedulePathRes.status).toBe(404);
      expect(invalidSchedulePathRes.body).toEqual({ error: 'Not Found' });

      const nonScheduleRes = await invoke(server, {
        method: 'GET',
        path: '/api/chat/sessions',
        headers: authHeaders('schedule-secret'),
      });
      expect(nonScheduleRes.status).toBe(401);
      expect(nonScheduleRes.body).toEqual({ error: 'Unauthorized' });
    } finally {
      if (originalScheduleSecret === undefined) {
        delete process.env.HUSKYGATE_API_SECRET;
      } else {
        process.env.HUSKYGATE_API_SECRET = originalScheduleSecret;
      }
    }
  });

  it('validates and applies mutable settings via POST /api/settings/apply', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    const invalidJson = await invoke(server, {
      method: 'POST',
      path: '/api/settings/apply',
      headers: authHeaders(),
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body).toEqual({ error: 'Invalid JSON' });

    const missingValues = await invoke(server, {
      method: 'POST',
      path: '/api/settings/apply',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(missingValues.status).toBe(400);
    expect(missingValues.body).toEqual({ error: 'values object required' });

    const valid = await invoke(server, {
      method: 'POST',
      path: '/api/settings/apply',
      headers: authHeaders(),
      body: JSON.stringify({
        values: {
          LOG_LEVEL: 'debug',
          MAX_CONCURRENCY: '7',
          MAX_RUNTIME_SEC: '240',
          NO_OUTPUT_TIMEOUT_SEC: '20',
          TOOL_AUTO_APPROVE_MODE: 'true',
          PERPLEXITY_API_KEY: 'pplx-test',
          EXTRA_KEY: 'x',
        },
      }),
    });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({
      applied: [
        'LOG_LEVEL',
        'MAX_CONCURRENCY',
        'MAX_RUNTIME_SEC',
        'NO_OUTPUT_TIMEOUT_SEC',
        'TOOL_AUTO_APPROVE_MODE',
        'PERPLEXITY_API_KEY',
      ],
      rejected: ['EXTRA_KEY'],
    });
    expect((test.ctx.config as unknown as Record<string, unknown>).maxConcurrency).toBe(7);
    expect((test.ctx.config as unknown as Record<string, unknown>).maxRuntimeSec).toBe(240);
    expect((test.ctx.config as unknown as Record<string, unknown>).noOutputTimeoutSec).toBe(20);
    expect((test.ctx.config as unknown as Record<string, unknown>).toolAutoApproveMode).toBe(true);
    expect(process.env.PERPLEXITY_API_KEY).toBe('pplx-test');

    const invalidValues = await invoke(server, {
      method: 'POST',
      path: '/api/settings/apply',
      headers: authHeaders(),
      body: JSON.stringify({
        values: {
          LOG_LEVEL: 'trace',
          MAX_CONCURRENCY: '0',
          MAX_RUNTIME_SEC: 'abc',
          NO_OUTPUT_TIMEOUT_SEC: '-1',
          TOOL_AUTO_APPROVE_MODE: 1,
        },
      }),
    });
    expect(invalidValues.status).toBe(200);
    expect(invalidValues.body).toEqual({
      applied: [],
      rejected: [
        'LOG_LEVEL',
        'MAX_CONCURRENCY',
        'MAX_RUNTIME_SEC',
        'NO_OUTPUT_TIMEOUT_SEC',
        'TOOL_AUTO_APPROVE_MODE',
      ],
    });
  });

  it('hot-reloads skill env vars into process.env via POST /api/settings/apply', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    // Save originals
    const origAzureClientId = process.env.AZURE_CLIENT_ID;
    const origAwsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const origGoogleCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    try {
      // Clear first
      delete process.env.AZURE_CLIENT_ID;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const res = await invoke(server, {
        method: 'POST',
        path: '/api/settings/apply',
        headers: authHeaders(),
        body: JSON.stringify({
          values: {
            AZURE_CLIENT_ID: 'test-azure-id',
            AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
            GOOGLE_APPLICATION_CREDENTIALS: '/tmp/gcp-key.json',
          },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        applied: ['AZURE_CLIENT_ID', 'AWS_ACCESS_KEY_ID', 'GOOGLE_APPLICATION_CREDENTIALS'],
        rejected: [],
      });
      // Verify they landed in process.env
      expect(process.env.AZURE_CLIENT_ID).toBe('test-azure-id');
      expect(process.env.AWS_ACCESS_KEY_ID).toBe('AKIAIOSFODNN7EXAMPLE');
      expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/tmp/gcp-key.json');

      // Empty value should delete the key
      const clearRes = await invoke(server, {
        method: 'POST',
        path: '/api/settings/apply',
        headers: authHeaders(),
        body: JSON.stringify({
          values: { AZURE_CLIENT_ID: '' },
        }),
      });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body).toEqual({ applied: ['AZURE_CLIENT_ID'], rejected: [] });
      expect(process.env.AZURE_CLIENT_ID).toBeUndefined();
    } finally {
      // Restore originals
      if (origAzureClientId === undefined) delete process.env.AZURE_CLIENT_ID;
      else process.env.AZURE_CLIENT_ID = origAzureClientId;
      if (origAwsAccessKeyId === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = origAwsAccessKeyId;
      if (origGoogleCreds === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      else process.env.GOOGLE_APPLICATION_CREDENTIALS = origGoogleCreds;
    }
  });

  it('returns invalid JSON for malformed POST /api/sessions body', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: '{',
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON' });
  });

  it('validates POST /api/sessions tool argument', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'invalid-tool' }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid tool. Must be claude, codex, or gemini.' });
  });

  it('creates standalone session and workdir for valid POST /api/sessions', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'claude' }),
    });
    expect(res.status).toBe(201);
    expect(test.spies.createStandaloneSession).toHaveBeenCalledWith('claude', undefined, undefined);

    const body = res.body as { workdir: string };
    expect(existsSync(body.workdir)).toBe(true);
  });

  it('creates standalone session with mode override for POST /api/sessions', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'gemini', mode: 'readonly' }),
    });
    expect(res.status).toBe(201);
    expect(test.spies.createStandaloneSession).toHaveBeenCalledWith(
      'gemini',
      undefined,
      'readonly',
    );
  });

  it('rejects invalid mode in POST /api/sessions', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'claude', mode: 'invalid' }),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid mode. Must be readonly or write.' });
  });

  it('returns 500 when session creation throws', async () => {
    const test = createTestContext();
    test.spies.createStandaloneSession.mockImplementation(() => {
      throw new Error('boom');
    });
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'claude' }),
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(mocked.loggerError).toHaveBeenCalledWith('api_server_error', {
      error: 'boom',
      path: '/api/sessions',
    });
  });

  it('returns 413 when request body exceeds MAX_BODY', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/sessions',
      headers: authHeaders(),
      body: JSON.stringify({ tool: 'claude', payload: 'x'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large' });
  });

  it('cleans up in-memory session state on DELETE /api/sessions', async () => {
    const test = createTestContext();
    const kill = vi.fn();
    test.ctx.activeRunners.set('sk_1', {
      runner: { kill } as never,
      job: { id: 'job_1' } as never,
    });
    test.ctx.pendingToolApprovals.set('th_1', { sessionKey: 'sk_1' } as never);
    test.ctx.pendingMcpAuthBypassApprovals.set('th_1', { sessionKey: 'sk_1' } as never);
    test.ctx.pendingConfirmations.set('th_1', { kind: 'mode' } as never);
    const timer = setTimeout(() => undefined, 1000);
    test.ctx.inactivityTimers.set('th_1', timer);
    test.spies.clearAllSessionsWithCleanup.mockReturnValue([
      { sessionKey: 'sk_1', threadKey: 'th_1' },
    ]);

    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, deleted: 1, orphanRemoved: 0 });
    expect(kill).toHaveBeenCalledWith('orchestrator_shutdown');
    expect(test.spies.cancelSession).toHaveBeenCalledWith('sk_1');
    expect(test.ctx.pendingToolApprovals.has('th_1')).toBe(false);
    expect(test.ctx.pendingMcpAuthBypassApprovals.has('th_1')).toBe(false);
    expect(test.ctx.pendingConfirmations.has('th_1')).toBe(false);
    expect(test.ctx.inactivityTimers.has('th_1')).toBe(false);
    expect(test.ctx.workdirManager.cleanupUnusedSessionWorkdirs).toHaveBeenCalledWith([]);
    clearTimeout(timer);
  });

  it('deletes single session by id and handles not-found case', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    const notFound = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions/a1b2c3d4',
      headers: authHeaders(),
    });
    expect(notFound.status).toBe(200);
    expect(notFound.body).toEqual({ success: false, error: 'Session not found' });

    const kill = vi.fn();
    test.ctx.activeRunners.set('sk_del', {
      runner: { kill } as never,
      job: { id: 'job_del' } as never,
    });
    test.spies.deleteSessionByIdWithCleanup.mockReturnValue({
      sessionKey: 'sk_del',
      threadKey: null,
    });

    const found = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions/a1b2c3d4',
      headers: authHeaders(),
    });
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ success: true });
    expect(kill).toHaveBeenCalledWith('orchestrator_shutdown');
    expect(test.spies.cancelSession).toHaveBeenCalledWith('sk_del');
  });

  it('stops active runner with POST /api/jobs/:sessionKey/stop and handles inactive session', async () => {
    const test = createTestContext();
    const kill = vi.fn();
    test.ctx.activeRunners.set('sess_abc123def456', {
      runner: { kill } as never,
      job: { id: 'job_1' } as never,
    });

    const server = createApiServer(test.ctx);
    const ok = await invoke(server, {
      method: 'POST',
      path: '/api/jobs/sess_abc123def456/stop',
      headers: authHeaders(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
    expect(kill).toHaveBeenCalledWith('dashboard_stop');

    const miss = await invoke(server, {
      method: 'POST',
      path: '/api/jobs/sess_000000000000/stop',
      headers: authHeaders(),
    });
    expect(miss.status).toBe(200);
    expect(miss.body).toEqual({ success: false, error: 'No active runner for session' });
  });

  it('stops active runner with POST /api/chat/:id/stop and handles missing/inactive sessions', async () => {
    const test = createTestContext();
    const kill = vi.fn();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sess_chat_stop',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.ctx.activeRunners.set('sess_chat_stop', {
      runner: { kill } as never,
      job: { id: 'job_chat_stop' } as never,
    });

    const server = createApiServer(test.ctx);
    const ok = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/stop',
      headers: authHeaders(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
    expect(kill).toHaveBeenCalledWith('dashboard_stop');

    test.ctx.activeRunners.delete('sess_chat_stop');
    const inactive = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/stop',
      headers: authHeaders(),
    });
    expect(inactive.status).toBe(200);
    expect(inactive.body).toEqual({ success: false, error: 'No active runner for session' });

    test.spies.getSessionSummaryById.mockReturnValue(null);
    const missing = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/stop',
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Session not found' });
  });

  it('returns 401 for unauthenticated GET /api/chat/:id/status', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/status',
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 404 for unknown session in GET /api/chat/:id/status', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/status',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  it('returns running=false when no active runner for GET /api/chat/:id/status', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_status',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/status',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      running: false,
      pendingApproval: false,
      jobId: null,
    });
  });

  it('returns running=true with jobId when runner is active for GET /api/chat/:id/status', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_status',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.ctx.activeRunners.set('sk_status', {
      runner: { isRunning: () => true } as never,
      job: { id: 'job_123' } as never,
    });
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/status',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      running: true,
      pendingApproval: false,
      jobId: 'job_123',
    });
  });

  it('returns pendingApproval=true when approval is pending for GET /api/chat/:id/status', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_status',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    addPendingApproval(test, 'dashboard_sk_status', {
      sessionKey: 'sk_status',
      requestId: 'req_1',
      tool: 'claude',
      expiresAt: Date.now() + 60_000,
    });
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/status',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        running: false,
        pendingApproval: true,
      }),
    );
  });

  it('validates /api/chat/:id/send for missing session, malformed json, and missing prompt', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    const notFound = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: 'Session not found' });

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });

    const invalidJson = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body).toEqual({ error: 'Invalid JSON' });

    const missingPrompt = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: '' }),
    });
    expect(missingPrompt.status).toBe(400);
    expect(missingPrompt.body).toEqual({ error: 'prompt is required' });
  });

  it('streams chat events, saves assistant output, and does NOT kill runner on client disconnect', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({ toolState: { a: 1 } });

    const server = createApiServer(test.ctx);
    const { req, res } = invokeRaw(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hello' }),
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    const jobId = [...test.ctx.jobEventStreams.keys()][0] as string;
    expect(jobId).toBeDefined();
    expect(test.spies.saveMessage).toHaveBeenCalledWith('sk_chat', 'user', 'hello', jobId);

    const disconnectKill = vi.fn();
    test.ctx.activeRunners.set('sk_chat', {
      runner: { kill: disconnectKill } as never,
      job: { id: jobId } as never,
    });
    // Client disconnect should NOT kill the runner (graceful disconnect)
    req.emit('close');
    expect(disconnectKill).not.toHaveBeenCalled();

    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number }) => void;
    };
    stream.onEvent({ type: 'text', content: 'Hello ' });
    stream.onEvent({ type: 'status', content: 'ignored' });
    stream.onEvent({ type: 'text', content: 'World' });
    stream.onDone({ exitCode: 0 });

    await res.done;

    expect(test.spies.saveMessage).toHaveBeenCalledWith('sk_chat', 'assistant', 'Hello World', jobId);
    expect(mocked.loggerInfo).toHaveBeenCalledWith('api_chat_done', {
      sessionId: 'a1b2c3d4',
      tool: 'claude',
      exitCode: 0,
      responseLength: 11,
    });
    expect(res.body).toContain('"type":"done"');
  });

  it('collects chunks even when SSE client has disconnected (writableEnded)', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({ toolState: {} });

    const server = createApiServer(test.ctx);
    const { res } = invokeRaw(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'test' }),
    });

    await new Promise((resolve) => setImmediate(resolve));

    const jobId = [...test.ctx.jobEventStreams.keys()][0] as string;
    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number }) => void;
    };

    // Simulate SSE client disconnect by marking response as ended
    res.writableEnded = true;

    // Events should still be collected for persistence
    stream.onEvent({ type: 'text', content: 'chunk1' });
    stream.onEvent({ type: 'text', content: 'chunk2' });
    stream.onDone({ exitCode: 0 });

    // The assistant message should be saved even though SSE was disconnected
    expect(test.spies.saveMessage).toHaveBeenCalledWith('sk_chat', 'assistant', 'chunk1chunk2', jobId);
  });

  it('handles enqueue failure in SSE route and does not save empty assistant text', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.enqueue.mockReturnValue({ error: 'queue busy' });

    const server = createApiServer(test.ctx);
    const enqueueFail = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hello' }),
    });

    expect(enqueueFail.status).toBe(200);
    expect(enqueueFail.headers['content-type']).toBe('text/event-stream');
    const sse = (enqueueFail.body as string) ?? '';
    expect(JSON.stringify(enqueueFail.body)).toContain('queue busy');

    test.spies.enqueue.mockReturnValue({ position: 0 });
    const { res } = invokeRaw(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hello2' }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    const jobId = [...test.ctx.jobEventStreams.keys()].at(-1) as string;
    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number }) => void;
    };
    res.end();
    // With SSE disconnect grace, chunks are still collected for persistence
    stream.onEvent({ type: 'text', content: 'collected after end' });
    stream.onDone({ exitCode: 1 });
    await res.done;

    // Assistant text should be saved even though SSE client disconnected
    expect(test.spies.saveMessage).toHaveBeenCalledWith(
      'sk_chat',
      'assistant',
      'collected after end',
      jobId,
    );
    expect(sse).toBeDefined();
  });

  it('appends attached file references to queued dashboard prompts', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.enqueue.mockReturnValue({ error: 'queue busy' });

    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({
        prompt: 'summarize files',
        files: [
          {
            originalName: 'notes.txt',
            localPath: '/tmp/workdir/_attachments/job/notes.txt',
            relativePath: '_attachments/job/notes.txt',
            mimetype: 'text/plain',
            size: 128,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const enqueued = test.spies.enqueue.mock.calls.at(0)?.[0] as { prompt: string };
    expect(enqueued.prompt).toContain('summarize files');
    expect(enqueued.prompt).toContain('[Attached files]');
    expect(enqueued.prompt).toContain('_attachments/job/notes.txt');
  });

  it('does not save assistant text when a tool-approval event interrupts the stream', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_chat',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({ toolState: {} });

    const server = createApiServer(test.ctx);
    const { res } = invokeRaw(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/send',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hello' }),
    });
    await new Promise((resolve) => setImmediate(resolve));

    const jobId = [...test.ctx.jobEventStreams.keys()][0] as string;
    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number }) => void;
    };

    stream.onEvent({ type: 'text', content: 'partial response' });
    stream.onEvent({ type: 'tool_approval', content: '{"type":"tool_approval"}' });
    stream.onDone({ exitCode: 0 });
    await res.done;

    expect(test.spies.saveMessage).toHaveBeenCalledWith('sk_chat', 'user', 'hello', jobId);
    expect(test.spies.saveMessage).not.toHaveBeenCalledWith(
      'sk_chat',
      'assistant',
      'partial response',
      jobId,
    );
  });

  it('returns messages for GET /api/chat/:id/messages with and without before', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_1',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    // Return limit+1 rows so hasMore is detected correctly
    mocked.dbAll.mockReturnValue([
      {
        id: 2,
        session_key: 'sk_1',
        role: 'user',
        content: 'world',
        created_at: '2026-02-01T00:00:01.000Z',
      },
      {
        id: 1,
        session_key: 'sk_1',
        role: 'assistant',
        content: 'hello',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const server = createApiServer(test.ctx);

    // limit=1 → fetches limit+1=2 rows, returns 1 row with hasMore=true
    const withBefore = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages?limit=1&before=10',
      headers: authHeaders(),
    });
    expect(withBefore.status).toBe(200);
    expect(withBefore.body).toEqual({
      messages: [
        {
          id: 2,
          sessionKey: 'sk_1',
          role: 'user',
          content: 'world',
          createdAt: '2026-02-01T00:00:01.000Z',
        },
      ],
      hasMore: true,
    });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_1', 10, 2);

    mocked.dbAll.mockClear();
    mocked.dbAll.mockReturnValue([]);

    const withoutBefore = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages?limit=2',
      headers: authHeaders(),
    });
    expect(withoutBefore.status).toBe(200);
    expect(withoutBefore.body).toEqual({ messages: [], hasMore: false });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_1', 3);

    mocked.dbAll.mockClear();
    await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages',
      headers: authHeaders(),
    });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_1', 51);

    mocked.dbAll.mockClear();
    await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages?limit=foo',
      headers: authHeaders(),
    });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_1', 51);
  });

  it('returns 404 for GET /api/chat/:id/messages when session is missing', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Session not found' });
  });

  it('returns 400 for GET /api/chat/:id/messages with invalid before param', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_1',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages?before=abc',
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid "before" parameter' });
  });

  it('returns 400 for GET /api/chat/:id/messages/new with invalid after param', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_1',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages/new?after=xyz',
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid "after" parameter' });
  });

  it('returns messages for GET /api/chat/:id/messages/new and handles unknown session', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    const missing = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages/new?after=2',
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Session not found' });

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_2',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    mocked.dbAll.mockReturnValue([
      {
        id: 3,
        session_key: 'sk_2',
        role: 'assistant',
        content: 'new',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ]);

    const ok = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages/new?after=2',
      headers: authHeaders(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      messages: [
        {
          id: 3,
          sessionKey: 'sk_2',
          role: 'assistant',
          content: 'new',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_2', 2);

    mocked.dbAll.mockClear();
    await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/messages/new',
      headers: authHeaders(),
    });
    expect(mocked.dbAll).toHaveBeenCalledWith('sk_2', 0);
  });

  it('lists chat sessions with optional tool filter', async () => {
    const test = createTestContext();
    test.spies.listAllSessions.mockReturnValue([
      { id: '1', tool: 'claude' },
      { id: '2', tool: 'gemini' },
    ]);
    const server = createApiServer(test.ctx);

    const all = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: authHeaders(),
    });
    expect(all.status).toBe(200);
    expect(all.body).toEqual([
      { id: '1', tool: 'claude' },
      { id: '2', tool: 'gemini' },
    ]);

    const filtered = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions?tool=claude',
      headers: authHeaders(),
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual([{ id: '1', tool: 'claude' }]);
  });

  it('returns 500 and stringifies non-Error throw values', async () => {
    const test = createTestContext();
    test.spies.listAllSessions.mockImplementation(() => {
      throw 'broken';
    });
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/chat/sessions',
      headers: authHeaders(),
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(mocked.loggerError).toHaveBeenCalledWith('api_server_error', {
      error: 'broken',
      path: '/api/chat/sessions',
    });
  });

  it('validates tool-approval requests before processing', async () => {
    const test = createTestContext();
    const server = createApiServer(test.ctx);

    const missingSession = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-1' }),
    });
    expect(missingSession.status).toBe(404);
    expect(missingSession.body).toEqual({ error: 'Session not found' });

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });

    const invalidJson = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body).toEqual({ error: 'Invalid JSON' });

    const invalidDecision = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'later', requestId: 'req-1' }),
    });
    expect(invalidDecision.status).toBe(400);
    expect(invalidDecision.body).toEqual({ error: 'decision must be "approve" or "deny"' });

    const missingRequestId = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(missingRequestId.status).toBe(400);
    expect(missingRequestId.body).toEqual({ error: 'requestId is required' });

    const noPending = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-1' }),
    });
    expect(noPending.status).toBe(404);
    expect(noPending.body).toEqual({ error: 'No pending approval found for this session' });
  });

  it('handles mismatched, expired, and denied tool-approval flows', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });

    const server = createApiServer(test.ctx);

    addPendingApproval(test, 'approval:1', createPendingApproval({ requestId: 'req-1' }));
    const mismatch = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-other' }),
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({ error: 'requestId does not match' });

    clearPendingApprovals(test);
    addPendingApproval(
      test,
      'approval:2',
      createPendingApproval({ requestId: 'req-expired', expiresAt: Date.now() - 1 }),
    );
    const expired = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-expired' }),
    });
    expect(expired.status).toBe(410);
    expect(expired.body).toEqual({ error: 'Approval request has expired' });
    expect(pendingApprovalCount(test)).toBe(0);

    addPendingApproval(test, 'approval:3', createPendingApproval({ requestId: 'req-deny' }));
    const denied = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'deny', requestId: 'req-deny' }),
    });
    expect(denied.status).toBe(200);
    expect(denied.body).toEqual({ success: true, decision: 'denied' });
    expect(test.spies.saveMessage).toHaveBeenCalledWith(
      'sk_tool',
      'system',
      JSON.stringify({
        type: 'tool_approval_result',
        requestId: 'req-deny',
        decision: 'denied',
      }),
    );
  });

  it('returns errors for invalid approve flows and enqueue failures', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });

    const server = createApiServer(test.ctx);

    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });
    addPendingApproval(
      test,
      'approval:unknown',
      createPendingApproval({
        requestId: 'req-unknown',
        requestedToolName: 'unknown_tool',
        deniedTools: ['unknown_tool'],
      }),
    );
    const unknownTool = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-unknown' }),
    });
    expect(unknownTool.status).toBe(400);
    expect(unknownTool.body).toEqual({ error: 'Could not identify approved tool name' });

    addPendingApproval(
      test,
      'approval:wildcard',
      createPendingApproval({
        requestId: 'req-wildcard',
        tool: 'claude',
        requestedToolName: 'mcp__aws-api__*',
        deniedTools: ['mcp__aws-api__*'],
      }),
    );
    const wildcardTool = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-wildcard' }),
    });
    expect(wildcardTool.status).toBe(400);
    expect(wildcardTool.body).toEqual({
      error:
        'Wildcard tool patterns are not allowed for one-shot approvals. Approve a concrete tool call instead.',
    });
    expect(test.spies.enqueue).not.toHaveBeenCalled();

    test.spies.getSession.mockReturnValue(null);
    addPendingApproval(
      test,
      'approval:missing',
      createPendingApproval({ requestId: 'req-missing' }),
    );
    const missingCurrentSession = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-missing' }),
    });
    expect(missingCurrentSession.status).toBe(404);
    expect(missingCurrentSession.body).toEqual({ error: 'Session no longer exists' });

    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });
    test.spies.enqueue.mockReturnValueOnce({ error: 'queue busy' });
    addPendingApproval(test, 'approval:queue', createPendingApproval({ requestId: 'req-queue' }));
    const enqueueError = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-queue' }),
    });
    expect(enqueueError.status).toBe(500);
    expect(enqueueError.body).toEqual({ error: 'Enqueue failed: queue busy' });
    expect(test.ctx.jobEventStreams.size).toBe(0);
    expect(jobStreamBuffers.size).toBe(0);
  });

  it('applies rerun marker even when approval tool has no derived overrides', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });
    addPendingApproval(
      test,
      'approval:unknown-runtime-tool',
      createPendingApproval({
        requestId: 'req-unknown-runtime-tool',
        tool: 'unknown' as never,
        deniedTools: [],
        requestedToolName: null,
      }),
    );

    const server = createApiServer(test.ctx);
    const approved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-unknown-runtime-tool' }),
    });

    expect(approved.status).toBe(200);
    const enqueued = test.spies.enqueue.mock.calls[0]?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(enqueued.toolStateOverrides).toEqual(
      expect.objectContaining({ _tool_approval_rerun: true }),
    );
  });

  it('approves dashboard tool requests and supports job-stream replay/live paths', async () => {
    vi.useFakeTimers();
    try {
      const test = createTestContext();
      test.spies.getSessionSummaryById.mockReturnValue({
        sessionKey: 'sk_tool',
        threadKey: 'dashboard_a1b2c3d4',
        userId: 'U1',
        tool: 'codex',
        mode: 'write',
        workdir: '/tmp/workdir',
      });
      test.spies.getSession.mockReturnValue({
        mode: 'write',
        workdir: '/tmp/workdir',
        toolState: { codex_ask_for_approval: 'never' },
      });

      const server = createApiServer(test.ctx);

      const missingStream = await invoke(server, {
        method: 'GET',
        path: '/api/chat/a1b2c3d4/job-stream/deadbeef',
        headers: authHeaders(),
      });
      expect(missingStream.status).toBe(404);
      expect(missingStream.body).toEqual({ error: 'Job stream not found' });

      addPendingApproval(test, 'approval:ok', createPendingApproval({ requestId: 'req-ok' }));
      const approved = await invoke(server, {
        method: 'POST',
        path: '/api/chat/a1b2c3d4/tool-approval',
        headers: authHeaders(),
        body: JSON.stringify({ decision: 'approve', requestId: 'req-ok' }),
      });
      expect(approved.status).toBe(200);
      expect((approved.body as { success: boolean }).success).toBe(true);
      const jobId = (approved.body as { jobId: string }).jobId;
      expect(jobId).toBeDefined();
      expect(test.spies.prepareWorkdirSkillsOnly).toHaveBeenCalledWith('/tmp/workdir', 'codex');
      expect(test.spies.updateToolState).toHaveBeenCalledWith(
        'sk_tool',
        expect.objectContaining({}),
      );

      const retryJob = test.spies.enqueue.mock.calls.at(-1)?.[0] as {
        source?: string;
        channelId: string;
        threadTs: string;
      };
      expect(retryJob.source).toBe('dashboard');
      expect(retryJob.channelId).toBe('');
      expect(retryJob.threadTs).toBe('');

      const stream = test.ctx.jobEventStreams.get(jobId) as {
        onEvent: (event: { type: string; content: string }) => void;
        onDone: (result: {
          exitCode: number | null;
          sessionState?: Record<string, unknown>;
        }) => void;
      };

      const live = invokeRaw(server, {
        method: 'GET',
        path: `/api/chat/a1b2c3d4/job-stream/${jobId}`,
        headers: authHeaders(),
      });
      // Yield enough microtasks for async handler pipeline (2 route-level awaits)
      await Promise.resolve();
      await Promise.resolve();
      expect(live.res.headers['content-type']).toBe('text/event-stream');
      stream.onEvent({ type: 'text', content: 'hello stream' });
      stream.onDone({ exitCode: 0, sessionState: {} });
      await live.res.done;
      expect(live.res.body).toContain('"type":"text"');
      expect(live.res.body).toContain('"type":"done"');

      const replay = await invoke(server, {
        method: 'GET',
        path: `/api/chat/a1b2c3d4/job-stream/${jobId}`,
        headers: authHeaders(),
      });
      expect(replay.status).toBe(200);
      expect(String(replay.body)).toContain('"type":"text"');
      expect(String(replay.body)).toContain('"type":"done"');
      expect(test.spies.saveMessage).toHaveBeenCalledWith('sk_tool', 'assistant', 'hello stream', jobId);

      await vi.runOnlyPendingTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not save assistant replay text when dashboard retry stream emits tool_approval event', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const server = createApiServer(test.ctx);
    addPendingApproval(
      test,
      'approval:tool-event',
      createPendingApproval({ requestId: 'req-tool-event' }),
    );
    const approved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-tool-event' }),
    });
    const jobId = (approved.body as { jobId: string }).jobId;
    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
      onDone: (result: { exitCode: number }) => void;
    };

    stream.onEvent({ type: 'text', content: 'partial dashboard response' });
    stream.onEvent({ type: 'tool_approval', content: '{"type":"tool_approval"}' });
    stream.onDone({ exitCode: 0 });

    expect(test.spies.saveMessage).not.toHaveBeenCalledWith(
      'sk_tool',
      'assistant',
      'partial dashboard response',
      jobId,
    );
  });

  it('clears attached dashboard job stream response on client close', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const server = createApiServer(test.ctx);
    addPendingApproval(test, 'approval:close', createPendingApproval({ requestId: 'req-close' }));

    const approved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-close' }),
    });
    const jobId = (approved.body as { jobId: string }).jobId;
    expect(jobId).toBeDefined();

    const live = invokeRaw(server, {
      method: 'GET',
      path: `/api/chat/a1b2c3d4/job-stream/${jobId}`,
      headers: authHeaders(),
    });
    await Promise.resolve();
    live.req.emit('close');
    live.res.end();
    await live.res.done;
  });

  it('handles replay loop when response is already ended before buffered write', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'dashboard_a1b2c3d4',
      userId: 'U1',
      tool: 'codex',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const server = createApiServer(test.ctx);
    addPendingApproval(
      test,
      'approval:pre-ended',
      createPendingApproval({ requestId: 'req-pre-ended' }),
    );
    const approved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-pre-ended' }),
    });
    const jobId = (approved.body as { jobId: string }).jobId;
    const stream = test.ctx.jobEventStreams.get(jobId) as {
      onEvent: (event: { type: string; content: string }) => void;
    };
    stream.onEvent({ type: 'text', content: 'buffered event' });

    const req = new MockRequest('GET', `/api/chat/a1b2c3d4/job-stream/${jobId}`, authHeaders());
    const res = new MockResponse();
    res.writableEnded = true;
    server.emit('request', req as never, res as unknown as ServerResponse);
    await Promise.resolve();

    expect(res.body).toBe('');
    res.end();
    await res.done;
  });

  it('approves non-dashboard retries for gemini/claude and omits dashboard job id', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'C1:111.222',
      userId: 'U1',
      tool: 'gemini',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const server = createApiServer(test.ctx);

    addPendingApproval(
      test,
      'approval:gemini',
      createPendingApproval({
        requestId: 'req-gemini',
        tool: 'gemini',
        skipGeminiMcpPreflightOnce: true,
      }),
    );
    const geminiApproved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-gemini' }),
    });
    expect(geminiApproved.status).toBe(200);
    expect(geminiApproved.body).toEqual({ success: true, decision: 'approved', jobId: undefined });
    const geminiRetry = test.spies.enqueue.mock.calls.at(-1)?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(geminiRetry.toolStateOverrides?.gemini_skip_mcp_preflight_once).toBe(true);

    addPendingApproval(
      test,
      'approval:claude',
      createPendingApproval({
        requestId: 'req-claude',
        tool: 'claude',
      }),
    );
    const claudeApproved = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-claude' }),
    });
    expect(claudeApproved.status).toBe(200);
    expect((claudeApproved.body as { success: boolean }).success).toBe(true);

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'C2',
      userId: 'U1',
      tool: 'gemini',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    addPendingApproval(
      test,
      'approval:gemini-plain',
      createPendingApproval({
        requestId: 'req-gemini-plain',
        tool: 'gemini',
        requestedToolName: 'aws_execute',
        deniedTools: ['aws_execute'],
      }),
    );
    const geminiPlain = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-gemini-plain' }),
    });
    expect(geminiPlain.status).toBe(200);
    const geminiPlainRetry = test.spies.enqueue.mock.calls.at(-1)?.[0] as {
      channelId: string;
      threadTs: string;
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(geminiPlainRetry.channelId).toBe('C2');
    expect(geminiPlainRetry.threadTs).toBe('');
    expect(geminiPlainRetry.toolStateOverrides).toBeDefined();
  });

  it('applies gemini skip-preflight override even when allowlist merge returns undefined', async () => {
    const test = createTestContext();
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: 'C1:111.222',
      userId: 'U1',
      tool: 'gemini',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const mergeSpy = vi
      .spyOn(toolApproval, 'mergeApprovedAllowlistTools')
      .mockReturnValue(undefined as unknown as Record<string, unknown>);

    const server = createApiServer(test.ctx);
    addPendingApproval(
      test,
      'approval:gemini-fallback',
      createPendingApproval({
        requestId: 'req-gemini-fallback',
        tool: 'gemini',
        requestedToolName: 'aws_execute',
        deniedTools: ['aws_execute'],
        skipGeminiMcpPreflightOnce: true,
      }),
    );

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-gemini-fallback' }),
    });

    expect(res.status).toBe(200);
    const retryJob = test.spies.enqueue.mock.calls.at(-1)?.[0] as {
      toolStateOverrides?: Record<string, unknown>;
    };
    expect(retryJob.toolStateOverrides).toEqual({
      gemini_skip_mcp_preflight_once: true,
      _tool_approval_rerun: true,
    });
    mergeSpy.mockRestore();
  });

  it('falls back to empty channel/thread when threadKey split returns no parts', async () => {
    const test = createTestContext();
    const oddThreadKey = {
      startsWith: () => false,
      split: () => [],
    } as unknown as string;
    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_tool',
      threadKey: oddThreadKey,
      userId: 'U1',
      tool: 'gemini',
      mode: 'write',
      workdir: '/tmp/workdir',
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir: '/tmp/workdir',
      toolState: {},
    });

    const server = createApiServer(test.ctx);
    addPendingApproval(
      test,
      'approval:odd-thread',
      createPendingApproval({
        requestId: 'req-odd-thread',
        tool: 'gemini',
        requestedToolName: 'aws_execute',
        deniedTools: ['aws_execute'],
      }),
    );

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/chat/a1b2c3d4/tool-approval',
      headers: authHeaders(),
      body: JSON.stringify({ decision: 'approve', requestId: 'req-odd-thread' }),
    });

    expect(res.status).toBe(200);
    const retryJob = test.spies.enqueue.mock.calls.at(-1)?.[0] as {
      channelId: string;
      threadTs: string;
    };
    expect(retryJob.channelId).toBe('');
    expect(retryJob.threadTs).toBe('');
  });

  it('returns 404 for unknown endpoint', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, {
      method: 'GET',
      path: '/api/unknown',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('lists and serves artifacts for a valid session', async () => {
    const test = createTestContext();
    const workdir = mkdtempSync(join(tmpdir(), 'api-artifacts-'));
    createdDirs.push(workdir);
    const artifactDir = join(workdir, '_artifacts', 'deadbeef');
    const reportPath = join(artifactDir, 'report.txt');
    const notesPath = join(artifactDir, 'notes.json');
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(reportPath, 'artifact-body', { encoding: 'utf-8' });
    writeFileSync(notesPath, '{"ok":true}', { encoding: 'utf-8' });

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_art',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir,
    });
    test.spies.getSession.mockReturnValue({
      mode: 'write',
      workdir,
      toolState: {},
    });
    const server = createApiServer(test.ctx);

    const listRes = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts',
      headers: authHeaders(),
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual(
      expect.objectContaining({
        artifacts: [
          expect.objectContaining({
            jobId: 'deadbeef',
            files: expect.arrayContaining([
              { filename: 'notes.json', size: 11, mimeType: 'application/json' },
              { filename: 'report.txt', size: 13, mimeType: 'text/plain' },
            ]),
          }),
        ],
      }),
    );

    const fileRes = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/deadbeef/report.txt',
      headers: authHeaders(),
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers['content-type']).toBe('text/plain');
    expect(fileRes.headers['cache-control']).toBe('private, max-age=3600');
    expect(fileRes.body).toBe('artifact-body');
  });

  it('returns proper errors for artifacts list/file routes', async () => {
    const test = createTestContext();
    const workdir = mkdtempSync(join(tmpdir(), 'api-artifacts-errors-'));
    createdDirs.push(workdir);
    const artifactDir = join(workdir, '_artifacts', 'feedface');
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'ok.txt'), 'ok', { encoding: 'utf-8' });
    const server = createApiServer(test.ctx);

    const listMissingSession = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts',
      headers: authHeaders(),
    });
    expect(listMissingSession.status).toBe(404);
    expect(listMissingSession.body).toEqual({ error: 'Session not found' });

    test.spies.getSessionSummaryById.mockReturnValue({
      sessionKey: 'sk_art2',
      userId: 'U1',
      tool: 'claude',
      mode: 'write',
      workdir,
    });

    const listMissingCurrent = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts',
      headers: authHeaders(),
    });
    expect(listMissingCurrent.status).toBe(404);
    expect(listMissingCurrent.body).toEqual({ error: 'Session not found' });

    const fileMissingCurrent = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/ok.txt',
      headers: authHeaders(),
    });
    expect(fileMissingCurrent.status).toBe(404);
    expect(fileMissingCurrent.body).toEqual({ error: 'Session not found' });

    test.spies.getSession.mockReturnValue({ mode: 'write', workdir, toolState: {} });

    test.spies.getSessionSummaryById.mockReturnValueOnce(null);
    const fileMissingSession = await invoke(server, {
      method: 'GET',
      path: '/api/chat/deadbeef/artifacts/feedface/ok.txt',
      headers: authHeaders(),
    });
    expect(fileMissingSession.status).toBe(404);

    const fileTraversal = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/..%2Foutside.txt',
      headers: authHeaders(),
    });
    expect(fileTraversal.status).toBe(403);
    expect(fileTraversal.body).toEqual({ error: 'Forbidden' });

    const malformedPath = await invoke(server, {
      method: 'GET',
      path: '/api/chat/a1b2c3d4/artifacts/feedface/%E0%A4%A',
      headers: authHeaders(),
    });
    expect(malformedPath.status).toBe(404);
  });

  it('skips unsafe cleanup workdir targets when deleting all sessions', async () => {
    const test = createTestContext();
    const workdirRoot = mkdtempSync(join(tmpdir(), 'api-cleanup-root-'));
    createdDirs.push(workdirRoot);
    (test.ctx.config as unknown as Record<string, unknown>).workdirRoot = workdirRoot;
    test.spies.clearAllSessionsWithCleanup.mockReturnValue([
      { sessionKey: 'sk-null', threadKey: null, workdir: null },
      { sessionKey: 'sk-out', threadKey: null, workdir: '/tmp/outside-not-allowed' },
      { sessionKey: 'sk-root', threadKey: null, workdir: resolve(workdirRoot) },
    ]);

    const server = createApiServer(test.ctx);
    const res = await invoke(server, {
      method: 'DELETE',
      path: '/api/sessions',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, deleted: 3, orphanRemoved: 0 });
  });

  it('logs cleanup warning when deleting a safe child workdir fails', async () => {
    const test = createTestContext();
    const workdirRoot = mkdtempSync(join(tmpdir(), 'api-cleanup-child-root-'));
    const childWorkdir = join(workdirRoot, 'sess-child');
    mkdirSync(childWorkdir, { recursive: true });
    createdDirs.push(workdirRoot);
    (test.ctx.config as unknown as Record<string, unknown>).workdirRoot = workdirRoot;
    test.spies.clearAllSessionsWithCleanup.mockReturnValue([
      { sessionKey: 'sk-child', threadKey: null, workdir: childWorkdir },
    ]);

    const server = createApiServer(test.ctx);
    chmodSync(workdirRoot, 0o500);
    let res: Awaited<ReturnType<typeof invoke>> | undefined;
    try {
      res = await invoke(server, {
        method: 'DELETE',
        path: '/api/sessions',
        headers: authHeaders(),
      });
    } finally {
      chmodSync(workdirRoot, 0o700);
    }

    expect(res?.status).toBe(200);
    expect(mocked.loggerWarn).toHaveBeenCalledWith(
      'workdir_cleanup_failed',
      expect.objectContaining({ workdir: resolve(childWorkdir) }),
    );
  });

  it('handles undefined request URL by falling back to root path', async () => {
    const { ctx } = createTestContext();
    const server = createApiServer(ctx);
    const res = await invoke(server, {
      method: 'GET',
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('POST /api/notify validates payload and posts to Slack', async () => {
    const test = createTestContext();
    test.notificationSpies.postNotification.mockResolvedValue({ ts: '123.456', channel: 'C123' });
    const server = createApiServer(test);

    const invalidJson = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: '{bad',
    });
    expect(invalidJson.status).toBe(400);

    const missingChannel = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(missingChannel.status).toBe(400);
    expect(missingChannel.body).toEqual({ error: 'channel is required' });

    const missingText = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: JSON.stringify({ channel: 'C123' }),
    });
    expect(missingText.status).toBe(400);
    expect(missingText.body).toEqual({ error: 'text is required' });

    const blankText = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: JSON.stringify({ channel: 'C123', text: '   ' }),
    });
    expect(blankText.status).toBe(400);
    expect(blankText.body).toEqual({ error: 'text is required' });

    const ok = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: JSON.stringify({ channel: ' C123 ', text: '  hello  ', thread_ts: ' 123.456 ' }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, data: { ts: '123.456', channel: 'C123' } });
    expect(test.notificationSpies.postNotification).toHaveBeenCalledWith(
      'C123',
      '  hello  ',
      '123.456',
    );
  });

  it('POST /api/notify returns 502 when notification service fails', async () => {
    const test = createTestContext();
    test.notificationSpies.postNotification.mockRejectedValue(new Error('slack down'));
    const server = createApiServer(test);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/notify',
      headers: authHeaders(),
      body: JSON.stringify({ channel: 'C123', text: 'hello' }),
    });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Notification service error' });
  });

  it('GET /api/slack/targets proxies notification service targets', async () => {
    const test = createTestContext();
    test.notificationSpies.listTargets.mockResolvedValue([
      { id: 'U2', name: 'Bob', type: 'user' },
      { id: 'U1', name: 'U1', type: 'user' },
      { id: 'C1', name: 'alpha', type: 'channel' },
    ]);
    const server = createApiServer(test);

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/slack/targets',
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: [
        { id: 'U2', name: 'Bob', type: 'user' },
        { id: 'U1', name: 'U1', type: 'user' },
        { id: 'C1', name: 'alpha', type: 'channel' },
      ],
    });
  });

  it('GET /api/slack/targets returns 502 when notification service fails', async () => {
    const test = createTestContext();
    test.notificationSpies.listTargets.mockRejectedValue(new Error('backend down'));
    const server = createApiServer(test);

    const res = await invoke(server, {
      method: 'GET',
      path: '/api/slack/targets',
      headers: authHeaders(),
    });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Notification service error' });
  });

  it('returns 503 for schedule APIs when feature is disabled', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const runId = '22222222-2222-2222-2222-222222222222';
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = false;
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = {
      list: vi.fn(),
      create: vi.fn(),
      getById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      getRunsByTask: vi.fn(),
      getRunById: vi.fn(),
    };
    const server = createApiServer(test.ctx);

    for (const [method, path, body] of [
      ['POST', '/api/schedules', '{}'],
      ['GET', '/api/schedules', undefined],
      ['GET', `/api/schedules/${taskId}`, undefined],
      ['PATCH', `/api/schedules/${taskId}`, '{}'],
      ['DELETE', `/api/schedules/${taskId}`, undefined],
      ['GET', `/api/schedules/${taskId}/runs`, undefined],
      ['GET', `/api/schedules/${taskId}/runs/${runId}`, undefined],
    ] as const) {
      const res = await invoke(server, {
        method,
        path,
        headers: authHeaders(),
        body,
      });
      expect(res.status).toBe(503);
    }
  });

  it('validates schedule creation payload and creates once/recurring tasks', async () => {
    const test = createTestContext();
    const scheduleStore = {
      create: vi.fn((input: unknown) => ({
        id: 'task-1',
        ...((input as Record<string, unknown>) ?? {}),
      })),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (
      test.ctx as unknown as { config: Record<string, unknown> }
    ).config.scheduleDefaultNotifyChannel = null;
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    const cases: Array<{ body: string; expectedStatus: number; expectedError: string }> = [
      { body: '{bad', expectedStatus: 400, expectedError: 'Invalid JSON' },
      {
        body: JSON.stringify({ prompt: 'x', schedule_type: 'once' }),
        expectedStatus: 400,
        expectedError: 'name is required',
      },
      {
        body: JSON.stringify({ name: 'x', schedule_type: 'once' }),
        expectedStatus: 400,
        expectedError: 'prompt is required',
      },
      {
        body: JSON.stringify({ name: 'x', prompt: 'y', schedule_type: 'bad' }),
        expectedStatus: 400,
        expectedError: 'scheduleType must be "once" or "recurring"',
      },
      {
        body: JSON.stringify({ name: 'x', prompt: 'y', schedule_type: 'once', tool: 'bad' }),
        expectedStatus: 400,
        expectedError: 'tool must be claude, codex, or gemini',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'once',
          run_at: new Date(Date.now() + 60_000).toISOString(),
          timezone: 'Invalid/Timezone',
        }),
        expectedStatus: 400,
        expectedError: 'Invalid timezone: Invalid/Timezone',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'once',
          run_at: new Date(Date.now() + 60_000).toISOString(),
          max_runs: 0,
        }),
        expectedStatus: 400,
        expectedError: 'maxRuns must be a positive integer',
      },
      {
        body: JSON.stringify({ name: 'x', prompt: 'y', schedule_type: 'once' }),
        expectedStatus: 400,
        expectedError: 'runAt is required for once schedule',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'once',
          run_at: 'not-a-date',
        }),
        expectedStatus: 400,
        expectedError: 'runAt must be a valid ISO 8601 date',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'once',
          run_at: new Date(Date.now() - 120_000).toISOString(),
        }),
        expectedStatus: 400,
        expectedError: 'runAt must be in the future',
      },
      {
        body: JSON.stringify({ name: 'x', prompt: 'y', schedule_type: 'recurring' }),
        expectedStatus: 400,
        expectedError: 'cronExpr is required for recurring schedule',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'recurring',
          cron_expr: 'bad cron',
        }),
        expectedStatus: 400,
        expectedError: 'Invalid cron expression:',
      },
      {
        body: JSON.stringify({
          name: 'x',
          prompt: 'y',
          schedule_type: 'once',
          run_at: new Date(Date.now() + 60_000).toISOString(),
        }),
        expectedStatus: 400,
        expectedError: 'notifyChannel is required (or set SCHEDULE_DEFAULT_NOTIFY_CHANNEL)',
      },
    ];

    for (const c of cases) {
      const res = await invoke(server, {
        method: 'POST',
        path: '/api/schedules',
        headers: authHeaders(),
        body: c.body,
      });
      expect(res.status).toBe(c.expectedStatus);
      expect(String((res.body as { error?: string })?.error ?? '')).toContain(c.expectedError);
    }

    const onceRes = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'once task',
        prompt: 'do once',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        notify_channel: 'C123',
      }),
    });
    expect(onceRes.status).toBe(201);

    (
      test.ctx as unknown as { config: Record<string, unknown> }
    ).config.scheduleDefaultNotifyChannel = 'C999';
    const recurringRes = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'recurring task',
        prompt: 'do recurring',
        schedule_type: 'recurring',
        cron_expr: '0 * * * *',
      }),
    });
    expect(recurringRes.status).toBe(201);
    expect(scheduleStore.create).toHaveBeenCalledTimes(2);

    // "default" timezone should resolve to OS timezone (a valid IANA string)
    const defaultTzRes = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'default tz task',
        prompt: 'test default tz',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        timezone: 'default',
        notify_channel: 'C123',
      }),
    });
    expect(defaultTzRes.status).toBe(201);
    // Verify that the resolved timezone is a valid IANA string, not "default"
    const createCall = scheduleStore.create.mock.calls[2]?.[0] as { timezone?: string } | undefined;
    expect(createCall).toBeDefined();
    if (!createCall) {
      throw new Error('scheduleStore.create was not called for default timezone test');
    }
    expect(createCall.timezone).not.toBe('default');
    expect(typeof createCall.timezone).toBe('string');
    expect(createCall.timezone?.length).toBeGreaterThan(0);
  });

  it('validates schedule workdir on create and patch', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      scheduleType: 'recurring',
      timezone: 'UTC',
      cronExpr: '0 * * * *',
      notifyChannel: 'C123',
    };
    const scheduleStore = {
      create: vi.fn((input: unknown) => ({
        id: taskId,
        ...((input as Record<string, unknown>) ?? {}),
      })),
      getById: vi.fn(() => task),
      update: vi.fn(),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (
      test.ctx as unknown as { config: Record<string, unknown> }
    ).config.scheduleDefaultNotifyChannel = 'C123';
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    test.spies.validateCustomWorkdir.mockImplementationOnce(() => {
      throw new Error('Path not in allowed roots: /tmp/disallowed');
    });
    const invalidCreate = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'task',
        prompt: 'run',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        workdir: '/tmp/disallowed',
      }),
    });
    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body).toEqual({ error: 'Path not in allowed roots: /tmp/disallowed' });
    expect(scheduleStore.create).not.toHaveBeenCalled();

    test.spies.validateCustomWorkdir.mockReturnValueOnce('/validated/schedule-workdir');
    const validCreate = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'task',
        prompt: 'run',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        workdir: '/tmp/project',
      }),
    });
    expect(validCreate.status).toBe(201);
    expect(scheduleStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ workdir: '/validated/schedule-workdir' }),
    );

    test.spies.validateCustomWorkdir.mockImplementationOnce(() => {
      throw new Error('Path not in allowed roots: /tmp/disallowed');
    });
    const invalidPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ workdir: '/tmp/disallowed' }),
    });
    expect(invalidPatch.status).toBe(400);
    expect(invalidPatch.body).toEqual({ error: 'Path not in allowed roots: /tmp/disallowed' });

    test.spies.validateCustomWorkdir.mockReturnValueOnce('/validated/schedule-workdir-2');
    const validPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ workdir: '/tmp/project' }),
    });
    expect(validPatch.status).toBe(200);
    expect(scheduleStore.update).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({ workdir: '/validated/schedule-workdir-2' }),
      undefined,
    );
  });

  it('enforces allowedUserIds when creating and patching schedules', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      scheduleType: 'recurring',
      timezone: 'UTC',
      cronExpr: '0 * * * *',
      notifyChannel: 'C123',
      userId: 'dashboard',
    };
    const scheduleStore = {
      create: vi.fn((input: unknown) => ({
        id: taskId,
        ...((input as Record<string, unknown>) ?? {}),
      })),
      getById: vi.fn(() => task),
      update: vi.fn(),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (test.ctx as unknown as { config: Record<string, unknown> }).config.allowedUserIds = [
      'U_ALLOWED',
    ];
    (
      test.ctx as unknown as { config: Record<string, unknown> }
    ).config.scheduleDefaultNotifyChannel = 'C123';
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    const rejectedCreate = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'blocked schedule',
        prompt: 'run',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        notify_channel: 'C123',
        user_id: 'U_BLOCKED',
      }),
    });
    expect(rejectedCreate.status).toBe(403);
    expect(rejectedCreate.body).toEqual({ error: 'user_id not in allowlist' });
    expect(scheduleStore.create).not.toHaveBeenCalled();

    const dashboardCreate = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'dashboard schedule',
        prompt: 'run',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        notify_channel: 'C123',
      }),
    });
    expect(dashboardCreate.status).toBe(201);
    expect(scheduleStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'dashboard' }),
    );

    const trimmedCreate = await invoke(server, {
      method: 'POST',
      path: '/api/schedules',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'trimmed schedule',
        prompt: 'run',
        schedule_type: 'once',
        run_at: new Date(Date.now() + 120_000).toISOString(),
        notify_channel: ' C123 ',
        user_id: ' U_ALLOWED ',
      }),
    });
    expect(trimmedCreate.status).toBe(201);
    expect(scheduleStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'U_ALLOWED' }),
    );

    const rejectedPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ userId: 'U_BLOCKED' }),
    });
    expect(rejectedPatch.status).toBe(403);
    expect(rejectedPatch.body).toEqual({ error: 'user_id not in allowlist' });
    expect(scheduleStore.update).not.toHaveBeenCalled();
  });

  it('lists, fetches, patches, deletes schedules and returns run endpoints', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const runId = '22222222-2222-2222-2222-222222222222';
    const activeTask = {
      id: taskId,
      status: 'active',
      timezone: 'UTC',
      cronExpr: '0 * * * *',
    };
    const pausedTask = {
      ...activeTask,
      status: 'paused',
    };
    const run = { id: runId, taskId };
    const getById = vi
      .fn()
      .mockReturnValueOnce(activeTask) // GET detail
      .mockReturnValueOnce(activeTask) // PATCH invalid JSON
      .mockReturnValueOnce(activeTask) // PATCH invalid timezone
      .mockReturnValueOnce(activeTask) // PATCH "default" timezone: task before update
      .mockReturnValueOnce(activeTask) // PATCH "default" timezone: task after update
      .mockReturnValueOnce(activeTask) // PATCH invalid max_runs
      .mockReturnValueOnce(activeTask) // PATCH invalid cron
      .mockReturnValueOnce(activeTask) // PATCH pause: task before update
      .mockReturnValueOnce(pausedTask) // PATCH pause: task after update
      .mockReturnValueOnce(pausedTask) // PATCH resume: task before update
      .mockReturnValueOnce(activeTask) // PATCH resume: task after update
      .mockReturnValueOnce(activeTask) // DELETE success
      .mockReturnValueOnce(activeTask) // runs list
      .mockReturnValueOnce(null); // delete missing
    const scheduleStore = {
      list: vi.fn(() => [activeTask]),
      getById,
      getRunsByTask: vi.fn(() => [run]),
      update: vi.fn(),
      softDelete: vi.fn(),
      getRunById: vi.fn().mockReturnValue(run),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    const listRes = await invoke(server, {
      method: 'GET',
      path: '/api/schedules?status=active&user_id=dashboard',
      headers: authHeaders(),
    });
    expect(listRes.status).toBe(200);

    const detailRes = await invoke(server, {
      method: 'GET',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
    });
    expect(detailRes.status).toBe(200);

    const patchInvalidJson = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: '{bad',
    });
    expect(patchInvalidJson.status).toBe(400);

    const patchInvalidTz = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ timezone: 'Bad/TZ' }),
    });
    expect(patchInvalidTz.status).toBe(400);

    // PATCH with "default" timezone should resolve to OS timezone and succeed
    const patchDefaultTz = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ timezone: 'default' }),
    });
    expect(patchDefaultTz.status).toBe(200);
    // Verify update was called with a resolved IANA timezone, not "default"
    const updateCalls = scheduleStore.update.mock.calls;
    const tzPatchCall = updateCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>).timezone !== undefined,
    );
    if (tzPatchCall) {
      expect((tzPatchCall[1] as Record<string, unknown>).timezone).not.toBe('default');
    }

    const patchInvalidMaxRuns = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ max_runs: 0 }),
    });
    expect(patchInvalidMaxRuns.status).toBe(400);

    const patchInvalidCron = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ cron_expr: 'bad cron' }),
    });
    expect(patchInvalidCron.status).toBe(400);

    const patchPause = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(patchPause.status).toBe(200);

    const patchResume = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ status: 'active' }),
    });
    expect(patchResume.status).toBe(200);

    const deleteOk = await invoke(server, {
      method: 'DELETE',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
    });
    expect(deleteOk.status).toBe(200);

    const runsRes = await invoke(server, {
      method: 'GET',
      path: `/api/schedules/${taskId}/runs?limit=999`,
      headers: authHeaders(),
    });
    expect(runsRes.status).toBe(200);
    expect(scheduleStore.getRunsByTask).toHaveBeenCalledWith(taskId, 100);

    const runDetailRes = await invoke(server, {
      method: 'GET',
      path: `/api/schedules/${taskId}/runs/${runId}`,
      headers: authHeaders(),
    });
    expect(runDetailRes.status).toBe(200);

    const deleteMissing = await invoke(server, {
      method: 'DELETE',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
    });
    expect(deleteMissing.status).toBe(404);
  });

  it('recomputes schedule userId on patch using the same precedence as create', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      scheduleType: 'recurring',
      timezone: 'UTC',
      cronExpr: '0 * * * *',
      notifyChannel: 'UOLD123',
      userId: 'UOLD123',
    };
    const scheduleStore = {
      getById: vi.fn(() => task),
      update: vi.fn(),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (test.ctx as unknown as { config: Record<string, unknown> }).config.allowedUserIds = [
      'U99999999',
    ];
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    const switchToChannel = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ notifyChannel: 'C12345678' }),
    });
    expect(switchToChannel.status).toBe(200);
    expect(scheduleStore.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ notifyChannel: 'C12345678', userId: 'dashboard' }),
    );

    const explicitUserId = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ userId: 'U99999999', notifyChannel: 'C12345678' }),
    });
    expect(explicitUserId.status).toBe(200);
    expect(scheduleStore.update.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ notifyChannel: 'C12345678', userId: 'U99999999' }),
    );
  });

  it('resumes a paused once-task and restores nextRunAt from runAt', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const futureRunAt = new Date(Date.now() + 600_000).toISOString();
    const pastRunAt = new Date(Date.now() - 600_000).toISOString();

    const pausedOnceTaskFuture = {
      id: taskId,
      status: 'paused',
      scheduleType: 'once',
      runAt: futureRunAt,
      cronExpr: null,
      timezone: 'UTC',
    };
    const pausedOnceTaskPast = {
      id: taskId,
      status: 'paused',
      scheduleType: 'once',
      runAt: pastRunAt,
      cronExpr: null,
      timezone: 'UTC',
    };

    const getById = vi
      .fn()
      .mockReturnValueOnce(pausedOnceTaskFuture) // PATCH resume future: task before
      .mockReturnValueOnce({ ...pausedOnceTaskFuture, status: 'active' }) // PATCH resume future: task after
      .mockReturnValueOnce(pausedOnceTaskPast) // PATCH resume past: task before
      .mockReturnValueOnce({ ...pausedOnceTaskPast, status: 'active' }); // PATCH resume past: task after
    const scheduleStore = {
      list: vi.fn(() => []),
      getById,
      getRunsByTask: vi.fn(() => []),
      update: vi.fn(),
      softDelete: vi.fn(),
      getRunById: vi.fn(),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.scheduleEnabled = true;
    (test.ctx as unknown as { scheduleStore: unknown }).scheduleStore = scheduleStore;
    const server = createApiServer(test.ctx);

    // Resume a once-task with future runAt → nextRunAt restored
    const resumeFuture = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ status: 'active' }),
    });
    expect(resumeFuture.status).toBe(200);
    const futureCall = scheduleStore.update.mock.calls[0];
    expect(futureCall).toBeDefined();
    expect(futureCall?.[1]).toEqual(
      expect.objectContaining({ status: 'active', nextRunAt: futureRunAt }),
    );

    // Resume a once-task with past runAt → nextRunAt is null
    const resumePast = await invoke(server, {
      method: 'PATCH',
      path: `/api/schedules/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ status: 'active' }),
    });
    expect(resumePast.status).toBe(200);
    const pastCall = scheduleStore.update.mock.calls[1];
    expect(pastCall).toBeDefined();
    expect(pastCall?.[1]).toEqual(expect.objectContaining({ status: 'active', nextRunAt: null }));
  });

  it('recomputes on-demand userId on patch using the same precedence as create', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      notifyChannel: 'UOLD123',
      userId: 'UOLD123',
    };
    const ondemandTaskStore = {
      getById: vi.fn(() => task),
      update: vi.fn(),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.allowedUserIds = [
      'U22222222',
      'U99999999',
    ];
    (test.ctx as unknown as { ondemandTaskStore: unknown }).ondemandTaskStore = ondemandTaskStore;
    const server = createApiServer(test.ctx);

    const switchToDm = await invoke(server, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ notifyChannel: 'U22222222' }),
    });
    expect(switchToDm.status).toBe(200);
    expect(ondemandTaskStore.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ notifyChannel: 'U22222222', userId: 'U22222222' }),
    );

    const explicitUserId = await invoke(server, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ userId: 'U99999999', notifyChannel: 'C12345678' }),
    });
    expect(explicitUserId.status).toBe(200);
    expect(ondemandTaskStore.update.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ notifyChannel: 'C12345678', userId: 'U99999999' }),
    );
  });

  it('validates on-demand workdir on create and patch', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      notifyChannel: null,
      userId: 'dashboard',
    };
    const ondemandTaskStore = {
      create: vi.fn((input: unknown) => ({
        id: taskId,
        ...((input as Record<string, unknown>) ?? {}),
      })),
      getById: vi.fn(() => task),
      update: vi.fn(),
      getRunsByTask: vi.fn(() => []),
    };
    (test.ctx as unknown as { ondemandTaskStore: unknown }).ondemandTaskStore = ondemandTaskStore;
    const server = createApiServer(test.ctx);

    test.spies.validateCustomWorkdir.mockImplementationOnce(() => {
      throw new Error('Path not in allowed roots: /tmp/disallowed');
    });
    const invalidCreate = await invoke(server, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'task',
        prompt: 'run',
        workdir: '/tmp/disallowed',
      }),
    });
    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body).toEqual({ error: 'Path not in allowed roots: /tmp/disallowed' });
    expect(ondemandTaskStore.create).not.toHaveBeenCalled();

    test.spies.validateCustomWorkdir.mockReturnValueOnce('/validated/ondemand-workdir');
    const validCreate = await invoke(server, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'task',
        prompt: 'run',
        workdir: '/tmp/project',
      }),
    });
    expect(validCreate.status).toBe(201);
    expect(ondemandTaskStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ workdir: '/validated/ondemand-workdir' }),
    );

    test.spies.validateCustomWorkdir.mockImplementationOnce(() => {
      throw new Error('Path not in allowed roots: /tmp/disallowed');
    });
    const invalidPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ workdir: '/tmp/disallowed' }),
    });
    expect(invalidPatch.status).toBe(400);
    expect(invalidPatch.body).toEqual({ error: 'Path not in allowed roots: /tmp/disallowed' });

    test.spies.validateCustomWorkdir.mockReturnValueOnce('/validated/ondemand-workdir-2');
    const validPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ workdir: '/tmp/project' }),
    });
    expect(validPatch.status).toBe(200);
    expect(ondemandTaskStore.update).toHaveBeenLastCalledWith(
      taskId,
      expect.objectContaining({ workdir: '/validated/ondemand-workdir-2' }),
      undefined,
    );
  });

  it('enforces allowedUserIds when creating and patching on-demand tasks', async () => {
    const test = createTestContext();
    const taskId = '11111111-1111-1111-1111-111111111111';
    const task = {
      id: taskId,
      status: 'active',
      notifyChannel: 'C123',
      userId: 'dashboard',
    };
    const ondemandTaskStore = {
      create: vi.fn((input: unknown) => ({
        id: taskId,
        ...((input as Record<string, unknown>) ?? {}),
      })),
      getById: vi.fn(() => task),
      update: vi.fn(),
      getRunsByTask: vi.fn(() => []),
    };
    (test.ctx as unknown as { config: Record<string, unknown> }).config.allowedUserIds = [
      'U_ALLOWED',
    ];
    (test.ctx as unknown as { ondemandTaskStore: unknown }).ondemandTaskStore = ondemandTaskStore;
    const server = createApiServer(test.ctx);

    const rejectedCreate = await invoke(server, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'blocked task',
        prompt: 'run',
        notify_channel: 'C123',
        user_id: 'U_BLOCKED',
      }),
    });
    expect(rejectedCreate.status).toBe(403);
    expect(rejectedCreate.body).toEqual({ error: 'user_id not in allowlist' });
    expect(ondemandTaskStore.create).not.toHaveBeenCalled();

    const dashboardCreate = await invoke(server, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'dashboard task',
        prompt: 'run',
        notify_channel: 'C123',
      }),
    });
    expect(dashboardCreate.status).toBe(201);
    expect(ondemandTaskStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'dashboard' }),
    );

    const trimmedCreate = await invoke(server, {
      method: 'POST',
      path: '/api/ondemand-tasks',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'trimmed task',
        prompt: 'run',
        notify_channel: ' C123 ',
        user_id: ' U_ALLOWED ',
      }),
    });
    expect(trimmedCreate.status).toBe(201);
    expect(ondemandTaskStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'U_ALLOWED' }),
    );

    const rejectedPatch = await invoke(server, {
      method: 'PATCH',
      path: `/api/ondemand-tasks/${taskId}`,
      headers: authHeaders(),
      body: JSON.stringify({ userId: 'U_BLOCKED' }),
    });
    expect(rejectedPatch.status).toBe(403);
    expect(rejectedPatch.body).toEqual({ error: 'user_id not in allowlist' });
    expect(ondemandTaskStore.update).not.toHaveBeenCalled();
  });
});

describe('matchChatStatus', () => {
  it('extracts session ID from valid status path', () => {
    expect(matchChatStatus('/api/chat/a1b2c3d4/status')).toBe('a1b2c3d4');
    expect(matchChatStatus('/api/chat/deadbeef/status')).toBe('deadbeef');
  });

  it('returns null for invalid paths', () => {
    expect(matchChatStatus('/api/chat/invalid/status')).toBeNull();
    expect(matchChatStatus('/api/chat/a1b2c3d4/stop')).toBeNull();
    expect(matchChatStatus('/api/chat/a1b2c3d4')).toBeNull();
    expect(matchChatStatus('/api/chat/ABCDEF12/status')).toBeNull();
  });
});

describe('orchestrator API', () => {
  it('POST /api/orchestrators returns 409 for duplicate name', async () => {
    const test = createTestContext();
    const orchestratorStore = {
      create: vi.fn(() => {
        throw new Error('Name "Pipeline A" is already in use');
      }),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A' }),
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Name "Pipeline A" is already in use' });
    expect(orchestratorStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pipeline A' }),
    );
  });

  it('POST /api/orchestrators returns 400 for invalid orchestrator limits', async () => {
    const test = createTestContext();
    const orchestratorStore = {
      create: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A', maxParallelism: 0 }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'maxParallelism must be between 1 and 20' });
    expect(orchestratorStore.create).not.toHaveBeenCalled();
  });

  it('POST /api/orchestrators returns 400 for invalid orchestrator timeout', async () => {
    const test = createTestContext();
    const orchestratorStore = {
      create: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A', timeoutSec: 0 }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'timeoutSec must be between 1 and 86400' });
    expect(orchestratorStore.create).not.toHaveBeenCalled();
  });

  it('POST /api/orchestrators validates summary settings', async () => {
    const test = createTestContext();
    const orchestratorStore = {
      create: vi.fn((input: Record<string, unknown>) => ({
        id: 'orch-summary',
        status: 'active',
        ...input,
      })),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const missingTool = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A', summaryEnabled: true }),
    });
    expect(missingTool.status).toBe(400);
    expect(missingTool.body).toEqual({
      error: 'summaryTool is required when summaryEnabled is true',
    });

    const valid = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Pipeline B',
        summaryEnabled: true,
        summaryTool: 'codex',
      }),
    });
    expect(valid.status).toBe(201);
    expect(orchestratorStore.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        summaryEnabled: true,
        summaryTool: 'codex',
      }),
    );
  });

  it('POST /api/orchestrators validates custom workdir paths', async () => {
    const test = createTestContext();
    const orchestratorStore = {
      create: vi.fn((input: Record<string, unknown>) => ({
        id: 'orch-workdir',
        status: 'active',
        ...input,
      })),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    test.spies.validateCustomWorkdir.mockReturnValue('/validated/orchestrator-workdir');
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A', workdir: '/tmp/project' }),
    });

    expect(res.status).toBe(201);
    expect(test.spies.validateCustomWorkdir).toHaveBeenCalledWith('/tmp/project');
    expect(orchestratorStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ workdir: '/validated/orchestrator-workdir' }),
    );
  });

  it('PATCH /api/orchestrators/:id returns 409 for duplicate name and alias', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: null,
      runAt: null,
      cronExpr: null,
      timezone: 'UTC',
    };
    const orchestratorStore = {
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    orchestratorStore.isNameAvailable.mockReturnValueOnce(false);
    const duplicateName = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ name: '  Pipeline A  ' }),
    });
    expect(duplicateName.status).toBe(409);
    expect(duplicateName.body).toEqual({ error: 'Name "Pipeline A" is already in use' });
    expect(orchestratorStore.isNameAvailable).toHaveBeenCalledWith('Pipeline A', orchestratorId);
    expect(orchestratorStore.update).not.toHaveBeenCalled();

    orchestratorStore.isAliasAvailable.mockReturnValueOnce(false);
    const duplicateAlias = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ alias: '  pipe-a  ' }),
    });
    expect(duplicateAlias.status).toBe(409);
    expect(duplicateAlias.body).toEqual({ error: 'Alias "pipe-a" is already in use' });
    expect(orchestratorStore.isAliasAvailable).toHaveBeenCalledWith('pipe-a', orchestratorId);
    expect(orchestratorStore.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id returns 400 for invalid orchestrator limits', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: null,
      runAt: null,
      cronExpr: null,
      timezone: 'UTC',
    };
    const orchestratorStore = {
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ maxTotalNodes: 500 }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'maxTotalNodes must be between 1 and 200' });
    expect(orchestratorStore.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id returns 400 for invalid scheduleType and errorPolicy', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: null,
      runAt: null,
      cronExpr: null,
      timezone: 'UTC',
    };
    const orchestratorStore = {
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const badSchedule = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ scheduleType: 'daily' }),
    });
    expect(badSchedule.status).toBe(400);
    expect(badSchedule.body).toEqual({
      error: 'Invalid scheduleType: daily. Must be one of: once, recurring',
    });

    const badErrorPolicy = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ errorPolicy: 'abort' }),
    });
    expect(badErrorPolicy.status).toBe(400);
    expect(badErrorPolicy.body).toEqual({
      error: 'Invalid errorPolicy: abort. Must be one of: fail_fast, continue',
    });
    expect(orchestratorStore.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id validates summary settings', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: null,
      runAt: null,
      cronExpr: null,
      timezone: 'UTC',
      summaryEnabled: false,
      summaryTool: null,
    };
    const orchestratorStore = {
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const invalidTool = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ summaryTool: 'invalid' }),
    });
    expect(invalidTool.status).toBe(400);
    expect(invalidTool.body).toEqual({
      error: 'Invalid summaryTool: invalid. Must be one of: claude, codex, gemini',
    });

    const missingTool = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ summaryEnabled: true }),
    });
    expect(missingTool.status).toBe(400);
    expect(missingTool.body).toEqual({
      error: 'summaryTool is required when summaryEnabled is true',
    });

    const valid = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ summaryEnabled: true, summaryTool: 'gemini' }),
    });
    expect(valid.status).toBe(200);
    expect(orchestratorStore.update).toHaveBeenCalledWith(
      orchestratorId,
      expect.objectContaining({
        summaryEnabled: true,
        summaryTool: 'gemini',
      }),
      undefined,
    );
  });

  it('PATCH /api/orchestrators/:id validates custom workdir paths', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: null,
      runAt: null,
      cronExpr: null,
      timezone: 'UTC',
      summaryEnabled: false,
      summaryTool: null,
    };
    const orchestratorStore = {
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    test.spies.validateCustomWorkdir.mockReturnValue('/validated/orchestrator-workdir');
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ workdir: '/tmp/project' }),
    });

    expect(res.status).toBe(200);
    expect(test.spies.validateCustomWorkdir).toHaveBeenCalledWith('/tmp/project');
    expect(orchestratorStore.update).toHaveBeenCalledWith(
      orchestratorId,
      expect.objectContaining({ workdir: '/validated/orchestrator-workdir' }),
      undefined,
    );
  });

  it('resolves default timezone for orchestrator create and patch', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const existingOrchestrator = {
      id: orchestratorId,
      name: 'Original',
      alias: 'original',
      status: 'active',
      scheduleType: 'recurring',
      runAt: null,
      cronExpr: '0 * * * *',
      timezone: 'UTC',
    };
    const orchestratorStore = {
      create: vi.fn((input: Record<string, unknown>) => ({
        id: orchestratorId,
        status: 'active',
        ...input,
      })),
      getById: vi.fn(() => existingOrchestrator),
      isNameAvailable: vi.fn(() => true),
      isAliasAvailable: vi.fn(() => true),
      update: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const createRes = await invoke(server, {
      method: 'POST',
      path: '/api/orchestrators',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Pipeline A', timezone: 'default' }),
    });
    expect(createRes.status).toBe(201);
    const createCall = orchestratorStore.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createCall.timezone).not.toBe('default');
    expect(typeof createCall.timezone).toBe('string');

    const patchRes = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}`,
      headers: authHeaders(),
      body: JSON.stringify({ timezone: 'default' }),
    });
    expect(patchRes.status).toBe(200);
    const patchCall = orchestratorStore.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patchCall.timezone).not.toBe('default');
    expect(typeof patchCall.timezone).toBe('string');
  });

  it('POST /api/orchestrators/:id/nodes validates task-level workdir and instruction settings', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, status: 'active' })),
      createNode: vi.fn((input: Record<string, unknown>) => ({ id: 'node-1', ...input })),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    test.spies.validateCustomWorkdir.mockReturnValue('/validated/workdir');
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/nodes`,
      headers: authHeaders(),
      body: JSON.stringify({
        label: 'Task A',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Run task',
        workdir: '/tmp/project',
        writeInstructionFile: false,
        instructionFile: '# Node instructions',
      }),
    });

    expect(res.status).toBe(201);
    expect(test.spies.validateCustomWorkdir).toHaveBeenCalledWith('/tmp/project');
    expect(orchestratorStore.createNode).toHaveBeenCalledWith(
      expect.objectContaining({
        workdir: '/validated/workdir',
        writeInstructionFile: false,
        instructionFile: '# Node instructions',
      }),
    );
  });

  it('POST /api/orchestrators/:id/nodes rejects invalid retry and wait timeout limits', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, status: 'active' })),
      createNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const retryRes = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/nodes`,
      headers: authHeaders(),
      body: JSON.stringify({
        label: 'Task A',
        nodeType: 'task',
        tool: 'claude',
        prompt: 'Run task',
        maxRetries: 11,
      }),
    });
    expect(retryRes.status).toBe(400);
    expect(retryRes.body).toEqual({ error: 'maxRetries must be between 0 and 10' });

    const waitRes = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/nodes`,
      headers: authHeaders(),
      body: JSON.stringify({
        label: 'Waiter',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'wait',
        triggeredConfig: {
          waitTimeoutSec: 86_401,
          onTimeout: 'fail',
        },
      }),
    });
    expect(waitRes.status).toBe(400);
    expect(waitRes.body).toEqual({ error: 'waitTimeoutSec must be between 1 and 86400' });
    expect(orchestratorStore.createNode).not.toHaveBeenCalled();
  });

  it('POST /api/orchestrators/:id/nodes rejects triggeredSubscription objects without endpointId', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, status: 'active' })),
      createNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/nodes`,
      headers: authHeaders(),
      body: JSON.stringify({
        label: 'Waiter',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'wait',
        triggeredSubscription: {
          enabled: false,
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'triggeredSubscription.endpointId is required when triggeredSubscription is provided; use null to remove the subscription',
    });
    expect(orchestratorStore.createNode).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id/nodes/:id clears task-only fields for gate nodes without validating them', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const existingNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'task',
      workdir: '/tmp/project',
      writeInstructionFile: false,
      instructionFile: '# old',
    };
    const updatedNode = {
      ...existingNode,
      nodeType: 'gate',
      workdir: null,
      writeInstructionFile: true,
      instructionFile: null,
      returnValues: ['true', 'false'],
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: 'start-node' })),
      getNodeById: vi.fn().mockReturnValueOnce(existingNode).mockReturnValueOnce(updatedNode),
      updateNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    test.spies.validateCustomWorkdir.mockImplementation(() => {
      throw new Error('should not validate non-task workdir');
    });
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({
        nodeType: 'gate',
        workdir: '/tmp/project',
        writeInstructionFile: false,
        instructionFile: '# ignored',
      }),
    });

    expect(res.status).toBe(200);
    expect(test.spies.validateCustomWorkdir).not.toHaveBeenCalled();
    expect(orchestratorStore.updateNode).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({
        nodeType: 'gate',
        workdir: null,
        writeInstructionFile: true,
        instructionFile: null,
        returnValues: ['true', 'false'],
      }),
      undefined,
    );
  });

  it('PATCH /api/orchestrators/:id/nodes/:id rejects invalid task execution limits', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const existingNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'task',
      tool: 'claude',
      prompt: 'run',
      updatedAt: '2026-03-08T00:00:00Z',
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: 'start-node' })),
      getNodeById: vi.fn(() => existingNode),
      updateNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({ timeoutSec: 21_601 }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'timeoutSec must be between 1 and 21600' });
    expect(orchestratorStore.updateNode).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id/nodes/:id rejects triggeredSubscription objects without endpointId', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const existingNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'triggered',
      tool: 'claude',
      prompt: 'wait',
      updatedAt: '2026-03-08T00:00:00Z',
    };
    const eventSubscriptionStore = {
      getTriggeredNodeSubscription: vi.fn(() => ({ id: 'sub-1' })),
      delete: vi.fn(),
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: 'start-node' })),
      getNodeById: vi.fn().mockReturnValue(existingNode),
      updateNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    (test.ctx as unknown as { eventSubscriptionStore: unknown }).eventSubscriptionStore =
      eventSubscriptionStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({
        triggeredSubscription: {
          enabled: false,
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'triggeredSubscription.endpointId is required when triggeredSubscription is provided; use null to remove the subscription',
    });
    expect(orchestratorStore.updateNode).not.toHaveBeenCalled();
    expect(eventSubscriptionStore.delete).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id/nodes/:id keeps position-only gate edits position-only', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const existingNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'gate',
      workdir: null,
      writeInstructionFile: true,
      instructionFile: null,
      updatedAt: '2026-03-08T00:00:00Z',
    };
    const updatedNode = {
      ...existingNode,
      positionX: 120,
      positionY: 240,
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: 'start-node' })),
      getNodeById: vi.fn().mockReturnValueOnce(existingNode).mockReturnValueOnce(updatedNode),
      updateNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({
        positionX: 120,
        positionY: 240,
        updatedAt: existingNode.updatedAt,
      }),
    });

    expect(res.status).toBe(200);
    // Position-only patches use the fast path: no cleanup, no concurrency check, no timestamp bump
    expect(orchestratorStore.updateNode).toHaveBeenCalledWith(
      nodeId,
      { positionX: 120, positionY: 240 },
      undefined,
      { autoTimestamp: false },
    );
    expect(orchestratorStore.invalidateDag).not.toHaveBeenCalled();
  });

  it('PATCH /api/orchestrators/:id/nodes/:id reloads webhook subscriptions when a triggered node changes type', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const existingNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'triggered',
      tool: 'claude',
      prompt: 'wait',
      triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      updatedAt: '2026-03-08T00:00:00Z',
    };
    const updatedNode = {
      ...existingNode,
      nodeType: 'task',
      triggeredConfig: null,
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: 'start-node' })),
      getNodeById: vi.fn().mockReturnValueOnce(existingNode).mockReturnValueOnce(updatedNode),
      updateNode: vi.fn(),
      invalidateDag: vi.fn(),
      transaction: vi.fn(<T>(fn: () => T) => fn()),
    };
    const eventRouter = {
      reload: vi.fn(async () => undefined),
    };
    const eventSubscriptionStore = {
      getTriggeredNodeSubscription: vi.fn(() => ({ id: 'sub-triggered-node' })),
      delete: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    (test.ctx as unknown as { eventRouter: unknown }).eventRouter = eventRouter;
    (test.ctx as unknown as { eventSubscriptionStore: unknown }).eventSubscriptionStore =
      eventSubscriptionStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({
        nodeType: 'task',
        updatedAt: existingNode.updatedAt,
      }),
    });

    expect(res.status).toBe(200);
    expect(orchestratorStore.updateNode).toHaveBeenCalledWith(
      nodeId,
      expect.objectContaining({
        nodeType: 'task',
        triggeredConfig: null,
      }),
      existingNode.updatedAt,
    );
    expect(eventSubscriptionStore.delete).toHaveBeenCalledWith('sub-triggered-node');
    expect(eventRouter.reload).toHaveBeenCalledOnce();
  });

  it('rejects deleting or changing the start node via API', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const nodeId = '22222222-2222-2222-2222-222222222222';
    const startNode = {
      id: nodeId,
      orchestratorId,
      nodeType: 'task',
      updatedAt: '2026-03-08T00:00:00Z',
    };
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, startNodeId: nodeId })),
      getNodeById: vi.fn(() => startNode),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      invalidateDag: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const patchRes = await invoke(server, {
      method: 'PATCH',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
      body: JSON.stringify({ nodeType: 'gate', updatedAt: startNode.updatedAt }),
    });
    expect(patchRes.status).toBe(400);
    expect(patchRes.body).toEqual({ error: 'Start node type cannot be changed' });
    expect(orchestratorStore.updateNode).not.toHaveBeenCalled();

    const deleteRes = await invoke(server, {
      method: 'DELETE',
      path: `/api/orchestrators/${orchestratorId}/nodes/${nodeId}`,
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(400);
    expect(deleteRes.body).toEqual({ error: 'Start node cannot be deleted' });
    expect(orchestratorStore.deleteNode).not.toHaveBeenCalled();
  });

  it('POST /api/orchestrators/:id/revert returns 400 when validated snapshot is invalid', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({ id: orchestratorId, status: 'active' })),
      getRunningRuns: vi.fn(() => []),
      revertToValidatedSnapshot: vi.fn(() => {
        throw new Error(
          'Validated snapshot node "Wait for Event" is invalid: waitTimeoutSec must be between 1 and 86400',
        );
      }),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/revert`,
      headers: authHeaders(),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'Validated snapshot node "Wait for Event" is invalid: waitTimeoutSec must be between 1 and 86400',
    });
    expect(orchestratorStore.revertToValidatedSnapshot).toHaveBeenCalledWith(orchestratorId);
  });

  it('POST /api/orchestrators/:id/validate fails for webhook orchestrators without a webhook subscription', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({
        id: orchestratorId,
        status: 'active',
        triggerMode: 'webhook',
        startNodeId: null,
        maxTotalNodes: 50,
      })),
      getNodesByOrchestrator: vi.fn(() => []),
      getEdgesByOrchestrator: vi.fn(() => []),
      update: vi.fn(),
      saveValidatedSnapshot: vi.fn(),
    };
    const eventSubscriptionStore = {
      list: vi.fn(() => []),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    (test.ctx as unknown as { eventSubscriptionStore: unknown }).eventSubscriptionStore =
      eventSubscriptionStore;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/validate`,
      headers: authHeaders(),
      body: JSON.stringify({ commit: true }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      error: 'DAG validation failed',
      data: expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: 'WEBHOOK_TRIGGER_NO_SUBSCRIPTION',
          }),
        ]),
      }),
    });
    expect(orchestratorStore.update).not.toHaveBeenCalled();
    expect(orchestratorStore.saveValidatedSnapshot).not.toHaveBeenCalled();
  });

  it('POST /api/orchestrators/:id/execute rejects manual runs for webhook orchestrators', async () => {
    const test = createTestContext();
    const orchestratorId = '11111111-1111-1111-1111-111111111111';
    const orchestratorStore = {
      getById: vi.fn(() => ({
        id: orchestratorId,
        status: 'active',
        triggerMode: 'webhook',
        dagValidated: true,
        workdir: null,
      })),
    };
    const orchestratorEngine = {
      startRun: vi.fn(),
    };
    (test.ctx as unknown as { orchestratorStore: unknown }).orchestratorStore = orchestratorStore;
    (test.ctx as unknown as { orchestratorEngine: unknown }).orchestratorEngine =
      orchestratorEngine;
    const server = createApiServer(test.ctx);

    const res = await invoke(server, {
      method: 'POST',
      path: `/api/orchestrators/${orchestratorId}/execute`,
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'Webhook-triggered orchestrators cannot be started manually. Use the configured webhook endpoint.',
    });
    expect(orchestratorEngine.startRun).not.toHaveBeenCalled();
  });
});

describe('startApiServer', () => {
  it('starts server on configured localhost port and logs startup', () => {
    const { ctx } = createTestContext();
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
      ...args: unknown[]
    ) {
      const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
      cb?.();
      return this;
    });

    const server = startApiServer(ctx);

    expect(server).toBeInstanceOf(Server);
    expect(listenSpy).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
    expect(mocked.loggerInfo).toHaveBeenCalledWith('api_server_started', {
      port: 0,
      host: '127.0.0.1',
    });
  });

  it('exits fatally when EADDRINUSE and no stale process is found', () => {
    const { ctx } = createTestContext();
    mocked.daemonFindPidOnPort.mockReturnValue(null);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
    ) {
      return this;
    });

    const server = startApiServer(ctx);
    server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));

    expect(mocked.loggerWarn).toHaveBeenCalledWith('api_port_in_use', {
      port: 0,
      action: 'attempting_recovery',
    });
    expect(mocked.loggerError).toHaveBeenCalledWith('api_port_in_use_fatal', {
      port: 0,
      msg: 'no stale process found',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(listenSpy).toHaveBeenCalledOnce();
  });

  it('kills stale process and retries listen when EADDRINUSE occurs', () => {
    const { ctx } = createTestContext();
    mocked.daemonFindPidOnPort.mockReturnValue(4321);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as never);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as never);
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
      ...args: unknown[]
    ) {
      const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
      cb?.();
      return this;
    });

    const server = startApiServer(ctx);
    server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));

    expect(mocked.loggerInfo).toHaveBeenCalledWith('killing_stale_process', { pid: 4321, port: 0 });
    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGTERM');
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(listenSpy).toHaveBeenNthCalledWith(2, 0, '127.0.0.1', expect.any(Function));
    expect(mocked.loggerInfo).toHaveBeenCalledWith('api_server_started', {
      port: 0,
      host: '127.0.0.1',
      recovered: true,
    });
  });

  it('exits when EADDRINUSE happens again after retry', () => {
    const { ctx } = createTestContext();
    mocked.daemonFindPidOnPort.mockReturnValue(9999);
    vi.spyOn(process, 'kill').mockImplementation((() => true) as never);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as never);
    const listenSpy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
      this: Server,
    ) {
      return this;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const server = startApiServer(ctx);
    server.emit('error', Object.assign(new Error('first'), { code: 'EADDRINUSE' }));
    server.emit('error', Object.assign(new Error('second'), { code: 'EADDRINUSE' }));

    expect(mocked.loggerError).toHaveBeenCalledWith('api_port_in_use_fatal', {
      port: 0,
      msg: 'retry also failed',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(listenSpy).toHaveBeenCalled();
  });
});

describe('injectProcessSeparator', () => {
  it('returns text unchanged for unsupported drivers', () => {
    expect(injectProcessSeparator('hello world', 'unknown_driver', true, 5)).toBe('hello world');
  });

  it('returns text unchanged when no tool event and no heuristic match', () => {
    expect(injectProcessSeparator('hello world', 'codex', false, -1)).toBe('hello world');
  });

  it('returns text unchanged when lastToolCharOffset is negative', () => {
    expect(injectProcessSeparator('hello world', 'codex', true, -1)).toBe('hello world');
  });

  it('returns text unchanged when process part is empty (tool at offset 0)', () => {
    expect(injectProcessSeparator('final answer only', 'codex', true, 0)).toBe('final answer only');
  });

  it('returns text unchanged when answer part is empty (tool at end)', () => {
    const text = 'process narration';
    expect(injectProcessSeparator(text, 'codex', true, text.length)).toBe(text);
  });

  it('inserts separator between process and answer for codex with tool events', () => {
    const text = 'thinking about it...the final answer';
    const offset = 20; // after 'thinking about it...'
    const result = injectProcessSeparator(text, 'codex', true, offset);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('thinking about it...');
    expect(parts[1]?.trim()).toBe('the final answer');
  });

  it('handles whitespace-only process part as empty', () => {
    const text = '   the final answer';
    expect(injectProcessSeparator(text, 'codex', true, 3)).toBe(text);
  });

  it('handles whitespace-only answer part as empty', () => {
    const text = 'process narration   ';
    expect(injectProcessSeparator(text, 'codex', true, text.length - 3)).toBe(text);
  });

  it('uses heuristic fallback when no tool events (What you asked marker)', () => {
    const text =
      'まず research-freshness スキルの手順を確認し、情報を集めます。主要論点は揃っています。追加情報を確認してまとめます。ここまでで十分な長さになりました。\nWhat you asked: topic\n\nDirect answer here';
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toContain('主要論点は揃っています');
    expect(parts[1]?.trim()).toContain('What you asked');
  });

  it('uses heuristic fallback when no tool events (bold What you asked)', () => {
    const text =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters for detection.\n**What you asked**\nAnswer text';
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
  });

  it('uses heuristic fallback with heading marker', () => {
    const text =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters for detection.\n## Summary\nAnswer text';
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[1]?.trim()).toMatch(/^## Summary/);
  });

  it('prefers tool offset over heuristic when both available', () => {
    const text =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters.\n## Heading\nTool output then final answer';
    // Tool offset at 50 — different from heading position
    const result = injectProcessSeparator(text, 'codex', true, 50);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Process narration text that is long enough to exce');
  });

  it('does not split when heuristic marker appears too early (<80 chars)', () => {
    const text = 'Short intro.\n## Heading\nAnswer';
    expect(injectProcessSeparator(text, 'codex', false, -1)).toBe(text);
  });

  // --- Explicit <!-- answer --> marker tests ---

  it('splits on explicit <!-- answer --> marker from Codex', () => {
    const text = `Thinking about the problem...\n${CODEX_ANSWER_MARKER}\nHere is the answer.`;
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Thinking about the problem...');
    expect(parts[1]?.trim()).toBe('Here is the answer.');
  });

  it('strips explicit marker when process part is empty', () => {
    const text = `${CODEX_ANSWER_MARKER}\nJust an answer.`;
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    expect(result).not.toContain(PROCESS_END_SEPARATOR);
    expect(result).toBe('Just an answer.');
  });

  it('strips explicit marker when answer part is empty', () => {
    const text = `Only process text.\n${CODEX_ANSWER_MARKER}`;
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    expect(result).not.toContain(PROCESS_END_SEPARATOR);
    expect(result).toBe('Only process text.');
  });

  it('explicit marker takes priority over tool offset', () => {
    const text = `Process narration\n${CODEX_ANSWER_MARKER}\nFinal answer`;
    // Even with sawToolEvent=true and an offset, explicit marker wins
    const result = injectProcessSeparator(text, 'codex', true, 5);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Process narration');
    expect(parts[1]?.trim()).toBe('Final answer');
  });

  it('explicit marker takes priority over heuristic markers', () => {
    const text = `${'x'.repeat(100)}\n${CODEX_ANSWER_MARKER}\n## Heading\nAnswer`;
    const result = injectProcessSeparator(text, 'codex', false, -1);
    const parts = result.split(PROCESS_END_SEPARATOR);
    // Split should be at <!-- answer -->, not at ## Heading
    expect(parts[1]?.trim()).toMatch(/^## Heading/);
  });

  it('splits gemini text at explicit marker', () => {
    const text = `Thinking...\n${CODEX_ANSWER_MARKER}\nAnswer`;
    const result = injectProcessSeparator(text, 'gemini', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    expect(result).toContain('Thinking...');
    expect(result).toContain('Answer');
  });

  // --- Multiple <!-- answer --> marker tests (Gemini tool-retry accumulation) ---

  it('uses last marker when multiple <!-- answer --> markers exist (gemini)', () => {
    const text = `Searching...\n${CODEX_ANSWER_MARKER}\nIntermediate status\n${CODEX_ANSWER_MARKER}\nFinal answer`;
    const result = injectProcessSeparator(text, 'gemini', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Searching...\n\nIntermediate status');
    expect(parts[1]?.trim()).toBe('Final answer');
  });

  it('uses last marker when multiple <!-- answer --> markers exist (codex)', () => {
    const text = `Step 1\n${CODEX_ANSWER_MARKER}\nStep 2\n${CODEX_ANSWER_MARKER}\nActual answer`;
    const result = injectProcessSeparator(text, 'codex', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Step 1\n\nStep 2');
    expect(parts[1]?.trim()).toBe('Actual answer');
  });

  it('handles consecutive markers at end — strips all, no split', () => {
    const text = `Only process text.\n${CODEX_ANSWER_MARKER}${CODEX_ANSWER_MARKER}`;
    const result = injectProcessSeparator(text, 'gemini', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    expect(result).not.toContain(PROCESS_END_SEPARATOR);
    expect(result).toBe('Only process text.');
  });

  it('preserves Japanese text when stripping multiple markers', () => {
    const text = `検索を実行中...\n${CODEX_ANSWER_MARKER}\n中間報告です。\n${CODEX_ANSWER_MARKER}\n最終回答はこちらです。`;
    const result = injectProcessSeparator(text, 'gemini', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('検索を実行中...\n\n中間報告です。');
    expect(parts[1]?.trim()).toBe('最終回答はこちらです。');
  });

  it('handles many markers mimicking real Gemini tool-retry output', () => {
    const text = [
      'I will now perform a search.',
      CODEX_ANSWER_MARKER,
      'I have gathered information. Searching more...',
      CODEX_ANSWER_MARKER,
      'I will retrieve the address.',
      CODEX_ANSWER_MARKER,
      'I will fix the tool call.',
      CODEX_ANSWER_MARKER,
      CODEX_ANSWER_MARKER,
      '最終回答をお届けします。',
    ].join('\n');
    const result = injectProcessSeparator(text, 'gemini', false, -1);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[1]?.trim()).toBe('最終回答をお届けします。');
    // Process part should contain all intermediate text, markers stripped
    expect(parts[0]).toContain('I will now perform a search.');
    expect(parts[0]).toContain('I will fix the tool call.');
  });

  // --- Claude process separation tests ---

  it('splits claude text at tool event offset', () => {
    const text = 'まずリサーチを開始します。スキルを確認中...最終回答はこちらです。';
    const offset = 24; // after process narration
    const result = injectProcessSeparator(text, 'claude', true, offset);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBeTruthy();
    expect(parts[1]?.trim()).toBeTruthy();
  });

  it('splits claude text on explicit <!-- answer --> marker', () => {
    const text = `Thinking about the task...\n${CODEX_ANSWER_MARKER}\nHere is my answer.`;
    const result = injectProcessSeparator(text, 'claude', false, -1);
    expect(result).toContain(PROCESS_END_SEPARATOR);
    expect(result).not.toContain(CODEX_ANSWER_MARKER);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Thinking about the task...');
    expect(parts[1]?.trim()).toBe('Here is my answer.');
  });

  it('claude explicit marker takes priority over tool offset', () => {
    const text = `Process narration\n${CODEX_ANSWER_MARKER}\nFinal answer`;
    const result = injectProcessSeparator(text, 'claude', true, 5);
    const parts = result.split(PROCESS_END_SEPARATOR);
    expect(parts[0]?.trim()).toBe('Process narration');
    expect(parts[1]?.trim()).toBe('Final answer');
  });

  it('returns claude text unchanged when no tool events and no marker', () => {
    expect(injectProcessSeparator('simple answer', 'claude', false, -1)).toBe('simple answer');
  });

  it('returns claude text unchanged when offset is negative', () => {
    expect(injectProcessSeparator('hello world', 'claude', true, -1)).toBe('hello world');
  });

  it('returns claude text unchanged when process part is empty (tool at offset 0)', () => {
    expect(injectProcessSeparator('final answer only', 'claude', true, 0)).toBe(
      'final answer only',
    );
  });

  it('returns claude text unchanged when answer part is empty (tool at end)', () => {
    const text = 'process narration only';
    expect(injectProcessSeparator(text, 'claude', true, text.length)).toBe(text);
  });

  it('claude uses heuristic fallback with heading marker', () => {
    const text =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters for detection.\n## Summary\nAnswer text';
    const expected =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters for detection.\n\n<!-- process-end -->\n\n## Summary\nAnswer text';
    expect(injectProcessSeparator(text, 'claude', false, -1)).toBe(expected);
  });

  it('claude heuristic returns text unchanged when below preamble threshold', () => {
    const text = 'short\n## Heading\nAnswer';
    expect(injectProcessSeparator(text, 'claude', false, -1)).toBe(text);
  });

  it('claude uses heuristic fallback with Insight block marker', () => {
    const preamble =
      'Process narration text that is long enough to exceed the minimum preamble threshold of eighty characters for detection.';
    const insight =
      '`★ Insight ─────────────────────────────────────`\nKey points here\n`─────────────────────────────────────────────────`';
    const text = `${preamble}\n${insight}`;
    const expected = `${preamble}\n\n<!-- process-end -->\n\n${insight}`;
    expect(injectProcessSeparator(text, 'claude', false, -1)).toBe(expected);
  });
});

describe('findProcessBoundary', () => {
  it('returns -1 for text without markers', () => {
    expect(findProcessBoundary('just some plain text without any markers')).toBe(-1);
  });

  it('ignores explicit <!-- answer --> marker (handled by caller)', () => {
    // findProcessBoundary is a heuristic-only function;
    // the explicit marker is handled by injectProcessSeparator.
    const text = `Short.\n${CODEX_ANSWER_MARKER}\nAnswer`;
    expect(findProcessBoundary(text)).toBe(-1);
  });

  it('returns -1 when marker appears before minimum preamble', () => {
    expect(findProcessBoundary('short\n## Heading')).toBe(-1);
  });

  it('detects What you asked marker', () => {
    const text = `${'x'.repeat(100)}\nWhat you asked: topic`;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100);
  });

  it('detects bold What you asked marker', () => {
    const text = `${'x'.repeat(100)}\n**What you asked**`;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100);
  });

  it('detects heading marker', () => {
    const text = `${'x'.repeat(100)}\n## Section`;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100);
  });

  it('returns earliest marker when multiple present', () => {
    const text = `${'x'.repeat(100)}\nWhat you asked\n## Heading`;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100); // "What you asked" comes first
  });

  it('detects Insight block marker (Claude explanatory output)', () => {
    const text = `${'x'.repeat(100)}\n\`★ Insight ─────────────────────────────────────\``;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100);
  });

  it('detects Insight marker without backticks', () => {
    const text = `${'x'.repeat(100)}\n★ Insight ─────`;
    const idx = findProcessBoundary(text);
    expect(idx).toBe(100);
  });
});
