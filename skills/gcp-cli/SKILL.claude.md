---
name: gcp-cli
description: >-
  Execute Google Cloud CLI (gcloud) commands to manage GCP resources.
  Use when the user asks to interact with GCP services such as Compute Engine,
  Cloud Storage, Cloud Run, GKE, BigQuery, Cloud Functions, Cloud SQL,
  or any other Google Cloud service.
  Requires gcloud CLI installed on the host and valid service account credentials
  configured via environment variables.
disable-model-invocation: true
allowed-tools: Bash(gcloud *), Bash(gsutil *), Bash(bq *), Bash(python *)
---

# Google Cloud CLI Execution

Run gcloud commands to manage Google Cloud Platform infrastructure and services.
The wrapper script authenticates via service account and executes commands with JSON output.

## Prerequisites

Google Cloud SDK must be installed on the host. Verify with:

```bash
SKILL_DIR=$(find . -path '*gcp-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_gcp_cli.sh"
bash "$RUNNER" --check
```

If the check fails, install Google Cloud SDK following the official Google documentation.

## Authentication

The script authenticates non-interactively using a service account key file.
Set these environment variables in the dashboard Skills settings:

- `GOOGLE_APPLICATION_CREDENTIALS` — Absolute path to the service account JSON key file
- `CLOUDSDK_CORE_PROJECT` — Default GCP project ID

The script runs `gcloud auth activate-service-account` automatically before executing commands.

## Usage

Write the JSON payload to a temp file, then run the script with file redirection.

**IMPORTANT**: Do NOT pipe into a shell variable command (e.g. `| bash "$RUNNER"`). Use file redirection (`< file`) instead.

```bash
SKILL_DIR=$(find . -path '*gcp-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_gcp_cli.sh"

python3 -c '
import json, os
_payload_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), "gcp_payload.json")
payload = {"command": "gcloud compute instances list --format=json"}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < "${TMPDIR:-/tmp}/gcp_payload.json"
```

If the result contains `"code": "AUTH_ERROR"`, GCP credentials are not configured.
Tell the user to set `GOOGLE_APPLICATION_CREDENTIALS` and `CLOUDSDK_CORE_PROJECT`
in the dashboard Skills settings.

## JSON Input Format

```json
{
  "command": "gcloud <service> <operation> [--flags]",
  "timeout": 120
}
```

**Fields:**
- `command` (required) — a gcloud, gsutil, or bq command
- `timeout` (optional) — max execution time in seconds (default: 120, max: 600)

## JSON Output Format

On success:
```json
{
  "success": true,
  "command": "gcloud compute instances list --format=json",
  "output": "[{\"name\":\"my-vm\", ...}]",
  "exit_code": 0,
  "elapsed_ms": 2800
}
```

On error:
```json
{
  "success": false,
  "error": "Error message",
  "code": "AUTH_ERROR"
}
```

**Error codes:** `VALIDATION_ERROR`, `AUTH_ERROR`, `CLI_NOT_FOUND`, `EXECUTION_ERROR`, `TIMEOUT_ERROR`

## Error Handling

**Do NOT retry commands that return these error codes:**

- `AUTH_ERROR` — Credentials are missing, invalid, or authentication failed. Tell the user to configure credentials in the dashboard Skills settings. Do not attempt further CLI commands.
- `CLI_NOT_FOUND` — The Google Cloud SDK is not installed. Tell the user and stop.
- `VALIDATION_ERROR` — Fix the command syntax if possible, but do not re-run the same invalid command.

`EXECUTION_ERROR` and `TIMEOUT_ERROR` may be retried once if the error is clearly transient (e.g., network timeout, rate limiting). Otherwise, report the error to the user immediately.

## Security Notes

- Only commands starting with `gcloud`, `gsutil`, or `bq` are allowed
- Shell operators (`|`, `&&`, `||`, `;`, `>`, `` ` ``, `$()`) are rejected
- Authentication uses service account (non-interactive)
- Timeout prevents runaway commands (default: 120s, max: 600s)

## Examples

### List Compute Engine instances
```json
{"command": "gcloud compute instances list --format=json"}
```

### List Cloud Storage buckets
```json
{"command": "gsutil ls"}
```

### List Cloud Run services
```json
{"command": "gcloud run services list --format=json"}
```

### Get current project and account
```json
{"command": "gcloud config list --format=json"}
```

### Query BigQuery dataset
```json
{"command": "bq ls --format=json"}
```

### List GKE clusters
```json
{"command": "gcloud container clusters list --format=json"}
```

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*gcp-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_gcp_cli.sh"
bash "$RUNNER" < "${TMPDIR:-/tmp}/gcp_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "run_gcp_cli.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\run_gcp_cli.ps1"
ConvertTo-Json @{command="gcloud compute instances list --format=json"} | Set-Content "$env:TEMP\gcp_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\gcp_payload.json"
```
