---
name: pptx-composer
description: >-
  Create professional PowerPoint presentations (.pptx) from structured JSON
  input. Use when the user asks to create a presentation, slide deck, or PPTX
  file. 7 themes, 17 layouts. Georgia + Calibri fonts. Requires Node.js
  (PptxGenJS). Output is saved to _output/ directory.
disable-model-invocation: true
allowed-tools: Bash(python *), Bash(bash *)
---

# PPTX Composer

Create professional, consulting-quality presentations with a mandatory storytelling workflow.

---

## ⚠️ MANDATORY: Three-Phase Workflow

**NEVER jump straight to writing JSON slides.** Every presentation MUST go through all three phases in order. Skipping phases produces information-dumping slide decks that fail as communication tools.

```
Phase 1: STORY    →  Phase 2: GHOST DECK    →  Phase 3: PRODUCTION
(What to say)        (Slide-by-slide outline)   (JSON + visual design)
```

---

## Phase 1: Create the Story (REQUIRED)

Before any slide design, construct the narrative backbone. A presentation is an ARGUMENT, not a report.

### 1.1 Define the Governing Thought

Every presentation must have exactly ONE governing thought — the single sentence the audience must remember when they leave the room. If you cannot write this sentence, you are not ready to create slides.

**Template**: `[Subject] should [action] because [evidence-based reason]`

| BAD (topic) | GOOD (governing thought) |
|---|---|
| "About our cloud migration" | "We should accelerate cloud migration because it saves $4.8M/year and unlocks AI capabilities" |
| "Q4 Results" | "Q4 exceeded all targets, validating our platform-first strategy" |
| "Market overview" | "Three market shifts create a $2.4B opportunity we must capture in 18 months" |

### 1.2 Apply the SCQA Framework

Structure your argument using **Situation → Complication → Question → Answer**:

| Element | Purpose | Example |
|---------|---------|---------|
| **Situation** | Shared context the audience already agrees with | "We have 3 data centers costing $12M/year" |
| **Complication** | The tension, threat, or change that disrupts the status quo | "Competitors are 40% more agile with cloud-native architectures" |
| **Question** | The implicit question the audience now has | "How do we close this gap before we lose market share?" |
| **Answer** | Your governing thought — the rest of the deck proves this | "Phased cloud migration delivers 40% cost savings and 3x deployment speed" |

The **Answer** is your governing thought. The entire presentation exists to prove it.

### 1.3 Build the Pyramid Structure

Organize supporting arguments using the Pyramid Principle (Barbara Minto):

```
                    Governing Thought
                   (Answer / Main claim)
                  /          |          \
           Key Point 1   Key Point 2   Key Point 3
           /    \          /    \          /    \
       Evidence  Evidence  Evidence  Evidence  Evidence  Evidence
```

Rules:
- **Top-down**: Lead with the answer, then support it — never build up to a conclusion
- **MECE** (Mutually Exclusive, Collectively Exhaustive): Supporting points must not overlap and must fully cover the argument
- **Maximum 3-4 key points**: If you have more, group them into higher-level clusters
- **Each key point must independently support the governing thought**

### 1.4 Apply the "So What?" Test

For EVERY piece of information you plan to include, ask: **"So what? Why does the audience care?"**

If you cannot answer in one sentence, the information does not belong in the deck.

| Information | "So What?" | Include? |
|---|---|---|
| "Revenue was $12.5M" | Proves we exceeded target by 25% | ✅ Yes — with context |
| "We held 47 team meetings" | No impact on the argument | ❌ No |
| "Competitor X launched product Y" | Creates urgency for our strategy pivot | ✅ Yes — as complication |
| "Tech stack uses React and Node" | Audience doesn't care about implementation details | ❌ No (unless tech audience) |

### Phase 1 Output

Write out the following BEFORE moving to Phase 2:

```
GOVERNING THOUGHT: [one sentence]

SCQA:
- Situation: [context]
- Complication: [tension]
- Question: [implicit]
- Answer: [= governing thought]

KEY POINTS:
1. [Key point 1] — supported by [evidence]
2. [Key point 2] — supported by [evidence]
3. [Key point 3] — supported by [evidence]

AUDIENCE: [who] — [what they care about]
TONE: [formal/casual/inspirational/data-driven]
```

