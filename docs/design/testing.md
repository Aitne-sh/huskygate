# Testing

## Test Strategy
- Module-level tests for src/**/*.ts (excluding type-only modules)
- Server Internal API uses dispatcher integration tests + individual route tests
- `src/test-helpers/app-context-builder.ts` is the canonical test fixture for `AppContext` and `Config`. Tests should prefer overriding this shared builder instead of maintaining per-file full-context mocks.
- **Test file naming conventions:**
  - `*.test.ts` — Standard unit/behavior tests (default)
  - `*.more.test.ts` — Extended integration/behavior tests (e.g., `command-handlers.more.test.ts`, `mcp-preflight-claude.more.test.ts`)
  - `*.coverage.test.ts` — Coverage-focused tests for hard-to-reach branches (e.g., `index.coverage.test.ts`, `cli.coverage.test.ts`, `config.coverage.test.ts`)
- Priority targets:
  - Slack orchestration layer (`app-*`, `job-executor`, `approval-handler`, `mcp-preflight*`, `tool-plugin*`)
  - Execution infrastructure (`runner`, driver group)
  - Persistence layer (`store/*`)
  - MCP config unification (`mcp-server`, runtime-home generators, dashboard MCP routes)
  - Utilities (`utils/*`)
  - Server API
- Side-effect boundaries (Slack API / child_process / timer / DB / filesystem) use mocks or temporary areas to ensure reproducibility.

## Coverage Target
- Goal: 100% for statements / branches / functions / lines (aspirational — no enforced threshold in `vitest.config.ts`)
- Coverage reporter: `['text', 'json-summary']`
- Coverage measurement targets:
  - Deterministic implementation code in `src/**/*.ts`
  - Excluded: `src/**/*.test.ts` and type-only modules (`*/types.ts`, `src/context/app-types.ts`, `src/slack/app-types.ts`, `src/orchestrator/types-db.ts`, `src/orchestrator/types-patch.ts`)
  - Exclusion reason: Type-only modules have no runtime execution paths
- Exclusions (strict-unit gate is intentionally narrower than the full integration surface):
  - Entry points / CLI presentation: `src/index.ts`, `src/cli.ts`, `src/cli/banner.ts`
  - Dashboard / HTTP controller boundaries: `src/dashboard/server.ts`, `src/dashboard/routes/**/*.ts`, `src/dashboard/db.ts`, `src/dashboard/proxy.ts`, `src/dashboard/auth.ts`, `src/dashboard/env.ts`, `src/dashboard/http.ts`, `src/dashboard/mcp-config.ts`, `src/dashboard/skills.ts`, `src/dashboard/toml.ts`, `src/dashboard/yaml.ts`, `src/server/api.ts`, `src/server/routes/**/*.ts`, `src/schedule/**/*.ts`
  - Runtime orchestration / external side effects: `src/event/event-router.ts`, `src/slack/job-executor.ts`, `src/slack/job-post-run.ts`, `src/slack/job-finishers.ts`, `src/slack/job-runtime.ts`, `src/slack/message-handler.ts`, `src/slack/task-run-completion.ts`, `src/slack/mcp-preflight.ts`, `src/orchestrator/engine.ts`, `src/orchestrator/engine-executor.ts`, `src/orchestrator/engine-summary.ts`, `src/orchestrator/engine-notify.ts`
  - DB / FS / keychain boundaries: `src/store/database.ts`, `src/store/housekeeping.ts`, `src/store/orchestrator.ts`, `src/store/schedule.ts`, `src/utils/keychain.ts`, `src/workdir/manager.ts`, `src/shared/file-attachment.ts`
  - Tool/controller surfaces already covered by focused behavior tests: `src/runner/driver-codex.ts`, `src/session/manager.ts`, `src/slack/block-kit.ts`, `src/store/orchestrator-archive.ts`, `src/store/orchestrator-snapshot.ts`
  - Exclusion reason: These modules are dominated by Slack/API/FS/DB/process orchestration branches that are validated by behavior/integration suites; keeping them out of the strict unit gate avoids trading correctness for synthetic branch-chasing.

