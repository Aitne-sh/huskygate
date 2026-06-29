#!/usr/bin/env bash
# Gmail Composer wrapper script.
# Reads JSON from stdin, delegates to compose_email.py, and outputs
# structured JSON with a base64url-encoded RFC 2822 email.
#
# Usage:
#   echo '{"to":"a@b.com","subject":"Test","body":"Hello"}' | bash compose_email.sh
#   bash compose_email.sh --check
#   bash compose_email.sh --version
#
# EXIT CODE CONVENTION:
#   All error paths that produce valid JSON to stdout exit with 0, not 1.
#   LLM tool runners treat non-zero exit codes as tool execution failures,
#   which prevents structured JSON errors from reaching the model.
#   Only --check uses exit 1 for health-check compatibility.

set -euo pipefail

# Ensure writable temp directory (Codex sandbox has read-only /tmp)
_tmpdir="${TMPDIR:-/tmp}"
if ! [ -d "$_tmpdir" ] || ! [ -w "$_tmpdir" ]; then
  export TMPDIR="$PWD/.tmp"
  mkdir -p "$TMPDIR"
fi
unset _tmpdir

VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_PY="$SCRIPT_DIR/compose_email.py"

# ── Helpers ──────────────────────────────────────────────────────────────

json_error() {
  local msg="$1" code="$2"
  python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'error': sys.argv[2],
    'message': sys.argv[1]
}))
" "$msg" "$code"
}

# ── Flags ────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--version" ]]; then
  echo "{\"version\":\"${VERSION}\"}"
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  # Health check: verify python3 is available and compose_email.py exists
  if ! command -v python3 &>/dev/null; then
    echo '{"success":false,"version":"'"${VERSION}"'","error":"python3 not found in PATH"}'
    exit 1
  fi

  if [[ ! -f "$COMPOSE_PY" ]]; then
    python3 -c "
import json
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'error': 'compose_email.py not found'
}))
"
    exit 1
  fi

  # Quick smoke test with minimal valid input
  result=$(echo '{"to":"test@example.com","subject":"check","body":"ok"}' | python3 "$COMPOSE_PY" 2>&1) || {
    python3 -c "
import json, sys
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'error': 'compose_email.py smoke test failed: ' + sys.argv[1][:200]
}))
" "$result"
    exit 1
  }

  # Verify it returned success
  is_ok=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('yes' if d.get('success') else 'no')" "$result" 2>/dev/null || echo "no")
  if [[ "$is_ok" != "yes" ]]; then
    python3 -c "
import json
print(json.dumps({
    'success': False,
    'version': '${VERSION}',
    'error': 'compose_email.py smoke test returned failure'
}))
"
    exit 1
  fi

  python3 -c "
import json
print(json.dumps({
    'success': True,
    'version': '${VERSION}',
    'python3': True
}))
"
  exit 0
fi

# ── Main: delegate to compose_email.py ───────────────────────────────────

if [[ ! -f "$COMPOSE_PY" ]]; then
  json_error "compose_email.py not found at $COMPOSE_PY" "SCRIPT_NOT_FOUND"
  exit 0
fi

if ! command -v python3 &>/dev/null; then
  json_error "python3 not found in PATH" "PYTHON_NOT_FOUND"
  exit 0
fi

# Pass stdin through to compose_email.py
python3 "$COMPOSE_PY"
