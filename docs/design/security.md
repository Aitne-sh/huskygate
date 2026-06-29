# Security & Logging

## Authentication & Authorization
- DM only: rejects when channel_type !== 'im'
- User allowlist: ALLOWED_USER_IDS
- Optional team lock: ALLOWED_TEAM_ID

## Confirmation Flow
- mode=write / workdir=/path requires challenge code confirmation
- 4 characters, confusable characters excluded, 30-second expiration

## API Authentication
- Server API: Authorization: Bearer <SERVER_API_SECRET>
- Dashboard API: HttpOnly Cookie authentication
- Dashboard bootstrap token exchange compares the submitted token with a timing-safe helper before rejecting missing/invalid one-time tokens
- Dashboard bootstrap page clears the URL hash (`history.replaceState`) before the token exchange fetch to prevent leakage via browser history/bookmarks
- Dashboard bootstrap endpoint is rate-limited to 5 attempts per 15 minutes per IP (`BOOTSTRAP_MAX_ATTEMPTS=5`, `BOOTSTRAP_WINDOW_MS=15min`); rate limiter performs lazy GC of expired entries each window period
- Dashboard logout endpoint (`POST /api/auth/logout`) clears the session cookie with `Max-Age=0` and matching attributes (requires auth + CSRF header)
- Dashboard mutating API methods (`POST/PUT/PATCH/DELETE` under `/api/`) require `x-csrf-protection: 1` header
- Secret persistence via resolvePersistedSecret() (data/.server-api-secret, data/.dashboard-secret)
- Two-tier authorization: (1) Bearer token validation at the API server level (`isAuthorizedRequest()`), then (2) `ALLOWED_USER_IDS` enforcement at individual route handler level (e.g., `isAllowedTaskUserId()` in task create/update routes, except for the internal `'dashboard'` sentinel user)
- All dashboard responses include security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` (with `frame-ancestors 'none'`), and `Strict-Transport-Security` (HTTPS only)
- JSON / SSE / artifact responses additionally send `X-Content-Type-Options: nosniff` via `writeHead()` as defense-in-depth

## Secret Protection
- Token masking patterns (xoxb-*, sk-*, AIza*, ghp_*, etc.)
- Sensitive key/value masking is also applied for registry-backed keys such as `AWS_SECRET_ACCESS_KEY`, `AZURE_CLIENT_SECRET`, `OPENAI_API_KEY`, `SLACK_BOT_TOKEN`
- ANSI escape removal
- Prompt hash in audit (SHA-256)
- KNOWN_ENV_KEYS allowlist
- Dev alias path blocking
- macOS keychain writes must avoid passing secret values in argv; the `security` CLI is invoked in prompted mode with stdin-fed input instead
- Keychain read failures must emit an explicit warning before any `.env` / process environment fallback is used
- Dashboard-managed secrets persist only in OS secure storage; SQLite stores a key reference record only and never plaintext secret values
- Keychain-unavailable environments must reject secret updates from the dashboard instead of falling back to SQLite plaintext persistence (TODO: enforcement in dashboard settings routes)
- Internal/generated/derived keys (`SERVER_API_SECRET`, `DASHBOARD_SECRET`, `HUSKYGATE_API_*`) are not editable through dashboard settings or built-in skill env APIs (`INTERNAL_OR_DERIVED_KEYS` set defined in `config.ts`; TODO: enforce check in settings routes)
- Settings APIs must reject unknown keys and full-snapshot overwrite semantics; writes are patch-based to prevent accidental persistence of masked placeholders or unrelated UI-only fields

## Input Protection
- execFile() instead of exec()
- JSON.parse error -> 400
- Orchestrator CRUD and validated-snapshot revert validate bounded retry/timeout values before persistence (`maxRetries 0-10`, node timeout `1-21600`, triggered wait timeout `1-86400`, orchestrator timeout `1-86400`)
- Port number validation
- Workdir validation
- macOS directory picker encodes `initialPath` as Base64 and decodes it inside AppleScript to avoid string-literal injection via newlines or quotes
- PowerShell injection prevention
- Windows Credential Manager
- OAuth URL validation
- `HUSKYGATE_OAUTH_TRUSTED_HOSTS` allowlist is the trust anchor for externally opened OAuth URLs and Claude fallback token-refresh issuer/token endpoints
- `HUSKYGATE_OAUTH_TRUSTED_HOSTS` is a first-class editable config key persisted in config-db and synced into process env for hot reload
- OAuth host validation rejects loopback / link-local / private IPv4 and IPv6 literals, plus `.localhost`
- Claude fallback token refresh is fail-closed when no trusted OAuth hosts are configured
- Claude fallback token refresh is serialized per credentials file + server and refuses to overwrite credentials that changed mid-refresh
- MCP one-shot approvals reject wildcard tool patterns on both Slack and Dashboard/API entry points; only exact tool names may widen a runtime allowlist
- toolState atomic update with explicit key removal support for one-shot auth flags
- dashboard/local raster image uploads validate magic bytes before persistence
- Event subscription filters/context mappings are validated before persistence on every API path, including inline webhook subscription upserts
- Event subscriptions that target orchestrators must reference an orchestrator whose `triggerMode` is `webhook`; dispatch re-checks this and skips stale mismatches fail-closed
- Stored webhook filter/context mapping parse failures are treated as invalid configuration and fail closed rather than matching all events
- Webhook dot-path traversal rejects reserved prototype segments (`__proto__`, `constructor`, `prototype`) and resolves own-properties only
- Webhook filter/context dot-paths are trimmed before persistence; `headers.*` paths are normalized to lowercase
- Event context mapping output keys also reject reserved prototype segments and `_trigger` to avoid silent overwrite during trigger-context assembly
- Inline webhook subscription PATCH semantics are fail-closed: omitted means unchanged, `null` means explicit removal, and object payloads require `endpointId`
- Slack session list / clear / resume actions are scoped to the current DM thread and requesting Slack user and must not adopt sessions from another thread or owner
- Standalone sessions/workdirs allocated for on-demand tasks, triggered tasks, and orchestrator nodes must be cleaned up on setup or enqueue failure before the error is returned
- Slack attachment/download failures expose only user-safe reason strings to Slack threads; raw fetch/redirect/normalization errors stay in logs
- Slack Web API retries honor provider `Retry-After` hints (when present) in addition to local exponential backoff

## Slack API Scope
Bot Token Scopes: assistant:write, app_mentions:read, channels:history, channels:read, chat:write, files:read, files:write, groups:history, im:history, mpim:history

## Webhook Security
- Signature verification (HMAC-SHA256, HMAC-SHA1, Bearer token)
- Secret reference management (WebhookSecretStore)
- Max body size limit per endpoint
- Delivery ID deduplication
- Inline subscription writes re-parse serialized JSON before save and reject malformed filter/context payloads
- Invalid stored subscription filter/context JSON is skipped at dispatch time with warning logs instead of being treated as an empty filter

## Logging
- Format: Structured JSON (stdout/stderr)
- Fields: timestamp, level, message, data
- Levels: debug / info / warn / error
- Configuration: LOG_LEVEL environment variable
- Log serialization sanitizes sensitive strings before writing
- Stack traces are omitted from logs unless debug logging or an explicit opt-in is enabled
- `data/` and secret-bearing runtime files are tightened to private permissions (`0700` dir, `0600` files) on startup/write paths
- SQLite runtime files (`orchestrator.db`, `-wal`, `-shm`) are re-tightened to `0600` on server, dashboard, and bootstrap DB open paths so database contents do not inherit permissive umask defaults
- SQLite runs in WAL mode on write-capable runtime connections and applies an explicit `busy_timeout=5000` on every runtime/bootstrap DB open path to avoid immediate lock-failure races under concurrent readers/writers
- File writes into workdirs and dashboard-managed skill trees must materialize target paths under a trusted root without traversing symlinked path segments
- Managed file writes use sibling temp files plus atomic rename inside the trusted real parent directory so leaf-path symlink swaps cannot redirect writes outside the root

## Supply Chain
- HuskyGate installs must force `better-sqlite3` source builds; root `preinstall` rejects installs unless `npm_config_build_from_source=better-sqlite3` (or `true`) is set
- `npm run deps:install` is the supported cross-platform install entry point; it re-invokes npm with `npm_config_build_from_source=better-sqlite3`
- CI installs `better-sqlite3` with `npm_config_build_from_source=better-sqlite3` so trusted builds compile from source instead of downloading prebuilt native binaries during install
