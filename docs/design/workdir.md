# Workdir & Skills

> **Source of Truth**: DESIGN.md §9 — Workdir Strategy
>
> file-attachment logic: `src/shared/file-attachment.ts` (moved from `src/slack/file-attachment.ts`)

---

## Session Workdir

- **New creation**: `workdir/sess_<session_key_hash>` (12-character hash derived from session key; always per-session)
- **`workdir=reset`**: returns to the active session's `workdir/sess_<session_key_hash>`
- **Custom**: `workdir=<path>` (allow-root + realpath validation + challenge code confirmation)
- **Dev mode**: `!dev <alias>` bypasses `ALLOWED_WORKDIR_ROOTS` restriction and uses the user's actual project directory as workdir. Dev aliases can only be registered from the Dashboard (with path existence check + auto-creation option). Workdir deletion on session removal is automatically skipped since it's outside `WORKDIR_ROOT`.

---

## Startup Cleanup

1. Create workdir for all sessions and seed tool-specific instruction files
2. Delete unreferenced managed directories (`<8hex>` / `sess_<hash>`)
3. Clean up directories unused for 7 days

---

## File Attachments

When files are attached and sent to a Slack DM, they are downloaded to the workdir and file references are added to the prompt:

**Storage location:**
```
workdir/_attachments/<jobId>/
  screenshot.jpg    ← After HEIC→JPEG conversion
  data.csv
```

**Limits:**

- Max size per file: 50MB
- Max total size per message: 100MB
- Download timeout: 30 seconds

**MIME allow rules:**
- `image/*` — All images
- `text/*` — All text
- Individually allowed: `application/pdf`, `application/json`, `application/xml`, `application/x-yaml`, etc.
- Microsoft Office: `.pptx`, `.docx`, `.xlsx`, `.ppt`, `.doc`, `.xls`
- Blocked: executables, video, audio, archives

**Image normalization (`normalizeImage`):**

Photos sent from iOS may be reported by Slack as `image/jpeg` / `.jpg`, but the actual bytes can be in HEIC format. LLM APIs attempt to interpret them as JPEG and fail, so the following normalization is applied:

1. Detect actual format from magic number in the first 12 bytes of the file (`detectImageFormat`)
2. HEIC/HEIF: convert to JPEG with `sharp` (`.rotate().jpeg({ quality: 90 })`)
3. Other images: re-encode for EXIF rotation correction + header normalization
4. Non-image/SVG: pass through as-is
5. HEIC conversion failure: error (guide user to convert to JPEG/PNG)
6. Non-HEIC conversion failure: warning log, use original file as-is
7. When `sharp` is not installed: continue with original file for non-HEIC

**Prompt augmentation format:**
```
<original prompt>

[Attached files]
- _attachments/<jobId>/screenshot.jpg (image/jpeg, 245KB)
- _attachments/<jobId>/data.csv (text/csv, 12KB)
```

**Error handling:** All errors are non-fatal (except HEIC conversion failure). Files are skipped individually, and the prompt is augmented only with successful files. Filename collisions are avoided with `_1`, `_2` suffixes.

**Security:** `sanitizeFilename()` prevents path traversal. Only the Authorization header is used and not logged.

**Dashboard file upload:**

File attachments are also available in Dashboard Chat. Uses the same validation and normalization pipeline as the Slack path.

