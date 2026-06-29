/** @module skills/catalog — Unified discovery for built-in, local, and project skills. */
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SETTINGS_EDITABLE_KEYS } from '../config/env-registry.js';
import type { ToolName } from '../config/types.js';
import { parseYamlFrontmatter } from '../shared/yaml.js';

export const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;
export const DEFAULT_SKILL_EXCLUDE_DIRS = ['.venv', '__pycache__', '.git', 'node_modules'] as const;

const MANIFEST_FILENAME = 'skill.json';
const SKILL_TOOLS: readonly ToolName[] = ['claude', 'codex', 'gemini'];
const SKILL_VARIANT_RE = /^SKILL\.(claude|codex|gemini)\.md$/;
const DEFAULT_BUILTIN_SKILLS_DIR = 'skills';

/**
 * Resolve the package root by walking up from this file until package.json is found.
 * Works consistently in both dev (src/skills/) and bundled (dist/) contexts.
 */
function resolvePackageSkillsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return join(dir, DEFAULT_BUILTIN_SKILLS_DIR);
    }
    dir = dirname(dir);
  }
  return resolve(DEFAULT_BUILTIN_SKILLS_DIR);
}

const skillManifestSchema = z.object({
  schemaVersion: z.literal(1),
  excludeDirs: z.array(z.string().min(1)).default([...DEFAULT_SKILL_EXCLUDE_DIRS]),
  envVars: z.array(z.string().min(1)).default([]),
});

export type SkillToolName = ToolName;
export type SkillSourceKind = 'builtin' | 'local' | 'project';
export type SkillRef = `${SkillSourceKind}:${string}`;
export type SkillManifestStatus = 'valid' | 'missing' | 'invalid';
export type SkillIssueSeverity = 'warning' | 'error';

export interface SkillManifest {
  schemaVersion: 1;
  excludeDirs: string[];
  envVars: string[];
}

export interface SkillCatalogIssue {
  code:
    | 'manifest-missing'
    | 'manifest-invalid'
    | 'manifest-invalid-env-vars'
    | 'variant-read-failed'
    | 'missing-variants'
    | 'duplicate-dir-name';
  severity: SkillIssueSeverity;
  message: string;
}

export interface SkillVariantDetail {
  tool: SkillToolName;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  hasErrors: boolean;
}

export interface SkillCatalogEntry {
  skillRef: SkillRef;
  dirName: string;
  sourceKind: SkillSourceKind;
  editable: boolean;
  skillDir: string;
  manifest: SkillManifest;
  manifestStatus: SkillManifestStatus;
  toolVariants: SkillToolName[];
  variants: Partial<Record<SkillToolName, SkillVariantDetail>>;
  name: string;
  description: string | null;
  supportFiles: string[];
  issues: SkillCatalogIssue[];
  hasErrors: boolean;
}

export interface DiscoverSkillCatalogOptions {
  builtinDir?: string | null;
  workdirRoot?: string;
  localSkillsDir?: string | null;
  projectSkillsDir?: string | null;
  sourceKinds?: readonly SkillSourceKind[];
  tool?: SkillToolName;
}

export function buildSkillRef(sourceKind: SkillSourceKind, dirName: string): SkillRef {
  return `${sourceKind}:${dirName}`;
}

export function createDefaultSkillManifest(envVars: readonly string[] = []): SkillManifest {
  return {
    schemaVersion: 1,
    excludeDirs: [...DEFAULT_SKILL_EXCLUDE_DIRS],
    envVars: [...envVars],
  };
}

export function resolveBuiltinSkillCatalogDir(explicitDir?: string | null): string | null {
  // When an explicit directory is configured, use it exclusively (no fallbacks).
  if (typeof explicitDir === 'string' && explicitDir.trim()) {
    const dir = resolve(explicitDir.trim());
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
    } catch {
      // Ignore stat failures.
    }
    return null;
  }

  // Auto-discovery: env var → package-relative → CWD-relative
  const candidates: string[] = [];
  if (typeof process.env.SKILL_TEMPLATE_DIR === 'string' && process.env.SKILL_TEMPLATE_DIR.trim()) {
    candidates.push(resolve(process.env.SKILL_TEMPLATE_DIR.trim()));
  }
  candidates.push(resolvePackageSkillsDir());
  candidates.push(resolve(DEFAULT_BUILTIN_SKILLS_DIR));

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {
      // Ignore stat failures and continue to the next candidate.
    }
  }
  return null;
}

