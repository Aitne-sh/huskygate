#!/usr/bin/env python3
"""
create_pptx.py – Create consultant-quality presentations with HTML preview.

Dual output:
  1. .pptx   – Editable PowerPoint following consulting best practices
  2. _preview.html – Pixel-perfect HTML preview for review before delivery

Design principles (McKinsey / BCG / Bain style):
  - Action titles: full-sentence takeaways, not topics
  - One message per slide
  - Maximum 3 text hierarchy levels (title / body / source)
  - Generous white space (30%+ of slide area)
  - Color restraint: 1 accent color, navy text, white background
  - Professional footer with page number

Usage:
    echo '{"slides":[...]}' | python3 create_pptx.py

Input  (JSON via stdin):  see SKILL.claude.md for full spec
Output (JSON to stdout):  { success, file, preview, summary }
Exit code is always 0 for structured output.
"""

from __future__ import annotations

import html as html_mod
import json
import os
import re
import sys
from typing import Any

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "IMPORT_ERROR",
        "message": "python-pptx is not installed. Run: pip install python-pptx>=1.0.0",
    }))
    sys.exit(0)


# ═══════════════════════════════════════════════════════════════════════════
# Theme Definitions
# ═══════════════════════════════════════════════════════════════════════════
#
# Consulting-grade palettes. Each theme uses exactly:
#   primary  – dark color for titles and key text
#   accent   – single brand highlight color (used sparingly)
#   bg       – slide background
#   card     – panel/card fill (subtle off-white or dark variant)
#   body     – body text color
#   muted    – secondary text, captions, footnotes
#   light    – text-on-dark-background color
#   rule     – separator line color (thin horizontal rules)
#   title_font / body_font  – single font family, limited sizes

THEMES: dict[str, dict[str, Any]] = {
    "corporate": {
        "primary": "#0F172A", "accent": "#2563EB", "bg": "#FFFFFF",
        "card": "#F1F5F9", "body": "#334155", "muted": "#94A3B8",
        "light": "#FFFFFF", "rule": "#E2E8F0",
        "title_font": "Calibri", "body_font": "Calibri",
    },
    "creative": {
        "primary": "#1C1917", "accent": "#EA580C", "bg": "#FFFFFF",
        "card": "#FFF7ED", "body": "#44403C", "muted": "#A8A29E",
        "light": "#FFFFFF", "rule": "#E7E5E4",
        "title_font": "Georgia", "body_font": "Calibri",
    },
    "minimal": {
        "primary": "#09090B", "accent": "#18181B", "bg": "#FFFFFF",
        "card": "#F4F4F5", "body": "#3F3F46", "muted": "#A1A1AA",
        "light": "#FFFFFF", "rule": "#E4E4E7",
        "title_font": "Calibri", "body_font": "Calibri",
    },
    "dark": {
        "primary": "#F8FAFC", "accent": "#38BDF8", "bg": "#0F172A",
        "card": "#1E293B", "body": "#CBD5E1", "muted": "#64748B",
        "light": "#F1F5F9", "rule": "#334155",
        "title_font": "Calibri", "body_font": "Calibri",
    },
    "nature": {
        "primary": "#14532D", "accent": "#16A34A", "bg": "#FFFFFF",
        "card": "#F0FDF4", "body": "#374151", "muted": "#9CA3AF",
        "light": "#FFFFFF", "rule": "#D1D5DB",
        "title_font": "Georgia", "body_font": "Calibri",
    },
    "ocean": {
        "primary": "#0C4A6E", "accent": "#0284C7", "bg": "#FFFFFF",
        "card": "#F0F9FF", "body": "#334155", "muted": "#94A3B8",
        "light": "#FFFFFF", "rule": "#E2E8F0",
        "title_font": "Calibri", "body_font": "Calibri",
    },
    "sunset": {
        "primary": "#7C2D12", "accent": "#DC2626", "bg": "#FFFFFF",
        "card": "#FEF2F2", "body": "#44403C", "muted": "#A8A29E",
        "light": "#FFFFFF", "rule": "#E7E5E4",
        "title_font": "Georgia", "body_font": "Calibri",
    },
    "tech": {
        "primary": "#FAFAFA", "accent": "#A78BFA", "bg": "#09090B",
        "card": "#18181B", "body": "#D4D4D8", "muted": "#71717A",
        "light": "#FAFAFA", "rule": "#27272A",
        "title_font": "Consolas", "body_font": "Calibri",
    },
}

