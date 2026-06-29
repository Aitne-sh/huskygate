# Slack Integration

> Slack command contract, job lifecycle, approval model, Block Kit dashboard

---

## Slack Command Contract

Complete command reference is maintained in [commands.md](commands.md) (SSOT).

> **Note**: `stop`, `status`, `reset`, `mode=*`, `confirm`, `workdir*` all require the `!` prefix.
> The legacy `tool=<tool>` syntax has been deprecated (processed as a prompt).

### Session Constraints

- Switching to another tool during an active session is rejected (`!exit` required)
- **Dev session switching follows the same rule**: `!dev <alias>` / `!new-dev <alias>` require `!exit` when an active session exists (except when resuming the same dev session)
- **Auto `!exit` after idle timeout** (default: 24 hours, configurable via `SESSION_IDLE_TIMEOUT_SEC` in settings)
- On auto exit: clears MCP auth bypass state plus Claude MCP auth retry-approval suppression, discards all pending confirmations/approvals, sets `active_session_key` to NULL

---

## Job Lifecycle

### Event Processing Flow

1. Received via `app.event('message')`
2. Filter out bot/subtype messages
3. Authorization check (DM + `ALLOWED_USER_IDS` + optional `ALLOWED_TEAM_ID`)
4. Atomic dedupe register (`event_id`, TTL 24 hours)
5. Generate `threadKey = channelId:threadTs`
6. Resolve thread's active session
7. **Pending approval priority**: if tool approval/MCP auth approval is pending, process `!yes/!y` / `!no/!n` first
8. Parse command with parser
9. Command dispatch
10. If `prompt` → submit to `JobQueue`

### Execution Flow

1. Dequeue job from queue
2. **Claude session_id pre-store**: for Claude, save `session_id` to tool_state before execution (preserves session history even on early kill)
3. Driver builds CLI args/env
4. `Runner` executes via `spawn(command, args, { detached: true, stdio: 'pipe' })`
5. Normalize stdout/stderr to `DriverEvent` line by line
6. `Messenger` performs throttled updates and split posting
   - Slack API rate-limit retries honor provider `Retry-After` hints when present and fall back to capped exponential backoff otherwise
7. On completion:
   - Update audit log
   - Merge tool_state (clear sticky keys)
   - If approval/MCP auth is required, interrupt immediately and send approval message to Slack
   - Upload large logs as file attachments
   - User-facing attachment warnings must be normalized to safe text; raw download/redirect details remain in server logs only

For standalone on-demand task launches from Slack, queue/setup failures must clean up the newly created standalone session and workdir before posting the failure message back to the thread.

### Slack Output Prefix

```
[app:<tool>/session-id:<sessionId>]
```

### Answer Text Extraction

Text extraction from responses containing tool executions uses a 3-stage fallback:

1. Text after the last `tool_use`/`tool_result` (excluding thinking)
2. `result` event (Claude-specific final message)
3. Concatenation of all text events

---

## Approval Model

### Tool Permission Approval

- **Applies to**: `claude`, `gemini`, `codex`
- Detects policy rejection, immediately stops job, requests permission via Slack
- **Approval is limited to the requesting user**
- **Expiration**: 2 minutes (`TOOL_APPROVAL_TIMEOUT_MS = 120_000`, hardcoded)
- **One-shot**: a single approval grants one additional tool call
- In re-execution chains, approved tool calls are retained and concatenated

**Approval prompt display:**
- Shows tool name and arguments (arguments truncated to max 1400 characters: `TOOL_APPROVAL_ARGS_MAX_CHARS`)
- Tool results displayed with max 400 characters (`TOOL_RESULT_DISPLAY_LIMIT`)

### Unified Voluntary-Stop Approach (MCP Tool Approval)

All 3 tools (Claude/Gemini/Codex) use the same pattern:

1. **Instruction files**: `<mcp_tool_policy>` in `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`
2. **AI voluntary stop**: outputs `[MCP_TOOL_REQUEST]` block before MCP tool call, then ends response
3. **Detection**:
   - Claude: `detectClaudeMcpVoluntaryStop(allEvents)` — detects from DriverEvent array
   - Gemini/Codex: `detectMcpVoluntaryStopFromText(textBuffer)` — detects from text buffer
   - Codex references `textBuffer` via `--output-last-message` file
4. **Strip**: Gemini/Codex use `messenger.replaceBuffer()` to remove `[MCP_TOOL_REQUEST]` block from Slack messages
5. **Approval prompt**: displays `!yes/!y` / `!no/!n`
6. **Re-execution**: adds tool to allowlist and re-executes with `--resume`
7. **Defense layers**: (1) instruction file voluntary stop -> (2) proactive gate (tool_use event) -> (3) text rejection detection (Claude only)

