# IMPL-02: Execution Replay & Checkpoint

## Meta

- **Feature**: Execution Replay & Checkpoint (Rollback Engine)
- **Priority**: P1
- **Status**: Draft
- **Created**: 2026-03-23
- **Depends on**: IMPL-01 (TokenTracker provides per-event cost data for replay display)

---

## 1. Goal & Constraints

**Goal**: DAG ノード実行前に workdir のスナップショットを自動作成し、失敗時のロールバックと、全実行トレースの記録・再生を可能にする。

**Why (市場リサーチ根拠)**:
- Claude Cowork が 11GB のファイルを削除する動画が拡散（James McAulay）
- Claude Cowork が 15,000 枚の家族写真を消失（Nick Davydov）
- Perplexity Computer がサイレントに壊れたビルドを Vercel にループデプロイ
- 30% のエージェント実行が例外に遭遇するが、**どの競合もトランザクショナルなロールバックを提供していない**
- Rubrik Agent Rewind が商用で類似機能を提供するがエンタープライズ向け高額ソリューション
- HuskyGate は workdir を session ごとに隔離済みで、**チェックポイント機構の実装コストが低い**

**Constraints**:
- workdir が大きい場合、git snapshot のオーバーヘッドが懸念
- → `.gitignore` で `node_modules/`, `.venv/`, バイナリを除外
- 既存の `mode=write` チャレンジコード承認との共存
- SQLite への大量イベントトレース保存はサイズに注意
- → `output_full` パターンと同様にファイルオフロード

---

## 2. Architecture

### 2.1 Two Subsystems

```
┌──────────────────────────────────────────────────────┐
│                  Execution Replay                      │
│                                                        │
│  DriverEvent stream → EventTrace (SQLite/file)         │
│  → Replay viewer (Slack thread / Dashboard timeline)   │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│               Checkpoint & Rollback                    │
│                                                        │
│  Pre-execution git snapshot → Checkpoint record (DB)   │
│  → Rollback command → git checkout to checkpoint       │
└──────────────────────────────────────────────────────┘
```

### 2.2 Checkpoint Strategy

workdir 内に bare な git repository を管理する（ユーザーの既存 `.git` とは別）。

```
workdir/
  .hg-checkpoints/          ← HuskyGate checkpoint repo (hidden)
    HEAD
    refs/
    objects/
  src/                      ← ユーザーの作業ファイル
  ...
```

**Why git (not file copy)?**:
- 差分ベースで軽量（フルコピーは大きい workdir で破綻）
- `git diff` による変更可視化が容易
- `git checkout` によるアトミックなロールバック
- SHA によるチェックポイントの一意識別

**ユーザーの既存 .git との共存**:
- `GIT_DIR=.hg-checkpoints` / `GIT_WORK_TREE=.` 環境変数で分離
- HuskyGate のチェックポイント操作はすべて `--git-dir=.hg-checkpoints` を使用
- ユーザーの `.git` には一切触れない

### 2.3 Event Trace Storage

```
data/traces/
  {job_id}.jsonl            ← 1行1イベントの JSONL
```

```jsonl
{"ts":"2026-03-23T10:00:01Z","seq":0,"type":"status","content":"session:abc123","raw":{...}}
{"ts":"2026-03-23T10:00:02Z","seq":1,"type":"text","content":"Let me analyze...","tokens":{"input":0,"output":12,"source":"estimated"}}
{"ts":"2026-03-23T10:00:03Z","seq":2,"type":"tool_use","content":"Using tool: read_file","toolInput":{"path":"src/main.ts"}}
{"ts":"2026-03-23T10:00:04Z","seq":3,"type":"tool_result","content":"import { App }..."}
```

- タイムスタンプ + シーケンス番号で順序保証
- IMPL-01 の TokenUsage データも含む（`tokens` フィールド）
- `data/traces/` ディレクトリは housekeeping で retention 管理

---

## 3. Detailed Design

### 3.1 New Types (`src/runner/types.ts` 拡張)

