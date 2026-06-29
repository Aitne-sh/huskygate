#!/usr/bin/env bash
# Schedule Manager wrapper script for the schedule-manager skill.
# Calls HuskyGate's Server Internal API to manage scheduled tasks.
# Returns structured JSON results to stdout.
#
# Usage:
#   bash run_schedule_manager.sh create < .tmp/sched_payload.json
#   bash run_schedule_manager.sh list
#   bash run_schedule_manager.sh get <task_id>
#   bash run_schedule_manager.sh update <task_id> < .tmp/sched_payload.json
#   bash run_schedule_manager.sh pause <task_id>
#   bash run_schedule_manager.sh resume <task_id>
#   bash run_schedule_manager.sh delete <task_id>
#   bash run_schedule_manager.sh history <task_id>
#   bash run_schedule_manager.sh --check
#   bash run_schedule_manager.sh --version
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

VERSION="1.1.0"
API_BASE="${HUSKYGATE_API_BASE:-http://127.0.0.1:3738}"
API_SECRET="${HUSKYGATE_API_SECRET:-}"

# ── Helpers ──────────────────────────────────────────────────────────────

json_success() {
  local data="$1"
  python3 -c "
import json, sys
data = json.loads(sys.argv[1])
print(json.dumps({'success': True, 'data': data}))
" "$data"
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

# Build Authorization header if API_SECRET is set
auth_header() {
  if [[ -n "$API_SECRET" ]]; then
    echo "-H"
    echo "Authorization: Bearer ${API_SECRET}"
  fi
}

# Perform an HTTP request via curl and handle errors uniformly.
# Usage: api_call <method> <path> [json_body]
api_call() {
  local method="$1" url_path="$2" body="${3:-}"
  local url="${API_BASE}${url_path}"

  local -a curl_args=(
    -s -S
    -w '\n%{http_code}'
    -X "$method"
    -H 'Content-Type: application/json'
  )

  if [[ -n "$API_SECRET" ]]; then
    curl_args+=(-H "Authorization: Bearer ${API_SECRET}")
  fi

  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi

  local raw_response
  raw_response=$(curl "${curl_args[@]}" "$url" 2>&1) || {
    json_error "Failed to connect to HuskyGate API at ${API_BASE}: ${raw_response}" "CONNECTION_ERROR"
    return 1
  }

  # Split response body and HTTP status code
  local http_code
  http_code=$(echo "$raw_response" | tail -1)
  local response_body
  response_body=$(echo "$raw_response" | sed '$d')

  # Check for HTTP errors
  if [[ "$http_code" -ge 400 ]]; then
    # Try to extract error message from response
    local error_msg
    error_msg=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(d.get('error', 'Unknown API error'))
except:
    print('HTTP ' + sys.argv[2] + ': ' + sys.argv[1][:200])
" "$response_body" "$http_code" 2>/dev/null || echo "HTTP ${http_code}")
    json_error "$error_msg" "API_ERROR_${http_code}"
    return 1
  fi

  echo "$response_body"
}

# ── Flags ────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--version" ]]; then
  echo "{\"version\":\"${VERSION}\"}"
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  # Health check: verify API connectivity
  response=$(curl -s -S -o /dev/null -w '%{http_code}' \
    -X GET \
    -H 'Content-Type: application/json' \
    ${API_SECRET:+-H "Authorization: Bearer ${API_SECRET}"} \
    "${API_BASE}/api/schedules" 2>&1) || {
    python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'api_base': '${API_BASE}',
    'error': 'Cannot connect to HuskyGate API: ' + sys.argv[1]
}))
" "$response"
    exit 1
  }

  if [[ "$response" -ge 200 ]] && [[ "$response" -lt 300 ]]; then
    python3 -c "
import json
print(json.dumps({
    'success': True,
    'version': '${VERSION}',
    'api_base': '${API_BASE}',
    'http_status': ${response},
    'has_api_secret': $([ -n \"${API_SECRET}\" ] && echo 'True' || echo 'False')
}))
"
    exit 0
  else
    python3 -c "
import json
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'api_base': '${API_BASE}',
    'http_status': ${response},
    'error': 'HuskyGate API returned HTTP ${response}'
}))
"
    exit 1
  fi
fi

# ── Action dispatch ──────────────────────────────────────────────────────

ACTION="${1:-}"
TASK_ID="${2:-}"

if [[ -z "$ACTION" ]]; then
  json_error "Missing action. Usage: run_schedule_manager.sh <create|list|get|update|pause|resume|delete|history> [task_id]" "USAGE_ERROR"
  exit 0
fi

