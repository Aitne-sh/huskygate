# Operations -- Housekeeping, Cross-Platform, CI/CD

> Scope: Data lifecycle management, cross-platform support, CI pipeline, startup/shutdown

---

## 1. Housekeeping (`src/store/housekeeping.ts`)

### Retention Rules

- **`orchestration_runs`**: 90-day retention, cascades to `orchestration_node_runs` (node execution logs are also deleted)
- **`audit`**: 90-day retention, no cascade (audit logs)
- **`dashboard_messages`**: 30-day retention, no cascade (maxRows=10,000 row limit also applies)
- **`scheduled_task_runs`**: 60-day retention, no cascade
- **`ondemand_task_runs`**: 60-day retention, no cascade
- **`triggered_task_runs`**: 60-day retention, no cascade
- **`webhook_deliveries`**: 7-day retention, no cascade (short retention due to high frequency)
- **`mode_changes`**: 30-day retention, no cascade
- **`sessions`**: 90-day session-graph retention. A session is stale only when `sessions.updated_at` is older than 90 days and `running_job_id IS NULL`; cleanup deletes `sessions`, `session_registry`, `dashboard_messages`, and `session_mcp_servers` together. Controlled by `SESSION_CLEANUP_ENABLED` (default: `true`); set to `false` during rollout to disable.
- **`thread_contexts`**: 90-day retention only for inactive rows (`active_session_key IS NULL`). Controlled by the same `SESSION_CLEANUP_ENABLED` flag.

### Full Housekeeping Cycle

`runHousekeeping(db, dataDir, workdirRoot?, options?)` -- Main entry point (options: `{ sessionCleanupEnabled?: boolean }`):

1. **Retention cleanup** -- Backfill `sessions.updated_at` from retained `dashboard_messages`, then apply age-based row deletion + session-graph cleanup (batch of 500 rows, considering SQLite variable limit of 999)
   Integrity repair: orphaned `thread_contexts.active_session_key` references are NULLed before retention and orphaned `session_mcp_servers` rows are reported.
2. **Job-log cleanup** -- Delete `data/job-logs/{run_id}/` for deleted runs
3. **Orphaned job-log cleanup** -- Filesystem scan, delete logs that don't exist in DB
4. **Soft-delete orchestrator purge** -- Cascade deletion of node_runs, runs, event_subscriptions, nodes/edges, and orchestrator (skipped if in-flight runs exist; active-run check and DB deletion happen in the same SQLite write transaction)
5. **Orphan run workdir cleanup** -- Pattern match `orch_<8-hex>`, delete if no DB entry exists
6. **Log rotation** -- Copytruncate method (`SIZE_LIMITS.logRotationMax` threshold, `RETRY_LIMITS.logRotations` generations)
7. **VACUUM INTO backup** -- Create defragmented backup (`orchestrator_YYYYMMDD_HHMMSS.db`)
8. **WAL checkpoint** -- Reclaim space
9. **Backup pruning** -- Keep the latest `RETRY_LIMITS.backupGenerations` generations, delete older ones

### Durable Queue Recovery

- Startup recovery runs separately from housekeeping and reads SQLite `job_queue`
- `queued` rows are restored into `JobQueue` in insertion order only after current session/workdir/task-policy validation succeeds
- `running` rows are treated as interrupted leases from the previous process
- `orchestrator` rows are cleared and handed to orchestrator engine recovery instead of being replayed from the durable queue
- Restart-safe retry is limited to readonly `orchestrator-summary` jobs with MCP disabled; all other interrupted jobs are failed and cleaned up explicitly
- Corrupt queue rows are dropped individually and logged so startup is not blocked by one malformed `payload`
- Recovery clears stale session `running_job_id` values and releases schedule/triggered task claims immediately instead of waiting for stale-claim timers

### Schedule

- Runs at startup + **every 24 hours**
- Non-fatal: only logs output on failure (process continues)
- Only produces log output when there is activity

### Path Safety

- `SAFE_PATH_PATTERN`: `/^[a-zA-Z0-9/_.\-]+$/`
- `SAFE_ID`: `/^[a-f0-9-]+$/i` (UUID format, with `..` check for path traversal prevention)
- All file deletions are preceded by path validation
- Runtime data directory permissions are tightened to `0700`; PID, log, and persisted secret files are tightened to `0600`

---

## 2. Cross-Platform Support (`src/utils/platform.ts`)

### Platform Flags

```typescript
const isWindows = process.platform === 'win32';
const isMacOS   = process.platform === 'darwin';
const isLinux   = process.platform === 'linux';
```

