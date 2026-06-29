---
name: playwright-runner
description: >-
  Automate stealth browser interactions using undetected-chromedriver.
  Use when the user asks to navigate websites, take screenshots, fill forms,
  click buttons, scrape web content, or perform any browser-based task.
  Bypasses advanced bot detection (Cloudflare, DataDome) via Selenium + UC.
  Runs with a visible browser window by default for manual CAPTCHA solving.
  Supports text-based element interaction — use click_by_text and
  get_page_structure for the most reliable element targeting.
---

# Stealth Browser Automation (undetected-chromedriver)

Automate browser tasks by running the UC runner script.
The script accepts a JSON payload via stdin with a list of sequential actions.
Uses undetected-chromedriver to bypass bot detection systems.

**Key defaults**: visible browser window (`headless: false`), human-like pacing
between actions (`slow_mo_ms: 800`), and post-navigation wait (`post_navigate_wait_ms: 3000`)
to allow manual CAPTCHA solving on first visit.

## Setup

The virtual environment (.venv) is **automatically created** when HuskyGate seeds this skill.
Before running, verify the venv exists. If it does not, create it manually:

```bash
SKILL_DIR=$(find . -path '*playwright-runner/scripts' -print -quit | xargs dirname)
if [ ! -x "$SKILL_DIR/.venv/bin/python" ]; then
  python3 -m venv "$SKILL_DIR/.venv" && "$SKILL_DIR/.venv/bin/pip" install -q -r "$SKILL_DIR/requirements.txt"
fi
```

Check installation:
```bash
SKILL_DIR=$(find . -path '*playwright-runner/scripts' -print -quit | xargs dirname)
"$SKILL_DIR/.venv/bin/python" "$SKILL_DIR/scripts/run_playwright.py" --check
```

## Usage

Write the JSON payload to a temp file, then run the script with file redirection.
**IMPORTANT**: Do NOT use heredoc syntax or pipe into a shell variable command (e.g. `| "$PY" ...`). Use file redirection (`< file`) instead.
**Always use the venv Python**. If the venv is missing, run the Setup commands above first.

```bash
SKILL_DIR=$(find . -path '*playwright-runner/scripts' -print -quit | xargs dirname)
if [ ! -d "$SKILL_DIR/.venv" ]; then
    python3 -m venv "$SKILL_DIR/.venv"
    "$SKILL_DIR/.venv/bin/pip" install -q -r "$SKILL_DIR/requirements.txt"
fi

RUNNER="$SKILL_DIR/scripts/run_playwright.py"
PY="$SKILL_DIR/.venv/bin/python"

python3 -c '
import json, os
_payload_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), "pw_payload.json")
payload = {
    "actions": [
        {"action": "navigate", "url": "https://example.com"},
        {"action": "screenshot", "path": "page.png"},
        {"action": "get_text", "selector": "body"}
    ],
    "options": {}
}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
"$PY" "$RUNNER" < "${TMPDIR:-/tmp}/pw_payload.json"
```

## Selector Guide (IMPORTANT — Read Before Using)

This script uses **Selenium** (not Playwright). Selectors must be standard CSS or XPath.

### BEST PRACTICE: Use text-based actions instead of complex selectors

Instead of guessing selectors, prefer these high-level actions:

- `click_by_text`: Click any element by its visible text (e.g., "お問い合わせ", "Submit")
- `get_page_structure`: Discover all interactive elements (links, buttons, inputs) on the page
- `get_elements`: Query elements matching a selector and inspect their properties

### Supported selector formats

- **CSS selector** (`#id`, `.class`, `button[type=submit]`, `nav a`): Standard CSS
- **XPath** (`//a[contains(text(), "Contact")]`): Must start with `/` or `(`
- **Explicit CSS** (`css=.my-class`): Prefix `css=` stripped, uses CSS
- **Explicit XPath** (`xpath=//div[@id='main']`): Prefix `xpath=` stripped, uses XPath

### Auto-translated Playwright selectors

These Playwright-style selectors are **automatically converted** to XPath:

- `text="exact text"` → XPath exact text match
- `text=partial text` → XPath contains match
- `a:has-text("text")` → `//a[contains(., "text")]`
- `button:has-text("text")` → `//button[contains(., "text")]`
- `:has-text("text")` → `//*[contains(., "text")]`
- `span:text("text")` → `//span[contains(., "text")]`
- `a:text-is("exact")` → `//a[normalize-space(.)="exact"]`
- `role=button[name="text"]` → XPath role + aria-label match
- `role=link` → `//*[@role="link"]`
- `label="Username"` → XPath for input associated with label

### DO NOT USE these formats (will error)

