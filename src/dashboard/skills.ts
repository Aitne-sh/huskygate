/** @module dashboard/skills — Unified skill discovery, listing, and manifest helpers. */
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  type SkillToolName as CatalogSkillToolName,
  SKILL_NAME_RE,
  createDefaultSkillManifest,
  discoverSkillCatalog,
} from '../skills/catalog.js';

/* ── Skills helpers ── */

export { SKILL_NAME_RE };

export type SkillScope = 'local' | 'project';
export type SkillToolName = CatalogSkillToolName;

export function resolveSkillsDir(
  _tool: SkillToolName,
  scope: SkillScope,
  workdirRoot: string,
): string {
  if (scope === 'local') {
    return join(homedir(), '.huskygate', 'skills');
  }
  return join(workdirRoot, '.huskygate', 'skills');
}

/** Returns the tool-specific SKILL markdown filename. */
export function skillMdFilename(tool: SkillToolName): string {
  return `SKILL.${tool}.md`;
}

export interface SkillEntry {
  tool: SkillToolName;
  scope: SkillScope;
  dirName: string;
  skillPath: string;
  name: string;
  description: string | null;
  frontmatter: Record<string, unknown>;
  bodyPreview: string;
  supportFiles: string[];
  hasErrors: boolean;
}

export function ensureSkillManifestFile(skillDir: string): void {
  const manifestPath = join(skillDir, 'skill.json');
  if (existsSync(manifestPath)) return;
  writeFileSync(
    manifestPath,
    `${JSON.stringify(createDefaultSkillManifest(), null, 2)}\n`,
    'utf-8',
  );
}

export function listSkills(
  tool: SkillToolName,
  scope: SkillScope,
  workdirRoot: string,
): SkillEntry[] {
  return discoverSkillCatalog({
    workdirRoot,
    sourceKinds: [scope],
    tool,
  }).map((entry) => {
    const variant = entry.variants[tool];
    return {
      tool,
      scope,
      dirName: entry.dirName,
      skillPath: join(entry.skillDir, skillMdFilename(tool)),
      name:
        variant && !variant.hasErrors && typeof variant.frontmatter.name === 'string'
          ? variant.frontmatter.name
          : entry.dirName,
      description:
        variant && !variant.hasErrors && typeof variant.frontmatter.description === 'string'
          ? variant.frontmatter.description
          : null,
      frontmatter: variant?.hasErrors ? {} : (variant?.frontmatter ?? {}),
      bodyPreview: variant?.hasErrors ? '' : (variant?.body.trim().slice(0, 200) ?? ''),
      supportFiles: entry.supportFiles,
      hasErrors: Boolean(variant?.hasErrors || entry.hasErrors),
    };
  });
}

/* ── route matching helpers ── */

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function matchSkillDetail(
  pathname: string,
): { tool: string; scope: string; name: string } | null {
  const m = pathname.match(
    /^\/api\/skills\/(claude|gemini|codex)\/(local|project)\/([a-z0-9-]{1,64})$/,
  );
  return m?.[1] && m[2] && m[3] ? { tool: m[1], scope: m[2], name: m[3] } : null;
}

export function matchSkillCreate(pathname: string): { tool: string; scope: string } | null {
  const m = pathname.match(/^\/api\/skills\/(claude|gemini|codex)\/(local|project)$/);
  return m?.[1] && m[2] ? { tool: m[1], scope: m[2] } : null;
}

export function matchSkillFile(
  pathname: string,
): { tool: string; scope: string; name: string; filename: string } | null {
  const m = pathname.match(
    /^\/api\/skills\/(claude|gemini|codex)\/(local|project)\/([a-z0-9-]{1,64})\/files\/(.+)$/,
  );
  if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
  const filename = decodeURIComponentSafe(m[4]);
  if (filename === null) return null;
  return { tool: m[1], scope: m[2], name: m[3], filename };
}