# Fixed design constants (consulting standard)
TITLE_SIZE = 22       # pt – action title
BODY_SIZE = 15        # pt – body text
SMALL_SIZE = 10       # pt – footer, source, caption
BULLET_CHAR = "\u2014"  # em dash — consulting standard bullet
MARGIN_L = 0.75       # inches
MARGIN_R = 0.75
MARGIN_T = 0.5
FOOTER_Y = 6.95       # inches from top (for 7.5" slide)
CONTENT_TOP = 1.35    # inches – body content starts here
TITLE_TOP = 0.45      # inches

MAX_SLIDES = 50


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def json_error(code: str, message: str) -> str:
    return json.dumps({"success": False, "error": code, "message": message})


def _str_to_list(val: Any) -> Any:
    """Convert a newline-delimited string into a list for bullet rendering."""
    if isinstance(val, str) and "\n" in val:
        return [line.strip() for line in val.split("\n") if line.strip()]
    return val


def normalize_slide(sd: dict) -> dict:
    """Normalise slide data so builders receive a consistent shape.

    Handles:
    - flat left_title/left_body → nested left: {heading, body}
    - string body with \\n → list (bullet formatting)
    - source → attribution (quote)
    """
    sd = dict(sd)  # shallow copy to avoid mutating the original

    # ── Flat column keys → nested dicts ──────────────────────────────
    for side in ("left", "right"):
        title_key = f"{side}_title"
        body_key = f"{side}_body"
        if title_key in sd or body_key in sd:
            col = sd.get(side, {})
            if not isinstance(col, dict):
                col = {}
            if title_key in sd:
                col.setdefault("heading", sd.pop(title_key))
            if body_key in sd:
                col.setdefault("body", sd.pop(body_key))
            sd[side] = col

    # ── Auto-split string bodies to list for bullet rendering ────────
    layout = sd.get("layout", "content")
    if layout in ("content", "two_column", "comparison"):
        if "body" in sd:
            sd["body"] = _str_to_list(sd["body"])
        for side in ("left", "right"):
            col = sd.get(side)
            if isinstance(col, dict) and "body" in col:
                col["body"] = _str_to_list(col["body"])

    # ── Quote: source → attribution ──────────────────────────────────
    if layout == "quote" and "source" in sd and "attribution" not in sd:
        sd["attribution"] = sd.pop("source")

    return sd


def hex_to_rgb(c: str) -> RGBColor:
    h = c.lstrip("#")[:6]
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def esc(text: str) -> str:
    """HTML-escape text."""
    return html_mod.escape(text)


# ═══════════════════════════════════════════════════════════════════════════
# PPTX Generation – Low-Level
# ═══════════════════════════════════════════════════════════════════════════

def _rect(slide: Any, l: int, t: int, w: int, h: int, color: str) -> Any:
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, l, t, w, h)
    s.fill.solid()
    s.fill.fore_color.rgb = hex_to_rgb(color)
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def _text(slide: Any, l: int, t: int, w: int, h: int,
          text: str, font: str, size: int, color: str,
          bold: bool = False, italic: bool = False,
          align: PP_ALIGN = PP_ALIGN.LEFT,
          line_spacing: int | None = None) -> Any:
    txbox = slide.shapes.add_textbox(l, t, w, h)
    tf = txbox.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    p = tf.paragraphs[0]
    p.alignment = align
    p.space_before = Pt(0)
    p.space_after = Pt(0)
    if line_spacing:
        p.line_spacing = Pt(line_spacing)
    run = p.add_run()
    run.text = text
    run.font.name = font
    run.font.size = Pt(size)
    run.font.color.rgb = hex_to_rgb(color)
    run.font.bold = bold
    run.font.italic = italic
    return txbox


def _footer(slide: Any, prs: Any, th: dict, idx: int,
            footer_text: str = "") -> None:
    """Consulting-style footer: thin rule + optional left text + page number."""
    w = prs.slide_width
    # Thin horizontal rule
    _rect(slide, Inches(MARGIN_L), Inches(FOOTER_Y),
          w - Inches(MARGIN_L + MARGIN_R), Pt(0.75), th["rule"])
    # Custom footer text (left-aligned)
    if footer_text:
        _text(slide, Inches(MARGIN_L), Inches(FOOTER_Y + 0.05),
              w - Inches(MARGIN_L + MARGIN_R + 1.0), Inches(0.25),
              footer_text, th["body_font"], SMALL_SIZE, th["muted"])
    # Page number right-aligned
    _text(slide, w - Inches(1.0), Inches(FOOTER_Y + 0.05),
          Inches(0.6), Inches(0.25),
          str(idx), th["body_font"], SMALL_SIZE, th["muted"],
          align=PP_ALIGN.RIGHT)


