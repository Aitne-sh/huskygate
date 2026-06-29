# Components

Key interfaces and model definitions.

---

## Session Model

```
thread_key  = <channel_id>:<thread_ts>       # Slack thread identifier
session_key = sess_<random_hash>             # Internal session identifier (12-24 chars)
session_id  = <8hex>                         # User-facing ID (!session <id>)
```

- **Session ID Assignment**: Generates a unique 8-character hex with up to 16 retries
- **Thread Context Auto-creation**: Implicitly created on first access via `ensureThreadContextRow()`
- **Workdir**: New sessions use `workdir/sess_<session_key_hash>` (12-char hash from session key)

---

## Tool State (JSON blob)

Each tool's approval/auth state is maintained as JSON in `sessions.tool_state`.

**Claude:**
```typescript
{
  session_id?: string,                           // Claude CLI session ID
  claude_runtime_allowed_tools?: string[],       // List of approved tools
  claude_skip_mcp_preflight_once?: boolean,      // Skip preflight once
  claude_mcp_auth_verified_server?: string,      // Authenticated server name
  claude_mcp_auth_bypass_server?: string,        // Bypass decision
  claude_mcp_auth_approval_completed?: boolean,  // Session-level retry approval suppression
  claude_mcp_auth_approval_rerun?: boolean,      // Rerun flag
  claude_mcp_auth_approval_action?: string,      // Approval action type
  claude_mcp_auth_auto_rerun?: boolean           // Auto-rerun flag after re-authentication
}
```

**Gemini:**
```typescript
{
  session_index?: string,                        // Gemini CLI session index
  gemini_runtime_allowed_tools?: string[],       // List of approved tools
  gemini_resume_ready?: boolean,                 // Resume-ready flag
  gemini_mcp_auth_initialized_server?: string,   // Preflight-completed server
  gemini_mcp_auth_verified_server?: string,      // Successfully authenticated server
  gemini_mcp_auth_bypass_server?: string,        // Bypass decision
  gemini_mcp_auth_approval_rerun?: boolean,
  gemini_mcp_auth_approval_action?: string
}
```

**Codex:**
```typescript
{
  thread_id?: string,                            // Codex thread ID
  codex_ask_for_approval?: string,               // Approval request mode ('on-request' | 'never', etc.)
  codex_allow_tool_once_list?: CodexApprovedToolCall[], // List of approved tool calls
  codex_mcp_auth_verified_server?: string,       // Authenticated server name
  codex_mcp_auth_auto_rerun?: boolean            // Auto-rerun flag after re-authentication
}
```

**Sticky State Management:**
- Tool-specific temporary approval flags (`*_approval_rerun`, `*_approval_action`, `*_auto_rerun`, etc.) are automatically cleared on job completion
- `STICKY_APPROVAL_STATE_KEYS` defines the keys to be cleared for each tool
- Prevents approval state from leaking between sessions

---

## Job Structure

Updated Job interface (corresponds to `src/queue/types.ts`):

```typescript
interface Job {
  id: string;
  sessionKey: string;
  channelId: string;
  threadTs: string;
  userId: string;
  tool: ToolName;                       // 'claude' | 'codex' | 'gemini'
  mode: Mode;                           // 'readonly' | 'write'
  prompt: string;
  workdir: string;
  toolState: ToolState;
  toolStateOverrides?: ToolState;       // One-time overrides for approval rerun
  createdAt: number;
  source?: 'slack' | 'dashboard' | 'schedule' | 'assistant'
         | 'ondemand-task' | 'triggered-task'
         | 'orchestrator' | 'orchestrator-summary';
  scheduleTaskId?: string;
  scheduleRunId?: string;
  ondemandTaskId?: string;
  ondemandTaskRunId?: string;
  triggeredTaskId?: string;
  triggeredTaskRunId?: string;
  orchestrationRunId?: string;
  orchestrationNodeId?: string;
  summaryNotifyChannel?: string;
  summaryNotifyThreadTs?: string;
  autoApprove?: boolean;
  timeoutSec?: number | null;           // Per-node timeout override
  executionPolicy?: TaskExecutionPolicy;
  instructionFile?: string | null;
  skipInstructionFile?: boolean;
  instructionOverride?: string | null;
}

interface TaskExecutionPolicy {
  allowMcp: boolean;
  enabledSkills: SkillRef[] | null;
  enabledMcpServerIds?: string[] | null;
}

type SkillRef = `${'builtin' | 'local' | 'project'}:${string}`;
```

