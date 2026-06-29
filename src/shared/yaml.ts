/** @module yaml — Minimal YAML frontmatter parser and serializer for skill metadata */
/* ── YAML frontmatter parser (minimal subset for Skills) ── */

function parseYamlValue(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === '' || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Flow-style array [a, b, c] — only if brackets are balanced at position 0
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    // Verify the closing ] is the match for the opening [
    let depth = 0;
    let closingIdx = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          closingIdx = i;
          break;
        }
      }
    }
    if (closingIdx === trimmed.length - 1) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      // Split by comma, respecting quoted strings
      const items: string[] = [];
      let current = '';
      let inQuote: string | null = null;
      for (let j = 0; j < inner.length; j++) {
        const ch = inner[j] as string;
        if (inQuote) {
          current += ch;
          if (ch === inQuote) inQuote = null;
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
          current += ch;
        } else if (ch === ',') {
          items.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
      items.push(current);
      return items.map((item) => {
        const s = item.trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
          return s.slice(1, -1);
        }
        return s;
      });
    }
  }

  // Number
  const num = Number(trimmed);
  if (trimmed !== '' && !Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(trimmed)) return num;

  // Bare string
  return trimmed;
}

export function parseYamlFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: content };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] as string).trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlLines = lines.slice(1, endIdx);
  const fm: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObj: Record<string, unknown> | null = null;
  let currentArr: unknown[] | null = null;
  // Block scalar support (>-, >, |-, |, >+, |+)
  let blockScalarKey: string | null = null;
  let blockScalarFolded = false; // true => folded (>), false => literal (|)
  let blockScalarLines: string[] = [];

  for (const yamlLine of yamlLines) {
    // Skip comments and blank lines (but NOT if collecting block scalar)
    if (blockScalarKey) {
      const indent = yamlLine.length - yamlLine.trimStart().length;
      if (indent >= 2 && yamlLine.trim() !== '') {
        // Continuation of block scalar
        blockScalarLines.push(yamlLine.trim());
        continue;
      }
      // Block scalar ended: commit collected lines
      if (blockScalarFolded) {
        fm[blockScalarKey] = blockScalarLines.join(' ');
      } else {
        fm[blockScalarKey] = blockScalarLines.join('\n');
      }
      blockScalarKey = null;
      blockScalarLines = [];
      // Fall through to process this line normally
    }

    if (yamlLine.trim() === '' || yamlLine.trim().startsWith('#')) continue;

    // Indented line (part of nested object or block array)
    const indent = yamlLine.length - yamlLine.trimStart().length;
    if (indent >= 2 && currentKey) {
      const trimmedLine = yamlLine.trim();
      // Block-style array item: "- value"
      if (trimmedLine.startsWith('- ')) {
        if (!currentArr) {
          currentArr = [];
          fm[currentKey] = currentArr;
          currentObj = null;
        }
        currentArr.push(parseYamlValue(trimmedLine.slice(2)));
        continue;
      }
      // Nested key: "subkey: value"
      const colonIdx = trimmedLine.indexOf(':');
      if (colonIdx !== -1) {
        if (!currentObj) {
          currentObj = {};
          fm[currentKey] = currentObj;
          currentArr = null;
        }
        const subKey = trimmedLine.slice(0, colonIdx).trim();
        const subVal = trimmedLine.slice(colonIdx + 1).trim();
        currentObj[subKey] = subVal ? parseYamlValue(subVal) : null;
        continue;
      }
    }

    // Top-level key: value
    const colonIdx = yamlLine.indexOf(':');
    if (colonIdx === -1) continue;
    const key = yamlLine.slice(0, colonIdx).trim();
    const rawVal = yamlLine.slice(colonIdx + 1).trim();

    currentKey = key;
    currentObj = null;
    currentArr = null;

    if (rawVal) {
      // Detect YAML block scalar indicators: >, >-, >+, |, |-, |+
      if (/^[>|][-+]?$/.test(rawVal)) {
        blockScalarKey = key;
        blockScalarFolded = rawVal.startsWith('>');
        blockScalarLines = [];
      } else {
        fm[key] = parseYamlValue(rawVal);
        currentKey = key; // keep for possible following nested items
      }
    }
    // else: value on next indented lines (nested object or array)
  }

  // Flush any remaining block scalar at end of frontmatter
  if (blockScalarKey) {
    if (blockScalarFolded) {
      fm[blockScalarKey] = blockScalarLines.join(' ');
    } else {
      fm[blockScalarKey] = blockScalarLines.join('\n');
    }
  }

  const body = lines.slice(endIdx + 1).join('\n');
  return { frontmatter: fm, body };
}

export function serializeYamlFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      // Quote if contains special chars
      if (
        value.includes(':') ||
        value.includes('#') ||
        value.includes('"') ||
        value.includes("'")
      ) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (Array.isArray(value)) {
      const items = value.map((v) => {
        if (typeof v === 'string') {
          return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '\\"')}"` : v;
        }
        return String(v);
      });
      lines.push(`${key}: [${items.join(', ')}]`);
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal === undefined || subVal === null) continue;
        if (Array.isArray(subVal)) {
          const subItems = subVal.map((v) => String(v));
          lines.push(`  ${subKey}: [${subItems.join(', ')}]`);
        } else {
          lines.push(`  ${subKey}: ${subVal}`);
        }
      }
    }
  }

  lines.push('---');
  return lines.join('\n');
}
