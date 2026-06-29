import { describe, expect, it } from 'vitest';

import {
  MAX_REGEX_PATTERN_LENGTH,
  buildValidatedDAG,
  evaluateEdgeCondition,
  evaluateGateCondition,
  getAncestors,
  validateDAG,
} from './dag.js';
import type { OrchestratorEdge, OrchestratorNode } from './types.js';

// ─── Test Helpers ────────────────────────────────────────────

function mockNode(overrides: Partial<OrchestratorNode> & { id: string }): OrchestratorNode {
  return {
    orchestratorId: 'orch-1',
    label: overrides.id,
    nodeType: 'task',
    agentId: null,
    tool: 'claude',
    mode: 'write',
    prompt: 'do something',
    maxRetries: 0,
    timeoutSec: null,
    allowMcp: true,
    workdir: null,
    writeInstructionFile: true,
    instructionFile: null,
    outputMode: 'auto',
    returnConditions: null,
    returnValues: null,
    gateCondition: null,
    triggeredConfig: null,
    notifyEnabled: false,
    notifyChannel: null,
    notifyOnError: false,
    positionX: 0,
    positionY: 0,
    sortOrder: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...overrides,
  } as OrchestratorNode;
}

function mockEdge(
  overrides: Partial<OrchestratorEdge> & { fromNodeId: string; toNodeId: string },
): OrchestratorEdge {
  return {
    id: `${overrides.fromNodeId}->${overrides.toNodeId}`,
    orchestratorId: 'orch-1',
    conditionValue: null,
    conditionOperator: 'eq',
    sortOrder: 0,
    createdAt: '2024-01-01',
    ...overrides,
  };
}

// ─── validateDAG ─────────────────────────────────────────────