- **`toolStateOverrides`**: Injects MCP auth flags and approved tool lists as one-time overrides during approval reruns. Independent from the persisted `toolState`
- **`source`**: Identifies the job origin. Supports multiple sources including schedule, on-demand, trigger, and orchestrator
- **`executionPolicy`**: Controls MCP access, optional MCP server narrowing, and skill selection on a per-task basis
- **MCP scope preservation**: The resolved MCP server subset is computed once per job and reused by runtime, preflight, and post-run auth recovery. Recovery paths must never widen back to the full tool server list.
- **Restart recovery guardrails**: Persisted jobs are revalidated against current workdir policy and current task definitions before replay. `source='orchestrator'` is recovered from orchestration state, not from the durable queue row itself.

### Skill Selection Semantics

- `SkillRef` is the only persisted identifier format for skills
- `enabledSkills: null` means inherit global enablement from `skill_enablement`
- `enabledSkills: []` means explicitly seed no skills
- explicit `SkillRef[]` is an allowlist for built-in and/or custom skills
- global default enablement is source-sensitive: built-ins default to disabled, local/project customs default to enabled

---

## Driver Interface

```typescript
interface Driver {
  name: ToolName;
  buildCommand(): string;
  buildArgs(prompt: string, session: Session, mode: Mode, options: DriverBuildOptions): string[];
  buildEnv(): Record<string, string>;
  parseEvent(line: string): DriverEvent | null;
  parseStderr(line: string): DriverEvent | null;
  extractSessionState(events: DriverEvent[]): Record<string, unknown>;
}

interface DriverBuildOptions {
  autoApproveEnabled: boolean;
  allowMcp: boolean;
  mcpConfigPath?: string | null;
  enabledSkills?: SkillRef[] | null;
}

interface DriverEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'status' | 'done';
  content: string;
  raw?: unknown;    // Tool-specific payload (stores tool_name, arguments, etc.)
}
```

---

## Tool Plugin Interface

Separates tool-specific branching from `job-executor.ts` for polymorphic dispatch:

```typescript
interface ToolPlugin {
  name: ToolName;
  getMcpAuthServer(config: Config): string | null;
  clearMcpAuthState(merged: Record<string, unknown>): Record<string, unknown>;
  createApprovalGate(toolState: Record<string, unknown>): ApprovalGate;
  evaluateToolUse(gate: ApprovalGate, event: DriverEvent): ApprovalEvaluation;
  buildPermissionDeniedSummary(gate: ApprovalGate): PermissionDeniedSummary | null;
  detectVoluntaryStop(...): PermissionDeniedSummary | null;
}
```

- Each tool is implemented in `claude-plugin.ts` / `codex-plugin.ts` / `gemini-plugin.ts`
- Registry managed via `registerToolPlugin()` / `getToolPlugin()`
- Codex's `clearMcpAuthState` also clears `thread_id` (prevents resuming interrupted threads)

---

## Messenger

Controls streaming output to Slack:

- **Update interval**: 0.8-1.2 seconds (random jitter)
- **Split condition**: 4000+ characters OR 12KB+ UTF-8
- **Split strategy**: Split at the last newline within the latter 50% window; when that would cut through a recently opened Markdown fence, retreat to the fence boundary if the chunk still remains useful
- **Concurrency safety**: buffer mutation, timed updates, and chunk flushes are serialized through a single async queue
- **Rate limit handling**: Exponential backoff (1x -> 2x -> 4x -> 8x)
- **Empty message avoidance**: Falls back to `"Completed."` if final output is empty
- **File upload**: Large logs are attached via `files.uploadV2` (filename: `<timestamp>_<jobId>_<tool>.log`)
- **Buffer replacement**: `replaceBuffer()` strips approval blocks (`[MCP_TOOL_REQUEST]`)

