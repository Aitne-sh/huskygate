/** @module dashboard/routes/skills — Dashboard API routes for unified skill catalog and custom skill CRUD. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, relative } from 'node:path';
import { SENSITIVE_VALUE_MASK, isSensitiveKey } from '../../config.js';
import {
  type SkillCatalogEntry,
  type SkillSourceKind,
  buildSkillRef,
  discoverSkillCatalog,
  findSkillCatalogEntry,
} from '../../skills/catalog.js';
import type { SkillEnablementStore } from '../../store/skill-enablement.js';
import { errorMessage } from '../../utils/error.js';
import {
  prepareFilePathWithinRoot,
  readTextFileWithinRoot,
  removeExistingFileWithinRoot,
  resolveExistingPathWithinRoot,
  writeTextFileWithinRoot,
} from '../../utils/path-security.js';
import { json, parseJson, readBody } from '../http.js';
import type { RouteContext } from '../route-context.js';
import {
  type SettingPatch,
  applySettingsPatches,
  createDashboardResolver,
} from '../settings-service.js';
import {
  SKILL_NAME_RE,
  type SkillEntry,
  type SkillScope,
  type SkillToolName,
  ensureSkillManifestFile,
  listSkills,
  matchSkillCreate,
  matchSkillDetail,
  matchSkillFile,
  resolveSkillsDir,
} from '../skills.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../../shared/yaml.js';

const MCP_TOOL_NAMES: ReadonlySet<string> = new Set(['claude', 'gemini', 'codex']);
const ALL_TOOLS: readonly SkillToolName[] = ['claude', 'gemini', 'codex'];
const SKILL_SOURCE_QUERY_VALUES = new Set(['all', 'builtin', 'local', 'project']);
const SKILL_VARIANT_FILE_RE = /^SKILL\.(claude|gemini|codex)\.md$/i;

interface ResolvedSettingValue {
  value: string;
  masked: boolean;
  hasValue: boolean;
}

function decodeURIComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Validate script filenames for path-traversal / injection. Returns false (and sends 400) on failure. */
function validateScriptFiles(
  scripts: Array<{ filename: string; content: string }> | undefined,
  res: ServerResponse,
): boolean {
  if (!scripts?.length) return true;
  for (const script of scripts) {
    if (
      !script.filename ||
      script.filename.includes('/') ||
      script.filename.includes('\\') ||
      script.filename.includes('..') ||
      script.filename.includes('\0')
    ) {
      json(res, 400, { error: `Invalid script filename: ${script.filename ?? ''}` });
      return false;
    }
    if (typeof script.content !== 'string') {
      json(res, 400, { error: 'Script content must be a string' });
      return false;
    }
  }
  return true;
}

function findCrossSourceSkillConflict(
  ctx: RouteContext,
  dirName: string,
  allowedSourceKind: SkillSourceKind,
) {
  return (
    discoverSkillCatalog({
      workdirRoot: ctx.workdirRoot,
    }).find((entry) => entry.dirName === dirName && entry.sourceKind !== allowedSourceKind) ?? null
  );
}

/** Write SKILL.<tool>.md (frontmatter + body) into skillDir, creating the directory if needed. */
function writeSkillMd(
  skillDir: string,
  data: { frontmatter?: Record<string, unknown>; body?: string },
  tool: SkillToolName,
): void {
  mkdirSync(skillDir, { recursive: true });
  const fm = data.frontmatter ?? {};
  const fmStr = Object.keys(fm).length > 0 ? `${serializeYamlFrontmatter(fm)}\n` : '';
  writeFileSync(join(skillDir, `SKILL.${tool}.md`), fmStr + (data.body ?? ''), 'utf-8');
}

/** Write/remove requirements.txt and script files in a skill directory. */
function syncSupportFiles(
  skillDir: string,
  requirements: string | null | undefined,
  scripts: Array<{ filename: string; content: string }> | undefined,
): void {
  if (requirements !== undefined) {
    const rPath = join(skillDir, 'requirements.txt');
    if (requirements) {
      writeFileSync(rPath, requirements, 'utf-8');
    } else if (existsSync(rPath)) {
      unlinkSync(rPath);
    }
  }
  if (scripts?.length) {
    const sDir = join(skillDir, 'scripts');
    mkdirSync(sDir, { recursive: true });
    for (const script of scripts) {
      const scriptPath = join(sDir, script.filename);
      writeFileSync(scriptPath, script.content, 'utf-8');
      try {
        chmodSync(scriptPath, 0o755);
      } catch {
        /* non-critical on Windows NTFS */
      }
    }
  }
}

