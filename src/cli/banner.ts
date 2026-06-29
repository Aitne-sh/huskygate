/** @module cli/banner — Terminal banner art and formatted status output for CLI commands. */

// ── ANSI Helpers ──

function useColor(): boolean {
  return !!process.stdout.isTTY && !process.env.NO_COLOR;
}

function ansi(code: string): string {
  return useColor() ? code : '';
}

const C = {
  reset: () => ansi('\x1b[0m'),
  bold: () => ansi('\x1b[1m'),
  dim: () => ansi('\x1b[2m'),
  cyan: () => ansi('\x1b[36m'),
  green: () => ansi('\x1b[32m'),
  yellow: () => ansi('\x1b[33m'),
  gray: () => ansi('\x1b[90m'),
  magenta: () => ansi('\x1b[35m'),
  white: () => ansi('\x1b[97m'),
  blue: () => ansi('\x1b[34m'),
  bgCyan: () => ansi('\x1b[46m'),
  bgBlue: () => ansi('\x1b[44m'),
};

// ── Face Art ──
// Braille art was generated from the project mascot icon (tools removed; original PNG in git history)

/** 16-colour palette for the husky face (indexed 0–f). */
const FACE_PALETTE: [number, number, number][] = [
  [71, 69, 58],
  [130, 119, 103],
  [44, 47, 44],
  [217, 208, 188],
  [21, 11, 5],
  [188, 179, 161],
  [242, 236, 217],
  [77, 78, 69],
  [112, 107, 95],
  [144, 137, 121],
  [101, 96, 79],
  [90, 79, 61],
  [32, 33, 31],
  [167, 155, 137],
  [61, 59, 50],
  [88, 86, 75],
];

/** Per-cell palette index for the face (hex digit → FACE_PALETTE). */
const FACE_COLORS: string[] = [
  '00000000004d000000451',
  '0000000000533c05ec955',
  '0000000000dd9f780a8d31',
  '0000000000faad35939f78',
  '000000000c05355355539c',
  '0000000008566655d66661',
  '000000000a8663589536db',
  '00000000080fd655d36582',
  '000000000ce88533335922',
  '000000001e785afef88900c',
  '00000000ee78953d655fa70',
  '000000001e2af963630fa77',
  '00000000ceffb08ddb727f0',
  '00000000220fa0aba0ee102',
  '000000002220cccc2ece72c4',
  '0000000a5fe7e2cccc2e7299b',
];

/** Husky face as Braille characters (top 16 rows of full mascot). */
const FACE_BRAILLE: string[] = [
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣶⣄⠀⠀⠀⠀⠀⢀⣴⣆',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣆⣀⡀⢀⣠⣾⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡅',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡅',
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇',
  '⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿',
  '⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆',
  '⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄',
];

// ── Pixel Font ──

const GW = 8;
const GH = 12;
const G_GAP = 2;

/** Glyph bitmaps: each row is a byte where bit 7 = leftmost pixel. */
const GLYPH: Record<string, number[]> = {
  H: [0xc3, 0xc3, 0xc3, 0xc3, 0xff, 0xff, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3],
  U: [0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0xc3, 0x7e, 0x3c],
  S: [0x7e, 0xff, 0xc0, 0xc0, 0x7e, 0x7e, 0x03, 0x03, 0x03, 0xff, 0x7e, 0x00],
  K: [0xc3, 0xc6, 0xcc, 0xd8, 0xf0, 0xf8, 0xd8, 0xcc, 0xc6, 0xc3, 0xc3, 0xc3],
  Y: [0xc3, 0xc3, 0x66, 0x66, 0x3c, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
  G: [0x7e, 0xff, 0xc3, 0xc0, 0xc0, 0xcf, 0xcf, 0xc3, 0xc3, 0xc3, 0xff, 0x7e],
  A: [0x18, 0x3c, 0x3c, 0x66, 0x66, 0xc3, 0xff, 0xff, 0xc3, 0xc3, 0xc3, 0xc3],
  T: [0xff, 0xff, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
  E: [0xff, 0xff, 0xc0, 0xc0, 0xfc, 0xfc, 0xc0, 0xc0, 0xc0, 0xc0, 0xff, 0xff],
  B: [0xfe, 0xff, 0xc3, 0xc3, 0xfe, 0xfe, 0xc3, 0xc3, 0xc3, 0xc3, 0xff, 0xfe],
};

/** Braille dot bits indexed by [dx * 4 + dy] for a 2×4 cell. */
const DOT_BITS = [1, 2, 4, 64, 8, 16, 32, 128];

/** Blank Braille codepoint (U+2800). */
const BRAILLE_BLANK = 0x2800;

/**
 * Render a string as large Braille dot-art characters.
 * Each glyph is 8 px wide × 12 px tall → 4 braille cols × 3 braille rows.
 */
function textToBraille(text: string): string[] {
  const chars = [...text];
  const stride = GW + G_GAP;
  const totalPixW = chars.length * GW + Math.max(0, chars.length - 1) * G_GAP;
  const bRows = GH / 4; // 3
  const bCols = Math.ceil(totalPixW / 2);

  const rows: string[] = [];
  for (let br = 0; br < bRows; br++) {
    let row = '';
    for (let bc = 0; bc < bCols; bc++) {
      let code = BRAILLE_BLANK;
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const px = bc * 2 + dx;
          const py = br * 4 + dy;
          if (py >= GH) continue;
          const gi = Math.floor(px / stride);
          const lx = px - gi * stride;
          if (gi >= 0 && gi < chars.length && lx >= 0 && lx < GW) {
            const glyph = GLYPH[chars[gi] ?? ''];
            const bits = glyph?.[py] ?? 0;
            if (bits & (0x80 >>> lx)) {
              code |= DOT_BITS[dx * 4 + dy] ?? 0;
            }
          }
        }
      }
      row += String.fromCodePoint(code);
    }
    rows.push(row);
  }
  return rows;
}

