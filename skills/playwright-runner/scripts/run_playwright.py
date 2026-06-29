#!/usr/bin/env python3
"""HuskyGate Undetected-Chromedriver Runner - Stealth browser automation for AI agents.

Accepts a JSON action list via stdin, executes browser actions sequentially,
and returns structured JSON results to stdout. Uses undetected-chromedriver
to bypass advanced bot detection (e.g., Cloudflare, DataDome).

Features:
  - Smart selector translation: auto-converts Playwright-style selectors
    (e.g., `a:has-text("Contact")`, `text="Submit"`) to Selenium-compatible
    XPath/CSS so AI agents don't need to know Selenium selector syntax.
  - High-level text-based actions: `click_by_text`, `get_page_structure`,
    `get_elements` for AI-friendly interaction without complex selectors.

Usage:
    echo '{"actions": [...], "options": {...}}' | python run_playwright.py
    python run_playwright.py < commands.json
    python run_playwright.py --check  (dependency check only)
"""

from __future__ import annotations

import base64
import json
import locale
import os
import platform
import re
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VERSION = "2.1.0-uc"
MAX_ACTIONS = 50
DEFAULT_TIMEOUT_MS = 30_000
GLOBAL_TIMEOUT_SEC = 600  # 10 minutes hard cap (increased for manual CAPTCHA solving)
DEFAULT_SLOW_MO_MS = 800  # Default pause between every action (human-like pacing)
DEFAULT_POST_NAVIGATE_WAIT_MS = 3_000  # Extra wait after navigate (CAPTCHA solving window)
DEFAULT_TYPE_DELAY_MS = 50  # Default per-character typing delay
ALLOWED_URL_SCHEMES = frozenset({"http", "https"})
MAX_SCREENSHOT_PATH_LEN = 255
SAFE_PATH_RE = re.compile(r"^[a-zA-Z0-9_./ -]+$")

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

class SecurityError(RunnerError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "SECURITY_ERROR")

class RunnerTimeoutError(RunnerError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "TIMEOUT_ERROR")

# ---------------------------------------------------------------------------
# XPath helpers
# ---------------------------------------------------------------------------

def _xpath_string(text: str) -> str:
    """Create a safely-escaped XPath string literal.

    Handles text containing single quotes, double quotes, or both.
    Returns a string ready for embedding in an XPath expression
    (e.g., '"hello"' or "'it\\'s'" or 'concat(...)').
    """
    if '"' not in text:
        return f'"{text}"'
    if "'" not in text:
        return f"'{text}'"
    # Contains both — use concat()
    parts: list[str] = []
    current = ""
    for ch in text:
        if ch == '"':
            if current:
                parts.append(f'"{current}"')
                current = ""
            parts.append("'\"'")
        else:
            current += ch
    if current:
        parts.append(f'"{current}"')
    return f"concat({','.join(parts)})"

# ---------------------------------------------------------------------------
# Smart Selector Translation (Playwright → Selenium)
# ---------------------------------------------------------------------------

# Pre-compiled patterns for Playwright-style selectors
_RE_TEXT_EXACT = re.compile(r'^text="(.+)"$')
_RE_TEXT_PARTIAL = re.compile(r'^text=(.+)$')
_RE_HAS_TEXT = re.compile(r'^([a-zA-Z0-9]*)(?:\.[a-zA-Z0-9_-]+)*:has-text\((["\'])(.+?)\2\)$')
_RE_TEXT_PSEUDO = re.compile(r'^([a-zA-Z0-9]*)(?:\.[a-zA-Z0-9_-]+)*:text\((["\'])(.+?)\2\)$')
_RE_TEXT_IS_PSEUDO = re.compile(r'^([a-zA-Z0-9]*)(?:\.[a-zA-Z0-9_-]+)*:text-is\((["\'])(.+?)\2\)$')
_RE_ROLE_WITH_NAME = re.compile(r'^role=(\w+)\[name=(["\'])(.+?)\2\]$')
_RE_ROLE_BARE = re.compile(r'^role=(\w+)$')
_RE_LABEL_TEXT = re.compile(r'^label=(["\']?)(.+?)\1$')


def translate_selector(raw_selector: str) -> tuple[str, str]:
    """Translate a selector string to a Selenium-compatible (By, value) tuple.

    Supports:
      Standard CSS:   #id, .class, tag[attr=val], etc.
      Standard XPath: /html/body/..., (//div)[1], etc.

      Explicit prefix:
        css=#my-id        → CSS
        xpath=//div       → XPath

      Playwright text selectors (auto-translated to XPath):
        text="exact"                 → exact text match
        text=partial                 → contains text match
        a:has-text("Contact")        → //a[contains(., 'Contact')]
        button:has-text("Submit")    → //button[contains(., 'Submit')]
        :has-text("anything")        → //*[contains(., 'anything')]
        span:text("partial")         → //span[contains(., 'partial')]
        a:text-is("exact")           → //a[normalize-space(.)='exact']
        role=button[name="Submit"]   → //*[@role='button'][...]
        role=link                    → //*[@role='link']
        label="Username"             → //input associated with label

    Returns (By.CSS_SELECTOR|By.XPATH, selector_string).
    """
    from selenium.webdriver.common.by import By

    sel = raw_selector.strip()

    # --- 1. Explicit prefix ---
    if sel.startswith("css="):
        return By.CSS_SELECTOR, sel[4:].strip()
    if sel.startswith("xpath="):
        return By.XPATH, sel[6:].strip()

    # --- 2. Playwright text="exact" ---
    m = _RE_TEXT_EXACT.match(sel)
    if m:
        text = m.group(1)
        _log_translate(sel, "text exact")
        return By.XPATH, f'//*[normalize-space(.)={_xpath_string(text)}]'

    # --- 3. Playwright text=partial ---
    m = _RE_TEXT_PARTIAL.match(sel)
    if m:
        text = m.group(1).strip()
        _log_translate(sel, "text partial")
        return By.XPATH, f'//*[contains(., {_xpath_string(text)})]'

    # --- 4. :has-text("...") with optional tag prefix ---
    m = _RE_HAS_TEXT.match(sel)
    if m:
        tag = m.group(1) or '*'
        text = m.group(3)
        _log_translate(sel, "has-text")
        return By.XPATH, f'//{tag}[contains(., {_xpath_string(text)})]'

    # --- 5. :text("...") pseudo ---
    m = _RE_TEXT_PSEUDO.match(sel)
    if m:
        tag = m.group(1) or '*'
        text = m.group(3)
        _log_translate(sel, "text pseudo")
        return By.XPATH, f'//{tag}[contains(., {_xpath_string(text)})]'

    # --- 6. :text-is("...") pseudo ---
    m = _RE_TEXT_IS_PSEUDO.match(sel)
    if m:
        tag = m.group(1) or '*'
        text = m.group(3)
        _log_translate(sel, "text-is pseudo")
        return By.XPATH, f'//{tag}[normalize-space(.)={_xpath_string(text)}]'

    # --- 7. role=button[name="..."] ---
    m = _RE_ROLE_WITH_NAME.match(sel)
    if m:
        role = m.group(1)
        name = m.group(3)
        _log_translate(sel, "role+name")
        xs = _xpath_string(name)
        return By.XPATH, (
            f'//*[@role="{role}"]'
            f'[normalize-space(.)={xs} or @aria-label={xs} or @title={xs}]'
        )

    # --- 8. role=button (bare) ---
    m = _RE_ROLE_BARE.match(sel)
    if m:
        role = m.group(1)
        _log_translate(sel, "role bare")
        return By.XPATH, f'//*[@role="{role}"]'

    # --- 9. label="..." → find input by associated label text ---
    m = _RE_LABEL_TEXT.match(sel)
    if m:
        label_text = m.group(2)
        _log_translate(sel, "label")
        xs = _xpath_string(label_text)
        return By.XPATH, (
            f'//input[@id=//label[normalize-space(.)={xs}]/@for]'
            f' | //label[normalize-space(.)={xs}]//input'
            f' | //label[normalize-space(.)={xs}]//textarea'
            f' | //label[normalize-space(.)={xs}]//select'
        )

    # --- 10. Standard XPath (starts with / or () ---
    if sel.startswith("/") or sel.startswith("("):
        return By.XPATH, sel

    # --- 11. Standard CSS (default) ---
    return By.CSS_SELECTOR, sel