def _title_block(slide: Any, prs: Any, th: dict, title: str) -> None:
    """Action title with accent left-border."""
    w = prs.slide_width
    if not title:
        return
    # Accent bar (left edge of title)
    _rect(slide, Inches(MARGIN_L), Inches(TITLE_TOP),
          Inches(0.06), Inches(0.55), th["accent"])
    # Title text
    _text(slide, Inches(MARGIN_L + 0.22), Inches(TITLE_TOP),
          w - Inches(MARGIN_L + MARGIN_R + 0.22), Inches(0.6),
          title, th["title_font"], TITLE_SIZE, th["primary"],
          bold=True, line_spacing=28)
    # Thin rule below title
    _rect(slide, Inches(MARGIN_L), Inches(1.15),
          w - Inches(MARGIN_L + MARGIN_R), Pt(0.75), th["rule"])


def _bullets(slide: Any, l: int, t: int, w: int, h: int,
             items: list[str], th: dict) -> Any:
    """Consulting-style bullet list with em dash markers."""
    txbox = slide.shapes.add_textbox(l, t, w, h)
    tf = txbox.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        p.space_before = Pt(4)
        p.space_after = Pt(8)
        p.line_spacing = Pt(24)
        # Em dash in accent color
        r1 = p.add_run()
        r1.text = f"{BULLET_CHAR}  "
        r1.font.name = th["body_font"]
        r1.font.size = Pt(BODY_SIZE)
        r1.font.color.rgb = hex_to_rgb(th["accent"])
        r1.font.bold = True
        # Item text
        r2 = p.add_run()
        r2.text = item
        r2.font.name = th["body_font"]
        r2.font.size = Pt(BODY_SIZE)
        r2.font.color.rgb = hex_to_rgb(th["body"])
    return txbox


def _body_text(slide: Any, l: int, t: int, w: int, h: int,
               text: str, th: dict) -> Any:
    return _text(slide, l, t, w, h, text,
                 th["body_font"], BODY_SIZE, th["body"], line_spacing=26)


def _notes(slide: Any, sd: dict) -> None:
    n = sd.get("notes", "")
    if n:
        slide.notes_slide.notes_text_frame.text = n


# ═══════════════════════════════════════════════════════════════════════════
# PPTX Generation – Slide Layouts
# ═══════════════════════════════════════════════════════════════════════════