### Block Kit Final Output

When `useMarkdownBlocks` is enabled (via `MessengerOptions`):

- **Streaming phase**: Plain text `appendText()` updates (unchanged, 800-1200ms interval)
- **Final phase**: `postFinalWithMarkdown()` converts accumulated text to `markdown` block(s) via `buildMarkdownMessage()`
- **Transition**: If a streaming plain-text message exists, it's updated to Block Kit via `safeUpdateWithBlocks()`. If that fails, a new Block Kit message is posted instead.
- **Empty output**: Falls back to `"Completed."` as body text
- **>40K output**: Posts preview + uploads full output as `.md` file

---

## SSE Replay Boundary

The dashboard uses Server-Sent Events (SSE) for real-time streaming. **Not all SSE paths support replay.** This distinction matters for infrastructure decisions (e.g., Redis Streams vs in-memory buffers).

| SSE Path | Endpoint | Replay Support | Mechanism |
|---|---|---|---|
| **Dashboard approval-retry job-stream** | `GET /api/chat/:id/job-stream/:jobId` | **Yes** — `Last-Event-ID` | `JobStreamBuffer` per job; monotonic event IDs; capped at 10,000 events; retained 60s after completion |
| **Standard dashboard chat send** | `POST /api/chat/:id/send` | **No** — transient | Events written directly to response; no buffer retained |
| **Slack message streaming** | (via Messenger) | **No** — transient | Slack API-based; no SSE involved |

**`JobStreamBuffer` lifecycle** (`src/server/state.ts`):
- Created when a dashboard tool-approval rerun starts
- Events buffered with monotonic `sseEventIdCounter` (process-scoped, not persisted)
- On client reconnect: `Last-Event-ID` header → replay from that offset
- After job completion (`done=true`): buffer retained for `BUFFER_RETAIN_AFTER_DONE_MS` (60s), then swept
- Periodic cleanup sweeps every 60 seconds

**Infrastructure implication**: For single-instance deployment, the current in-memory `JobStreamBuffer` is sufficient. Redis Streams would only be justified for multi-instance deployment requiring cross-process replay.

---

## Parser

Command parsing details:

- **Full-width `!` to half-width `!`** normalization (convenience for Japanese input)
- **Bang commands (`!`)**: Undefined commands immediately return an error (not executed as prompts)
- **Approval aliases**: `!yes`, `!y`, `!ok`, `!okay`, `!no`, `!n`

---

## Instruction Builder (`src/instructions/`)

Module for dynamically generating instruction files:

```typescript
type InstructionSource = 'chat' | 'orchestrator' | 'schedule' | 'standalone-task';

interface InstructionContext {
  source: InstructionSource;
  tool: ToolName;
  // ... context-specific fields
}

function buildInstruction(ctx: InstructionContext): string;
function resolveInstruction(...): string;
```

- Assembles instruction file content per source
- `sections.ts` manages section templates (tool identification, MCP policy, etc.)

### Per-Source Template Generation

`buildInstruction()` composes different sections based on `InstructionSource`:

| Section | `chat` | `orchestrator` | `schedule` | `standalone-task` |
|---------|--------|----------------|------------|-------------------|
| Identity | Tool name + Slack context | Tool name + orchestrator role | Tool name + scheduled context | Tool name + standalone context |
| Core Principles | Full (intent, quality, clarify, language, actionable) | Condensed (focus on task completion) | Condensed | Condensed |
| Environment | Session persistence, Slack streaming | Workdir isolation, node-scoped | Workdir isolation, cron-triggered | Workdir isolation, one-shot |
| Constraints | Mode-dependent (read/write) | Always write mode | Always write mode | Mode-dependent |
| Output Files | `_output/` routing | `_output/` routing | `_output/` routing | `_output/` routing |
| MCP Policy | Conditional on `allowMcp` | Conditional on `allowMcp` | Conditional on `allowMcp` | Conditional on `allowMcp` |
| Response Format | `<!-- answer -->` marker | `<!-- answer -->` marker | `<!-- answer -->` marker | `<!-- answer -->` marker |

