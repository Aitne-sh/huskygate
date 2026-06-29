# IMPL-01: Token Budget Guardian

## Meta

- **Feature**: Token Budget Guardian (Cost Control Engine)
- **Priority**: P0
- **Status**: Draft
- **Created**: 2026-03-23
- **Depends on**: None (standalone, first to implement)

---

## 1. Goal & Constraints

**Goal**: Session / DAG-node / user 単位でトークン予算を設定し、閾値到達時に自動停止 + 通知する仕組みを構築する。

**Why (市場リサーチ根拠)**:
- OpenClaw ユーザーが月額 $3,600 の暴走請求を報告（1.8M tokens in a month）
- Perplexity Computer ユーザーが 40 分で月額 10,000 クレジットを枯渇
- **どの競合もタスク単位のコスト制御を未実装**
- OSS である HuskyGate だからこそ課金インセンティブに左右されず実装可能

**Constraints**:
- Claude/Codex/Gemini CLI の `stream-json` 出力はトークン数を**安定的には公開しない**
- → 2段階戦略: (1) `raw` JSON から usage 抽出を試みる、(2) フォールバックとしてテキスト長ベースの推定
- 既存の `audit` テーブル・`DriverEvent` インターフェースへの後方互換な拡張が必要
- Slack Tier 3 rate limit (chat.update ~50 req/min) の範囲内でコスト表示を更新

---

## 2. Architecture

### 2.1 Data Flow

```
Runner.run() → onEvent callback
    ↓
TokenTracker.record(event)          ← NEW: トークン計測
    ├─ extractUsageFromRaw(event)   ← raw JSON から usage 抽出
    ├─ estimateTokens(event)        ← テキスト長ベースの推定（フォールバック）
    └─ checkBudget()                ← 閾値チェック → 超過時 runner.kill()
    ↓
Messenger.appendText(event + cost footer)  ← コスト表示付きストリーミング
    ↓
AuditStore.logJobComplete(jobId, cost)     ← DB 永続化
    ↓
Dashboard: /api/metrics/cost               ← コスト分析 API
```

### 2.2 Token Estimation Strategy

| Driver | Primary Source | Fallback |
|--------|---------------|----------|
| **Claude** | `message_start.message.usage` / `message_stop` の `raw` JSON | テキスト長 ÷ 4 |
| **Codex** | `response.completed` の `usage` フィールド in `raw` | テキスト長 ÷ 4 |
| **Gemini** | `done` / `result` イベントの `usageMetadata` in `raw` | テキスト長 ÷ 4 |

テキスト長推定: 英語 ~4 chars/token、日本語 ~1.5 chars/token。
`Content-Language` 等がないため、Unicode スクリプト検出で粗く判定。

### 2.3 Cost Model

```typescript
interface CostModel {
  [driver: string]: {
    inputPerMToken: number;   // $ per 1M input tokens
    outputPerMToken: number;  // $ per 1M output tokens
  };
}

// Default (configurable via env / dashboard settings)
const DEFAULT_COST_MODEL: CostModel = {
  claude: { inputPerMToken: 15.0,  outputPerMToken: 75.0 },  // Opus 4.6
  codex:  { inputPerMToken: 2.5,   outputPerMToken: 10.0 },  // GPT-4.1
  gemini: { inputPerMToken: 1.25,  outputPerMToken: 5.0  },  // Gemini 2.5 Pro
};
```

---

## 3. Detailed Design

### 3.1 New Types (`src/runner/types.ts` 拡張)

```typescript
/** Token usage snapshot recorded per event or per job. */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: 'api' | 'estimated';  // api=raw JSON, estimated=text length
}

/** Budget configuration for a single execution scope. */
interface BudgetConfig {
  maxTokens?: number;       // Total token ceiling
  maxCostUsd?: number;      // Dollar ceiling
  alertThresholds?: number[]; // e.g. [0.5, 0.8, 0.95]
  onExceed: 'kill' | 'pause_and_notify';
}
```

### 3.2 TokenTracker Class (`src/runner/token-tracker.ts` — NEW)