function resolveSkillRoots(options: DiscoverSkillCatalogOptions): Array<{
  sourceKind: SkillSourceKind;
  rootDir: string | null;
}> {
  const projectRoot = options.workdirRoot
    ? join(options.workdirRoot, '.huskygate', 'skills')
    : null;
  return [
    {
      sourceKind: 'builtin',
      rootDir:
        options.builtinDir === undefined
          ? resolveBuiltinSkillCatalogDir()
          : (options.builtinDir ?? null),
    },
    {
      sourceKind: 'local',
      rootDir: options.localSkillsDir ?? join(homedir(), '.huskygate', 'skills'),
    },
    { sourceKind: 'project', rootDir: options.projectSkillsDir ?? projectRoot },
  ];
}

function collectSupportFiles(
  dir: string,
  baseDir: string,
  excludeDirs: readonly string[],
): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (excludeDirs.includes(entry)) continue;
    if (entry === MANIFEST_FILENAME || SKILL_VARIANT_RE.test(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        results.push(...collectSupportFiles(fullPath, baseDir, excludeDirs));
      } else if (stat.isFile()) {
        results.push(fullPath.slice(baseDir.length + 1));
      }
    } catch {
      // Ignore unreadable support files; they surface when read directly.
    }
  }

  results.sort((left, right) => left.localeCompare(right));
  return results;
}

function readManifestForSource(
  skillDir: string,
  sourceKind: SkillSourceKind,
): {
  manifest: SkillManifest;
  manifestStatus: SkillManifestStatus;
  issues: SkillCatalogIssue[];
} {
  const manifestPath = join(skillDir, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    return {
      manifest: createDefaultSkillManifest(),
      manifestStatus: 'missing',
      issues: [
        {
          code: 'manifest-missing',
          severity: 'warning',
          message: `${MANIFEST_FILENAME} is missing; using default manifest values.`,
        },
      ],
    };
  }

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const parsed = skillManifestSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return {
        manifest: createDefaultSkillManifest(),
        manifestStatus: 'invalid',
        issues: [
          {
            code: 'manifest-invalid',
            severity: 'error',
            message: `${MANIFEST_FILENAME} does not match schemaVersion=1.`,
          },
        ],
      };
    }

    const issues: SkillCatalogIssue[] = [];
    const requestedEnvVars = [...parsed.data.envVars];
    const allowedEnvVars =
      sourceKind === 'builtin'
        ? requestedEnvVars.filter((key) => SETTINGS_EDITABLE_KEYS.has(key))
        : [];
    const disallowedEnvVars =
      sourceKind === 'builtin'
        ? requestedEnvVars.filter((key) => !SETTINGS_EDITABLE_KEYS.has(key))
        : requestedEnvVars;
    const manifest = createDefaultSkillManifest(allowedEnvVars);
    manifest.excludeDirs = [...parsed.data.excludeDirs];
    if (disallowedEnvVars.length > 0) {
      issues.push({
        code: 'manifest-invalid-env-vars',
        severity: 'error',
        message:
          sourceKind === 'builtin'
            ? `Unsupported envVars in ${MANIFEST_FILENAME}: ${disallowedEnvVars.join(', ')}`
            : `Custom skills may not declare envVars in ${MANIFEST_FILENAME}; ignored: ${disallowedEnvVars.join(', ')}`,
      });
    }

    return {
      manifest,
      manifestStatus: issues.length > 0 ? 'invalid' : 'valid',
      issues,
    };
  } catch {
    return {
      manifest: createDefaultSkillManifest(),
      manifestStatus: 'invalid',
      issues: [
        {
          code: 'manifest-invalid',
          severity: 'error',
          message: `${MANIFEST_FILENAME} is not valid JSON.`,
        },
      ],
    };
  }
}

function readVariant(skillDir: string, tool: SkillToolName): SkillVariantDetail | null {
  const variantPath = join(skillDir, `SKILL.${tool}.md`);
  if (!existsSync(variantPath)) return null;

  try {
    const raw = readFileSync(variantPath, 'utf-8');
    const { frontmatter, body } = parseYamlFrontmatter(raw);
    return {
      tool,
      path: variantPath,
      frontmatter,
      body,
      hasErrors: false,
    };
  } catch {
    return {
      tool,
      path: variantPath,
      frontmatter: {},
      body: '',
      hasErrors: true,
    };
  }
}