---

## Phase 2: Build the Ghost Deck (REQUIRED)

A "Ghost Deck" is a title-only outline — no body content, no design. Its purpose is to validate the storyline before investing in production.

### 2.1 Write Action Titles Only

Create one action title per slide. Each title must:
- Be a **full sentence that states an insight or claim** (not a topic label)
- Pass the "So What?" test
- Connect logically to the previous and next title

| Slide | BAD (topic label) | GOOD (action title) |
|---|---|---|
| 1 | "Executive Summary" | "Phased migration saves $4.8M/year while accelerating delivery 3x" |
| 2 | "Market Overview" | "Three market shifts create a $2.4B opportunity window closing in 18 months" |
| 3 | "Current State" | "Our $12M infrastructure costs 40% more than cloud-native competitors" |
| 4 | "Proposed Solution" | "Three-horizon migration plan delivers value every 6 months" |
| 5 | "Financial Impact" | "ROI turns positive at month 9 with cumulative savings of $14.4M by year 3" |
| 6 | "Risks" | "Three controllable risks require mitigation — none are blockers" |
| 7 | "Next Steps" | "Board approval by March enables Q2 pilot launch" |

### 2.2 The Title Reading Test

**Read ONLY the action titles in sequence.** They must tell a coherent, self-contained story:

> "Phased migration saves $4.8M/year while accelerating delivery 3x. Three market shifts create a $2.4B opportunity window closing in 18 months. Our $12M infrastructure costs 40% more than cloud-native competitors. Three-horizon migration plan delivers value every 6 months. ROI turns positive at month 9 with cumulative savings of $14.4M by year 3. Three controllable risks require mitigation — none are blockers. Board approval by March enables Q2 pilot launch."

Does it flow? Does it build an argument? If not, reorder or remove slides.

### 2.3 Assign Layouts by Message Type

For each slide in your ghost deck, choose the layout that best communicates its message:

| Message Type | Layout | When to Use |
|---|---|---|
| Opening statement | `title` | First slide — sets topic and tone |
| Governing thought / key claim | `content` | Action title + 3-5 supporting bullets |
| Executive summary (SCQA) | `scqa` | Situation/Complication/Resolution with colored bars |
| Agenda / table of contents | `agenda` | Numbered items with descriptions |
| Topic transition | `section` | Signals shift between major argument sections |
| Strategic pillars / features | `pillars` | 2-4 pillar cards with icon circles |
| Content + key insight | `callout` | Bullets + highlighted KEY INSIGHT callout box |
| Structured data | `table` | Styled table with header row |
| Compare options or approaches | `comparison` | Winner vs alternative (left=highlighted) |
| Show two parallel categories | `two_column` | Equal-weight side-by-side |
| Feature/capability showcase | `feature_grid` | 2x2 grid of feature cards with icons and bullets |
| Side-by-side contrast (before/after) | `split` | Left content panel + right dark panel |
| Show a trend over time | `chart` (line) | Time-series data |
| Compare quantities | `chart` (bar) | Cross-category comparison |
| Show composition / share | `chart` (pie/doughnut) | Parts of a whole |
| Show sequential steps | `process` | Implementation roadmap, workflow |
| Highlight KPIs / big numbers | `metric` | 2-4 key metrics with change indicators |
| Show architecture / screenshot | `image` | Visual evidence |
| Emotional punctuation | `quote` | Max 1-2 per deck — use sparingly |
| Closing / CTA | `blank` | Clean ending |

### 2.4 Data Visualization Selection

When your evidence includes data, choose the right visualization:

