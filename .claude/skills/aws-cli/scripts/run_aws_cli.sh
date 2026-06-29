#!/usr/bin/env bash
# AWS CLI wrapper script for the aws-cli skill.
# Accepts JSON via stdin, validates credentials, executes the AWS CLI command,
# and returns structured JSON results to stdout.
#
# Usage:
#   echo '{"command":"aws s3 ls"}' | bash run_aws_cli.sh
#   bash run_aws_cli.sh --check
#   bash run_aws_cli.sh --version
#
# EXIT CODE CONVENTION:
#   All error paths that produce valid JSON to stdout exit with 0, not 1.
#   LLM tool runners (Gemini CLI's run_shell_command, etc.) treat non-zero exit
#   codes as tool execution failures, which prevents the structured JSON error
#   from reaching the model — causing hangs or infinite retries.
#   Only the --check flag uses exit 1 for health-check compatibility.

set -euo pipefail

# Ensure writable temp directory (Codex sandbox has read-only /tmp)
_tmpdir="${TMPDIR:-/tmp}"
if ! [ -d "$_tmpdir" ] || ! [ -w "$_tmpdir" ]; then
  export TMPDIR="$PWD/.tmp"
  mkdir -p "$TMPDIR"
fi
unset _tmpdir

# Redirect AWS CLI config/cache to workspace (Codex sandbox: ~/.aws is read-only)
_aws_home="${HOME:-}/.aws"
if ! [ -d "$_aws_home" ] || ! [ -w "$_aws_home" ] 2>/dev/null; then
  mkdir -p "$PWD/.tmp/.aws"
  export AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-$PWD/.tmp/.aws/config}"
  export AWS_SHARED_CREDENTIALS_FILE="${AWS_SHARED_CREDENTIALS_FILE:-$PWD/.tmp/.aws/credentials}"
fi
unset _aws_home

VERSION="1.0.0"
DEFAULT_TIMEOUT=120
MAX_TIMEOUT=600

# ── Helpers ──────────────────────────────────────────────────────────────

json_success() {
  local cmd="$1" output="$2" exit_code="$3" elapsed="$4"
  # Escape output for JSON (handle newlines, tabs, quotes, backslashes)
  local escaped_output
  escaped_output=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$output")
  cat <<EOF
{"success":true,"command":$(python3 -c "import json; print(json.dumps('$cmd'))"),"output":${escaped_output},"exit_code":${exit_code},"elapsed_ms":${elapsed}}
EOF
}

json_error() {
  local msg="$1" code="$2"
  python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'error': sys.argv[1],
    'code': sys.argv[2]
}))
" "$msg" "$code"
}

now_ms() {
  python3 -c "import time; print(int(time.time()*1000))"
}