```typescript
class TokenTracker {
  private accumulated: TokenUsage;
  private budget: BudgetConfig | null;
  private costModel: CostModel;
  private alertsFired: Set<number>;
  private onAlert: (pct: number, usage: TokenUsage) => void;
  private onExceed: () => void;

  constructor(opts: {
    budget?: BudgetConfig;
    costModel?: CostModel;
    driver: ToolName;
    onAlert: (pct: number, usage: TokenUsage) => void;
    onExceed: () => void;
  });

  /** Record a single driver event and update accumulated usage. */
  record(event: DriverEvent): void;

  /** Get current accumulated usage. */
  getUsage(): TokenUsage;

  /** Get current estimated cost in USD. */
  getCostUsd(): number;

  /** Get budget utilization percentage (0-1). */
  getUtilization(): number | null;
}
```

Core logic:
1. `record(event)`: `raw` JSON から usage を抽出、なければテキスト長から推定
2. 閾値チェック: `alertThresholds` の各値に対し、超過時に `onAlert` を一度だけ発火
3. `maxTokens` / `maxCostUsd` 超過時に `onExceed` を発火（→ `runner.kill('budget_exceeded')`）

### 3.3 Usage Extraction (`src/runner/usage-extract.ts` — NEW)

```typescript
/** Attempt to extract token usage from DriverEvent.raw JSON. */
function extractUsageFromRaw(event: DriverEvent): TokenUsage | null;

/** Estimate tokens from text content. */
function estimateTokensFromText(text: string): number;

/** Detect dominant script (Latin vs CJK) for estimation ratio. */
function detectScript(text: string): 'latin' | 'cjk' | 'mixed';
```

Claude `message_start` の raw JSON 構造例:
```json
{
  "type": "message_start",
  "message": {
    "usage": { "input_tokens": 1234, "output_tokens": 0 }
  }
}
```

Codex `response.completed` の raw JSON 構造例:
```json
{
  "type": "response.completed",
  "response": {
    "usage": { "input_tokens": 500, "output_tokens": 200, "total_tokens": 700 }
  }
}
```

### 3.4 DB Schema Extension (`src/store/schema.ts` — ALTER)

`audit` テーブルへのカラム追加:

```sql
ALTER TABLE audit ADD COLUMN input_tokens  INTEGER;
ALTER TABLE audit ADD COLUMN output_tokens INTEGER;
ALTER TABLE audit ADD COLUMN total_tokens  INTEGER;
ALTER TABLE audit ADD COLUMN cost_usd      REAL;
ALTER TABLE audit ADD COLUMN token_source  TEXT;  -- 'api' | 'estimated'
```

`orchestration_node_runs` テーブルへの追加:

```sql
ALTER TABLE orchestration_node_runs ADD COLUMN input_tokens  INTEGER;
ALTER TABLE orchestration_node_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE orchestration_node_runs ADD COLUMN total_tokens  INTEGER;
ALTER TABLE orchestration_node_runs ADD COLUMN cost_usd      REAL;
```

New table for budget configuration:

```sql
CREATE TABLE IF NOT EXISTS budget_policies (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('global', 'user', 'session', 'orchestrator')),
  scope_key   TEXT,            -- user_id, session_key, orchestrator_id (NULL for global)
  max_tokens  INTEGER,
  max_cost_usd REAL,
  alert_thresholds TEXT,       -- JSON array e.g. '[0.5, 0.8, 0.95]'
  on_exceed   TEXT NOT NULL DEFAULT 'kill' CHECK (on_exceed IN ('kill', 'pause_and_notify')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(scope, scope_key)
);
```

### 3.5 Job Runtime Integration (`src/slack/job-runtime.ts` — MODIFY)

```typescript
// In executeJobRuntime():
const tokenTracker = new TokenTracker({
  budget: resolveBudget(session, orchestratorNode),
  costModel: loadCostModel(),
  driver: job.tool,
  onAlert: (pct, usage) => {
    messenger.postStatusMessage(
      `⚠️ Budget ${Math.round(pct * 100)}% used: ${usage.totalTokens.toLocaleString()} tokens ($${tokenTracker.getCostUsd().toFixed(2)})`
    );
  },
  onExceed: () => {
    runner.kill('budget_exceeded');
  },
});

const result = await runner.run(driver, args, env, cwd, (event) => {
  // ... existing event processing ...
  tokenTracker.record(event);  // ← NEW: record every event
});

// After completion — persist to audit
const usage = tokenTracker.getUsage();
auditStore.logJobCost(job.id, usage, tokenTracker.getCostUsd());
```

### 3.6 Slack Display

Completion message footer に追加:

```
⚙️ claude · success · exit 0 · 12,340 tokens · $0.37
```

DAG 実行中のリアルタイム表示（Slack スレッド）:

```
📋 Pipeline: code-review
├─ ✅ lint       [claude]  2,340 tok  $0.07  12s
├─ 🔄 review     [claude]  8,120 tok  $0.24  running...
├─ ⏳ test-gen   [codex]   waiting
└─ 📊 Total: 10,460 / 50,000 tok  $0.31 / $5.00
```

### 3.7 Dashboard Integration

**New API endpoints** (`src/dashboard/routes/cost.ts`):
- `GET /api/cost/summary?range=24h|7d|30d` — 期間別コストサマリー
- `GET /api/cost/by-tool?range=...` — ドライバー別コスト内訳
- `GET /api/cost/by-session/:sessionKey` — セッション別コスト
- `GET /api/cost/by-orchestrator/:id` — オーケストレーター別コスト

**Dashboard Metrics tab extension**:
- 日別コスト推移チャート (Chart.js line)
- ドライバー別コスト分布 (doughnut)
- トップ10高コストセッション (table)

### 3.8 CLI Integration

```
!budget                            # 現在の予算設定を表示
!budget set 50000 tokens           # セッション予算を設定
!budget set $5.00                  # ドルベースのセッション予算
!cost                              # 現在のセッションの累計コスト
!cost <session-id>                 # 指定セッションのコスト
```

### 3.9 Environment Variables

```
BUDGET_DEFAULT_MAX_TOKENS=         # グローバルデフォルト (未設定=無制限)
BUDGET_DEFAULT_MAX_COST_USD=       # グローバルデフォルト (未設定=無制限)
BUDGET_ALERT_THRESHOLDS=0.5,0.8,0.95
COST_MODEL_CLAUDE_INPUT=15.0      # $/1M input tokens
COST_MODEL_CLAUDE_OUTPUT=75.0     # $/1M output tokens
COST_MODEL_CODEX_INPUT=2.5
COST_MODEL_CODEX_OUTPUT=10.0
COST_MODEL_GEMINI_INPUT=1.25
COST_MODEL_GEMINI_OUTPUT=5.0
```

---

## 4. File Impact

| Action | File | Changes |
|--------|------|---------|
| **CREATE** | `src/runner/token-tracker.ts` | TokenTracker class |
| **CREATE** | `src/runner/usage-extract.ts` | Usage extraction + estimation |
| **CREATE** | `src/dashboard/routes/cost.ts` | Cost API endpoints |
| **CREATE** | `src/dashboard/scripts/cost-tab.ts` | Dashboard cost tab UI |
| **MODIFY** | `src/runner/types.ts` | Add `TokenUsage`, `BudgetConfig` |
| **MODIFY** | `src/store/schema.ts` | Add columns to `audit`, `orchestration_node_runs`; add `budget_policies` table |
| **MODIFY** | `src/store/migrations.ts` | Migration for new columns |
| **MODIFY** | `src/store/audit.ts` | `logJobCost()` method |
| **MODIFY** | `src/slack/job-runtime.ts` | Integrate TokenTracker in event loop |
| **MODIFY** | `src/slack/job-finishers.ts` | Cost display in completion message |
| **MODIFY** | `src/slack/messenger.ts` | Cost footer support |
| **MODIFY** | `src/orchestrator/executor.ts` | Per-node cost aggregation |
| **MODIFY** | `src/dashboard/db.ts` | Cost query methods |
| **MODIFY** | `src/dashboard/templates/layout.ts` | Add Cost tab |
| **MODIFY** | `src/config/env-registry.ts` | Register BUDGET_*, COST_MODEL_* env vars |
| **MODIFY** | `src/shared/constants.ts` | Default budget thresholds |
| **MODIFY** | `docs/design/commands.md` | Document `!budget`, `!cost` commands |

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLI が usage を出力しない場合がある | コスト精度低下 | テキスト長推定フォールバック + `token_source` カラムで精度を明示 |
| 推定トークン数が実際と乖離 | ユーザー混乱 | UI で "(estimated)" ラベル表示、精度改善を継続 |
| budget_exceeded による強制 kill | 作業途中のデータ損失 | `pause_and_notify` モードで一時停止 + 承認後に継続 |
| コストモデルの価格変更 | 計算が不正確に | env/dashboard から随時更新可能に設計 |
| TokenTracker のメモリオーバーヘッド | 長時間セッション | 集約値のみ保持、イベント単位のログは DB へ |

