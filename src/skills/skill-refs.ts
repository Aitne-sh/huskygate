/** @module skills/skill-refs — SkillRef validation and catalog-backed selection rules. */
import type { Config, ToolName } from '../config.js';
import {
  type SkillCatalogEntry,
  type SkillRef,
  discoverSkillCatalog,
  resolveBuiltinSkillCatalogDir,
} from './catalog.js';

const SKILL_REF_RE = /^(builtin|local|project):[a-z0-9-]{1,64}$/;
const DUPLICATE_DIR_NAME_ISSUE = 'duplicate-dir-name';

export interface NormalizeStoredSkillRefsResult {
  skillRefs: SkillRef[] | null;
  valid: boolean;
}

export interface ParseStoredSkillRefsResult extends NormalizeStoredSkillRefsResult {
  normalizedJson: string | null;
}

export interface ValidateSkillRefsResult {
  skillRefs: SkillRef[] | null;
  error?: string;
}

export function isSkillRef(value: string): value is SkillRef {
  return SKILL_REF_RE.test(value);
}

function normalizeStoredSkillRefEntry(value: unknown): SkillRef | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isSkillRef(trimmed) ? trimmed : null;
}

export function normalizeStoredSkillRefs(raw: unknown): NormalizeStoredSkillRefsResult {
  if (raw === undefined || raw === null) {
    return { skillRefs: null, valid: true };
  }
  if (!Array.isArray(raw)) {
    return { skillRefs: null, valid: false };
  }

  const skillRefs: SkillRef[] = [];
  for (const entry of raw) {
    const ref = normalizeStoredSkillRefEntry(entry);
    if (!ref) {
      return { skillRefs: null, valid: false };
    }
    skillRefs.push(ref);
  }
  return { skillRefs, valid: true };
}

export function parseStoredSkillRefs(json: string | null): ParseStoredSkillRefsResult {
  if (json == null) {
    return { skillRefs: null, normalizedJson: null, valid: true };
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    const normalized = normalizeStoredSkillRefs(parsed);
    if (!normalized.valid) {
      return { skillRefs: null, normalizedJson: null, valid: false };
    }
    const canonicalJson = normalized.skillRefs ? JSON.stringify(normalized.skillRefs) : null;
    return {
      ...normalized,
      normalizedJson: canonicalJson !== json ? canonicalJson : null,
    };
  } catch {
    return { skillRefs: null, normalizedJson: null, valid: false };
  }
}

function isSelectableCatalogEntry(entry: SkillCatalogEntry): boolean {
  if (entry.toolVariants.length === 0) return false;
  return !entry.issues.some((issue) => issue.code === DUPLICATE_DIR_NAME_ISSUE);
}

export function validateRequestedSkillRefs(
  raw: unknown,
  catalogEntries: readonly SkillCatalogEntry[],
  fieldName = 'enabled_skills',
): ValidateSkillRefsResult {
  if (raw === undefined || raw === null) {
    return { skillRefs: null };
  }
  if (!Array.isArray(raw)) {
    return { skillRefs: null, error: `${fieldName} must be an array of skill refs` };
  }

  const selectableRefs = new Set(
    catalogEntries
      .filter((entry) => isSelectableCatalogEntry(entry))
      .map((entry) => entry.skillRef),
  );
  const invalid: string[] = [];
  const skillRefs: SkillRef[] = [];

  for (const entry of raw) {
    if (typeof entry !== 'string' || !isSkillRef(entry) || !selectableRefs.has(entry)) {
      invalid.push(String(entry));
      continue;
    }
    skillRefs.push(entry);
  }

  if (invalid.length > 0) {
    return {
      skillRefs: null,
      error: `Invalid skill refs: ${invalid.join(', ')}`,
    };
  }
  return { skillRefs };
}

export function discoverCatalogForSkillValidation(
  config: Pick<Config, 'skillTemplateDir' | 'workdirRoot'>,
  tool?: ToolName,
): SkillCatalogEntry[] {
  return discoverSkillCatalog({
    builtinDir: resolveBuiltinSkillCatalogDir(config.skillTemplateDir),
    workdirRoot: config.workdirRoot,
    sourceKinds: ['builtin', 'local', 'project'],
    tool,
  });
}