### MCP Auth Approval

- **Claude**: `retry_with_preauth` / `skip_preflight_once` approval flow with `!yes/!y` on preflight failure
- **Gemini**: both switch/post-run require **no user approval** (automatic bypass/auto-retry)
- **Codex**: auto-authentication attempt on runtime detection; auto re-execution once if successful
- **Expiration** (Claude): 2 minutes (`MCP_AUTH_BYPASS_TIMEOUT_MS = 120_000`)
- Claude persists a session-level "approval completed" marker after retry approval and suppresses repeated approval prompts until the session is explicitly exited/reset
- Prevents infinite re-approval/retry loops within the same request and across repeated retries in the same session

### Mode/Workdir Confirmation

- **Challenge code**: 4 characters (character set: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — confusable characters excluded)
- **Entropy**: 36^4 = 1,679,616 combinations
- **Expiration**: 30 seconds
- **User-restricted**: only the requester can confirm
- `PendingModeConfirmation` and `PendingWorkdirConfirmation` are managed in separate in-memory structures

---

## Message Formatting

### Block Kit `markdown` Block Strategy

LLM outputs (Claude, Codex, Gemini) produce standard Markdown. HuskyGate renders them in Slack using the `markdown` block type, which natively supports headings, bold/italic, tables, code blocks with syntax highlighting, ordered/unordered lists, task lists, horizontal rules, and links.

### Message Structure

```
┌─────────────────────────────────────────┐
│ section block (mrkdwn)                  │  ← mentions, status, metadata
├─────────────────────────────────────────┤
│ markdown block                          │  ← LLM output (standard Markdown)
├─────────────────────────────────────────┤
│ context block (mrkdwn)                  │  ← compact metadata footer
└─────────────────────────────────────────┘
```

- **Header** (`section` mrkdwn): Supports Slack mentions (`<@U...>`, `<#C...>`), emoji, metadata
- **Body** (`markdown`): Standard Markdown, up to 12K cumulative chars per message
- **Footer** (`context` mrkdwn): Compact status line

### Size Limits & Splitting

| Threshold | Behavior |
|-----------|----------|
| ≤ 11,500 chars | Single message (header + markdown + footer) |
| 11,501 – 40,000 chars | Split into multiple messages; first gets header, subsequent get continuation label |
| > 40,000 chars | Preview in markdown block + full output as `.md` file upload |

Splitting respects Markdown structure: never splits inside code fences or tables, prefers heading boundaries.

### Surface Coverage

| Surface | Method |
|---------|--------|
| Chat session final output | `Messenger.postFinalWithMarkdown()` — markdown blocks |
| Chat session streaming | `Messenger.appendText()` — plain text (performance) |
| Schedule/OnDemand/Triggered task results | `buildTaskCompletionBlocks()` — section + markdown + context |
| Orchestrator execution summary | `buildSummaryBlocks()` — section + markdown |
| Orchestrator error/fallback | `buildMarkdownMessage()` — section + markdown |
| Tool approval arguments | `buildToolApprovalBlocks()` — section + markdown + actions + context |
| Assistant thread output | `buildMarkdownMessage()` — markdown blocks |
| Streaming error events | `wrapForMrkdwn()` — inline code / code block (plain text) |

### Key Constraints

- `markdown` block does NOT support Slack mentions — always use `section` (mrkdwn) for mentions
- 12,000 char cumulative limit across all `markdown` blocks per message payload
- All messages include `text` fallback for non-Block Kit clients
- Max 50 blocks per message (enforced in builders)

### Key Files

- `src/slack/markdown-blocks.ts` — Block Kit markdown builders (`buildMarkdownMessage`, `buildTaskCompletionBlocks`, `buildSummaryBlocks`, `splitMarkdownForBlocks`)
- `src/slack/block-kit.ts` — Approval and interactive Block Kit builders
- `src/shared/text-utils.ts` — Markdown-aware text splitting utilities (fence boundary detection)
- `src/utils/sanitize.ts` — `wrapForMrkdwn()` for safe mrkdwn wrapping in non-markdown-block contexts

---

## Slack Interactive Dashboard (Block Kit `!menu`)

Interactive dashboard displayed by the `!menu` command using Block Kit. Enables one-click execution of key operations via buttons and selectors.

**File structure:**
- `block-kit.ts` — Block Kit block builder (Action ID definitions + builder functions)
- `actions/` — Handlers for button/selector operations (split into domain modules)
  - `register.ts` — Action registration facade
  - `approval.ts` — Tool approve/reject + MCP auth approve/reject
  - `session.ts` — Session resume, mode select, tool select
  - `dashboard-menu.ts` — Dashboard menu button actions
  - `dev-selection.ts` — Dev alias selection

### Action ID List

