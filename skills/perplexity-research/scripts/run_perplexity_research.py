#!/usr/bin/env python3
"""Perplexity Research Runner - Web search and deep research for AI agents.

Accepts a JSON payload via stdin with query and options, calls the Perplexity API,
and returns structured JSON results to stdout.

Usage:
    echo '{"query": "...", "mode": "search"}' | python run_perplexity_research.py
    python run_perplexity_research.py --check  (dependency / API key check only)
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VERSION = "1.0.0"
API_URL = "https://api.perplexity.ai/chat/completions"
ENV_KEY = "PERPLEXITY_API_KEY"

MODE_CONFIG: dict[str, dict[str, Any]] = {
    "search": {
        "model": "sonar-pro",
        "system_prompt": (
            "You are an expert research assistant. "
            "Provide concise, accurate, and up-to-date answers "
            "grounded in current web search results."
        ),
        "timeout_sec": 120,
    },
    "deep-research": {
        "model": "sonar-deep-research",
        "system_prompt": (
            "You are an expert research assistant. "
            "Conduct exhaustive research across multiple sources "
            "and provide a highly detailed, comprehensive report."
        ),
        "timeout_sec": 600,
    },
}

VALID_MODES = frozenset(MODE_CONFIG.keys())
MAX_QUERY_LEN = 32_000

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class RunnerError(Exception):
    def __init__(self, message: str, code: str = "RUNNER_ERROR") -> None:
        super().__init__(message)
        self.code = code

class ValidationError(RunnerError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "VALIDATION_ERROR")

class AuthError(RunnerError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "AUTH_ERROR")

class ApiError(RunnerError):
    def __init__(self, message: str, status_code: int = 0) -> None:
        super().__init__(message, "API_ERROR")
        self.status_code = status_code

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def check_dependencies() -> dict[str, Any]:
    """Check that the API key is configured and connectivity is possible."""
    result: dict[str, Any] = {
        "python_version": sys.version,
        "api_key_configured": False,
        "errors": [],
    }
    api_key = os.environ.get(ENV_KEY, "").strip()
    if api_key:
        result["api_key_configured"] = True
        # Show only first/last 4 chars for verification
        if len(api_key) > 8:
            result["api_key_preview"] = f"{api_key[:4]}...{api_key[-4:]}"
    else:
        result["errors"].append(
            f"Environment variable '{ENV_KEY}' is not set. "
            "Configure it in the dashboard Skills settings."
        )
    return result


def validate_payload(payload: dict[str, Any]) -> tuple[str, str]:
    """Validate and extract query + mode from the input payload."""
    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValidationError("'query' must be a non-empty string")
    query = query.strip()
    if len(query) > MAX_QUERY_LEN:
        raise ValidationError(f"Query too long ({len(query)} chars, max {MAX_QUERY_LEN})")

    mode = payload.get("mode", "search")
    if mode not in VALID_MODES:
        raise ValidationError(f"Invalid mode '{mode}'. Must be one of: {', '.join(sorted(VALID_MODES))}")

    return query, mode


def call_perplexity(query: str, mode: str, api_key: str) -> dict[str, Any]:
    """Call the Perplexity API and return structured results."""
    cfg = MODE_CONFIG[mode]

    body = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": cfg["system_prompt"]},
            {"role": "user", "content": query},
        ],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    req = urllib.request.Request(
        API_URL,
        headers=headers,
        data=json.dumps(body).encode("utf-8"),
    )

    start = time.monotonic()

    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout_sec"]) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        raise ApiError(f"HTTP {e.code}: {error_body}", status_code=e.code)
    except urllib.error.URLError as e:
        raise ApiError(f"Network/Timeout error: {e.reason}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    # Extract content from the API response
    content = ""
    citations: list[str] = []
    try:
        content = raw["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise ApiError("Unexpected API response format: missing choices[0].message.content")

    # Extract citations if present
    citations = raw.get("citations", [])

    # Extract usage info if present
    usage = raw.get("usage", {})

    return {
        "content": content,
        "citations": citations,
        "model": raw.get("model", cfg["model"]),
        "usage": usage,
        "elapsed_ms": elapsed_ms,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        result = check_dependencies()
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        sys.exit(0 if not result["errors"] else 1)

    if len(sys.argv) > 1 and sys.argv[1] == "--version":
        print(json.dumps({"version": VERSION}))
        sys.exit(0)

    output: dict[str, Any] = {"version": VERSION, "success": True}

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValidationError("Empty input. Provide JSON via stdin.")

        try:
            payload = json.loads(raw_input)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON input: {e}")

        query, mode = validate_payload(payload)

        # Resolve API key
        api_key = os.environ.get(ENV_KEY, "").strip()
        if not api_key:
            raise AuthError(
                f"Environment variable '{ENV_KEY}' is not set. "
                "Configure it in the dashboard Skills settings."
            )

        output["mode"] = mode
        output["query"] = query[:200] + ("..." if len(query) > 200 else "")

        result = call_perplexity(query, mode, api_key)
        output.update(result)

    except RunnerError as e:
        output["success"] = False
        output["error"] = str(e)
        output["code"] = e.code
    except Exception as e:
        output["success"] = False
        output["error"] = str(e)
        output["code"] = "UNEXPECTED_ERROR"
        output["traceback"] = traceback.format_exc()

    json.dump(output, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    sys.exit(0 if output["success"] else 1)


if __name__ == "__main__":
    main()