case "$ACTION" in

  create)
    # Read JSON payload from stdin
    input=$(cat)
    if [[ -z "$input" ]]; then
      json_error "No JSON payload provided on stdin" "VALIDATION_ERROR"
      exit 0
    fi

    # Validate required fields using Python
    validated=$(python3 -c "
import json, sys

try:
    data = json.loads(sys.argv[1])
except json.JSONDecodeError as e:
    print(json.dumps({'error': f'Invalid JSON input: {e}', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

name = (data.get('name') or '').strip()
prompt = (data.get('prompt') or '').strip()
schedule_type = data.get('schedule_type', '')
tool = data.get('tool', 'claude')
mode = data.get('mode', 'readonly')

errors = []
if not name:
    errors.append('name is required')
if not prompt:
    errors.append('prompt is required')
if schedule_type not in ('once', 'recurring'):
    errors.append('schedule_type must be \"once\" or \"recurring\"')

if schedule_type == 'once' and not data.get('run_at'):
    errors.append('run_at is required for once schedule')
if schedule_type == 'recurring' and not data.get('cron_expr'):
    errors.append('cron_expr is required for recurring schedule')

if errors:
    print(json.dumps({'error': '; '.join(errors), 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)

# Build the API payload
payload = {
    'name': name,
    'tool': tool,
    'mode': mode,
    'prompt': prompt,
    'schedule_type': schedule_type,
}
if data.get('run_at'):
    payload['run_at'] = data['run_at']
if data.get('cron_expr'):
    payload['cron_expr'] = data['cron_expr']
if data.get('timezone'):
    payload['timezone'] = data['timezone']
if data.get('notify_channel'):
    payload['notify_channel'] = data['notify_channel']
if data.get('notify_thread'):
    payload['notify_thread'] = data['notify_thread']
if 'max_runs' in data:
    payload['max_runs'] = data['max_runs']
if 'max_retries' in data:
    payload['max_retries'] = data['max_retries']

print(json.dumps(payload))
" "$input") || {
      echo "$validated"
      exit 0
    }

    # Check if validation returned an error
    has_error=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('yes' if 'error' in d else 'no')" "$validated")
    if [[ "$has_error" == "yes" ]]; then
      echo "$validated"
      exit 0
    fi

    result=$(api_call POST /api/schedules "$validated") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  list)
    result=$(api_call GET /api/schedules) || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  get)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh get <task_id>" "VALIDATION_ERROR"
      exit 0
    fi
    result=$(api_call GET "/api/schedules/${TASK_ID}") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  update)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh update <task_id>" "VALIDATION_ERROR"
      exit 0
    fi

    # Read JSON payload from stdin
    input=$(cat)
    if [[ -z "$input" ]]; then
      json_error "No JSON payload provided on stdin" "VALIDATION_ERROR"
      exit 0
    fi

    # Validate JSON
    validated=$(python3 -c "
import json, sys
try:
    data = json.loads(sys.argv[1])
    # Build patch payload — only include fields that are present
    patch = {}
    if 'name' in data: patch['name'] = data['name']
    if 'prompt' in data: patch['prompt'] = data['prompt']
    if 'tool' in data: patch['tool'] = data['tool']
    if 'mode' in data: patch['mode'] = data['mode']
    if 'cron_expr' in data: patch['cron_expr'] = data['cron_expr']
    if 'timezone' in data: patch['timezone'] = data['timezone']
    if 'notify_channel' in data: patch['notify_channel'] = data['notify_channel']
    if 'notify_thread' in data: patch['notify_thread'] = data['notify_thread']
    if 'max_runs' in data: patch['max_runs'] = data['max_runs']
    if 'max_retries' in data: patch['max_retries'] = data['max_retries']
    if 'status' in data: patch['status'] = data['status']
    print(json.dumps(patch))
except json.JSONDecodeError as e:
    print(json.dumps({'error': f'Invalid JSON input: {e}', 'code': 'VALIDATION_ERROR'}))
    sys.exit(1)
" "$input") || {
      echo "$validated"
      exit 0
    }

    has_error=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('yes' if 'error' in d else 'no')" "$validated")
    if [[ "$has_error" == "yes" ]]; then
      echo "$validated"
      exit 0
    fi

    result=$(api_call PATCH "/api/schedules/${TASK_ID}" "$validated") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  pause)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh pause <task_id>" "VALIDATION_ERROR"
      exit 0
    fi
    body='{"status":"paused"}'
    result=$(api_call PATCH "/api/schedules/${TASK_ID}" "$body") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  resume)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh resume <task_id>" "VALIDATION_ERROR"
      exit 0
    fi
    body='{"status":"active"}'
    result=$(api_call PATCH "/api/schedules/${TASK_ID}" "$body") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  delete)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh delete <task_id>" "VALIDATION_ERROR"
      exit 0
    fi
    result=$(api_call DELETE "/api/schedules/${TASK_ID}") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  history)
    if [[ -z "$TASK_ID" ]]; then
      json_error "Missing task_id. Usage: run_schedule_manager.sh history <task_id>" "VALIDATION_ERROR"
      exit 0
    fi
    result=$(api_call GET "/api/schedules/${TASK_ID}/runs?limit=20") || {
      echo "$result"
      exit 0
    }
    json_success "$result"
    exit 0
    ;;

  *)
    json_error "Unknown action: ${ACTION}. Valid actions: create, list, get, update, pause, resume, delete, history" "USAGE_ERROR"
    exit 0
    ;;
esac