```typescript
/** A single event in the execution trace with timing metadata. */
interface TraceEvent {
  ts: string;         // ISO 8601 timestamp
  seq: number;        // Sequence number within the job
  type: DriverEvent['type'];
  content: string;
  toolInput?: unknown;
  tokens?: { input: number; output: number; source: 'api' | 'estimated' };
  raw?: unknown;      // Only stored if TRACE_INCLUDE_RAW=true
}

/** Checkpoint record for a workdir snapshot. */
interface Checkpoint {
  id: string;          // UUID
  jobId: string;       // Job that triggered this checkpoint
  sessionKey: string;
  commitSha: string;   // Git commit SHA in .hg-checkpoints
  workdir: string;
  fileCount: number;   // Number of tracked files at checkpoint
  createdAt: string;   // ISO 8601
  label?: string;      // Optional human-readable label (e.g., DAG node label)
}
```

### 3.2 CheckpointManager (`src/runner/checkpoint-manager.ts` — NEW)

```typescript
class CheckpointManager {
  private gitDir: string;  // .hg-checkpoints path
  private workTree: string;

  constructor(workdir: string);

  /** Initialize the checkpoint repo if it doesn't exist. */
  async init(): Promise<void>;

  /** Create a checkpoint (git add + commit). Returns Checkpoint. */
  async create(opts: { jobId: string; sessionKey: string; label?: string }): Promise<Checkpoint>;

  /** List checkpoints ordered by creation time. */
  async list(): Promise<Checkpoint[]>;

  /** Show diff between two checkpoints (or checkpoint and current state). */
  async diff(fromSha: string, toSha?: string): Promise<string>;

  /** Rollback workdir to a specific checkpoint. */
  async rollback(commitSha: string): Promise<void>;

  /** Show files changed since a specific checkpoint. */
  async changedFiles(commitSha: string): Promise<string[]>;

  /** Cleanup: remove the checkpoint repo entirely. */
  async cleanup(): Promise<void>;
}
```

Implementation details:
- All git operations via `child_process.execFile('git', [...], { env: { GIT_DIR, GIT_WORK_TREE } })`
- `.hg-checkpoints/.gitignore`: `node_modules/`, `.venv/`, `__pycache__/`, `*.pyc`, `.env`, etc.
- Commit message format: `checkpoint: {label} [{jobId}]`
- `--no-gpg-sign` to avoid signing prompts
- Timeout: 30s per git operation (large repos)

### 3.3 EventTraceWriter (`src/runner/event-trace.ts` — NEW)

```typescript
class EventTraceWriter {
  private fd: number;       // File descriptor for JSONL
  private seq: number;
  private filePath: string;

  constructor(jobId: string, dataDir: string);

  /** Append a DriverEvent to the trace file. */
  write(event: DriverEvent, tokens?: TokenUsage): void;

  /** Close the trace file. */
  close(): void;

  /** Get the trace file path. */
  getPath(): string;
}

class EventTraceReader {
  /** Read all events from a trace file. */
  static async read(filePath: string): Promise<TraceEvent[]>;

  /** Read events within a range (by seq). */
  static async readRange(filePath: string, fromSeq: number, toSeq?: number): Promise<TraceEvent[]>;

  /** Stream events (for SSE). */
  static createReadStream(filePath: string): ReadableStream<TraceEvent>;
}
```

### 3.4 Destructive Operation Detection (`src/runner/destructive-detect.ts` — NEW)

```typescript
/** Patterns that indicate potentially destructive operations. */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[rf]+\s+|--recursive|--force)/,
  /\brmdir\b/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bgit\s+(reset\s+--hard|clean\s+-[fd]|checkout\s+--\s+\.)/,
  /\b(shutil\.rmtree|os\.remove|pathlib.*\.unlink)\b/,
];

/** Check if a tool_use event contains a destructive operation. */
function isDestructiveOperation(event: DriverEvent): {
  isDestructive: boolean;
  pattern?: string;
  description?: string;
};
```

### 3.5 DB Schema Extension