| Your Message | Chart Type | Example |
|---|---|---|
| "X is bigger/smaller than Y" | `bar` | Revenue by region, feature comparison |
| "X changed over time" | `line` | Monthly growth, quarterly trends |
| "X is what share of the whole" | `pie` / `doughnut` | Market share, budget allocation |
| "X correlates with Y" | `scatter` | Price vs. demand |
| "X happens in this order" | `process` | Implementation phases, workflow |
| "These numbers are important" | `metric` | KPI dashboard, quarterly results |
| "A beats B" | `comparison` | Vendor selection, strategy options |
| "These categories have sub-items" | `two_column` | Pros/cons, features by tier |

**Visualization rules**:
- **One chart, one message**: Never put two different insights in one chart
- **Label directly**: Use clear axis labels and data labels — never rely on legends alone
- **Max 8 data points** per chart: More than 8 becomes noise
- **Sort meaningfully**: Largest to smallest (bar), chronological (line), or logical grouping
- **Round numbers**: $12.5M not $12,487,231. Audiences process round numbers faster

### 2.5 Narrative Arc Templates

Use these proven structures as starting points:

**Recommendation Deck (10-14 slides)**:
```
title → scqa(executive summary) → agenda → section("Context") →
callout(key data + insight) → chart(trends) → section("Recommendation") →
pillars(strategic pillars) → comparison(options) → section("Impact") →
metric(KPIs) → content(risks) → content(next steps) → blank(close)
```

**Status Update (6-8 slides)**:
```
title → metric(KPIs) → callout(key wins + insight) → chart(trends) →
content(blockers) → process(next steps) → blank(close)
```

**Strategy Presentation (10-15 slides)**:
```
title → scqa(executive summary) → agenda → section("Market") → chart(trends) →
callout(complication + insight) → section("Strategy") → pillars(approach) →
table(scenario analysis) → section("Impact") → metric(projections) →
comparison(alternatives) → content(next steps) → blank(close)
```

**Problem-Solution (6-10 slides)**:
```
title → scqa(problem framing) → callout(evidence + insight) →
section("Solution") → process(approach) → comparison(before/after) →
metric(projected impact) → content(next steps) → blank(close)
```

### Phase 2 Output

Write out the ghost deck as a numbered list:

```
GHOST DECK:
1. [title] "Presentation Title" — subtitle
2. [content] "Governing thought as action title"
3. [section] "Context"
4. [chart:bar] "Action title about the data trend"
5. [comparison] "Action title about the recommended option"
...
```

Validate: Read titles in sequence. Does it tell a story? If not, revise before Phase 3.

---

## Phase 3: Produce the Slides

Only after Phase 1 (story) and Phase 2 (ghost deck) are complete, produce the final JSON.

### 3.1 Content Quality Rules

#### One Message Per Slide
Each slide communicates exactly ONE insight. The action title states the insight; the body provides evidence.

#### Titles MUST Be Action Titles
The title of every content slide must be a **full-sentence takeaway** — not a topic label.

| BAD (topic label) | GOOD (action title) |
|----|-----|
| "Revenue Overview" | "Revenue grew 25% YoY driven by enterprise expansion" |
| "Market Analysis" | "Three market shifts create a $2.4B window" |
| "Cloud Migration" | "Cloud migration reduces infrastructure costs by 40%" |
| "Team Structure" | "Cross-functional teams accelerate delivery by 3x" |
| "Risks" | "Three controllable risks require immediate mitigation" |
| "エグゼクティブサマリー" | "クラウド移行で年間4.8億円のコスト削減と開発速度3倍を同時に実現" |
| "市場動向" | "3つの市場変化が18ヶ月以内に24億円の機会を生む" |

#### Bullet Points Must Be Substantive
Each bullet must contain a **complete thought** with specific data.

| BAD | GOOD |
|-----|------|
| "Revenue growth" | "Revenue grew 25% YoY to $12.5M, driven by enterprise segment" |
| "Improve quality" | "Defect rate reduced from 3.2% to 0.8% through automated testing" |
| "コスト削減" | "クラウド移行により年間4.8億円（40%）のインフラコスト削減を実現" |

#### Data Must Be Specific
- "Increased by 25%" not "increased significantly"
- "$4.8M savings" not "significant cost reduction"
- "Q4 2027" not "in the future"
- "3x faster" not "much faster"

