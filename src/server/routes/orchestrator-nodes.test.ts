import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../context/app-context.js';
import { StaleUpdateError } from '../../store/store-utils.js';
import { makeTestAppContext } from '../../test-helpers/app-context-builder.js';
import { MockRequest, MockResponse, UUID, createInvoker } from './_test-utils.js';
import { handleOrchestratorNodeRoutes } from './orchestrator-nodes.js';

const invoke = createInvoker(handleOrchestratorNodeRoutes as Parameters<typeof createInvoker>[0]);
const O = UUID.orch1;
const N1 = UUID.node1;
const N2 = UUID.node2;
const N3 = UUID.node3;
const M = UUID.missing;
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
  c.eventRouter = { reload: vi.fn(async () => undefined) } as unknown as AppContext['eventRouter'];
  return c;
}

describe('orchestrator-nodes', () => {
  // POST create node
  it('POST 201', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'New' },
        })
      ).status,
    ).toBe(201);
  });
  it('POST 404 missing orch', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${M}/nodes`,
          body: { label: 'X' },
        })
      ).status,
    ).toBe(404);
  });
  it('POST 400 bad json', async () => {
    const c = ctx();
    const req = new MockRequest('POST', `/api/orchestrators/${O}/nodes`);
    const res = new MockResponse();
    const p = handleOrchestratorNodeRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/nodes`,
    );
    req.emit('data', Buffer.from('bad'));
    req.emit('end');
    await p;
    expect(res.statusCode).toBe(400);
  });
  it('POST 400 empty label', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: '' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad nodeType', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', nodeType: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad tool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', tool: 'invalid' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad gate mode', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', gateCondition: { mode: 'bad' } },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad matchValue', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', gateCondition: { matchValue: 123 } },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad returnConditions', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', returnConditions: [{ text: 123 }] },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad triggeredConfig', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', triggeredConfig: { waitTimeoutSec: 'bad' } },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad workdir', async () => {
    const c = ctx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad instructionFile', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', instructionFile: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad enabledMcpServerIds', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', tool: 'claude', enabledMcpServerIds: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad limits', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', maxRetries: 999 },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 sub for non-triggered', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', nodeType: 'task', triggeredSubscription: { endpointId: EP } },
        })
      ).status,
    ).toBe(400);
  });
  it('POST 400 bad endpoint', async () => {
    const c = ctx();
    (c.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: {
            label: 'X',
            nodeType: 'triggered',
            triggeredSubscription: { endpointId: 'bad-ep-id-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
          },
        })
      ).status,
    ).toBe(400);
  });
  it('POST triggered with sub', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'X', nodeType: 'triggered', triggeredSubscription: { endpointId: EP } },
    });
    expect(r.status).toBe(201);
    expect(c.eventSubscriptionStore.create).toHaveBeenCalled();
  });
  it('POST 400 tx error', async () => {
    const c = ctx();
    (c.orchestratorStore.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('tx');
    });
    expect(
      (
        await invoke(c, {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X' },
        })
      ).status,
    ).toBe(400);
  });
  it('POST gate node', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'G', nodeType: 'gate' },
        })
      ).status,
    ).toBe(201);
  });
  it('POST end node', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'E', nodeType: 'end' },
        })
      ).status,
    ).toBe(201);
  });
  it('POST returnValues', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', returnValues: ['a', 'b', 123] },
        })
      ).status,
    ).toBe(201);
  });
  it('POST bad inline sub', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'POST',
          path: `/api/orchestrators/${O}/nodes`,
          body: { label: 'X', triggeredSubscription: 'bad' },
        })
      ).status,
    ).toBe(400);
  });

  // PATCH update node
  it('PATCH 200', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { label: 'U' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 404', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${M}`,
          body: { label: 'X' },
        })
      ).status,
    ).toBe(404);
  });
  it('PATCH 400 bad json', async () => {
    const c = ctx();
    const req = new MockRequest('PATCH', `/api/orchestrators/${O}/nodes/${N1}`);
    const res = new MockResponse();
    const p = handleOrchestratorNodeRoutes(
      c,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/orchestrators/${O}/nodes/${N1}`,
    );
    req.emit('data', Buffer.from('bad'));
    req.emit('end');
    await p;
    expect(res.statusCode).toBe(400);
  });
  it('PATCH 400 bad tool', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { tool: 'invalid' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad gate mode', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { gateCondition: { mode: 'bad' } },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad matchValue', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { gateCondition: { matchValue: 123 } },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad outputMode', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { outputMode: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad returnConditions', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { returnConditions: [{ text: 123 }] },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad triggeredConfig', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { triggeredConfig: { waitTimeoutSec: 'bad' } },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH returnValues null', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { returnValues: null },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH returnValues non-array', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { returnValues: 'bad' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH 400 start node type change', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { nodeType: 'gate' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 409 stale', async () => {
    const c = ctx();
    (c.orchestratorStore.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new StaleUpdateError('orchestrator_nodes', 'stale');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { label: 'X', updatedAt: '2026-01-01' },
        })
      ).status,
    ).toBe(409);
  });
  it('PATCH 400 error', async () => {
    const c = ctx();
    (c.orchestratorStore.transaction as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('fail');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { label: 'X' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad workdir', async () => {
    const c = ctx();
    (c.workdirManager.validateCustomWorkdir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('bad');
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { workdir: '/bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad instructionFile', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { instructionFile: 'x'.repeat(50001) },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 bad enabledMcpServerIds', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { enabledMcpServerIds: 'bad' },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH clear mcp on tool change', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { tool: 'codex' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH gate to task clears gate fields', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      nodeType: 'gate',
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N2}`,
          body: { nodeType: 'task' },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH position-only skips DAG invalidation', async () => {
    const c = ctx();
    await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { positionX: 100, positionY: 200 },
    });
    expect(c.orchestratorStore.invalidateDag).not.toHaveBeenCalled();
  });
  it('PATCH 400 bad limits', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { maxRetries: 999 },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH 400 sub for non-triggered', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { triggeredSubscription: { endpointId: EP } },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH triggered node type change clears sub', async () => {
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
    (
      c.eventSubscriptionStore.getTriggeredNodeSubscription as ReturnType<typeof vi.fn>
    ).mockReturnValue({ id: UUID.sub1 });
    await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { nodeType: 'task' },
    });
    expect(c.eventSubscriptionStore.delete).toHaveBeenCalledWith(UUID.sub1);
  });
  it('PATCH remove sub', async () => {
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
    (
      c.eventSubscriptionStore.getTriggeredNodeSubscription as ReturnType<typeof vi.fn>
    ).mockReturnValue({ id: UUID.sub1 });
    await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { triggeredSubscription: null },
    });
    expect(c.eventSubscriptionStore.delete).toHaveBeenCalledWith(UUID.sub1);
  });
  it('PATCH upsert sub update', async () => {
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
    (
      c.eventSubscriptionStore.getTriggeredNodeSubscription as ReturnType<typeof vi.fn>
    ).mockReturnValue({ id: UUID.sub1 });
    await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { triggeredSubscription: { endpointId: EP } },
    });
    expect(c.eventSubscriptionStore.update).toHaveBeenCalled();
  });
  it('PATCH upsert sub create', async () => {
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
    await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N2}`,
      body: { triggeredSubscription: { endpointId: EP } },
    });
    expect(c.eventSubscriptionStore.create).toHaveBeenCalled();
  });
  it('PATCH 400 missing endpoint', async () => {
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
    (c.webhookEndpointStore.getById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N2}`,
          body: { triggeredSubscription: { endpointId: 'bad-ep-id-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } },
        })
      ).status,
    ).toBe(400);
  });
  it('PATCH allowMcp normalization', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { allowMcp: 1 },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH writeInstructionFile', async () => {
    expect(
      (
        await invoke(ctx(), {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N1}`,
          body: { writeInstructionFile: 0 },
        })
      ).status,
    ).toBe(200);
  });
  it('PATCH end type cleanup non-task', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      nodeType: 'gate',
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N3,
    });
    expect(
      (
        await invoke(c, {
          method: 'PATCH',
          path: `/api/orchestrators/${O}/nodes/${N2}`,
          body: { nodeType: 'end' },
        })
      ).status,
    ).toBe(200);
  });

  // Agent + outputMode enforcement
  it('POST forces outputMode to auto when agentId is provided', async () => {
    const AGENT_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';
    const c = ctx();
    (c.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: AGENT_ID,
      tool: 'claude',
    });
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'X', agentId: AGENT_ID, outputMode: 'manual' },
    });
    expect(r.status).toBe(201);
    const createCall = (c.orchestratorStore.createNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(createCall.outputMode).toBe('auto');
  });

  it('POST preserves manual outputMode when no agent', async () => {
    const c = ctx();
    const r = await invoke(c, {
      method: 'POST',
      path: `/api/orchestrators/${O}/nodes`,
      body: { label: 'X', outputMode: 'manual' },
    });
    expect(r.status).toBe(201);
    const createCall = (c.orchestratorStore.createNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(createCall.outputMode).toBe('manual');
  });

  it('PATCH forces outputMode to auto when agentId is set', async () => {
    const AGENT_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';
    const c = ctx();
    (c.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: AGENT_ID,
      tool: 'claude',
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { agentId: AGENT_ID, outputMode: 'manual' },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.outputMode).toBe('auto');
  });

  it('PATCH forces outputMode to auto when existing node has agent', async () => {
    const AGENT_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      agentId: AGENT_ID,
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { label: 'Updated' },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.outputMode).toBe('auto');
  });

  it('PATCH allows manual outputMode when agentId is removed', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      agentId: 'old-agent',
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { agentId: null, outputMode: 'manual' },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.outputMode).toBe('manual');
  });

  it('PATCH preserves returnConditions when agent forces auto mode and client sends null', async () => {
    const AGENT_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';
    const existingConditions = [{ condition: 'Task completes', value: 'done' }];
    const c = ctx();
    (c.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: AGENT_ID,
      tool: 'claude',
    });
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      agentId: null,
      outputMode: 'auto',
      returnConditions: existingConditions,
    });
    // Client sets agent and clears returnConditions (thinking manual mode)
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { agentId: AGENT_ID, outputMode: 'manual', returnConditions: null },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.outputMode).toBe('auto');
    expect(updateCall.returnConditions).toEqual(existingConditions);
  });

  it('PATCH does not override returnConditions when client explicitly sends new conditions with agent', async () => {
    const AGENT_ID = '11111111-aaaa-bbbb-cccc-dddddddddddd';
    const newConditions = [{ condition: 'New condition', value: 'success' }];
    const c = ctx();
    (c.agentStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: AGENT_ID,
      tool: 'claude',
    });
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      agentId: AGENT_ID,
      returnConditions: [{ condition: 'Old', value: 'done' }],
    });
    const r = await invoke(c, {
      method: 'PATCH',
      path: `/api/orchestrators/${O}/nodes/${N1}`,
      body: { returnConditions: newConditions },
    });
    expect(r.status).toBe(200);
    const updateCall = (c.orchestratorStore.updateNode as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(updateCall.returnConditions).toEqual(newConditions);
  });

  // DELETE
  it('DELETE 200', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N1,
    });
    expect(
      (await invoke(c, { method: 'DELETE', path: `/api/orchestrators/${O}/nodes/${N2}` })).status,
    ).toBe(200);
  });
  it('DELETE 404', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    expect(
      (await invoke(c, { method: 'DELETE', path: `/api/orchestrators/${O}/nodes/${M}` })).status,
    ).toBe(404);
  });
  it('DELETE 400 start node', async () => {
    expect(
      (await invoke(ctx(), { method: 'DELETE', path: `/api/orchestrators/${O}/nodes/${N1}` }))
        .status,
    ).toBe(400);
  });
  it('DELETE 400 error', async () => {
    const c = ctx();
    (c.orchestratorStore.getNodeById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...NODE,
      id: N2,
    });
    (c.orchestratorStore.getById as ReturnType<typeof vi.fn>).mockReturnValue({
      ...ORCH,
      startNodeId: N1,
    });
    (c.orchestratorStore.deleteNode as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('fail');
    });
    expect(
      (await invoke(c, { method: 'DELETE', path: `/api/orchestrators/${O}/nodes/${N2}` })).status,
    ).toBe(400);
  });

  it('unmatched false', async () => {
    expect((await invoke(ctx(), { method: 'GET', path: '/api/other' })).handled).toBe(false);
  });
});
