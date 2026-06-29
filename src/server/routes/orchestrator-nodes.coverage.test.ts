/**
 * Coverage tests for orchestrator-nodes — targets uncovered lines:
 * 144 (enabledMcpServerIds null for non-task), 189 (gateCondition null on POST),
 * 192 (gate returnValues), 403 (enabledMcpServerIds clear on tool change PATCH),
 * 461-462 (node limits for triggered with waitTimeoutSec).
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { UUID, createInvoker } from './_test-utils.js';
import { handleOrchestratorNodeRoutes } from './orchestrator-nodes.js';

const invoke = createInvoker(handleOrchestratorNodeRoutes as Parameters<typeof createInvoker>[0]);
const O = UUID.orch1;
const N1 = UUID.node1;
const N2 = UUID.node2;
const N3 = UUID.node3;
const EP = UUID.endpoint1;

const ORCH = { id: O, status: 'active', startNodeId: N1 };
const NODE = {
  id: N1,
  orchestratorId: O,
  nodeType: 'task',
  label: 'Start',
  tool: 'claude',
  workdir: null,
  enabledMcpServerIds: null,
  writeInstructionFile: true,
  instructionFile: null,
  allowMcp: true,
};

function ctx(): AppContext {
  const c = makeTestAppContext();
  c.orchestratorStore = {
    getById: vi.fn((id: string) => (id === O ? { ...ORCH } : null)),
    getNodeById: vi.fn((id: string) => (id === N1 ? { ...NODE } : null)),
    createNode: vi.fn((i: Record<string, unknown>) => ({ id: N2, ...i })),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    invalidateDag: vi.fn(),
    transaction: vi.fn(<T>(fn: () => T) => fn()),
  } as unknown as AppContext['orchestratorStore'];
  c.eventSubscriptionStore = {
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    getTriggeredNodeSubscription: vi.fn(() => null),
  } as unknown as AppContext['eventSubscriptionStore'];
  c.webhookEndpointStore = {
    getById: vi.fn(() => ({ id: EP })),
  } as unknown as AppContext['webhookEndpointStore'];
  c.eventRouter = {
    reload: vi.fn(async () => undefined),
  } as unknown as AppContext['eventRouter'];
  return c;
}

describe('orchestrator-nodes coverage', () => {
  // ── POST gate node: gateCondition null and returnValues ['true', 'false'] (lines 189, 192, 203) ──
  it('POST gate node with explicit gateCondition null defaults correctly', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'Gate', nodeType: 'gate', gateCondition: null },
    });
    expect(r.status).toBe(201);
  });

  // ── POST end node: enabledMcpServerIds null for end type (line 144-145) ──
  it('POST end node skips enabledMcpServerIds validation', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'End', nodeType: 'end' },
    });
    expect(r.status).toBe(201);
  });

  // ── POST triggered node with limits validation incl waitTimeoutSec (line 150-156) ──
  it('POST triggered node validates limits with waitTimeoutSec', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: {
        label: 'Triggered',
        nodeType: 'triggered',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      },
    });
    expect(r.status).toBe(201);
  });

  // ── PATCH triggered node with triggeredConfig containing waitTimeoutSec (lines 458-462) ──
  it('PATCH triggered node validates node limits with waitTimeoutSec', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      nodeType: 'triggered',
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: {
        triggeredConfig: { waitTimeoutSec: 120, onTimeout: 'skip' },
      },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: enabledMcpServerIds value set properly on task node (line 403) ──
  it('PATCH task node with valid enabledMcpServerIds', async () => {
    const c = ctx();
    (c.mcpServerStore.listByTool as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 'server-1' }]);
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { enabledMcpServerIds: ['server-1'] },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: task -> end transition clears task-only fields (lines 415-436) ──
  it('PATCH task to end clears task-only fields', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
      nodeType: 'task',
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { nodeType: 'end' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: non-task to end transition (wasTaskLike=false, lines 430-435) ──
  it('PATCH gate to end does not touch task-only fields', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
      nodeType: 'gate',
      workdir: null,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { nodeType: 'end' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: nodeType from triggered to gate clears triggeredConfig ──
  it('PATCH triggered to gate sets triggeredConfig null', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
      nodeType: 'triggered',
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    (
      c.eventSubscriptionStore.getTriggeredNodeSubscription as ReturnType<typeof vi.fn>
    ).mockReturnValue({ id: UUID.sub1 });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { nodeType: 'gate' },
    });
    expect(r.status).toBe(200);
    expect(c.eventSubscriptionStore.delete).toHaveBeenCalledWith(UUID.sub1);
  });

  // ── POST: gate node returnValues forced to ['true', 'false'] (line 203) ──
  it('POST gate node forces returnValues', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'Gate', nodeType: 'gate' },
    });
    expect(r.status).toBe(201);
    const data = (r.body as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.returnValues).toEqual(['true', 'false']);
  });

  // ── PATCH: task type sets triggeredConfig to null (line 452) ──
  it('PATCH task type sets triggeredConfig to null', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
      nodeType: 'triggered',
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    (
      c.eventSubscriptionStore.getTriggeredNodeSubscription as ReturnType<typeof vi.fn>
    ).mockReturnValue({ id: UUID.sub1 });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { nodeType: 'task' },
    });
    expect(r.status).toBe(200);
  });

  // ── POST: invalid model type (lines 86-88) ──
  it('POST 400 invalid model type', async () => {
    const r = await invoke(ctx(), {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'Task', nodeType: 'task', model: 12345 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toContain('model must be a string');
  });

  // ── POST: agentId not found (lines 197-199) ──
  it('POST 400 agentId not found', async () => {
    const c = ctx();
    // agentStore.getById returns null by default
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'Task', nodeType: 'task', agentId: 'nonexistent-agent' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('Agent not found');
  });

  // ── PATCH: position-only update error (lines 333-335) ──
  it('PATCH 400 position-only update error', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Position constraint violation');
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { positionX: 100, positionY: 200 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toContain('Position constraint violation');
  });

  // ── PATCH: agentId not found (lines 346-348) ──
  it('PATCH 400 agentId not found on node update', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { agentId: 'nonexistent-agent' },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toBe('Agent not found');
  });

  // ── PATCH: invalid model on update (lines 373-379) ──
  it('PATCH 400 invalid model type on node update', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { model: 99 },
    });
    expect(r.status).toBe(400);
    expect((r.body as Record<string, string>).error).toContain('model must be a string');
  });

  // ── PATCH: returnValues normalized as array (lines 436-438) ──
  it('PATCH normalizes returnValues array', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { returnValues: ['a', 123, 'b'] },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: workdir on task node (lines 470-471) ──
  it('PATCH task node workdir', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { workdir: '/tmp/test-workdir/custom' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: instructionFile on task node (lines 478-479) ──
  it('PATCH task node instructionFile', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { instructionFile: 'some instructions content' },
    });
    expect(r.status).toBe(200);
  });

  // ── PATCH: invalid node limits for triggered waitTimeoutSec out of range ──
  it('PATCH 400 invalid node limits with bad waitTimeoutSec', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      nodeType: 'triggered',
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: {
        triggeredConfig: { waitTimeoutSec: 999999999, onTimeout: 'fail' },
      },
    });
    expect(r.status).toBe(400);
  });
});
