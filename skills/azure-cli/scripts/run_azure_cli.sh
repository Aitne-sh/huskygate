#!/usr/bin/env bash
# Azure CLI wrapper script for the azure-cli skill.
# Accepts JSON via stdin, authenticates via service principal,
# executes the Azure CLI command, and returns structured JSON results to stdout.
#
# Usage:
#   echo '{"command":"az group list --output json"}' | bash run_azure_cli.sh
#   bash run_azure_cli.sh --check
#   bash run_azure_cli.sh --version
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

# Redirect Azure CLI config to workspace (Codex sandbox: ~/.azure is read-only)
if [[ -z "${AZURE_CONFIG_DIR:-}" ]]; then
  _azure_home="${HOME:-}/.azure"
  if ! [ -d "$_azure_home" ] || ! [ -w "$_azure_home" ] 2>/dev/null; then
    export AZURE_CONFIG_DIR="$PWD/.tmp/.azure"
    mkdir -p "$AZURE_CONFIG_DIR"
  fi
  unset _azure_home
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

  # Check Azure CLI
  if command -v az &>/dev/null; then
    az_version=$(az version --output tsv 2>/dev/null | head -1 || echo "unknown")
  else
    errors+=("Azure CLI is not installed. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli")
    az_version="not found"
  fi

  # Check credentials
  client_id="${AZURE_CLIENT_ID:-}"
  client_secret="${AZURE_CLIENT_SECRET:-}"
  tenant_id="${AZURE_TENANT_ID:-}"
  subscription="${AZURE_SUBSCRIPTION_ID:-}"

  has_client_id="false"
  has_client_secret="false"
  has_tenant_id="false"
  has_subscription="false"

  if [[ -n "$client_id" ]]; then
    has_client_id="true"
    if [[ ${#client_id} -gt 8 ]]; then
      client_id_preview="${client_id:0:4}...${client_id: -4}"
    else
      client_id_preview="***"
    fi
  else
    errors+=("AZURE_CLIENT_ID is not set.")
    client_id_preview=""
  fi

  if [[ -n "$client_secret" ]]; then
    has_client_secret="true"
  else
    errors+=("AZURE_CLIENT_SECRET is not set.")
  fi

  if [[ -n "$tenant_id" ]]; then
    has_tenant_id="true"
    if [[ ${#tenant_id} -gt 8 ]]; then
      tenant_id_preview="${tenant_id:0:4}...${tenant_id: -4}"
    else
      tenant_id_preview="***"
    fi
  else
    errors+=("AZURE_TENANT_ID is not set.")
    tenant_id_preview=""
  fi

  if [[ -n "$subscription" ]]; then
    has_subscription="true"
    if [[ ${#subscription} -gt 8 ]]; then
      subscription_preview="${subscription:0:4}...${subscription: -4}"
    else
      subscription_preview="***"
    fi
  else
    errors+=("AZURE_SUBSCRIPTION_ID is not set.")
    subscription_preview=""
  fi

  if [[ ${#errors[@]} -gt 0 ]]; then
    err_msg=$(printf '%s ' "${errors[@]}")
    python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'azure_cli_version': sys.argv[1],
    'has_client_id': ${has_client_id},
    'has_client_secret': ${has_client_secret},
    'has_tenant_id': ${has_tenant_id},
    'has_subscription': ${has_subscription},
    'errors': sys.argv[2:]
}))
" "$az_version" "${errors[@]}"
    exit 1
  fi

  python3 -c "
import json
print(json.dumps({
    'success': True,
    'version': '${VERSION}',
    'azure_cli_version': '${az_version}',
    'client_id_preview': '${client_id_preview}',
    'tenant_id_preview': '${tenant_id_preview}',
    'subscription_preview': '${subscription_preview}'
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

if not command.startswith('az '):
    print(json.dumps({'error': 'Command must start with \"az \"', 'code': 'VALIDATION_ERROR'}))
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

# Check Azure CLI is installed
if ! command -v az &>/dev/null; then
  json_error "Azure CLI is not installed. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli" "CLI_NOT_FOUND"
  exit 0
fi

# Check credentials
if [[ -z "${AZURE_CLIENT_ID:-}" ]] || [[ -z "${AZURE_CLIENT_SECRET:-}" ]] || [[ -z "${AZURE_TENANT_ID:-}" ]]; then
  json_error "Azure credentials are not configured. Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in the dashboard Skills settings." "AUTH_ERROR"
  exit 0
fi

# Authenticate via service principal (non-interactive)
# Azure CLI does NOT auto-read env vars; we must explicitly log in.
auth_output=$(az login --service-principal \
  --username "${AZURE_CLIENT_ID}" \
  --password "${AZURE_CLIENT_SECRET}" \
  --tenant "${AZURE_TENANT_ID}" \
  --output none 2>&1) || {
  json_error "Azure authentication failed: ${auth_output}" "AUTH_ERROR"
  exit 0
}

# Set subscription if provided
if [[ -n "${AZURE_SUBSCRIPTION_ID:-}" ]]; then
  sub_output=$(az account set --subscription "${AZURE_SUBSCRIPTION_ID}" 2>&1) || {
    json_error "Failed to set subscription: ${sub_output}" "AUTH_ERROR"
    exit 0
  }
fi

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