```sql
CREATE TABLE IF NOT EXISTS checkpoints (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  session_key  TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  workdir      TEXT NOT NULL,
  file_count   INTEGER NOT NULL DEFAULT 0,
  label        TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session
  ON checkpoints(session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_job
  ON checkpoints(job_id);
```

`audit` テーブルへのカラム追加:

```sql
ALTER TABLE audit ADD COLUMN trace_path TEXT;  -- path to .jsonl trace file
ALTER TABLE audit ADD COLUMN checkpoint_id TEXT;  -- pre-execution checkpoint
```

### 3.6 Job Runtime Integration (`src/slack/job-runtime.ts` — MODIFY)

```typescript
// Before runner.run():
let checkpoint: Checkpoint | null = null;
if (mode === 'write' && checkpointEnabled) {
  const cpManager = new CheckpointManager(cwd);
  await cpManager.init();
  checkpoint = await cpManager.create({
    jobId: job.id,
    sessionKey: session.sessionKey,
    label: orchestratorNodeLabel ?? `job-${job.id.slice(0, 8)}`,
  });
}

// Create trace writer
const traceWriter = new EventTraceWriter(job.id, dataDir);

const result = await runner.run(driver, args, env, cwd, (event) => {
  // ... existing event processing ...
  tokenTracker.record(event);
  traceWriter.write(event, tokenTracker.getLastEventUsage());

  // Destructive operation warning (pre-approval enhancement)
  if (event.type === 'tool_use') {
    const check = isDestructiveOperation(event);
    if (check.isDestructive) {
      messenger.postStatusMessage(
        `⚠️ Destructive operation detected: ${check.description}\nCheckpoint: ${checkpoint?.commitSha?.slice(0, 8) ?? 'none'}`
      );
    }
  }
});

traceWriter.close();

// Persist trace path and checkpoint ID to audit
auditStore.logJobTrace(job.id, traceWriter.getPath(), checkpoint?.id ?? null);
```

### 3.7 Slack Commands

```
!replay <session-id|job-id>          # Show execution trace step by step
!replay <id> --from <seq>            # Start from specific step
!replay <id> --tools-only            # Show only tool_use/tool_result events
!diff <session-id|job-id>            # Show file changes from this job
!checkpoints                         # List checkpoints for current session
!rollback                            # Rollback to most recent checkpoint
!rollback <checkpoint-id>            # Rollback to specific checkpoint
!rollback --preview                  # Show what would change without applying
```

**Replay display in Slack thread**:

```
📼 Replay: job abc12345 (42 events, 45s)

[0] 🔵 status — session:def456
[1] 💬 text — "Let me analyze the authentication module..."
[2] 🔧 tool_use — read_file("src/auth.ts")
[3] 📄 tool_result — (2,340 chars)
[4] 💬 text — "I see the issue. The token validation..."
[5] 🔧 tool_use — file_edit("src/auth.ts", lines 45-52)  ⚠️ DESTRUCTIVE
[6] 📄 tool_result — "Applied edit"
...
⏮️ Page 1/5 — React with ➡️ for next page
```

### 3.8 Dashboard Integration

**Trace Timeline view** (`/api/traces/:jobId`):
- Visual timeline with event types color-coded
- Click on tool_use to see input/output
- Diff view for file changes
- Token cost annotation per event

**Checkpoint management** (in Session detail):
- List checkpoints with timestamps
- Preview diff between checkpoints
- One-click rollback with confirmation

### 3.9 Housekeeping

Add to retention rules:

```typescript
{ table: 'checkpoints', retentionDays: 30 },
// Trace files cleaned up based on audit retention (90 days)
// Checkpoint git repos cleaned up when workdir is removed
```

---

## 4. File Impact