def _log_translate(original: str, pattern: str) -> None:
    """Log selector translation to stderr for debugging."""
    sys.stderr.write(f"[selector-translate] {pattern}: {original!r}\n")
    sys.stderr.flush()

# ---------------------------------------------------------------------------
# Validators & Helpers
# ---------------------------------------------------------------------------

def validate_selector(selector: str) -> str:
    if not isinstance(selector, str) or not selector.strip():
        raise ValidationError("Selector must be a non-empty string")
    sel = selector.strip()
    if len(sel) > 500:
        raise ValidationError("Selector too long (max 500 characters)")
    return sel

def validate_screenshot_path(path_str: str, workdir: str) -> str:
    if not isinstance(path_str, str) or not path_str.strip():
        raise ValidationError("Screenshot path must be a non-empty string")
    path_str = path_str.strip()
    if len(path_str) > MAX_SCREENSHOT_PATH_LEN:
        raise ValidationError(f"Screenshot path too long (max {MAX_SCREENSHOT_PATH_LEN} chars)")

    resolved = Path(workdir).resolve() / path_str
    resolved = resolved.resolve()
    workdir_resolved = Path(workdir).resolve()
    try:
        resolved.relative_to(workdir_resolved)
    except ValueError:
        raise SecurityError(f"Screenshot path escapes workdir: {resolved} is outside {workdir_resolved}")

    resolved.parent.mkdir(parents=True, exist_ok=True)
    return str(resolved)

def validate_text(text: str) -> str:
    if not isinstance(text, str):
        raise ValidationError("Text must be a string")
    if len(text) > 10_000:
        raise ValidationError("Text too long (max 10,000 characters)")
    return text

def detect_system_lang() -> str:
    """Detect system language for Chrome --lang flag. Falls back to en-US."""
    try:
        lang = os.environ.get("LANG", "") or os.environ.get("LANGUAGE", "")
        if lang:
            code = lang.split(".")[0].replace("_", "-")
            if code:
                return code
        sys_locale = locale.getlocale()[0]
        if sys_locale:
            return sys_locale.replace("_", "-")
    except Exception:
        pass
    return "en-US"

