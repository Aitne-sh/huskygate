/** @module mcp-config — MCP server secret masking and unmasking for dashboard display */
import { MASK } from './env.js';

/* ── MCP secret masking helpers used by dashboard MCP routes ── */

const MCP_SENSITIVE_RE = /TOKEN|KEY|SECRET|PASSWORD|API/i;
const MCP_HEADER_SENSITIVE_RE = /^(?:authorization|proxy-authorization|cookie|set-cookie)$/i;
const MCP_HEADER_SENSITIVE_FRAGMENT_RE = /(?:^|[-_])(token|key|secret|password)(?:$|[-_])/i;
const MCP_ENV_CONTAINER_KEYS = new Set(['env']);
const MCP_HEADER_CONTAINER_KEYS = new Set(['headers', 'httpHeaders', 'http_headers']);
const MCP_OBJECT_CONTAINER_KEYS = new Set([
  'env',
  'headers',
  'httpHeaders',
  'http_headers',
  'oauth',
]);
const MCP_SENSITIVE_FIELDS = new Set([
  'bearer_token',
  'client_secret',
  'bearerToken',
  'clientSecret',
]);

export function maskMcpSecrets(
  obj: Record<string, unknown>,
  parentKey?: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      MCP_SENSITIVE_FIELDS.has(key) ||
      (parentKey !== undefined &&
        MCP_ENV_CONTAINER_KEYS.has(parentKey) &&
        MCP_SENSITIVE_RE.test(key)) ||
      (parentKey !== undefined &&
        MCP_HEADER_CONTAINER_KEYS.has(parentKey) &&
        (MCP_HEADER_SENSITIVE_RE.test(key) || MCP_HEADER_SENSITIVE_FRAGMENT_RE.test(key)))
    ) {
      result[key] = typeof value === 'string' ? MASK : value;
    } else if (
      MCP_OBJECT_CONTAINER_KEYS.has(key) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = maskMcpSecrets(value as Record<string, unknown>, key);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function unmaskMcpSecrets(
  updated: Record<string, unknown>,
  existing: Record<string, unknown>,
  path: string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updated)) {
    const nextPath = [...path, key];
    if (value === MASK) {
      if (existing[key] !== undefined) {
        result[key] = existing[key];
      } else {
        throw new Error(
          `Invalid masked secret for "${nextPath.join('.')}": no existing value to restore`,
        );
      }
    } else if (
      MCP_OBJECT_CONTAINER_KEYS.has(key) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[key] = unmaskMcpSecrets(
        value as Record<string, unknown>,
        typeof existing[key] === 'object' && existing[key] !== null
          ? (existing[key] as Record<string, unknown>)
          : {},
        nextPath,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
