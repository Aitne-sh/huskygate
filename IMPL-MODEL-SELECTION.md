# Implementation Plan: Per-Task Model Selection

**Version**: 1.0
**Created**: 2026-03-23
**Status**: Draft

## Overview

Add a `model: string | null` field to all task types, AI Agents, and orchestrator nodes, allowing users to specify which AI model to use per-task/per-node. When `null` (default), the system falls back to the existing env var / CLI default cascade.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Model ID format | Free-form string | No hardcoded model list; new models work immediately |
| Validation | Length + type only | CLI validates model names at execution time |
| Dashboard warning | Cross-tool mismatch | Warn (not block) when model name prefix doesn't match tool |
| Default behavior | `null` → no `--model` flag | Identical to current behavior; zero-risk migration |

### Resolution Cascade

```
task/node.model  →  agent.model  →  env var (CLAUDE_MODEL etc.)  →  CLI default
     ↓                  ↓                    ↓                          ↓
 toolStateOverrides  resolveTaskAgent    resolveModel()             no --model flag
 に注入               でマージ            既存ロジック
```

### Cross-Tool Model Warning Rules (Dashboard)

| Tool | Warning prefix patterns | Example warnings |
|------|------------------------|------------------|
| claude | Warn if starts with `gpt`, `o1`, `o3`, `gemini` | "claude-opus-4-6" → OK, "gpt-5.4" → warn |
| codex | Warn if starts with `claude`, `gemini` | "o3" → OK, "claude-sonnet-4-6" → warn |
| gemini | Warn if starts with `claude`, `gpt`, `o1`, `o3` | "gemini-2.5-pro" → OK, "claude-opus-4-6" → warn |

Warning text: `"⚠ This model name looks like it belongs to a different tool. You can still save it."`

---

## Phase 1: Core Types & DB Migration

### Scope
Add `model` field to all type definitions, DB schema, Row types, and mappers.

### Checklist

- [ ] **1.1** `src/config/types.ts` — Add `MODEL_MAX_LENGTH = 100` constant
- [ ] **1.2** `src/shared/field-limits.ts` — Add model field limit (if field limits are centralized here)
- [ ] **1.3** `src/shared/normalize-model.ts` — Create shared normalizer:
  ```typescript
  /** Normalize model input: trim, empty→null, enforce max length. */
  export function normalizeModel(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.toLowerCase() === 'default') return null;
    if (trimmed.length > 100) throw new Error('model must be ≤ 100 characters');
    return trimmed;
  }
  ```
- [ ] **1.4** Domain type interfaces — Add `model: string | null` to:
  - [ ] `OndemandTask` + `CreateOndemandTask` (`src/store/ondemand-task.ts`)
  - [ ] `ScheduledTask` + `CreateScheduledTask` (`src/store/schedule.ts`)
  - [ ] `TriggeredTask` + `CreateTriggeredTask` (`src/event/types.ts`)
  - [ ] `OrchestratorNode` (`src/orchestrator/types.ts`)
  - [ ] `AiAgent` + `CreateAiAgent` (`src/orchestrator/types.ts`)
- [ ] **1.5** DB Row types — Add `model: string | null` to:
  - [ ] `TriggeredTaskRow` (`src/store/triggered-task.ts`)
  - [ ] `AiAgentRow` (`src/orchestrator/types-db.ts`)
  - [ ] `NodeRow` (`src/orchestrator/types-db.ts`)
  - [ ] (ondemand/schedule rows are inline in their store files)
- [ ] **1.6** DB Schema migration — Add to `src/store/schema.ts` or create migration:
  ```sql
  ALTER TABLE ondemand_tasks ADD COLUMN model TEXT DEFAULT NULL;
  ALTER TABLE scheduled_tasks ADD COLUMN model TEXT DEFAULT NULL;
  ALTER TABLE triggered_tasks ADD COLUMN model TEXT DEFAULT NULL;
  ALTER TABLE orchestrator_nodes ADD COLUMN model TEXT DEFAULT NULL;
  ALTER TABLE ai_agents ADD COLUMN model TEXT DEFAULT NULL;
  ```
  Note: SQLite `ALTER TABLE ADD COLUMN` is safe — no table lock, existing rows get NULL.
- [ ] **1.7** Mappers — Add `model: str(row.model)` to:
  - [ ] `mapOndemandTask()` (`src/shared/mappers/ondemand-task.ts`)
  - [ ] `mapScheduledTask()` (`src/shared/mappers/scheduled-task.ts`)
  - [ ] `mapNode()` (`src/shared/mappers/orchestrator.ts`)
  - [ ] `mapAiAgent()` (`src/shared/mappers/orchestrator.ts`)
  - [ ] `mapTask()` in `src/store/triggered-task.ts` (inline mapper)