- `>> nth=0` (Playwright chaining)
- `.class >> button` (Playwright chaining)
- `:nth-match()` (Playwright-only pseudo)
- `data-testid=value` without brackets (use `[data-testid="value"]` instead)

## JSON Payload Format

```json
{
  "actions": [<action>, ...],
  "options": {
    "headless": false,
    "timeout_ms": 30000,
    "slow_mo_ms": 800,
    "post_navigate_wait_ms": 3000,
    "type_delay_ms": 50,
    "stop_on_error": false,
    "allow_js_eval": false,
    "allow_loopback": false,
    "lang": "en-US",
    "viewport": {"width": 1280, "height": 720},
    "workdir": ".",
    "user_agent": null,
    "proxy": null
  }
}
```

### Options Reference

- `headless` (Default: `false`): Show browser window. Set `true` for headless (required for `pdf` action).
- `slow_mo_ms` (Default: `800`): Pause (ms) between every action for human-like pacing. Set `0` to disable.
- `post_navigate_wait_ms` (Default: `3000`): Extra wait (ms) after each `navigate` action (CAPTCHA / lazy-load settle time).
- `type_delay_ms` (Default: `50`): Default per-character typing delay (ms). Overridden by per-action `delay_ms`.
- `timeout_ms` (Default: `30000`): Default per-action timeout (ms).
- `stop_on_error` (Default: `false`): Stop executing remaining actions on first error. Useful with `assert`.
- `allow_js_eval` (Default: `false`): Enable the `evaluate` action.
- `allow_loopback` (Default: `false`): Allow navigation to localhost / 127.0.0.1.
- `lang` (Default: auto): Browser language. Auto-detected from system locale.
- `viewport` (Default: `1280x720`): Browser window size `{"width": N, "height": N}`.
- `workdir` (Default: `.`): Working directory for path confinement.
- `user_agent` (Default: auto): Custom User-Agent string. Leave unset for UC default (real Chrome UA).
- `proxy` (Default: none): Proxy server URL (e.g., `http://proxy:8080`, `socks5://proxy:1080`).

## Available Actions

**Each action result includes `duration_ms`** — the wall-clock execution time in milliseconds.

### Navigation & Lifecycle
- `launch`: No fields required. Starts the browser if not already running.
- `navigate`: Requires `url`. Optional: `wait_until` (load/domcontentloaded/networkidle), `post_wait_ms`.
- `go_back`: No fields required.
- `go_forward`: No fields required.
- `reload`: No fields required.
- `new_page`: No fields required. Opens a new tab.
- `get_url`: No fields required. Returns current URL.
- `get_title`: No fields required. Returns page title.
- `close`: No fields required. Closes the browser.

### Interaction (selector-based)
- `click`: Requires `selector`. Optional: `button` (left/right/middle), `click_count`. Auto-scrolls into view.
- `hover`: Requires `selector`. Moves mouse over element (reveals menus/tooltips).
- `type`: Requires `selector`, `text`. Optional: `delay_ms`, `clear`.
- `fill`: Requires `selector`, `text`. Like `type` but always clears existing content first.
- `select`: Requires `selector`, `value` OR `label`.
- `press_key`: Requires `key`. Optional: `selector`. Sends keyboard keys (Enter, Tab, Escape, Control+a, etc.).
- `scroll`: Optional: `direction` (up/down/left/right), `amount`.

### Interaction (text-based — RECOMMENDED for AI agents)
- `click_by_text`: Requires `text`. Optional: `tag` (e.g. "a", "button"), `exact` (boolean). Clicks the most specific visible element matching the text. Auto-scrolls into view.
- `get_page_structure`: No fields required. Returns all interactive elements (links, buttons, inputs, selects) with text, labels, and selectors.

### Data Extraction
- `get_text`: Requires `selector`. Optional: `max_length`.
- `get_attribute`: Requires `selector`, `attribute` (string or list of strings).
- `get_elements`: Requires `selector`. Optional: `max_count`, `attributes` (list of attribute names).

### Cookie Management
- `get_cookies`: Optional: `name` (filter by cookie name). Returns all cookies for the current domain.
- `set_cookies`: Requires `cookies` (list of `{name, value, ...}` objects). Sets cookies.
- `clear_cookies`: Optional: `name` (delete specific cookie). Clears all cookies if no name given.

### Tab Management
- `list_tabs`: No fields required. Returns all open tabs with title, URL, and active status.
- `switch_tab`: Requires `index` (0-based) OR `handle`. Switches to the specified tab.

### Capture & Export
- `screenshot`: Optional: `path`, `full_page`.
- `pdf`: Optional: `path`. **Requires `headless: true`**.