| Action | File | Changes |
|--------|------|---------|
| **CREATE** | `src/runner/checkpoint-manager.ts` | Git-based checkpoint management |
| **CREATE** | `src/runner/event-trace.ts` | JSONL trace writer/reader |
| **CREATE** | `src/runner/destructive-detect.ts` | Destructive operation detection |
| **CREATE** | `src/store/checkpoint-store.ts` | Checkpoint CRUD |
| **CREATE** | `src/dashboard/routes/traces.ts` | Trace API endpoints |
| **CREATE** | `src/dashboard/scripts/trace-timeline.ts` | Timeline UI component |
| **MODIFY** | `src/runner/types.ts` | Add `TraceEvent`, `Checkpoint` types |
| **MODIFY** | `src/store/schema.ts` | `checkpoints` table; columns on `audit` |
| **MODIFY** | `src/store/migrations.ts` | Migration for new table/columns |
| **MODIFY** | `src/store/audit.ts` | `logJobTrace()` method |
| **MODIFY** | `src/slack/job-runtime.ts` | Checkpoint + trace in execution flow |
| **MODIFY** | `src/slack/job-finishers.ts` | Checkpoint info in completion message |
| **MODIFY** | `src/slack/command-handlers.ts` | `!replay`, `!diff`, `!checkpoints`, `!rollback` |
| **MODIFY** | `src/orchestrator/executor.ts` | Per-node checkpoint creation |
| **MODIFY** | `src/store/housekeeping.ts` | Checkpoint + trace retention |
| **MODIFY** | `src/dashboard/templates/layout.ts` | Trace timeline in session detail |
| **MODIFY** | `docs/design/commands.md` | Document new commands |

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large workdir で git snapshot が遅い | 実行開始が遅延 | `.gitignore` で除外パターン + `--no-verify` + 30s timeout |
| Checkpoint git repo がディスクを圧迫 | ストレージ枯渇 | Housekeeping で 30 日 retention + `git gc` 定期実行 |
| ユーザーの既存 .git と競合 | データ破損 | 完全に独立した `GIT_DIR` で分離、ユーザーの `.git` には不干渉 |
| Trace JSONL が大きくなる | ディスク圧迫 | raw イベントはオプション (`TRACE_INCLUDE_RAW`)、retention で管理 |
| Rollback が外部副作用（API 呼び出し等）を戻せない | 不完全なロールバック | UI で「ファイルシステムのみ復元」と明示、外部副作用は別途確認を促す |
| git コマンドが PATH にない | チェックポイント不可 | `which git` チェック、なければ graceful に無効化 + 警告ログ |
| Destructive detection の false positive | 不要なアラート | パターンは保守的に設計、`DESTRUCTIVE_DETECT=false` で無効化可能 |

---

## 6. Verification

```bash
# Unit tests
npx vitest run src/runner/checkpoint-manager.test.ts
npx vitest run src/runner/event-trace.test.ts
npx vitest run src/runner/destructive-detect.test.ts
npx vitest run src/store/checkpoint-store.test.ts

# Integration tests
npx vitest run src/slack/job-runtime.checkpoint.test.ts

# Lint & typecheck
npm run lint && npm run typecheck

# Manual verification
# 1. Run a mode=write job → verify checkpoint created in .hg-checkpoints
# 2. Verify trace JSONL created in data/traces/
# 3. Run !checkpoints → verify list displayed
# 4. Run !diff <job-id> → verify file changes shown
# 5. Modify files via agent, then !rollback → verify files restored
# 6. Run !replay <job-id> → verify step-by-step display
# 7. Trigger destructive operation → verify warning displayed
# 8. Verify dashboard trace timeline renders correctly
```

---

## 7. Phase Checklist

### Phase 1: Event Trace Recording (Foundation)

- [ ] Define `TraceEvent` type in `src/runner/types.ts`
- [ ] Implement `EventTraceWriter` — JSONL writer with sequential numbering
- [ ] Implement `EventTraceReader` — read/range/stream
- [ ] Add `trace_path` column to `audit` table
- [ ] Write migration for `trace_path` column
- [ ] Integrate `EventTraceWriter` in `job-runtime.ts` event callback
- [ ] Persist `trace_path` in `auditStore.logJobTrace()`
- [ ] Add trace file cleanup to housekeeping (retention: audit retention)
- [ ] Write unit tests for EventTraceWriter (write, close, file format)
- [ ] Write unit tests for EventTraceReader (read, readRange)
- [ ] Register `TRACE_INCLUDE_RAW` env var

