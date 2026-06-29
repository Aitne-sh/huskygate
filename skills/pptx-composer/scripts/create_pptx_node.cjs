#!/usr/bin/env node
/**
 * create_pptx_node.cjs – Consultant-quality presentation generator (PptxGenJS).
 *
 * Design principles:
 *   - Extreme size contrast (42 pt cover → 14 pt body)
 *   - Generous whitespace (30 %+ empty)
 *   - Native PptxGenJS bullets with paraSpaceAfter
 *   - Factory functions for options (PptxGenJS mutates objects in-place)
 *   - Shadow on cards for depth, no gratuitous decoration
 *   - Guaranteed text / background contrast (sectionBg / sectionText per theme)
 *   - Chart, process-flow, and metric / KPI layouts built-in
 *
 * Usage:  echo '{"slides":[...]}' | node create_pptx_node.cjs
 * Output: { success, file, preview, summary }
 */

'use strict';

const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// Themes — ALL colors WITHOUT '#' (PptxGenJS passes raw hex into OOXML;
//          a leading '#' corrupts the XML and breaks the file)
//
// Each theme guarantees:
//   - primary / body on bg      → WCAG AA (≥ 4.5 : 1)
//   - sectionText on sectionBg  → WCAG AA
//   - muted on bg               → ≥ 3 : 1 (decorative / small text)
//   - accent on bg              → ≥ 3 : 1
// ═══════════════════════════════════════════════════════════════════════════

