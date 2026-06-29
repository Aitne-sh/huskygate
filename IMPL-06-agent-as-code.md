# IMPL-06: Agent-as-Code (Declarative Pipeline Definition)

## Meta

- **Feature**: Agent-as-Code — YAML-based declarative pipeline/orchestrator definition
- **Priority**: P1
- **Status**: Draft
- **Created**: 2026-03-23
- **Depends on**: IMPL-01 (budget fields in YAML), IMPL-02 (checkpoint config in YAML)

---

## 1. Goal & Constraints

**Goal**: DAG オーケストレーション、スキル構成、コスト制限、セキュリティポリシーをすべて YAML で宣言的に定義し、Git で管理・レビュー・CLI バリデーション可能にする。

**Why (市場リサーチ根拠)**:
- 市場全体で「**Git for agents が存在しない**」とアナリストが指摘
- ADL (Agent Definition Language) が 2026年2月にリリースされたが、まだ初期段階でフレームワーク非依存
- LangChain/CrewAI はコードベースで定義 → 非開発者が扱えない
- **YAML による宣言的エージェント定義 + Git ワークフロー統合**は事実上存在しない
- HuskyGate の既存 orchestrators テーブルは YAML 構造と自然にマッピング可能
- Kubernetes マニフェスト→ Infrastructure-as-Code の成功パターンを再現

**Constraints**:
- 既存の DB スキーマ（orchestrators, orchestrator_nodes, orchestrator_edges）との双方向同期が必要
- YAML スキーマのバリデーションは Zod で行う（既存パターン踏襲）
- CLI は既存の `src/cli.ts` を拡張（新規バイナリ不要）
- Import/Export の双方向性 — DB → YAML (export) と YAML → DB (import) の両方が必要

---

## 2. Architecture

### 2.1 YAML Schema Overview

```yaml
# huskygate.pipeline.yaml
apiVersion: huskygate/v1
kind: Pipeline
metadata:
  name: nightly-security-audit
  alias: security-audit
  description: "Automated security audit pipeline"
  version: 1.0.0

spec:
  # ── Trigger Configuration ──
  trigger:
    mode: scheduled                # ondemand | scheduled | webhook
    schedule:
      type: cron
      cron: "0 2 * * *"
      timezone: Asia/Tokyo
    # webhook:                     # (for trigger.mode: webhook)
    #   endpoint: security-webhook
    #   filter:
    #     event_name: push
    #     branch: main

  # ── Execution Settings ──
  settings:
    maxParallelism: 3
    maxTotalNodes: 50
    errorPolicy: fail_fast         # continue | fail_fast
    timeoutSec: 3600
    notify:
      channel: "#security-alerts"
    summary:
      enabled: true
      tool: claude

  # ── Budget (requires IMPL-01) ──
  budget:
    maxTokens: 200000
    maxCostUsd: 10.00
    alertThresholds: [0.5, 0.8, 0.95]
    onExceed: pause_and_notify

  # ── Checkpoint (requires IMPL-02) ──
  checkpoint:
    enabled: true
    rollbackOnFailure: false       # auto-rollback when any node fails

  # ── Security Policy ──
  security:
    defaultMode: readonly
    mcpAllowlist: [filesystem, github]
    requireApproval: [write, delete]

  # ── Agent Definitions (inline or reference) ──
  agents:
    security-scanner:
      tool: claude
      model: opus
      systemInstruction: |
        You are a security scanner. Analyze code for OWASP Top 10 vulnerabilities.
      skills: [security-scanner]
      mcpServers: [filesystem]

    vulnerability-analyst:
      tool: gemini
      skills: [perplexity-research]
      mcpServers: [filesystem]

    report-writer:
      tool: claude
      model: sonnet
      skills: []

  # ── DAG Nodes ──
  nodes:
    - id: scan
      label: "Security Scan"
      agent: security-scanner       # Reference to agents section
      mode: readonly
      prompt: |
        Scan all TypeScript files in src/ for security vulnerabilities.
        Focus on: SQL injection, XSS, command injection, path traversal.
      returnConditions:
        - pattern: "CRITICAL:\\s*(\\d+)"
          key: critical_count
        - pattern: "HIGH:\\s*(\\d+)"
          key: high_count
      budgetWeight: 0.4
      timeout: 600

    - id: deep-research
      label: "Vulnerability Research"
      agent: vulnerability-analyst
      mode: readonly
      prompt: |
        Research the vulnerabilities found in the scan results.
        Provide remediation recommendations for each.
      dependsOn: [scan]
      budgetWeight: 0.3

    - id: gate-critical
      label: "Critical Gate"
      type: gate
      dependsOn: [scan]
      condition:
        operator: gt
        source: scan
        key: critical_count
        value: "0"
      # If gate passes (critical > 0), proceed to emergency-fix
      # If gate fails (critical == 0), proceed to report

    - id: emergency-fix
      label: "Emergency Fix"
      agent: security-scanner
      mode: write
      prompt: |
        Apply emergency fixes for all CRITICAL vulnerabilities found.
      dependsOn: [gate-critical]
      budgetWeight: 0.2
      checkpoint:
        enabled: true              # Override: always checkpoint before write

    - id: report
      label: "Generate Report"
      agent: report-writer
      mode: readonly
      prompt: |
        Generate a security audit report summarizing all findings
        and remediation actions taken.
      dependsOn: [deep-research, emergency-fix]
      budgetWeight: 0.1

  # ── Edges (auto-generated from dependsOn, but can be explicit) ──
  # edges:
  #   - from: scan
  #     to: deep-research
  #   - from: gate-critical
  #     to: emergency-fix
  #     condition:
  #       value: "true"
  #       operator: eq
```