- **Flow:** Browser -> `POST /api/chat/:id/upload` (raw binary) -> Dashboard Server saves directly to workdir -> returns `DownloadedFile` metadata -> included in `files` field of `POST /api/chat/:id/send` -> Server API augments prompt with `buildFileReferenceBlock()`
- **Storage:** `workdir/_attachments/dash_<timestamp>/` (namespace separated from Slack's UUID-based `jobId`)
- **Shared logic:** `saveLocalFile()`, `normalizeImage()`, `isMimeAllowed()`, `sanitizeFilename()`, `buildFileReferenceBlock()`
- **UI:** Clip button, file chip display, drag-and-drop support

---

## Instruction Seeding

Tool-specific instruction files are automatically placed via `src/workdir/manager.ts`:

- `claude` — `CLAUDE.md`
- `codex` — `AGENTS.md`
- `gemini` — `GEMINI.md`

Instruction content is generated dynamically by `src/instructions/builder.ts` (`buildInstruction()`).

**Policy:**
- Does not overwrite if a file with the same name already exists in the workdir
- `prepareWorkdirForTool` is called on session creation/resume/pre-execution/workdir change

## Claude MCP Materialization

Claude MCP definitions managed by HuskyGate are rendered into a generated file inside the session workdir immediately before Claude switch-preflight and job execution.

- Generated file: Canonical path `<workdir>/.huskygate/claude.mcp.json>`
- Permissions: `0600`
- Source of truth: SQLite `mcp_servers`, filtered by the session-scoped allowlist and optionally narrowed again by an orchestrator node MCP subset
- `allowMcp=false`: HuskyGate still writes the generated file, but with an empty `mcpServers` object so `--strict-mcp-config` blocks ambient/project MCP servers
- When a session has no `session_mcp_servers` rows, all tool-compatible MCP servers remain enabled for backward compatibility.
- Orchestrator node MCP overrides only narrow the session-scoped server set; they cannot re-enable a session-disabled server.

Important:
- HuskyGate does not overwrite project-owned `.mcp.json`.
- HuskyGate also avoids overwriting a pre-existing non-HuskyGate file at the canonical generated path. Ownership is verified with a HuskyGate sidecar whose metadata must match the current file content. If the sidecar is missing, stale, or mismatched, the canonical file is treated as user-owned and HuskyGate falls back to a unique file under `<workdir>/.huskygate/`.
- If `<workdir>/.huskygate/` is unsafe (for example, a symlink), HuskyGate falls back to a separate managed directory under the workdir and refuses to traverse the unsafe path.
- This is especially important for dev alias sessions where the workdir is a real project checkout.
- The Claude driver passes the generated file explicitly with `--mcp-config` and `--strict-mcp-config`.
- HuskyGate removes the generated Claude MCP config after switch-preflight, auth recovery, and job execution complete.
- Built-in skill seed/sync and dashboard support-file edits materialize writes through a trusted real parent directory using temp-file + rename, so `requirements.txt`, `scripts/*`, and edited files cannot be redirected by a symlinked leaf path.

---

## Instruction Builder (`src/instructions/`)

Dynamically generates instruction file content based on the job source. Replaces the file-based template system (`./instructions/*.md`) with a single code-driven generator.

```typescript
type InstructionSource = 'chat' | 'orchestrator' | 'schedule' | 'standalone-task';
```

**`buildInstruction(ctx)`** assembles instruction sections in order:

1. Identity — tool-specific name & role
2. Core Principles — shared behavioral directives
3. Environment — standard or autorun directives
4. Constraints — shared + tool-specific (e.g. Gemini heredoc)
5. Output Files — `_output/` directory usage
6. MCP Policy — approval / autorun / disabled
7. Response Format — chat-only `<!-- answer -->` marker
8. Additional Instructions — optional user-defined content (from DB)

**`resolveInstruction(ctx, taskInstructionFile, defaultInstr)`** determines final content:

- Priority 1: `taskInstructionFile` provided — `buildInstruction()` + task content appended
- Priority 2: Default Custom Instructions with `enabled: true` — Full replace (custom content becomes the entire file)
- Priority 3: Normal — `buildInstruction()` + default content as "Additional Instructions"

**`sections.ts`** contains reusable section constants:
- `TOOL_IDENTITY` — per-tool name mapping
- `ROLE`, `CORE_PRINCIPLES` — shared behavioral text
- `ENVIRONMENT_SHARED`, `ENVIRONMENT_STANDARD_DIRECTIVES`, `ENVIRONMENT_AUTORUN_DIRECTIVES`
- `CONSTRAINTS_SHARED`, `CONSTRAINT_GEMINI_HEREDOC`
- `OUTPUT_FILES` — `_output/` usage instructions
- `MCP_APPROVAL`, `MCP_AUTORUN`, `MCP_DISABLED` — MCP policy variants
- `RESPONSE_FORMAT_CHAT` — chat response marker

Orchestrator nodes can override instruction content via `instructionFile` field.

---

## Skill Seeding (Unified Catalog Seeding)

`WorkdirManager.prepareWorkdirSkillsOnly()` seeds skills from the unified filesystem catalog into the tool-specific discovery directory inside each session workdir.

Source roots:

- Built-in: `./skills/<name>/` by default, or `SKILL_TEMPLATE_DIR` when explicitly overridden
- Local custom: `~/.huskygate/skills/<name>/`
- Project custom: `<WORKDIR_ROOT>/.huskygate/skills/<name>/`

Built-in skill directories are read directly from their source root. HuskyGate does not mirror them into another `.huskygate/skills/` directory before seeding.

**Built-in skill catalog (manifest-driven):**

- `playwright-runner` — Global default: disabled — Type: Python (venv) — `envVars`: none
- `perplexity-research` — Global default: disabled — Type: Python (venv) — `envVars`: `PERPLEXITY_API_KEY`
- `research-freshness` — Global default: disabled — Type: Prompt only — `envVars`: none
- `aws-cli` — Global default: disabled — Type: Shell (bash) — `envVars`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`
- `azure-cli` — Global default: disabled — Type: Shell (bash) — `envVars`: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- `gcp-cli` — Global default: disabled — Type: Shell (bash) — `envVars`: `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CORE_PROJECT`
- `schedule-manager` — Global default: disabled — Type: Shell (bash) — `envVars`: none
- `gmail-composer` — Global default: disabled — Type: Python (venv) + Shell — `envVars`: none
- `pptx-composer` — Global default: disabled — Type: Python (venv) + Shell — `envVars`: none
- `obsidian-cli` — Global default: disabled — Type: Shell (bash) — `envVars`: none

**Tool-specific skill directories (session workdir, for CLI discovery):**

- `claude` — `<workdir>/.claude/skills/<skill-name>/`
- `gemini` — `<workdir>/.gemini/skills/<skill-name>/`
- `codex` — `<workdir>/.agents/skills/<skill-name>/`

Custom skills use `SKILL.<tool>.md` filenames (e.g. `SKILL.claude.md`) and are seeded into session workdirs at the tool-specific paths above.

**Placement file example (playwright-runner):**

```
<workdir>/.<tool>/skills/playwright-runner/
├── SKILL.md                # Tool-specific template (SKILL.<tool>.md → SKILL.md)
├── requirements.txt        # Python dependencies (playwright>=1.48.0)
└── scripts/
    └── run_playwright.py   # Playwright execution script (chmod 755)
```

**Built-in source search order:**
1. `SKILL_TEMPLATE_DIR` environment variable
2. `./skills/`

**Playwright skill behavior:**
- Receives JSON payload via stdin and executes multiple browser actions sequentially
- Supported actions: navigate, screenshot, click, type, get_text, evaluate, wait, select, scroll, go_back, go_forward, reload, new_page, get_url, get_title, pdf, close
- Security: URL scheme restriction (http/https only), loopback blocking (opt-in), JS eval disabled (opt-in), path traversal prevention, global timeout 300 seconds, max 50 actions/call

**Policy:**
- Skipped if `SKILL.md` already exists (no overwrite)
- Global enablement comes from `skill_enablement`
- Built-in skills default to disabled when no `skill_enablement` row exists
- Local/project custom skills default to enabled when no `skill_enablement` row exists
- When `enabledSkills` is `null` or omitted, runtime applies the global rules above
- When `enabledSkills` is an explicit `SkillRef[]`, only those refs are seeded
- When `enabledSkills` is an explicit empty array, no skills are seeded
- Explicit skill selection may include built-in, local custom, and project custom refs
- For routes where the tool is known, invalid refs and refs without a matching `SKILL.<tool>.md` are rejected before persistence
- Runtime still skips duplicate-name catalog entries to avoid destination collisions under `<workdir>/.<tool>/skills/<dirName>/`
- Runtime forwards only built-in manifest-declared `envVars` for seedable entries
- Does not seed for Dev mode alias sessions (since workdir is the project directory)
- Built-in skills can be toggled enabled/disabled from the Dashboard Skills tab
- Duplicate `dirName` collisions across built-in/local/project roots are excluded from seeding to avoid materialization conflicts
- Skill seeding/sync materializes destination paths under the session workdir without traversing symlinked path segments
- Script sync is content-based and prunes destination files that no longer exist in the source template, preventing stale legacy scripts from persisting across sessions

---

## Output File Archival (`_output/` to `_artifacts/`)

On job completion, files in the `_output/` directory are archived to a channel-independent artifact store.

**Implementation:** `archiveOutputFiles()` in `src/shared/file-attachment.ts`

**Lifecycle:**

- **Generate** — During job execution: CLI places files in `workdir/_output/`
- **Archive** — After job completion: `_output/*` moved to `_artifacts/<jobId>/` via `fs.renameSync`
- **Cleanup** — After archival: empty `_output/` directory deleted with `fs.rmdirSync`
- **Deliver (Slack)** — After archival: uploaded to thread via `files.uploadV2`
- **Deliver (Dashboard)** — After archival: file list notified via SSE `artifacts` event, served via HTTP GET

**Directory structure:**

```text
workdir/<session_id>/
  _output/                    ← Exists only during job execution (deleted after completion)
  _artifacts/
    <jobId_1>/
      report.pdf
      chart.svg
    <jobId_2>/
      summary.csv
```

**Delivery channels:**

- **Slack** (`job-executor.ts`): `archiveOutputFiles()` -> file list uploaded via `files.uploadV2`
- **Dashboard** (`job-executor.ts`): `archiveOutputFiles()` -> notifies `{ files: [{jobId, filename}] }` via SSE `artifacts` event
- **Dashboard HTTP** (`server.ts`): `GET /api/chat/:id/artifacts/:jobId/:filename` serves files directly

**Artifact delivery security:**

- Path traversal prevention: `path.resolve()` + `startsWith()` check
- Symlink attack prevention: `realpathSync()` verifies resolved path is within the artifact directory
- File size limit: `MAX_ARTIFACT_SERVE_BYTES = 100MB` (OOM prevention)
- MIME determination: `guessMimeType()` determines Content-Type from file extension (25 types supported)

**MIME type management:**

`guessMimeType()` is defined once in `src/shared/file-attachment.ts` and shared by both Slack upload and Dashboard HTTP delivery:

```
.jpg/.jpeg → image/jpeg    .png → image/png      .gif → image/gif
.svg → image/svg+xml       .webp → image/webp    .bmp → image/bmp
.ico → image/x-icon        .pdf → application/pdf
.csv → text/csv            .txt → text/plain     .json → application/json
.xml → application/xml     .html → text/html     .md → text/markdown
.zip → application/zip     .mp4 → video/mp4      .mp3 → audio/mpeg
.wav → audio/wav           .pptx/.ppt → application/vnd.ms-powerpoint variants
.docx/.doc → application/vnd.ms-word variants
.xlsx/.xls → application/vnd.ms-excel variants
```

---

## Workdir Cleanup Utility (`src/utils/workdir.ts`)

`cleanupWorkdir(root, workdir)` safely removes a session working directory.

**Safety constraints**:
- Only deletes directories under the configured `root` (path traversal prevention)
- Never deletes the root directory itself
- Throws on failure (caller decides recovery strategy)

Used by session manager during session cleanup and housekeeping.

---

## Autorun Instruction Variants

Three autorun instruction files provide driver-specific agent specifications for Slack auto-approve mode:

| File | Driver | Key Differences |
|------|--------|----------------|
| `instructions/CLAUDE.autorun.md` | Claude Code | XML `agent_spec` v2.0 format; `!claude` command |
| `instructions/AGENTS.autorun.md` | Codex | Markdown format; `!codex` command; `_output/` routing; `<!-- answer -->` marker |
| `instructions/GEMINI.autorun.md` | Gemini CLI | Markdown format; `!gemini` command; **heredoc prohibition** (`<< EOF` banned — use `write_file` or `python3 -c`) |

**Shared principles** (all three):
- Follow user intent, complete end-to-end
- Ask up to 2 clarifying questions before proceeding
- Match user's language
- Prefer actionable output over explanation
- Auto-approve mode is active (no tool approval prompts)
- Output capped at ~2000 chars default

These files are selected by `InstructionBuilder` when `autoApprove: true` and passed as the base instruction template via `resolveInstruction()`.