### Phase 2: Checkpoint System

- [ ] Implement `CheckpointManager.init()` — create `.hg-checkpoints` git repo
- [ ] Implement `CheckpointManager.create()` — git add + commit
- [ ] Implement `CheckpointManager.list()` — git log → Checkpoint[]
- [ ] Implement `CheckpointManager.diff()` — git diff between SHAs
- [ ] Implement `CheckpointManager.rollback()` — git checkout
- [ ] Implement `CheckpointManager.changedFiles()` — git diff --name-only
- [ ] Implement `CheckpointManager.cleanup()` — remove .hg-checkpoints
- [ ] Create `.gitignore` template for checkpoint repo (node_modules, .venv, etc.)
- [ ] Create `checkpoints` table in schema.ts
- [ ] Write migration for `checkpoints` table and `audit.checkpoint_id`
- [ ] Implement `CheckpointStore` (CRUD + list by session)
- [ ] Add git availability check with graceful degradation
- [ ] Write unit tests for CheckpointManager (init, create, diff, rollback)
- [ ] Write unit tests for CheckpointStore

### Phase 3: Destructive Operation Detection

- [ ] Implement `isDestructiveOperation()` with pattern matching
- [ ] Define destructive patterns for: shell (rm, rmdir), SQL (DROP, TRUNCATE, DELETE), git (reset --hard, clean), Python (rmtree, unlink)
- [ ] Add warning injection in `job-runtime.ts` when destructive tool_use detected
- [ ] Register `DESTRUCTIVE_DETECT` env var (default: true)
- [ ] Write unit tests for all destructive patterns (positive and negative cases)

### Phase 4: Job Runtime Integration

- [ ] Create checkpoint before `mode=write` job execution
- [ ] Skip checkpoint for `mode=readonly` jobs
- [ ] Handle checkpoint creation failure gracefully (log warning, continue)
- [ ] Create checkpoint per DAG node execution in orchestrator
- [ ] Persist checkpoint_id to audit table on job start
- [ ] Add checkpoint info to `JobRunOutcome`
- [ ] Show checkpoint SHA in job completion Slack message
- [ ] Write integration tests for checkpoint creation + trace recording flow

### Phase 5: Slack Commands

- [ ] Implement `!replay <id>` command — paginated event display
- [ ] Implement `!replay <id> --from <seq>` — start from step
- [ ] Implement `!replay <id> --tools-only` — filter tool events
- [ ] Implement `!diff <id>` — show file changes from job
- [ ] Implement `!checkpoints` — list session checkpoints
- [ ] Implement `!rollback` — rollback to most recent checkpoint
- [ ] Implement `!rollback <checkpoint-id>` — rollback to specific checkpoint
- [ ] Implement `!rollback --preview` — dry-run showing changes
- [ ] Add rollback confirmation (challenge code for safety)
- [ ] Update `docs/design/commands.md`
- [ ] Write command handler tests

### Phase 6: Dashboard

- [ ] Create `GET /api/traces/:jobId` — return trace events
- [ ] Create `GET /api/traces/:jobId/range?from=N&to=M` — paginated trace
- [ ] Create `GET /api/checkpoints/:sessionKey` — list checkpoints
- [ ] Create `POST /api/checkpoints/:id/rollback` — execute rollback
- [ ] Create `GET /api/checkpoints/:id/diff` — preview diff
- [ ] Build trace timeline UI component (event cards, color-coded by type)
- [ ] Build checkpoint list + rollback UI in session detail
- [ ] Build diff viewer (syntax-highlighted file diffs)
- [ ] Write API endpoint tests

### Phase 7: Housekeeping & Config

- [ ] Add `checkpoints` to retention rules (30 days)
- [ ] Add trace file cleanup (aligned with `audit` retention — 90 days)
- [ ] Add `.hg-checkpoints` cleanup when workdir is removed
- [ ] Add periodic `git gc` for checkpoint repos
- [ ] Update `docs/design/operations.md` with checkpoint housekeeping
- [ ] Update DESIGN.md acceptance checklist
