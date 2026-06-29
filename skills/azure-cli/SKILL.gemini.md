---
name: azure-cli
description: >-
  Execute Azure CLI commands to manage Microsoft Azure cloud resources.
  Use when the user asks to interact with Azure services such as VMs, Storage,
  App Service, AKS, Azure Functions, SQL Database, Key Vault, or any other Azure service.
  Requires Azure CLI installed on the host and valid service principal credentials
  configured via environment variables.
---

# Azure CLI Execution

Run Azure CLI commands to manage Microsoft Azure cloud infrastructure and services.
The wrapper script authenticates via service principal and executes commands with JSON output.

## Prerequisites

Azure CLI must be installed on the host. Verify with:

```bash
SKILL_DIR=$(find . -path '*azure-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_azure_cli.sh"
bash "$RUNNER" --check
```

## Usage

Write the JSON payload to a temp file, then run the script with file redirection.

**IMPORTANT**: Do NOT use heredoc syntax or pipe into a shell variable command (e.g. `| bash "$RUNNER"`). Use file redirection (`< file`) instead.

```bash
SKILL_DIR=$(find . -path '*azure-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_azure_cli.sh"

python3 -c '
import json, os
_payload_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), "az_payload.json")
payload = {"command": "az group list --output json"}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < "${TMPDIR:-/tmp}/az_payload.json"
```

If the result contains `"code": "AUTH_ERROR"`, Azure credentials are not configured.
Tell the user to set `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID`
in the dashboard Skills settings.

## JSON Input Format

```json
{
  "command": "az <service> <operation> [--flags]",
  "timeout": 120
}
```

**Fields:**
- `command` (required) — the full Azure CLI command starting with `az`
- `timeout` (optional) — max execution time in seconds (default: 120, max: 600)

## JSON Output Format

On success:
```json
{
  "success": true,
  "command": "az group list --output json",
  "output": "[{\"name\":\"my-rg\", ...}]",
  "exit_code": 0,
  "elapsed_ms": 3200
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

## Error Handling — CRITICAL

**NEVER retry commands that return these error codes:**

- `AUTH_ERROR` — Credentials are missing, invalid, or authentication failed. This is a **configuration problem** that the user must fix manually in the dashboard Skills settings. **Stop executing CLI commands immediately** and tell the user.
- `CLI_NOT_FOUND` — The Azure CLI is not installed on the host. **Stop immediately** and tell the user.
- `VALIDATION_ERROR` — The command format is invalid. Fix the command syntax, but **do NOT re-run the same invalid command**.

**`EXECUTION_ERROR` and `TIMEOUT_ERROR` may be retried at most once**, and only if the error appears transient (e.g., network timeout, throttling). If the retry also fails, **stop and report the error to the user**.

**IMPORTANT**: If you receive any error, report it to the user right away. Do NOT silently retry the same command hoping for a different result. Retrying non-transient errors causes infinite loops.

## Examples

### List resource groups
```json
{"command": "az group list --output json"}
```

### List VMs
```json
{"command": "az vm list --resource-group my-rg --output json"}
```

### Show current account
```json
{"command": "az account show --output json"}
```

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*azure-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_azure_cli.sh"
bash "$RUNNER" < "${TMPDIR:-/tmp}/az_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "run_azure_cli.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\run_azure_cli.ps1"
ConvertTo-Json @{command="az group list --output json"} | Set-Content "$env:TEMP\az_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\az_payload.json"
```
