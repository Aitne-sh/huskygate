# Tool Drivers

> Detailed specifications of the Claude, Gemini, and Codex CLI drivers.
> Each driver implements the `Driver` interface (`src/runner/types.ts`),
> responsible for command construction, argument generation, environment variable injection, event parsing, and session state extraction.

---

## Driver Interface

```typescript
interface Driver {
  readonly name: ToolName;           // 'claude' | 'gemini' | 'codex'
  buildCommand(): string;            // CLI binary path
  buildArgs(prompt, session, mode, options): string[];
  buildEnv(): Record<string, string>;
  parseEvent(line: string): DriverEvent | null;     // stdout JSONL parsing
  parseStderr(line: string): DriverEvent | null;    // stderr parsing
  extractSessionState(events: DriverEvent[]): ToolState;
}
```

### DriverEvent Types

- `text` — Assistant text output
- `tool_use` — Tool call start
- `tool_result` — Tool execution result
- `error` — Error message
- `status` — Session ID, non-fatal information
- `done` — Stream complete

### Aggregate Text Events

Claude and Codex emit aggregate events (`result`, `response.output_text.done`, `turn.completed`, etc.) containing the same text after delta streaming. These are identified via `AGGREGATE_TEXT_RAW_TYPES` and filtered from real-time streams (SSE/Slack). They are retained in `allEvents[]` and used for `extractAnswerText()` fallback.

---

## 1. Claude

**Source:** `src/runner/driver-claude.ts`

### 1-1. Command Construction

```
claude -p "<prompt>" --output-format stream-json --verbose
```

- `-p` : prompt string
- `--output-format stream-json` : JSONL streaming output
- `--verbose` : detailed output of tool_use / tool_result events

### 1-2. Command Resolution

Priority order:

1. Environment variable `CLAUDE_COMMAND` or `CLAUDE_BIN`
2. Cached result
3. `resolveCommand('claude')` (login shell PATH)
4. `findInFallbackDirs('claude')` (known install dirs: `~/.local/bin`, etc.)
5. Fallback: `'claude'` (bare name)

Unified implementation via `createDriverCommandResolver` factory. Result is cached in-process.

### 1-3. Arguments

- `--model` — When `session.toolState.model` or `CLAUDE_MODEL` env is set: model name
- `--setting-sources` — Default: `project`. When `session.toolState.claude_setting_sources` is set: validated combination of `user,project,local`
- `--mcp-config <path>` + `--strict-mcp-config` — When HuskyGate generated a Claude MCP config file for the session workdir
- `--resume <sessionId>` — When `session.toolState.session_id` exists: continue existing session
- `--session-id <uuid>` — When session_id does not exist: new session (UUID v4 generated)
- `--permission-mode` — readonly: `plan` or `default` / write: `default`: permission mode
- `--allowed-tools` — Mode-dependent core tools + user tools: multiple values

**Readonly tools (pre-approved):**
`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`

**Write tools (pre-approved):**
Above + `Write`, `Edit`, `Bash`, `NotebookEdit`
- When skills are enabled: `Skill` added
- When auto-approve + MCP allowed: `mcp__*` added

**Readonly whitelist enforcement:**
In readonly mode, all tools not in the `CORE_READONLY_TOOLS` set (defined in `shared/core-tools.ts`) are excluded.
Even if an operator injects mutation tools via `claude_runtime_allowed_tools`, they are removed in readonly mode. `--permission-mode` functions as a second defense layer.

**Claude MCP config source:**
- Phase 1 no longer treats `~/.claude.json` as HuskyGate-managed state.
- Claude MCP server definitions are loaded from SQLite and rendered into a generated JSON file under the session workdir.
- HuskyGate passes that generated file via `--mcp-config` together with `--strict-mcp-config`, so Claude only sees HuskyGate-managed MCP servers for that run.
- This avoids overwriting project-owned `.mcp.json` files in dev alias or custom workdirs, and refuses to clobber a user-owned canonical generated path by falling back to a unique file under `.huskygate/`.

### 1-4. Environment Variable Passthrough

`buildDriverEnv('claude')` injects the following:

- **Safe system env:** PATH, HOME, SHELL, TERM, LANG, LC_*, XDG_*, proxy/TLS related
- **Claude-specific:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_MCP_CONFIG_PATH`
- **Cloud provider env** (AWS_*, AZURE_*, GOOGLE_*, etc.): conditionally merged by job executor

`CLAUDE_MCP_CONFIG_PATH` remains pass-through compatible for operators, but HuskyGate's managed Claude MCP execution path passes an explicit generated config via CLI arguments and removes `CLAUDE_MCP_CONFIG_PATH` from that subprocess environment to avoid ambiguity.

### 1-5. Session ID Pre-store

The Claude driver generates a session ID using `crypto.randomUUID()` when starting a new session and passes it via `--session-id`. This ensures:

1. Guaranteed match with the `session_id` in the `message_start` event
2. Session ID is known even on process kill, enabling recovery via `--resume`
3. Pre-stored in session manager, avoiding session_id conflicts with MCP auth preflight

### 1-6. Claude MCP Auth Path

MCP authentication lifecycle (5 steps):

1. **Switch Preflight (on session switch)**
   - Automatically executed on tool switch via `!claude`
   - Generates the per-workdir Claude MCP config before running preflight commands
   - `runClaudeMcpAuthPreflight()` checks connectivity and token validity for target MCP servers
   - Success: recorded in `claude_mcp_auth_verified_server`
   - Failure (auth required / token refresh failed): displays auth request message + approval prompt on Slack

2. **Job Preflight (before job execution)**
   - Generates the per-workdir Claude MCP config from SQLite before execution
   - When `allowMcp=false`, writes an empty strict config instead of removing the file
   - Checks `verified` / `bypassed` state before each job starts
   - Unauthenticated: runs preflight; if successful, sets `verified`; if failed, initiates approval flow
   - Can skip once with `claude_skip_mcp_preflight_once` flag (for auto-rerun)

3. **Token Auto-Refresh (during execution)**
   - Detects `MCP connection error` / `Auth required` / `Token refresh failed` on stderr during execution
   - Classified as non-fatal pattern and treated as status event
   - HuskyGate fallback refresh is only allowed when `HUSKYGATE_OAUTH_TRUSTED_HOSTS` explicitly trusts the issuer / token endpoint hosts
   - Refresh is serialized per credentials file + server, and write-back aborts if the credentials entry changed during the refresh round-trip

4. **Post-Run Recovery (after execution)**
   - On `mcp_auth_required` error detection, automatically attempts re-authentication
   - Success: updates `verified` + submits auto-retry job with `claude_skip_mcp_preflight_once`
   - Failure: displays error message

5. **Approval Bypass**
   - On authentication timeout, user can bypass with `!yes` / `!y`
   - Sets `claude_mcp_auth_bypass_server`, skipping subsequent preflights

### 1-7. Claude MCP Tool Approval (voluntary-stop)

MCP tool approval operates via the voluntary-stop approach (7 elements):

1. **Instruction file control:**
   Instructions define the `[MCP_TOOL_REQUEST]` block format. Claude outputs this block before MCP tool calls and voluntarily stops.

2. **Allowlist Gate (Layer 4):**
   `createAllowlistToolApprovalGate()` builds an allowlist from `claude_runtime_allowed_tools`. Evaluates `tool_use` events during streaming and blocks unauthorized tools.

3. **Voluntary Stop detection:**
   `detectClaudeMcpVoluntaryStop()` detects `[MCP_TOOL_REQUEST]` blocks from text output. Extracts tool name and arguments (JSON).

4. **Permission Denied detection:**
   `detectClaudeTextPermissionDenied()` detects Claude CLI text-based rejection messages (`"Claude requested permissions to use..."`). CLI-level denial and voluntary-stop are handled exclusively.

5. **Approval prompt:**
   Displays an approval prompt on Slack for blocked tools. Users approve with `!yes` / `!y` or reject with `!no` / `!n`.

6. **Re-execution after approval:**
   Merges approved tools into `claude_runtime_allowed_tools`. Submits retry job with `TOOL_APPROVAL_RERUN_KEY`.

7. **Glob pattern support:**
   Trailing wildcard patterns like `mcp__awsapi__*` enable bulk approval per MCP server.
   Wildcard entries are never reduced to a short-name alias; only concrete MCP tool names can produce short-name approvals.
   One-shot approval entry points (Slack and Dashboard/API) must reject wildcard tool names and require an exact tool call.

---

## 2. Gemini

**Source:** `src/runner/driver-gemini.ts`

### 2-1. Command Construction

```
gemini -p "<prompt>" --output-format stream-json --sandbox
```

- readonly: `--sandbox` (read_file, grep_search, cli_help only)
- write: `--approval-mode yolo` (all tools auto-approved)

### 2-2. Command Resolution

Priority order:

1. Environment variable `GEMINI_COMMAND` or `GEMINI_BIN`
2. Cached result
3. `resolveCommand('gemini')` (login shell PATH)
4. `findInFallbackDirs('gemini')` (known install dirs)
5. npx fallback: `npx --yes @google/gemini-cli` (prefix args approach)
6. Fallback: `'gemini'` (bare name)

Gemini returns command and prefix args in a `ResolvedGeminiCommand` struct. When using npx, `command` is `npx` and `prefixArgs` is `['--yes', '@google/gemini-cli']`.

### 2-3. Arguments

- `--model` — When `session.toolState.model` or `GEMINI_MODEL` env is set: model name
- `--approval-mode yolo` — In write mode: all tools auto-approved
- `--sandbox` — In readonly mode: read-only tools only
- `--approval-mode plan` — readonly + `GEMINI_READONLY_APPROVAL_MODE=plan`: plan mode
- `--resume <sessionIndex>` — When `session_index` exists + `gemini_resume_ready`: session resume
- `--allowed-tools` — Readonly mode only (not needed in write mode with yolo): `gemini_runtime_allowed_tools`

**Write mode MCP restriction:**
Gemini CLI's yolo mode cannot restrict MCP tools via `--allowed-tools` (`--allowed-tools` is deprecated in >=1.0). Defense-in-depth is implemented through other layers:
- `buildDriverEnv` does not pass cloud env vars
- `seedBuiltinSkills` does not seed skill files
- Job executor performs post-hoc kill on MCP tool usage

**Readonly MCP defense:**
In readonly mode, tools with `mcp_*` / `mcp__*` prefix are removed from `gemini_runtime_allowed_tools`.

### 2-4. Gemini Runtime Home Preparation

**Source:** `src/runner/gemini-runtime-home.ts`

Gemini CLI stores settings and credentials in `~/.gemini/` (or `GEMINI_CLI_HOME`). An independent runtime home is prepared per job to prevent OAuth token interference between sessions.

#### Lifecycle

**Prepare phase (`prepareGeminiRuntimeHome()`):**

1. Resolve source home: `GEMINI_CLI_HOME` or `$HOME`
2. Create runtime home: `<workdir>/.gemini_runtime_home/.gemini/`
3. Read global `settings.json` only to preserve non-MCP keys, then inject DB-backed `mcpServers`
4. Copy `mcp-oauth-tokens.json` + repair processing
5. Copy `oauth_creds.json`, `google_accounts.json`
6. Seed `projects.json` when missing so Gemini CLI startup cleanup does not race on first-run registry creation

**Token repair processing:**
- **Alias repair:** When credentials for the target server name don't exist, clone from the same URL / same host / legacy name (`aws-cli-mcp`)
- **URL normalization:** Normalize and verify match between credential's `mcpServerUrl` and settings' `httpUrl`/`url`
- **OAuth disable:** When `serverConfig.oauth` exists, remove it in the runtime copy (prevents OAuth flow launch in headless environments)

**Use phase:**
- Set the `GEMINI_CLI_HOME` environment variable to the runtime home and launch the CLI
- CLI uses the runtime home credentials

**Cleanup phase (`cleanupGeminiRuntimeHome()`):**
- Delete `oauth_creds.json`, `google_accounts.json`, `mcp-oauth-tokens.json` from runtime home
- Prevents OAuth tokens from persisting in workdir

#### Folder Structure

```
<workdir>/
  .gemini_runtime_home/           # Set as GEMINI_CLI_HOME
    .gemini/
      settings.json               # DB-backed MCP settings + preserved non-MCP keys
      mcp-oauth-tokens.json       # Tokens (alias repair + URL normalization applied)
      oauth_creds.json            # Google OAuth credentials copy
      google_accounts.json        # Google account information copy
      projects.json               # Seeded empty registry on first prepare to avoid Gemini CLI bootstrap race