describe('validateDAG', () => {
  it('accepts a valid linear DAG (A -> B -> C)', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.topologicalOrder).toEqual(['A', 'B', 'C']);
  });

  it('accepts a valid DAG with branching (diamond shape)', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
      mockNode({ id: 'D' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'D' }),
      mockEdge({ fromNodeId: 'C', toNodeId: 'D' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    // A must come first, D must come last, B and C can be in any order
    expect(result.topologicalOrder[0]).toBe('A');
    expect(result.topologicalOrder[result.topologicalOrder.length - 1]).toBe('D');
    expect(result.topologicalOrder).toContain('B');
    expect(result.topologicalOrder).toContain('C');
  });

  it('rejects a persisted start node that has incoming edges', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];

    const result = validateDAG(nodes, edges, 50, { startNodeId: 'B' });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'START_NODE_HAS_INCOMING', nodeId: 'B' }),
      ]),
    );
  });

  it('rejects a persisted start node that is missing from the DAG', () => {
    const nodes = [mockNode({ id: 'A' })];

    const result = validateDAG(nodes, [], 50, { startNodeId: 'missing' });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'START_NODE_MISSING', nodeId: 'missing' }),
      ]),
    );
  });

  it('accepts empty nodes as valid', () => {
    const result = validateDAG([], []);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.topologicalOrder).toEqual([]);
  });

  it('detects cycles', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'C', toNodeId: 'A' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'CYCLE_DETECTED')).toBe(true);
  });

  it('reports SELF_LOOP and skips further validation for that edge', () => {
    const nodes = [mockNode({ id: 'A' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'A' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.code === 'SELF_LOOP')).toHaveLength(1);
    expect(result.errors.some((e) => e.code === 'MISSING_EDGE_TARGET')).toBe(false);
  });

  it('reports no orphans for a fully connected DAG', () => {
    // In a valid acyclic graph, every node is either a root (0 incoming edges)
    // or reachable from a root — so ORPHAN_NODE cannot fire. Verify the positive case.
    const connectedResult = validateDAG(
      [mockNode({ id: 'A' }), mockNode({ id: 'B' })],
      [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })],
    );
    expect(connectedResult.valid).toBe(true);
    expect(connectedResult.errors.filter((e) => e.code === 'ORPHAN_NODE')).toHaveLength(0);
  });

  it('reports MAX_NODES_EXCEEDED when node count exceeds limit', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
    ];

    const result = validateDAG(nodes, edges, 2);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MAX_NODES_EXCEEDED')).toBe(true);
  });

  it('reports TASK_NO_TOOL when a task node has no tool', () => {
    const nodes = [mockNode({ id: 'A', tool: null })];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    const toolError = result.errors.find((e) => e.code === 'TASK_NO_TOOL');
    expect(toolError).toBeDefined();
    expect(toolError?.nodeId).toBe('A');
  });

  it('allows node without tool when agent provides tool via agentResolver', () => {
    const nodes = [mockNode({ id: 'A', tool: null, agentId: 'agent-1' })];

    const result = validateDAG(nodes, [], 50, {
      agentResolver: (id) => (id === 'agent-1' ? { tool: 'claude' } : null),
    });

    expect(result.errors.filter((e) => e.code === 'TASK_NO_TOOL')).toHaveLength(0);
  });

  it('reports TASK_NO_TOOL when agentResolver returns null (agent deleted)', () => {
    const nodes = [mockNode({ id: 'A', tool: null, agentId: 'agent-deleted' })];

    const result = validateDAG(nodes, [], 50, {
      agentResolver: () => null,
    });

    expect(result.errors.some((e) => e.code === 'TASK_NO_TOOL')).toBe(true);
  });

  it('reports TASK_NO_TOOL when node has agentId but no agentResolver provided', () => {
    const nodes = [mockNode({ id: 'A', tool: null, agentId: 'agent-1' })];

    const result = validateDAG(nodes, []);

    expect(result.errors.some((e) => e.code === 'TASK_NO_TOOL')).toBe(true);
  });

  it('prefers node tool over agent tool', () => {
    const nodes = [mockNode({ id: 'A', tool: 'gemini', agentId: 'agent-1' })];

    const result = validateDAG(nodes, [], 50, {
      agentResolver: (id) => (id === 'agent-1' ? { tool: 'claude' } : null),
    });

    // Node has its own tool, so no TASK_NO_TOOL regardless of agent
    expect(result.errors.filter((e) => e.code === 'TASK_NO_TOOL')).toHaveLength(0);
  });

  it('allows triggered node without tool when agent provides tool', () => {
    const nodes = [
      mockNode({
        id: 'A',
        nodeType: 'triggered',
        tool: null,
        agentId: 'agent-1',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'fail' },
      }),
    ];

    const result = validateDAG(nodes, [], 50, {
      agentResolver: (id) => (id === 'agent-1' ? { tool: 'codex' } : null),
      triggeredNodeSubscriptionIds: new Set(['A']),
    });

    expect(result.errors.filter((e) => e.code === 'TASK_NO_TOOL')).toHaveLength(0);
  });

  it('reports TASK_NO_PROMPT when a task node has no prompt', () => {
    const nodes = [mockNode({ id: 'A', prompt: null })];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TASK_NO_PROMPT')).toBe(true);
  });

  it('reports TASK_NO_PROMPT when a task node has empty-string prompt', () => {
    const nodes = [mockNode({ id: 'A', prompt: '   ' })];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TASK_NO_PROMPT')).toBe(true);
  });

  it('reports TRIGGERED_CONFIG_REQUIRED when a triggered node has no config', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({
        id: 'T',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'wait for webhook',
        triggeredConfig: null,
      }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'T' })];

    const result = validateDAG(nodes, edges, 50, {
      startNodeId: 'A',
      triggeredNodeSubscriptionIds: new Set(),
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRIGGERED_CONFIG_REQUIRED', nodeId: 'T' }),
      ]),
    );
  });

  it('requires triggered nodes to have an active subscription id in validation', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({
        id: 'T',
        nodeType: 'triggered',
        tool: 'claude',
        prompt: 'wait for webhook',
        triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'skip' },
      }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'T' })];

    const invalid = validateDAG(nodes, edges, 50, {
      startNodeId: 'A',
      triggeredNodeSubscriptionIds: new Set(),
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRIGGERED_NO_SUBSCRIPTION', nodeId: 'T' }),
      ]),
    );

    const valid = validateDAG(nodes, edges, 50, {
      startNodeId: 'A',
      triggeredNodeSubscriptionIds: new Set(['T']),
    });
    expect(valid.valid).toBe(true);
  });

  it('validates triggered timeout configuration values', () => {
    const result = validateDAG(
      [
        mockNode({ id: 'A' }),
        mockNode({
          id: 'T',
          nodeType: 'triggered',
          tool: 'claude',
          prompt: 'wait for webhook',
          triggeredConfig: { waitTimeoutSec: 0, onTimeout: 'invalid' as never },
        }),
      ],
      [mockEdge({ fromNodeId: 'A', toNodeId: 'T' })],
      50,
      { startNodeId: 'A', triggeredNodeSubscriptionIds: new Set(['T']) },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRIGGERED_TIMEOUT_INVALID', nodeId: 'T' }),
        expect.objectContaining({ code: 'TRIGGERED_ON_TIMEOUT_INVALID', nodeId: 'T' }),
      ]),
    );
  });

  it('rejects triggered settings on non-triggered nodes', () => {
    const result = validateDAG(
      [
        mockNode({ id: 'A' }),
        mockNode({
          id: 'B',
          triggeredConfig: { waitTimeoutSec: 60, onTimeout: 'skip' },
        }),
      ],
      [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })],
      50,
      { startNodeId: 'A' },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TRIGGERED_CONFIG_FORBIDDEN', nodeId: 'B' }),
      ]),
    );
  });

  it('rejects start nodes that are not task nodes', () => {
    const result = validateDAG(
      [mockNode({ id: 'A', nodeType: 'gate', tool: null, prompt: null })],
      [],
      50,
      { startNodeId: 'A' },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'START_NODE_NOT_TASK', nodeId: 'A' }),
      ]),
    );
  });

  it('reports GATE_NO_MATCH_VALUE when a gate node has no gateCondition', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'G', nodeType: 'gate', tool: null, prompt: null, gateCondition: null }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'G' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    const gateError = result.errors.find((e) => e.code === 'GATE_NO_MATCH_VALUE');
    expect(gateError).toBeDefined();
    expect(gateError?.nodeId).toBe('G');
  });

  it('reports GATE_NO_MATCH_VALUE when gate has empty matchValue', () => {
    const nodes = [
      mockNode({
        id: 'G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: '' },
      }),
    ];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'GATE_NO_MATCH_VALUE')).toBe(true);
  });

  it('reports GATE_NO_INCOMING when gate has no incoming edges', () => {
    const nodes = [
      mockNode({
        id: 'G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'success' },
      }),
    ];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    const incomingError = result.errors.find((e) => e.code === 'GATE_NO_INCOMING');
    expect(incomingError).toBeDefined();
    expect(incomingError?.nodeId).toBe('G');
  });

  it('does not report GATE_NO_INCOMING when gate has incoming edges', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({
        id: 'G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'success' },
      }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'G' })];

    const result = validateDAG(nodes, edges);

    expect(result.errors.filter((e) => e.code === 'GATE_NO_INCOMING')).toHaveLength(0);
  });

  it('reports DUPLICATE_EDGE for edges with same from, to, conditionValue, and conditionOperator', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [
      mockEdge({ id: 'e1', fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ id: 'e2', fromNodeId: 'A', toNodeId: 'B' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_EDGE')).toBe(true);
  });

  it('allows edges with same from/to but different conditionValue', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [
      mockEdge({ id: 'e1', fromNodeId: 'A', toNodeId: 'B', conditionValue: 'yes' }),
      mockEdge({ id: 'e2', fromNodeId: 'A', toNodeId: 'B', conditionValue: 'no' }),
    ];

    const result = validateDAG(nodes, edges);

    const dupErrors = result.errors.filter((e) => e.code === 'DUPLICATE_EDGE');
    expect(dupErrors).toHaveLength(0);
  });

  it('reports MISSING_EDGE_TARGET when edge references non-existent source node', () => {
    const nodes = [mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'GHOST', toNodeId: 'B' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) => e.code === 'MISSING_EDGE_TARGET');
    expect(missingErrors.length).toBeGreaterThanOrEqual(1);
    expect(missingErrors.some((e) => e.message.includes('GHOST'))).toBe(true);
  });

  it('reports MISSING_EDGE_TARGET when edge references non-existent target node', () => {
    const nodes = [mockNode({ id: 'A' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'PHANTOM' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    const missingErrors = result.errors.filter((e) => e.code === 'MISSING_EDGE_TARGET');
    expect(missingErrors.length).toBeGreaterThanOrEqual(1);
    expect(missingErrors.some((e) => e.message.includes('PHANTOM'))).toBe(true);
  });

  it('emits NO_TERMINAL_NODE warning when all nodes have outgoing edges and nodes > 0', () => {
    // Create a DAG where every node has an outgoing edge: A -> B, B -> A forms a cycle,
    // but cycles cause cycle error. Instead: A -> B, B -> C, C -> ... but C has no outgoing = terminal.
    // To get no terminal: every node must have an outgoing edge. The only acyclic option
    // with no terminal would require... actually it's impossible for a finite acyclic graph.
    // Every finite DAG must have at least one terminal node.
    // So this warning only triggers when edges create the illusion (e.g., edges to non-existent nodes
    // where the fromNodeId set covers all nodes).
    // Let's test: A -> B, B -> GHOST. hasOutgoing = {A, B}. A and B are all nodes. Terminal = none.
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'GHOST' }),
    ];

    const result = validateDAG(nodes, edges);

    // Should have MISSING_EDGE_TARGET error for GHOST
    expect(result.errors.some((e) => e.code === 'MISSING_EDGE_TARGET')).toBe(true);
    // Should also have NO_TERMINAL_NODE warning since both A and B have outgoing edges
    expect(result.warnings.some((w) => w.code === 'NO_TERMINAL_NODE')).toBe(true);
  });

  it('does not emit NO_TERMINAL_NODE warning when terminal nodes exist', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];

    const result = validateDAG(nodes, edges);

    expect(result.warnings.filter((w) => w.code === 'NO_TERMINAL_NODE')).toHaveLength(0);
  });

  it('does not emit NO_TERMINAL_NODE warning for empty DAG', () => {
    const result = validateDAG([], []);

    expect(result.warnings.filter((w) => w.code === 'NO_TERMINAL_NODE')).toHaveLength(0);
  });

  it('uses default maxTotalNodes of 50', () => {
    const nodes = Array.from({ length: 51 }, (_, i) => mockNode({ id: `N${i}` }));
    // Create a linear chain so it's a valid DAG
    const edges = Array.from({ length: 50 }, (_, i) =>
      mockEdge({ fromNodeId: `N${i}`, toNodeId: `N${i + 1}` }),
    );

    const result = validateDAG(nodes, edges);

    expect(result.errors.some((e) => e.code === 'MAX_NODES_EXCEEDED')).toBe(true);
  });

  it('returns topological order even when there are validation errors (non-cycle)', () => {
    // A task with no tool is invalid but the graph structure is valid
    const nodes = [mockNode({ id: 'A', tool: null }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    expect(result.topologicalOrder).toEqual(['A', 'B']);
  });

  it('returns empty topological order when a cycle is detected', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'A' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.topologicalOrder).toEqual([]);
  });

  it('can report multiple errors at once', () => {
    const nodes = [
      mockNode({ id: 'A', tool: null, prompt: null }),
      mockNode({ id: 'B', tool: null }),
    ];

    const result = validateDAG(nodes, []);

    // A: TASK_NO_TOOL + TASK_NO_PROMPT, B: TASK_NO_TOOL
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  // ── End node validation ─────────────────────────────────────

  it('accepts a valid end node (no tool/prompt required)', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'END', nodeType: 'end', tool: null, prompt: null }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'END' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports END_HAS_OUTGOING when end node has outgoing edges', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'END', nodeType: 'end', tool: null, prompt: null }),
      mockNode({ id: 'B' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'END' }),
      mockEdge({ fromNodeId: 'END', toNodeId: 'B' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    const endError = result.errors.find((e) => e.code === 'END_HAS_OUTGOING');
    expect(endError).toBeDefined();
    expect(endError?.nodeId).toBe('END');
  });

  it('does not require tool or prompt for end nodes', () => {
    const nodes = [mockNode({ id: 'END', nodeType: 'end', tool: null, prompt: null })];

    const result = validateDAG(nodes, []);

    // Should NOT have TASK_NO_TOOL or TASK_NO_PROMPT errors
    expect(result.errors.filter((e) => e.code === 'TASK_NO_TOOL')).toHaveLength(0);
    expect(result.errors.filter((e) => e.code === 'TASK_NO_PROMPT')).toHaveLength(0);
  });

  it('accepts multiple end nodes in the same DAG', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'END1', nodeType: 'end', tool: null, prompt: null }),
      mockNode({ id: 'END2', nodeType: 'end', tool: null, prompt: null }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'END1', conditionValue: 'success' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'END2', conditionValue: 'error' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(true);
  });

  it('reports DISCONNECTED_PORT as error when returnValue port has no outgoing edge', () => {
    const nodes = [
      mockNode({ id: 'A', returnValues: ['success', 'error'] }),
      mockNode({ id: 'B' }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B', conditionValue: 'success' })];

    const result = validateDAG(nodes, edges);

    expect(result.valid).toBe(false);
    const portError = result.errors.find((e) => e.code === 'DISCONNECTED_PORT');
    expect(portError).toBeDefined();
    expect(portError?.nodeId).toBe('A');
    expect(portError?.message).toContain('error');
  });

  it('reports DISCONNECTED_PORT when a node defines returnValues but has no outgoing edges', () => {
    const nodes = [mockNode({ id: 'A', returnValues: ['success'] })];

    const result = validateDAG(nodes, []);

    expect(result.valid).toBe(false);
    expect(result.errors.filter((e) => e.code === 'DISCONNECTED_PORT')).toHaveLength(1);
  });

  it('does not report DISCONNECTED_PORT when all returnValue ports are connected', () => {
    const nodes = [
      mockNode({ id: 'A', returnValues: ['success', 'error'] }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B', conditionValue: 'success' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C', conditionValue: 'error' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.errors.filter((e) => e.code === 'DISCONNECTED_PORT')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('does not report DISCONNECTED_PORT for system return values (other_return, error_return) even when unconnected', () => {
    const nodes = [
      mockNode({ id: 'A', returnValues: ['success', 'error', 'other_return', 'error_return'] }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B', conditionValue: 'success' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C', conditionValue: 'error' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.errors.filter((e) => e.code === 'DISCONNECTED_PORT')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('still reports DISCONNECTED_PORT for user-defined ports when unconnected alongside system values', () => {
    const nodes = [
      mockNode({
        id: 'A',
        returnValues: ['success', 'error', 'retry', 'other_return', 'error_return'],
      }),
      mockNode({ id: 'B' }),
    ];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B', conditionValue: 'success' })];

    const result = validateDAG(nodes, edges);

    const portErrors = result.errors.filter((e) => e.code === 'DISCONNECTED_PORT');
    expect(portErrors).toHaveLength(2); // 'error' and 'retry'
    expect(portErrors.some((e) => e.message.includes('error'))).toBe(true);
    expect(portErrors.some((e) => e.message.includes('retry'))).toBe(true);
  });

  it('reports ORPHAN_NODE when a node is unreachable from any root', () => {
    // Node B has an incoming edge from a non-existent source X.
    // computeReachable sees B with a reverse-adjacency entry for X,
    // so B is not treated as a root. Since X doesn't exist, B is never
    // reached by BFS from actual roots. A is the only root and only
    // reaches itself (no outgoing edges to B).
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'X', toNodeId: 'B' })];

    const result = validateDAG(nodes, edges);

    const orphanErrors = result.errors.filter((e) => e.code === 'ORPHAN_NODE');
    expect(orphanErrors.length).toBeGreaterThanOrEqual(1);
    expect(orphanErrors.some((e) => e.nodeId === 'B')).toBe(true);
  });

  it('treats pass/fail and true/false as equivalent in DISCONNECTED_PORT checks', () => {
    const nodes = [
      mockNode({ id: 'A', returnValues: ['true', 'false'] }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B', conditionValue: 'pass' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C', conditionValue: 'fail' }),
    ];

    const result = validateDAG(nodes, edges);

    expect(result.errors.filter((e) => e.code === 'DISCONNECTED_PORT')).toHaveLength(0);
    expect(result.valid).toBe(true);
  });
});

// ─── evaluateEdgeCondition ───────────────────────────────────

describe('evaluateEdgeCondition', () => {
  it('returns true when conditionValue is null (unconditional)', () => {
    expect(evaluateEdgeCondition(null, 'eq', 'anything')).toBe(true);
  });

  it('returns true when conditionValue is null even if returnValue is null', () => {
    expect(evaluateEdgeCondition(null, 'eq', null)).toBe(true);
  });

  it('returns true for wildcard * when returnValue is non-null', () => {
    expect(evaluateEdgeCondition('*', 'eq', 'hello')).toBe(true);
  });

  it('returns false for wildcard * when returnValue is null', () => {
    expect(evaluateEdgeCondition('*', 'eq', null)).toBe(false);
  });

  it('returns false when returnValue is null but conditionValue is set', () => {
    expect(evaluateEdgeCondition('expected', 'eq', null)).toBe(false);
  });

  // eq operator
  it('eq: returns true on exact match', () => {
    expect(evaluateEdgeCondition('ok', 'eq', 'ok')).toBe(true);
  });

  it('eq: returns false on mismatch', () => {
    expect(evaluateEdgeCondition('ok', 'eq', 'fail')).toBe(false);
  });

  it('eq: is case-sensitive', () => {
    expect(evaluateEdgeCondition('OK', 'eq', 'ok')).toBe(false);
  });

  // neq operator
  it('neq: returns true when values differ', () => {
    expect(evaluateEdgeCondition('ok', 'neq', 'fail')).toBe(true);
  });

  it('neq: returns false when values match', () => {
    expect(evaluateEdgeCondition('ok', 'neq', 'ok')).toBe(false);
  });

  // in operator
  it('in: returns true when returnValue is in CSV list', () => {
    expect(evaluateEdgeCondition('ok,done,pass', 'in', 'done')).toBe(true);
  });

  it('in: returns false when returnValue is not in CSV list', () => {
    expect(evaluateEdgeCondition('ok,done,pass', 'in', 'fail')).toBe(false);
  });

  it('in: handles whitespace around CSV values', () => {
    expect(evaluateEdgeCondition('ok, done , pass', 'in', 'done')).toBe(true);
  });

  it('in: filters empty values from split', () => {
    // "ok,,done" splits to ["ok", "", "done"], empty strings are filtered by Boolean
    expect(evaluateEdgeCondition('ok,,done', 'in', '')).toBe(false);
  });

  // regex operator
  it('regex: returns true on pattern match', () => {
    expect(evaluateEdgeCondition('^success', 'regex', 'success: deployed')).toBe(true);
  });

  it('regex: returns false on no match', () => {
    expect(evaluateEdgeCondition('^success', 'regex', 'failure: error')).toBe(false);
  });

  it('regex: returns false for invalid regex pattern', () => {
    expect(evaluateEdgeCondition('[invalid(', 'regex', 'test')).toBe(false);
  });

  it('regex: returns false when pattern exceeds MAX_REGEX_PATTERN_LENGTH', () => {
    const longPattern = 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1);
    expect(evaluateEdgeCondition(longPattern, 'regex', 'aaa')).toBe(false);
  });

  it('regex: accepts pattern at exactly MAX_REGEX_PATTERN_LENGTH', () => {
    const exactPattern = 'a'.repeat(MAX_REGEX_PATTERN_LENGTH);
    expect(evaluateEdgeCondition(exactPattern, 'regex', 'a'.repeat(MAX_REGEX_PATTERN_LENGTH))).toBe(
      true,
    );
  });

  // unknown operator
  it('returns false for unknown operator', () => {
    expect(evaluateEdgeCondition('val', 'unknown_op' as never, 'val')).toBe(false);
  });

  // edge cases
  it('eq: handles empty string match', () => {
    expect(evaluateEdgeCondition('', 'eq', '')).toBe(true);
  });

  it('neq: empty string vs non-empty', () => {
    expect(evaluateEdgeCondition('', 'neq', 'something')).toBe(true);
  });
});

// ─── evaluateGateCondition ───────────────────────────────────

describe('evaluateGateCondition', () => {
  describe('and mode', () => {
    it('returns pass when all sources match', () => {
      expect(evaluateGateCondition('and', 'success', ['success', 'success'])).toBe('pass');
    });

    it('returns fail when some sources do not match', () => {
      expect(evaluateGateCondition('and', 'success', ['success', 'error'])).toBe('fail');
    });

    it('returns fail when a source has null return value', () => {
      expect(evaluateGateCondition('and', 'success', ['success', null])).toBe('fail');
    });

    it('returns pass for single matching source', () => {
      expect(evaluateGateCondition('and', 'ok', ['ok'])).toBe('pass');
    });
  });

  describe('or mode', () => {
    it('returns pass when at least one source matches', () => {
      expect(evaluateGateCondition('or', 'success', ['error', 'success'])).toBe('pass');
    });

    it('returns fail when no sources match', () => {
      expect(evaluateGateCondition('or', 'success', ['error', 'fail'])).toBe('fail');
    });

    it('returns fail when all sources are null', () => {
      expect(evaluateGateCondition('or', 'success', [null, null])).toBe('fail');
    });

    it('returns pass even if only one of many matches', () => {
      expect(evaluateGateCondition('or', 'done', [null, 'error', 'done'])).toBe('pass');
    });
  });

  it('returns fail when sourceResults is empty', () => {
    expect(evaluateGateCondition('and', 'success', [])).toBe('fail');
    expect(evaluateGateCondition('or', 'success', [])).toBe('fail');
  });

  it('returns fail for unknown gate mode', () => {
    expect(evaluateGateCondition('invalid_mode' as never, 'ok', ['ok'])).toBe('fail');
  });

  it('uses exact string matching for matchValue', () => {
    // Not a regex or partial match — exact equality only
    expect(evaluateGateCondition('and', 'success', ['SUCCESS'])).toBe('fail');
    expect(evaluateGateCondition('and', 'ok', ['ok'])).toBe('pass');
  });

  it('treats pass/fail and true/false as equivalent aliases', () => {
    expect(evaluateGateCondition('and', 'true', ['pass', 'true'])).toBe('pass');
    expect(evaluateGateCondition('or', 'false', ['pass', 'fail'])).toBe('pass');
  });
});

// ─── buildValidatedDAG ───────────────────────────────────────

describe('buildValidatedDAG', () => {
  it('builds correct outgoing and incoming maps', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
    ];

    const dag = buildValidatedDAG(nodes, edges);

    // Outgoing from A should have 2 edges
    expect(dag.outgoing.get('A')).toHaveLength(2);
    // Outgoing from B and C should be empty
    expect(dag.outgoing.get('B')).toHaveLength(0);
    expect(dag.outgoing.get('C')).toHaveLength(0);
    // Incoming to A should be empty
    expect(dag.incoming.get('A')).toHaveLength(0);
    // Incoming to B and C should each have 1
    expect(dag.incoming.get('B')).toHaveLength(1);
    expect(dag.incoming.get('C')).toHaveLength(1);
  });

  it('identifies root nodes (no incoming edges and not gate)', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
    ];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.roots).toEqual(['A']);
  });

  it('includes end nodes as roots when they have no incoming edges', () => {
    // Unlike gates, end nodes with no incoming edges are treated as roots.
    // This is structurally valid (though semantically useless — a workflow that
    // immediately ends). Validation doesn't flag it; the engine just completes it.
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'END', nodeType: 'end', tool: null, prompt: null }),
    ];
    const edges: OrchestratorEdge[] = [];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.roots).toContain('A');
    expect(dag.roots).toContain('END');
  });

  it('excludes gate nodes from roots even if they have no incoming edges', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({
        id: 'G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'success' },
      }),
    ];
    const edges: OrchestratorEdge[] = [];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.roots).toEqual(['A']);
    expect(dag.roots).not.toContain('G');
  });

  it('computes correct topological order', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
      mockNode({ id: 'D' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'D' }),
      mockEdge({ fromNodeId: 'C', toNodeId: 'D' }),
    ];

    const dag = buildValidatedDAG(nodes, edges);

    // A must come before B, C; B and C must come before D
    const indexA = dag.topologicalOrder.indexOf('A');
    const indexB = dag.topologicalOrder.indexOf('B');
    const indexC = dag.topologicalOrder.indexOf('C');
    const indexD = dag.topologicalOrder.indexOf('D');

    expect(indexA).toBeLessThan(indexB);
    expect(indexA).toBeLessThan(indexC);
    expect(indexB).toBeLessThan(indexD);
    expect(indexC).toBeLessThan(indexD);
  });

  it('stores all nodes in the node map', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.nodes.size).toBe(2);
    expect(dag.nodes.get('A')?.id).toBe('A');
    expect(dag.nodes.get('B')?.id).toBe('B');
  });

  it('stores all edges', () => {
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
    ];
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.edges).toHaveLength(2);
  });

  it('handles empty inputs', () => {
    const dag = buildValidatedDAG([], []);

    expect(dag.nodes.size).toBe(0);
    expect(dag.edges).toHaveLength(0);
    expect(dag.roots).toEqual([]);
    expect(dag.topologicalOrder).toEqual([]);
  });

  it('identifies multiple root nodes', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
    ];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.roots).toContain('A');
    expect(dag.roots).toContain('B');
    expect(dag.roots).not.toContain('C');
    expect(dag.roots).toHaveLength(2);
  });
});