async function buildSkillSettingLookup(
  ctx: RouteContext,
  keys: readonly string[],
): Promise<ReadonlyMap<string, ResolvedSettingValue>> {
  const uniqueKeys = [...new Set(keys)];
  const { resolver } = await createDashboardResolver(ctx.getDb().config, ctx.dataDir, uniqueKeys);
  const settings = new Map<string, ResolvedSettingValue>();
  for (const key of uniqueKeys) {
    const resolved = resolver.get(key);
    const hasValue = typeof resolved.value === 'string' && resolved.value.trim().length > 0;
    const masked = isSensitiveKey(key) && hasValue;
    settings.set(key, {
      value: masked ? SENSITIVE_VALUE_MASK : (resolved.value ?? ''),
      masked,
      hasValue,
    });
  }
  return settings;
}

function collectCatalogEnvKeys(entries: readonly SkillCatalogEntry[]): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    for (const key of entry.manifest.envVars) {
      keys.add(key);
    }
  }
  return [...keys];
}

function resolveCatalogEntry(
  ctx: RouteContext,
  sourceKind: SkillSourceKind,
  dirName: string,
): SkillCatalogEntry | null {
  return findSkillCatalogEntry(
    {
      workdirRoot: ctx.workdirRoot,
    },
    sourceKind,
    dirName,
  );
}

function resolveEnabledByDriver(
  entry: SkillCatalogEntry,
  _settings: ReadonlyMap<string, ResolvedSettingValue>,
  skillEnablementStore?: Pick<SkillEnablementStore, 'getEnabled'>,
): Record<string, boolean> {
  const enabledByDriver: Record<string, boolean> = {};

  for (const driver of ALL_TOOLS) {
    const explicit = skillEnablementStore?.getEnabled(entry.skillRef, driver);
    if (explicit === null || explicit === undefined) {
      enabledByDriver[driver] = entry.sourceKind !== 'builtin';
    } else {
      enabledByDriver[driver] = explicit;
    }
  }

  return enabledByDriver;
}

function buildSkillEnvVarValues(
  keys: readonly string[],
  settings: ReadonlyMap<string, ResolvedSettingValue>,
) {
  return keys.map((key) => ({
    key,
    value: settings.get(key)?.value ?? '',
    masked: settings.get(key)?.masked ?? false,
    hasValue: settings.get(key)?.hasValue ?? false,
  }));
}

function buildUnifiedSkillListEntry(
  entry: SkillCatalogEntry,
  settings: ReadonlyMap<string, ResolvedSettingValue>,
  skillEnablementStore?: Pick<SkillEnablementStore, 'getEnabled'>,
) {
  return {
    skillRef: entry.skillRef,
    dirName: entry.dirName,
    sourceKind: entry.sourceKind,
    editable: entry.editable,
    toolVariants: entry.toolVariants,
    name: entry.name,
    description: entry.description,
    supportFiles: entry.supportFiles,
    excludeDirs: entry.manifest.excludeDirs,
    envVars: entry.manifest.envVars,
    manifestStatus: entry.manifestStatus,
    hasErrors: entry.hasErrors,
    issues: entry.issues,
    enabledByDriver: resolveEnabledByDriver(entry, settings, skillEnablementStore),
  };
}

function buildSupportFileDetails(entry: SkillCatalogEntry) {
  return entry.supportFiles.map((relativePath) => {
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(join(entry.skillDir, relativePath)).size;
    } catch {
      // Keep 0 when the support file becomes unreadable between discovery and detail fetch.
    }
    return { path: relativePath, sizeBytes };
  });
}

function normalizeSkillRelativePath(skillDir: string, stableFilePath: string): string {
  const stableSkillDir = resolveExistingPathWithinRoot(skillDir, skillDir);
  return relative(stableSkillDir, stableFilePath).replaceAll('\\', '/');
}

function isReservedSkillFilePath(relativePath: string): boolean {
  return relativePath === 'skill.json' || SKILL_VARIANT_FILE_RE.test(relativePath);
}

async function buildUnifiedSkillDetail(ctx: RouteContext, entry: SkillCatalogEntry) {
  const settings = await buildSkillSettingLookup(ctx, entry.manifest.envVars);
  const variants = Object.fromEntries(
    ALL_TOOLS.flatMap((tool) => {
      const variant = entry.variants[tool];
      if (!variant) return [];
      return [
        [
          tool,
          {
            frontmatter: variant.frontmatter,
            body: variant.body,
            hasErrors: variant.hasErrors,
          },
        ],
      ];
    }),
  );

  return {
    ...buildUnifiedSkillListEntry(entry, settings, ctx.getDb().skillEnablement),
    variants,
    supportFiles: buildSupportFileDetails(entry),
    envVars: buildSkillEnvVarValues(entry.manifest.envVars, settings),
  };
}

