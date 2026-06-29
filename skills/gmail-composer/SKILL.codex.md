---
name: gmail-composer
description: >-
  Compose and send email via Gmail API using the Google Workspace MCP server.
  Use when the user asks to send an email, draft an email, or reply to a message.
  This skill builds RFC 2822 compliant messages with proper UTF-8 encoding and
  base64url output, then calls the Gmail MCP tool with the correct parameter structure.
  Requires the google-workspace MCP server to be configured.
---

# Gmail Composer

Compose RFC 2822 emails with proper encoding and send via Gmail MCP tools.
This skill uses a **2-step workflow**: build the encoded email, then call the MCP tool.

## Prerequisites

1. Resolve runner path:

```bash
SKILL_DIR=$(find . -path '*gmail-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/compose_email.sh"
bash "$RUNNER" --check
```

If check fails, tell the user that `python3` must be available in PATH.

2. Verify Google Workspace MCP server is configured (the `google_gmail_messages_send` tool must be available).

## 2-Step Workflow

### Step 1: Build the Encoded Email

Write JSON payload to a workspace-relative temp file, then run the script with file redirection.

**IMPORTANT — Codex sandbox constraints**:
- Do NOT write to `/tmp` — it is read-only in the Codex sandbox.
- Do NOT pipe into a shell variable command (e.g. `| bash "$RUNNER"`). Use file redirection (`< file`) instead.
- Always create `.tmp/` in the workspace and export `TMPDIR` before running.

```bash
SKILL_DIR=$(find . -path '*gmail-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/compose_email.sh"

mkdir -p .tmp
export TMPDIR="$PWD/.tmp"

python3 -c '
import json
payload = {
    "to": "recipient@example.com",
    "subject": "Meeting tomorrow",
    "body": "Hi, can we meet at 3pm?"
}
with open(".tmp/gmail_payload.json", "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < .tmp/gmail_payload.json
```

#### Input JSON Fields

| Field | Required | Description |
|-------|----------|-------------|
| `to` | Yes | Recipient address(es), comma-separated |
| `subject` | Yes | Subject line (UTF-8 safe, auto RFC 2047 encoded) |
| `body` | Yes | Email body text |
| `from` | No | Sender (Gmail usually overrides this) |
| `cc` | No | CC addresses, comma-separated |
| `bcc` | No | BCC addresses, comma-separated |
| `reply_to` | No | Reply-To address |
| `in_reply_to` | No | In-Reply-To Message-ID header (for replies) |
| `references` | No | References header (for threading) |
| `content_type` | No | `"plain"` (default) or `"html"` |

#### Output JSON

Success:
```json
{
  "success": true,
  "raw": "<base64url encoded RFC 2822 message>",
  "summary": {
    "to": "recipient@example.com",
    "subject": "Meeting tomorrow",
    "content_type": "plain"
  }
}
```

Error:
```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Missing required field: to"
}
```

### Step 2: Call the Gmail MCP Tool

After Step 1 succeeds, use the `raw` value from the output to call the appropriate Gmail MCP tool.

#### CRITICAL — Correct MCP Parameter Structure

The MCP tool parameters MUST use nested `path` and `body` objects. **Placing parameters at the root level will fail.**

**Send email** — use `google_gmail_messages_send`:

```
Correct parameter structure:
{
  "path": { "userId": "me" },
  "body": { "raw": "<the raw value from Step 1>" }
}
```

```
WRONG — DO NOT DO THIS:
{
  "userId": "me",
  "raw": "<base64url>"
}
```

**Create draft** — use `google_gmail_drafts_create`:

```
Correct parameter structure:
{
  "path": { "userId": "me" },
  "body": { "message": { "raw": "<the raw value from Step 1>" } }
}
```

**Reply to a message** — same as send, but include `in_reply_to` and `references` in Step 1 input, and add `threadId`:

```
{
  "path": { "userId": "me" },
  "body": { "raw": "<raw>", "threadId": "<thread_id>" }
}
```

## Error Handling

- `INPUT_ERROR` — Invalid or missing JSON input. Fix the payload and retry.
- `VALIDATION_ERROR` — Missing required fields. Ask the user for the missing information.
- `BUILD_ERROR` — Failed to construct the email. Report to the user.
- `ENCODE_ERROR` — Base64 encoding failed. Report to the user.
- `SCRIPT_NOT_FOUND` — compose_email.py not found. Re-run prerequisites check.
- `PYTHON_NOT_FOUND` — python3 not in PATH. Tell the user to install Python 3.

Do not silently retry non-transient errors. Report them to the user immediately.

## Examples

### Send a simple email
Step 1 input:
```json
{"to": "alice@example.com", "subject": "Hello", "body": "Hi Alice!"}
```

### Send email with Japanese subject
Step 1 input:
```json
{"to": "tanaka@example.com", "subject": "会議のお知らせ", "body": "明日の会議は15時からです。"}
```

### Send HTML email with CC
Step 1 input:
```json
{
  "to": "team@example.com",
  "cc": "manager@example.com",
  "subject": "Weekly Report",
  "body": "<h1>Report</h1><p>All tasks completed.</p>",
  "content_type": "html"
}
```

### Create a draft instead of sending
Use the same Step 1, then in Step 2 call `google_gmail_drafts_create` instead of `google_gmail_messages_send`.

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*gmail-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/compose_email.sh"
bash "$RUNNER" < .tmp/gmail_payload.json
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "compose_email.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\compose_email.ps1"
ConvertTo-Json @{to="a@b.com"; subject="Test"; body="Hello"} | Set-Content "$env:TEMP\gmail_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\gmail_payload.json"
```