// ── Rendering Helpers ──

/**
 * Render a Braille row with per-cell 24-bit ANSI foreground colour.
 * Groups consecutive cells sharing the same palette index.
 */
function renderColorRow(
  braille: string,
  colors: string,
  palette: [number, number, number][],
): string {
  const chars = [...braille];
  let out = '';
  let j = 0;

  while (j < chars.length) {
    const ch = chars[j] ?? '';
    if ((ch.codePointAt(0) ?? BRAILLE_BLANK) === BRAILLE_BLANK) {
      out += ch;
      j++;
      continue;
    }
    const ci = colors.charAt(j);
    let run = ch;
    let k = j + 1;
    while (k < chars.length && colors.charAt(k) === ci) {
      const next = chars[k] ?? '';
      if ((next.codePointAt(0) ?? BRAILLE_BLANK) === BRAILLE_BLANK) break;
      run += next;
      k++;
    }
    const pi = Number.parseInt(ci, 16);
    const pal = palette[pi] ?? [128, 128, 128];
    out += `\x1b[38;2;${pal[0]};${pal[1]};${pal[2]}m${run}\x1b[0m`;
    j = k;
  }

  return out;
}

/** Gold colour for the dot-art title text. */
const GOLD: [number, number, number] = [183, 143, 81];

/** Warm yellow for the bye-bye banner. */
const WARM_YELLOW: [number, number, number] = [220, 180, 80];

/**
 * Render the banner art: large dot-art text on the left, husky face on the right.
 *
 * Layout (16 rows):
 *   rows 0–3  :  blank left          | face top (ears)
 *   rows 4–6  :  topText (3 rows)    | face
 *   row  7    :  gap                  | face
 *   rows 8–10 :  bottomText (3 rows) | face
 *   rows 11–15:  blank left          | face bottom
 */