function readCatalogSkillFile(
  entry: SkillCatalogEntry,
  filepath: string,
): { filename: string; content: string; sizeBytes: number } | null {
  let skillDir: string;
  let stableFilePath: string;
  try {
    skillDir = resolveExistingPathWithinRoot(entry.skillDir, entry.skillDir);
    stableFilePath = resolveExistingPathWithinRoot(skillDir, join(skillDir, filepath));
  } catch {
    return null;
  }
  try {
    const content = readTextFileWithinRoot(skillDir, stableFilePath);
    return { filename: filepath, content, sizeBytes: Buffer.byteLength(content, 'utf-8') };
  } catch {
    return null;
  }
}

async function handleSkillToggleRequest(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  entry: SkillCatalogEntry,
): Promise<void> {
  const body = await readBody(req);
  const parsed = parseJson<{ enabled?: boolean; driver?: string }>(body);
  if (!parsed) {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (typeof parsed.enabled !== 'boolean') {
    json(res, 400, { error: 'enabled (boolean) required' });
    return;
  }
  const driver = parsed.driver;
  if (!driver || !['claude', 'codex', 'gemini'].includes(driver)) {
    json(res, 400, { error: 'driver (claude|codex|gemini) required' });
    return;
  }
  if (!entry.toolVariants.includes(driver as SkillToolName)) {
    json(res, 400, { error: `driver '${driver}' is not available for this skill` });
    return;
  }
  ctx.getDb().skillEnablement.set(entry.skillRef, driver as SkillToolName, parsed.enabled);
  json(res, 200, {
    success: true,
    requiresRestart: false,
  });
}

async function handleSkillEnvRequest(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  entry: SkillCatalogEntry,
): Promise<void> {
  if (req.method === 'GET') {
    if (entry.manifest.envVars.length === 0) {
      json(res, 200, { envVars: [] });
      return;
    }
    const settings = await buildSkillSettingLookup(ctx, entry.manifest.envVars);
    json(res, 200, { envVars: buildSkillEnvVarValues(entry.manifest.envVars, settings) });
    return;
  }

  if (entry.manifest.envVars.length === 0) {
    json(res, 400, { error: 'This skill has no configurable env vars' });
    return;
  }
  const body = await readBody(req);
  const parsed = parseJson<{ envVars?: Record<string, string> }>(body);
  if (!parsed) {
    json(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (!parsed.envVars || typeof parsed.envVars !== 'object') {
    json(res, 400, { error: 'envVars (object) required' });
    return;
  }

  const allowedKeys = new Set(entry.manifest.envVars);
  const patches: SettingPatch[] = [];
  for (const [key, value] of Object.entries(parsed.envVars)) {
    if (!allowedKeys.has(key)) {
      json(res, 400, { error: `Key '${key}' is not allowed for this skill` });
      return;
    }
    if (typeof value !== 'string') {
      json(res, 400, { error: `Value for '${key}' must be a string` });
      return;
    }
    if (isSensitiveKey(key) && value === SENSITIVE_VALUE_MASK) {
      patches.push({ key, op: 'noop' });
    } else if (value.length === 0) {
      patches.push({ key, op: 'clear' });
    } else {
      patches.push({ key, op: 'set', value });
    }
  }

  let result: Awaited<ReturnType<typeof applySettingsPatches>>;
  try {
    result = await applySettingsPatches(ctx.getDb().config, patches);
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  let unappliedRuntimeKeys: string[] = [];
  if (Object.keys(result.runtimeValues).length > 0) {
    const hotResult = await ctx.proxyToServerApi(
      'POST',
      '/api/settings/apply',
      JSON.stringify({ values: result.runtimeValues }),
    );
    if (hotResult.status === 200) {
      const data = hotResult.data as { applied?: string[] };
      const applied = Array.isArray(data.applied) ? data.applied : [];
      unappliedRuntimeKeys = Object.keys(result.runtimeValues).filter(
        (key) => !applied.includes(key),
      );
    } else {
      unappliedRuntimeKeys = Object.keys(result.runtimeValues);
    }
  }
  json(res, 200, {
    success: true,
    requiresRestart: result.requiresRestart.length > 0 || unappliedRuntimeKeys.length > 0,
  });
}

export async function handleSkillRoutes(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  /* ── Skills List ── */

  // GET /api/skills/catalog?tool=xxx&source=xxx
  if (req.method === 'GET' && pathname === '/api/skills/catalog') {
    const tool = query.get('tool');
    const source = query.get('source');
    if (tool && !MCP_TOOL_NAMES.has(tool)) {
      json(res, 400, { error: 'tool must be claude, gemini, or codex' });
      return true;
    }
    if (source && source !== 'builtin' && source !== 'local' && source !== 'project') {
      json(res, 400, { error: 'source must be builtin, local, or project' });
      return true;
    }

    const catalog = discoverSkillCatalog({
      workdirRoot: ctx.workdirRoot,
      sourceKinds: source ? [source as SkillSourceKind] : undefined,
      tool: tool ? (tool as SkillToolName) : undefined,
    }).map((entry) => ({
      skillRef: entry.skillRef,
      dirName: entry.dirName,
      sourceKind: entry.sourceKind,
      editable: entry.editable,
      toolVariants: entry.toolVariants,
      name: entry.name,
      description: entry.description,
      supportFiles: entry.supportFiles,
      excludeDirs: entry.manifest.excludeDirs,
      envVars: entry.manifest.envVars,
      manifestStatus: entry.manifestStatus,
      hasErrors: entry.hasErrors,
      issues: entry.issues,
    }));
    json(res, 200, catalog);
    return true;
  }

  // GET /api/skills?tool=xxx&scope=xxx
  if (req.method === 'GET' && pathname === '/api/skills') {
    const tool = query.get('tool');
    const scope = query.get('scope');
    const source = query.get('source');
    if (!tool || !MCP_TOOL_NAMES.has(tool)) {
      json(res, 400, { error: 'tool query param required (claude/gemini/codex)' });
      return true;
    }
    if (source !== null) {
      if (!SKILL_SOURCE_QUERY_VALUES.has(source)) {
        json(res, 400, { error: 'source must be all, builtin, local, or project' });
        return true;
      }
      const sourceKinds = source === 'all' ? undefined : ([source] as SkillSourceKind[]);
      const catalog = discoverSkillCatalog({
        workdirRoot: ctx.workdirRoot,
        sourceKinds,
        tool: tool as SkillToolName,
      });
      const settings = await buildSkillSettingLookup(ctx, collectCatalogEnvKeys(catalog));
      json(
        res,
        200,
        catalog.map((entry) =>
          buildUnifiedSkillListEntry(entry, settings, ctx.getDb().skillEnablement),
        ),
      );
      return true;
    }
    if (scope && scope !== 'local' && scope !== 'project') {
      json(res, 400, { error: 'scope must be local or project' });
      return true;
    }
    const scopes: SkillScope[] = scope ? [scope as SkillScope] : ['local', 'project'];
    const skills: SkillEntry[] = [];
    for (const s of scopes) {
      skills.push(...listSkills(tool as SkillToolName, s, ctx.workdirRoot));
    }
    json(res, 200, skills);
    return true;
  }

  const unifiedDetailMatch = pathname.match(
    /^\/api\/skills\/entry\/(builtin|local|project)\/([a-z0-9-]{1,64})$/,
  );
  if (unifiedDetailMatch?.[1] && unifiedDetailMatch[2] && req.method === 'GET') {
    const entry = resolveCatalogEntry(
      ctx,
      unifiedDetailMatch[1] as SkillSourceKind,
      unifiedDetailMatch[2],
    );
    if (!entry) {
      json(res, 404, { error: 'Skill not found' });
      return true;
    }
    json(res, 200, await buildUnifiedSkillDetail(ctx, entry));
    return true;
  }

  const unifiedFileMatch = pathname.match(
    /^\/api\/skills\/entry\/(builtin|local|project)\/([a-z0-9-]{1,64})\/files\/(.+)$/,
  );
  if (
    (req.method === 'GET' || req.method === 'PUT' || req.method === 'DELETE') &&
    unifiedFileMatch?.[1] &&
    unifiedFileMatch[2] &&
    unifiedFileMatch[3]
  ) {
    const decodedFilePath = decodeURIComponentSafe(unifiedFileMatch[3]);
    if (decodedFilePath === null) {
      json(res, 400, { error: 'Invalid file path encoding' });
      return true;
    }
    const entry = resolveCatalogEntry(
      ctx,
      unifiedFileMatch[1] as SkillSourceKind,
      unifiedFileMatch[2],
    );
    if (!entry) {
      json(res, 404, { error: 'Skill not found' });
      return true;
    }
    if (req.method === 'GET') {
      const result = readCatalogSkillFile(entry, decodedFilePath);
      if (!result) {
        json(res, 404, { error: 'File not found' });
        return true;
      }
      json(res, 200, result);
      return true;
    }

    if (!entry.editable) {
      json(res, 403, { error: `Built-in skill '${entry.dirName}' is read-only` });
      return true;
    }

    const filePath = join(entry.skillDir, decodedFilePath);

    if (req.method === 'PUT') {
      let stableFilePath: string;
      try {
        stableFilePath = prepareFilePathWithinRoot(entry.skillDir, filePath);
      } catch {
        json(res, 400, { error: 'Invalid file path' });
        return true;
      }
      const relativePath = normalizeSkillRelativePath(entry.skillDir, stableFilePath);
      if (isReservedSkillFilePath(relativePath)) {
        json(res, 400, {
          error: `Reserved skill file '${relativePath}' must be edited through the skill editor`,
        });
        return true;
      }

      const body = await readBody(req);
      const parsed = parseJson<{ content?: string }>(body);
      if (!parsed) {
        json(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      if (typeof parsed.content !== 'string') {
        json(res, 400, { error: 'content string required' });
        return true;
      }
      writeTextFileWithinRoot(entry.skillDir, filePath, parsed.content);
      json(res, 200, { success: true });
      return true;
    }

    let stableFilePath: string;
    try {
      stableFilePath = resolveExistingPathWithinRoot(entry.skillDir, filePath);
    } catch (err) {
      const isNotFound =
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT';
      json(res, isNotFound ? 404 : 400, {
        error: isNotFound ? 'File not found' : 'Invalid file path',
      });
      return true;
    }
    const relativePath = normalizeSkillRelativePath(entry.skillDir, stableFilePath);
    if (isReservedSkillFilePath(relativePath)) {
      json(res, 400, {
        error: `Reserved skill file '${relativePath}' must be edited through the skill editor`,
      });
      return true;
    }
    removeExistingFileWithinRoot(entry.skillDir, filePath);
    json(res, 200, { success: true });
    return true;
  }

  const unifiedToggleMatch = pathname.match(
    /^\/api\/skills\/entry\/(builtin|local|project)\/([a-z0-9-]{1,64})\/toggle$/,
  );
  if (req.method === 'PUT' && unifiedToggleMatch?.[1] && unifiedToggleMatch[2]) {
    const entry = resolveCatalogEntry(
      ctx,
      unifiedToggleMatch[1] as SkillSourceKind,
      unifiedToggleMatch[2],
    );
    if (!entry) {
      json(res, 404, { error: 'Skill not found' });
      return true;
    }
    await handleSkillToggleRequest(ctx, req, res, entry);
    return true;
  }

  const unifiedEnvMatch = pathname.match(
    /^\/api\/skills\/entry\/(builtin|local|project)\/([a-z0-9-]{1,64})\/env$/,
  );
  if (
    (req.method === 'GET' || req.method === 'PUT') &&
    unifiedEnvMatch?.[1] &&
    unifiedEnvMatch[2]
  ) {
    const entry = resolveCatalogEntry(
      ctx,
      unifiedEnvMatch[1] as SkillSourceKind,
      unifiedEnvMatch[2],
    );
    if (!entry) {
      json(res, 404, { error: 'Skill not found' });
      return true;
    }
    await handleSkillEnvRequest(ctx, req, res, entry);
    return true;
  }

  /* ── Single-driver Skill CRUD ── */

  // /api/skills/:tool/:scope/:name (GET / PUT / DELETE)
  const skillDetail = matchSkillDetail(pathname);
  if (skillDetail) {
    const dir = resolveSkillsDir(
      skillDetail.tool as SkillToolName,
      skillDetail.scope as SkillScope,
      ctx.workdirRoot,
    );
    const skillDir = join(dir, skillDetail.name);

    // GET — full detail
    if (req.method === 'GET') {
      const skillMdName = `SKILL.${skillDetail.tool}.md`;
      const skillPath = join(skillDir, skillMdName);
      if (!existsSync(skillPath)) {
        json(res, 404, { error: 'Skill not found' });
        return true;
      }
      const raw = readFileSync(skillPath, 'utf-8');
      const { frontmatter, body } = parseYamlFrontmatter(raw);
      const catalogEntry = findSkillCatalogEntry(
        { workdirRoot: ctx.workdirRoot },
        skillDetail.scope as SkillSourceKind,
        skillDetail.name,
      );
      const supportFiles = catalogEntry?.supportFiles ?? [];
      json(res, 200, { frontmatter, body, supportFiles });
      return true;
    }

    // PUT — update SKILL.<tool>.md
    if (req.method === 'PUT') {
      if (!existsSync(join(skillDir, `SKILL.${skillDetail.tool}.md`))) {
        json(res, 404, { error: 'Skill not found' });
        return true;
      }
      const body = await readBody(req);
      const parsed = parseJson<{
        frontmatter?: Record<string, unknown>;
        body?: string;
      }>(body);
      if (!parsed) {
        json(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      writeSkillMd(skillDir, parsed, skillDetail.tool as SkillToolName);
      ensureSkillManifestFile(skillDir);
      json(res, 200, { success: true });
      return true;
    }

    // DELETE — delete SKILL.<tool>.md (and clean up directory if empty)
    if (req.method === 'DELETE') {
      const skillMdPath = join(skillDir, `SKILL.${skillDetail.tool}.md`);
      if (!existsSync(skillMdPath)) {
        json(res, 404, { error: 'Skill not found' });
        return true;
      }
      try {
        const skillRef = buildSkillRef(skillDetail.scope as SkillSourceKind, skillDetail.name);
        unlinkSync(skillMdPath);
        ctx.getDb().skillEnablement.delete(skillRef, skillDetail.tool as SkillToolName);
        // Clean up directory if no other SKILL.*.md remain
        const remaining = readdirSync(skillDir).filter((f) => /^SKILL\.[a-z]+\.md$/.test(f));
        if (remaining.length === 0) {
          ctx.getDb().skillEnablement.deleteBySkillRef(skillRef);
          rmSync(skillDir, { recursive: true, force: true });
        }
      } catch (err) {
        json(res, 500, { error: `Failed to delete skill: ${errorMessage(err)}` });
        return true;
      }
      json(res, 200, { success: true });
      return true;
    }
  }

  // POST /api/skills/:tool/:scope — create skill
  const skillCreate = matchSkillCreate(pathname);
  if (req.method === 'POST' && skillCreate) {
    const body = await readBody(req);
    const parsed = parseJson<{
      name?: string;
      frontmatter?: Record<string, unknown>;
      body?: string;
    }>(body);
    if (!parsed) {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!parsed.name || !SKILL_NAME_RE.test(parsed.name)) {
      json(res, 400, {
        error: 'name required, lowercase alphanumeric and dashes only (max 64 chars)',
      });
      return true;
    }
    const dir = resolveSkillsDir(
      skillCreate.tool as SkillToolName,
      skillCreate.scope as SkillScope,
      ctx.workdirRoot,
    );
    const skillDir = join(dir, parsed.name);
    if (existsSync(join(skillDir, `SKILL.${skillCreate.tool}.md`))) {
      json(res, 409, { error: `Skill '${parsed.name}' already exists` });
      return true;
    }
    const conflict = findCrossSourceSkillConflict(
      ctx,
      parsed.name,
      skillCreate.scope as SkillSourceKind,
    );
    if (conflict) {
      json(res, 409, {
        error: `Skill '${parsed.name}' already exists in ${conflict.sourceKind} scope`,
      });
      return true;
    }
    writeSkillMd(skillDir, parsed, skillCreate.tool as SkillToolName);
    ensureSkillManifestFile(skillDir);
    json(res, 201, { success: true });
    return true;
  }

  // /api/skills/:tool/:scope/:name/files/:filename (GET / PUT / DELETE)
  const skillFile = matchSkillFile(pathname);
  if (skillFile) {
    const dir = resolveSkillsDir(
      skillFile.tool as SkillToolName,
      skillFile.scope as SkillScope,
      ctx.workdirRoot,
    );
    let skillDir: string;
    try {
      skillDir = resolveExistingPathWithinRoot(dir, join(dir, skillFile.name));
    } catch (err) {
      const isNotFound =
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT';
      json(res, isNotFound ? 404 : 400, {
        error: isNotFound ? 'Skill not found' : 'Invalid skill path',
      });
      return true;
    }
    const filePath = join(skillDir, skillFile.filename);

    // GET — read support file
    if (req.method === 'GET') {
      let stableFilePath: string;
      try {
        stableFilePath = resolveExistingPathWithinRoot(skillDir, filePath);
      } catch (err) {
        const isNotFound =
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT';
        json(res, isNotFound ? 404 : 400, {
          error: isNotFound ? 'File not found' : 'Invalid file path',
        });
        return true;
      }
      const content = readTextFileWithinRoot(skillDir, stableFilePath);
      json(res, 200, { filename: skillFile.filename, content });
      return true;
    }

    // PUT — create/update support file
    if (req.method === 'PUT') {
      if (!existsSync(join(skillDir, `SKILL.${skillFile.tool}.md`))) {
        json(res, 404, { error: 'Skill not found' });
        return true;
      }
      let stableFilePath: string;
      try {
        stableFilePath = prepareFilePathWithinRoot(skillDir, filePath);
      } catch {
        json(res, 400, { error: 'Invalid file path' });
        return true;
      }
      const body = await readBody(req);
      const parsed = parseJson<{ content?: string }>(body);
      if (!parsed) {
        json(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      if (typeof parsed.content !== 'string') {
        json(res, 400, { error: 'content string required' });
        return true;
      }
      writeTextFileWithinRoot(skillDir, stableFilePath, parsed.content);
      json(res, 200, { success: true });
      return true;
    }

    // DELETE — delete support file
    if (req.method === 'DELETE') {
      let stableFilePath: string;
      try {
        stableFilePath = resolveExistingPathWithinRoot(skillDir, filePath);
      } catch (err) {
        const isNotFound =
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT';
        json(res, isNotFound ? 404 : 400, {
          error: isNotFound ? 'File not found' : 'Invalid file path',
        });
        return true;
      }
      removeExistingFileWithinRoot(skillDir, stableFilePath);
      json(res, 200, { success: true });
      return true;
    }
  }

  /* ── Multi-driver Skills API ── */

  // DELETE /api/skills/multi/:scope/:name/files/:filename — delete file from all drivers
  const multiFile = pathname.match(
    /^\/api\/skills\/multi\/(local|project)\/([a-z0-9-]{1,64})\/files\/(.+)$/,
  );
  if (req.method === 'DELETE' && multiFile?.[1] && multiFile[2] && multiFile[3]) {
    const scope = multiFile[1] as SkillScope;
    const name = multiFile[2];
    const filename = decodeURIComponentSafe(multiFile[3]);
    if (filename === null) {
      json(res, 400, { error: 'Invalid filename encoding' });
      return true;
    }
    if (filename.includes('\0') || filename.includes('..')) {
      json(res, 400, { error: 'Invalid filename' });
      return true;
    }
    // All tools share the same unified directory — look up once
    const dir = resolveSkillsDir('claude' as SkillToolName, scope, ctx.workdirRoot);
    let skillDir: string;
    try {
      skillDir = resolveExistingPathWithinRoot(dir, join(dir, name));
    } catch {
      json(res, 404, { error: 'File not found in any driver' });
      return true;
    }
    const filePath = join(skillDir, filename);
    let stableFilePath: string;
    try {
      stableFilePath = resolveExistingPathWithinRoot(skillDir, filePath);
    } catch {
      json(res, 404, { error: 'File not found in any driver' });
      return true;
    }
    if (existsSync(stableFilePath)) {
      removeExistingFileWithinRoot(skillDir, stableFilePath);
      json(res, 200, { success: true });
    } else {
      json(res, 404, { error: 'File not found in any driver' });
    }
    return true;
  }

  // /api/skills/multi/:scope/:name (GET / PUT / DELETE)
  const multiDetail = pathname.match(/^\/api\/skills\/multi\/(local|project)\/([a-z0-9-]{1,64})$/);
  if (multiDetail?.[1] && multiDetail[2]) {
    const scope = multiDetail[1] as SkillScope;
    const name = multiDetail[2];

    // GET — read skill from all drivers
    if (req.method === 'GET') {
      const drivers: Record<string, { frontmatter: Record<string, unknown>; body: string }> = {};

      for (const tool of ALL_TOOLS) {
        const dir = resolveSkillsDir(tool, scope, ctx.workdirRoot);
        const skillPath = join(dir, name, `SKILL.${tool}.md`);
        if (existsSync(skillPath)) {
          try {
            const raw = readFileSync(skillPath, 'utf-8');
            const result = parseYamlFrontmatter(raw);
            drivers[tool] = { frontmatter: result.frontmatter, body: result.body };
          } catch {
            // skip unparseable
          }
        }
      }

      if (Object.keys(drivers).length === 0) {
        json(res, 404, { error: 'Skill not found in any driver' });
        return true;
      }

      // Read requirements.txt and scripts from the shared directory
      const skillDir = join(
        resolveSkillsDir('claude' as SkillToolName, scope, ctx.workdirRoot),
        name,
      );

      let requirements: string | null = null;
      const reqPath = join(skillDir, 'requirements.txt');
      if (existsSync(reqPath)) {
        requirements = readFileSync(reqPath, 'utf-8');
      }

      const scripts: string[] = [];
      const scriptsDir = join(skillDir, 'scripts');
      if (existsSync(scriptsDir)) {
        try {
          for (const f of readdirSync(scriptsDir)) {
            if (statSync(join(scriptsDir, f)).isFile()) {
              scripts.push(f);
            }
          }
        } catch {
          // ignore
        }
      }

      json(res, 200, { drivers, requirements, scripts });
      return true;
    }

    // PUT — update skill across multiple drivers
    if (req.method === 'PUT') {
      const rawBody = await readBody(req);
      const parsed = parseJson<{
        drivers?: Record<string, { frontmatter?: Record<string, unknown>; body?: string }>;
        requirements?: string | null;
        scripts?: Array<{ filename: string; content: string }>;
      }>(rawBody);

      if (!parsed) {
        json(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      if (parsed.drivers) {
        for (const tool of Object.keys(parsed.drivers)) {
          if (!MCP_TOOL_NAMES.has(tool)) {
            json(res, 400, { error: `Invalid driver: ${tool}` });
            return true;
          }
        }
      }
      if (!validateScriptFiles(parsed.scripts, res)) return true;

      // All tools share the same unified directory
      const sharedDir = resolveSkillsDir('claude' as SkillToolName, scope, ctx.workdirRoot);
      const skillDir = join(sharedDir, name);

      // Verify at least one SKILL.<tool>.md exists
      const hasAny = ALL_TOOLS.some((t) => existsSync(join(skillDir, `SKILL.${t}.md`)));
      if (!hasAny && !parsed.drivers) {
        json(res, 404, { error: 'Skill not found in any driver' });
        return true;
      }

      // Update SKILL.<tool>.md for each driver in payload
      if (parsed.drivers) {
        for (const [tool, data] of Object.entries(parsed.drivers)) {
          writeSkillMd(skillDir, data, tool as SkillToolName);
        }
      }

      // Sync support files once (shared directory)
      syncSupportFiles(skillDir, parsed.requirements, parsed.scripts);
      ensureSkillManifestFile(skillDir);

      json(res, 200, { success: true });
      return true;
    }

    // DELETE — delete skill from all drivers (shared directory)
    if (req.method === 'DELETE') {
      const dir = resolveSkillsDir('claude' as SkillToolName, scope, ctx.workdirRoot);
      const skillDir = join(dir, name);
      if (!existsSync(skillDir)) {
        json(res, 404, { error: 'Skill not found in any driver' });
        return true;
      }
      try {
        ctx.getDb().skillEnablement.deleteBySkillRef(buildSkillRef(scope as SkillSourceKind, name));
        rmSync(skillDir, { recursive: true, force: true });
      } catch (err) {
        json(res, 500, { error: `Failed to delete skill: ${errorMessage(err)}` });
        return true;
      }
      json(res, 200, { success: true });
      return true;
    }
  }

  // POST /api/skills/multi/:scope — create skill across multiple drivers
  const multiCreate = pathname.match(/^\/api\/skills\/multi\/(local|project)$/);
  if (req.method === 'POST' && multiCreate?.[1]) {
    const scope = multiCreate[1] as SkillScope;
    const rawBody = await readBody(req);
    const parsed = parseJson<{
      name?: string;
      drivers?: Record<string, { frontmatter?: Record<string, unknown>; body?: string }>;
      requirements?: string;
      scripts?: Array<{ filename: string; content: string }>;
    }>(rawBody);

    if (!parsed) {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (!parsed.name || !SKILL_NAME_RE.test(parsed.name)) {
      json(res, 400, {
        error: 'name required, lowercase alphanumeric and dashes only (max 64 chars)',
      });
      return true;
    }
    if (!parsed.drivers || Object.keys(parsed.drivers).length === 0) {
      json(res, 400, { error: 'At least one driver is required' });
      return true;
    }
    for (const tool of Object.keys(parsed.drivers)) {
      if (!MCP_TOOL_NAMES.has(tool)) {
        json(res, 400, { error: `Invalid driver: ${tool}` });
        return true;
      }
    }
    if (!validateScriptFiles(parsed.scripts, res)) return true;

    // Check none exist already (all tools share the same unified directory)
    const sharedCreateDir = resolveSkillsDir('claude' as SkillToolName, scope, ctx.workdirRoot);
    const sharedSkillDir = join(sharedCreateDir, parsed.name);
    for (const tool of Object.keys(parsed.drivers)) {
      if (existsSync(join(sharedSkillDir, `SKILL.${tool}.md`))) {
        json(res, 409, { error: `Skill '${parsed.name}' already exists for ${tool}` });
        return true;
      }
    }
    const conflict = findCrossSourceSkillConflict(ctx, parsed.name, scope as SkillSourceKind);
    if (conflict) {
      json(res, 409, {
        error: `Skill '${parsed.name}' already exists in ${conflict.sourceKind} scope`,
      });
      return true;
    }

    // Create SKILL.<tool>.md for each driver in the shared directory
    for (const [tool, data] of Object.entries(parsed.drivers)) {
      writeSkillMd(sharedSkillDir, data, tool as SkillToolName);
    }
    // Sync support files once (shared directory)
    syncSupportFiles(sharedSkillDir, parsed.requirements, parsed.scripts);
    ensureSkillManifestFile(sharedSkillDir);

    json(res, 201, { success: true });
    return true;
  }

  return false;
}