`resolveInstruction()` handles three modes:
1. **Full-replace**: Custom instruction enabled → entire file is the custom content
2. **Task-specific append**: Base template + task `instructionFile` appended as "Additional Instructions"
3. **Normal**: Base template + default instruction (from DefaultInstructionStore) as "Additional Instructions"

---

## AppContext (`src/context/`)

Shared application context extracted from `src/slack/app-types.ts`:

```typescript
interface AppContext {
  config: Config;
  webClient: SlackClientSurface;  // Narrow Slack Web API surface
  sessionManager: SessionManager;
  jobQueue: JobQueue;
  workdirManager: WorkdirManager;
  dedupeStore: DedupeStore;
  auditStore: AuditStore;
  conversationStore: ConversationStore;
  defaultInstructionStore: DefaultInstructionStore;
  devAliasStore: DevAliasStore;
  sessionMcpServerStore: SessionMcpServerStore;
  scheduleStore: ScheduleStore;
  ondemandTaskStore: OndemandTaskStore;
  orchestratorStore: OrchestratorStore;
  orchestratorEngine: OrchestratorEngine;
  eventSubscriptionStore: EventSubscriptionStore;
  triggeredTaskStore: TriggeredTaskStore;
  webhookEndpointStore: WebhookEndpointStore;
  webhookDeliveryStore: WebhookDeliveryStore;
  eventRouter: EventRouter;
  triggeredTaskExecutor: TriggeredTaskExecutor;
  webhookSecretStore: WebhookSecretStore;
  // In-memory maps
  pendingConfirmations: ExpiringMap<string, PendingConfirmation>;
  pendingToolApprovals: ExpiringMap<string, PendingToolApproval>;
  pendingMcpAuthBypassApprovals: ExpiringMap<string, PendingMcpAuthBypassApproval>;
  activeRunners: Map<string, ActiveRunner>;
  jobEventStreams: Map<string, Function>;
}
```

- Slack Bolt `App` is held only by `AppRuntime` / Slack registration code. Shared domain context keeps the narrower `webClient` contract so Dashboard, Event, and Server layers do not depend on `@slack/bolt`.
- `SessionMcpServerStore` manages the session-scoped MCP allowlist overlay in `session_mcp_servers`.
- Slack adds a dedicated `!mcp` command family for listing, toggling, and resetting the active session MCP allowlist.
- `src/context/context-slices.ts` defines additive slice types such as `ApprovalSlice` and `JobLifecycleSlice`. These do not change the runtime `AppContext` shape; they only narrow helper-module signatures to the minimum dependency set.

---

## Error Model

### Classification by DriverEvent.type

- **`text`** — Assistant output; forwarded to Messenger
- **`tool_use`** — Tool invocation request; evaluated by approval gate
- **`tool_result`** — Tool result; displayed (truncated to 400 characters)
- **`error`** — Fatal error; stops the job
- **`status`** — Non-fatal warning/info; logged only
- **`done`** — Job complete; proceeds to post-processing

### Audit error_kind Classification

- **`spawn_error: <msg>`** — Process spawn failure
- **`exit_<code>`** — Non-zero exit
- **`killed`** — Forcefully terminated by SIGKILL
- **`max_runtime_timeout`** — Exceeded MAX_RUNTIME_SEC
- **`no_output_timeout`** — Exceeded NO_OUTPUT_TIMEOUT_SEC
- **`process_restart`** — Interrupted by daemon restart before job completion
- **`orchestrator_shutdown`** — Interrupted by orchestrator shutdown
- **`permission_approval_needed`** — Policy denial, awaiting approval
- **`mcp_auth_required`** — MCP authentication failure
- **`dashboard_stop`** — Job stopped from Dashboard UI
- **`client_disconnect`** — Dashboard SSE client disconnected
