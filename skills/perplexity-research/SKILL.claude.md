---
name: perplexity-research
description: >-
  Search the web and conduct deep research using the Perplexity API.
  Use when the user asks to look up current information, verify facts,
  research a topic in depth, or gather web-sourced data with citations.
  Supports fast search (sonar-pro) and comprehensive deep-research (sonar-deep-research).
disable-model-invocation: true
allowed-tools: Bash(python *)
---

# Perplexity Web Search & Deep Research

Query the Perplexity API for web-grounded answers with citations.
The script accepts a JSON payload via stdin and returns structured JSON results to stdout.

**Two modes:**
- `search` (default) — fast, concise answers via `sonar-pro` (up to 2 min)
- `deep-research` — comprehensive multi-source synthesis via `sonar-deep-research` (up to 10 min)

## Usage

Write the JSON payload to a temp file, then run the script with file redirection.
If the `.venv` environment does not exist, it will be automatically created and dependencies will be installed.

**IMPORTANT**: Do NOT pipe into a shell variable command (e.g. `| "$PY" ...`). Use file redirection (`< file`) instead.

```bash
SKILL_DIR=$(find . -path '*perplexity-research/scripts' -print -quit | xargs dirname)
if [ ! -d "$SKILL_DIR/.venv" ]; then
    python3 -m venv "$SKILL_DIR/.venv"
    "$SKILL_DIR/.venv/bin/pip" install -r "$SKILL_DIR/requirements.txt"
fi

RUNNER="$SKILL_DIR/scripts/run_perplexity_research.py"
PY="$SKILL_DIR/.venv/bin/python"

python3 -c '
import json, os
_payload_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), "pplx_payload.json")
payload = {"query": "What is the current population of Tokyo?", "mode": "search"}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
"$PY" "$RUNNER" < "${TMPDIR:-/tmp}/pplx_payload.json"
```

If the result contains `"code": "AUTH_ERROR"`, the API key is not configured.
Run `"$PY" "$RUNNER" --check` to verify the environment.

## JSON Input Format

```json
{
  "query": "Your question or research topic",
  "mode": "search"
}
```

**Fields:**
- `query` (required) — the question or research topic (max 32,000 chars)
- `mode` (optional) — `search` (default, fast) or `deep-research` (comprehensive, slow)

## JSON Output Format

On success:
```json
{
  "version": "1.0.0",
  "success": true,
  "mode": "search",
  "query": "What is the current population of Tokyo?",
  "content": "The current population of Tokyo is approximately ...",
  "citations": ["https://source1.com", "https://source2.com"],
  "model": "sonar-pro",
  "usage": {"prompt_tokens": 42, "completion_tokens": 150},
  "elapsed_ms": 2340
}
```

On error:
```json
{
  "version": "1.0.0",
  "success": false,
  "error": "Error message",
  "code": "AUTH_ERROR"
}
```

**Error codes:** `VALIDATION_ERROR`, `AUTH_ERROR`, `API_ERROR`, `UNEXPECTED_ERROR`

When `success` is `false`, report the `error` message to the user.
If `code` is `AUTH_ERROR`, tell the user to configure the Perplexity API key in the dashboard.

## Examples

### Quick web search
```json
{"query": "Latest developments in quantum computing 2025", "mode": "search"}
```

### Deep research report
```json
{"query": "Compare the economic impacts of renewable energy policies across G7 nations", "mode": "deep-research"}
```

### Fact-checking
```json
{"query": "Is it true that the Great Wall of China is visible from space?", "mode": "search"}
```

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*perplexity-research/scripts' -print -quit | xargs dirname)
if [ ! -d "$SKILL_DIR/.venv" ]; then
    python3 -m venv "$SKILL_DIR/.venv"
    "$SKILL_DIR/.venv/bin/pip" install -r "$SKILL_DIR/requirements.txt"
fi
PY="$SKILL_DIR/.venv/bin/python"
RUNNER="$SKILL_DIR/scripts/run_perplexity_research.py"
"$PY" "$RUNNER" < "${TMPDIR:-/tmp}/pplx_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "run_perplexity_research.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\run_perplexity_research.ps1"
ConvertTo-Json @{query="What is quantum computing?"; mode="search"} | Set-Content "$env:TEMP\pplx_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\pplx_payload.json"
```