### Platform Abstraction Functions

- **`killProcessTree(pid, signal)`**: Unix uses `-pid` (process group); Windows uses `taskkill /T /PID` (/F for SIGKILL)
- **`terminateProcess(pid)`**: Unix uses SIGTERM; Windows uses `taskkill /PID` (graceful)
- **`findPidOnPort(port)`**: Windows uses `netstat -ano` + regex. Unix tries `lsof -ti :<port> -sTCP:LISTEN` first, then falls back to `ss -tlnp` (iproute2) for minimal Linux environments (Alpine, Docker) where `lsof` is not installed
- **`resolveCommand(name)`**: Windows uses `where.exe <name>`. Unix uses `$SHELL -lic 'command -v <name>'` when `$SHELL` is set. When `$SHELL` is unset (Docker containers, CI runners, cron jobs), falls back to `/bin/sh -c 'command -v <name>'`, then `which <name>`
- **`resolvePython()`**: Tries python3, then python; Windows also tries `py -3`
- **`getVenvPython(venvDir)`**: Unix uses `<venvDir>/bin/python`; Windows uses `<venvDir>/Scripts/python.exe`
- **`getVenvPip(venvDir)`**: Unix uses `<venvDir>/bin/pip`; Windows uses `<venvDir>/Scripts/pip.exe`
- **`getDetachedSpawnOptions(base)`**: Unix passes through; Windows adds `windowsHide: true`
- **`openBrowser(url)`**: macOS uses `open`; Windows uses `cmd.exe /c start`. Linux respects `$BROWSER` env var (freedesktop.org), then `xdg-open`, then `sensible-browser` (Debian/Ubuntu)
- **`resolvePowerShell()`**: Probes `powershell` (Windows PowerShell, pre-installed), then `pwsh` (PowerShell Core). Result is cached via `getPowerShell()`. Used by both `keychain.ts` and `dashboard/routes/filesystem.ts`
- **`getFallbackBinDirs()`**: Unix uses `~/.local/bin`; Windows uses `%LOCALAPPDATA%/Programs`, `%APPDATA%/npm`, `~/.local/bin`
- **`findInFallbackDirs(name)`**: Unix searches as-is; Windows adds `.exe`, `.cmd` extensions

### Safety

- `SAFE_COMMAND_NAME = /^[a-zA-Z0-9._-]+$/` (shell injection prevention)
- All external command execution uses `execFileSync` + `timeout: TIMEOUTS.platformProbe` or `TIMEOUTS.taskkill` (from `src/shared/constants.ts`)

### Credential Storage (`src/utils/keychain.ts`)

- **macOS**: `security` CLI (`find-generic-password`, `add-generic-password`, `delete-generic-password`, `dump-keychain`)
- **Linux**: `secret-tool` CLI (GNOME Keyring / KDE Wallet via D-Bus Secret Service API)
- **Windows**: `cmdkey` for list/delete + PowerShell P/Invoke (`advapi32.dll` CredRead/CredWrite) for get/set. Uses `getPowerShell()` to support both `powershell` and `pwsh`
- **Fallback**: No-op provider for unsupported platforms (returns null, throws on set)

### Native Directory Picker (`src/dashboard/routes/filesystem.ts`)

- **macOS**: `osascript` (AppleScript with Base64-encoded path to prevent injection)
- **Linux**: `zenity --file-selection --directory` (GTK), falls back to `kdialog --getexistingdirectory` (KDE)
- **Windows**: PowerShell `System.Windows.Forms.FolderBrowserDialog` via `-EncodedCommand` (Base64 UTF-16LE, prevents injection). Uses `getPowerShell()` to support both `powershell` and `pwsh`
- Path normalization strips trailing `/` and `\` while preserving root paths (`/`, `C:\`)

---

## 3. Codex Runtime Home (`src/runner/codex-runtime-home.ts`)

Seeds Codex CLI home directory settings to the session workdir for **every Codex job** (unconditional, matching Gemini's pattern):

- **Source**: `CODEX_HOME` environment variable or `~/.codex`
- **Destination**: `workdir/.codex_runtime_home/`
- **Seed targets (loop-copied)**: `auth.json`, `config.json`, `instructions.md`
- **Separately handled**: `config.toml` — read from source to preserve non-MCP sections, then merged with DB-backed `[mcp_servers.*]` and written to runtime home
- `copyFileIfPresent()` soft-fails on ENOENT
- On failure, logs warning and falls back to system `~/.codex` (graceful degradation)

---

## 4. CI/CD (`.github/workflows/ci.yml`)

### Matrix

- ubuntu-latest / Node 22
- macos-latest / Node 22
- windows-latest / Node 22
- `fail-fast: false` (tests all platforms regardless of failures)

### Pipeline Steps

1. Checkout
2. Setup Node 22 + npm cache
3. `npm ci`
4. `npm run typecheck`
5. `npm run lint` (skipped on Windows)
6. `npm run test`

### Triggers

- Push: `main`, `developer` branches
- Pull Request: PRs targeting `main`

---

## 5. Graceful Shutdown (`src/index.ts`)

### Shutdown Sequence

```
SIGINT / SIGTERM received -> hardTimeout: 15s

