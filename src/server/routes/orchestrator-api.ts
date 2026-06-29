/** @module server/routes/orchestrator-api — Thin dispatcher for orchestrator API routes. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../../context/app-context.js';
import { handleOrchestratorCrudRoutes } from './orchestrator-crud.js';
import { handleOrchestratorEdgeRoutes } from './orchestrator-edges.js';
import { handleOrchestratorExecutionRoutes } from './orchestrator-execution.js';
import { handleOrchestratorNodeRoutes } from './orchestrator-nodes.js';

export function matchesOrchestratorApiPath(pathname: string): boolean {
  return pathname === '/api/orchestrators' || pathname.startsWith('/api/orchestrators/');
}

export async function handleOrchestratorApiRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // Route by path segment to avoid an async microtask gap between sub-handlers.
  // readBody() attaches stream listeners synchronously — if the wrong handler
  // is awaited first, buffered request data events can be missed.
  // pathname: /api/orchestrators/:id/<subResource>/...
  const segments = pathname.split('/');
  const subResource = segments[4]; // 'nodes' | 'edges' | 'validate' | 'runs' | etc.

  if (subResource === 'nodes') {
    return handleOrchestratorNodeRoutes(ctx, req, res, pathname);
  }
  if (subResource === 'edges') {
    return handleOrchestratorEdgeRoutes(ctx, req, res, pathname);
  }
  if (
    subResource === 'validate' ||
    subResource === 'revert' ||
    subResource === 'execute' ||
    subResource === 'rerun' ||
    subResource === 'cancel' ||
    (subResource === 'runs' && segments[6] === 'stream')
  ) {
    return handleOrchestratorExecutionRoutes(ctx, req, res, pathname);
  }
  // Orchestrator CRUD (list/get/create/update/delete) + run queries
  return handleOrchestratorCrudRoutes(ctx, req, res, pathname);
}