### 2.2 YAML ↔ DB Mapping

```
YAML                          DB Table                      Column
─────────────────────────────────────────────────────────────────────
metadata.name             →   orchestrators.name
metadata.alias            →   orchestrators.alias
metadata.description      →   orchestrators.description
spec.trigger.mode         →   orchestrators.trigger_mode
spec.trigger.schedule.*   →   orchestrators.schedule_type/cron_expr/timezone
spec.settings.*           →   orchestrators.max_parallelism/error_policy/...
spec.budget.*             →   budget_policies (IMPL-01)
spec.agents.*             →   ai_agents + inline overrides
nodes[].id                →   orchestrator_nodes.id (or generated)
nodes[].dependsOn         →   orchestrator_edges (auto-generated)
nodes[].agent             →   orchestrator_nodes.agent_id (FK)
nodes[].mode              →   orchestrator_nodes.mode
nodes[].prompt            →   orchestrator_nodes.prompt
nodes[].returnConditions  →   orchestrator_nodes.return_conditions (JSON)
nodes[].type: gate        →   orchestrator_nodes.node_type = 'gate'
nodes[].condition         →   orchestrator_nodes.gate_condition (JSON)
edges[]                   →   orchestrator_edges (explicit)
```

### 2.3 System Flow

```
YAML file
  ↓  huskygate pipeline validate
PipelineValidator (Zod schema + DAG validation)
  ↓  huskygate pipeline apply
PipelineImporter
  ├─ Resolve agent references → ai_agents table
  ├─ Create/update orchestrator → orchestrators table
  ├─ Create/update nodes → orchestrator_nodes table
  ├─ Generate edges from dependsOn → orchestrator_edges table
  └─ Create budget policy → budget_policies table (IMPL-01)
  ↓
DB (ready for execution via existing orchestrator engine)
  ↓  huskygate pipeline export <name>
PipelineExporter
  └─ DB → YAML (round-trip safe)
```

---

## 3. Detailed Design

### 3.1 Zod Schema (`src/pipeline/schema.ts` — NEW)

