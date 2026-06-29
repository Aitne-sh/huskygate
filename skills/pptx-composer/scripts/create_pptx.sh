#!/usr/bin/env bash
# PPTX Composer wrapper script.
# Reads JSON from stdin, delegates to create_pptx_node.js (PptxGenJS)
# or falls back to create_pptx.py (python-pptx).
#
# Usage:
#   echo '{"slides":[...]}' | bash create_pptx.sh
#   bash create_pptx.sh --check
#   bash create_pptx.sh --version
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

VERSION="2.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREATE_NODE="$SCRIPT_DIR/create_pptx_node.cjs"
CREATE_PY="$SCRIPT_DIR/create_pptx.py"

# ── Helpers ──────────────────────────────────────────────────────────────

json_error() {
  local msg="$1" code="$2"
  printf '{"success":false,"error":"%s","message":"%s"}\n' "$code" "$msg"
}

# Detect which engine is available
can_use_node() {
  command -v node &>/dev/null && [[ -f "$CREATE_NODE" ]] && node -e "require('pptxgenjs')" &>/dev/null
}

can_use_python() {
  command -v python3 &>/dev/null && [[ -f "$CREATE_PY" ]] && python3 -c "import pptx" &>/dev/null
}

# ── Flags ────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--version" ]]; then
  engine="none"
  if can_use_node; then engine="pptxgenjs";
  elif can_use_python; then engine="python-pptx"; fi
  echo "{\"version\":\"${VERSION}\",\"engine\":\"${engine}\"}"
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  engine="none"
  node_ok=false
  python_ok=false

  if can_use_node; then
    node_ok=true
    engine="pptxgenjs"
  fi
  if can_use_python; then
    python_ok=true
    if [[ "$engine" == "none" ]]; then engine="python-pptx"; fi
  fi

  if [[ "$engine" == "none" ]]; then
    echo '{"success":false,"version":"'"${VERSION}"'","error":"Neither Node.js (pptxgenjs) nor Python (python-pptx) available"}'
    exit 1
  fi

  # Smoke test with the primary engine
  smoke_input='{"slides":[{"layout":"title","title":"Test"}]}'
  if [[ "$node_ok" == true ]]; then
    result=$(echo "$smoke_input" | node "$CREATE_NODE" 2>&1) || {
      echo '{"success":false,"version":"'"${VERSION}"'","error":"Node.js smoke test failed"}'
      exit 1
    }
  else
    result=$(echo "$smoke_input" | python3 "$CREATE_PY" 2>&1) || {
      echo '{"success":false,"version":"'"${VERSION}"'","error":"Python smoke test failed"}'
      exit 1
    }
  fi

  # Verify success
  is_ok=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.success?'yes':'no')" "$result" 2>/dev/null || echo "no")
  if [[ "$is_ok" == "no" ]]; then
    # Retry with Python parser if node parse failed
    is_ok=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print('yes' if d.get('success') else 'no')" "$result" 2>/dev/null || echo "no")
  fi
  if [[ "$is_ok" != "yes" ]]; then
    echo '{"success":false,"version":"'"${VERSION}"'","error":"Smoke test returned failure"}'
    exit 1
  fi

  # Clean up smoke test output
  out_file=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.file||'')" "$result" 2>/dev/null || true)
  [[ -n "$out_file" && -f "$out_file" ]] && rm -f "$out_file"
  preview_file=$(node -e "const d=JSON.parse(process.argv[1]);console.log(d.preview||'')" "$result" 2>/dev/null || true)
  [[ -n "$preview_file" && -f "$preview_file" ]] && rm -f "$preview_file"

  echo '{"success":true,"version":"'"${VERSION}"'","engine":"'"${engine}"'","node":'"${node_ok}"',"python":'"${python_ok}"'}'
  exit 0
fi

# ── Main: delegate to best available engine ──────────────────────────────

if can_use_node; then
  node "$CREATE_NODE"
elif can_use_python; then
  python3 "$CREATE_PY"
else
  json_error "Neither Node.js (pptxgenjs) nor Python (python-pptx) is available" "ENGINE_NOT_FOUND"
  exit 0
fi
