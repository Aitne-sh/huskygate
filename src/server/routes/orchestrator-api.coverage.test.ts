/**
 * Coverage tests for orchestrator-api — targets uncovered lines 30-31:
 * The edge sub-handler dispatch (subResource === 'edges').
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  handleOrchestratorCrudRoutes: vi.fn(async () => false),
  handleOrchestratorEdgeRoutes: vi.fn(async () => true),
  handleOrchestratorExecutionRoutes: vi.fn(async () => false),
  handleOrchestratorNodeRoutes: vi.fn(async () => false),
}));

vi.mock('./orchestrator-crud.js', () => ({
  handleOrchestratorCrudRoutes: mocked.handleOrchestratorCrudRoutes,
}));
vi.mock('./orchestrator-edges.js', () => ({
  handleOrchestratorEdgeRoutes: mocked.handleOrchestratorEdgeRoutes,
}));
vi.mock('./orchestrator-execution.js', () => ({
  handleOrchestratorExecutionRoutes: mocked.handleOrchestratorExecutionRoutes,
}));
vi.mock('./orchestrator-nodes.js', () => ({
  handleOrchestratorNodeRoutes: mocked.handleOrchestratorNodeRoutes,
}));

import { handleOrchestratorApiRoutes, matchesOrchestratorApiPath } from './orchestrator-api.js';

describe('orchestrator-api coverage', () => {
  it('matchesOrchestratorApiPath', () => {
    expect(matchesOrchestratorApiPath('/api/orchestrators')).toBe(true);
    expect(matchesOrchestratorApiPath('/api/orchestrators/x')).toBe(true);
    expect(matchesOrchestratorApiPath('/api/other')).toBe(false);
  });

  it('dispatches to edges handler (lines 29-31)', async () => {
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/edges',
    );
    expect(result).toBe(true);
    expect(mocked.handleOrchestratorEdgeRoutes).toHaveBeenCalled();
  });

  it('dispatches to nodes handler', async () => {
    mocked.handleOrchestratorNodeRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/nodes',
    );
    expect(result).toBe(true);
    expect(mocked.handleOrchestratorNodeRoutes).toHaveBeenCalled();
  });

  it('dispatches to execution handler for validate', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/validate',
    );
    expect(result).toBe(true);
    expect(mocked.handleOrchestratorExecutionRoutes).toHaveBeenCalled();
  });

  it('dispatches to execution handler for revert', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/revert',
    );
    expect(result).toBe(true);
  });

  it('dispatches to execution handler for execute', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/execute',
    );
    expect(result).toBe(true);
  });

  it('dispatches to execution handler for rerun', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/rerun',
    );
    expect(result).toBe(true);
  });

  it('dispatches to execution handler for cancel', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/cancel',
    );
    expect(result).toBe(true);
  });

  it('dispatches to execution handler for stream', async () => {
    mocked.handleOrchestratorExecutionRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/runs/run-id/stream',
    );
    expect(result).toBe(true);
  });

  it('falls through to crud handler for list', async () => {
    mocked.handleOrchestratorCrudRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators',
    );
    expect(result).toBe(true);
    expect(mocked.handleOrchestratorCrudRoutes).toHaveBeenCalled();
  });

  it('falls through to crud handler for runs', async () => {
    mocked.handleOrchestratorCrudRoutes.mockResolvedValueOnce(true);
    const result = await handleOrchestratorApiRoutes(
      {} as unknown as Parameters<typeof handleOrchestratorApiRoutes>[0],
      {} as unknown as IncomingMessage,
      {} as unknown as ServerResponse,
      '/api/orchestrators/some-id/runs',
    );
    expect(result).toBe(true);
    expect(mocked.handleOrchestratorCrudRoutes).toHaveBeenCalled();
  });
});
