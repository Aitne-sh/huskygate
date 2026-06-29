/** @module toml — Minimal TOML parser and serializer for MCP server configuration files */
/* ── TOML parser/writer (minimal subset for MCP config) ── */

type TomlValue = string | number | boolean | unknown[] | Record<string, unknown>;

function parseTomlValue(raw: string): TomlValue {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Array
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitTomlArray(inner).map((v) => parseTomlValue(v));
  }

  // Inline table
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return {};
    const result: Record<string, TomlValue> = {};
    for (const pair of splitTomlArray(inner)) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const k = pair
        .slice(0, eqIdx)
        .trim()
        .replace(/^["']|["']$/g, '');
      const v = parseTomlValue(pair.slice(eqIdx + 1));
      result[k] = v;
    }
    return result;
  }

  // Number
  const num = Number(trimmed);
  if (trimmed !== '' && !Number.isNaN(num)) return num;

  // Fallback: bare string
  return trimmed;
}

function splitTomlArray(inner: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  let inStr: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (inStr) {
      current += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

export function parseToml(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentSection: Record<string, unknown> = root;
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header: [section] or [section.subsection]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = (sectionMatch[1] as string).split('.');
      let target = root;
      for (const part of parts) {
        if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) {
          target[part] = {};
        }
        target = target[part] as Record<string, unknown>;
      }
      currentSection = target;
      continue;
    }

    // Key = value
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    currentSection[key] = parseTomlValue(value);
  }

  return root;
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  bearerToken: 'bearer_token',
  bearerTokenEnvVar: 'bearer_token_env_var',
  httpHeaders: 'http_headers',
  envHttpHeaders: 'env_http_headers',
  includeTools: 'enabled_tools',
  excludeTools: 'disabled_tools',
  toolTimeout: 'tool_timeout_sec',
  timeout: 'startup_timeout_sec',
};

function serializeTomlValue(value: TomlValue): string {
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value))
    return `[${value.map((v) => serializeTomlValue(v as TomlValue)).join(', ')}]`;
  // value must be a non-null object at this point (all primitives and arrays handled above)
  const pairs = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${k} = ${serializeTomlValue(v as TomlValue)}`,
  );
  return `{ ${pairs.join(', ')} }`;
}

export function serializeTomlSection(servers: Record<string, Record<string, unknown>>): string {
  const sections: string[] = [];
  for (const [name, def] of Object.entries(servers)) {
    const lines: string[] = [`[mcp_servers.${name}]`];
    for (const [key, value] of Object.entries(def)) {
      if (value === undefined || value === null) continue;
      if (key === 'transport') continue; // internal field, not serialized
      const tomlKey = CAMEL_TO_SNAKE[key] ?? key;
      lines.push(`${tomlKey} = ${serializeTomlValue(value as TomlValue)}`);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

export function updateTomlFile(
  original: string,
  newServers: Record<string, Record<string, unknown>>,
): string {
  const lines = original.split('\n');
  const resultBefore: string[] = [];
  const resultAfter: string[] = [];
  let inMcpSection = false;
  let afterMcp = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      const sectionName = sectionMatch[1] as string;
      if (sectionName.startsWith('mcp_servers')) {
        inMcpSection = true;
        continue;
      }
      if (inMcpSection) {
        inMcpSection = false;
        afterMcp = true;
      }
    }

    if (inMcpSection) continue;

    if (afterMcp) {
      resultAfter.push(line);
    } else {
      resultBefore.push(line);
    }
  }

  const serialized = serializeTomlSection(newServers);
  const parts = [resultBefore.join('\n').trimEnd()];
  if (serialized) parts.push(serialized);
  if (resultAfter.length > 0) parts.push(resultAfter.join('\n').trimStart());

  return `${parts.join('\n\n')}\n`;
}
