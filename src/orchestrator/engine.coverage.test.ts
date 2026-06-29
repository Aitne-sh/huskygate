/** Coverage tests for orchestrator/engine: uncovered lines 110, 115-117, 128-129, 168,
 * 238, 242-244, 702-718 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/error.js', () => ({
  errorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

describe('engine coverage', () => {
  it('OrchestratorEngine can be imported and has expected methods', async () => {
    const { OrchestratorEngine } = await import('./engine.js');
    expect(OrchestratorEngine).toBeDefined();
  });

  describe('setPostNotification (line 110)', () => {
    it('sets postNotification function on context', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {} as any,
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx);
      const fn = vi.fn().mockResolvedValue(null);
      engine.setPostNotification(fn);
      expect(ctx.postNotification).toBe(fn);
    });
  });

  describe('setUploadFile (lines 115-117)', () => {
    it('sets uploadFile function on context', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {} as any,
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx);
      const fn = vi.fn().mockResolvedValue(undefined);
      engine.setUploadFile(fn);
      expect(ctx.uploadFile).toBe(fn);
    });
  });

  describe('setDefaultNotifyChannel (lines 128-129)', () => {
    it('sets default notify channel on context', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {} as any,
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx);
      engine.setDefaultNotifyChannel('C123');
      expect(ctx.defaultNotifyChannel).toBe('C123');
    });
  });

  describe('setEventRouter', () => {
    it('sets event router on context', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {} as any,
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx);
      const mockRouter = {} as any;
      engine.setEventRouter(mockRouter);
      expect(ctx.eventRouter).toBe(mockRouter);
    });
  });

  describe('startRun — validation failures (line 168)', () => {
    it('throws when orchestrator not found', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {
          getFullOrchestrator: vi.fn().mockReturnValue(null),
        },
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx as any);
      await expect(engine.startRun('nonexistent', 'dashboard')).rejects.toThrow('not found');
    });
  });

  describe('startRerun — DAG validation failure (lines 242-244)', () => {
    it('throws when original run not found', async () => {
      const { OrchestratorEngine } = await import('./engine.js');
      const ctx = {
        orchestratorStore: {
          getRunById: vi.fn().mockReturnValue(null),
          getFullOrchestrator: vi.fn().mockReturnValue(null),
        },
        postNotification: null as any,
        uploadFile: null as any,
        defaultNotifyChannel: undefined as string | undefined,
        eventRouter: null as any,
        agentStore: null as any,
      };
      const engine = new OrchestratorEngine(ctx as any);
      await expect(engine.startRerun('nonexistent-run')).rejects.toThrow('not found');
    });
  });
});
