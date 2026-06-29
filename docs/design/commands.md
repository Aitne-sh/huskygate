# Slack Command Reference

> **SSOT** (Single Source of Truth) for all `!` bang commands.
> When adding, renaming, or removing a command, update **all four locations** listed in the maintenance checklist below.

---

## Command Table

All inputs starting with `!` are system commands. Undefined `!` commands return an error.
Full-width `！` is normalized to half-width `!`.

### Help & Dashboard

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!help` | — | `list_commands` | Show command list |
| `!menu` | — | `menu` | Open Block Kit interactive dashboard |

### Session

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!session` | `!s` | `sessions` | List sessions in thread |
| `!current` | — | `current_session` | Show active session |
| `!session <id>` | — | `start_session` | Resume session by ID |
| `!exit` | — | `exit` | Leave active session |
| `!session-clear <id>` | — | `session_clear` | Delete session (DB + workdir) |
| `!session-clear all` | — | `session_clear_all` | Delete all sessions |

### Apps (Tool Switch / New / Prompt)

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!claude` / `!codex` / `!gemini` | — | `tool_switch` | Resume latest session (create if none) |
| `!new claude` / `!new codex` / `!new gemini` | — | `new_session` | Start new session with specified tool |
| `!claude <prompt>` / `!codex <prompt>` / `!gemini <prompt>` | — | `prompt` | Execute prompt with specified tool |

### Model

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!model` | `!m` | `model_query` | Show current model |
| `!model <name>` | `!m <name>`, `!m=<name>` | `model_change` | Change session model |
| `!model default` | — | `model_change` | Reset model to default |

### Run Control

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!stop` | — | `stop` | Stop running job (SIGINT → SIGKILL) |
| `!status` | — | `status` | Show queue / mode / model / workdir |
| `!reset` | — | `reset` | Delete active session (including DB) |

### Approval

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!yes` | `!y` | *(approval flow)* | Approve pending request |
| `!no` | `!n` | *(approval flow)* | Reject pending request |
| `!autorun` | — | `autorun` | Toggle auto-approve (write mode only) |
| `!autorun on` / `!autorun off` | — | `autorun` | Explicitly enable/disable auto-approve |

> Approval commands (`!yes`/`!y`, `!no`/`!n`) are parsed by `parseApprovalDecision()` in `approval.ts` and short-circuited before the main parser. They return `null` from `parseCommand()` and are dispatched by `message-handler.ts`. Block Kit buttons are the primary approval method; text commands are a fallback.

### Mode & Working Directory

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!mode=readonly` | — | `mode_change` | Switch to read-only |
| `!mode=write` | — | `mode_change` | Request write access (challenge code) |
| `!mode=net` | — | `mode_net_disabled` | Rejected (Phase 1 placeholder) |
| `!confirm XXXX` | — | `confirm` | Confirm 4-char challenge code (30s timeout) |
| `!workdir` | — | `workdir_query` | Show current working directory |
| `!workdir=<path>` | — | `workdir_change` | Request workdir change (challenge code) |
| `!workdir=reset` | — | `workdir_reset` | Reset to default workdir |

### Dev Mode

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!dev` | — | `dev_list` | Show dev alias list |
| `!dev <alias>` | — | `dev` | Resume/create dev alias session |
| `!new-dev <alias>` | — | `dev_new` | Force create new dev session |

### Tasks

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!task <name\|alias>` | `!t <name\|alias>` | `task` | Execute on-demand task |

### Orchestrator

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!orch <alias\|id>` | `!o <alias\|id>` | `orch` | Start orchestrator run |
| `!orch list` | `!o list` | `orch_list` | List active orchestrators |
| `!orch status <target>` | `!o status <target>` | `orch_status` | Show recent runs |
| `!orch cancel <runId>` | `!o cancel <runId>` | `orch_cancel` | Cancel running orchestration |

### MCP Server Control

| Command | Aliases | Parser Kind | Description |
|---------|---------|-------------|-------------|
| `!mcp` | — | `mcp` | Show enabled MCP servers for session |
| `!mcp + <name>` | — | `mcp_toggle` | Enable a server for session |
| `!mcp - <name>` | — | `mcp_toggle` | Disable a server for session |
| `!mcp reset` | — | `mcp_reset` | Restore default (all enabled) |

### Non-Bang Input

| Input | Condition | Behavior |
|-------|-----------|----------|
| (plain text) | Active session exists | Execute as prompt |
| (plain text) | No active session | Display `!menu` dashboard |

---

## Maintenance Checklist

When adding, renaming, or removing a command, update **all four** locations:

| # | Location | What to update |
|---|----------|----------------|
| 1 | `src/slack/parser.ts` | Regex pattern + `CommandType` union |
| 2 | `src/slack/commands/dispatch.ts` + domain module | Handler function + `dispatchCommand()` switch case |
| 3 | `src/slack/app-helpers.ts` | `formatCommandListMessage()` help text |
| 4 | `docs/design/commands.md` | **This file** — command table |

Optional (if applicable):
- `src/dashboard/scripts/docs.ts` — Dashboard docs page command table
- `src/slack/approval.ts` — For approval keyword changes
- `src/slack/block-kit.ts` — For approval prompt context text changes

---

## Removed Commands

| Command | Removed | Reason |
|---------|---------|--------|
| `!ok`, `!okay` | 2026-03-12 | Undocumented approval alias; redundant with `!yes`/`!y` + Block Kit buttons |
| `!はい`, `!いいえ` | 2026-03-12 | Never implemented; removed from design doc |
| `!session-list` | 2026-03-12 | Redundant alias; `!s` and `!session` are sufficient |