### Verification
```bash
npm run build          # Type check passes
npm run test           # Existing tests pass (model defaults to null)
```

---

## Phase 2: Store CRUD

### Scope
Wire `model` through create/update operations in all stores.

### Checklist

- [ ] **2.1** `src/store/ondemand-task.ts`
  - [ ] `create()` — INSERT に `model` カラム追加
  - [ ] `update()` — `buildDynamicUpdate` の fieldMap に `model: 'model'` 追加
  - [ ] transform: `TRIM_OR_NULL_TRANSFORM` を model に適用
- [ ] **2.2** `src/store/schedule.ts`
  - [ ] `create()` — INSERT に `model` カラム追加
  - [ ] `update()` — fieldMap に `model: 'model'` 追加
- [ ] **2.3** `src/store/triggered-task.ts`
  - [ ] `create()` — INSERT に `model` カラム追加
  - [ ] `update()` — fieldMap に `model: 'model'` 追加
- [ ] **2.4** `src/store/agent-store.ts`
  - [ ] `create()` — INSERT に `model` カラム追加
  - [ ] `update()` — fieldMap に `model: 'model'` 追加
- [ ] **2.5** `src/store/orchestrator-graph.ts`
  - [ ] `createNode()` — INSERT に `model` カラム追加
  - [ ] `updateNode()` — fieldMap に `model: 'model'` 追加

### Verification
```bash
npm run test -- --grep "store"  # Store unit tests pass
```

---

## Phase 3: API Routes (Validation & CRUD)

### Scope
Accept and validate `model` in all task/agent/node API endpoints.

### Checklist

- [ ] **3.1** `src/server/routes/ondemand-api.ts`
  - [ ] POST create: `normalizeModel(body.model)` → pass to `store.create()`
  - [ ] PATCH update: `normalizeModel(body.model)` → pass to `store.update()`
  - [ ] GET response: include `model` in JSON output (already via mapper)
- [ ] **3.2** `src/server/routes/schedule-api.ts`
  - [ ] POST create: `normalizeModel(body.model)` → pass to `store.create()`
  - [ ] PATCH update: `normalizeModel(body.model)` → pass to `store.update()`
  - [ ] GET response: include `model`
- [ ] **3.3** `src/server/routes/webhook-triggered-tasks.ts`
  - [ ] POST create: `normalizeModel(body.model)` → pass to `store.create()`
  - [ ] PATCH update: `normalizeModel(body.model)` → pass to `store.update()`
  - [ ] GET response: include `model`
- [ ] **3.4** `src/server/routes/orchestrator-nodes.ts`
  - [ ] POST create node: `normalizeModel(body.model)` → pass to `store.createNode()`
  - [ ] PATCH update node: `normalizeModel(body.model)` → pass to `store.updateNode()`
  - [ ] GET response: include `model`
- [ ] **3.5** Agent API route (wherever agent CRUD is handled)
  - [ ] POST create: `normalizeModel(body.model)` → pass to `store.create()`
  - [ ] PATCH update: `normalizeModel(body.model)` → pass to `store.update()`
  - [ ] GET response: include `model`
- [ ] **3.6** Orchestrator validated snapshot — ensure `model` is included in DAG snapshot serialization

### Verification
```bash
npm run test -- --grep "api"
# Manual: curl POST with model field, verify persistence
```

---

## Phase 4: Execution — Model Injection into Jobs

### Scope
When a task/node has `model` set, inject it into `toolStateOverrides.model` so `resolveModel()` picks it up via `session.toolState.model`.

### Key Insight
All executors currently set `toolState: {}`. The `job-executor.ts` already merges `toolStateOverrides` into session toolState:
```typescript
// src/slack/job-executor.ts:86-89
let effectiveToolState: ToolState = {
  ...session.toolState,
  ...(job.toolStateOverrides ?? {}),
};
```
So we only need to set `toolStateOverrides: { model: task.model }` in each job creation site.

### Checklist

- [ ] **4.1** `src/shared/task-agent-resolver.ts` — Add `model` to resolution:
  ```typescript
  export interface ResolvedTaskAgent {
    tool: ToolName;
    model: string | null;     // ← NEW
    allowMcp: boolean;
    enabledSkills: SkillRef[] | null;
    enabledMcpServerIds: string[] | null;
    instructionFile: string | null;
  }
  ```
  Resolution: `agent.model ?? taskDefaults.model ?? null`