```typescript
import { z } from 'zod';

const TriggerScheduleSchema = z.object({
  type: z.enum(['once', 'cron', 'interval']),
  runAt: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().default('default'),
});

const TriggerWebhookSchema = z.object({
  endpoint: z.string(),
  filter: z.record(z.string()).optional(),
});

const TriggerSchema = z.object({
  mode: z.enum(['ondemand', 'scheduled', 'webhook']),
  schedule: TriggerScheduleSchema.optional(),
  webhook: TriggerWebhookSchema.optional(),
});

const BudgetSchema = z.object({
  maxTokens: z.number().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  alertThresholds: z.array(z.number().min(0).max(1)).default([0.5, 0.8, 0.95]),
  onExceed: z.enum(['kill', 'pause_and_notify']).default('kill'),
});

const CheckpointSchema = z.object({
  enabled: z.boolean().default(true),
  rollbackOnFailure: z.boolean().default(false),
});

const AgentDefSchema = z.object({
  tool: z.enum(['claude', 'codex', 'gemini']),
  model: z.string().optional(),
  systemInstruction: z.string().optional(),
  skills: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  allowMcp: z.boolean().default(true),
});

const ReturnConditionSchema = z.object({
  pattern: z.string(),
  key: z.string(),
});

const GateConditionSchema = z.object({
  operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'matches']),
  source: z.string(),
  key: z.string(),
  value: z.string(),
  logic: z.enum(['and', 'or']).default('and'),
});

const NodeCheckpointSchema = z.object({
  enabled: z.boolean().optional(),
});

const NodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string(),
  type: z.enum(['task', 'gate', 'triggered', 'end']).default('task'),
  agent: z.string().optional(),           // Reference to agents section
  tool: z.enum(['claude', 'codex', 'gemini']).optional(), // Inline override
  mode: z.enum(['readonly', 'write']).default('readonly'),
  prompt: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  returnConditions: z.array(ReturnConditionSchema).optional(),
  condition: GateConditionSchema.optional(), // For gate nodes
  budgetWeight: z.number().min(0).max(1).optional(),
  timeout: z.number().positive().optional(),
  maxRetries: z.number().min(0).default(0),
  checkpoint: NodeCheckpointSchema.optional(),
  notify: z.object({
    enabled: z.boolean().default(false),
    channel: z.string().optional(),
    onError: z.boolean().default(true),
  }).optional(),
});

const ExplicitEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  condition: z.object({
    value: z.string(),
    operator: z.enum(['eq', 'neq', 'contains', 'matches']).default('eq'),
  }).optional(),
});

const SettingsSchema = z.object({
  maxParallelism: z.number().min(1).max(20).default(3),
  maxTotalNodes: z.number().min(1).max(100).default(50),
  errorPolicy: z.enum(['continue', 'fail_fast']).default('continue'),
  timeoutSec: z.number().positive().optional(),
  notify: z.object({
    channel: z.string(),
  }).optional(),
  summary: z.object({
    enabled: z.boolean().default(false),
    tool: z.enum(['claude', 'codex', 'gemini']).optional(),
  }).optional(),
});

const SecuritySchema = z.object({
  defaultMode: z.enum(['readonly', 'write']).default('readonly'),
  mcpAllowlist: z.array(z.string()).optional(),
  requireApproval: z.array(z.string()).optional(),
});

export const PipelineSchema = z.object({
  apiVersion: z.literal('huskygate/v1'),
  kind: z.literal('Pipeline'),
  metadata: z.object({
    name: z.string().min(1).max(100),
    alias: z.string().regex(/^[a-z0-9_-]+$/).optional(),
    description: z.string().optional(),
    version: z.string().optional(),
  }),
  spec: z.object({
    trigger: TriggerSchema,
    settings: SettingsSchema.default({}),
    budget: BudgetSchema.optional(),
    checkpoint: CheckpointSchema.optional(),
    security: SecuritySchema.optional(),
    agents: z.record(z.string(), AgentDefSchema).optional(),
    nodes: z.array(NodeSchema).min(1),
    edges: z.array(ExplicitEdgeSchema).optional(),
  }),
});

export type PipelineDefinition = z.infer<typeof PipelineSchema>;
```