def detect_chrome_version() -> int | None:
    """Detect installed Chrome major version by running the binary with --version.

    Returns the major version number (e.g. 137) or None if detection fails.
    Used to pass version_main to undetected-chromedriver so the correct
    ChromeDriver is downloaded to match the locally installed Chrome.
    """
    candidates: list[str] = []
    system = platform.system()
    if system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    elif system == "Linux":
        candidates = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ]
    elif system == "Windows":
        prog = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        prog86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")
        candidates = [
            os.path.join(prog, "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(prog86, "Google", "Chrome", "Application", "chrome.exe"),
        ]

    for binary in candidates:
        try:
            out = subprocess.check_output(
                [binary, "--version"],
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).decode().strip()
            # Output: "Google Chrome 137.0.6835.0" or "Chromium 137.0.6835.0"
            match = re.search(r"(?:Chrome|Chromium)\s+(\d+)\.", out)
            if match:
                return int(match.group(1))
        except Exception:
            continue
    return None

def _fix_uc_platform_for_arm64() -> None:
    """Fix undetected-chromedriver platform detection on Apple Silicon (ARM64) Macs.

    UC 3.5.5 hardcodes 'mac-x64' for all macOS regardless of CPU architecture.
    This causes it to download x86_64 chromedriver on ARM64 systems, leading to
    SIGABRT crashes when Chrome is launched.

    This function monkey-patches UC's Patcher to use 'mac-arm64' on ARM64 Macs,
    deletes any stale x86_64 cached binary, and removes macOS quarantine attributes
    from the chromedriver binary after download.
    """
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return

    try:
        import undetected_chromedriver.patcher as patcher
    except ImportError:
        return

    # --- 1. Monkey-patch _set_platform_name to detect ARM64 ---
    _original_set_platform_name = patcher.Patcher._set_platform_name

    def _patched_set_platform_name(self: Any) -> None:
        _original_set_platform_name(self)
        # Override only on macOS ARM64 (and only for new-style chromedriver >= 115)
        if self.platform.endswith("darwin") and not self.is_old_chromedriver:
            self.platform_name = "mac-arm64"

    patcher.Patcher._set_platform_name = _patched_set_platform_name

    # --- 2. Delete stale x86_64 cached chromedriver so UC re-downloads ARM64 ---
    p = patcher.Patcher()
    cached = p.executable_path
    if os.path.isfile(cached):
        try:
            out = subprocess.check_output(
                ["file", cached], stderr=subprocess.DEVNULL, timeout=5,
            ).decode()
            if "x86_64" in out and "arm64" not in out:
                os.remove(cached)
                _log("Removed stale x86_64 chromedriver cache: " + cached)
        except Exception:
            pass

    # --- 3. Wrap patch_exe to clear Gatekeeper attrs AFTER binary patching ---
    #
    # UC's flow: fetch → unzip → patch_exe (modifies binary bytes).
    # patch_exe invalidates any prior code signature, so we must re-sign AFTER it.
    # macOS Gatekeeper blocks unsigned/quarantined downloaded binaries (status -9).

    def _clear_gatekeeper_attrs(exe_path: str) -> None:
        """Remove macOS Gatekeeper attributes and ad-hoc codesign the binary."""
        if not exe_path or not os.path.isfile(exe_path):
            return
        for attr in ("com.apple.quarantine", "com.apple.provenance"):
            try:
                subprocess.run(
                    ["xattr", "-d", attr, exe_path],
                    stderr=subprocess.DEVNULL, timeout=5,
                )
            except Exception:
                pass
        # Ad-hoc codesign so Gatekeeper treats it as locally-signed
        try:
            subprocess.run(
                ["codesign", "--force", "--deep", "--sign", "-", exe_path],
                stderr=subprocess.DEVNULL, timeout=10,
            )
        except Exception:
            pass

    _original_patch_exe = patcher.Patcher.patch_exe

    def _patched_patch_exe(self: Any) -> None:
        _original_patch_exe(self)
        _clear_gatekeeper_attrs(self.executable_path)

    patcher.Patcher.patch_exe = _patched_patch_exe

    # Also fix any already-cached + already-patched binary (skips patch_exe)
    p2 = patcher.Patcher()
    if os.path.isfile(p2.executable_path):
        _clear_gatekeeper_attrs(p2.executable_path)


def check_dependencies() -> dict[str, Any]:
    result: dict[str, Any] = {
        "python_version": sys.version,
        "python_arch": platform.machine(),
        "os_platform": platform.platform(),
        "uc_installed": False,
        "selenium_installed": False,
        "uc_version": None,
        "selenium_version": None,
        "errors": [],
    }
    try:
        import undetected_chromedriver as uc_mod
        result["uc_installed"] = True
        result["uc_version"] = getattr(uc_mod, "__version__", "unknown")
    except ImportError:
        result["errors"].append("undetected-chromedriver not installed. Run: pip install undetected-chromedriver")

    try:
        import selenium as sel_mod
        result["selenium_installed"] = True
        result["selenium_version"] = getattr(sel_mod, "__version__", "unknown")
    except ImportError:
        result["errors"].append("selenium not installed. Run: pip install selenium")

    chrome_version = detect_chrome_version()
    result["chrome_version_main"] = chrome_version
    if chrome_version is None:
        result.setdefault("warnings", []).append(
            "Could not auto-detect Chrome version. "
            "undetected-chromedriver will attempt to find Chrome automatically."
        )

    result["success"] = len(result["errors"]) == 0
    return result

# ---------------------------------------------------------------------------
# JavaScript snippets for advanced actions
# ---------------------------------------------------------------------------

JS_FIND_BY_TEXT = """
return (function(searchText, tagFilter, exact) {
    function getDepth(el) {
        var d = 0; while (el.parentElement) { d++; el = el.parentElement; } return d;
    }
    function isVisible(el) {
        if (!el.offsetParent && el.tagName !== 'HTML' && el.tagName !== 'BODY') return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    var candidates = [];
    var all = document.querySelectorAll(tagFilter === '*' ? '*' : tagFilter);
    for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (!isVisible(el)) continue;
        var t = (el.textContent || '').trim();
        var matched = exact ? (t === searchText) : (t.indexOf(searchText) !== -1);
        if (matched) {
            candidates.push({el: el, len: t.length, depth: getDepth(el)});
        }
    }

    if (candidates.length === 0) return null;

    // Prefer shortest text content (most specific element), then deepest in DOM
    candidates.sort(function(a, b) {
        return (a.len - b.len) || (b.depth - a.depth);
    });

    var uid = 'uc-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    candidates[0].el.setAttribute('data-uc-find', uid);
    return uid;
})(arguments[0], arguments[1], arguments[2]);
"""

JS_GET_PAGE_STRUCTURE = """
return (function() {
    var MAX_ITEMS = 50;
    var result = {headings: [], links: [], buttons: [], inputs: [], selects: [], meta: {}};

    // Page meta
    result.meta.title = document.title || '';
    result.meta.url = location.href;

    // Headings (for page orientation)
    var headings = document.querySelectorAll('h1, h2, h3');
    for (var hi = 0; hi < headings.length && hi < 15; hi++) {
        var h = headings[hi];
        var ht = (h.textContent || '').trim().substring(0, 120);
        if (ht) result.headings.push({level: h.tagName.toLowerCase(), text: ht});
    }

    // Links
    var links = document.querySelectorAll('a[href]');
    for (var li = 0; li < links.length && result.links.length < MAX_ITEMS; li++) {
        var a = links[li];
        var style = window.getComputedStyle(a);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        var rect = a.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        var lt = (a.textContent || '').trim().substring(0, 100);
        var img = a.querySelector('img');
        if (!lt && img) lt = '[img:' + (img.alt || img.src.split('/').pop() || '').substring(0, 50) + ']';
        if (!lt) continue;
        var lsel = a.id ? '#' + a.id : null;
        result.links.push({text: lt, href: a.href, selector: lsel});
    }

    // Buttons
    var btns = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
    for (var bi = 0; bi < btns.length && result.buttons.length < 30; bi++) {
        var b = btns[bi];
        var bs = window.getComputedStyle(b);
        if (bs.display === 'none' || bs.visibility === 'hidden') continue;
        var bt = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim().substring(0, 100);
        if (!bt) continue;
        var bsel = b.id ? '#' + b.id : null;
        result.buttons.push({text: bt, type: b.type || b.getAttribute('role') || null, selector: bsel});
    }

    // Inputs
    var inputs = document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea'
    );
    for (var ii = 0; ii < inputs.length && result.inputs.length < 30; ii++) {
        var inp = inputs[ii];
        var label = '';
        if (inp.id) {
            var lbl = document.querySelector('label[for="' + CSS.escape(inp.id) + '"]');
            if (lbl) label = (lbl.textContent || '').trim().substring(0, 80);
        }
        if (!label) {
            var closest = inp.closest('label');
            if (closest) label = (closest.textContent || '').trim().substring(0, 80);
        }
        var isel = inp.id ? '#' + inp.id : (inp.name ? '[name="' + inp.name + '"]' : null);
        result.inputs.push({
            tag: inp.tagName.toLowerCase(),
            type: inp.type || 'text',
            name: inp.name || null,
            placeholder: inp.placeholder || null,
            label: label || null,
            selector: isel,
            value: inp.value ? inp.value.substring(0, 50) : null
        });
    }

    // Selects
    var sels = document.querySelectorAll('select');
    for (var si = 0; si < sels.length && result.selects.length < 20; si++) {
        var sel = sels[si];
        var slabel = '';
        if (sel.id) {
            var slbl = document.querySelector('label[for="' + CSS.escape(sel.id) + '"]');
            if (slbl) slabel = (slbl.textContent || '').trim().substring(0, 80);
        }
        var opts = [];
        var optEls = sel.querySelectorAll('option');
        for (var oi = 0; oi < optEls.length && oi < 20; oi++) {
            opts.push({value: optEls[oi].value, text: (optEls[oi].textContent || '').trim().substring(0, 60)});
        }
        var ssel = sel.id ? '#' + sel.id : (sel.name ? 'select[name="' + sel.name + '"]' : null);
        result.selects.push({
            label: slabel || null,
            name: sel.name || null,
            options: opts,
            selector: ssel
        });
    }

    return result;
})();
"""

# ---------------------------------------------------------------------------
# Action executor
# ---------------------------------------------------------------------------

class UCRunner:
    """Stateful browser automation runner using undetected-chromedriver."""

    def __init__(self, options: dict[str, Any]) -> None:
        self.options = options
        self.headless = options.get("headless", False)
        self.default_timeout = options.get("timeout_ms", DEFAULT_TIMEOUT_MS)
        self.allow_js_eval = options.get("allow_js_eval", False)
        self.allow_loopback = options.get("allow_loopback", False)
        self.workdir = options.get("workdir", os.getcwd())
        self.lang = options.get("lang", detect_system_lang())

        self.slow_mo_ms = max(0, int(options.get("slow_mo_ms", DEFAULT_SLOW_MO_MS)))
        self.post_navigate_wait_ms = max(0, int(options.get("post_navigate_wait_ms", DEFAULT_POST_NAVIGATE_WAIT_MS)))
        self.type_delay_ms = max(0, min(int(options.get("type_delay_ms", DEFAULT_TYPE_DELAY_MS)), 500))
        self.stop_on_error = bool(options.get("stop_on_error", False))
        self.user_agent = options.get("user_agent")
        self.proxy = options.get("proxy")

        self.driver = None

    def _ensure_browser(self) -> None:
        if self.driver is not None:
            return

        # Fix UC's broken ARM64 detection on Apple Silicon Macs (must run before import)
        _fix_uc_platform_for_arm64()

        import undetected_chromedriver as uc

        detected_version = detect_chrome_version()

        def _build_options(*, force_headless: bool = False) -> uc.ChromeOptions:
            opts = uc.ChromeOptions()
            if self.headless or force_headless:
                opts.add_argument('--headless=new')
            opts.add_argument(f'--lang={self.lang}')
            opts.add_argument('--disable-blink-features=AutomationControlled')
            opts.add_argument('--log-level=3')
            if self.user_agent:
                opts.add_argument(f'--user-agent={self.user_agent}')
            if self.proxy:
                opts.add_argument(f'--proxy-server={self.proxy}')
            return opts

        def _launch(opts: uc.ChromeOptions) -> uc.Chrome:
            kw: dict[str, Any] = {"options": opts}
            if detected_version is not None:
                kw["version_main"] = detected_version
            return uc.Chrome(**kw)

        def _configure(driver: uc.Chrome) -> None:
            timeout_sec = self.default_timeout / 1000.0
            driver.set_page_load_timeout(timeout_sec)
            driver.set_script_timeout(timeout_sec)
            viewport = self.options.get("viewport", {"width": 1280, "height": 720})
            driver.set_window_size(viewport["width"], viewport["height"])

        try:
            self.driver = _launch(_build_options())
            _configure(self.driver)
        except Exception as first_err:
            # Chrome may crash with SIGABRT when there is no GUI session
            # (e.g., TransformProcessType fails in HIServices).  Retry with
            # --headless=new so Chrome skips window-server registration.
            if self.headless:
                raise RunnerError(
                    f"Failed to launch undetected-chromedriver: {first_err}"
                )
            _log(
                "Chrome crashed on launch (likely no GUI session). "
                "Retrying with --headless=new …"
            )
            try:
                self.driver = _launch(_build_options(force_headless=True))
                _configure(self.driver)
                self.headless = True
                _log("Headless fallback succeeded.")
            except Exception as second_err:
                raise RunnerError(
                    f"Failed to launch undetected-chromedriver "
                    f"(headless fallback also failed): {second_err}"
                )

    def _validate_url_with_loopback(self, url: str) -> str:
        if not isinstance(url, str) or not url.strip():
            raise ValidationError("URL must be a non-empty string")
        url = url.strip()
        parsed = urlparse(url)
        if parsed.scheme not in ALLOWED_URL_SCHEMES:
            raise SecurityError(f"URL scheme '{parsed.scheme}' not allowed.")
        host = parsed.hostname or ""
        if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            if not self.allow_loopback:
                raise SecurityError("Navigation to loopback address is blocked.")
        return url

    def _resolve_selector(self, action: dict[str, Any]) -> tuple[str, str]:
        """Validate and translate a selector from an action dict."""
        selector = validate_selector(action.get("selector", ""))
        return translate_selector(selector)

    def close(self) -> dict[str, Any]:
        closed = False
        if self.driver is not None:
            try:
                self.driver.quit()
                closed = True
            except Exception:
                pass
            self.driver = None
        return {"closed": closed}

    def execute_action(self, action: dict[str, Any]) -> dict[str, Any]:
        action_type = action.get("action")
        if not isinstance(action_type, str):
            raise ValidationError("Each action must have an 'action' field (string)")

        timeout = action.get("timeout_ms", self.default_timeout)
        handler = getattr(self, f"_action_{action_type}", None)
        if handler is None:
            raise ValidationError(
                f"Unknown action: '{action_type}'. "
                f"Available: launch, navigate, click, click_by_text, type, fill, "
                f"get_text, get_attribute, get_elements, get_page_structure, "
                f"hover, select, scroll, press_key, wait, wait_for_user, "
                f"screenshot, pdf, evaluate, go_back, go_forward, reload, "
                f"new_page, get_url, get_title, close, check, "
                f"get_cookies, set_cookies, clear_cookies, "
                f"list_tabs, switch_tab, assert"
            )

        from selenium.common.exceptions import (
            WebDriverException,
            TimeoutException,
            InvalidSelectorException,
            NoSuchElementException,
        )
        t0 = time.monotonic()
        try:
            result = handler(action, timeout)
            result["action"] = action_type
            result["duration_ms"] = round((time.monotonic() - t0) * 1000)
            return result
        except InvalidSelectorException as e:
            original = action.get("selector", "")
            raise RunnerError(
                f"Invalid selector: {original!r}. "
                f"Use standard CSS (#id, .class, tag[attr]), XPath (//tag), "
                f"or text-based actions (click_by_text, get_page_structure). "
                f"Playwright pseudo-selectors like :has-text() are auto-translated — "
                f"if this still fails, the selector syntax may be malformed. "
                f"Original error: {e}",
                "INVALID_SELECTOR",
            )
        except NoSuchElementException as e:
            raise RunnerError(
                f"Element not found: {action.get('selector', '')!r}. "
                f"Use get_page_structure to discover available elements. "
                f"Original error: {e}",
                "ELEMENT_NOT_FOUND",
            )
        except TimeoutException as e:
            raise RunnerTimeoutError(f"Action timed out: {e}")
        except WebDriverException as e:
            raise RunnerError(f"Browser error: {e}")

    # -----------------------------------------------------------------------
    # Helpers for text-based element finding
    # -----------------------------------------------------------------------

    def _find_element_by_text_js(
        self, text: str, tag: str, exact: bool, timeout_ms: int
    ) -> str:
        """Use JS to find the most specific visible element by text content.

        Marks the found element with a unique data attribute and returns the uid.
        Polls until found or timeout.
        """
        deadline = time.monotonic() + timeout_ms / 1000.0
        while time.monotonic() < deadline:
            try:
                uid = self.driver.execute_script(JS_FIND_BY_TEXT, text, tag, exact)
                if uid:
                    return uid
            except Exception:
                pass
            time.sleep(0.5)

        raise RunnerTimeoutError(
            f"No element found with text {text!r} (tag={tag}, exact={exact}). "
            f"Tip: use get_page_structure to discover available elements."
        )

    def _cleanup_find_marker(self, uid: str) -> None:
        """Remove the temporary data-uc-find attribute after locating an element."""
        try:
            self.driver.execute_script(
                f'var el = document.querySelector("[data-uc-find=\\"{uid}\\"]"); '
                f'if (el) el.removeAttribute("data-uc-find");'
            )
        except Exception:
            pass

    # -----------------------------------------------------------------------
    # Action handlers — Core
    # -----------------------------------------------------------------------

    def _action_launch(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        return {"success": True, "message": "Browser launched"}

    def _action_navigate(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        url = self._validate_url_with_loopback(action.get("url", ""))
        self._ensure_browser()

        wait_until = action.get("wait_until", "load")
        self.driver.get(url)

        if wait_until == "networkidle":
            self._wait_for_network_idle(timeout)

        post_wait = action.get("post_wait_ms", self.post_navigate_wait_ms)
        post_wait = max(0, min(int(post_wait), 60_000))
        if post_wait > 0:
            time.sleep(post_wait / 1000.0)

        return {"success": True, "url": self.driver.current_url, "title": self.driver.title}

    def _wait_for_network_idle(self, timeout_ms: int, idle_time: float = 0.5) -> None:
        deadline = time.monotonic() + timeout_ms / 1000.0
        while time.monotonic() < deadline:
            try:
                ready = self.driver.execute_script("return document.readyState")
                if ready == "complete":
                    time.sleep(idle_time)
                    return
            except Exception:
                time.sleep(0.2)
                continue
            time.sleep(0.1)

    def _action_screenshot(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        raw_path = action.get("path", "screenshot.png")
        resolved_path = validate_screenshot_path(raw_path, self.workdir)
        full_page = action.get("full_page", False)

        if full_page:
            self._full_page_screenshot(resolved_path)
        else:
            self.driver.save_screenshot(resolved_path)

        file_size = Path(resolved_path).stat().st_size
        return {"success": True, "path": resolved_path, "size_bytes": file_size, "full_page": full_page}

    def _full_page_screenshot(self, path: str) -> None:
        metrics = self.driver.execute_script(
            "return {"
            "  width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),"
            "  height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)"
            "}"
        )
        original_size = self.driver.get_window_size()
        try:
            self.driver.set_window_size(
                max(metrics["width"], original_size["width"]),
                metrics["height"],
            )
            time.sleep(0.3)
            self.driver.save_screenshot(path)
        finally:
            self.driver.set_window_size(original_size["width"], original_size["height"])

    def _scroll_into_view(self, element: Any) -> None:
        """Scroll element into view to prevent 'element not interactable' errors."""
        try:
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block:'center',inline:'nearest'})", element
            )
            time.sleep(0.15)
        except Exception:
            pass

    def _action_click(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        by, sel = translate_selector(selector)
        button = action.get("button", "left")

        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.element_to_be_clickable((by, sel))
        )
        self._scroll_into_view(el)

        if button == "right":
            from selenium.webdriver.common.action_chains import ActionChains
            ActionChains(self.driver).context_click(el).perform()
        elif button == "middle":
            from selenium.webdriver.common.action_chains import ActionChains
            from selenium.webdriver.common.actions.mouse_button import MouseButton
            ActionChains(self.driver).click(el, button=MouseButton.MIDDLE).perform()
        else:
            click_count = max(1, min(action.get("click_count", 1), 3))
            if click_count == 2:
                from selenium.webdriver.common.action_chains import ActionChains
                ActionChains(self.driver).double_click(el).perform()
            else:
                for _ in range(click_count):
                    el.click()
                    time.sleep(0.15)

        time.sleep(0.3)
        return {"success": True, "selector": selector, "button": button}

    def _action_hover(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.common.action_chains import ActionChains

        selector = validate_selector(action.get("selector", ""))
        by, sel = translate_selector(selector)

        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.visibility_of_element_located((by, sel))
        )
        ActionChains(self.driver).move_to_element(el).perform()
        time.sleep(0.2)
        return {"success": True, "selector": selector}

    def _action_type(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        text = validate_text(action.get("text", ""))
        clear = action.get("clear", False)
        delay_ms = action.get("delay_ms", self.type_delay_ms)
        by, sel = translate_selector(selector)

        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.presence_of_element_located((by, sel))
        )
        if clear:
            el.clear()

        if delay_ms > 0:
            delay_sec = min(delay_ms, 500) / 1000.0
            for ch in text:
                el.send_keys(ch)
                time.sleep(delay_sec)
        else:
            el.send_keys(text)

        return {"success": True, "selector": selector, "characters": len(text)}

    def _action_fill(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Fill a form field (clears existing content first). Playwright-compatible alias."""
        action_copy = dict(action)
        action_copy["clear"] = True
        result = self._action_type(action_copy, timeout)
        result["action"] = "fill"
        return result

    def _action_get_text(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        by, sel = translate_selector(selector)

        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.presence_of_element_located((by, sel))
        )
        text = el.text

        max_len = min(action.get("max_length", 5000), 50_000)
        truncated = False
        if text and len(text) > max_len:
            text = text[:max_len]
            truncated = True

        return {"success": True, "selector": selector, "text": text, "truncated": truncated}

    def _action_evaluate(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        if not self.allow_js_eval:
            raise SecurityError("JavaScript evaluation is disabled.")

        self._ensure_browser()
        expression = action.get("expression", "")
        if not isinstance(expression, str) or not expression.strip():
            raise ValidationError("expression must be a non-empty string")

        if not expression.strip().startswith("return "):
            expression = f"return {expression}"

        result = self.driver.execute_script(expression)
        try:
            json.dumps(result)
        except (TypeError, ValueError):
            result = str(result)

        return {"success": True, "result": result}

    def _action_wait(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        selector = action.get("selector")
        duration_ms = action.get("duration_ms")

        if selector:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC

            selector = validate_selector(selector)
            by, sel = translate_selector(selector)
            state = action.get("state", "visible")
            wait = WebDriverWait(self.driver, timeout / 1000.0)

            if state in ("visible", "attached"):
                wait.until(EC.visibility_of_element_located((by, sel)))
            elif state in ("hidden", "detached"):
                wait.until(EC.invisibility_of_element_located((by, sel)))
            else:
                raise ValidationError("state must be: attached, detached, visible, hidden")

            return {"success": True, "waited_for": selector, "state": state}

        if duration_ms is not None:
            clamped_ms = max(0, min(int(duration_ms), 30_000))
            time.sleep(clamped_ms / 1000.0)
            return {"success": True, "waited_ms": clamped_ms}

        raise ValidationError("wait action requires 'selector' or 'duration_ms'")

    def _action_select(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        from selenium.webdriver.support.ui import Select, WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        value = action.get("value")
        label = action.get("label")
        by, sel = translate_selector(selector)

        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.presence_of_element_located((by, sel))
        )
        select = Select(el)

        if value is not None:
            select.select_by_value(str(value))
        elif label is not None:
            select.select_by_visible_text(str(label))
        else:
            raise ValidationError("select action requires 'value' or 'label'")

        return {"success": True, "selector": selector}

    def _action_scroll(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        direction = action.get("direction", "down")
        amount = min(abs(action.get("amount", 300)), 10_000)

        x, y = 0, 0
        if direction == "down":
            y = amount
        elif direction == "up":
            y = -amount
        elif direction == "right":
            x = amount
        elif direction == "left":
            x = -amount
        else:
            raise ValidationError("direction must be: up, down, left, right")

        self.driver.execute_script(f"window.scrollBy({x}, {y})")
        time.sleep(0.3)
        return {"success": True, "direction": direction, "amount": amount}

    def _action_go_back(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        self.driver.back()
        return {"success": True, "url": self.driver.current_url}

    def _action_go_forward(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        self.driver.forward()
        return {"success": True, "url": self.driver.current_url}

    def _action_reload(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        self.driver.refresh()
        return {"success": True, "url": self.driver.current_url, "title": self.driver.title}

    def _action_new_page(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        self.driver.switch_to.new_window('tab')
        return {"success": True, "message": "New tab created"}

    def _action_get_url(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        return {"success": True, "url": self.driver.current_url}

    def _action_get_title(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        return {"success": True, "title": self.driver.title}

    def _action_pdf(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        if not self.headless:
            raise RunnerError(
                "PDF export requires headless mode. Set options.headless = true.",
                "VALIDATION_ERROR",
            )
        self._ensure_browser()
        raw_path = action.get("path", "page.pdf")
        resolved_path = validate_screenshot_path(raw_path, self.workdir)

        pdf_base64 = self.driver.print_page()
        with open(resolved_path, "wb") as f:
            f.write(base64.b64decode(pdf_base64))

        file_size = Path(resolved_path).stat().st_size
        return {"success": True, "path": resolved_path, "size_bytes": file_size}

    def _action_close(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        result = self.close()
        result["success"] = True
        return result

    def _action_check(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        return check_dependencies()

    def _action_wait_for_user(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        self._ensure_browser()
        prompt_msg = action.get("message", "Solve CAPTCHA in the browser window, then press Enter to continue...")
        sys.stderr.write(f"\n⏸  {prompt_msg}\n")
        sys.stderr.flush()

        try:
            tty = open("/dev/tty", "r")
            try:
                tty.readline()
            finally:
                tty.close()
        except OSError:
            fallback_ms = min(action.get("fallback_wait_ms", 30_000), 120_000)
            sys.stderr.write(f"   (no TTY available — waiting {fallback_ms}ms instead)\n")
            sys.stderr.flush()
            time.sleep(fallback_ms / 1000.0)
            return {"success": True, "waited_ms": fallback_ms, "method": "fallback_timer"}

        return {"success": True, "method": "user_confirmed"}

    # -----------------------------------------------------------------------
    # Action handlers — New high-level actions
    # -----------------------------------------------------------------------

    def _action_click_by_text(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Click an element by its visible text content.

        The most robust way for AI agents to interact with elements — no CSS or
        XPath knowledge needed. Uses JS to find the most specific visible element
        whose text content matches, then clicks it via Selenium.

        Fields:
          text  (required): Text to search for in element content.
          tag   (optional): HTML tag filter (e.g., "a", "button"). Default: any.
          exact (optional): If true, require exact text match. Default: false (contains).
        """
        self._ensure_browser()
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        text = action.get("text", "")
        if not text:
            raise ValidationError("text field is required for click_by_text")
        text = validate_text(text)
        tag = action.get("tag", "*")
        exact = action.get("exact", False)

        uid = self._find_element_by_text_js(text, tag, exact, timeout)

        el = WebDriverWait(self.driver, 5).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, f'[data-uc-find="{uid}"]'))
        )
        self._scroll_into_view(el)
        el.click()
        self._cleanup_find_marker(uid)

        time.sleep(0.3)
        return {"success": True, "text": text, "tag": tag, "exact": exact}

    def _action_get_page_structure(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Analyze the current page and return a structured summary of interactive elements.

        Returns headings (h1-h3), links, buttons, form inputs, and select elements
        with their text content, labels, and suggested selectors. Use this to
        discover what's on the page before trying to click or type.
        """
        self._ensure_browser()

        # Wait for DOM to be reasonably stable
        time.sleep(0.5)

        try:
            structure = self.driver.execute_script(JS_GET_PAGE_STRUCTURE)
        except Exception as e:
            raise RunnerError(f"Failed to analyze page structure: {e}")

        # Truncate the structure to avoid oversized output
        total_elements = (
            len(structure.get("links", []))
            + len(structure.get("buttons", []))
            + len(structure.get("inputs", []))
            + len(structure.get("selects", []))
        )

        return {
            "success": True,
            "structure": structure,
            "total_interactive_elements": total_elements,
        }

    def _action_get_elements(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Find elements matching a selector and return their properties.

        More flexible than get_text — returns multiple elements with tags,
        text content, visibility, and selected attributes.

        Fields:
          selector   (required): CSS, XPath, or Playwright-style selector.
          max_count  (optional): Max elements to return (default: 20, max: 100).
          attributes (optional): List of attribute names to include.
        """
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        by, sel = translate_selector(selector)
        max_count = min(action.get("max_count", 20), 100)
        include_attrs = action.get("attributes", [
            "href", "src", "alt", "title", "name", "type",
            "placeholder", "value", "aria-label", "role", "class", "id",
        ])

        # Wait briefly for at least one element to appear
        try:
            WebDriverWait(self.driver, min(timeout / 1000.0, 5)).until(
                EC.presence_of_element_located((by, sel))
            )
        except Exception:
            pass  # Proceed anyway — may find 0 elements

        elements = self.driver.find_elements(by, sel)
        items: list[dict[str, Any]] = []
        for el in elements[:max_count]:
            info: dict[str, Any] = {
                "tag": el.tag_name,
                "text": (el.text or "").strip()[:200],
                "visible": el.is_displayed(),
            }
            for attr in include_attrs:
                val = el.get_attribute(attr)
                if val is not None and val != "":
                    info[attr] = str(val)[:200]
            items.append(info)

        return {
            "success": True,
            "selector": selector,
            "count": len(items),
            "total_found": len(elements),
            "elements": items,
        }

    def _action_get_attribute(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Read one or more attributes from an element.

        Fields:
          selector  (required): Element selector.
          attribute (required): Attribute name (e.g., "href", "src", "data-id") or
                                list of attribute names.
        """
        self._ensure_browser()
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC

        selector = validate_selector(action.get("selector", ""))
        attribute = action.get("attribute")
        if not attribute:
            raise ValidationError("attribute field is required for get_attribute")

        by, sel = translate_selector(selector)
        el = WebDriverWait(self.driver, timeout / 1000.0).until(
            EC.presence_of_element_located((by, sel))
        )

        if isinstance(attribute, list):
            values = {}
            for attr in attribute:
                values[attr] = el.get_attribute(attr)
            return {"success": True, "selector": selector, "attributes": values}
        else:
            value = el.get_attribute(str(attribute))
            return {"success": True, "selector": selector, "attribute": str(attribute), "value": value}

    def _action_press_key(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Send keyboard key presses (Enter, Tab, Escape, Ctrl+A, etc.).

        Fields:
          key      (required): Key name. Supports: Enter, Tab, Escape, Backspace,
                               Delete, ArrowUp/Down/Left/Right, Home, End, PageUp,
                               PageDown, Space, F1-F12, or single characters.
                               Modifiers via "+": "Control+a", "Shift+Tab", "Meta+c".
          selector (optional): Element to send keys to. If omitted, sends to active element.
        """
        self._ensure_browser()
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.common.action_chains import ActionChains

        key_name = action.get("key", "")
        if not key_name:
            raise ValidationError("key field is required for press_key")

        selector = action.get("selector")

        KEY_MAP: dict[str, str] = {
            "Enter": Keys.ENTER, "Return": Keys.RETURN,
            "Tab": Keys.TAB, "Escape": Keys.ESCAPE, "Esc": Keys.ESCAPE,
            "Backspace": Keys.BACKSPACE, "Delete": Keys.DELETE,
            "ArrowUp": Keys.ARROW_UP, "ArrowDown": Keys.ARROW_DOWN,
            "ArrowLeft": Keys.ARROW_LEFT, "ArrowRight": Keys.ARROW_RIGHT,
            "Home": Keys.HOME, "End": Keys.END,
            "PageUp": Keys.PAGE_UP, "PageDown": Keys.PAGE_DOWN,
            "Space": Keys.SPACE,
            "F1": Keys.F1, "F2": Keys.F2, "F3": Keys.F3, "F4": Keys.F4,
            "F5": Keys.F5, "F6": Keys.F6, "F7": Keys.F7, "F8": Keys.F8,
            "F9": Keys.F9, "F10": Keys.F10, "F11": Keys.F11, "F12": Keys.F12,
        }
        MODIFIER_MAP: dict[str, str] = {
            "Control": Keys.CONTROL, "Ctrl": Keys.CONTROL,
            "Alt": Keys.ALT, "Shift": Keys.SHIFT,
            "Meta": Keys.META, "Command": Keys.COMMAND, "Cmd": Keys.COMMAND,
        }

        # Parse modifiers: "Control+a", "Shift+Tab", etc.
        parts = [p.strip() for p in key_name.split("+")]
        modifiers: list[str] = []
        actual_key: str | None = None

        for i, part in enumerate(parts):
            if part in MODIFIER_MAP and i < len(parts) - 1:
                modifiers.append(MODIFIER_MAP[part])
            elif part in KEY_MAP:
                actual_key = KEY_MAP[part]
            elif len(part) == 1:
                actual_key = part
            else:
                raise ValidationError(
                    f"Unknown key: '{part}'. "
                    f"Supported: {', '.join(sorted(set(KEY_MAP.keys()) | set(MODIFIER_MAP.keys())))}"
                )

        if actual_key is None:
            raise ValidationError("No target key specified")

        # Resolve target element (optional)
        target = None
        if selector:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            selector = validate_selector(selector)
            by, sel = translate_selector(selector)
            target = WebDriverWait(self.driver, timeout / 1000.0).until(
                EC.presence_of_element_located((by, sel))
            )

        # Execute key combo
        chain = ActionChains(self.driver)
        if target:
            chain.click(target)
        for mod in modifiers:
            chain.key_down(mod)
        chain.send_keys(actual_key)
        for mod in reversed(modifiers):
            chain.key_up(mod)
        chain.perform()

        return {"success": True, "key": key_name}

    # -----------------------------------------------------------------------
    # Action handlers — Cookie management
    # -----------------------------------------------------------------------

    def _action_get_cookies(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Return all cookies for the current domain."""
        self._ensure_browser()
        name_filter = action.get("name")
        cookies = self.driver.get_cookies()
        if name_filter:
            cookies = [c for c in cookies if c.get("name") == name_filter]
        return {"success": True, "cookies": cookies, "count": len(cookies)}

    def _action_set_cookies(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Set one or more cookies. Each cookie needs at least 'name' and 'value'."""
        self._ensure_browser()
        cookies = action.get("cookies", [])
        if not isinstance(cookies, list) or not cookies:
            raise ValidationError("cookies must be a non-empty list of {name, value, ...} objects")
        added = 0
        for cookie in cookies:
            if not isinstance(cookie, dict) or "name" not in cookie or "value" not in cookie:
                raise ValidationError("Each cookie must have 'name' and 'value' fields")
            self.driver.add_cookie(cookie)
            added += 1
        return {"success": True, "added": added}

    def _action_clear_cookies(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Delete all cookies or a specific cookie by name."""
        self._ensure_browser()
        name = action.get("name")
        if name:
            self.driver.delete_cookie(name)
            return {"success": True, "deleted": name}
        self.driver.delete_all_cookies()
        return {"success": True, "deleted": "all"}

    # -----------------------------------------------------------------------
    # Action handlers — Tab management
    # -----------------------------------------------------------------------

    def _action_list_tabs(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """List all open tabs with their handles and the current active tab."""
        self._ensure_browser()
        handles = self.driver.window_handles
        current = self.driver.current_window_handle
        tabs = []
        for i, handle in enumerate(handles):
            self.driver.switch_to.window(handle)
            tabs.append({
                "index": i,
                "handle": handle,
                "title": self.driver.title,
                "url": self.driver.current_url,
                "active": handle == current,
            })
        self.driver.switch_to.window(current)
        return {"success": True, "tabs": tabs, "count": len(tabs)}

    def _action_switch_tab(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Switch to a tab by index (0-based) or handle string."""
        self._ensure_browser()
        index = action.get("index")
        handle = action.get("handle")
        handles = self.driver.window_handles

        if handle is not None:
            if handle not in handles:
                raise ValidationError(f"Tab handle '{handle}' not found. Use list_tabs to see available handles.")
            self.driver.switch_to.window(handle)
        elif index is not None:
            idx = int(index)
            if idx < 0 or idx >= len(handles):
                raise ValidationError(f"Tab index {idx} out of range (0-{len(handles)-1})")
            self.driver.switch_to.window(handles[idx])
        else:
            raise ValidationError("switch_tab requires 'index' or 'handle'")

        return {"success": True, "title": self.driver.title, "url": self.driver.current_url}

    # -----------------------------------------------------------------------
    # Action handlers — Assert
    # -----------------------------------------------------------------------

    def _action_assert(self, action: dict[str, Any], timeout: int) -> dict[str, Any]:
        """Assert conditions on the current page. Fails with a clear error if unmet.

        Fields:
          type (required): One of 'url', 'title', 'text', 'element_visible', 'element_hidden'.
          expected (required for url/title/text): String to match.
          selector (required for text/element_visible/element_hidden): Element selector.
          match (optional): 'contains' (default), 'exact', 'regex'.
        """
        self._ensure_browser()
        assert_type = action.get("type", "")
        expected = action.get("expected", "")
        match_mode = action.get("match", "contains")
        selector = action.get("selector")

        def _matches(actual: str, expect: str, mode: str) -> bool:
            if mode == "exact":
                return actual == expect
            if mode == "regex":
                return bool(re.search(expect, actual))
            return expect in actual  # contains

        if assert_type == "url":
            actual = self.driver.current_url
            if not _matches(actual, expected, match_mode):
                raise RunnerError(
                    f"Assert URL failed: expected {match_mode} '{expected}', got '{actual}'",
                    "ASSERTION_ERROR",
                )
            return {"success": True, "type": "url", "actual": actual}

        if assert_type == "title":
            actual = self.driver.title
            if not _matches(actual, expected, match_mode):
                raise RunnerError(
                    f"Assert title failed: expected {match_mode} '{expected}', got '{actual}'",
                    "ASSERTION_ERROR",
                )
            return {"success": True, "type": "title", "actual": actual}

        if assert_type == "text":
            if not selector:
                raise ValidationError("assert type='text' requires 'selector'")
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            selector = validate_selector(selector)
            by, sel = translate_selector(selector)
            el = WebDriverWait(self.driver, timeout / 1000.0).until(
                EC.presence_of_element_located((by, sel))
            )
            actual = el.text or ""
            if not _matches(actual, expected, match_mode):
                raise RunnerError(
                    f"Assert text failed on '{selector}': expected {match_mode} '{expected}', "
                    f"got '{actual[:200]}'",
                    "ASSERTION_ERROR",
                )
            return {"success": True, "type": "text", "selector": selector, "actual": actual[:500]}

        if assert_type == "element_visible":
            if not selector:
                raise ValidationError("assert type='element_visible' requires 'selector'")
            selector = validate_selector(selector)
            by, sel = translate_selector(selector)
            try:
                from selenium.webdriver.support.ui import WebDriverWait
                from selenium.webdriver.support import expected_conditions as EC
                WebDriverWait(self.driver, timeout / 1000.0).until(
                    EC.visibility_of_element_located((by, sel))
                )
            except Exception:
                raise RunnerError(
                    f"Assert element_visible failed: '{selector}' not visible",
                    "ASSERTION_ERROR",
                )
            return {"success": True, "type": "element_visible", "selector": selector}

        if assert_type == "element_hidden":
            if not selector:
                raise ValidationError("assert type='element_hidden' requires 'selector'")
            selector = validate_selector(selector)
            by, sel = translate_selector(selector)
            try:
                from selenium.webdriver.support.ui import WebDriverWait
                from selenium.webdriver.support import expected_conditions as EC
                WebDriverWait(self.driver, min(timeout / 1000.0, 5)).until(
                    EC.invisibility_of_element_located((by, sel))
                )
            except Exception:
                raise RunnerError(
                    f"Assert element_hidden failed: '{selector}' is still visible",
                    "ASSERTION_ERROR",
                )
            return {"success": True, "type": "element_hidden", "selector": selector}

        raise ValidationError(
            f"Unknown assert type: '{assert_type}'. "
            f"Available: url, title, text, element_visible, element_hidden"
        )

# ---------------------------------------------------------------------------
# Global timeout handler & Main
# ---------------------------------------------------------------------------

def _timeout_handler(signum: int, frame: Any) -> None:
    raise RunnerTimeoutError(f"Global timeout exceeded ({GLOBAL_TIMEOUT_SEC}s)")

def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        result = check_dependencies()
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
        sys.exit(0 if not result["errors"] else 1)

    if len(sys.argv) > 1 and sys.argv[1] == "--version":
        print(json.dumps({"version": VERSION}))
        sys.exit(0)

    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _timeout_handler)
        signal.alarm(GLOBAL_TIMEOUT_SEC)

    output: dict[str, Any] = {"version": VERSION, "results": [], "success": True}
    runner = None

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            raise ValidationError("Empty input. Provide JSON via stdin.")

        try:
            payload = json.loads(raw_input)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON input: {e}")

        actions = payload.get("actions", [])
        if not isinstance(actions, list) or len(actions) == 0:
            raise ValidationError("'actions' array is empty or invalid")
        if len(actions) > MAX_ACTIONS:
            raise ValidationError(f"Too many actions: {len(actions)} (max {MAX_ACTIONS})")

        options = payload.get("options", {})
        runner = UCRunner(options)
        results: list[dict[str, Any]] = []

        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                results.append({"action": None, "success": False, "error": f"Action #{i} is not an object"})
                continue

            if i > 0 and runner.slow_mo_ms > 0:
                time.sleep(runner.slow_mo_ms / 1000.0)

            try:
                result = runner.execute_action(action)
                result["index"] = i
                results.append(result)
            except RunnerError as e:
                results.append({"action": action.get("action"), "index": i, "success": False, "error": str(e), "code": e.code})
                if isinstance(e, SecurityError) or runner.stop_on_error:
                    output["success"] = False
                    output["error"] = str(e)
                    break
            except Exception as e:
                results.append({"action": action.get("action"), "index": i, "success": False, "error": str(e), "code": "UNEXPECTED_ERROR"})
                if runner.stop_on_error:
                    output["success"] = False
                    output["error"] = str(e)
                    break

        output["results"] = results
        output["success"] = all(r.get("success", False) for r in results)

    except RunnerError as e:
        output["success"] = False
        output["error"] = str(e)
        output["code"] = e.code
    except Exception as e:
        output["success"] = False
        output["error"] = str(e)
        output["code"] = "UNEXPECTED_ERROR"
        output["traceback"] = traceback.format_exc()
    finally:
        if runner is not None:
            runner.close()
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)

    json.dump(output, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    sys.exit(0 if output["success"] else 1)

if __name__ == "__main__":
    main()
