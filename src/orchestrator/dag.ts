/** @module dag — DAG validation, topological sort (Kahn's), and edge/gate condition evaluation. */

import { FIELD_LIMITS } from '../shared/field-limits.js';
import { ORCHESTRATOR_DEFAULTS } from './orchestrator-limits.js';
import type {
  ConditionOperator,
  DAGValidationError,
  DAGValidationErrorCode,
  DAGValidationResult,
  DAGValidationWarning,
  DAGValidationWarningCode,
  GateMode,
  OrchestratorEdge,
  OrchestratorNode,
  ValidatedDAG,
} from './types.js';

/** Maximum allowed regex pattern length to mitigate ReDoS attacks. */
export const MAX_REGEX_PATTERN_LENGTH = FIELD_LIMITS.regexPattern.max;

function normalizeGateBoolAlias(value: string): string;
function normalizeGateBoolAlias(value: null): null;
function normalizeGateBoolAlias(value: string | null): string | null;
function normalizeGateBoolAlias(value: string | null): string | null {
  if (value === null) return null;
  const lower = value.toLowerCase();
  if (lower === 'pass' || lower === 'true') return 'true';
  if (lower === 'fail' || lower === 'false') return 'false';
  return value;
}

// ── Public API ───────────────────────────────────────────────

/** Validate the DAG structure and return errors, warnings, and topological order. */
export function validateDAG(
  nodes: OrchestratorNode[],
  edges: OrchestratorEdge[],
  maxTotalNodes: number = ORCHESTRATOR_DEFAULTS.maxTotalNodes,
  options?: {
    startNodeId?: string | null;
    triggeredNodeSubscriptionIds?: Set<string>;
    /** Resolve an agent by ID to check for fallback tool. */
    agentResolver?: (agentId: string) => { tool: string } | null;
  },
): DAGValidationResult {
  const errors: DAGValidationError[] = [];
  const warnings: DAGValidationWarning[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const startNodeId = options?.startNodeId ?? null;
  const triggeredNodeSubscriptionIds = options?.triggeredNodeSubscriptionIds ?? new Set<string>();
  const agentResolver = options?.agentResolver;

  // ── Max node count ──
  if (nodes.length > maxTotalNodes) {
    errors.push(
      makeError('MAX_NODES_EXCEEDED', `Node count ${nodes.length} exceeds limit ${maxTotalNodes}`),
    );
  }

  // ── Validate individual nodes ──
  for (const node of nodes) {
    if (node.nodeType === 'task' || node.nodeType === 'triggered') {
      const agent = node.agentId && agentResolver ? agentResolver(node.agentId) : null;
      const effectiveTool = node.tool ?? agent?.tool ?? null;
      if (!effectiveTool) {
        errors.push(makeError('TASK_NO_TOOL', `Task node "${node.label}" has no tool`, node.id));
      }
      if (!node.prompt || node.prompt.trim() === '') {
        errors.push(
          makeError('TASK_NO_PROMPT', `Task node "${node.label}" has no prompt`, node.id),
        );
      }
    }
    if (node.nodeType === 'triggered') {
      if (!node.triggeredConfig) {
        errors.push(
          makeError(
            'TRIGGERED_CONFIG_REQUIRED',
            `Triggered node "${node.label}" requires triggeredConfig`,
            node.id,
          ),
        );
      } else {
        if (node.triggeredConfig.waitTimeoutSec <= 0) {
          errors.push(
            makeError(
              'TRIGGERED_TIMEOUT_INVALID',
              `Triggered node "${node.label}" waitTimeoutSec must be > 0`,
              node.id,
            ),
          );
        }
        if (
          node.triggeredConfig.onTimeout !== 'fail' &&
          node.triggeredConfig.onTimeout !== 'skip'
        ) {
          errors.push(
            makeError(
              'TRIGGERED_ON_TIMEOUT_INVALID',
              `Triggered node "${node.label}" onTimeout must be "fail" or "skip"`,
              node.id,
            ),
          );
        }
      }
      if (!triggeredNodeSubscriptionIds.has(node.id)) {
        errors.push(
          makeError(
            'TRIGGERED_NO_SUBSCRIPTION',
            `Triggered node "${node.label}" must have an event subscription`,
            node.id,
          ),
        );
      }
    } else if (node.triggeredConfig) {
      errors.push(
        makeError(
          'TRIGGERED_CONFIG_FORBIDDEN',
          `Node "${node.label}" cannot define triggeredConfig`,
          node.id,
        ),
      );
    }
    if (node.nodeType === 'end') {
      // End nodes: no tool/prompt validation needed, but check for outgoing edges below
    } else if (node.nodeType === 'gate') {
      if (!node.gateCondition || !node.gateCondition.matchValue) {
        errors.push(
          makeError('GATE_NO_MATCH_VALUE', `Gate node "${node.label}" has no matchValue`, node.id),
        );
      }
    }
  }

  // ── Validate edges ──
  const edgeKeys = new Set<string>();
  const incomingCount = new Map<string, number>();
  for (const edge of edges) {
    // Self-loop check
    if (edge.fromNodeId === edge.toNodeId) {
      errors.push(
        makeError(
          'SELF_LOOP',
          `Edge creates a self-loop on node "${edge.fromNodeId}"`,
          edge.fromNodeId,
          edge.id,
        ),
      );
      continue;
    }
    if (!nodeIds.has(edge.fromNodeId)) {
      errors.push(
        makeError(
          'MISSING_EDGE_TARGET',
          `Edge references non-existent source node "${edge.fromNodeId}"`,
          undefined,
          edge.id,
        ),
      );
    }
    if (!nodeIds.has(edge.toNodeId)) {
      errors.push(
        makeError(
          'MISSING_EDGE_TARGET',
          `Edge references non-existent target node "${edge.toNodeId}"`,
          undefined,
          edge.id,
        ),
      );
    }
    // Track incoming edges for gate validation (only valid targets)
    if (nodeIds.has(edge.toNodeId)) {
      incomingCount.set(edge.toNodeId, (incomingCount.get(edge.toNodeId) ?? 0) + 1);
    }
    const key = `${edge.fromNodeId}->${edge.toNodeId}:${edge.conditionValue ?? ''}:${edge.conditionOperator}`;
    if (edgeKeys.has(key)) {
      errors.push(
        makeError(
          'DUPLICATE_EDGE',
          'Duplicate edge from→to with same condition',
          undefined,
          edge.id,
        ),
      );
    }
    edgeKeys.add(key);
  }

  // ── End node outgoing edge check ──
  const outgoingFrom = new Set(edges.map((e) => e.fromNodeId));
  for (const node of nodes) {
    if (node.nodeType === 'end' && outgoingFrom.has(node.id)) {
      errors.push(
        makeError(
          'END_HAS_OUTGOING',
          `End node "${node.label}" cannot have outgoing edges`,
          node.id,
        ),
      );
    }
  }

  // ── Topological sort + cycle detection ──
  const topoResult = topologicalSort(
    [...nodeIds],
    edges
      .filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId))
      .map((e) => [e.fromNodeId, e.toNodeId]),
  );

  if (topoResult === null) {
    errors.push(makeError('CYCLE_DETECTED', 'The DAG contains a cycle'));
  }

  const topologicalOrder = topoResult ?? [];

  if (startNodeId) {
    const startNode = nodes.find((node) => node.id === startNodeId);
    if (!startNode) {
      errors.push(
        makeError(
          'START_NODE_MISSING',
          `Start node "${startNodeId}" does not exist in this orchestrator`,
          startNodeId,
        ),
      );
    } else {
      if (startNode.nodeType !== 'task') {
        errors.push(
          makeError(
            'START_NODE_NOT_TASK',
            `Start node "${startNode.label}" must be a task node`,
            startNode.id,
          ),
        );
      }
      if ((incomingCount.get(startNode.id) ?? 0) > 0) {
        errors.push(
          makeError(
            'START_NODE_HAS_INCOMING',
            `Start node "${startNode.label}" cannot have incoming edges`,
            startNode.id,
          ),
        );
      }
    }
  }

  // ── Orphan detection ──
  if (topoResult) {
    const reachable = computeReachable(nodes, edges);
    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        errors.push(makeError('ORPHAN_NODE', `Node "${node.label}" is unreachable`, node.id));
      }
    }
  }

  // ── Gate incoming edge check (uses incomingCount built in edge validation above) ──
  for (const node of nodes) {
    if (node.nodeType === 'gate' && (incomingCount.get(node.id) ?? 0) === 0) {
      errors.push(
        makeError('GATE_NO_INCOMING', `Gate node "${node.label}" has no incoming edges`, node.id),
      );
    }
  }

  // ── Disconnected port validation ──
  // Check that every declared returnValue port has at least one outgoing edge
  const edgesBySourceAndCondition = new Map<string, Set<string>>();
  for (const edge of edges) {
    const key = edge.fromNodeId;
    if (!edgesBySourceAndCondition.has(key)) edgesBySourceAndCondition.set(key, new Set());
    edgesBySourceAndCondition.get(key)?.add(normalizeGateBoolAlias(edge.conditionValue) ?? '');
  }
  const SYSTEM_RETURN_VALUES: ReadonlySet<string> = new Set(['other_return', 'error_return']);
  for (const node of nodes) {
    if (node.nodeType === 'end') continue; // End nodes have no output ports
    if (node.returnValues && node.returnValues.length > 0) {
      const connectedValues = edgesBySourceAndCondition.get(node.id) ?? new Set<string>();
      for (const rv of node.returnValues) {
        if (SYSTEM_RETURN_VALUES.has(rv)) continue;
        if (!connectedValues.has(normalizeGateBoolAlias(rv))) {
          errors.push(
            makeError(
              'DISCONNECTED_PORT',
              `Port "${rv}" on node "${node.label}" is not connected`,
              node.id,
            ),
          );
        }
      }
    }
  }

  // ── Warnings ──
  const terminalNodes = findTerminalNodes(nodes, edges);
  if (terminalNodes.length === 0 && nodes.length > 0) {
    warnings.push(
      makeWarning('NO_TERMINAL_NODE', 'No terminal node (node with no outgoing edges) found'),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder,
  };
}

