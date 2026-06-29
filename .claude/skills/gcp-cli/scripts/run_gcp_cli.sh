#!/usr/bin/env bash
# GCP CLI wrapper script for the gcp-cli skill.
# Accepts JSON via stdin, authenticates via service account key file,
# executes the gcloud/gsutil/bq command, and returns structured JSON results to stdout.
#
# Usage:
#   echo '{"command":"gcloud compute instances list --format=json"}' | bash run_gcp_cli.sh
#   bash run_gcp_cli.sh --check
#   bash run_gcp_cli.sh --version
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

# Redirect gcloud config to workspace (Codex sandbox: ~/.config/gcloud is read-only)
if [[ -z "${CLOUDSDK_CONFIG:-}" ]]; then
  _gcloud_home="${HOME:-}/.config/gcloud"
  if ! [ -d "$_gcloud_home" ] || ! [ -w "$_gcloud_home" ] 2>/dev/null; then
    export CLOUDSDK_CONFIG="$PWD/.tmp/.gcloud"
    mkdir -p "$CLOUDSDK_CONFIG"
  fi
  unset _gcloud_home
fi

VERSION="1.0.0"
DEFAULT_TIMEOUT=120
MAX_TIMEOUT=600

# ── Helpers ──────────────────────────────────────────────────────────────

json_success() {
  local cmd="$1" output="$2" exit_code="$3" elapsed="$4"
  local escaped_output escaped_cmd
  escaped_output=$(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$output")
  escaped_cmd=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$cmd")
  cat <<EOF
{"success":true,"command":${escaped_cmd},"output":${escaped_output},"exit_code":${exit_code},"elapsed_ms":${elapsed}}
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

  # Check gcloud CLI
  if command -v gcloud &>/dev/null; then
    gcloud_version=$(gcloud version --format="value(Google Cloud SDK)" 2>/dev/null || echo "unknown")
  else
    errors+=("Google Cloud SDK is not installed. Install: https://cloud.google.com/sdk/docs/install")
    gcloud_version="not found"
  fi

  # Check credentials
  key_file="${GOOGLE_APPLICATION_CREDENTIALS:-}"
  project="${CLOUDSDK_CORE_PROJECT:-}"

  has_key_file="false"
  has_project="false"

  if [[ -n "$key_file" ]]; then
    if [[ -f "$key_file" ]]; then
      has_key_file="true"
      key_file_preview="$(basename "$key_file")"
    else
      errors+=("GOOGLE_APPLICATION_CREDENTIALS points to a non-existent file: ${key_file}")
      key_file_preview="file not found"
    fi
  else
    errors+=("GOOGLE_APPLICATION_CREDENTIALS is not set.")
    key_file_preview=""
  fi

  if [[ -n "$project" ]]; then
    has_project="true"
    project_preview="$project"
  else
    errors+=("CLOUDSDK_CORE_PROJECT is not set.")
    project_preview=""
  fi

  if [[ ${#errors[@]} -gt 0 ]]; then
    python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'gcloud_version': sys.argv[1],
    'has_key_file': ${has_key_file},
    'has_project': ${has_project},
    'errors': sys.argv[2:]
}))
" "$gcloud_version" "${errors[@]}"
    exit 1
  fi

  python3 -c "
import json
print(json.dumps({
    'success': True,
    'version': '${VERSION}',
    'gcloud_version': '${gcloud_version}',
    'key_file': '${key_file_preview}',
    'project': '${project_preview}'
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

# Allow gcloud, gsutil, and bq commands
allowed_prefixes = ('gcloud ', 'gsutil ', 'bq ')
if not any(command.startswith(p) for p in allowed_prefixes):
    print(json.dumps({'error': 'Command must start with \"gcloud\", \"gsutil\", or \"bq\"', 'code': 'VALIDATION_ERROR'}))
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

# Check gcloud CLI is installed
if ! command -v gcloud &>/dev/null; then
  json_error "Google Cloud SDK is not installed. Install: https://cloud.google.com/sdk/docs/install" "CLI_NOT_FOUND"
  exit 0
fi

# Check credentials
if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]; then
  json_error "GOOGLE_APPLICATION_CREDENTIALS is not set. Configure it in the dashboard Skills settings." "AUTH_ERROR"
  exit 0
fi

if [[ ! -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  json_error "Service account key file not found: ${GOOGLE_APPLICATION_CREDENTIALS}" "AUTH_ERROR"
  exit 0
fi

if [[ -z "${CLOUDSDK_CORE_PROJECT:-}" ]]; then
  json_error "CLOUDSDK_CORE_PROJECT is not set. Configure it in the dashboard Skills settings." "AUTH_ERROR"
  exit 0
fi

# Authenticate via service account key file (non-interactive)
# gcloud CLI does NOT auto-read GOOGLE_APPLICATION_CREDENTIALS; we must explicitly activate.
auth_output=$(gcloud auth activate-service-account \
  --key-file="${GOOGLE_APPLICATION_CREDENTIALS}" \
  --project="${CLOUDSDK_CORE_PROJECT}" 2>&1) || {
  json_error "GCP authentication failed: ${auth_output}" "AUTH_ERROR"
  exit 0
}

# Set the project explicitly
gcloud config set project "${CLOUDSDK_CORE_PROJECT}" --quiet 2>/dev/null || true

# Execute the command
start_ms=$(now_ms)

# Use timeout command (gtimeout on macOS if available)
timeout_cmd="timeout"
if command -v gtimeout &>/dev/null; then
  timeout_cmd="gtimeout"
elif ! command -v timeout &>/dev/null; then
  timeout_cmd=""
fi

set +e
if [[ -n "$timeout_cmd" ]]; then
  output=$($timeout_cmd "${timeout}s" bash -c "$command" 2>&1)
  exit_code=$?
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