- [ ] **4.2** `src/server/routes/ondemand-api.ts` (execute handler, ~line 479)
  - Add `toolStateOverrides: resolvedModel ? { model: resolvedModel } : undefined`
  - Where `resolvedModel = task.model ?? resolved.model` (resolved = from resolveTaskAgent)
  - Pattern:
    ```typescript
    const resolvedModel = task.model ?? resolved.model;
    // ...in job object:
    toolState: {},
    ...(resolvedModel ? { toolStateOverrides: { model: resolvedModel } } : {}),
    ```

- [ ] **4.3** `src/server/routes/schedule-api.ts` (execute handler, ~line 607)
  - Same pattern as 4.2

- [ ] **4.4** `src/schedule/scheduler.ts` (~line 227)
  - Same pattern as 4.2

- [ ] **4.5** `src/server/routes/webhook-triggered-tasks.ts` (execute handler, ~line 556)
  - Same pattern as 4.2

- [ ] **4.6** `src/event/triggered-task-executor.ts` (~line 120)
  - Same pattern as 4.2

- [ ] **4.7** `src/orchestrator/engine-executor.ts` — Per-node model resolution:
  ```typescript
  function resolveNodeModel(
    node: OrchestratorNode,
    agent: AiAgent | null,
  ): string | null {
    return node.model ?? agent?.model ?? null;
  }
  ```
  Apply at all job creation sites in this file (~lines 354, 605, 733):
  ```typescript
  const nodeModel = resolveNodeModel(node, agent);
  // ...in job object:
  toolState: {},
  ...(nodeModel ? { toolStateOverrides: { model: nodeModel } } : {}),
  ```
  **Affected functions:**
  - [ ] `executeTaskNode()` (~line 354)
  - [ ] `executeTriggeredNode()` (~line 605)
  - [ ] `executeEventNode()` (~line 733)

### Verification
```bash
npm run test
# Integration: create task with model="claude-sonnet-4-6", execute, check --model arg in driver
```

---

## Phase 5: Dashboard UI

### Scope
Add model input field to all task/agent/node forms with cross-tool mismatch warning.

### Cross-Tool Warning Logic
```javascript
var MODEL_PREFIXES = {
  claude: ['claude'],
  codex: ['gpt', 'o1', 'o3', 'o4', 'codex'],
  gemini: ['gemini']
};

function checkModelToolMismatch(tool, model) {
  if (!model || !model.trim()) return null; // empty → no warning
  var lower = model.trim().toLowerCase();
  // Check if model starts with any OTHER tool's prefix
  var otherTools = Object.keys(MODEL_PREFIXES).filter(function(t) { return t !== tool; });
  for (var i = 0; i < otherTools.length; i++) {
    var prefixes = MODEL_PREFIXES[otherTools[i]];
    for (var j = 0; j < prefixes.length; j++) {
      if (lower.startsWith(prefixes[j])) {
        return 'This model name looks like it belongs to ' + otherTools[i] +
               '. You can still save it.';
      }
    }
  }
  return null; // no mismatch
}
```

### Placeholder Examples per Tool
```javascript
var MODEL_PLACEHOLDERS = {
  claude: 'e.g. claude-opus-4-6, claude-sonnet-4-6',
  codex: 'e.g. o3, gpt-4.1',
  gemini: 'e.g. gemini-2.5-pro, gemini-2.5-flash'
};
```

### Checklist

- [ ] **5.1** `src/dashboard/scripts/helpers.ts` — Add shared helper functions:
  - [ ] `checkModelToolMismatch(tool, model)` → warning string | null
  - [ ] `modelFieldHtml(tool, currentModel)` → HTML for model input + warning area
  - [ ] `MODEL_PLACEHOLDERS` constant

- [ ] **5.2** `src/dashboard/scripts/ondemand-tasks.ts`
  - [ ] Add model text input to task create/edit form
  - [ ] Wire `onchange` / `oninput` to check mismatch and show/hide warning
  - [ ] Include model in API POST/PATCH payload
  - [ ] Display current model in task detail view

- [ ] **5.3** `src/dashboard/scripts/schedule-tasks.ts`
  - [ ] Add model text input to schedule create/edit form
  - [ ] Wire mismatch warning
  - [ ] Include model in API POST/PATCH payload
  - [ ] Display current model in task detail view

- [ ] **5.4** `src/dashboard/scripts/triggered-tasks.ts`
  - [ ] Add model text input to triggered task create/edit form
  - [ ] Wire mismatch warning
  - [ ] Include model in API POST/PATCH payload

