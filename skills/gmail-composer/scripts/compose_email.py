#!/usr/bin/env python3
"""
compose_email.py – Build an RFC 2822 email message and return its
base64url-encoded representation for the Gmail API.

Usage:
    echo '{"to":"a@b.com","subject":"Hello","body":"World"}' | python3 compose_email.py

Input  (JSON via stdin):
    to            (str, required)  – Recipient address(es), comma-separated.
    subject       (str, required)  – Subject line (UTF-8 safe, RFC 2047 encoded).
    body          (str, required)  – Plain-text or HTML body.
    from          (str, optional)  – Sender address.  Gmail usually overrides this.
    cc            (str, optional)  – CC addresses, comma-separated.
    bcc           (str, optional)  – BCC addresses, comma-separated.
    reply_to      (str, optional)  – Reply-To address.
    in_reply_to   (str, optional)  – In-Reply-To Message-ID header (for replies).
    references    (str, optional)  – References header (for threading).
    content_type  (str, optional)  – "plain" (default) or "html".

Output (JSON to stdout):
    success  (bool)  – true
    raw      (str)   – URL-safe base64 without padding / newlines
    summary  (dict)  – Echo of to, subject, content_type for confirmation

Errors are returned as JSON:
    success  (bool)  – false
    error    (str)   – Error code
    message  (str)   – Human-readable detail

Exit code is always 0 for structured output.
"""

from __future__ import annotations

import base64
import json
import sys
from email.header import Header
from email.mime.text import MIMEText


def json_error(code: str, message: str) -> str:
    return json.dumps({"success": False, "error": code, "message": message})


def main() -> None:
    # ── Read stdin ──────────────────────────────────────────────────
    try:
        raw_input = sys.stdin.read()
    except Exception as exc:
        print(json_error("INPUT_ERROR", f"Failed to read stdin: {exc}"))
        return

    if not raw_input.strip():
        print(json_error("INPUT_ERROR", "No input received on stdin"))
        return

    try:
        data = json.loads(raw_input)
    except json.JSONDecodeError as exc:
        print(json_error("INPUT_ERROR", f"Invalid JSON: {exc}"))
        return

    if not isinstance(data, dict):
        print(json_error("INPUT_ERROR", "Input must be a JSON object"))
        return

    # ── Validate required fields ────────────────────────────────────
    to = (data.get("to") or "").strip()
    subject = (data.get("subject") or "").strip()
    body = data.get("body") or ""

    if not to:
        print(json_error("VALIDATION_ERROR", "Missing required field: to"))
        return
    if not subject:
        print(json_error("VALIDATION_ERROR", "Missing required field: subject"))
        return

    content_type = (data.get("content_type") or "plain").strip().lower()
    if content_type not in ("plain", "html"):
        print(json_error("VALIDATION_ERROR", f"Invalid content_type: {content_type}. Must be 'plain' or 'html'"))
        return

    # ── Build RFC 2822 message ──────────────────────────────────────
    try:
        msg = MIMEText(body, content_type, "utf-8")

        # RFC 2047 encode subject for non-ASCII safety
        msg["Subject"] = Header(subject, "utf-8")
        msg["To"] = to

        sender = (data.get("from") or "").strip()
        if sender:
            msg["From"] = sender

        cc = (data.get("cc") or "").strip()
        if cc:
            msg["Cc"] = cc

        bcc = (data.get("bcc") or "").strip()
        if bcc:
            msg["Bcc"] = bcc

        reply_to = (data.get("reply_to") or "").strip()
        if reply_to:
            msg["Reply-To"] = reply_to

        in_reply_to = (data.get("in_reply_to") or "").strip()
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to

        references = (data.get("references") or "").strip()
        if references:
            msg["References"] = references

    except Exception as exc:
        print(json_error("BUILD_ERROR", f"Failed to build email: {exc}"))
        return

    # ── Base64url encode (Gmail API requirement) ────────────────────
    # Gmail API requires: URL-safe base64, no padding, no newlines.
    try:
        raw_bytes = msg.as_bytes()
        raw_b64 = base64.urlsafe_b64encode(raw_bytes).decode("ascii").rstrip("=")
    except Exception as exc:
        print(json_error("ENCODE_ERROR", f"Failed to encode email: {exc}"))
        return

    # ── Output ──────────────────────────────────────────────────────
    result = {
        "success": True,
        "raw": raw_b64,
        "summary": {
            "to": to,
            "subject": subject,
            "content_type": content_type,
        },
    }

    if cc:
        result["summary"]["cc"] = cc
    if bcc:
        result["summary"]["bcc"] = bcc

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