```

### 2-5. Gemini MCP Auth Path

Manages MCP authentication with a different flow from Claude:

1. **Switch Preflight:**
   - Runs fast preflight (`runGeminiMcpAuthPreflight()`)
   - On failure: attempts interactive auth (`runGeminiInteractiveMcpAuth()`)
     - Posts OAuth URL to Slack, prompting user for browser authentication
     - `noOutputTimeoutSec: 120` for OAuth callback wait
   - Interactive also fails: auto-bypass (sets `gemini_mcp_auth_bypass_server`)

2. **Job Preflight:**
   - 3-state management: `initialized` / `verified` / `bypassed`
   - Unauthenticated: preflight; if successful, sets `initialized` + `verified`
   - Failure: approval flow (skip_preflight_once approach)

3. **Post-Run Recovery:**
   - On `mcp_auth_required` detection, automatically attempts interactive auth
   - Posts OAuth URL to Slack, waits for user to complete authentication
   - Success: `gemini_skip_mcp_preflight_once` + auto-rerun
   - Failure / loop detection: provides local authentication command guidance

4. **Runtime Home Integration:**
   - Calls `prepareGeminiRuntimeHome()` for switch preflight, job preflight, post-run auth recovery, and main run
   - Overrides `GEMINI_CLI_HOME` environment variable to runtime home
   - When `allowMcp=false`, runtime home is still isolated but `mcpServers` is rendered empty

### 2-6. Gemini Resume Error Detection

Gemini CLI emits specific patterns on `--resume` failure:

- `gemini_resume_ready` flag controls whether resume is possible
- Obtains session UUID from `session_id` in the `init` event
- If no `init` event arrives: falls back to `session_index: 'latest'` after `done` event
- Retry decision based on exit code + error kind

Non-fatal stderr patterns (Gemini-specific):
- `Loaded cached credentials`
- `Found stored OAuth token for server`
- `Loading extension:`
- `YOLO mode is enabled`
- `[MCP error]` / `McpError:`
- `Skill conflict detected:`
- capacity exhaustion messages
- deprecated `--allowed-tools` warning

---

## 3. Codex

**Source:** `src/runner/driver-codex.ts`

### 3-1. Command Construction

```
codex -s <sandbox-mode> -a <approval-policy> exec --json -- <prompt>
```

- `-s read-only` / `-s workspace-write`: sandbox mode
- `-a on-request` / `-a never`: approval policy
- `exec --json`: JSON streaming mode
- `resume --json <thread_id>`: session resume subcommand

### 3-2. Command Resolution

Priority order:

1. Environment variable `CODEX_COMMAND` or `CODEX_BIN`
2. Cached result
3. **Platform fallback (macOS app bundle):** checks for `/Applications/Codex.app/Contents/Resources/codex`
4. `resolveCommand('codex')` (login shell PATH)
5. `findInFallbackDirs('codex')` (known install dirs)
6. Fallback: `'codex'` (bare name)

### 3-3. Arguments

- `-s` — Mode-dependent: `read-only` / `workspace-write`
- `-a` — Per policy determination below: `on-request` / `never` / `on-failure` / `untrusted`
- `-c sandbox_workspace_write.network_access=true` — In write mode: enables network access
- `--disable responses_websockets` — Always: disables WebSocket transport
- `--disable responses_websockets_v2` — Always: disables WebSocket v2 transport
- `-m` — When `session.toolState.model` or `CODEX_MODEL` env is set: model name
- `--skip-git-repo-check` — When `codex_skip_git_repo_check === true`: skip Git repo verification

**Approval Policy determination logic:**

```
readonly → codex_ask_for_approval override ?? 'on-request'
write + auto-approve → 'never'
write + no auto-approve → codex_ask_for_approval override ?? 'on-request'
```

Defense-in-depth: `'never'` is not used in readonly mode. Since MCP tools operate outside the sandbox, an approval prompt is needed. `resolveAutoApprove()` guarantees `autoApproveEnabled=false` in readonly, but the driver provides double defense.

**WebSocket disabling:**
`responses_websockets` / `responses_websockets_v2` features can be enabled by server-side rollout, but in headless spawned-process environments (no TTY, sandbox), WebSocket connections fail with 5 retries + fallback delays. SSE/HTTP is sufficient for `exec --json` streaming.

**Resume syntax:**

```
codex -s <mode> -a <policy> exec resume --json <thread_id> -- <prompt>
```

`resume` is a subcommand of `exec`. `--json` is a resume-level option.

### 3-4. Approval Re-execution

Codex tool approval operates on 2 layers:

1. **Codex CLI `-a` policy:** `on-request` causes the CLI to issue an approval prompt; in headless mode, voluntary-stop detection is used
2. **HuskyGate voluntary-stop:** detects `[MCP_TOOL_REQUEST]` block, shows approval prompt on Slack, then re-executes with `TOOL_APPROVAL_RERUN_KEY` after approval

`detectMcpVoluntaryStopFromText()` can also detect voluntary-stop from Codex's `--output-last-message` file output.

### 3-5. Codex MCP Auth Path

Codex's MCP authentication is simpler than Claude/Gemini:

1. **Switch Preflight:**
   - Runs `runCodexMcpAuthPreflight()` for authentication verification
   - Success: sets `codex_mcp_auth_verified_server`
   - Failure: displays error message (no approval prompt)

2. **Job Preflight:**
   - Checks `verified` state; runs preflight if unauthenticated
   - Unlike Claude/Gemini, has no bypass mechanism

3. **Post-Run Recovery:**
   - Retrieves available server list via `codex mcp list`
   - Selects server via `selectCodexMcpAuthServer()`
   - `Auth=Unsupported` check: early detection of servers without OAuth support
   - Authentication success: retry with `codex_mcp_auth_auto_rerun`
   - Failure: detailed error + bearer token configuration guidance

4. **Server Discovery:**
   - Explicitly set via `CODEX_MCP_AUTH_SERVER` environment variable
   - If not set: auto-selected from `codex mcp list` results

---

## 4. Shared Infrastructure

### 4-1. Driver Command Resolver Factory

`createDriverCommandResolver(config)` provides a common command resolution pattern for all drivers:

```
env override → cache → platformFallback → resolveCommand → findInFallbackDirs → bare name
```

### 4-2. Environment Variable Builder

`buildDriverEnv(tool)` composition:

1. `buildSafeSystemEnv()`: shell/terminal, locale, XDG, proxy/TLS only
2. `collectDriverSpecificEnv(tool)`: tool-specific API keys and config paths
3. Cloud provider env (AWS_*, AZURE_*, GOOGLE_*): conditionally merged by job executor
4. Skill env: conditionally merged via `collectSkillEnv()` based on skill configuration

**Security boundary:** Only the minimum required environment variables are passed to driver processes. API keys for other drivers, daemon tokens, and application secrets are excluded.

### 4-3. Non-Fatal Stderr Patterns

Shared patterns (`SHARED_NON_FATAL_STDERR_PATTERNS`):
- `Error during discovery for MCP server`
- `Refreshing expired token for MCP server`
- `MCP server '...' requires authentication`

Each driver adds its own specific patterns in the `NON_FATAL_STDERR_PATTERNS` array. Non-fatal stderr is processed as `status` events.

### 4-4. MCP Tool Approval (Voluntary-Stop)

`[MCP_TOOL_REQUEST]` block detection common to all drivers:

```
[MCP_TOOL_REQUEST]
tool: mcp__server__tool_name
arguments:
```json
{"key": "value"}
```
[/MCP_TOOL_REQUEST]
```

- `parseClaudeMcpToolRequest()`: block parsing (common to all drivers)
- `detectMcpVoluntaryStopFromText()`: text-based detection (all drivers)
- `detectClaudeMcpVoluntaryStop()`: Claude event-based detection
- `extractMcpShortToolName()`: `mcp__server__tool` to `tool` conversion

### 4-5. Allowlist Tool Approval Gate

Shared tool allowlist mechanism for Claude and Gemini:

- `createAllowlistToolApprovalGate()`: builds allowlist from toolState
- `evaluateAllowlistToolUseForApproval()`: evaluates tool_use events
- Trailing wildcard support: `mcp__server__*` for per-server approval
- `mergeApprovedAllowlistTools()`: list merge after approval

Codex uses CLI-level control via the `-a` policy, so the allowlist gate is not used.

---

## 5. Codex Runtime Home

**Source:** `src/runner/codex-runtime-home.ts`

Provides an isolation mechanism for Codex similar to Gemini Runtime Home.

### 5-1. Overview

Codex CLI stores authentication and settings in `~/.codex/` (or `CODEX_HOME`). `prepareCodexRuntimeHome()` creates an independent runtime home within the job's workdir to prevent settings and credential interference between sessions.

> **Note:** Runtime home is prepared for **all** Codex jobs unconditionally (chat, schedule, on-demand, orchestrator, orchestrator-summary, triggered tasks). This matches Gemini's behavior where `prepareGeminiJobRuntime()` runs for every Gemini job.

### 5-2. Operation

```typescript
interface CodexRuntimeHomeResult {
  homeDir: string;      // <workdir>/.codex_runtime_home
  seededFiles: string[]; // List of copied file names
}
```

**Prepare phase (`prepareCodexRuntimeHome(workdir)`):**

1. Resolve source home: `CODEX_HOME` env or `$HOME/.codex`
2. Create runtime home directory: `<workdir>/.codex_runtime_home/`
3. Read global `config.toml` only to preserve non-MCP sections, then inject DB-backed `[mcp_servers.*]`
4. Copy the following files from source to runtime (only if they exist):
   - `auth.json` — API authentication token
   - `config.json` — Legacy CLI settings
   - `instructions.md` — Custom instructions

**Not copied:**
- `state_*.sqlite` — Local state DB (session-specific, no need to share)
- rollout / cache files

### 5-3. Comparison with Gemini Runtime Home

- **Source home** — Gemini: `GEMINI_CLI_HOME` or `$HOME` / Codex: `CODEX_HOME` or `$HOME/.codex`
- **Runtime dir** — Gemini: `<workdir>/.gemini_runtime_home/.gemini/` / Codex: `<workdir>/.codex_runtime_home/`
- **Seed files** — Gemini: `settings.json`, `mcp-oauth-tokens.json`, `oauth_creds.json`, `google_accounts.json` / Codex: `auth.json`, `config.toml`, `config.json`, `instructions.md`
- **Token repair** — Gemini: Alias repair + URL normalization / Codex: None
- **OAuth disable** — Gemini: `serverConfig.oauth` removal / Codex: N/A
- **Cleanup** — Gemini: Credential files deletion / Codex: None (at this time)
- **Env var** — Gemini: `GEMINI_CLI_HOME` / Codex: `CODEX_HOME`

### 5-4. Folder Structure

```
<workdir>/
  .codex_runtime_home/            # Set as CODEX_HOME
    auth.json                     # API authentication token
    config.toml                   # Preserved CLI settings + DB-backed [mcp_servers.*]
    config.json                   # Legacy CLI settings
    instructions.md               # Custom instructions