/** Build a ValidatedDAG from nodes and edges (assumes already validated). */
export function buildValidatedDAG(
  nodes: OrchestratorNode[],
  edges: OrchestratorEdge[],
  precomputedOrder?: string[],
): ValidatedDAG {
  const nodeMap = new Map<string, OrchestratorNode>();
  const outgoing = new Map<string, OrchestratorEdge[]>();
  const incoming = new Map<string, OrchestratorEdge[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.fromNodeId)?.push(edge);
    incoming.get(edge.toNodeId)?.push(edge);
  }

  // Root nodes: no incoming edges AND not a gate
  const roots = nodes
    .filter((n) => {
      const inc = incoming.get(n.id);
      return (!inc || inc.length === 0) && n.nodeType !== 'gate';
    })
    .map((n) => n.id);

  const topologicalOrder =
    precomputedOrder ??
    topologicalSort(
      nodes.map((n) => n.id),
      edges.map((e) => [e.fromNodeId, e.toNodeId]),
    ) ??
    [];

  return {
    nodes: nodeMap,
    edges,
    outgoing,
    incoming,
    roots,
    topologicalOrder,
  };
}

/** Get all ancestor node IDs (transitively reachable by following incoming edges). */
export function getAncestors(dag: ValidatedDAG, nodeId: string): Set<string> {
  const ancestors = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.pop() as string;
    const inc = dag.incoming.get(current);
    if (!inc) continue;
    for (const edge of inc) {
      if (!ancestors.has(edge.fromNodeId)) {
        ancestors.add(edge.fromNodeId);
        queue.push(edge.fromNodeId);
      }
    }
  }

  return ancestors;
}