#### Source Attribution
Always include `footer` with data sources:
```json
"footer": "Source: Gartner Magic Quadrant 2025, Company internal analysis"
```

### 3.2 Content Length Limits (Anti-Overlap)

Text that exceeds layout boundaries causes overlap. **MUST** follow these limits:

| Element | Max Length |
|---------|-----------|
| Action title | 2 lines / ~80 characters |
| Bullets per slide | 5 bullets (`content`), 4 per card (`two_column`/`comparison`) |
| Single bullet text | ~80 characters — split long points into 2 bullets |
| Process step label | ~15 characters (e.g. "Discovery") |
| Process step description | ~40 characters per step |
| Process steps count | 3–6 steps (>6 overflows) |
| Metric value | ~8 characters (e.g. "$12.5M") |
| Metric label | ~20 characters |
| Metrics count | 2–4 cards |
| Chart labels | ~15 characters each, max 8 data points |
| SCQA section text | ~120 characters per section |
| Agenda items | Max 6 items, title ~40 chars, description ~60 chars |
| Pillar cards | 2–4 pillars, heading ~20 chars, max 4 bullets each |
| Table columns | Max 6 columns, ~15 chars per cell |
| Callout text | ~120 characters |
| Footer text | 1 line / ~80 characters |
| Quote text | ~200 characters (3-4 lines at 22pt) |

**If content is too long**: Split into multiple slides. Two clear slides beat one cluttered slide.

### 3.3 Layout Anti-Patterns (AVOID)

- **DO NOT** use 5+ content slides in a row without a section divider
- **DO NOT** use more than 2 quote slides per presentation
- **DO NOT** put 6+ bullets on a single slide — split across multiple slides
- **DO NOT** use `blank` for content that deserves a proper layout
- **DO NOT** repeat the same layout more than 3 times consecutively
- **DO NOT** use comparison when both options are equally valid — use two_column
- **DO NOT** dump all information available — include only what supports the argument

### 3.4 Theme Selection

Choose theme based on **mood**, not industry stereotype. All themes use white backgrounds with bright pastel card colors. **Content slides automatically alternate** between white and a subtle tinted background (e.g., `F1F5F9` for corporate) — no manual configuration needed.

All themes use **Georgia** (titles) + **Calibri** (body) for consistent professional typography.

| Theme | Text | Accent | Card BG | Dark BG | Best For |
|-------|------|--------|---------|---------|----------|
| `corporate` | Navy #1A2332 | Teal #2E86AB | Blue #E8F1F8 | Navy #0F1923 | **Default** — business, reports, finance |
| `creative` | Stone | Orange #EA580C | Orange #FFEDD5 | Brown #1A1412 | Marketing, pitches |
| `minimal` | Zinc | Dark #27272A | Gray #F4F4F5 | Charcoal #141416 | Data, academic |
| `dark` | Navy | Sky #0EA5E9 | Sky #E0F2FE | Navy #0B1120 | Tech talks, keynotes |
| `nature` | Green | Green #16A34A | Green #DCFCE7 | Forest #0D1A12 | Sustainability, organic |
| `ocean` | Teal | Cyan #0891B2 | Cyan #CFFAFE | Deep #0C1A20 | Maritime, calm |
| `sunset` | Brown | Orange #EA580C | Amber #FEF3C7 | Warm #1A140D | Warm, inviting |

---

## 4. Prerequisites

```bash
SKILL_DIR=$(find . -path '*pptx-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/create_pptx.sh"
bash "$RUNNER" --check
```

## 5. Usage

Write JSON payload to a temp file, then run the script with file redirection.