## Key Regression Cases
- settings resolver must prefer DB / secure-store values over stale `process.env` when a persisted value exists
- after migration completes, managed keys must be removed from `.env` so cleared settings do not reappear on restart
- retrying migration after `failed_requires_secure_store` must not overwrite newer DB values with stale `.env` values
- keychain-unavailable environments must reject secret writes while still allowing env fallback reads
- settings PATCH API must update only dirty keys and must distinguish masked-secret noops from explicit clears
- settings PATCH application must not leave partial DB/keychain updates behind when a later patch fails
- dashboard Mode settings must persist `TOOL_AUTO_APPROVE_MODE` through its custom toggle flow even though the panel has no `.settings-input` fields
- built-in skill toggles and env updates must use the same registry policy as Settings and must not write `.env`
- internal/derived keys such as `HUSKYGATE_API_BASE`, `HUSKYGATE_API_SECRET`, `SERVER_API_SECRET`, and `DASHBOARD_SECRET` must not appear as editable dashboard settings
- bootstrap CLI commands (`stop`, `restart`, `dashboard-serve`) must resolve `SERVER_API_PORT` and secrets via the shared bootstrap resolver
- `.env` migration must track state in `metadata`, skip unknown/internal keys, and resume safely after partial migration
- phase2 bootstrap import must merge missing Gemini/Codex rows into a phase1 DB that already contains Claude rows, without overwriting existing DB records
- one-time MCP global import runs only once and does not repopulate after explicit operator deletion
- Gemini global-config import must accept file-backed `httpUrl` / `url` server entries as SSE
- Codex global-config import must accept file-backed `url` / `httpUrl` server entries as HTTP
- Codex `env_http_headers` must survive import, dashboard edit, and runtime-home generation without being dropped
- Dashboard MCP secret masking must cover Codex `httpHeaders` as well as legacy `headers`, and masked updates must preserve stored secrets instead of persisting `***`
- Dashboard MCP create/update must reject masked placeholder values when there is no stored secret to restore
- Gemini runtime-home generation preserves non-MCP keys while replacing `mcpServers` from DB
- Codex runtime-home generation preserves non-MCP TOML sections while replacing `[mcp_servers.*]` from DB
- Gemini/Codex runtime-home generation must clear prior MCP server sections when the effective DB selection becomes empty
- MCP server selection must preserve the "no session rows = all enabled" default while enforcing node-level intersection
- invalid `enabledMcpServerIds` must emit a warning without widening MCP access
- orchestrator node execution, triggered resume, and triggered retry must pass `enabledMcpServerIds` through to job executionPolicy unchanged
- `allowMcp=false` produces runtime homes with empty MCP server sets for Gemini/Codex
- housekeeping must purge `session_mcp_servers` rows together with expired `session_registry` parents
- legacy `/api/mcp/configs/*` routes return a clear deprecation error instead of mutating files
- Server API schedule / on-demand / triggered task create+patch must reject resolved `userId` values outside `ALLOWED_USER_IDS` while still allowing `'dashboard'`
- `mergeToolState` must delete keys atomically without overwriting unrelated session tool state
- post-run MCP auth recovery must honor the already-resolved MCP server subset
- dashboard bootstrap exchange must reject missing/invalid one-time tokens without a fast-path null bypass before comparison
- macOS directory picker must not pass raw `initialPath` text into AppleScript string literals
- text chunking must preserve Markdown fence boundaries when a safe split exists near the limit, while still making progress through oversized code blocks
- dashboard/local upload paths must reject spoofed raster images with unknown magic bytes
- webhook subscription dry-run must reject oversized payloads with `413`
- webhook subscription create/patch must reject orchestrator targets whose `triggerMode` is not `webhook`, and dispatch must skip stale mismatches fail-closed
- inline triggered-task subscription create/update must convert concurrent endpoint deletion into `400`, not `500`
- Slack on-demand task launch, Dashboard on-demand execute, and orchestrator node enqueue failure paths must clean up standalone session/workdir allocations
- Slack attachment warning text must use sanitized user-facing reasons even when the internal download error contains redirect/host validation detail
- messenger rate-limit retry must respect provider `retryAfter` hints before retrying
- approval reject / accept / timeout / ownership mismatch
- MCP auth preflight success / required / generic failure / rerun loop prevention
- queue enqueue failure / queued / immediate execution
- runtime timeout / no-output timeout / graceful shutdown cleanup
- runner cleanup must remain idempotent when child processes emit both `error` and `close`
- executor finish path must call completion/fallback hooks at most once even if runtime and finish handling both throw
- DB init/close error handling, dedupe/audit normal cases

## Execution
```bash
npm run test          # vitest
npm run verify        # typecheck + test + build
```