def pptx_title(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    # Left accent strip
    _rect(slide, 0, 0, Inches(0.12), h, th["accent"])

    # Title
    title = sd.get("title", "")
    if title:
        _text(slide, Inches(1.2), Inches(2.2),
              w - Inches(2.4), Inches(1.8),
              title, th["title_font"], 40, th["primary"],
              bold=True, line_spacing=52)

    # Accent rule under title
    _rect(slide, Inches(1.2), Inches(4.15), Inches(3.0), Pt(3), th["accent"])

    # Subtitle
    sub = sd.get("subtitle", "")
    if sub:
        _text(slide, Inches(1.2), Inches(4.5),
              w - Inches(2.4), Inches(1.0),
              sub, th["body_font"], 18, th["muted"])

    # Bottom rule
    _rect(slide, Inches(1.2), Inches(6.8),
          w - Inches(2.4), Pt(0.5), th["rule"])

    _notes(slide, sd)


def pptx_section(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["primary"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    # Left accent strip
    _rect(slide, 0, 0, Inches(0.12), h, th["accent"])

    title = sd.get("title", "")
    if title:
        _text(slide, Inches(1.2), Inches(2.5),
              w - Inches(2.4), Inches(1.5),
              title, th["title_font"], 38, th["light"],
              bold=True, line_spacing=48)

    # Accent underline
    _rect(slide, Inches(1.2), Inches(4.15), Inches(3.0), Pt(3), th["accent"])

    sub = sd.get("subtitle", "")
    if sub:
        _text(slide, Inches(1.2), Inches(4.5),
              w - Inches(2.4), Inches(0.8),
              sub, th["body_font"], 16, th["muted"])

    # Page number
    _text(slide, w - Inches(1.0), Inches(FOOTER_Y + 0.05),
          Inches(0.6), Inches(0.25),
          str(idx), th["body_font"], SMALL_SIZE, th["muted"],
          align=PP_ALIGN.RIGHT)

    _notes(slide, sd)


def pptx_content(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    _title_block(slide, prs, th, sd.get("title", ""))
    _footer(slide, prs, th, idx, sd.get("footer", ""))

    body = sd.get("body", "")
    bl, bt = Inches(MARGIN_L), Inches(CONTENT_TOP)
    bw = w - Inches(MARGIN_L + MARGIN_R)
    bh = Inches(FOOTER_Y - CONTENT_TOP - 0.1)

    if isinstance(body, list):
        _bullets(slide, bl, bt, bw, bh, body, th)
    elif body:
        _body_text(slide, bl, bt, bw, bh, body, th)

    _notes(slide, sd)


def _pptx_column_card(slide: Any, l: int, t: int, w: int, max_h: int,
                      col: dict, th: dict, card_bg: str, accent: str) -> None:
    """Render a single column card (heading + bullets or text)."""
    heading = col.get("heading", "")
    items = col.get("body", col.get("items", ""))
    is_list = isinstance(items, list)

    # Estimate height
    n_items = len(items) if is_list else 3
    head_h = 0.55 if heading else 0
    est_h = head_h + n_items * 0.42 + 0.5
    card_h = min(Inches(est_h), max_h)

    # Card background
    s = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, l, t, w, card_h)
    s.fill.solid()
    s.fill.fore_color.rgb = hex_to_rgb(card_bg)
    s.line.color.rgb = hex_to_rgb(th["rule"])
    s.line.width = Pt(0.75)
    s.shadow.inherit = False

    # Top accent strip
    _rect(slide, l, t, w, Inches(0.05), accent)

    inner_l = l + Inches(0.3)
    inner_w = w - Inches(0.6)
    y = t + Inches(0.2)

    if heading:
        _text(slide, inner_l, y, inner_w, Inches(0.4),
              heading, th["title_font"], BODY_SIZE + 2, accent, bold=True)
        y += Inches(head_h)

    if is_list:
        _bullets(slide, inner_l, y, inner_w,
                 card_h - Inches(head_h + 0.3), items, th)
    elif items:
        _body_text(slide, inner_l, y, inner_w,
                   card_h - Inches(head_h + 0.3), items, th)


def pptx_two_column(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    _title_block(slide, prs, th, sd.get("title", ""))
    _footer(slide, prs, th, idx, sd.get("footer", ""))

    gap = Inches(0.4)
    col_w = int((w - Inches(MARGIN_L + MARGIN_R) - gap) / 2)
    col_t = Inches(CONTENT_TOP)
    max_h = Inches(FOOTER_Y - CONTENT_TOP - 0.15)

    for i, side in enumerate(["left", "right"]):
        col = sd.get(side, {})
        if not col:
            continue
        col_l = Inches(MARGIN_L) + i * (col_w + gap)
        _pptx_column_card(slide, col_l, col_t, col_w, max_h,
                          col, th, th["card"], th["accent"])

    _notes(slide, sd)


def pptx_comparison(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    _title_block(slide, prs, th, sd.get("title", ""))
    _footer(slide, prs, th, idx, sd.get("footer", ""))

    gap = Inches(0.4)
    col_w = int((w - Inches(MARGIN_L + MARGIN_R) - gap) / 2)
    col_t = Inches(CONTENT_TOP)
    max_h = Inches(FOOTER_Y - CONTENT_TOP - 0.15)

    card_bgs = [th["card"], th["bg"]]
    accents = [th["accent"], th["muted"]]

    for i, side in enumerate(["left", "right"]):
        col = sd.get(side, {})
        if not col:
            continue
        col_l = Inches(MARGIN_L) + i * (col_w + gap)
        _pptx_column_card(slide, col_l, col_t, col_w, max_h,
                          col, th, card_bgs[i], accents[i])

    _notes(slide, sd)


def pptx_image(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    _title_block(slide, prs, th, sd.get("title", ""))
    _footer(slide, prs, th, idx, sd.get("footer", ""))

    img_path = sd.get("image_path", "")
    img_t = Inches(CONTENT_TOP)
    img_w = w - Inches(MARGIN_L + MARGIN_R)
    img_h = Inches(FOOTER_Y - CONTENT_TOP - 0.5)

    if img_path and os.path.isfile(img_path):
        try:
            slide.shapes.add_picture(
                img_path, Inches(MARGIN_L), int(img_t),
                int(img_w), int(img_h))
        except Exception:
            _text(slide, Inches(MARGIN_L), int(img_t), int(img_w), Inches(0.5),
                  f"[Image not loaded: {img_path}]",
                  th["body_font"], BODY_SIZE, th["muted"], italic=True,
                  align=PP_ALIGN.CENTER)
    elif img_path:
        _text(slide, Inches(MARGIN_L), int(img_t), int(img_w), Inches(0.5),
              f"[Image not found: {img_path}]",
              th["body_font"], BODY_SIZE, th["muted"], italic=True,
              align=PP_ALIGN.CENTER)

    cap = sd.get("image_caption", "")
    if cap:
        _text(slide, Inches(MARGIN_L), Inches(FOOTER_Y - 0.35),
              int(img_w), Inches(0.3),
              cap, th["body_font"], SMALL_SIZE, th["muted"],
              italic=True, align=PP_ALIGN.CENTER)

    _notes(slide, sd)


def pptx_quote(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    # Left accent strip
    _rect(slide, 0, 0, Inches(0.12), h, th["accent"])

    # Large open-quote
    _text(slide, Inches(1.5), Inches(1.5), Inches(1.5), Inches(1.5),
          "\u201C", th["title_font"], 96, th["accent"], bold=True)

    quote = sd.get("quote", sd.get("body", ""))
    if quote:
        _text(slide, Inches(2.0), Inches(2.6),
              w - Inches(4.0), Inches(2.5),
              quote, th["body_font"], 20, th["body"],
              italic=True, align=PP_ALIGN.LEFT, line_spacing=32)

    attr = sd.get("attribution", "")
    if attr:
        _rect(slide, Inches(2.0), Inches(5.3), Inches(2.0), Pt(1.5), th["rule"])
        _text(slide, Inches(2.0), Inches(5.5),
              w - Inches(4.0), Inches(0.4),
              f"\u2014  {attr}", th["body_font"], BODY_SIZE, th["muted"])

    _footer(slide, prs, th, idx, sd.get("footer", ""))
    _notes(slide, sd)


def pptx_blank(prs: Any, sd: dict, th: dict, idx: int) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    w, h = prs.slide_width, prs.slide_height
    bg = sd.get("bg_color", th["bg"])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = hex_to_rgb(bg)

    # Blank layout still renders centered title + body when provided
    title = sd.get("title", "")
    body = sd.get("body", "")
    if title:
        _text(slide, Inches(MARGIN_L), Inches(2.4),
              w - Inches(MARGIN_L + MARGIN_R), Inches(1.2),
              title, th["title_font"], 36, th["primary"],
              bold=True, align=PP_ALIGN.CENTER)
    if body:
        body_str = "\n".join(body) if isinstance(body, list) else body
        _text(slide, Inches(MARGIN_L), Inches(3.8),
              w - Inches(MARGIN_L + MARGIN_R), Inches(2.0),
              body_str, th["body_font"], BODY_SIZE, th["muted"],
              align=PP_ALIGN.CENTER, line_spacing=28)

    _notes(slide, sd)


PPTX_BUILDERS = {
    "title": pptx_title, "section": pptx_section,
    "content": pptx_content, "two_column": pptx_two_column,
    "comparison": pptx_comparison, "image": pptx_image,
    "quote": pptx_quote, "blank": pptx_blank,
}


# ═══════════════════════════════════════════════════════════════════════════
# HTML Preview Generation
# ═══════════════════════════════════════════════════════════════════════════

def _html_css(th: dict) -> str:
    return f"""
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#1a1a2e;font-family:{th["body_font"]},system-ui,-apple-system,sans-serif;
  padding:40px 20px;display:flex;flex-direction:column;align-items:center;gap:32px}}
h1.deck-title{{color:#e2e8f0;font-size:24px;font-weight:600;margin-bottom:8px;letter-spacing:-0.02em}}
p.deck-sub{{color:#94a3b8;font-size:14px;margin-bottom:24px}}
.slide-wrap{{position:relative}}
.slide-num{{position:absolute;top:-24px;left:4px;color:#64748b;font-size:12px;font-family:monospace}}
.slide{{width:960px;height:540px;position:relative;overflow:hidden;
  border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,0.4)}}
.s-bg{{background:{th["bg"]};color:{th["body"]}}}
.s-dark{{background:{th["primary"]};color:{th["light"]}}}

/* Typography */
.s-title{{font-family:{th["title_font"]},serif;font-weight:700;letter-spacing:-0.02em}}
.s-body{{font-family:{th["body_font"]},sans-serif;line-height:1.7}}

/* Layout helpers */
.accent-bar{{position:absolute;left:0;top:0;width:5px;height:100%;background:{th["accent"]}}}
.accent-line{{height:3px;background:{th["accent"]};border-radius:2px}}
.rule-line{{height:1px;background:{th["rule"]}}}
.footer{{position:absolute;bottom:14px;left:54px;right:54px;display:flex;
  justify-content:space-between;align-items:center;border-top:1px solid {th["rule"]};padding-top:6px}}
.footer span{{font-size:11px;color:{th["muted"]}}}

/* Card panels */
.card{{background:{th["card"]};border:1px solid {th["rule"]};border-radius:8px;
  border-top:3px solid {th["accent"]};padding:20px 24px}}
.card-muted{{background:{th["bg"]};border:1px solid {th["rule"]};border-radius:8px;
  border-top:3px solid {th["muted"]};padding:20px 24px}}
.card h3{{font-family:{th["title_font"]},serif;font-size:17px;font-weight:700;
  color:{th["accent"]};margin-bottom:12px}}
.card-muted h3{{color:{th["muted"]}}}

/* Bullet list */
.bullet-list{{list-style:none;padding:0}}
.bullet-list li{{padding:4px 0 4px 0;font-size:15px;line-height:1.6;color:{th["body"]}}}
.bullet-list li::before{{content:"\\2014\\00a0\\00a0";color:{th["accent"]};font-weight:700}}
.card-muted .bullet-list li::before{{color:{th["muted"]}}}
"""


def _html_slide_title(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    sub = esc(sd.get("subtitle", ""))
    return f"""<div class="slide s-bg">
  <div class="accent-bar"></div>
  <div style="padding:120px 80px 0 80px">
    <div class="s-title" style="font-size:42px;color:{th["primary"]};line-height:1.2">{title}</div>
    <div class="accent-line" style="width:180px;margin:24px 0"></div>
    <div class="s-body" style="font-size:18px;color:{th["muted"]};margin-top:8px">{sub}</div>
  </div>
  <div style="position:absolute;bottom:24px;left:80px;right:80px" class="rule-line"></div>
</div>"""


def _html_slide_section(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    sub = esc(sd.get("subtitle", ""))
    return f"""<div class="slide s-dark">
  <div class="accent-bar"></div>
  <div style="padding:140px 80px 0 80px">
    <div class="s-title" style="font-size:40px;color:{th["light"]};line-height:1.2">{title}</div>
    <div class="accent-line" style="width:180px;margin:20px 0"></div>
    <div class="s-body" style="font-size:16px;color:{th["muted"]}">{sub}</div>
  </div>
  <div style="position:absolute;bottom:14px;right:54px"><span style="font-size:11px;color:{th["muted"]}">{idx}</span></div>
</div>"""


def _html_bullets(items: list[str], cls: str = "") -> str:
    lis = "\n".join(f"    <li>{esc(i)}</li>" for i in items)
    return f'<ul class="bullet-list {cls}">\n{lis}\n  </ul>'


def _html_footer(sd: dict, th: dict, idx: int) -> str:
    ft = esc(sd.get("footer", ""))
    return f'<div class="footer"><span>{ft}</span><span>{idx}</span></div>'


def _html_title_block(title: str, th: dict) -> str:
    if not title:
        return ""
    return f"""<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:4px">
    <div style="width:4px;min-height:28px;background:{th["accent"]};border-radius:2px;margin-top:2px"></div>
    <div class="s-title" style="font-size:22px;color:{th["primary"]}">{title}</div>
  </div>
  <div class="rule-line" style="margin:8px 0 20px 0"></div>"""


def _html_body(body: Any) -> str:
    if isinstance(body, list):
        return _html_bullets(body)
    return f'<div class="s-body" style="font-size:15px">{esc(str(body))}</div>' if body else ""


def _html_slide_content(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    body = sd.get("body", "")

    return f"""<div class="slide s-bg">
  <div style="padding:28px 54px 0 54px">
    {_html_title_block(title, th)}
    {_html_body(body)}
  </div>
  {_html_footer(sd, th, idx)}
</div>"""


def _html_col_card(col: dict, cls: str = "card") -> str:
    heading = esc(col.get("heading", ""))
    items = col.get("body", col.get("items", ""))
    head_html = f"<h3>{heading}</h3>" if heading else ""
    if isinstance(items, list):
        body_html = _html_bullets(items)
    else:
        body_html = f'<div class="s-body" style="font-size:15px">{esc(str(items))}</div>'
    return f'<div class="{cls}">{head_html}{body_html}</div>'


def _html_slide_two_column(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    left = sd.get("left", {})
    right = sd.get("right", {})

    left_html = _html_col_card(left, "card") if left else ""
    right_html = _html_col_card(right, "card") if right else ""

    return f"""<div class="slide s-bg">
  <div style="padding:28px 54px 0 54px">
    {_html_title_block(title, th)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      {left_html}
      {right_html}
    </div>
  </div>
  {_html_footer(sd, th, idx)}
</div>"""


def _html_slide_comparison(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    left = sd.get("left", {})
    right = sd.get("right", {})

    left_html = _html_col_card(left, "card") if left else ""
    right_html = _html_col_card(right, "card-muted") if right else ""

    return f"""<div class="slide s-bg">
  <div style="padding:28px 54px 0 54px">
    {_html_title_block(title, th)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      {left_html}
      {right_html}
    </div>
  </div>
  {_html_footer(sd, th, idx)}
</div>"""


def _html_slide_quote(sd: dict, th: dict, idx: int) -> str:
    quote = esc(sd.get("quote", sd.get("body", "")))
    attr = esc(sd.get("attribution", ""))
    attr_html = f"""<div class="rule-line" style="width:120px;margin:20px 0"></div>
    <div style="font-size:15px;color:{th["muted"]}">&#8212;&ensp;{attr}</div>""" if attr else ""

    return f"""<div class="slide s-bg">
  <div class="accent-bar"></div>
  <div style="padding:80px 100px 0 100px">
    <div style="font-size:80px;color:{th["accent"]};font-weight:700;line-height:0.8;font-family:{th["title_font"]},serif">&ldquo;</div>
    <div style="font-size:20px;color:{th["body"]};font-style:italic;line-height:1.7;margin:16px 0 0 8px;max-width:720px">{quote}</div>
    <div style="margin-left:8px;margin-top:16px">
      {attr_html}
    </div>
  </div>
  {_html_footer(sd, th, idx)}
</div>"""


def _html_slide_image(sd: dict, th: dict, idx: int) -> str:
    title = esc(sd.get("title", ""))
    cap = esc(sd.get("image_caption", ""))
    img = sd.get("image_path", "")

    if img and os.path.isfile(img):
        img_html = f'<div style="text-align:center"><img src="{esc(img)}" style="max-width:100%;max-height:340px;border-radius:4px"></div>'
    else:
        img_html = f'<div style="color:{th["muted"]};font-style:italic;text-align:center;padding:40px">[Image: {esc(img) if img else "none"}]</div>'

    cap_html = f'<div style="text-align:center;font-size:11px;color:{th["muted"]};margin-top:8px">{cap}</div>' if cap else ""

    return f"""<div class="slide s-bg">
  <div style="padding:28px 54px 0 54px">
    {_html_title_block(title, th)}
    {img_html}
    {cap_html}
  </div>
  {_html_footer(sd, th, idx)}
</div>"""


def _html_slide_blank(sd: dict, th: dict, idx: int) -> str:
    bg = sd.get("bg_color", th["bg"])
    title = esc(sd.get("title", ""))
    body = sd.get("body", "")
    body_str = "\n".join(body) if isinstance(body, list) else (body or "")

    inner = ""
    if title:
        inner += f'<div class="s-title" style="font-size:36px;color:{th["primary"]};text-align:center">{title}</div>'
    if body_str:
        inner += f'<div class="s-body" style="font-size:15px;color:{th["muted"]};text-align:center;margin-top:16px;white-space:pre-line">{esc(body_str)}</div>'

    return f"""<div class="slide" style="background:{bg};display:flex;align-items:center;justify-content:center">
  <div style="padding:40px 80px">{inner}</div>
</div>"""


HTML_BUILDERS = {
    "title": _html_slide_title, "section": _html_slide_section,
    "content": _html_slide_content, "two_column": _html_slide_two_column,
    "comparison": _html_slide_comparison, "image": _html_slide_image,
    "quote": _html_slide_quote, "blank": _html_slide_blank,
}


def generate_html_preview(slides: list[dict], theme: dict,
                          deck_title: str) -> str:
    css = _html_css(theme)
    slide_htmls = []
    for i, sd in enumerate(slides, 1):
        layout = sd.get("layout", "content")
        builder = HTML_BUILDERS.get(layout, _html_slide_blank)
        inner = builder(sd, theme, i)
        slide_htmls.append(
            f'<div class="slide-wrap"><div class="slide-num">Slide {i} — {layout}</div>\n{inner}\n</div>'
        )
    body = "\n".join(slide_htmls)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(deck_title)} — Preview</title>
<style>{css}</style>
</head>
<body>
<h1 class="deck-title">{esc(deck_title)}</h1>
<p class="deck-sub">{len(slides)} slides &middot; Review preview &middot; Edit the JSON input and regenerate to revise</p>
{body}
<p class="deck-sub" style="margin-top:24px;font-size:12px">Generated by PPTX Composer</p>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════

def main() -> None:
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

    slides = data.get("slides")
    if not slides or not isinstance(slides, list):
        print(json_error("VALIDATION_ERROR",
                         "Missing or invalid 'slides' array"))
        return

    if len(slides) > MAX_SLIDES:
        print(json_error("VALIDATION_ERROR",
                         f"Too many slides ({len(slides)}). Max {MAX_SLIDES}."))
        return

    theme_name = data.get("theme", "corporate")
    if theme_name not in THEMES:
        print(json_error("VALIDATION_ERROR",
                         f"Unknown theme '{theme_name}'. "
                         f"Available: {', '.join(sorted(THEMES.keys()))}"))
        return
    theme = THEMES[theme_name]

    # ── Normalise slide data ─────────────────────────────────────────
    slides = [normalize_slide(sd) for sd in slides]

    output_dir = data.get("output_dir", "_output")
    os.makedirs(output_dir, exist_ok=True)

    pres_title = data.get("title", "presentation")
    safe_name = re.sub(r'[^\w\s\-]', '', pres_title).strip().replace(' ', '_')
    if not safe_name:
        safe_name = "presentation"
    pptx_path = os.path.join(output_dir, f"{safe_name}.pptx")
    html_path = os.path.join(output_dir, f"{safe_name}_preview.html")

    # ── Generate PPTX ────────────────────────────────────────────────
    try:
        prs = Presentation()
        prs.slide_width = Inches(data.get("slide_width", 13.333))
        prs.slide_height = Inches(data.get("slide_height", 7.5))

        for i, sd in enumerate(slides):
            layout = sd.get("layout", "content")
            builder = PPTX_BUILDERS.get(layout)
            if not builder:
                print(json_error(
                    "VALIDATION_ERROR",
                    f"Slide {i+1}: unknown layout '{layout}'. "
                    f"Available: {', '.join(sorted(PPTX_BUILDERS.keys()))}"))
                return
            try:
                builder(prs, sd, theme, i + 1)
            except Exception as exc:
                print(json_error("BUILD_ERROR",
                                 f"Slide {i+1} ({layout}): {exc}"))
                return

        prs.save(pptx_path)
    except Exception as exc:
        print(json_error("BUILD_ERROR", f"PPTX generation failed: {exc}"))
        return

    # ── Generate HTML Preview ─────────────────────────────────────────
    try:
        html_content = generate_html_preview(slides, theme, pres_title)
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_content)
    except Exception as exc:
        # HTML preview failure is non-fatal
        html_path = None

    result: dict[str, Any] = {
        "success": True,
        "file": pptx_path,
        "summary": {
            "slide_count": len(slides),
            "theme": theme_name,
            "filename": f"{safe_name}.pptx",
        },
    }
    if html_path:
        result["preview"] = html_path

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
