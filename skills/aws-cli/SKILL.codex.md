---
name: aws-cli
description: >-
  Execute AWS CLI commands to manage AWS cloud resources.
  Use when the user asks to interact with AWS services such as S3, EC2, Lambda,
  IAM, CloudFormation, DynamoDB, ECS, RDS, or any other AWS service.
  Requires AWS CLI v2 installed on the host and valid AWS credentials configured
  via environment variables.
---

# AWS CLI Execution

Run AWS CLI commands to manage cloud infrastructure and services.
The wrapper script validates credentials and executes commands with JSON output.

## Prerequisites

AWS CLI v2 must be installed on the host. Verify with:

```bash
SKILL_DIR=$(find . -path '*aws-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_aws_cli.sh"
bash "$RUNNER" --check
```

## Usage

Write the JSON payload to a workspace-relative temp file, then run the script with file redirection.

**IMPORTANT — Codex sandbox constraints**:
- Do NOT write to `/tmp` — it is read-only in the Codex sandbox.
- Do NOT pipe into a shell variable command (e.g. `| bash "$RUNNER"`). Use file redirection (`< file`) instead.
- Always create `.tmp/` in the workspace and export `TMPDIR` before running.

```bash
SKILL_DIR=$(find . -path '*aws-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_aws_cli.sh"

mkdir -p .tmp
export TMPDIR="$PWD/.tmp"

python3 -c '
import json
payload = {"command": "aws s3 ls"}
with open(".tmp/aws_payload.json", "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < .tmp/aws_payload.json
```

If the result contains `"code": "AUTH_ERROR"`, the AWS credentials are not configured.
Tell the user to set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`
in the dashboard Skills settings.

## JSON Input Format

```json
{
  "command": "aws <service> <operation> [--flags]",
  "timeout": 120
}
```

**Fields:**
- `command` (required) — the full AWS CLI command starting with `aws`
- `timeout` (optional) — max execution time in seconds (default: 120, max: 600)

## JSON Output Format

On success:
```json
{
  "success": true,
  "command": "aws s3 ls",
  "output": "2024-01-15 12:00:00 my-bucket\n...",
  "exit_code": 0,
  "elapsed_ms": 1250
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

- `AUTH_ERROR` — Credentials are missing or invalid. Tell the user to configure credentials in the dashboard Skills settings. Do not attempt further CLI commands.
- `CLI_NOT_FOUND` — The AWS CLI is not installed. Tell the user and stop.
- `VALIDATION_ERROR` — Fix the command syntax if possible, but do not re-run the same invalid command.

`EXECUTION_ERROR` and `TIMEOUT_ERROR` may be retried once if the error is clearly transient. Otherwise, report the error to the user immediately.

## Examples

### List S3 buckets
```json
{"command": "aws s3 ls"}
```

### Describe EC2 instances
```json
{"command": "aws ec2 describe-instances --region ap-northeast-1 --output json"}
```

### List Lambda functions
```json
{"command": "aws lambda list-functions --output json"}
```

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*aws-cli/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_aws_cli.sh"
bash "$RUNNER" < "${TMPDIR:-/tmp}/aws_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "run_aws_cli.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\run_aws_cli.ps1"
ConvertTo-Json @{command="aws s3 ls"} | Set-Content "$env:TEMP\aws_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\aws_payload.json"
```