**IMPORTANT**: Do NOT pipe into a shell variable command (e.g. `| bash "$RUNNER"`). Use file redirection (`< file`) instead.

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
        {"layout": "content", "title": "Revenue grew 25% YoY driven by enterprise expansion", "body": ["Point 1", "Point 2"]}
    ]
}
with open(_payload_path, "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" < "${TMPDIR:-/tmp}/pptx_payload.json"
```

---

## 6. JSON Input Format

### Top-Level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `slides` | Yes | Array of slide objects |
| `title` | No | Presentation title (used for filename) |
| `theme` | No | Theme name (default: "corporate") |
| `output_dir` | No | Output directory (default: "_output") |
| `slide_width` | No | Width in inches (default: 13.333 = widescreen 16:9) |
| `slide_height` | No | Height in inches (default: 7.5) |

### Slide Layouts

#### `title` — Full-screen title slide (dark background)
```json
{"layout": "title", "title": "Presentation Title", "subtitle": "Subtitle or tagline", "company": "Acme Corp"}
```
Optional `company` field adds a company name label to the title slide.

#### `section` — Section divider (dark background)
```json
{"layout": "section", "title": "Section Name", "subtitle": "Optional description", "number": "01"}
```
Optional `number` field adds a large consulting-style section number.

#### `scqa` — Executive summary (Situation / Complication / Resolution)
```json
{
    "layout": "scqa",
    "title": "Revenue growth has stalled, requiring a strategic pivot toward digital",
    "situation": "3% CAGR over 5 years, below industry average of 7%",
    "complication": "Digital competitors capturing share with 40% lower operating costs",
    "resolution": "Three-phase digital transformation targeting $200M incremental revenue"
}
```
Each section gets a distinct colored vertical bar (blue/orange/green). `answer` is accepted as alias for `resolution`.

#### `agenda` — Numbered agenda / table of contents
```json
{
    "layout": "agenda",
    "title": "Agenda",
    "items": [
        {"title": "Market Landscape", "description": "Industry trends and competitive positioning"},
        {"title": "Strategic Options", "description": "Three transformation pathways with NPV analysis"},
        {"title": "Implementation Roadmap", "description": "Phased approach and governance"}
    ]
}
```
Max 6 items. Each item gets a numbered label (01, 02, ...) with divider lines.

#### `pillars` — 2-4 strategic pillar cards with icons
```json
{
    "layout": "pillars",
    "title": "Three strategic pillars drive the transformation",
    "pillars": [
        {"heading": "Digital Expansion", "body": ["E-commerce relaunch", "Mobile-first UX"]},
        {"heading": "Operational Excellence", "body": ["Supply chain digitization", "Demand planning"]},
        {"heading": "Customer Intelligence", "body": ["360° data platform", "AI personalization"]}
    ]
}
```
Each pillar card gets a colored top bar, numbered icon circle, heading, and bullet list.

#### `callout` — Content with KEY INSIGHT highlight box
```json
{
    "layout": "callout",
    "title": "Digital channel penetration doubled industry-wide, yet our share remains at 15%",
    "body": ["Market size $4.2B", "Our share at 15%", "Industry average 42%"],
    "callout": "Closing half the gap generates $100M+ incremental revenue with 28% IRR",
    "callout_label": "KEY INSIGHT"
}
```
`callout_label` defaults to "KEY INSIGHT". The callout box has a colored left bar and icon.

#### `table` — Styled data table with header row
```json
{
    "layout": "table",
    "title": "Scenario analysis shows recommended path delivers strongest return",
    "headers": ["Metric", "Scenario A", "Scenario B", "Scenario C"],
    "rows": [
        ["Investment", "$25M", "$85M", "$150M"],
        ["Revenue Impact", "+$50M", "+$200M", "+$350M"],
        ["IRR", "15%", "28%", "22%"]
    ],
    "callout": "Recommendation: Scenario B provides the best risk-adjusted return"
}
```
Optional `callout` adds a highlighted recommendation bar below the table.

#### `content` — Action title + body (most common layout)
```json
{
    "layout": "content",
    "title": "Cloud migration reduces infrastructure costs by 40% within 18 months",
    "body": [
        "Current on-premise infrastructure costs $12M annually across 3 data centers",
        "Cloud-first approach enables elastic scaling and pay-per-use pricing",
        "Expected savings of $4.8M per year by Q4 2027 (ROI breakeven at 9 months)"
    ],
    "footer": "Source: Internal cost analysis, Q1 2026"
}
```
Body accepts string or array. Newline-delimited strings auto-split into bullets.

#### `two_column` — Side-by-side columns (equal weight)
```json
{
    "layout": "two_column",
    "title": "Both platform tiers serve distinct customer segments profitably",
    "left": {"heading": "Enterprise Tier", "body": ["Dedicated infra", "24/7 support", "Custom SLAs"]},
    "right": {"heading": "Growth Tier", "body": ["Shared infra", "Business-hours support", "Standard SLAs"]}
}
```
Flat-key alternative: `left_title`, `left_body`, `right_title`, `right_body`.

#### `comparison` — Highlighted vs muted (winner vs alternative)
```json
{
    "layout": "comparison",
    "title": "Phased approach outperforms big-bang on risk, cost, and time-to-value",
    "left": {"heading": "Big Bang", "body": ["18-month timeline", "$8M upfront", "High risk"]},
    "right": {"heading": "Phased ★", "body": ["6-month sprints", "$3M per phase", "Controlled risk"]}
}
```

#### `chart` — Native PPTX chart
```json
{
    "layout": "chart",
    "title": "Revenue grew 3x over four quarters driven by enterprise deals",
    "chart_type": "bar",
    "chart_data": [{"name": "Revenue ($M)", "labels": ["Q1","Q2","Q3","Q4"], "values": [1.2,1.8,2.4,3.1]}],
    "footer": "Source: Internal finance data"
}
```
Types: `bar`, `line`, `pie`, `doughnut`, `area`, `scatter`, `radar`. Optional `chart_options` for PptxGenJS overrides.

#### `process` — Horizontal process flow (3-6 steps)
```json
{
    "layout": "process",
    "title": "Four-phase implementation delivers value incrementally",
    "steps": [
        {"label": "Discovery", "description": "Requirements & constraints"},
        {"label": "Design", "description": "Architecture & planning"},
        {"label": "Build", "description": "Iterative development"},
        {"label": "Launch", "description": "Deploy & monitor"}
    ]
}
```

#### `metric` — KPI dashboard (2-4 big numbers)
```json
{
    "layout": "metric",
    "title": "Q4 performance exceeded all targets",
    "metrics": [
        {"value": "$12.5M", "label": "Revenue", "change": "+25%", "description": "YoY growth"},
        {"value": "98.5%", "label": "Uptime", "change": "+0.3%"},
        {"value": "4.8/5", "label": "CSAT", "change": "-0.1"}
    ]
}
```
`change` prefix: `+` = green, otherwise = red.

#### `image` — Image with title and caption
```json
{"layout": "image", "title": "Architecture Diagram", "image_path": "_output/diagram.png", "image_caption": "Figure 1: System overview"}
```

#### `quote` — Dramatic centered quote (max 1-2 per deck)
```json
{"layout": "quote", "quote": "The best way to predict the future is to create it.", "attribution": "Peter Drucker"}
```

#### `feature_grid` — 2x2 feature grid with icon cards
```json
{
    "layout": "feature_grid",
    "title": "Four capabilities differentiate our platform from competitors",
    "features": [
        {"heading": "Real-Time Analytics", "body": ["Sub-second dashboards", "Custom alert thresholds"]},
        {"heading": "AI-Powered Insights", "body": ["Anomaly detection", "Predictive forecasting"]},
        {"heading": "Enterprise Security", "body": ["SOC2 Type II certified", "End-to-end encryption"]},
        {"heading": "Global Scale", "body": ["12 regions worldwide", "99.99% uptime SLA"]}
    ]
}
```
Max 4 features. Each card has a left color bar, icon circle, heading, and bullet list.

#### `split` — Left content panel + right dark panel
```json
{
    "layout": "split",
    "title": "Platform architecture enables rapid feature delivery",
    "left": {"heading": "Current State", "body": "Monolithic architecture with 18-month release cycles and growing technical debt"},
    "right": {"heading": "Target State", "body": "Microservices platform with 2-week sprints and automated deployment pipeline"}
}
```
Left panel has light background with content; right panel uses dark background. `body` accepts string or array.

#### `blank` — Centered content (closing slide, dark background)
```json
{"layout": "blank", "title": "Thank You", "body": "Questions & Discussion\n\ncontact@example.com"}
```

### Common Slide Fields

| Field | Description |
|-------|-------------|
| `notes` | Speaker notes (any layout) |
| `footer` | Source attribution text, left-aligned |
| `bg_color` | Override background color, e.g. `"#1a1a2e"` |

---

## 7. Output JSON

Success:
```json
{"success": true, "file": "_output/filename.pptx", "summary": {"slide_count": 5, "theme": "corporate"}}
```

Error codes: `INPUT_ERROR`, `VALIDATION_ERROR`, `BUILD_ERROR`, `IMPORT_ERROR`, `SCRIPT_NOT_FOUND`, `PYTHON_NOT_FOUND`. Report to user.

---

## 8. Complete Example: Consulting-Quality Deck

### Phase 1 Output (Story)

```
GOVERNING THOUGHT: Phased cloud migration saves $4.8M/year and unlocks AI capabilities,
requiring board approval by March for Q2 pilot.

SCQA:
- Situation: We run 3 data centers costing $12M/year supporting 50M daily requests
- Complication: Competitors are 40% cheaper and 3x faster to deploy; we're losing enterprise deals
- Question: How do we close the cost and agility gap before losing market share?
- Answer: Phased cloud migration delivers 40% cost savings and 3x deployment speed

KEY POINTS:
1. Cost gap is unsustainable — $4.8M/yr more than cloud-native competitors
2. Three-horizon migration plan delivers incremental value every 6 months
3. ROI positive at month 9 with controllable risks

AUDIENCE: Board of Directors — care about ROI, risk, and competitive positioning
TONE: Data-driven, decisive
```

### Phase 2 Output (Ghost Deck)

```
1. [title] "Digital Transformation Strategy" — Prepared for Board of Directors
2. [scqa] "Phased migration saves $4.8M/year while accelerating delivery 3x"
3. [agenda] Agenda — 4 sections
4. [section:01] "The Challenge"
5. [callout] "Our infrastructure costs $4.8M more than competitors" + KEY INSIGHT
6. [chart:bar] "Competitor deployment speed outpaces ours by 3x"
7. [section:02] "The Strategy"
8. [pillars] "Three strategic pillars drive the transformation"
9. [comparison] "Phased approach outperforms big-bang on all key dimensions"
10. [section:03] "The Impact"
11. [table] "Scenario analysis shows recommended path delivers strongest return"
12. [metric] "ROI turns positive at month 9"
13. [content] "Three controllable risks require mitigation — none are blockers"
14. [content] "Board approval by March enables Q2 pilot launch"
15. [blank] "Thank You"
```

### Phase 3 Output (JSON)

```json
{
    "title": "Digital Transformation Strategy",
    "theme": "corporate",
    "slides": [
        {
            "layout": "title",
            "title": "Digital Transformation Strategy",
            "subtitle": "Accelerating Growth Through Cloud-Led Innovation — Board of Directors, March 2026"
        },
        {
            "layout": "content",
            "title": "Phased migration saves $4.8M/year while accelerating delivery 3x",
            "body": [
                "Current infrastructure costs $12M/year — 40% above cloud-native benchmark",
                "Phased approach delivers first value in 6 months with ROI at month 9",
                "Unlocks AI/ML capabilities currently blocked by legacy architecture"
            ],
            "footer": "Source: Internal cost analysis & Gartner Cloud TCO Benchmark 2025"
        },
        {
            "layout": "section",
            "title": "The Challenge",
            "subtitle": "Why maintaining the status quo is no longer viable"
        },
        {
            "layout": "metric",
            "title": "Our infrastructure costs $4.8M more than cloud-native competitors annually",
            "metrics": [
                {"value": "$12M", "label": "Annual Infra Cost", "change": "+8%", "description": "Growing YoY"},
                {"value": "3x", "label": "Deployment Gap", "change": "-", "description": "vs competitors"},
                {"value": "4", "label": "Lost Deals", "change": "-", "description": "Due to speed gap"}
            ],
            "footer": "Source: Finance team analysis, Sales pipeline review Q4 2025"
        },
        {
            "layout": "chart",
            "title": "Competitor deployment speed outpaces ours by 3x across all metrics",
            "chart_type": "bar",
            "chart_data": [
                {"name": "Us", "labels": ["Deploy Time","Scaling","Recovery","Feature Ship"], "values": [48, 12, 8, 90]},
                {"name": "Competitor Avg", "labels": ["Deploy Time","Scaling","Recovery","Feature Ship"], "values": [16, 2, 1.5, 30]}
            ],
            "footer": "Source: DevOps benchmarking study, hours"
        },
        {
            "layout": "section",
            "title": "The Strategy",
            "subtitle": "A phased approach that delivers value every 6 months"
        },
        {
            "layout": "process",
            "title": "Three-horizon migration plan delivers value every 6 months",
            "steps": [
                {"label": "H1: Quick Wins", "description": "Cloud pilot + automation"},
                {"label": "H2: Scale", "description": "Full migration + data platform"},
                {"label": "H3: Transform", "description": "AI ops + new models"}
            ]
        },
        {
            "layout": "comparison",
            "title": "Phased approach outperforms big-bang on risk, cost, and time-to-value",
            "left": {
                "heading": "Big Bang",
                "body": ["18-month implementation", "$8M upfront investment", "No value until completion", "Single point of failure"]
            },
            "right": {
                "heading": "Phased (Recommended)",
                "body": ["6-month value sprints", "$3M per phase ($9M total)", "Value every 6 months", "Controlled risk per phase"]
            }
        },
        {
            "layout": "section",
            "title": "The Impact",
            "subtitle": "ROI positive at month 9 with $14.4M cumulative savings by year 3"
        },
        {
            "layout": "chart",
            "title": "ROI turns positive at month 9 with cumulative savings of $14.4M by year 3",
            "chart_type": "line",
            "chart_data": [
                {"name": "Cumulative Savings ($M)", "labels": ["M3","M6","M9","M12","M18","M24","M36"], "values": [-1.5, -0.8, 0.2, 1.8, 5.2, 9.0, 14.4]}
            ],
            "footer": "Source: Finance projections based on Phase 1 pilot results"
        },
        {
            "layout": "content",
            "title": "Three controllable risks require mitigation — none are blockers",
            "body": [
                "Data migration complexity: Mitigate with parallel-run validation (2-week buffer per phase)",
                "Team skill gaps: 40-hour cloud certification program already funded for Q2",
                "Vendor lock-in: Multi-cloud architecture ensures portability (tested in pilot)"
            ],
            "footer": "Risk assessment reviewed by CTO and VP Engineering"
        },
        {
            "layout": "content",
            "title": "Board approval by March enables Q2 pilot launch on schedule",
            "body": [
                "March: Board approval → April: Team mobilization and cloud account setup",
                "May-June: Phase 1 pilot with 3 non-critical workloads",
                "July: Pilot results review → Go/No-Go for Phase 2 scale-out"
            ]
        },
        {
            "layout": "blank",
            "title": "Thank You",
            "body": "Questions & Discussion"
        }
    ]
}
```

---

## 9. Limits

- Maximum 50 slides per presentation
- Output defaults to `_output/` directory
- Fonts: Calibri, Georgia, Consolas (must be installed on the target machine)

## 10. Platform Notes

### macOS / Linux
```bash
SKILL_DIR=$(find . -path '*pptx-composer/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/create_pptx.sh"
bash "$RUNNER" < "${TMPDIR:-/tmp}/pptx_payload.json"
```

### Windows
```powershell
$SKILL_DIR = Get-ChildItem -Recurse -Filter "create_pptx.ps1" | Select-Object -First 1 | Split-Path -Parent | Split-Path -Parent
$RUNNER = Join-Path $SKILL_DIR "scripts\create_pptx.ps1"
powershell -NoProfile -File $RUNNER < "$env:TEMP\pptx_payload.json"
```