function renderHuskyArt(
  topText: string,
  bottomText: string,
  rgb: [number, number, number] = GOLD,
): string {
  const color = useColor();
  const blank = String.fromCodePoint(BRAILLE_BLANK);

  // ── Generate text blocks ──
  const huskyText = textToBraille(topText);
  const gateText = textToBraille(bottomText);
  const textWidth = Math.max(
    huskyText.reduce((m, r) => Math.max(m, [...r].length), 0),
    gateText.reduce((m, r) => Math.max(m, [...r].length), 0),
  );

  // Assemble text block: HUSKY / gap / GATE  (3 + 1 + 3 = 7 rows)
  const textBlock: (string | null)[] = [
    ...huskyText,
    null, // gap row
    ...gateText,
  ];

  // ── Trim common leading blanks from face ──
  const minIndent = FACE_BRAILLE.reduce((m, r) => {
    const cs = [...r];
    const first = cs.findIndex((c) => (c.codePointAt(0) ?? BRAILLE_BLANK) !== BRAILLE_BLANK);
    return first < 0 ? m : Math.min(m, first);
  }, Number.MAX_SAFE_INTEGER);
  const trim = Math.max(0, (minIndent === Number.MAX_SAFE_INTEGER ? 0 : minIndent) - 1);

  // ── Vertically centre text within face height ──
  const faceRows = FACE_BRAILLE.length;
  const textStart = Math.max(0, Math.floor((faceRows - textBlock.length) / 2));

  const lines: string[] = [];
  for (let i = 0; i < faceRows; i++) {
    const ti = i - textStart;
    const textRow = ti >= 0 && ti < textBlock.length ? (textBlock[ti] ?? null) : null;
    const textLen = textRow ? [...textRow].length : 0;
    const pad = Math.max(0, textWidth - textLen);

    // Face row (trimmed)
    const faceBrailleArr = [...(FACE_BRAILLE[i] ?? '')];
    const faceColorsStr = FACE_COLORS[i] ?? '';
    const trimmedBraille = faceBrailleArr.slice(trim).join('');
    const trimmedColors = faceColorsStr.slice(trim);

    if (color) {
      const left = textRow
        ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${textRow}${blank.repeat(pad)}\x1b[0m`
        : blank.repeat(textWidth);
      const right = renderColorRow(trimmedBraille, trimmedColors, FACE_PALETTE);
      lines.push(left + right);
    } else {
      const left = textRow != null ? textRow + blank.repeat(pad) : blank.repeat(textWidth);
      lines.push(left + trimmedBraille);
    }
  }

  return lines.join('\n');
}

// ── Public API ──

/**
 * Full startup banner for `huskygate dashboard` — dot-art title + husky face + version.
 */
export function renderBanner(version: string): string {
  const lines: string[] = [];

  const art = renderHuskyArt('HUSKY', 'GATE', GOLD);
  lines.push('');
  lines.push(
    `  ${C.cyan()}🐾 Welcome to ${C.bold()}HuskyGate${C.reset()}${C.cyan()} Dashboard!${C.reset()}`,
  );
  lines.push('');
  lines.push(art);
  lines.push('');
  lines.push(
    `  ${C.bold()}HuskyGate${C.reset()} ${C.dim()}— Slack Remote LLM CLI Orchestrator${C.reset()}  ${C.cyan()}v${version}${C.reset()}`,
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Farewell banner for `huskygate stop` — husky face with "BYE BYE" dot-art.
 */
export function renderByeBanner(): string {
  const lines: string[] = [];

  const art = renderHuskyArt('BYE', 'BYE', WARM_YELLOW);
  lines.push('');
  lines.push(`  ${C.yellow()}👋 Bye bye!${C.reset()}`);
  lines.push('');
  lines.push(art);
  lines.push('');

  return lines.join('\n');
}

/**
 * Formatted "started" block:
 *   ✓ Server started
 *     PID   1234
 *     Port  3738
 *     To stop:  huskygate server stop
 */
export function formatStarted(
  service: string,
  details: Record<string, string | number>,
  hint?: string,
): string {
  const lines: string[] = [];
  lines.push(`${C.green()}${C.bold()}  ✓ ${service} started${C.reset()}`);
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  if (hint) {
    lines.push('');
    lines.push(`${C.dim()}    To stop → ${C.reset()}${C.cyan()}${hint}${C.reset()}`);
  }
  return lines.join('\n');
}

/**
 * Formatted "stopped" block:
 *   ■ Server stopped  👋 Bye bye!
 *     PID   1234
 *     To restart:  huskygate server start
 */
export function formatStopped(
  service: string,
  details: Record<string, string | number>,
  hint?: string,
): string {
  const lines: string[] = [];
  lines.push(
    `${C.yellow()}${C.bold()}  ■ ${service} stopped${C.reset()}  ${C.dim()}👋 Bye bye!${C.reset()}`,
  );
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  if (hint) {
    lines.push('');
    lines.push(`${C.dim()}    To restart → ${C.reset()}${C.cyan()}${hint}${C.reset()}`);
  }
  return lines.join('\n');
}

/**
 * Status display:
 *   ● Server running       (green)
 *   ○ Server not running   (gray)
 */
export function formatStatus(
  service: string,
  running: boolean,
  details: Record<string, string | number>,
): string {
  const lines: string[] = [];
  if (running) {
    lines.push(`${C.green()}${C.bold()}  ● ${service} running${C.reset()}`);
  } else {
    lines.push(`${C.gray()}  ○ ${service} not running${C.reset()}`);
  }
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  return lines.join('\n');
}

/**
 * Already-running info block:
 *   ● Dashboard already running
 *     PID   4444
 *     URL   http://...
 */
export function formatAlreadyRunning(
  service: string,
  details: Record<string, string | number>,
): string {
  const lines: string[] = [];
  lines.push(`${C.cyan()}${C.bold()}  ● ${service} already running${C.reset()}`);
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  return lines.join('\n');
}

/**
 * Already-running block with actionable hints for resolution:
 *   ⚠ Server already running
 *     PID   1234
 *     → To restart:  huskygate restart
 *     → To force:    huskygate start --force
 */
export function formatAlreadyRunningWithHint(
  service: string,
  details: Record<string, string | number>,
  hints: { restart?: string; force?: string },
): string {
  const lines: string[] = [];
  lines.push(`${C.yellow()}${C.bold()}  ⚠ ${service} already running${C.reset()}`);
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  if (hints.restart) {
    lines.push(`${C.dim()}    → To restart: ${C.reset()}${C.cyan()}${hints.restart}${C.reset()}`);
  }
  if (hints.force) {
    lines.push(`${C.dim()}    → To force:   ${C.reset()}${C.cyan()}${hints.force}${C.reset()}`);
  }
  return lines.join('\n');
}

/**
 * Formatted "restarted" block (force-stopped old + started new):
 *   ↻ Server restarted
 *     PID   1234
 */
export function formatRestarted(
  service: string,
  details: Record<string, string | number>,
  hint?: string,
): string {
  const lines: string[] = [];
  lines.push(`${C.green()}${C.bold()}  ↻ ${service} restarted${C.reset()}`);
  for (const [k, v] of Object.entries(details)) {
    lines.push(`${C.dim()}    ${k.padEnd(8)}${C.reset()}${v}`);
  }
  if (hint) {
    lines.push('');
    lines.push(`${C.dim()}    To stop → ${C.reset()}${C.cyan()}${hint}${C.reset()}`);
  }
  return lines.join('\n');
}

/**
 * Simple "not running" line (for stop commands when nothing to stop).
 */
export function formatNotRunning(service: string): string {
  return `${C.gray()}  ○ ${service} is not running${C.reset()}`;
}

/**
 * Setup-required block shown when daemon cannot start due to missing config.
 *
 *   ⚠ Setup required
 *     Missing:  SLACK_BOT_TOKEN, ALLOWED_USER_IDS
 *     Dashboard started — configure via the web UI, then restart.
 *     Or run:  huskygate setup
 */
export function formatSetupRequired(missingKeys: string[], dashboardUrl?: string): string {
  const lines: string[] = [];
  lines.push(`${C.yellow()}${C.bold()}  ⚠ Setup required${C.reset()}`);
  lines.push(`${C.dim()}    Missing  ${C.reset()}${missingKeys.join(', ')}`);
  lines.push('');
  if (dashboardUrl) {
    lines.push(
      `${C.dim()}    Dashboard started — configure via the web UI, then restart.${C.reset()}`,
    );
    lines.push(`${C.dim()}    URL      ${C.reset()}${C.cyan()}${dashboardUrl}${C.reset()}`);
  }
  lines.push(`${C.dim()}    Or run   ${C.reset()}${C.cyan()}huskygate setup${C.reset()}`);
  lines.push(`${C.dim()}    Then     ${C.reset()}${C.cyan()}huskygate restart${C.reset()}`);
  return lines.join('\n');
}

// ── Overview Table ──

/** Strip ANSI escape sequences to get visual string length. */
function visualLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad a string that may contain ANSI codes to a target visual width. */
function padEndVisual(str: string, width: number): string {
  const diff = width - visualLength(str);
  return diff > 0 ? str + ' '.repeat(diff) : str;
}

/**
 * Bordered overview table using Unicode box-drawing characters.
 *
 *   ┌──────────────┬───────────────────────────────────┐
 *   │ Label        │ Value                             │
 *   │ Label        │ Value                             │
 *   └──────────────┴───────────────────────────────────┘
 */
export function formatOverviewTable(rows: [string, string][], indent = '  '): string {
  if (rows.length === 0) return '';

  const labelW = Math.max(...rows.map(([l]) => l.length));
  const valueW = Math.max(30, ...rows.map(([, v]) => visualLength(v)));

  const d = C.dim();
  const r = C.reset();
  const top = `${indent}${d}┌${'─'.repeat(labelW + 2)}┬${'─'.repeat(valueW + 2)}┐${r}`;
  const bot = `${indent}${d}└${'─'.repeat(labelW + 2)}┴${'─'.repeat(valueW + 2)}┘${r}`;

  const body = rows.map(([label, value]) => {
    const lp = label.padEnd(labelW);
    const vp = padEndVisual(value, valueW);
    return `${indent}${d}│${r} ${lp} ${d}│${r} ${vp} ${d}│${r}`;
  });

  return [top, ...body, bot].join('\n');
}

/** Status indicator: ● running (pid X) or ○ not running. */
export function formatStatusIndicator(running: boolean, pid: number | null): string {
  if (running && pid !== null) {
    return `${C.green()}● running${C.reset()} ${C.dim()}(pid ${pid})${C.reset()}`;
  }
  return `${C.gray()}○ not running${C.reset()}`;
}

/** Compact version header: 🐾 HuskyGate vX.Y.Z */
export function formatVersionHeader(version: string): string {
  return `  ${C.bold()}🐾 HuskyGate${C.reset()} ${C.cyan()}v${version}${C.reset()}`;
}

/** Formatted hint line: To stop → huskygate stop */
export function formatHint(action: string, command: string): string {
  return `${C.dim()}  ${action} → ${C.reset()}${C.cyan()}${command}${C.reset()}`;
}