# ── Flags ────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--version" ]]; then
  echo "{\"version\":\"${VERSION}\"}"
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  errors=()

  # Check AWS CLI
  if command -v aws &>/dev/null; then
    aws_version=$(aws --version 2>&1 | head -1)
  else
    errors+=("AWS CLI is not installed. Install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html")
    aws_version="not found"
  fi

  # Check credentials
  key_id="${AWS_ACCESS_KEY_ID:-}"
  secret_key="${AWS_SECRET_ACCESS_KEY:-}"
  region="${AWS_DEFAULT_REGION:-}"

  has_key_id="false"
  has_secret_key="false"
  has_region="false"

  if [[ -n "$key_id" ]]; then
    has_key_id="true"
    # Mask: show first 4 and last 4 chars
    if [[ ${#key_id} -gt 8 ]]; then
      key_preview="${key_id:0:4}...${key_id: -4}"
    else
      key_preview="***"
    fi
  else
    errors+=("AWS_ACCESS_KEY_ID is not set.")
    key_preview=""
  fi

  if [[ -n "$secret_key" ]]; then
    has_secret_key="true"
    secret_preview="***"
  else
    errors+=("AWS_SECRET_ACCESS_KEY is not set.")
    secret_preview=""
  fi

  if [[ -n "$region" ]]; then
    has_region="true"
    region_preview="$region"
  else
    errors+=("AWS_DEFAULT_REGION is not set.")
    region_preview=""
  fi

  if [[ ${#errors[@]} -gt 0 ]]; then
    # Join errors
    err_msg=$(printf '%s ' "${errors[@]}")
    python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'aws_cli_version': sys.argv[1],
    'has_key_id': ${has_key_id},
    'has_secret_key': ${has_secret_key},
    'has_region': ${has_region},
    'errors': sys.argv[2:]
}))
" "$aws_version" "${errors[@]}"
    exit 1
  fi

  python3 -c "
import json
print(json.dumps({
    'success': True,
    'version': '${VERSION}',
    'aws_cli_version': '${aws_version}',
    'key_preview': '${key_preview}',
    'region': '${region_preview}'
}))
"
  exit 0
fi

# ── Main execution ───────────────────────────────────────────────────────

# Read JSON from stdin
input=$(cat)

# Parse JSON input using Python
parsed=$(python3 -c "
import json, sys

try:
    data = json.loads(sys.argv[1])
except json.JSONDecodeError as e:
    print(json.dumps({'error': f'Invalid JSON input: {e}', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

command = data.get('command', '').strip()
timeout = data.get('timeout', ${DEFAULT_TIMEOUT})

if not command:
    print(json.dumps({'error': 'Missing required field: command', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

if not command.startswith('aws '):
    print(json.dumps({'error': 'Command must start with \"aws \"', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

# Reject shell operators to prevent injection
dangerous = ['|', '&&', '||', ';', '>', '<', '\`', '\$(', '&>', '2>', '>>']
for op in dangerous:
    if op in command:
        print(json.dumps({'error': f'Shell operator \"{op}\" is not allowed in commands', 'code': 'VALIDATION_ERROR'}))
        sys.exit(1)

try:
    timeout = int(timeout)
    if timeout < 1 or timeout > ${MAX_TIMEOUT}:
        raise ValueError()
except (ValueError, TypeError):
    print(json.dumps({'error': f'timeout must be an integer between 1 and ${MAX_TIMEOUT}', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

print(json.dumps({'command': command, 'timeout': timeout}))
" "$input") || {
  echo "$parsed"
  exit 0
}

# Check if parsing returned an error
has_error=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('yes' if 'error' in d else 'no')" "$parsed")
if [[ "$has_error" == "yes" ]]; then
  echo "$parsed"
  exit 0
fi

# Extract validated fields
command=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['command'])" "$parsed")
timeout=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['timeout'])" "$parsed")

# Check AWS CLI is installed
if ! command -v aws &>/dev/null; then
  json_error "AWS CLI is not installed. Install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" "CLI_NOT_FOUND"
  exit 0
fi

# Check credentials
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] || [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  json_error "AWS credentials are not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the dashboard Skills settings." "AUTH_ERROR"
  exit 0
fi

if [[ -z "${AWS_DEFAULT_REGION:-}" ]]; then
  json_error "AWS_DEFAULT_REGION is not set. Configure it in the dashboard Skills settings." "AUTH_ERROR"
  exit 0
fi

# Execute the command
start_ms=$(now_ms)

# Use timeout command (gtimeout on macOS if available)
timeout_cmd="timeout"
if command -v gtimeout &>/dev/null; then
  timeout_cmd="gtimeout"
elif ! command -v timeout &>/dev/null; then
  # Fallback: no timeout command available, run directly
  timeout_cmd=""
fi

set +e
if [[ -n "$timeout_cmd" ]]; then
  output=$($timeout_cmd "${timeout}s" bash -c "$command" 2>&1)
  exit_code=$?
  # timeout(1) returns 124 on timeout
  if [[ $exit_code -eq 124 ]]; then
    end_ms=$(now_ms)
    elapsed=$(( end_ms - start_ms ))
    json_error "Command timed out after ${timeout} seconds" "TIMEOUT_ERROR"
    exit 0
  fi
else
  output=$(bash -c "$command" 2>&1)
  exit_code=$?
fi
set -e

end_ms=$(now_ms)
elapsed=$(( end_ms - start_ms ))

if [[ $exit_code -ne 0 ]]; then
  # Command failed but didn't timeout — return the error output
  escaped_output=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$output")
  python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'command': sys.argv[1],
    'error': json.loads(sys.argv[2]),
    'exit_code': int(sys.argv[3]),
    'code': 'EXECUTION_ERROR',
    'elapsed_ms': int(sys.argv[4])
}))
" "$command" "$escaped_output" "$exit_code" "$elapsed"
  exit 0
fi

json_success "$command" "$output" "$exit_code" "$elapsed"
