---
name: pptx-composer
description: >-
  Create professional PowerPoint presentations (.pptx) from structured JSON
  input. 7 themes, 17 layouts. Georgia (title) + Calibri (body). Output saved to _output/.
disable-model-invocation: true
allowed-tools: Bash(python *), Bash(bash *)
---

# PPTX Composer

Create professional presentations with mandatory storytelling workflow.

## ⚠️ MANDATORY Three-Phase Workflow

**NEVER jump straight to JSON.** Every presentation MUST follow:

```
Phase 1: STORY → Phase 2: GHOST DECK → Phase 3: PRODUCTION
```

### Phase 1: Create the Story
1. **Governing Thought**: Write ONE sentence the audience must remember.
   - Template: `[Subject] should [action] because [evidence-based reason]`
2. **SCQA**: Situation → Complication → Question → Answer (= governing thought)
3. **Pyramid**: Answer first, then 3 key points, each with evidence. Top-down, not build-up.
4. **"So What?" Test**: Every piece of info must answer "why does the audience care?" If it can't, cut it.

### Phase 2: Ghost Deck (Title-Only Outline)
1. Write ONE action title per slide (full-sentence insight, NOT topic label)
   - BAD: "Revenue Overview" → GOOD: "Revenue grew 25% YoY driven by enterprise expansion"
2. **Title Reading Test**: Read only titles in sequence — must tell coherent story
3. Assign layouts by message type:
   - Trend → `chart` (line) | Comparison → `chart` (bar) or `comparison` | Share → `chart` (pie)
   - Steps → `process` | KPIs → `metric` | Parallel categories → `two_column`

### Phase 3: Production
- One message per slide. Action title + evidence body.
- Max 5 bullets per slide. Max ~80 chars per title.
- Include `footer` with sources. Use specific data (not "significant growth").
- Don't use 5+ content slides in a row. Max 2 quote slides per deck.

## Design Rules
1. **Action titles**: Full-sentence takeaway on every content slide.
2. **Substantive bullets**: Complete thoughts with specific data.
3. **Layout variety**: Use section dividers. Max 2 quotes. Max 5 bullets.
4. **Theme**: Match mood, not industry. All themes are white-based with pastel cards.

Available themes: corporate (default — consulting style), creative, minimal, dark, nature, ocean, sunset.
All themes use Georgia (titles) + Calibri (body) for font consistency.

## Prerequisites

```bash
SKILL_DIR=$(find . -path '*pptx-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/create_pptx.sh"
bash "$RUNNER" --check
```

## Usage

**IMPORTANT**: Do NOT use heredoc (`<< EOF`). Use `python3 -c` to write JSON. Do NOT pipe into a shell variable command. Use file redirection (`< file`) instead.

```bash
SKILL_DIR=$(find . -path '*pptx-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/create_pptx.sh"

python3 -c '
import json, os
_payload_path = os.path.join(os.environ.get('TMPDIR', '/tmp'), "pptx_payload.json")
payload = {
    "title": "My Presentation",
    "theme": "corporate",
    "slides": [
        {"layout": "title", "title": "Welcome", "subtitle": "A beautiful presentation"},
        {"layout": "content", "title": "Key metric improved 25% this quarter", "body": ["Point 1", "Point 2"]}
    ]
}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < "${TMPDIR:-/tmp}/pptx_payload.json"
```

## JSON Input

| Field | Required | Description |
|-------|----------|-------------|
| `slides` | Yes | Array of slide objects |
| `title` | No | Presentation title (used for filename) |
| `theme` | No | Theme name (default: "corporate") |
| `output_dir` | No | Output directory (default: "_output") |

### Slide Layouts

- `title` — Title slide (`title`, `subtitle`, optional `company`)
- `section` — Section divider (`title`, `subtitle`, optional `number`)
- `scqa` — Executive summary (`title`, `situation`, `complication`, `resolution`)
- `agenda` — Numbered items (`title`, `items`: [{title, description}], max 6)
- `content` — Action title + bullet list (`title`, `body` as string or array)
- `pillars` — 2-4 pillar cards (`title`, `pillars`: [{heading, body}])
- `callout` — Content + insight box (`title`, `body`, `callout`, `callout_label`)
- `table` — Styled table (`title`, `headers`, `rows`, optional `callout`)
- `two_column` — Side-by-side (`title`, `left`/`right` with `heading` + `body`)
- `comparison` — Highlighted vs muted columns (same as two_column)
- `feature_grid` — 2x2 feature grid with icon cards (`title`, `features`: [{heading, body}], max 4)
- `split` — Left content panel + right dark panel (`title`, `left`/`right` with `heading` + `body`)
- `chart` — Native PPTX chart (`title`, `chart_type`: bar/line/pie/doughnut/area, `chart_data`: [{name, labels, values}], optional `chart_options`)
- `process` — Horizontal process flow (`title`, `steps`: [{label, description}], max 6 steps)
- `metric` — KPI dashboard (`title`, `metrics`: [{value, label, change, description}], 2-4 cards)
- `image` — Image display (`title`, `image_path`, `image_caption`)
- `quote` — Centered quote (`quote`, `attribution` or `source`)
- `blank` — Centered content or empty (`title`, `body`, `bg_color`)

Content slides auto-alternate between white and a subtle tinted background.

### Common Fields

All slides: `notes` (speaker notes), `footer` (source text), `bg_color` (override background).
String body with `\n` auto-splits into bullet list. `left_title`/`left_body` flat keys accepted for columns.

## Output JSON

```json
{"success": true, "file": "_output/filename.pptx", "summary": {"slide_count": 5, "theme": "corporate"}}
```

## Error Codes

- `INPUT_ERROR` — Invalid JSON. Fix payload.
- `VALIDATION_ERROR` — Missing fields or invalid values.
- `BUILD_ERROR` — Failed to build slide. Report to user.
- `IMPORT_ERROR` — python-pptx not installed.

## Limits

- Maximum 50 slides per presentation

## Platform

### macOS / Linux
```bash
bash "$RUNNER" < "${TMPDIR:-/tmp}/pptx_payload.json"
```

### Windows
```powershell
powershell -NoProfile -File $RUNNER < "$env:TEMP\pptx_payload.json"
```