### 3.2 PipelineValidator (`src/pipeline/validator.ts` — NEW)

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;       // e.g. "spec.nodes[2].dependsOn"
  message: string;
  code: string;       // e.g. "CYCLE_DETECTED", "ORPHAN_NODE"
}

class PipelineValidator {
  /** Validate a parsed YAML against schema + semantic rules. */
  validate(pipeline: unknown): ValidationResult;

  private validateSchema(pipeline: unknown): z.SafeParseReturnType<...>;
  private validateDAG(nodes: NodeDef[], edges?: EdgeDef[]): ValidationError[];
  private validateAgentReferences(nodes: NodeDef[], agents: Record<string, AgentDef>): ValidationError[];
  private validateBudgetWeights(nodes: NodeDef[]): ValidationWarning[];
  private validateGateNodes(nodes: NodeDef[]): ValidationError[];
  private detectCycles(nodes: NodeDef[], edges: EdgeDef[]): ValidationError[];
  private detectOrphans(nodes: NodeDef[], edges: EdgeDef[]): ValidationWarning[];
}
```

Semantic validations:
1. **Cycle detection**: dependsOn + explicit edges must form a DAG
2. **Agent reference resolution**: `node.agent` must exist in `spec.agents`
3. **Gate node validation**: gate nodes must have `condition` field
4. **Budget weight validation**: weights should sum to <= 1.0 (warning, not error)
5. **Node ID uniqueness**: all node IDs must be unique
6. **dependsOn resolution**: all referenced node IDs must exist
7. **Trigger consistency**: schedule fields required for scheduled mode, etc.

### 3.3 PipelineImporter (`src/pipeline/importer.ts` — NEW)

```typescript
interface ImportResult {
  orchestratorId: string;
  created: { nodes: number; edges: number; agents: number };
  updated: { nodes: number; edges: number; agents: number };
  deleted: { nodes: number; edges: number };
}

class PipelineImporter {
  constructor(private stores: StoreRegistry);

  /** Import a validated pipeline into the database. */
  async import(pipeline: PipelineDefinition, opts?: {
    dryRun?: boolean;      // Don't write, just return what would change
    force?: boolean;        // Overwrite existing orchestrator
    userId?: string;
  }): Promise<ImportResult>;

  /** Resolve agent references, creating ai_agents records as needed. */
  private resolveAgents(agents: Record<string, AgentDef>): Map<string, string>;

  /** Generate edges from node.dependsOn + explicit edges. */
  private generateEdges(nodes: NodeDef[], explicitEdges?: EdgeDef[]): EdgeRecord[];

  /** Diff existing DB state against imported pipeline. */
  private computeDiff(existing: OrchestratorSnapshot, incoming: PipelineDefinition): ImportDiff;
}
```

Import strategy:
1. Validate pipeline (Zod + semantic)
2. Check if orchestrator with same name/alias exists
   - If exists and `force=false`: error
   - If exists and `force=true`: diff and apply changes
   - If new: create
3. Create/update `ai_agents` records from `spec.agents`
4. Create/update `orchestrators` record from `metadata` + `spec.settings`
5. Create/update `orchestrator_nodes` from `spec.nodes`
6. Generate + create `orchestrator_edges` from `dependsOn` + `spec.edges`
7. Create `budget_policies` from `spec.budget` (IMPL-01)
8. Mark DAG as validated

### 3.4 PipelineExporter (`src/pipeline/exporter.ts` — NEW)

```typescript
class PipelineExporter {
  constructor(private stores: StoreRegistry);

  /** Export an orchestrator to a PipelineDefinition (YAML-ready). */
  async export(orchestratorId: string): Promise<PipelineDefinition>;