```

### 5-5. Usage

The job executor and Codex MCP auth flows call `prepareCodexRuntimeHome(workdir)` and pass the returned `homeDir` as the `CODEX_HOME` environment variable to the Codex CLI process. On failure, HuskyGate logs a warning and falls back to the system-wide `~/.codex` (graceful degradation).

```
Gemini:  if (job.tool === 'gemini') → prepareGeminiJobRuntime()    // unconditional
Codex:   if (job.tool === 'codex')  → prepareCodexRuntimeHome()    // unconditional
Claude:  (no runtime home)         → uses system ~/.claude          // N/A
```

### 5-6. MCP Source of Truth

- Claude, Gemini, and Codex MCP server definitions all come from `mcp_servers`.
- Global CLI config files are never mutated by HuskyGate in Phase 2.
- Global config is still read for:
  - bootstrap import on first startup
  - Gemini non-MCP keys in `settings.json`
  - Codex non-MCP sections in `config.toml`

---

## 6. Shared Driver Utilities (`src/runner/driver-utils.ts`)

Cross-driver helpers used by all three driver implementations:

### Text & Tool Extraction
- **`stripErrorPrefix(text)`** — Removes `Error: ` prefix from stderr lines
- **`collectAssistantText(events)` / `extractAssistantText(events)`** — Aggregates assistant output from DriverEvent streams
- **`extractToolUseInfo(events)`** — Parses tool-use events; `TOOL_CALL_TYPES` defines recognized event types

### Environment Building
- **`buildSafeSystemEnv()`** — Constructs a sanitized `env` object (strips secrets, inherits safe PATH)
- **`buildDriverEnv(config, job)`** — Merges driver-specific env vars (API keys, model overrides)
- **`collectCloudProviderEnv(config)`** — AWS / GCP / Azure credential passthrough
- **`collectSkillEnv(config, job)`** — Skill-specific env vars (Playwright, Perplexity, etc.)

### Command Resolution
- **`createDriverCommandResolver(config)`** — Factory returning `resolve(command)` to locate CLI binaries (node_modules/.bin, PATH, platform-specific fallbacks)

### MCP Patterns
- Regex matchers for MCP server connection errors and auth prompts shared across all driver preflight modules