1. Stop accepting new jobs
2. Kill running jobs + notify (5.5s wait)
3. Stop scheduler
4. Clear all intervals (heartbeat, dedupe, output_full, housekeeping)
5. Close API server
6. Stop Slack app
7. Close DB (WAL checkpoint)
-> exit(0)
```

### Global Error Handlers

- `uncaughtException` -> log + exit(1)
- `unhandledRejection` -> log + exit(1)
- If the logger itself throws, falls back to stderr
- Stack traces are only emitted when debug logging or an explicit stack opt-in is enabled; sanitized error summaries remain on by default

### Periodic Tasks

- **Heartbeat**: 60s interval -- Session liveness check
- **Dedupe cleanup**: 1h interval -- Remove duplicate event IDs
- **output_full cleanup**: Run-finalization offload writes completed node output to `data/job-logs/<run_id>/<node_run_id>.log`, records file metadata, and NULLs `output_full` after notification/summary consumers have materialized their snapshots.
- **output_full safety-net cleanup**: 6h interval -- `archiveAndPruneOutputFull()` backfills older rows and enforces the 1,000-row cap for legacy/non-offloaded rows.
- **Housekeeping**: 24h interval -- Full cycle from section 1 above

- All intervals use `.unref()` (do not block process exit)

---

## 6. Startup Sequence (`src/index.ts`)

> Full step-by-step sequence with implementation details: [config.md § Startup Sequence](config.md#startup-sequence)

1. Load `.env` into `process.env` for compatibility fallback only
2. Initialize DB + create schema/migrations
3. Build `ConfigStore` and shared config resolver
4. Resolve runtime config (DB / secure store first, `process.env` fallback second)
6. Startup cleanup:
   - Restore session workdirs (`ensureSessionWorkdirs()`)
   - Legacy archive processing (`archiveLegacyDefaultWorkdirIfUnused()`)
   - Unused workdir cleanup (`cleanupUnusedSessionWorkdirs()`)
   - Dedupe cleanup (`dedupeStore.cleanup()`)
   - Stale session cleanup (`cleanupStaleSessions()`)
   - Ensure root workdir (`ensureWorkdir()`)
7. Configure periodic tasks (see section 5 above)
8. Initialize OrchestratorEngine + Scheduler
9. Start Slack App + API Server

### Bootstrap Paths

The following commands must resolve configuration through the same bootstrap resolver even when the daemon is not running:

- `huskygate start`
- `huskygate stop`
- `huskygate restart`
- `huskygate dashboard`
- `huskygate dashboard-serve`
- `huskygate server stop`

This is specifically required for values such as `SERVER_API_PORT`, which can no longer be assumed to live only in ambient `.env`.

---

## 7. CLI Banner (`src/cli/banner.ts`)

- `renderBanner(version)` -- Braille dot-art "HUSKY GATE" text + husky face + version
- `renderByeBanner()` -- "BYE BYE" + face
- `formatStarted/Stopped/Status/...` -- Service status display utilities
- Braille 2x4 cells (8 dots/character, 8x12px glyphs)
- 16-color palette (FACE_PALETTE)
- ANSI color: determined by `process.stdout.isTTY && !process.env.NO_COLOR`

---

## 8. File Structure

```
src/store/housekeeping.ts      # Retention cleanup, vacuum, log rotation
src/store/housekeeping.test.ts # 30+ tests (retention, purge, rotation, backup)
src/utils/platform.ts          # Cross-platform abstraction
src/runner/codex-runtime-home.ts # Codex home seeding
src/cli/banner.ts              # CLI startup/shutdown banners
src/index.ts                   # Startup + shutdown + periodic tasks
.github/workflows/ci.yml      # CI matrix (3 OS x Node 22)
```