---

## 6. Verification

```bash
# Unit tests
npx vitest run src/runner/token-tracker.test.ts
npx vitest run src/runner/usage-extract.test.ts

# Integration test: budget exceed kills runner
npx vitest run src/slack/job-runtime.budget.test.ts

# Schema migration test
npx vitest run src/store/migrations.test.ts

# Lint & typecheck
npm run lint && npm run typecheck

# Manual verification
# 1. Set BUDGET_DEFAULT_MAX_TOKENS=1000
# 2. Run a prompt that generates >1000 tokens
# 3. Verify runner is killed with 'budget_exceeded'
# 4. Verify Slack notification at 50%, 80%, 95%
# 5. Verify audit table has token/cost data
# 6. Verify dashboard Cost tab displays data
```

---

## 7. Phase Checklist

### Phase 1: Core Token Tracking (Foundation)

- [ ] Define `TokenUsage` and `BudgetConfig` types in `src/runner/types.ts`
- [ ] Implement `extractUsageFromRaw()` for Claude raw JSON
- [ ] Implement `extractUsageFromRaw()` for Codex raw JSON
- [ ] Implement `extractUsageFromRaw()` for Gemini raw JSON
- [ ] Implement `estimateTokensFromText()` with script detection
- [ ] Implement `detectScript()` for Latin/CJK ratio
- [ ] Write unit tests for usage extraction (all 3 drivers)
- [ ] Write unit tests for token estimation
- [ ] Write unit tests for script detection

### Phase 2: TokenTracker + Budget Enforcement

- [ ] Implement `TokenTracker` class with `record()`, `getUsage()`, `getCostUsd()`
- [ ] Implement budget threshold alerting (`onAlert` callback)
- [ ] Implement budget exceed detection (`onExceed` callback)
- [ ] Implement `CostModel` loading from env vars
- [ ] Write unit tests for TokenTracker (accumulation, thresholds, exceed)
- [ ] Write unit tests for CostModel resolution

### Phase 3: DB Schema & Persistence

- [ ] Add columns to `audit` table (`input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`, `token_source`)
- [ ] Add columns to `orchestration_node_runs` table
- [ ] Create `budget_policies` table
- [ ] Write migration in `src/store/migrations.ts`
- [ ] Add `logJobCost()` to `AuditStore`
- [ ] Add `BudgetPolicyStore` with CRUD methods
- [ ] Write migration tests
- [ ] Write store tests

### Phase 4: Job Runtime Integration

- [ ] Integrate `TokenTracker` in `src/slack/job-runtime.ts` event loop
- [ ] Add `budget_exceeded` to valid `errorKind` values
- [ ] Implement `resolveBudget()` — session → user → global fallback chain
- [ ] Add cost data to `JobRunOutcome`
- [ ] Persist cost on job completion via `auditStore.logJobCost()`
- [ ] Write integration tests for budget enforcement flow

### Phase 5: Slack UI

- [ ] Add cost footer to job completion messages in `job-finishers.ts`
- [ ] Add cost to DAG progress display in orchestrator messenger
- [ ] Implement `!budget` command (set/show)
- [ ] Implement `!cost` command (show session/job cost)
- [ ] Add budget alert messages to Slack threads
- [ ] Update `docs/design/commands.md`
- [ ] Write command handler tests

### Phase 6: Dashboard

- [ ] Create `GET /api/cost/summary` endpoint
- [ ] Create `GET /api/cost/by-tool` endpoint
- [ ] Create `GET /api/cost/by-session/:sessionKey` endpoint
- [ ] Create `GET /api/cost/by-orchestrator/:id` endpoint
- [ ] Add cost query methods to `src/dashboard/db.ts`
- [ ] Create Cost tab UI with Chart.js charts
- [ ] Add Budget Policy management UI
- [ ] Add cost data to existing Session detail view
- [ ] Write API endpoint tests

### Phase 7: Configuration & Docs

- [ ] Register `BUDGET_*` and `COST_MODEL_*` env vars in `env-registry.ts`
- [ ] Add budget defaults to `src/shared/constants.ts`
- [ ] Update `docs/design/config.md` with new env vars
- [ ] Update `docs/design/components.md` with TokenTracker
- [ ] Update DESIGN.md acceptance checklist