/** Evaluate whether an edge condition matches a return value. */
export function evaluateEdgeCondition(
  conditionValue: string | null,
  conditionOperator: ConditionOperator,
  returnValue: string | null,
): boolean {
  // NULL condition = unconditional (always pass)
  if (conditionValue === null) return true;

  // Wildcard
  if (conditionValue === '*') return returnValue !== null;

  // No return value but condition expects one
  if (returnValue === null) return false;

  const normalizedReturn = normalizeGateBoolAlias(returnValue);
  const normalizedCondition = normalizeGateBoolAlias(conditionValue);

  switch (conditionOperator) {
    case 'eq':
      return normalizedReturn === normalizedCondition;
    case 'neq':
      return normalizedReturn !== normalizedCondition;
    case 'in': {
      const values = conditionValue
        .split(',')
        .map((v) => normalizeGateBoolAlias(v.trim()))
        .filter(Boolean);
      return values.includes(normalizedReturn);
    }
    case 'regex': {
      // Guard against ReDoS: reject patterns that are too long
      if (conditionValue.length > MAX_REGEX_PATTERN_LENGTH) return false;
      try {
        return new RegExp(conditionValue).test(returnValue);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/** Evaluate a gate condition against source node return values. */
export function evaluateGateCondition(
  mode: GateMode,
  matchValue: string,
  sourceResults: (string | null)[],
): 'pass' | 'fail' {
  if (sourceResults.length === 0) return 'fail';
  const normalizedMatchValue = normalizeGateBoolAlias(matchValue);

  switch (mode) {
    case 'and':
      return sourceResults.every(
        (rv) => (normalizeGateBoolAlias(rv) ?? rv) === normalizedMatchValue,
      )
        ? 'pass'
        : 'fail';
    case 'or':
      return sourceResults.some((rv) => (normalizeGateBoolAlias(rv) ?? rv) === normalizedMatchValue)
        ? 'pass'
        : 'fail';
    default:
      return 'fail';
  }
}

// ── Internal Helpers ─────────────────────────────────────────

/** Kahn's algorithm. Returns sorted IDs, or null if a cycle exists. */
function topologicalSort(nodeIds: string[], edges: [string, string][]): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const [from, to] of edges) {
    adjacency.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift() as string;
    sorted.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) as number) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // If not all nodes are sorted, a cycle exists
  return sorted.length === nodeIds.length ? sorted : null;
}

/** Compute the set of reachable node IDs from root nodes via BFS over edges. */
function computeReachable(nodes: OrchestratorNode[], edges: OrchestratorEdge[]): Set<string> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();

  for (const id of nodeIds) {
    adj.set(id, []);
    reverseAdj.set(id, []);
  }

  for (const edge of edges) {
    adj.get(edge.fromNodeId)?.push(edge.toNodeId);
    reverseAdj.get(edge.toNodeId)?.push(edge.fromNodeId);
  }

  // BFS from roots (nodes with no incoming edges)
  const roots = nodes.filter((n) => reverseAdj.get(n.id)?.length === 0);
  const reachable = new Set<string>();
  const queue = roots.map((r) => r.id);

  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const neighbor of adj.get(id) ?? []) {
      if (!reachable.has(neighbor)) queue.push(neighbor);
    }
  }

  return reachable;
}

/** Find terminal nodes (nodes with no outgoing edges). */
function findTerminalNodes(
  nodes: OrchestratorNode[],
  edges: OrchestratorEdge[],
): OrchestratorNode[] {
  const hasOutgoing = new Set(edges.map((e) => e.fromNodeId));
  return nodes.filter((n) => !hasOutgoing.has(n.id));
}

// ── Helper Factories ─────────────────────────────────────────

function makeError(
  code: DAGValidationErrorCode,
  message: string,
  nodeId?: string,
  edgeId?: string,
): DAGValidationError {
  const err: DAGValidationError = { code, message };
  if (nodeId) err.nodeId = nodeId;
  if (edgeId) err.edgeId = edgeId;
  return err;
}

function makeWarning(code: DAGValidationWarningCode, message: string): DAGValidationWarning {
  return { code, message };
}