const THEMES = {
  // Default — matches consulting_templates.pptx exactly
  corporate: {
    primary: '1A2332', accent: '2E86AB', accent2: '3D5A80',
    bg: 'FFFFFF', card: 'E8F1F8', body: '4A5568', muted: '8B9DAF',
    light: 'FFFFFF', rule: 'D1DAE3',
    sectionBg: '1A2332', sectionText: 'B8D4E3',
    darkBg: '0F1923', darkText: 'B8D4E3', darkMuted: '8B9DAF',
    chart: ['2E86AB','2D936C','E8963E','3D5A80','C1292E','5BA4CF','7BC086','F0B775'],
    lightBg: 'F7F9FC',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  creative: {
    primary: '292524', accent: 'EA580C', accent2: 'DB2777',
    bg: 'FFFFFF', card: 'FFEDD5', body: '57534E', muted: 'A8A29E',
    light: 'FFFFFF', rule: 'D6D3D1',
    sectionBg: '9A3412', sectionText: 'FFF7ED',
    darkBg: '1A1412', darkText: 'FFF7ED', darkMuted: 'A89E94',
    chart: ['EA580C','DB2777','8B5CF6','0891B2','84CC16','F59E0B','EF4444','06B6D4'],
    lightBg: 'FDF8F3',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  minimal: {
    primary: '18181B', accent: '27272A', accent2: '52525B',
    bg: 'FFFFFF', card: 'F4F4F5', body: '3F3F46', muted: 'A1A1AA',
    light: 'FFFFFF', rule: 'D4D4D8',
    sectionBg: '27272A', sectionText: 'F4F4F5',
    darkBg: '141416', darkText: 'F4F4F5', darkMuted: '8A8A90',
    chart: ['18181B','71717A','A1A1AA','3F3F46','52525B','D4D4D8','27272A','09090B'],
    lightBg: 'FAFAFA',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  dark: {
    primary: '0F172A', accent: '0EA5E9', accent2: '6366F1',
    bg: 'FFFFFF', card: 'E0F2FE', body: '334155', muted: '94A3B8',
    light: 'FFFFFF', rule: 'CBD5E1',
    sectionBg: '0C4A6E', sectionText: 'E0F2FE',
    darkBg: '0B1120', darkText: 'E0F2FE', darkMuted: '7B8BA0',
    chart: ['0EA5E9','6366F1','34D399','FBBF24','F87171','A78BFA','2DD4BF','FB923C'],
    lightBg: 'F0F9FF',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  nature: {
    primary: '14532D', accent: '16A34A', accent2: '65A30D',
    bg: 'FFFFFF', card: 'DCFCE7', body: '374151', muted: '9CA3AF',
    light: 'FFFFFF', rule: 'D1D5DB',
    sectionBg: '166534', sectionText: 'DCFCE7',
    darkBg: '0D1A12', darkText: 'DCFCE7', darkMuted: '7A8F7E',
    chart: ['16A34A','65A30D','0891B2','D97706','DC2626','7C3AED','DB2777','2563EB'],
    lightBg: 'F0FDF4',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  ocean: {
    primary: '164E63', accent: '0891B2', accent2: '0284C7',
    bg: 'FFFFFF', card: 'CFFAFE', body: '334155', muted: '94A3B8',
    light: 'FFFFFF', rule: 'CBD5E1',
    sectionBg: '155E75', sectionText: 'ECFEFF',
    darkBg: '0C1A20', darkText: 'ECFEFF', darkMuted: '7B8FA0',
    chart: ['0891B2','0284C7','2563EB','7C3AED','F59E0B','10B981','EF4444','EC4899'],
    lightBg: 'F0FDFA',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
  sunset: {
    primary: '7C2D12', accent: 'EA580C', accent2: 'DC2626',
    bg: 'FFFFFF', card: 'FEF3C7', body: '44403C', muted: 'A8A29E',
    light: 'FFFFFF', rule: 'D6D3D1',
    sectionBg: '92400E', sectionText: 'FFEDD5',
    darkBg: '1A140D', darkText: 'FFEDD5', darkMuted: 'A89680',
    chart: ['EA580C','DC2626','D97706','16A34A','0891B2','7C3AED','DB2777','2563EB'],
    lightBg: 'FFFBEB',
    titleFont: 'Georgia', bodyFont: 'Calibri',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Layout Grid Constants (consulting standard – 16:9 widescreen)
// ═══════════════════════════════════════════════════════════════════════════

const SW = 13.333;          // slide width
const SH = 7.5;             // slide height
const ML = 0.8;             // margin left
const MR = 0.8;             // margin right
const CW = SW - ML - MR;    // content width
const GAP = 0.4;            // column gap

// Vertical grid
const TITLE_Y  = 0.4;
const TITLE_H  = 0.8;
const RULE_Y   = 1.3;
const BODY_Y   = 1.5;
const FOOTER_Y = 7.0;
const BODY_H   = FOOTER_Y - BODY_Y - 0.1;

// Typography
const TITLE_PT     = 24;
const BODY_PT      = 14;
const SMALL_PT     = 10;
const CARD_HEAD_PT = 16;

const MAX_SLIDES = 50;

// ═══════════════════════════════════════════════════════════════════════════
// Option Factories (PptxGenJS mutates objects in-place → never share refs)
// ═══════════════════════════════════════════════════════════════════════════

function cardShadow() {
  return { type: 'outer', blur: 8, offset: 2, color: '000000', opacity: 0.10 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function jsonErr(code, msg) {
  return JSON.stringify({ success: false, error: code, message: msg });
}
function strip(c) { return (c || '').replace(/^#/, ''); }
/** Darken a hex color by a factor (0–1). Used for sidebar on dark title slides. */
function darken(hex, factor) {
  const h = strip(hex);
  const r = Math.max(0, Math.round(parseInt(h.slice(0,2),16) * (1 - factor)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2,4),16) * (1 - factor)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4,6),16) * (1 - factor)));
  return [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
function toList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.includes('\n'))
    return v.split('\n').map(s => s.trim()).filter(Boolean);
  return typeof v === 'string' && v ? [v] : [];
}

/** Return background color for content-type slides (auto-alternates white / lightBg) */
function getContentBg(sd, th) {
  if (sd.bg_color) return strip(sd.bg_color);
  if (typeof sd._contentIdx === 'number' && sd._contentIdx % 2 === 1) return th.lightBg;
  return th.bg;
}

function normalizeSlide(sd) {
  sd = { ...sd };
  // Normalize flat column keys → nested objects
  for (const s of ['left', 'right']) {
    const tk = `${s}_title`, bk = `${s}_body`;
    if (tk in sd || bk in sd) {
      const col = (typeof sd[s] === 'object' && sd[s]) ? { ...sd[s] } : {};
      if (tk in sd) { col.heading = col.heading || sd[tk]; delete sd[tk]; }
      if (bk in sd) { col.body = col.body || sd[bk]; delete sd[bk]; }
      sd[s] = col;
    }
  }
  const ly = sd.layout || 'content';
  // Auto-split newline strings into arrays
  if (['content', 'two_column', 'comparison'].includes(ly)) {
    if (sd.body && typeof sd.body === 'string' && sd.body.includes('\n'))
      sd.body = toList(sd.body);
    for (const s of ['left', 'right']) {
      const c = sd[s];
      if (c && typeof c === 'object' && c.body && typeof c.body === 'string' && c.body.includes('\n'))
        c.body = toList(c.body);
    }
  }
  // Quote alias
  if (ly === 'quote' && sd.source && !sd.attribution) {
    sd.attribution = sd.source; delete sd.source;
  }
  // Metric alias: data → metrics
  if (ly === 'metric' && sd.data && !sd.metrics) {
    sd.metrics = sd.data; delete sd.data;
  }
  // SCQA aliases
  if (ly === 'scqa') {
    if (sd.answer && !sd.resolution) { sd.resolution = sd.answer; delete sd.answer; }
    if (sd.question && !sd.complication) { sd.complication = sd.question; delete sd.question; }
  }
  return sd;
}

// ═══════════════════════════════════════════════════════════════════════════
// PPTX Slide Building — Shared Components
// ═══════════════════════════════════════════════════════════════════════════

function addFooter(slide, th, idx, text) {
  slide.addShape('line', {
    x: ML, y: FOOTER_Y, w: CW, h: 0,
    line: { color: th.rule, width: 0.5 },
  });
  if (text) {
    slide.addText(text, {
      x: ML, y: FOOTER_Y + 0.06, w: CW - 1.0, h: 0.3,
      fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.muted, valign: 'top',
    });
  }
  slide.addText(String(idx), {
    x: SW - 1.2, y: FOOTER_Y + 0.06, w: 0.6, h: 0.3,
    fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.muted,
    align: 'right', valign: 'top',
  });
}

function addTitleBlock(slide, th, title) {
  if (!title) return;
  // Accent bar
  slide.addShape('rect', {
    x: ML, y: TITLE_Y, w: 0.06, h: 0.6,
    fill: { color: th.accent }, line: { width: 0 },
  });
  // Title text
  slide.addText(title, {
    x: ML + 0.24, y: TITLE_Y, w: CW - 0.24, h: TITLE_H,
    fontSize: TITLE_PT, fontFace: th.titleFont, color: th.primary,
    bold: true, valign: 'middle', lineSpacingMultiple: 1.15,
    charSpacing: -0.2,
  });
  // Thin rule below title
  slide.addShape('line', {
    x: ML, y: RULE_Y, w: CW, h: 0,
    line: { color: th.rule, width: 0.5 },
  });
}

/** Build native PptxGenJS bullet text items */
function buildBullets(items, th, accentColor) {
  const ac = accentColor || th.accent;
  return items.map((item, i) => ({
    text: item,
    options: {
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.body,
      bullet: { code: '25CF', color: ac },
      indentLevel: 0,
      paraSpaceBefore: i === 0 ? 0 : 4,
      paraSpaceAfter: 6,
      lineSpacingMultiple: 1.45,
      breakLine: true,
    },
  }));
}

function addBody(slide, th, body, x, y, w, h) {
  const items = Array.isArray(body) ? body : [];
  if (items.length > 0) {
    slide.addText(buildBullets(items, th), { x, y, w, h, valign: 'top' });
  } else if (typeof body === 'string' && body) {
    slide.addText(body, {
      x, y, w, h, valign: 'top',
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.body,
      lineSpacingMultiple: 1.5,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PPTX Slide Building — Original Layouts
// ═══════════════════════════════════════════════════════════════════════════

function buildTitle(pptx, sd, th) {
  const bg = strip(sd.bg_color) || th.darkBg;
  const slide = pptx.addSlide();
  slide.background = { color: bg };

  // Full-width accent top bar
  slide.addShape('rect', {
    x: 0, y: 0, w: SW, h: 0.08,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Sidebar panel (darker shade)
  const sideW = 3.6;
  // Darken the darkBg slightly for sidebar contrast
  slide.addShape('rect', {
    x: 0, y: 0.08, w: sideW, h: SH - 0.08,
    fill: { color: darken(bg, 0.3) }, line: { width: 0 },
  });

  // Accent vertical line at sidebar edge
  slide.addShape('rect', {
    x: sideW, y: 0.08, w: 0.04, h: SH - 0.08,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Company name in sidebar (optional)
  if (sd.company) {
    slide.addText(sd.company, {
      x: 0.6, y: 1.5, w: sideW - 1.0, h: 0.5,
      fontSize: 12, fontFace: th.bodyFont, color: th.darkMuted,
      valign: 'top', letterSpacing: 2,
    });
  }

  // Sidebar decorative accent bar
  slide.addShape('rect', {
    x: 0.6, y: SH - 1.5, w: 1.2, h: 0.04,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Title (right of sidebar)
  const textX = sideW + 0.8;
  const textW = SW - textX - 0.8;
  if (sd.title) {
    slide.addText(sd.title, {
      x: textX, y: 1.2, w: textW, h: 2.6,
      fontSize: 42, fontFace: th.titleFont, color: th.darkText,
      bold: true, valign: 'bottom', lineSpacingMultiple: 1.15,
      charSpacing: -0.5,
    });
  }

  // Accent rule below title
  slide.addShape('line', {
    x: textX, y: 4.1, w: 3.5, h: 0,
    line: { color: th.accent, width: 3 },
  });

  // Subtitle
  if (sd.subtitle) {
    slide.addText(sd.subtitle, {
      x: textX, y: 4.4, w: textW, h: 1.2,
      fontSize: 16, fontFace: th.bodyFont, color: th.darkMuted,
      valign: 'top', lineSpacingMultiple: 1.4,
    });
  }

  // Date or footer text
  if (sd.footer) {
    slide.addText(sd.footer, {
      x: textX, y: 6.3, w: textW, h: 0.4,
      fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.darkMuted,
    });
  }

  // Bottom accent bar
  slide.addShape('rect', {
    x: 0, y: SH - 0.06, w: SW, h: 0.06,
    fill: { color: th.accent2 }, line: { width: 0 },
  });
}

function buildSection(pptx, sd, th, idx) {
  const bg = strip(sd.bg_color) || th.darkBg;
  const slide = pptx.addSlide();
  slide.background = { color: bg };

  // Full-width accent top bar
  slide.addShape('rect', {
    x: 0, y: 0, w: SW, h: 0.08,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Optional large section number (accent-colored for visibility)
  if (sd.number) {
    slide.addText(String(sd.number), {
      x: 1.4, y: 1.2, w: 2.0, h: 0.8,
      fontSize: 52, fontFace: th.titleFont, color: th.accent,
      bold: true, valign: 'bottom',
    });
    slide.addShape('line', {
      x: 1.4, y: 2.15, w: 1.5, h: 0,
      line: { color: th.accent, width: 3 },
    });
  }

  if (sd.title) {
    const titleY = sd.number ? 2.5 : 2.0;
    slide.addText(sd.title, {
      x: 1.4, y: titleY, w: SW - 3.0, h: 1.8,
      fontSize: 36, fontFace: th.titleFont, color: th.darkText,
      bold: true, valign: 'bottom', lineSpacingMultiple: 1.15,
      charSpacing: -0.3,
    });
  }

  // Accent rule below title
  const ruleY = sd.number ? 4.55 : 4.05;
  slide.addShape('line', {
    x: 1.4, y: ruleY, w: 3.5, h: 0,
    line: { color: th.accent, width: 3 },
  });

  if (sd.subtitle) {
    const subY = sd.number ? 4.85 : 4.35;
    slide.addText(sd.subtitle, {
      x: 1.4, y: subY, w: SW - 3.0, h: 0.8,
      fontSize: 16, fontFace: th.bodyFont, color: th.darkMuted,
      valign: 'top', lineSpacingMultiple: 1.4,
    });
  }

  // Bottom accent bar
  slide.addShape('rect', {
    x: 0, y: SH - 0.06, w: SW, h: 0.06,
    fill: { color: th.accent2 }, line: { width: 0 },
  });

  // Page number
  slide.addText(String(idx), {
    x: SW - 1.2, y: FOOTER_Y + 0.06, w: 0.6, h: 0.3,
    fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.darkMuted,
    align: 'right',
  });
}

function buildContent(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);
  addBody(slide, th, sd.body, ML, BODY_Y, CW, BODY_H);
}

function buildCard(slide, th, col, x, y, w, h, cardBg, accent) {
  if (!col || typeof col !== 'object') return;
  const heading = col.heading || '';
  const items = Array.isArray(col.body) ? col.body : toList(col.body || '');

  // Card background (no border — shadow + color bar provide definition)
  slide.addShape('roundRect', {
    x, y, w, h,
    fill: { color: cardBg },
    line: { width: 0 },
    rectRadius: 0.06,
    shadow: cardShadow(),
  });

  // Left color bar (flush with card edge)
  slide.addShape('rect', {
    x, y, w: 0.06, h,
    fill: { color: accent }, line: { width: 0 },
  });

  // Top accent bar
  slide.addShape('rect', {
    x, y, w, h: 0.05,
    fill: { color: accent }, line: { width: 0 },
  });

  const ix = x + 0.3;
  const iw = w - 0.55;
  let cy = y + 0.25;

  if (heading) {
    slide.addText(heading, {
      x: ix, y: cy, w: iw, h: 0.4,
      fontSize: CARD_HEAD_PT, fontFace: th.titleFont, color: accent,
      bold: true, valign: 'top',
    });
    cy += 0.5;
  }

  if (items.length > 0) {
    const bh = h - (cy - y) - 0.15;
    const cardBullets = items.map((item, i) => ({
      text: item,
      options: {
        fontSize: 12, fontFace: th.bodyFont, color: th.body,
        bullet: { code: '25CF', color: accent },
        indentLevel: 0,
        paraSpaceBefore: i === 0 ? 0 : 2,
        paraSpaceAfter: 3,
        lineSpacingMultiple: 1.3,
        breakLine: true,
      },
    }));
    slide.addText(cardBullets, {
      x: ix, y: cy, w: iw, h: bh, valign: 'top',
    });
  }
}

function buildTwoColumn(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const colW = (CW - GAP) / 2;
  // Both cards at equal weight — accent on left, accent2 on right for variety
  buildCard(slide, th, sd.left,  ML, BODY_Y, colW, BODY_H, th.card, th.accent);
  buildCard(slide, th, sd.right, ML + colW + GAP, BODY_Y, colW, BODY_H, th.card, th.accent2);
}

function buildComparison(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const colW = (CW - GAP) / 2;
  // Left = accent (recommended), Right = muted (alternative) — both use card bg for visibility
  buildCard(slide, th, sd.left,  ML, BODY_Y, colW, BODY_H, th.card, th.accent);
  buildCard(slide, th, sd.right, ML + colW + GAP, BODY_Y, colW, BODY_H, th.card, th.muted);
}

function buildQuote(pptx, sd, th, idx) {
  const bg = strip(sd.bg_color) || th.bg;
  const slide = pptx.addSlide();
  slide.background = { color: bg };

  // Left accent strip
  slide.addShape('rect', {
    x: 0, y: 0, w: 0.14, h: SH,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Large open-quote mark
  slide.addText('\u201C', {
    x: 1.5, y: 1.0, w: 1.5, h: 1.5,
    fontSize: 100, fontFace: th.titleFont, color: th.accent,
    bold: true, valign: 'top',
  });

  const quote = sd.quote || sd.body || '';
  if (quote) {
    slide.addText(quote, {
      x: 2.2, y: 2.4, w: SW - 4.5, h: 2.5,
      fontSize: 22, fontFace: th.bodyFont, color: th.body,
      italic: true, valign: 'top', lineSpacingMultiple: 1.6,
    });
  }

  const attr = sd.attribution || '';
  if (attr) {
    slide.addShape('line', {
      x: 2.2, y: 5.15, w: 2.0, h: 0,
      line: { color: th.accent2, width: 2 },
    });
    slide.addText(`\u2014  ${attr}`, {
      x: 2.2, y: 5.35, w: SW - 4.5, h: 0.5,
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.muted,
    });
  }

  addFooter(slide, th, idx, sd.footer);
}

function buildImage(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const imgPath = sd.image_path || '';
  const imgH = BODY_H - 0.5;
  if (imgPath && fs.existsSync(imgPath)) {
    try {
      slide.addImage({
        path: imgPath, x: ML, y: BODY_Y, w: CW, h: imgH,
        sizing: { type: 'contain', w: CW, h: imgH },
      });
    } catch { /* fallthrough to placeholder */ }
  } else if (imgPath) {
    slide.addText(`[Image not found: ${imgPath}]`, {
      x: ML, y: BODY_Y, w: CW, h: 0.5,
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.muted,
      italic: true, align: 'center',
    });
  }

  if (sd.image_caption) {
    slide.addText(sd.image_caption, {
      x: ML, y: FOOTER_Y - 0.4, w: CW, h: 0.3,
      fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.muted,
      italic: true, align: 'center',
    });
  }
}

function buildBlank(pptx, sd, th) {
  const bg = strip(sd.bg_color) || th.darkBg;
  const slide = pptx.addSlide();
  slide.background = { color: bg };

  // Full-width accent top bar
  slide.addShape('rect', {
    x: 0, y: 0, w: SW, h: 0.08,
    fill: { color: th.accent }, line: { width: 0 },
  });

  // Centered accent line above title
  slide.addShape('line', {
    x: SW / 2 - 1.5, y: 2.2, w: 3.0, h: 0,
    line: { color: th.accent, width: 3 },
  });

  if (sd.title) {
    slide.addText(sd.title, {
      x: ML, y: 2.5, w: CW, h: 1.2,
      fontSize: 36, fontFace: th.titleFont, color: th.darkText,
      bold: true, align: 'center', valign: 'middle',
    });
  }
  if (sd.body) {
    const b = Array.isArray(sd.body) ? sd.body.join('\n') : sd.body;
    slide.addText(b, {
      x: ML, y: 3.9, w: CW, h: 2.0,
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.darkMuted,
      align: 'center', valign: 'top', lineSpacingMultiple: 1.5,
    });
  }

  // Bottom accent bar
  slide.addShape('rect', {
    x: 0, y: SH - 0.06, w: SW, h: 0.06,
    fill: { color: th.accent2 }, line: { width: 0 },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PPTX Slide Building — New Layouts (chart, process, metric)
// ═══════════════════════════════════════════════════════════════════════════

function buildChart(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const chartType = (sd.chart_type || 'bar').toLowerCase();
  const chartData = sd.chart_data || [];
  if (!chartData.length) return;

  // Resolve PptxGenJS chart type constant
  const CT = pptx.charts || {};
  const typeMap = {
    bar: CT.BAR, bar3d: CT.BAR3D, line: CT.LINE, area: CT.AREA,
    pie: CT.PIE, doughnut: CT.DOUGHNUT, scatter: CT.SCATTER,
    radar: CT.RADAR, bubble: CT.BUBBLE,
  };
  const type = typeMap[chartType] || CT.BAR;
  if (!type) return; // PptxGenJS charts not available

  const isPie = ['pie', 'doughnut'].includes(chartType);
  const colors = th.chart.slice(0, Math.max(chartData.length, (chartData[0]?.labels || []).length));

  // Chart placement — full body area for chart-only, or split for pie+legend
  const chartX = isPie ? ML + 0.5 : ML;
  const chartW = isPie ? CW - 1.0 : CW;

  const defaults = {
    x: chartX, y: BODY_Y, w: chartW, h: BODY_H,
    showLegend: true,
    legendPos: isPie ? 'r' : 'b',
    legendFontFace: th.bodyFont,
    legendFontSize: SMALL_PT,
    legendColor: th.body,
    chartColors: colors,
    showTitle: false,
    // Bar/line specific
    ...(!isPie && {
      catAxisLabelColor: th.body,
      catAxisLabelFontFace: th.bodyFont,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: th.muted,
      valAxisLabelFontFace: th.bodyFont,
      valAxisLabelFontSize: SMALL_PT,
      valGridLine: { color: th.rule, width: 0.5 },
      catGridLine: { style: 'none' },
    }),
    // Pie specific
    ...(isPie && {
      showPercent: true,
      dataLabelColor: th.body,
      dataLabelFontSize: 11,
    }),
  };

  const userOpts = sd.chart_options || {};
  slide.addChart(type, chartData, { ...defaults, ...userOpts });
}

function buildProcess(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const steps = sd.steps || [];
  if (!steps.length) return;
  const n = Math.min(steps.length, 6);

  const stepW = 1.7;
  const arrowW = 0.5;
  const totalW = n * stepW + (n - 1) * arrowW;
  const startX = ML + (CW - totalW) / 2;
  const centerY = BODY_Y + BODY_H / 2 - 0.3;

  const circleD = 0.5;
  const shapes = pptx.shapes || {};

  for (let i = 0; i < n; i++) {
    const step = steps[i];
    const x = startX + i * (stepW + arrowW);
    const cx = x + stepW / 2;

    // Step card background
    slide.addShape(shapes.ROUNDED_RECTANGLE || 'roundRect', {
      x, y: centerY - 0.2, w: stepW, h: 2.8,
      fill: { color: th.card },
      line: { width: 0 },
      rectRadius: 0.06,
      shadow: cardShadow(),
    });

    // Top accent strip on card
    slide.addShape('rect', {
      x, y: centerY - 0.2, w: stepW, h: 0.05,
      fill: { color: i === 0 ? th.accent : th.accent2 }, line: { width: 0 },
    });

    // Number circle
    const numColor = i === 0 ? th.accent : th.accent2;
    slide.addShape(shapes.OVAL || 'ellipse', {
      x: cx - circleD / 2, y: centerY + 0.15,
      w: circleD, h: circleD,
      fill: { color: numColor }, line: { width: 0 },
    });
    slide.addText(String(i + 1), {
      x: cx - circleD / 2, y: centerY + 0.15,
      w: circleD, h: circleD,
      fontSize: 14, fontFace: th.bodyFont, color: 'FFFFFF',
      bold: true, align: 'center', valign: 'middle',
    });

    // Step label
    slide.addText(step.label || `Step ${i + 1}`, {
      x: x + 0.1, y: centerY + 0.8, w: stepW - 0.2, h: 0.5,
      fontSize: 13, fontFace: th.titleFont, color: th.primary,
      bold: true, align: 'center', valign: 'top',
    });

    // Step description
    if (step.description) {
      slide.addText(step.description, {
        x: x + 0.1, y: centerY + 1.3, w: stepW - 0.2, h: 1.0,
        fontSize: 11, fontFace: th.bodyFont, color: th.muted,
        align: 'center', valign: 'top', lineSpacingMultiple: 1.3,
      });
    }

    // Arrow connector (except after last)
    if (i < n - 1) {
      const arrowX = x + stepW;
      slide.addShape(shapes.LINE || 'line', {
        x: arrowX + 0.08, y: centerY + circleD / 2 + 0.15,
        w: arrowW - 0.16, h: 0,
        line: { color: th.accent, width: 2, endArrowType: 'triangle' },
      });
    }
  }
}

function buildMetric(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const metrics = sd.metrics || [];
  if (!metrics.length) return;
  const n = Math.min(metrics.length, 4);

  const gap = 0.3;
  const mw = (CW - (n - 1) * gap) / n;
  // Cap card height: enough for value + label + change + description, not full body
  const hasDesc = metrics.some(m => m.description);
  const mh = Math.min(BODY_H - 0.3, hasDesc ? 3.6 : 2.8);
  const my = BODY_Y + 0.15;
  const colors = [th.accent, th.chart[4] || th.accent2, th.accent2, th.chart[3] || th.accent];

  for (let i = 0; i < n; i++) {
    const m = metrics[i];
    const mx = ML + i * (mw + gap);
    const color = colors[i % colors.length];

    // Card background
    slide.addShape('roundRect', {
      x: mx, y: my, w: mw, h: mh,
      fill: { color: th.card },
      line: { width: 0 },
      rectRadius: 0.06,
      shadow: cardShadow(),
    });

    // Left color bar (flush)
    slide.addShape('rect', {
      x: mx, y: my, w: 0.06, h: mh,
      fill: { color: color }, line: { width: 0 },
    });

    // Top accent bar (flush)
    slide.addShape('rect', {
      x: mx, y: my, w: mw, h: 0.05,
      fill: { color: color }, line: { width: 0 },
    });

    // Big value (compact positioning)
    slide.addText(m.value || '', {
      x: mx + 0.15, y: my + 0.25, w: mw - 0.3, h: 1.0,
      fontSize: 36, fontFace: th.titleFont, color: color,
      bold: true, align: 'center', valign: 'middle',
      charSpacing: -0.5,
    });

    // Label
    slide.addText(m.label || '', {
      x: mx + 0.15, y: my + 1.3, w: mw - 0.3, h: 0.4,
      fontSize: 12, fontFace: th.bodyFont, color: th.primary,
      bold: true, align: 'center', valign: 'top',
    });

    // Change indicator
    if (m.change) {
      const isPositive = m.change.startsWith('+');
      const changeColor = isPositive ? '16A34A' : 'DC2626';
      slide.addText(m.change, {
        x: mx + 0.15, y: my + 1.7, w: mw - 0.3, h: 0.4,
        fontSize: 13, fontFace: th.bodyFont, color: changeColor,
        bold: true, align: 'center', valign: 'top',
      });
    }

    // Description
    if (m.description) {
      slide.addText(m.description, {
        x: mx + 0.15, y: my + 2.15, w: mw - 0.3, h: 0.6,
        fontSize: 10, fontFace: th.bodyFont, color: th.muted,
        align: 'center', valign: 'top', lineSpacingMultiple: 1.3,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PPTX Slide Building — Consulting-Style Layouts
// ═══════════════════════════════════════════════════════════════════════════

function buildSCQA(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const scqaColors = [
    th.accent,
    th.chart[4] || th.accent2,
    th.chart[3] || th.accent2,
  ];
  const sections = [
    { label: 'SITUATION', text: sd.situation, color: scqaColors[0] },
    { label: 'COMPLICATION', text: sd.complication, color: scqaColors[1] },
    { label: 'RESOLUTION', text: sd.resolution, color: scqaColors[2] },
  ].filter(s => s.text);
  const n = sections.length;
  if (!n) return;

  const sectionH = (FOOTER_Y - BODY_Y - 0.3) / n;
  let y = BODY_Y + 0.1;

  for (const s of sections) {
    // Colored vertical bar
    slide.addShape('rect', {
      x: ML, y, w: 0.07, h: sectionH - 0.2,
      fill: { color: s.color }, line: { width: 0 },
    });
    // Section label
    slide.addText(s.label, {
      x: ML + 0.3, y, w: 2.5, h: 0.35,
      fontSize: 9, fontFace: th.bodyFont, color: s.color,
      bold: true, valign: 'middle',
    });
    // Body text
    const bodyItems = Array.isArray(s.text) ? s.text : [s.text];
    if (bodyItems.length > 1) {
      slide.addText(buildBullets(bodyItems, th, s.color), {
        x: ML + 0.3, y: y + 0.35, w: CW - 0.4, h: sectionH - 0.6,
        valign: 'top',
      });
    } else {
      slide.addText(bodyItems[0], {
        x: ML + 0.3, y: y + 0.35, w: CW - 0.4, h: sectionH - 0.6,
        fontSize: BODY_PT, fontFace: th.bodyFont, color: th.body,
        valign: 'top', lineSpacingMultiple: 1.5,
      });
    }
    y += sectionH;
  }
}

function buildAgenda(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };

  // Large title
  if (sd.title) {
    slide.addText(sd.title, {
      x: ML, y: TITLE_Y, w: 4.0, h: 0.55,
      fontSize: 28, fontFace: th.titleFont, color: th.primary,
      bold: true, valign: 'middle',
    });
  }
  slide.addShape('line', {
    x: ML, y: 1.0, w: CW, h: 0,
    line: { color: th.rule, width: 1 },
  });
  addFooter(slide, th, idx, sd.footer);

  const items = sd.items || [];
  const n = Math.min(items.length, 6);
  if (!n) return;

  const itemH = (FOOTER_Y - 1.3 - 0.3) / n;
  let y = 1.3;

  for (let i = 0; i < n; i++) {
    const item = items[i];
    const num = String(i + 1).padStart(2, '0');

    // Number
    slide.addText(num, {
      x: ML, y, w: 0.7, h: 0.6,
      fontSize: 22, fontFace: th.titleFont, color: th.accent,
      bold: true, valign: 'top',
    });
    // Title
    slide.addText(item.title || '', {
      x: ML + 0.8, y, w: CW - 0.8, h: 0.35,
      fontSize: 14, fontFace: th.titleFont, color: th.primary,
      bold: true, valign: 'top',
    });
    // Description
    if (item.description) {
      slide.addText(item.description, {
        x: ML + 0.8, y: y + 0.32, w: CW - 0.8, h: 0.3,
        fontSize: 10, fontFace: th.bodyFont, color: th.muted,
        valign: 'top',
      });
    }
    // Divider (except last)
    if (i < n - 1) {
      slide.addShape('line', {
        x: ML + 0.8, y: y + itemH - 0.05, w: CW - 0.8, h: 0,
        line: { color: th.rule, width: 0.5 },
      });
    }
    y += itemH;
  }
}

function buildPillars(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const pillars = sd.pillars || [];
  const n = Math.min(pillars.length, 4);
  if (!n) return;

  // Calculate card height from content (max items across pillars), capped
  const maxItems = Math.max(...pillars.slice(0, n).map(p => {
    const items = Array.isArray(p.body) ? p.body : toList(p.body || '');
    return items.length;
  }));
  const itemH = 0.32;  // tight line height for card bullets
  const headerH = 0.7; // circle row + heading
  const cardPad = 0.6;  // top + bottom padding
  const ph = Math.min(BODY_H - 0.2, Math.max(2.4, headerH + maxItems * itemH + cardPad));
  const py = BODY_Y + 0.1;

  const gap = 0.3;
  const pw = (CW - (n - 1) * gap) / n;
  const pillarColors = [th.accent, th.chart[4] || th.accent2, th.chart[3] || th.accent2, th.accent2];
  const shapes = pptx.shapes || {};

  for (let i = 0; i < n; i++) {
    const p = pillars[i];
    const px = ML + i * (pw + gap);
    const color = pillarColors[i % pillarColors.length];

    // Card background (no border)
    slide.addShape('roundRect', {
      x: px, y: py, w: pw, h: ph,
      fill: { color: th.bg },
      line: { width: 0 },
      rectRadius: 0.06,
      shadow: cardShadow(),
    });

    // Left color bar (flush)
    slide.addShape('rect', {
      x: px, y: py, w: 0.06, h: ph,
      fill: { color: color }, line: { width: 0 },
    });

    // Top accent bar (flush)
    slide.addShape('rect', {
      x: px, y: py, w: pw, h: 0.05,
      fill: { color: color }, line: { width: 0 },
    });

    // Icon circle + heading on same row
    const circleD = 0.42;
    const rowY = py + 0.25;
    slide.addShape(shapes.OVAL || 'ellipse', {
      x: px + 0.25, y: rowY,
      w: circleD, h: circleD,
      fill: { color: color }, line: { width: 0 },
    });
    slide.addText(String(i + 1), {
      x: px + 0.25, y: rowY,
      w: circleD, h: circleD,
      fontSize: 14, fontFace: th.bodyFont, color: 'FFFFFF',
      bold: true, align: 'center', valign: 'middle',
    });

    if (p.heading) {
      slide.addText(p.heading, {
        x: px + 0.25 + circleD + 0.15, y: rowY, w: pw - circleD - 0.7, h: circleD,
        fontSize: 13, fontFace: th.titleFont, color: th.primary,
        bold: true, valign: 'middle',
      });
    }

    // Compact bullet items (smaller font, tight spacing for cards)
    const items = Array.isArray(p.body) ? p.body : toList(p.body || '');
    if (items.length > 0) {
      const bulletY = rowY + circleD + 0.15;
      const compactBullets = items.map((item, j) => ({
        text: item,
        options: {
          fontSize: 11, fontFace: th.bodyFont, color: th.body,
          bullet: { code: '25CF', color: color },
          indentLevel: 0,
          paraSpaceBefore: j === 0 ? 0 : 2,
          paraSpaceAfter: 2,
          lineSpacingMultiple: 1.25,
          breakLine: true,
        },
      }));
      slide.addText(compactBullets, {
        x: px + 0.25, y: bulletY, w: pw - 0.5, h: ph - (bulletY - py) - 0.2, valign: 'top',
      });
    }
  }
}

function buildTable(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const headers = sd.headers || [];
  const rows = sd.rows || [];
  if (!headers.length && !rows.length) return;

  const tableData = [];

  // Header row
  if (headers.length) {
    tableData.push(headers.map(h => ({
      text: String(h),
      options: {
        bold: true, color: 'FFFFFF', fontSize: 11,
        fontFace: th.bodyFont, fill: { color: th.accent },
        align: 'left', valign: 'middle',
      },
    })));
  }

  // Data rows
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowFill = i % 2 === 0 ? th.bg : th.lightBg;
    tableData.push(
      (Array.isArray(row) ? row : [row]).map(cell => ({
        text: String(cell ?? ''),
        options: {
          fontSize: 11, fontFace: th.bodyFont, color: th.body,
          fill: { color: rowFill },
          align: 'left', valign: 'middle',
        },
      }))
    );
  }

  if (tableData.length === 0) return;

  const cols = Math.max(...tableData.map(r => r.length));
  const colW = CW / cols;

  slide.addTable(tableData, {
    x: ML, y: BODY_Y, w: CW,
    colW: Array(cols).fill(colW),
    border: { type: 'solid', pt: 0.5, color: th.rule },
    autoPage: false,
  });

  // Optional callout under table
  if (sd.callout) {
    const tableH = 0.45 + rows.length * 0.4;
    const calloutY = BODY_Y + tableH + 0.25;
    if (calloutY < FOOTER_Y - 0.6) {
      slide.addShape('rect', {
        x: ML, y: calloutY, w: CW, h: 0.45,
        fill: { color: th.card },
        line: { width: 0 },
        rectRadius: 0.04,
      });
      slide.addShape('rect', {
        x: ML, y: calloutY, w: 0.06, h: 0.45,
        fill: { color: th.accent }, line: { width: 0 },
      });
      slide.addText(sd.callout, {
        x: ML + 0.3, y: calloutY, w: CW - 0.4, h: 0.45,
        fontSize: 11, fontFace: th.bodyFont, color: th.body,
        valign: 'middle',
      });
    }
  }
}

function buildCallout(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  // Body content (upper part)
  const calloutH = 1.2;
  const bodyH = BODY_H - calloutH - 0.3;
  addBody(slide, th, sd.body, ML, BODY_Y, CW, bodyH);

  // Callout box
  if (sd.callout) {
    const cy = FOOTER_Y - calloutH - 0.15;
    const shapes = pptx.shapes || {};

    // Box background (no border)
    slide.addShape('roundRect', {
      x: ML, y: cy, w: CW, h: calloutH,
      fill: { color: th.card },
      line: { width: 0 },
      rectRadius: 0.06,
    });
    // Left accent bar
    slide.addShape('rect', {
      x: ML, y: cy, w: 0.06, h: calloutH,
      fill: { color: th.accent }, line: { width: 0 },
    });
    // Icon circle
    slide.addShape(shapes.OVAL || 'ellipse', {
      x: ML + 0.3, y: cy + (calloutH - 0.35) / 2,
      w: 0.35, h: 0.35,
      fill: { color: th.accent }, line: { width: 0 },
    });
    slide.addText('!', {
      x: ML + 0.3, y: cy + (calloutH - 0.35) / 2,
      w: 0.35, h: 0.35,
      fontSize: 14, fontFace: th.bodyFont, color: 'FFFFFF',
      bold: true, align: 'center', valign: 'middle',
    });
    // Label
    const label = sd.callout_label || 'KEY INSIGHT';
    slide.addText(label, {
      x: ML + 0.85, y: cy + 0.12, w: CW - 1.0, h: 0.3,
      fontSize: 9, fontFace: th.bodyFont, color: th.chart[4] || th.accent,
      bold: true, valign: 'middle',
    });
    // Callout text
    slide.addText(sd.callout, {
      x: ML + 0.85, y: cy + 0.4, w: CW - 1.0, h: calloutH - 0.55,
      fontSize: BODY_PT, fontFace: th.bodyFont, color: th.body,
      valign: 'top', lineSpacingMultiple: 1.4,
    });
  }
}

function buildFeatureGrid(pptx, sd, th, idx) {
  const bg = getContentBg(sd, th);
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  addTitleBlock(slide, th, sd.title);
  addFooter(slide, th, idx, sd.footer);

  const features = sd.features || [];
  const n = Math.min(features.length, 4);
  if (!n) return;

  const cols = n <= 2 ? n : 2;
  const rows = Math.ceil(n / cols);
  const gapX = 0.35, gapY = 0.3;
  const cardW = (CW - (cols - 1) * gapX) / cols;
  const cardH = (BODY_H - 0.1 - (rows - 1) * gapY) / rows;
  const gridColors = [th.accent, th.accent2, th.chart[3] || th.accent, th.chart[4] || th.accent2];

  for (let i = 0; i < n; i++) {
    const f = features[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fx = ML + col * (cardW + gapX);
    const fy = BODY_Y + 0.05 + row * (cardH + gapY);
    const color = gridColors[i % gridColors.length];

    // Card background (no border)
    slide.addShape('roundRect', {
      x: fx, y: fy, w: cardW, h: cardH,
      fill: { color: th.bg },
      line: { width: 0 },
      rectRadius: 0.06,
      shadow: cardShadow(),
    });

    // Left color bar (flush)
    slide.addShape('rect', {
      x: fx, y: fy, w: 0.06, h: cardH,
      fill: { color: color }, line: { width: 0 },
    });

    // Icon circle
    const shapes = pptx.shapes || {};
    const circleD = 0.4;
    slide.addShape(shapes.OVAL || 'ellipse', {
      x: fx + 0.3, y: fy + 0.3,
      w: circleD, h: circleD,
      fill: { color: color }, line: { width: 0 },
    });
    slide.addText(String(i + 1), {
      x: fx + 0.3, y: fy + 0.3,
      w: circleD, h: circleD,
      fontSize: 14, fontFace: th.bodyFont, color: 'FFFFFF',
      bold: true, align: 'center', valign: 'middle',
    });

    // Heading
    if (f.heading) {
      slide.addText(f.heading, {
        x: fx + 0.9, y: fy + 0.25, w: cardW - 1.15, h: 0.5,
        fontSize: 14, fontFace: th.titleFont, color: th.primary,
        bold: true, valign: 'middle',
      });
    }

    // Body bullets
    const items = Array.isArray(f.body) ? f.body : toList(f.body || '');
    if (items.length > 0) {
      const bh = cardH - 1.0;
      slide.addText(buildBullets(items, th, color), {
        x: fx + 0.3, y: fy + 0.85, w: cardW - 0.55, h: bh, valign: 'top',
      });
    }
  }
}

function buildSplit(pptx, sd, th, idx) {
  const slide = pptx.addSlide();
  slide.background = { color: th.bg };

  // Full-width accent top bar
  slide.addShape('rect', {
    x: 0, y: 0, w: SW, h: 0.06,
    fill: { color: th.accent }, line: { width: 0 },
  });
  addFooter(slide, th, idx, sd.footer);

  const splitX = SW * 0.55;
  const darkW = SW - splitX;

  // Dark right panel
  slide.addShape('rect', {
    x: splitX, y: 0.06, w: darkW, h: SH - 0.06,
    fill: { color: th.darkBg }, line: { width: 0 },
  });

  // Left side title + content
  if (sd.title) {
    slide.addShape('rect', {
      x: ML, y: TITLE_Y, w: 0.06, h: 0.6,
      fill: { color: th.accent }, line: { width: 0 },
    });
    slide.addText(sd.title, {
      x: ML + 0.24, y: TITLE_Y, w: splitX - ML - 0.5, h: TITLE_H,
      fontSize: TITLE_PT, fontFace: th.titleFont, color: th.primary,
      bold: true, valign: 'middle', lineSpacingMultiple: 1.15,
    });
    slide.addShape('line', {
      x: ML, y: RULE_Y, w: splitX - ML - 0.5, h: 0,
      line: { color: th.rule, width: 0.5 },
    });
  }

  // Left body
  const leftCol = sd.left || {};
  const leftHeading = leftCol.heading || '';
  const leftItems = Array.isArray(leftCol.body) ? leftCol.body : toList(leftCol.body || '');
  let ly = BODY_Y;
  if (leftHeading) {
    slide.addText(leftHeading, {
      x: ML, y: ly, w: splitX - ML - 0.5, h: 0.45,
      fontSize: 16, fontFace: th.titleFont, color: th.accent,
      bold: true, valign: 'top',
    });
    ly += 0.55;
  }
  if (leftItems.length > 0) {
    slide.addText(buildBullets(leftItems, th, th.accent), {
      x: ML, y: ly, w: splitX - ML - 0.5, h: FOOTER_Y - ly - 0.3, valign: 'top',
    });
  }

  // Right side content (on dark panel)
  const rightCol = sd.right || {};
  const rightHeading = rightCol.heading || '';
  const rightItems = Array.isArray(rightCol.body) ? rightCol.body : toList(rightCol.body || '');
  const rx = splitX + 0.5;
  const rw = darkW - 1.0;
  let ry = TITLE_Y + 0.1;

  if (rightHeading) {
    slide.addText(rightHeading, {
      x: rx, y: ry, w: rw, h: 0.55,
      fontSize: 18, fontFace: th.titleFont, color: th.accent,
      bold: true, valign: 'middle',
    });
    slide.addShape('line', {
      x: rx, y: ry + 0.6, w: rw, h: 0,
      line: { color: th.accent, width: 2 },
    });
    ry += 0.85;
  }

  if (rightItems.length > 0) {
    const darkBullets = rightItems.map((item, i) => ({
      text: item,
      options: {
        fontSize: BODY_PT, fontFace: th.bodyFont, color: th.darkText,
        bullet: { code: '25CF', color: th.accent },
        indentLevel: 0,
        paraSpaceBefore: i === 0 ? 0 : 4,
        paraSpaceAfter: 6,
        lineSpacingMultiple: 1.45,
        breakLine: true,
      },
    }));
    slide.addText(darkBullets, {
      x: rx, y: ry, w: rw, h: SH - ry - 0.5, valign: 'top',
    });
  }

  // Page number on dark side
  slide.addText(String(idx), {
    x: SW - 1.2, y: FOOTER_Y + 0.06, w: 0.6, h: 0.3,
    fontSize: SMALL_PT, fontFace: th.bodyFont, color: th.darkMuted,
    align: 'right',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDERS map
// ═══════════════════════════════════════════════════════════════════════════

const BUILDERS = {
  title: buildTitle, section: buildSection, content: buildContent,
  two_column: buildTwoColumn, comparison: buildComparison,
  image: buildImage, quote: buildQuote, blank: buildBlank,
  chart: buildChart, process: buildProcess, metric: buildMetric,
  scqa: buildSCQA, agenda: buildAgenda, pillars: buildPillars,
  table: buildTable, callout: buildCallout,
  feature_grid: buildFeatureGrid, split: buildSplit,
};

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf-8'); } catch (e) {
    console.log(jsonErr('INPUT_ERROR', `Failed to read stdin: ${e.message}`)); return;
  }
  if (!raw.trim()) { console.log(jsonErr('INPUT_ERROR', 'No input on stdin')); return; }

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.log(jsonErr('INPUT_ERROR', `Invalid JSON: ${e.message}`)); return;
  }
  if (!data || typeof data !== 'object') {
    console.log(jsonErr('INPUT_ERROR', 'Input must be a JSON object')); return;
  }

  let slides = data.slides;
  if (!Array.isArray(slides) || !slides.length) {
    console.log(jsonErr('VALIDATION_ERROR', "Missing or invalid 'slides' array")); return;
  }
  if (slides.length > MAX_SLIDES) {
    console.log(jsonErr('VALIDATION_ERROR', `Too many slides (${slides.length}). Max ${MAX_SLIDES}.`)); return;
  }

  const tn = data.theme || 'corporate';
  if (!THEMES[tn]) {
    console.log(jsonErr('VALIDATION_ERROR', `Unknown theme '${tn}'. Available: ${Object.keys(THEMES).sort().join(', ')}`)); return;
  }
  const th = THEMES[tn];
  slides = slides.map(normalizeSlide);

  const outDir = data.output_dir || '_output';
  fs.mkdirSync(outDir, { recursive: true });
  const title = data.title || 'presentation';
  const safe = title.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '_') || 'presentation';
  const pptxPath = path.join(outDir, `${safe}.pptx`);

  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'PPTX Composer';
    pptx.title = title;

    let contentIdx = 0;
    for (let i = 0; i < slides.length; i++) {
      const sd = slides[i];
      const ly = sd.layout || 'content';
      const isContentSlide = !['title', 'section', 'blank', 'quote'].includes(ly);
      if (isContentSlide) { sd._contentIdx = contentIdx++; }
      const builder = BUILDERS[ly];
      if (!builder) {
        console.log(jsonErr('VALIDATION_ERROR', `Slide ${i+1}: unknown layout '${ly}'.`)); return;
      }
      try { builder(pptx, sd, th, i + 1); } catch (e) {
        console.log(jsonErr('BUILD_ERROR', `Slide ${i+1} (${ly}): ${e.message}`)); return;
      }
    }

    const buf = await pptx.write({ outputType: 'nodebuffer' });
    fs.writeFileSync(pptxPath, buf);
  } catch (e) {
    console.log(jsonErr('BUILD_ERROR', `PPTX generation failed: ${e.message}`)); return;
  }

  console.log(JSON.stringify({
    success: true, file: pptxPath,
    summary: { slide_count: slides.length, theme: tn, filename: `${safe}.pptx`, engine: 'pptxgenjs' },
  }));
}

main().catch(e => { console.log(jsonErr('RUNTIME_ERROR', e.message)); process.exit(0); });