- `proxy_tool_approve` — Button — Tool approval
- `proxy_tool_reject` — Button — Tool rejection
- `proxy_mcp_auth_approve` — Button — MCP auth approval
- `proxy_mcp_auth_reject` — Button — MCP auth rejection
- `proxy_session_resume` — Button — Session resume
- `proxy_mode_select` — StaticSelect — Mode switch (readonly/write)
- `proxy_menu_tool_select` — Button — Tool selection (gemini/claude/codex)
- `proxy_menu_exit` — Button — Leave active session
- `proxy_menu_stop` — Button (danger) — Stop running job
- `proxy_menu_new_session` — Button — Create new session (with current tool)
- `proxy_menu_reset` — Button (danger) — Reset session conversation context
- `proxy_menu_dev_select` — Button (suffixed) — Create/resume Dev alias session

### Dashboard Layouts

**With active session:**
```
┌─ :zap: HuskyGate Dashboard ──────────────────────┐
│ Active Session: `abc12345`                        │
│ App: claude | Mode: readonly                      │
│ Model: default                                    │
│ Workdir: `/path/to/workdir`                       │
│ ✅ Idle                                           │
├───────────────────────────────────────────────────┤
│ [🛑 Stop] [🚪 Exit] [🆕 New Session] [🗑️ Reset] │
├───────────────────────────────────────────────────┤
│ Mode: [readonly ▾]                                │
├── Dev Environments ──────────────────────────────│
│ [alias1 (claude)] [alias2 (gemini)]               │
├── Other Sessions ────────────────────────────────│
│ `session2` | gemini  [Resume]                     │
└───────────────────────────────────────────────────┘
```

Session visibility and actions in `!menu` / `!sessions` are scoped to the current DM thread and the requesting Slack user. Resume, delete, and clear-all actions must only target sessions already registered to that exact `threadKey + userId`; cross-thread or cross-user session adoption is not allowed from Slack.

**Without active session:**
```
┌─ :zap: HuskyGate Dashboard ──────────────────────┐
│ 👋 Welcome back to HuskyGate!                     │
│ An AI gateway to run Claude / Gemini / Codex CLI  │
│ from Slack.                                       │
│ Select a tool to start a session:                 │
├───────────────────────────────────────────────────┤
│ [gemini] [claude] [codex]                         │
├── Dev Environments ──────────────────────────────│
│ [alias1 (claude)] [alias2 (gemini)]               │
├── Existing Sessions ─────────────────────────────│
│ `session1` | claude  [Resume]                     │
└───────────────────────────────────────────────────┘
```

### Dev Alias Button Layout

- `DEV_ALIAS_BUTTONS_PER_ROW = 5` — split into ActionsBlock groups of 5
- If there are 0 dev aliases, the entire section is hidden
- Button action_id: `proxy_menu_dev_select_<alias_name>` (suffix-based, matched via RegExp)
- Button value: `{ tk: threadKey, alias: "<name>" }`

### Handler Descriptions

**New Session handler:** Creates a new session with the active session's tool, then executes `maybeRunSwitchPreflight`. Displays error if no active session exists.

**Reset handler:** Stops job, cancels all queued items, resets session, clears all pending state (confirmations/toolApprovals/mcpAuthBypassApprovals).

**Dev Select handler:** Checks alias existence, checks for active session conflict, searches for existing dev session, then resumes or creates new (including `seedDevInstructionFile`).

---

## Auto-Approve Logic (`src/slack/auto-approve.ts`)

`resolveAutoApprove(config, mode, jobAutoApprove, toolState)` determines whether auto-approve is active for a job.

**Precedence chain** (highest to lowest):
1. **Readonly mode** — always disables auto-approve (security constraint)
2. **Job-level override** — explicit `autoApprove` flag on the Job
3. **Session toggle** — per-session toolState `autoApprove` set via `!autorun` command (`!autorun on` / `!autorun off`)
4. **Global config** — `TOOL_AUTO_APPROVE_MODE` env var

Returns `boolean`. Used by the job executor to decide whether to pass `--dangerously-skip-permissions` (Claude) or equivalent flags to other drivers.

---

## Tool State Utilities (`src/slack/tools/tool-state-utils.ts`)

Shared helpers for reading and mutating toolState across tool plugins:

- **`readToolStateString(toolState, key)`** — Returns trimmed string or `null`; safe accessor for arbitrary toolState keys
- **`isMcpPreflightMarker(toolState, key, server)`** — Checks whether MCP auth preflight has been completed for a given server
- **`setMcpPreflightMarker(toolState, key, server)`** — Sets the marker, returning a new ToolState (immutable pattern)
- **`formatMcpAuthGenericFailure(driverLabel, server, exitCode, errorKind, hint?)`** — Template-based error message builder for MCP auth failures across all drivers