### Assertion
- `assert`: Requires `type` and varies by type. Use with `stop_on_error: true`.
  - `type: "url"` — Requires `expected`. Checks current URL.
  - `type: "title"` — Requires `expected`. Checks page title.
  - `type: "text"` — Requires `selector`, `expected`. Checks element text content.
  - `type: "element_visible"` — Requires `selector`. Checks element is visible.
  - `type: "element_hidden"` — Requires `selector`. Checks element is not visible.
  - Optional: `match` — `"contains"` (default), `"exact"`, `"regex"`.

### Advanced
- `evaluate`: Requires `expression`. Requires `allow_js_eval=true` in options.
- `wait`: Requires `selector` OR `duration_ms`. Optional: `state` (visible/hidden/attached/detached).
- `wait_for_user`: Pauses and waits for user to press Enter in terminal. Optional: `message`, `fallback_wait_ms`.
- `check`: No fields required (dependency check).

## CAPTCHA Handling

The browser runs with a visible window by default. When a CAPTCHA appears:

1. Use `wait_for_user` action — the script pauses and prints a prompt to the terminal.
   The user solves the CAPTCHA in the visible browser, then presses Enter to resume.
2. Alternatively, set a generous `post_wait_ms` on the `navigate` action to give time
   for manual solving without pausing the script.

## Security Notes

- Only `http://` and `https://` URLs are allowed
- `localhost` / `127.0.0.1` blocked unless `allow_loopback: true`
- JavaScript `evaluate` disabled unless `allow_js_eval: true`
- Screenshot/PDF paths are confined to the working directory
- Global timeout: 10 minutes per invocation
- Max 50 actions per invocation

## Examples

### Click a link by its visible text (RECOMMENDED approach)
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "click_by_text", "text": "お問い合わせ", "tag": "a"},
    {"action": "screenshot", "path": "after_click.png"}
  ]
}
```

### Discover page structure before interacting
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "get_page_structure"}
  ]
}
```

### Assert navigation result (use with stop_on_error)
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "assert", "type": "title", "expected": "Example Domain", "match": "exact"},
    {"action": "assert", "type": "element_visible", "selector": "h1"},
    {"action": "assert", "type": "text", "selector": "h1", "expected": "Example"}
  ],
  "options": {"stop_on_error": true}
}
```

### Cookie management for authenticated sessions
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "set_cookies", "cookies": [{"name": "session", "value": "abc123"}]},
    {"action": "reload"},
    {"action": "get_cookies"}
  ]
}
```

### Multi-tab workflow
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "new_page"},
    {"action": "navigate", "url": "https://example.org"},
    {"action": "list_tabs"},
    {"action": "switch_tab", "index": 0},
    {"action": "screenshot", "path": "tab0.png"}
  ]
}
```

### Take a screenshot of a webpage
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "screenshot", "path": "example.png", "full_page": true}
  ]
}
```

### Fill and submit a form (slow, human-like)
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com/login"},
    {"action": "fill", "selector": "#username", "text": "testuser"},
    {"action": "fill", "selector": "#password", "text": "testpass"},
    {"action": "click", "selector": "button[type=submit]"},
    {"action": "wait", "selector": ".dashboard", "state": "visible"},
    {"action": "screenshot", "path": "after_login.png"}
  ],
  "options": {"slow_mo_ms": 1200, "type_delay_ms": 80}
}
```

### Extract text and attributes
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "get_text", "selector": "h1"},
    {"action": "get_attribute", "selector": "a.main-link", "attribute": "href"},
    {"action": "get_elements", "selector": "nav a", "max_count": 10}
  ]
}
```

### Use auto-translated Playwright selectors
```json
{
  "actions": [
    {"action": "navigate", "url": "https://example.com"},
    {"action": "click", "selector": "a:has-text(\"Contact\")"},
    {"action": "click", "selector": "button:has-text(\"Submit\")"},
    {"action": "get_text", "selector": "role=heading"}
  ]
}
```

## Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*playwright-runner/scripts/run_playwright.py' -print -quit | xargs -I{} dirname "{}" | xargs -I{} dirname "{}")
if [ ! -d "$SKILL_DIR/.venv" ]; then
    python3 -m venv "$SKILL_DIR/.venv"
    "$SKILL_DIR/.venv/bin/pip" install -q -r "$SKILL_DIR/requirements.txt"
fi
PY="$SKILL_DIR/.venv/bin/python"
RUNNER="$SKILL_DIR/scripts/run_playwright.py"
"$PY" "$RUNNER" < "${TMPDIR:-/tmp}/pw_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "run_playwright.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\run_playwright.ps1"
ConvertTo-Json @{actions=@(@{action="navigate";url="https://example.com"},@{action="screenshot";path="page.png"})} | Set-Content "$env:TEMP\pw_payload.json"
powershell -NoProfile -File $RUNNER < "$env:TEMP\pw_payload.json"
```
