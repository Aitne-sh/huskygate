# Orchestrator — DAG-Based Workflow Engine

> Scope: DAG definition, node execution, summary, return value routing, type definitions

---

## 1. Overview

A DAG-based workflow engine. Executes multiple AI task nodes in parallel based on dependency relationships, providing flexible orchestration combining conditional branching, synchronization gates, and external event waiting.

**Key capabilities:**
- 4 node types (task / triggered / gate / end)
- Conditional edge routing (eq / neq / in / regex)
- Parallel execution control (maxParallelism)
- Retry policy (per-node maxRetries)
- Bounded execution windows (orchestrator timeout, per-node timeout, triggered wait timeout)
- Error policy (fail_fast / continue)
- Crash recovery (state restoration on process restart)
- AI summary generation (auto-summarization after completion)

---

## 2. Type System

### Orchestrator Configuration

```typescript
interface Orchestrator {
  id: string;
  name: string;
  alias: string | null;
  triggerMode: 'ondemand' | 'webhook';
  errorPolicy: 'fail_fast' | 'continue';
  maxParallelism: number;      // default 3
  maxTotalNodes: number;       // default 50
  timeoutSec: number | null;   // null = no orchestrator-wide timeout override
  maxRunWorkdirs: number;      // default 20; 0 = immediate delete
  summaryEnabled: boolean;
  summaryTool: ToolName | null;
  // Schedule
  scheduleType: 'once' | 'recurring' | null;
  runAt: string | null;
  cronExpr: string | null;
  timezone: string | null;
  // Notification
  notifyChannel: string | null;
  notifyOnError: boolean;
  // Workdir & instruction
  workdir: string | null;
  instructionFile: string | null;
  // Metadata
  status: 'active' | 'deleted';
  validated: boolean;
  validatedSnapshot: string | null;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Node Types

```typescript
type NodeType = 'task' | 'triggered' | 'gate' | 'end';
```

- **task** — Execution model: asynchronous (job) — Executes a job using the specified tool (Claude/Codex/Gemini)
- **triggered** — Execution model: asynchronous (event wait -> job) — Waits for an external event arrival, injects the payload into the prompt, and executes
- **gate** — Execution model: synchronous — Waits for all input nodes to complete, evaluates conditions, and returns pass/fail
- **end** — Execution model: synchronous — Workflow end marker. Completes immediately (returnValue='workflow_ended')

### OrchestratorNode

```typescript
interface OrchestratorNode {
  id: string;
  orchestratorId: string;
  label: string;               // display label (not 'name')
  nodeType: NodeType;
  agentId: string | null;      // reference to ai_agents.id (ON DELETE SET NULL)
  tool: ToolName | null;       // task/triggered only
  mode: Mode | null;
  prompt: string | null;
  allowMcp: boolean;
  enabledMcpServerIds: string[] | null; // null = inherit session MCP allowlist
  // Output routing (forced to 'auto' when agentId is set)
  outputMode: 'auto' | 'manual';
  returnConditions: { condition: string; value: string }[] | null;
  returnValues: string[];      // auto-injects 'other_return', 'error_return'
  // Retry
  maxRetries: number;          // 0-10
  timeoutSec: number | null;   // null or 1-21600 seconds
  // Gate
  gateCondition: { mode: 'and' | 'or'; matchValue: string } | null;
  // Triggered
  triggeredConfig: {
    waitTimeoutSec: number;    // 1-86400 seconds
    onTimeout: 'fail' | 'skip';
    eventSubscriptionId?: string;
  } | null;
  // Notification
  notifyEnabled: boolean;
  notifyChannel: string | null;
  notifyOnError: boolean;
  // Workdir & instruction
  workdir: string | null;
  writeInstructionFile: boolean;
  instructionFile: string | null;
  // Position (UI)
  positionX: number | null;
  positionY: number | null;
  sortOrder: number;
  // Agent reference
  agentId: string | null;            // reference to AiAgent (ON DELETE SET NULL)
}
```

### AiAgent

Reusable persona definition that bundles tool, system instructions, skills, and MCP server configuration.

```typescript
interface AiAgent {
  id: string;
  name: string;                            // unique display name
  description: string | null;
  tool: ToolName;                          // claude/codex/gemini
  systemInstruction: string | null;        // role/persona definition text
  enabledSkills: SkillRef[] | null;        // null = inherit orchestrator skills
  enabledMcpServerIds: string[] | null;    // null = inherit session MCP allowlist
  allowMcp: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Resolution at execution time** (narrowing-only security model):

| Field | Resolution | Description |
|-------|-----------|-------------|
| tool | `node.tool ?? agent.tool` | Node explicit > Agent |
| instruction | `compose(agent.systemInstruction, node.instructionFile)` | Both layers combined (not override) |
| skills | `orchestrator.enabledSkills INTERSECT agent.enabledSkills` | Agent can only narrow |
| MCP servers | `session > agent > node` (set intersection chain) | Each level can only narrow |
| allowMcp | `node.allowMcp` | Node always has explicit value |
| outputMode | forced to `auto` when agentId is set | Server-side enforcement on POST/PATCH |

### Edge & Condition

```typescript
interface OrchestratorEdge {
  id: string;
  orchestratorId: string;
  fromNodeId: string;
  toNodeId: string;
  conditionOperator: 'eq' | 'neq' | 'in' | 'regex' | null;
  conditionValue: string | null;  // null = unconditional
  sortOrder: number;
}
```

**Condition evaluation logic:**
- `null` condition -> always true (unconditional transition)
- Wildcard `*` -> true if return value is non-null
- `eq` / `neq` -> string comparison (boolean alias: pass<->true, fail<->false)
- `in` -> exists in comma-separated list
- `regex` -> regular expression match (ReDoS prevention: max 200 characters)

### Run & NodeRun Status

```typescript
type OrchestrationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type NodeRunStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
type RunTrigger = 'dashboard' | 'slack' | 'schedule' | 'webhook' | 'chat' | 'polling';
```

### Active Runtime State

```typescript
interface ActiveOrchestrationRun {
  runId: string;
  orchestrator: Orchestrator;
  dag: ValidatedDAG;
  nodeRuns: Map<string, OrchestrationNodeRun>;  // in-memory
  runningCount: number;
  startedAt: number;
  triggerContext: Record<string, unknown> | null;
  waitingTriggeredNodes: Map<string, ActiveTriggeredWaitState>;
  pendingTriggeredPayloads: Map<string, Record<string, unknown> | null>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}
```

---

## 3. DAG Validation (`dag.ts`)

### Validation Pipeline (validateDAG)

1. **Node count limit** — Error if maxTotalNodes exceeded
2. **Individual node validation:**
   - task/triggered: effective tool (node.tool ?? agent.tool via `agentResolver`) + prompt required
   - triggered: triggeredConfig + eventSubscription required
   - timeout / retry bounds: orchestrator timeout `1-86400`, node timeout `1-21600`, node retry `0-10`, triggered wait `1-86400`
   - gate: gateCondition + matchValue required
   - Non-triggered nodes: triggeredConfig prohibited
3. **Edge validation** — Detects self-loops, non-existent targets, duplicate edges
4. **End node** — Error if it has outgoing edges
5. **Topological sort (Kahn's algorithm)** — Cycle detection
6. **Isolated node detection** — Detects unreachable nodes via BFS from root nodes
7. **Gate input edges** — Error if 0 edges
8. **Unconnected ports** — Error if returnValue port has no outgoing edge
9. **Start node** — task type, no incoming edges
10. **Warnings** — NO_TERMINAL_NODE if no node has 0 outgoing edges

### ValidatedDAG (Runtime)

```typescript
interface ValidatedDAG {
  nodes: Map<string, OrchestratorNode>;
  edges: OrchestratorEdge[];
  outgoing: Map<string, OrchestratorEdge[]>;  // adjacency list
  incoming: Map<string, OrchestratorEdge[]>;  // reverse adjacency
  roots: string[];                             // no incoming, not gates
  topologicalOrder: string[];                  // precomputed sort
}
```

### Gate Condition Evaluation

- Collects terminal states of all input source nodes
- `and` mode: all sources match matchValue -> `pass`, otherwise -> `fail`
- `or` mode: any source matches -> `pass`, otherwise -> `fail`
- Non-completed sources are treated as null (non-match)

---

## 4. Execution Engine (`engine.ts`, `engine-executor.ts`)

### OrchestratorEngine Class

**Lifecycle Methods:**

- **startRun(orchestratorId, triggeredBy, options?)** — Create new run -> advanceExecution
- **startRerun(originalRunId, fromNodeId?, ...)** — Create child run, copy ancestor results
- **cancelRun(runId)** — Graceful cancellation
- **onNodeJobComplete(jobId, result, outputSummary, outputRaw)** — Job completion callback
- **recoverActiveRuns()** — Crash recovery (at startup)
- **getActiveRun(runId)** — For SSE streaming

### Execution Model

`advanceExecution(active)` is the main loop:

1. Resolve runnable nodes from DAG (`resolveRunnableNodes`)
2. Respect `maxParallelism` and track `runningCount`
3. Execute according to each node type:
   - **task**: Create session -> prepare workdir -> enqueue job
     - setup/enqueue failure is synchronous and must clean up the temporary session plus run-owned workdir before returning control to the engine loop
   - **Agent resolution** (when `node.agentId` is set):
     - Load agent via `agentStore.getById()`; null agent = graceful fallback to node-only config
     - Tool: `node.tool ?? agent.tool` (node explicit wins)
     - Instruction: `composeInstructions(agent.systemInstruction, node.instructionFile)` (both layers combined, separated by `---`)
     - Skills: `intersectSkills(orchestrator.enabledSkills, agent.enabledSkills)` (narrowing only)
     - MCP: three-level narrowing chain `session > agent > node` via set intersection
   - **task/triggered MCP resolution**:
     - `allowMcp=false` -> no MCP servers are materialized
     - `enabledMcpServerIds=null` -> inherit the session MCP allowlist (or agent MCP allowlist if agent is set)
     - `enabledMcpServerIds=[...]` -> intersect selected IDs with the parent level allowlist
   - **triggered**: Register wait with event router -> set timeout
     - when a waiting node resumes or retries and enqueue fails, the resumed standalone session/workdir is cleaned immediately and the node transitions to `failed`
   - **gate**: Immediate evaluation -> set pass/fail as returnValue
   - **end**: Immediate completion -> returnValue='workflow_ended'
4. Continue loop until no more progress can be made

### Node Readiness

**isTaskReady(active, node, skipCache):**
- Root node (no incoming edges) -> immediately ready
- Check the source node status of each incoming edge:
  - Source dead (skipped/failed/cancelled) -> skip that edge
  - Source not completed -> not ready
  - Source completed + condition mismatch -> continue
  - Condition match -> anyEdgeMatched=true
- All sources dead -> not ready (unreachable)

**isGateReady(active, node, skipCache):**
- All unique source nodes must be in terminal state
- Skippable (dead-path) sources are allowed

**isNodeSkippable(active, node, cache):**
- Skippable if all incoming paths are dead or condition mismatch
- Root nodes are never skippable
- **Memoized** (prevents exponential recalculation in diamond DAGs)

### Node Job Completion

`handleNodeJobComplete(ctx, active, nodeRun, result, outputRaw, ...):`

1. Decrement `runningCount` first (**important**: prevents permanent hang on node lookup failure)
2. Parse return value from output (last `<return:~>` tag)
3. Status determination:
   - `errorKind` (crash/timeout) -> failed (completed + error_return if no retries remaining)
   - Parsed value matches returnValues -> completed
   - Mismatch / no tag -> completed + other_return
4. Retry determination: failed + retryCount < maxRetries -> **retryNode()**
5. Error policy: failed + fail_fast -> complete entire run as failed
6. Otherwise: proceed to next nodes

### Crash Recovery

`recoverActiveRuns()`:
- On startup, loads all runs with status='running'
- Marks running nodes as failed with "Interrupted by process restart"
- Recalculates remaining time for waiting nodes and resets timeouts
- retryCount is not changed (not counted as retry consumption)

---

## 5. Return Value Routing (`return-value.ts`)

### Parsing

```typescript
parseReturnValue(output: string): string | null
// Case-insensitive regex: <return:([^>]+)>
// Multiple tags -> uses the last tag (agent retry safety)
// Max 500 characters; trimmed
```

### Routing System

- `node.returnValues` declares user-defined output ports (e.g., `['success', 'review_needed']`)
- Engine auto-injects: `other_return`, `error_return`
  - **other_return**: parsed value not in list / no tag -> routes to this path
  - **error_return**: CLI crash (errorKind) + retries exhausted -> routes to this path

### Auto Output Template

**buildReturnTemplateFromConditions(conditions):**
- Generates instruction text from user-specified `{ condition, value }` pairs
- Appended to the end of the prompt

**buildFallbackReturnTemplate(returnValues):**
- Simple version for when there are no conditions
- Lists available return values

---

## 6. Summary Pipeline (`engine-summary.ts`)

### Generation Flow

1. After successful run completion notification, triggered when `summaryEnabled=true` and `summaryTool` is configured
2. Generates Markdown report via `buildRunReport()`:
   - Status, duration, node counts (completed/failed/skipped)
   - Each task node's output (max 8,000 chars/node, 80,000 chars total)
   - Gate results (with evaluation JSON)
3. Creates job via `buildSummaryJob()` with readonly session + embedded report
   - source='orchestrator-summary', timeoutSec=180
   - No file I/O by agent (report is embedded in prompt)
4. Requests output in `<summary>` XML tag format via `buildSummaryInstruction()`
5. Extracts last `<summary>...</summary>` block via `extractSummaryContent(raw)`

---

## 7. Notification (`engine-notify.ts`)

### Node Notification

- `sendNodeNotification(ctx, active, nodeRun, node)`
- Condition: (notifyEnabled && status=completed) OR (notifyOnError && status=failed)
- Channel priority: node.notifyChannel -> orchestrator.notifyChannel -> ctx.defaultNotifyChannel
- Content: return value, exit code, duration, retry count, truncated error (1000 chars)

### Completion Notification

- `sendCompletionNotification(ctx, active, status)`
- Tree view: displays status of all nodes
  - Emoji: ✅ completed / ❌ failed / ⏭️ skipped / ⛔ cancelled / ⬜ pending
  - return value + duration
- Main message -> thread reply with node output (chunked)
- Artifacts (file attachments) uploaded to Slack thread (max 100 files)
- Returns `{ channelId, ts }` (for summary job threading)

---

## 8. Workdir Management (`engine-utils.ts`)

```
resolveWorkdir(orchestrator, runId):
  If orchestrator.workdir is set -> use as-is (shared across all runs)
  If not set -> ./workdir/orch_<runId[:8]> (auto-generated per run)

resolveNodeWorkdir(orchestrator, node, runId):
  If node.workdir is set -> node override
  If not set -> fallback to resolveWorkdir()
```

**Cleanup:**
- `trimRunWorkdirs(active)`: Deletes old workdirs based on maxRunWorkdirs policy
- `maxRunWorkdirs=0`: Deletes immediately after completion

---

## 9. Store Layer

### OrchestratorStore (Facade)

- **graph: OrchestratorGraphStore** — Node/Edge CRUD
- **runs: OrchestratorRunStore** — Run/NodeRun CRUD

### Key Methods

**Orchestrator CRUD:**
- `create(input)` -> create new + auto-create start node + limits validation
- `getById(id)`, `findByAlias(alias)`, `list(filter?)`, `listEnriched()`
- `update(id, patch, expectedUpdatedAt?)` -> **optimistic locking**
- `transaction<T>(fn)` -> DB transaction

**Graph Store:**
- `createNode(input)` -> label validation + UUID generation
- `getNodesByOrchestrator(id)` -> sort_order + createdAt order
- `updateNode(nodeId, patch, expectedUpdatedAt?)` -> stale-write detection
- `deleteNode(nodeId)` -> cascade delete to edges
- `createEdge(input)` -> duplicate detection + return condition validation
- `getFullOrchestrator(id)` -> { orchestrator, nodes, edges }
- `validateDAG()` -> wrapper for dag.ts validation

**Run Store:**
- `createRun(input)` -> status='running', triggered_at=now
- `getRunsByOrchestrator(id, limit)`, `getRunningRuns()`
- `updateRun(runId, patch)` -> status lifecycle
- `incrementRunCount(orchestratorId, now)` -> scheduler recording
- `createNodeRun(input)` -> status='pending'|'running'|'waiting'
- `getNodeRunByJobId(jobId)` -> reverse lookup of node on job completion

**Agent Store** (`src/store/agent-store.ts`):
- `create(input)` -> insert with UUID, validate name uniqueness
- `getById(id)` -> single agent lookup
- `list()` -> all agents, ordered by name
- `listByTool(tool)` -> agents filtered by tool
- `update(id, patch, expectedUpdatedAt?)` -> optimistic locking
- `delete(id)` -> hard delete; ON DELETE SET NULL cascades to nodes
- `getUsage(id)` -> count of orchestrator nodes referencing this agent

**Snapshot:**
- `saveValidatedSnapshot(db, graphStore, orchestratorId)` -> persist nodes+edges JSON to validated_snapshot
- `revertToValidatedSnapshot(db, orchestratorId)` -> validate snapshot against current node limits, then restore from snapshot

---

## 10. Data Mapping (`shared/mappers/`)

- **mapOrchestrator(row)** — OrchestratorRow -> Orchestrator
- **mapNode(row)** — NodeRow -> OrchestratorNode (backward compatible: gate_condition migration, system return value auto-injection)
- **mapEdge(row)** — EdgeRow -> OrchestratorEdge
- **mapRun(row)** — RunRow -> OrchestrationRun
- **mapNodeRun(row)** — NodeRunRow -> OrchestrationNodeRun

**Helpers:** `str()`, `num()`, `parseJson<T>()`, `boolFromDb()`

---

## 11. Key Constants & Limits

- **maxParallelism** — Default: 3 — Source: OrchestratorStore.create()
- **timeoutSec** — Default: `null` — Source: OrchestratorStore.create()
- **maxTotalNodes** — Default: 50 — Source: OrchestratorStore.create()
- **maxRunWorkdirs** — Default: 20 — Source: OrchestratorStore.create()
- **MAX_REGEX_PATTERN_LENGTH** — 200 — Source: dag.ts
- **MAX_RETURN_VALUE_LENGTH** — 500 (parser, return-value.ts) / 100 (API validation for returnConditions values, orchestrator-api.ts)
- **MAX_OUTPUT_PER_NODE** — 8,000 chars — Source: engine-summary.ts
- **MAX_RUN_REPORT_CHARS** — 80,000 chars — Source: engine-summary.ts
- **SUMMARY_TIMEOUT_SEC** — 180s — Source: engine-summary.ts

### Limits Validation (`src/orchestrator/orchestrator-limits.ts`)

Centralizes orchestrator limit enforcement:

- **`ORCHESTRATOR_LIMIT_RANGES`** — Defines valid ranges:
  - `maxParallelism`: 1–20
  - `maxTotalNodes`: 1–200
  - `timeoutSec`: 1–86400 seconds when set
  - Node `maxRetries`: 0–10
  - Node `timeoutSec`: 1–21600 seconds when set
  - Triggered `waitTimeoutSec`: 1–86400 seconds
- **`validateOrchestratorLimits(input)`** — Returns error message string or `null`
- **`assertValidOrchestratorLimits(input)`** — Throws on validation failure

Used by OrchestratorStore on create/update, by validated-snapshot revert before destructive replacement, and by the Dashboard editor for client-side validation.

### Archive & Pruning (`src/store/orchestrator-archive.ts`)

`archiveAndPruneOutputFull(db, dataDir, retentionDays, maxRows)` manages DB bloat from orchestration output logs:

- **Trigger**: Rows with `output_full IS NOT NULL` older than `retentionDays` (default: 7) or exceeding `maxRows` (default: 1000)
- **Archive path**: `<dataDir>/job-logs/<run_id>/<node_id>_<job_id>.log`
- **Safety**: Validates all path components are UUIDs to prevent path traversal
- **Operation**: Writes log file to disk → NULLifies `output_full` in DB row
- **Returns**: `{ archivedCount, errors }` — partial failure tolerant (continues on individual row errors)

---

## 12. File Structure

```
src/orchestrator/
├── types.ts                # Domain types (Orchestrator, Node, Edge, Run, NodeRun)
├── types-db.ts             # DB row types (snake_case)
├── types-patch.ts          # Partial update types
├── dag.ts                  # DAG validation + topological sort + condition evaluation
├── dag.test.ts
├── engine.ts               # OrchestratorEngine class (lifecycle, advance loop)
├── engine-executor.ts      # Node execution (task/triggered/gate/end)
├── engine-notify.ts        # Slack notification (node + completion)
├── engine-summary.ts       # Summary job + report generation
├── engine-summary.test.ts
├── engine-utils.ts         # Workdir resolution, duration format, constants
├── engine-utils.test.ts
├── engine-coverage.test.ts # Edge-case coverage tests
├── engine.test.ts
├── return-value.ts         # Return value parsing + template generation
└── orchestrator-limits.ts  # Limits / constants

src/store/
├── orchestrator.ts         # OrchestratorStore (facade)
├── orchestrator-graph.ts   # Node/Edge CRUD
├── orchestrator-run.ts     # Run/NodeRun CRUD
├── orchestrator-snapshot.ts # Validated snapshot save/revert
├── orchestrator-archive.ts # Archive + prune
├── agent-store.ts          # AgentStore CRUD
└── orchestrator.test.ts

src/server/routes/
├── agent-api.ts            # Agent REST API (CRUD + usage)
└── ...                     # (existing orchestrator routes)

src/shared/mappers/
├── orchestrator.ts         # Orchestrator/Node/Edge mappers (+ agentId)
└── orchestrator-run.ts     # Run/NodeRun mappers
```

---

## 13. Edge Cases & Risks

- **runningCount decrement leak** — Mitigation: decrement first in handleNodeJobComplete (before node lookup failure)
- **Exponential skip computation in diamond DAGs** — Mitigation: memoized skipCache in resolveRunnableNodes
- **ReDoS (regex edge conditions)** — Mitigation: MAX_REGEX_PATTERN_LENGTH=200; compile error returns false
- **Crash during triggered node wait** — Mitigation: recoverTriggeredNodeWait recalculates remaining time
- **Orchestrator deletion during run** — Mitigation: startRun pre-checks status!='deleted'
- **Optimistic lock conflict** — Mitigation: stale-write error when expectedUpdatedAt mismatch
- **Agent deletion while nodes reference it** — Mitigation: ON DELETE SET NULL; engine treats null agentId as no-agent (graceful fallback to node-only config)
- **Agent MCP narrowing chain** — Mitigation: each level can only narrow via set intersection; null = inherit parent level; simple and auditable