// ─── getAncestors ────────────────────────────────────────────

describe('getAncestors', () => {
  it('returns empty set for a root node (no ancestors)', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];
    const dag = buildValidatedDAG(nodes, edges);

    const ancestors = getAncestors(dag, 'A');

    expect(ancestors.size).toBe(0);
  });

  it('returns direct parent as ancestor', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];
    const dag = buildValidatedDAG(nodes, edges);

    const ancestors = getAncestors(dag, 'B');

    expect(ancestors.has('A')).toBe(true);
    expect(ancestors.size).toBe(1);
  });

  it('returns transitive ancestors', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
      mockNode({ id: 'D' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'C', toNodeId: 'D' }),
    ];
    const dag = buildValidatedDAG(nodes, edges);

    const ancestors = getAncestors(dag, 'D');

    expect(ancestors.has('A')).toBe(true);
    expect(ancestors.has('B')).toBe(true);
    expect(ancestors.has('C')).toBe(true);
    expect(ancestors.size).toBe(3);
  });

  it('returns ancestors from multiple paths (diamond DAG)', () => {
    const nodes = [
      mockNode({ id: 'A' }),
      mockNode({ id: 'B' }),
      mockNode({ id: 'C' }),
      mockNode({ id: 'D' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'A', toNodeId: 'C' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'D' }),
      mockEdge({ fromNodeId: 'C', toNodeId: 'D' }),
    ];
    const dag = buildValidatedDAG(nodes, edges);

    const ancestors = getAncestors(dag, 'D');

    expect(ancestors.has('A')).toBe(true);
    expect(ancestors.has('B')).toBe(true);
    expect(ancestors.has('C')).toBe(true);
    expect(ancestors.size).toBe(3);
  });

  it('does not include the node itself in its ancestors', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'B' })];
    const dag = buildValidatedDAG(nodes, edges);

    const ancestors = getAncestors(dag, 'B');

    expect(ancestors.has('B')).toBe(false);
  });

  it('returns empty set for a node not in the DAG', () => {
    const nodes = [mockNode({ id: 'A' })];
    const dag = buildValidatedDAG(nodes, []);

    const ancestors = getAncestors(dag, 'UNKNOWN');

    expect(ancestors.size).toBe(0);
  });
});