  /** Serialize PipelineDefinition to YAML string. */
  static toYaml(pipeline: PipelineDefinition): string;
}
```

Export ensures round-trip fidelity:
- All DB fields map back to YAML fields
- Agent references are resolved from `ai_agents` table
- Edges are decomposed back into `dependsOn` arrays where possible
- Explicit edges preserved where conditions exist

### 3.5 CLI Commands (`src/cli.ts` — MODIFY)

```
huskygate pipeline validate <file.yaml>      # Validate without applying
huskygate pipeline apply <file.yaml>         # Import pipeline to DB
huskygate pipeline apply <file.yaml> --dry-run  # Show what would change
huskygate pipeline apply <file.yaml> --force    # Overwrite existing
huskygate pipeline export <name|alias>       # Export to stdout (YAML)
huskygate pipeline export <name> -o file.yaml   # Export to file
huskygate pipeline list                      # List all pipelines
huskygate pipeline diff <file.yaml>          # Compare YAML vs DB state
huskygate pipeline delete <name|alias>       # Delete pipeline
huskygate pipeline run <name|alias>          # Execute pipeline
```

CLI integration in `src/cli.ts`:

```typescript
// Add subcommand group
cli.command('pipeline')
  .description('Manage declarative pipeline definitions')
  .command('validate')
    .argument('<file>', 'YAML pipeline file')
    .action(handlePipelineValidate)
  .command('apply')
    .argument('<file>', 'YAML pipeline file')
    .option('--dry-run', 'Preview changes without applying')
    .option('--force', 'Overwrite existing pipeline')
    .action(handlePipelineApply)
  .command('export')
    .argument('<name>', 'Pipeline name or alias')
    .option('-o, --output <file>', 'Output file path')
    .action(handlePipelineExport)
  // ...
```

### 3.6 Slack Commands

```
!pipeline validate <url|path>       # Validate a YAML file
!pipeline apply <url|path>          # Import pipeline from YAML
!pipeline export <name>             # Export pipeline as YAML (file upload)
!pipeline list                      # List all pipelines
!pipeline diff <url|path>           # Show diff vs current DB state
```

### 3.7 Dashboard Integration

**Pipeline Editor** (new tab or orchestrator subtab):
- YAML editor with syntax highlighting (Monaco-style or CodeMirror-lite)
- Real-time validation (call `validate` on change)
- Visual DAG preview alongside YAML
- Import/Export buttons
- Diff view (current DB state vs edited YAML)

**API endpoints** (`src/dashboard/routes/pipeline.ts`):
- `POST /api/pipeline/validate` — body: YAML string → ValidationResult
- `POST /api/pipeline/apply` — body: YAML string → ImportResult
- `GET /api/pipeline/export/:id` — → YAML string
- `POST /api/pipeline/diff` — body: YAML string → diff

---

## 4. File Impact

| Action | File | Changes |
|--------|------|---------|
| **CREATE** | `src/pipeline/schema.ts` | Zod schema for pipeline YAML |
| **CREATE** | `src/pipeline/validator.ts` | Schema + semantic validation |
| **CREATE** | `src/pipeline/importer.ts` | YAML → DB import logic |
| **CREATE** | `src/pipeline/exporter.ts` | DB → YAML export logic |
| **CREATE** | `src/pipeline/types.ts` | Pipeline-specific type definitions |
| **CREATE** | `src/pipeline/yaml-utils.ts` | YAML parse/serialize helpers |
| **CREATE** | `src/dashboard/routes/pipeline.ts` | Pipeline API endpoints |
| **CREATE** | `src/dashboard/scripts/pipeline-editor.ts` | YAML editor UI |
| **CREATE** | `examples/pipelines/code-review.yaml` | Example pipeline |
| **CREATE** | `examples/pipelines/security-audit.yaml` | Example pipeline |
| **CREATE** | `examples/pipelines/research-report.yaml` | Example pipeline |
| **MODIFY** | `src/cli.ts` | Add `pipeline` subcommand group |
| **MODIFY** | `src/slack/command-handlers.ts` | Add `!pipeline` commands |
| **MODIFY** | `src/dashboard/templates/layout.ts` | Pipeline editor tab |
| **MODIFY** | `src/orchestrator/executor.ts` | Budget/checkpoint config from pipeline |
| **MODIFY** | `package.json` | Add `yaml` dependency (e.g., `yaml` npm package) |
| **MODIFY** | `docs/design/commands.md` | Document `!pipeline` commands |
| **MODIFY** | `docs/design/orchestrator.md` | Document YAML format |

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| YAML スキーマ変更時の後方互換 | 既存ファイルが壊れる | `apiVersion: huskygate/v1` でバージョニング、マイグレーションガイド提供 |
| DB → YAML → DB のラウンドトリップでデータ損失 | 設定の不整合 | 全フィールドの双方向マッピングテスト、diff コマンドで検証 |
| 大規模 DAG の YAML が読みにくい | UX 劣化 | DAG ビジュアルプレビュー + YAML ↔ GUI 双方向編集 |
| 依存パッケージ (`yaml`) の追加 | バンドルサイズ増 | `yaml` パッケージは軽量 (~50KB)、alternatives: `js-yaml` |
| 既存オーケストレーターとの整合性 | ダッシュボード作成分が YAML に反映されない | `export` で常に最新 DB 状態を取得可能 |
| `spec.agents` のインライン定義が `ai_agents` テーブルと重複 | データ不整合 | Import 時に name-based upsert、既存 agent は更新のみ |

---

## 6. Verification

```bash
# Unit tests
npx vitest run src/pipeline/schema.test.ts
npx vitest run src/pipeline/validator.test.ts
npx vitest run src/pipeline/importer.test.ts
npx vitest run src/pipeline/exporter.test.ts