- [ ] **5.5** `src/dashboard/scripts/agents.ts`
  - [ ] Add model text input to agent create/edit form
  - [ ] Wire mismatch warning (using agent's tool)
  - [ ] Include model in API POST/PATCH payload
  - [ ] Display current model in agent list/detail

- [ ] **5.6** `src/dashboard/scripts/orchestrator-node-panel.ts`
  - [ ] Add model text input to node panel (task/triggered node types only)
  - [ ] Hide model field for gate/end node types
  - [ ] Wire mismatch warning (using node's effective tool)
  - [ ] Update placeholder when tool selection changes
  - [ ] Include model in API POST/PATCH payload
  - [ ] When agent is selected: show agent's model as placeholder hint if set

- [ ] **5.7** CSS styling for warning message:
  ```css
  .model-mismatch-warning {
    color: #b45309;
    font-size: 0.85em;
    margin-top: 4px;
    display: none; /* shown via JS when mismatch detected */
  }
  ```

### Verification
```
Manual testing:
- Create on-demand task with model → verify saved
- Edit schedule task, change model → verify updated
- Create agent with model → verify saved
- Add orchestrator node, set model → verify saved
- Set tool=gemini, model="claude-opus-4-6" → verify warning shows
- Set tool=gemini, model="gemini-2.5-pro" → verify no warning
- Clear model field → verify null saved (no --model flag on execution)
```

---

## Phase 6: Orchestrator Snapshot & DAG Validation

### Scope
Ensure `model` is preserved in validated DAG snapshots and correctly applied during re-runs.

### Checklist

- [ ] **6.1** Snapshot serialization — Verify `model` is included when saving validated snapshot
  - Check `src/store/orchestrator-store.ts` `saveValidatedSnapshot()` — likely serializes full node objects, so model should be included automatically via mapper
- [ ] **6.2** Snapshot deserialization — Verify `model` round-trips correctly when loading snapshot for execution
- [ ] **6.3** Rerun support — Ensure rerun from a specific node uses the node's `model` setting
- [ ] **6.4** Agent model override in orchestrator — When node has `agentId` and agent has `model`:
  - Node `model` takes precedence over agent `model`
  - If node `model` is null, agent `model` is used
  - If both null, env var / CLI default

### Verification
```bash
npm run test -- --grep "orchestrator"
# Manual: validate DAG, check snapshot includes model, execute, verify --model arg
```

---

## Phase 7: Tests

### Scope
Add unit tests for new model functionality.

### Checklist

- [ ] **7.1** `src/shared/normalize-model.test.ts` — New file:
  - [ ] null/undefined/empty → null
  - [ ] "default" → null
  - [ ] whitespace trimming
  - [ ] max length enforcement
  - [ ] valid model passthrough

- [ ] **7.2** Store tests — Add model to existing CRUD tests:
  - [ ] `ondemand-task` store: create with model, update model, null model
  - [ ] `schedule` store: create with model, update model
  - [ ] `triggered-task` store: create with model, update model
  - [ ] `agent-store`: create with model, update model
  - [ ] `orchestrator-graph`: createNode with model, updateNode model

- [ ] **7.3** API route tests — Add model to existing API tests:
  - [ ] POST with valid model → 200, model persisted
  - [ ] POST with model="" → 200, model=null
  - [ ] POST without model → 200, model=null (backward compat)
  - [ ] PATCH model to new value → 200, model updated
  - [ ] PATCH model to null → 200, model cleared

- [ ] **7.4** Execution tests — Verify model injection:
  - [ ] `job-executor` test: task.model → toolStateOverrides.model
  - [ ] `engine-executor` test: node.model → toolStateOverrides.model
  - [ ] `engine-executor` test: node.model=null + agent.model="x" → toolStateOverrides.model="x"
  - [ ] `engine-executor` test: node.model="y" + agent.model="x" → toolStateOverrides.model="y" (node wins)

- [ ] **7.5** `resolveTaskAgent` test — Add model resolution:
  - [ ] agent.model takes effect when task.model is null
  - [ ] task.model takes precedence when both set

- [ ] **7.6** Dashboard cross-tool warning tests (if JS test framework exists):
  - [ ] checkModelToolMismatch('gemini', 'claude-opus-4-6') → warning string
  - [ ] checkModelToolMismatch('gemini', 'gemini-2.5-pro') → null
  - [ ] checkModelToolMismatch('claude', '') → null

### Verification
```bash
npm run test           # All tests pass
npm run test:coverage  # Coverage maintained
```

---

## File Impact Summary

### New Files
| File | Purpose |
|------|---------|
| `src/shared/normalize-model.ts` | Shared model string normalizer |
| `src/shared/normalize-model.test.ts` | Unit tests for normalizer |

### Modified Files

| File | Changes |
|------|---------|
| **Types** | |
| `src/store/ondemand-task.ts` | `OndemandTask.model`, `CreateOndemandTask.model`, create/update CRUD |
| `src/store/schedule.ts` | `ScheduledTask.model`, `CreateScheduledTask.model`, create/update CRUD |
| `src/event/types.ts` | `TriggeredTask.model`, `CreateTriggeredTask.model` |
| `src/store/triggered-task.ts` | Row type + mapper + create/update CRUD |
| `src/orchestrator/types.ts` | `OrchestratorNode.model`, `AiAgent.model`, `CreateAiAgent.model` |
| `src/orchestrator/types-db.ts` | `NodeRow.model`, `AiAgentRow.model` |
| **DB** | |
| `src/store/schema.ts` | 5x ALTER TABLE ADD COLUMN (migration) |
| **Mappers** | |
| `src/shared/mappers/ondemand-task.ts` | Add `model: str(row.model)` |
| `src/shared/mappers/scheduled-task.ts` | Add `model: str(row.model)` |
| `src/shared/mappers/orchestrator.ts` | Add `model` to `mapNode()` and `mapAiAgent()` |
| **Store CRUD** | |
| `src/store/agent-store.ts` | create/update with model |
| `src/store/orchestrator-graph.ts` | createNode/updateNode with model |
| **API Routes** | |
| `src/server/routes/ondemand-api.ts` | Accept model + inject into job |
| `src/server/routes/schedule-api.ts` | Accept model + inject into job |
| `src/server/routes/webhook-triggered-tasks.ts` | Accept model + inject into job |
| `src/server/routes/orchestrator-nodes.ts` | Accept model for node CRUD |
| Agent API route | Accept model for agent CRUD |
| **Executors** | |
| `src/shared/task-agent-resolver.ts` | Add `model` to `ResolvedTaskAgent` |
| `src/schedule/scheduler.ts` | Inject model into job.toolStateOverrides |
| `src/event/triggered-task-executor.ts` | Inject model into job.toolStateOverrides |
| `src/orchestrator/engine-executor.ts` | `resolveNodeModel()` + inject into 3 job creation sites |
| **Dashboard** | |
| `src/dashboard/scripts/helpers.ts` | `checkModelToolMismatch()`, `modelFieldHtml()`, `MODEL_PLACEHOLDERS` |
| `src/dashboard/scripts/ondemand-tasks.ts` | Model field in form |
| `src/dashboard/scripts/schedule-tasks.ts` | Model field in form |
| `src/dashboard/scripts/triggered-tasks.ts` | Model field in form |
| `src/dashboard/scripts/agents.ts` | Model field in form |
| `src/dashboard/scripts/orchestrator-node-panel.ts` | Model field in node panel |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Invalid model name → CLI error | Medium | Low | CLI exits non-zero → existing error handling catches it; dashboard warning helps |
| SQLite migration fails | Very Low | High | `ALTER TABLE ADD COLUMN DEFAULT NULL` is the safest SQLite operation |
| Orchestrator snapshot missing model | Low | Medium | Phase 6 explicitly verifies round-trip |
| Backward compatibility break | Very Low | High | `model: null` = current behavior; no --model flag sent |
| Dashboard JS error in warning logic | Low | Low | Warning is cosmetic only; doesn't block save |

---

## Progress Tracking

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| Phase 1: Core Types & DB | ✅ Done | 2026-03-23 | 2026-03-23 | Types, schema, migration, mappers |
| Phase 2: Store CRUD | ✅ Done | 2026-03-23 | 2026-03-23 | All 5 stores updated |
| Phase 3: API Routes | ✅ Done | 2026-03-23 | 2026-03-23 | All 5 API route files + normalizeModel validation |
| Phase 4: Execution | ✅ Done | 2026-03-23 | 2026-03-23 | resolveTaskAgent + 5 standalone + 3 orchestrator sites |
| Phase 5: Dashboard UI | ✅ Done | 2026-03-23 | 2026-03-23 | All forms + cross-tool warning + placeholders |
| Phase 6: Snapshot & DAG | ✅ Done | 2026-03-23 | 2026-03-23 | Snapshot INSERT + revert updated |
| Phase 7: Tests | ✅ Done | 2026-03-23 | 2026-03-23 | normalizeModel tests + test DDL fixes (433 tests pass) |