// ─── buildValidatedDAG with precomputedOrder (Fix 8) ──────────

describe('buildValidatedDAG precomputedOrder', () => {
  it('uses precomputed topological order when provided', () => {
    const nodes = [mockNode({ id: 'A' }), mockNode({ id: 'B' }), mockNode({ id: 'C' })];
    const edges = [
      mockEdge({ fromNodeId: 'A', toNodeId: 'B' }),
      mockEdge({ fromNodeId: 'B', toNodeId: 'C' }),
    ];

    const precomputed = ['A', 'B', 'C'];
    const dag = buildValidatedDAG(nodes, edges, precomputed);

    expect(dag.topologicalOrder).toBe(precomputed); // same reference
    expect(dag.topologicalOrder).toEqual(['A', 'B', 'C']);
  });

  it('falls back to computing topological order when precomputedOrder is not provided', () => {
    const nodes = [mockNode({ id: 'X' }), mockNode({ id: 'Y' })];
    const edges = [mockEdge({ fromNodeId: 'X', toNodeId: 'Y' })];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.topologicalOrder).toEqual(['X', 'Y']);
  });

  it('returns an empty topological order when buildValidatedDAG receives edges for unknown nodes', () => {
    const nodes = [mockNode({ id: 'A' })];
    const edges = [mockEdge({ fromNodeId: 'A', toNodeId: 'MISSING' })];

    const dag = buildValidatedDAG(nodes, edges);

    expect(dag.topologicalOrder).toEqual([]);
    expect(dag.outgoing.get('A')).toHaveLength(1);
  });
});