# Round-trip test
npx vitest run src/pipeline/roundtrip.test.ts  # DB → YAML → DB → YAML 一致確認

# CLI integration test
npx vitest run src/cli.pipeline.test.ts

# Lint & typecheck
npm run lint && npm run typecheck

# Manual verification
# 1. huskygate pipeline validate examples/pipelines/code-review.yaml → success
# 2. huskygate pipeline apply examples/pipelines/code-review.yaml → created
# 3. huskygate pipeline export code-review → YAML matches original
# 4. huskygate pipeline apply modified.yaml --dry-run → shows diff
# 5. huskygate pipeline apply modified.yaml --force → updated
# 6. Dashboard: Pipeline editor loads, validates in real-time
# 7. !pipeline list → shows all pipelines in Slack
```

---

## 7. Phase Checklist

### Phase 1: YAML Schema & Validation (Foundation)

- [ ] Add `yaml` package to dependencies
- [ ] Define `PipelineDefinition` type in `src/pipeline/types.ts`
- [ ] Implement Zod schema for all YAML sections (metadata, spec, trigger, settings, budget, checkpoint, security, agents, nodes, edges)
- [ ] Implement `PipelineValidator.validateSchema()` — Zod parse
- [ ] Implement `PipelineValidator.detectCycles()` — topological sort
- [ ] Implement `PipelineValidator.validateAgentReferences()` — node.agent exists in agents
- [ ] Implement `PipelineValidator.validateGateNodes()` — gate has condition
- [ ] Implement `PipelineValidator.validateBudgetWeights()` — sum <= 1.0 warning
- [ ] Implement `PipelineValidator.detectOrphans()` — unreachable nodes warning
- [ ] Write comprehensive schema validation tests (valid + invalid cases)
- [ ] Write semantic validation tests (cycles, orphans, missing refs)

### Phase 2: YAML ↔ DB Mapping

- [ ] Implement YAML field → DB column mapping for `orchestrators`
- [ ] Implement YAML field → DB column mapping for `orchestrator_nodes`
- [ ] Implement `dependsOn` → `orchestrator_edges` auto-generation
- [ ] Implement explicit `edges` → `orchestrator_edges` mapping
- [ ] Implement `spec.agents` → `ai_agents` mapping (name-based upsert)
- [ ] Implement `spec.trigger` → `orchestrators.trigger_mode/schedule_type/cron_expr`
- [ ] Implement `spec.budget` → `budget_policies` mapping (IMPL-01)
- [ ] Write mapping unit tests (each field direction)

### Phase 3: Importer

- [ ] Implement `PipelineImporter.import()` — full create flow
- [ ] Implement `PipelineImporter.import()` — update flow (with `--force`)
- [ ] Implement `PipelineImporter.computeDiff()` — detect changes vs existing
- [ ] Implement `PipelineImporter.resolveAgents()` — create/update ai_agents
- [ ] Implement `PipelineImporter.generateEdges()` — from dependsOn + explicit
- [ ] Implement `--dry-run` mode (return diff without writing)
- [ ] Handle edge case: node removed from YAML → delete from DB
- [ ] Handle edge case: agent renamed in YAML → update references
- [ ] Set `dag_validated = 1` after successful import
- [ ] Write import tests (create, update, delete, dry-run)

### Phase 4: Exporter

- [ ] Implement `PipelineExporter.export()` — DB → PipelineDefinition
- [ ] Implement reverse mapping: `orchestrator_edges` → `dependsOn` arrays
- [ ] Implement reverse mapping: `ai_agents` → `spec.agents` section
- [ ] Implement `PipelineExporter.toYaml()` — serialize with comments
- [ ] Write round-trip test: export → import → export → compare
- [ ] Write exporter tests for all field types

### Phase 5: CLI Integration

- [ ] Add `pipeline` subcommand group to `src/cli.ts`
- [ ] Implement `huskygate pipeline validate <file>` — read + validate + report
- [ ] Implement `huskygate pipeline apply <file>` — validate + import
- [ ] Implement `huskygate pipeline apply --dry-run` — validate + diff
- [ ] Implement `huskygate pipeline apply --force` — overwrite existing
- [ ] Implement `huskygate pipeline export <name>` — export to stdout
- [ ] Implement `huskygate pipeline export -o <file>` — export to file
- [ ] Implement `huskygate pipeline list` — table format
- [ ] Implement `huskygate pipeline diff <file>` — compare YAML vs DB
- [ ] Implement `huskygate pipeline delete <name>` — delete with confirmation
- [ ] Implement `huskygate pipeline run <name>` — trigger execution
- [ ] Write CLI integration tests
- [ ] Add `--help` output for all subcommands

### Phase 6: Slack Commands

- [ ] Implement `!pipeline validate <url|path>` — validate and report in thread
- [ ] Implement `!pipeline apply <url|path>` — import with status report
- [ ] Implement `!pipeline export <name>` — export and upload as file
- [ ] Implement `!pipeline list` — formatted list
- [ ] Implement `!pipeline diff <url|path>` — show diff in thread
- [ ] Update `docs/design/commands.md`
- [ ] Write command handler tests

### Phase 7: Dashboard

- [ ] Create `POST /api/pipeline/validate` endpoint
- [ ] Create `POST /api/pipeline/apply` endpoint
- [ ] Create `GET /api/pipeline/export/:id` endpoint
- [ ] Create `POST /api/pipeline/diff` endpoint
- [ ] Build YAML editor component (textarea with monospace + line numbers)
- [ ] Add real-time validation feedback (error/warning display)
- [ ] Add DAG visual preview synchronized with YAML
- [ ] Add import/export buttons in orchestrator tab
- [ ] Add diff viewer for `pipeline diff`
- [ ] Write API endpoint tests

### Phase 8: Example Pipelines & Documentation

- [ ] Create `examples/pipelines/code-review.yaml` — lint → security → review → test → summary
- [ ] Create `examples/pipelines/security-audit.yaml` — scan → research → gate → fix → report
- [ ] Create `examples/pipelines/research-report.yaml` — research → verify → draft → review → finalize
- [ ] Document YAML schema reference in `docs/design/orchestrator.md`
- [ ] Document CLI commands in `docs/design/commands.md`
- [ ] Add schema version migration guide placeholder
- [ ] Update DESIGN.md acceptance checklist