function deriveDisplayMetadata(
  dirName: string,
  variants: Partial<Record<SkillToolName, SkillVariantDetail>>,
): { name: string; description: string | null } {
  for (const tool of SKILL_TOOLS) {
    const variant = variants[tool];
    if (!variant || variant.hasErrors) continue;
    const frontmatterName = variant.frontmatter.name;
    const frontmatterDescription = variant.frontmatter.description;
    return {
      name:
        typeof frontmatterName === 'string' && frontmatterName.trim() ? frontmatterName : dirName,
      description:
        typeof frontmatterDescription === 'string' && frontmatterDescription.trim()
          ? frontmatterDescription
          : null,
    };
  }
  return { name: dirName, description: null };
}

function appendDuplicateIssues(entries: SkillCatalogEntry[]): void {
  const byDirName = new Map<string, SkillCatalogEntry[]>();
  for (const entry of entries) {
    const matches = byDirName.get(entry.dirName) ?? [];
    matches.push(entry);
    byDirName.set(entry.dirName, matches);
  }

  for (const [dirName, matches] of byDirName.entries()) {
    if (matches.length < 2) continue;
    const sourceKinds = matches.map((entry) => entry.sourceKind).join(', ');
    for (const entry of matches) {
      entry.issues.push({
        code: 'duplicate-dir-name',
        severity: 'error',
        message: `Duplicate skill dirName '${dirName}' detected across: ${sourceKinds}.`,
      });
      entry.hasErrors = true;
    }
  }
}

export function discoverSkillCatalog(
  options: DiscoverSkillCatalogOptions = {},
): SkillCatalogEntry[] {
  const sourceFilter = new Set(options.sourceKinds ?? ['builtin', 'local', 'project']);
  const entries: SkillCatalogEntry[] = [];

  for (const { sourceKind, rootDir } of resolveSkillRoots(options)) {
    if (!sourceFilter.has(sourceKind)) continue;
    if (!rootDir || !existsSync(rootDir)) continue;

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(rootDir).sort((left, right) => left.localeCompare(right));
    } catch {
      continue;
    }

    for (const dirName of dirEntries) {
      if (!SKILL_NAME_RE.test(dirName)) continue;

      const skillDir = join(rootDir, dirName);
      try {
        const st = lstatSync(skillDir);
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
      } catch {
        continue;
      }

      const { manifest, manifestStatus, issues } = readManifestForSource(skillDir, sourceKind);
      const variants: Partial<Record<SkillToolName, SkillVariantDetail>> = {};
      const toolVariants: SkillToolName[] = [];

      for (const tool of SKILL_TOOLS) {
        const variant = readVariant(skillDir, tool);
        if (!variant) continue;
        variants[tool] = variant;
        toolVariants.push(tool);
        if (variant.hasErrors) {
          issues.push({
            code: 'variant-read-failed',
            severity: 'error',
            message: `SKILL.${tool}.md could not be parsed.`,
          });
        }
      }

      if (toolVariants.length === 0) {
        issues.push({
          code: 'missing-variants',
          severity: 'error',
          message: 'No SKILL.<tool>.md variant was found.',
        });
      }

      const { name, description } = deriveDisplayMetadata(dirName, variants);
      entries.push({
        skillRef: buildSkillRef(sourceKind, dirName),
        dirName,
        sourceKind,
        editable: sourceKind !== 'builtin',
        skillDir,
        manifest,
        manifestStatus,
        toolVariants,
        variants,
        name,
        description,
        supportFiles: collectSupportFiles(skillDir, skillDir, manifest.excludeDirs),
        issues,
        hasErrors: issues.some((issue) => issue.severity === 'error'),
      });
    }
  }

  appendDuplicateIssues(entries);

  const filtered = options.tool
    ? entries.filter((entry) => entry.toolVariants.includes(options.tool as SkillToolName))
    : entries;

  const sourceOrder: Record<SkillSourceKind, number> = { builtin: 0, local: 1, project: 2 };
  filtered.sort((left, right) => {
    const sourceDelta = sourceOrder[left.sourceKind] - sourceOrder[right.sourceKind];
    if (sourceDelta !== 0) return sourceDelta;
    return left.dirName.localeCompare(right.dirName);
  });

  return filtered;
}

export function findSkillCatalogEntry(
  options: DiscoverSkillCatalogOptions,
  sourceKind: SkillSourceKind,
  dirName: string,
): SkillCatalogEntry | null {
  return (
    discoverSkillCatalog({
      ...options,
      sourceKinds: [sourceKind],
    }).find((entry) => entry.dirName === dirName) ?? null
  );
}