// ─── computeReachable gate reachability (edge-based) ──────────

describe('validateDAG gate reachability', () => {
  it('marks gate as reachable when it has incoming edges from reachable nodes', () => {
    const nodes = [
      mockNode({ id: 'Root' }),
      mockNode({
        id: 'G',
        label: 'Gate G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'success' },
      }),
      mockNode({ id: 'After', label: 'After' }),
    ];
    const edges = [
      mockEdge({ fromNodeId: 'Root', toNodeId: 'G' }),
      mockEdge({ fromNodeId: 'G', toNodeId: 'After' }),
    ];

    const result = validateDAG(nodes, edges);

    const orphanErrors = result.errors.filter((e) => e.code === 'ORPHAN_NODE');
    expect(orphanErrors).toHaveLength(0);
  });

  it('reports GATE_NO_INCOMING for gate with no incoming edges even if graph-reachable', () => {
    // A gate with no incoming edges is reachable via BFS (0 in-degree = root in BFS),
    // but structurally invalid because it needs incoming edges to synchronise on.
    const nodes = [
      mockNode({ id: 'Root' }),
      mockNode({
        id: 'G',
        label: 'Gate G',
        nodeType: 'gate',
        tool: null,
        prompt: null,
        gateCondition: { mode: 'and', matchValue: 'success' },
      }),
    ];
    const edges: OrchestratorEdge[] = [];

    const result = validateDAG(nodes, edges);

    // GATE_NO_INCOMING should be reported
    expect(result.errors.some((e) => e.code === 'GATE_NO_INCOMING' && e.nodeId === 'G')).toBe(true);
    // Not orphan — still graph-reachable (0 in-degree)
    expect(result.errors.some((e) => e.code === 'ORPHAN_NODE' && e.nodeId === 'G')).toBe(false);
  });
});

// ─── MAX_REGEX_PATTERN_LENGTH constant ───────────────────────

describe('MAX_REGEX_PATTERN_LENGTH', () => {
  it('is 200', () => {
    expect(MAX_REGEX_PATTERN_LENGTH).toBe(200);
  });
});
