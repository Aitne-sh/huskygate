/** @module workdir/manager — Session workdir lifecycle: creation, skill seeding, and cleanup. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config, ToolName } from '../config.js';
import { buildInstruction } from '../instructions/builder.js';
import { getInstructionFilePath } from '../orchestrator/engine-utils.js';
import type { Mode } from '../session/types.js';
import { TIMEOUTS, TTLS } from '../shared/constants.js';
import {
  type SkillCatalogEntry,
  type SkillRef,
  discoverSkillCatalog,
  resolveBuiltinSkillCatalogDir,
} from '../skills/catalog.js';
import type { SkillEnablementStore } from '../store/skill-enablement.js';
import { logger } from '../utils/logger.js';
import { ensureDirectoryWithinRoot, prepareFilePathWithinRoot } from '../utils/path-security.js';
import { getVenvPip, getVenvPython, resolvePython } from '../utils/platform.js';

const CLEANUP_MAX_AGE_MS = TTLS.workdirCleanup; // 7 days

const SESSION_ID_WORKDIR_RE = /^[a-f0-9]{8}$/;
const LEGACY_HASHED_WORKDIR_RE = /^sess_[a-f0-9]{12}$/;
const TOOL_INSTRUCTION_FILE: Record<ToolName, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
};
const DUPLICATE_DIR_NAME_ISSUE = 'duplicate-dir-name';

/**
 * Maps ToolName → the skills directory convention used by each tool.
 *
 * Claude Code discovers skills at `.claude/skills/<name>/SKILL.md`.
 * Gemini CLI discovers skills at `.gemini/skills/<name>/SKILL.md`.
 * Codex CLI discovers skills at `.agents/skills/<name>/SKILL.md`.
 *
 * Note: Custom skills are stored centrally in `.huskygate/skills/` (local or project scope)
 * and seeded into session workdirs at the tool-specific paths above.
 */
const TOOL_SKILL_DIR: Record<ToolName, string> = {
  claude: path.join('.claude', 'skills'),
  gemini: path.join('.gemini', 'skills'),
  codex: path.join('.agents', 'skills'),
};

/**
 * Maps ToolName → the tool-specific SKILL.md filename within each skill template.
 */
const TOOL_SKILL_MD: Record<ToolName, string> = {
  claude: 'SKILL.claude.md',
  gemini: 'SKILL.gemini.md',
  codex: 'SKILL.codex.md',
};

interface SeedCatalogSkillOptions {
  seededEvent: 'skill_seeded' | 'custom_skill_seeded';
  failedEvent: 'skill_seed_failed' | 'custom_skill_seed_failed';
  syncExistingAssets: boolean;
}

interface WorkdirManagerDeps {
  skillEnablementStore?: Pick<SkillEnablementStore, 'getEnabled'>;
}

/** Manages per-session working directories, instruction templates, and built-in skill provisioning. */
export class WorkdirManager {
  constructor(
    private readonly config: Config,
    private readonly deps: WorkdirManagerDeps = {},
  ) {}

  getSessionWorkdir(sessionKey: string): string {
    const hash = crypto.createHash('sha256').update(sessionKey).digest('hex').slice(0, 12);
    const dir = path.join(this.config.workdirRoot, `sess_${hash}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  validateCustomWorkdir(requestedPath: string): string {
    let resolved: string;
    try {
      resolved = fs.realpathSync(requestedPath);
    } catch {
      throw new Error(`Path does not exist: ${requestedPath}`);
    }

    const isAllowed = this.config.allowedWorkdirRoots.some((root) => {
      let resolvedRoot: string;
      try {
        resolvedRoot = fs.realpathSync(root);
      } catch {
        return false;
      }
      return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
    });

    if (!isAllowed) {
      throw new Error(
        `Path not in allowed roots: ${resolved}. Allowed: ${this.config.allowedWorkdirRoots.join(', ')}`,
      );
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }

    return resolved;
  }

  ensureWorkdir(workdir: string): void {
    fs.mkdirSync(workdir, { recursive: true });
  }

  private normalizePathForComparison(targetPath: string): string {
    try {
      return fs.realpathSync(targetPath);
    } catch {
      return path.resolve(targetPath);
    }
  }

  private buildReferencedWorkdirSet(referencedWorkdirs: readonly string[]): Set<string> {
    const set = new Set<string>();
    for (const workdir of referencedWorkdirs) {
      set.add(this.normalizePathForComparison(workdir));
    }
    return set;
  }

  private createArchivePath(namePrefix: string): string {
    const archiveRoot = path.join(this.config.workdirRoot, '_archive');
    fs.mkdirSync(archiveRoot, { recursive: true });

    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    let candidate = path.join(archiveRoot, `${namePrefix}_${timestamp}`);
    let suffix = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(archiveRoot, `${namePrefix}_${timestamp}_${suffix}`);
      suffix += 1;
    }
    return candidate;
  }

  archiveLegacyDefaultWorkdirIfUnused(referencedWorkdirs: readonly string[]): string | null {
    const defaultDir = path.join(this.config.workdirRoot, 'default');
    if (!fs.existsSync(defaultDir)) return null;

    const referencedSet = this.buildReferencedWorkdirSet(referencedWorkdirs);
    const normalizedDefault = this.normalizePathForComparison(defaultDir);
    if (referencedSet.has(normalizedDefault)) {
      return null;
    }

    const archivePath = this.createArchivePath('default');
    fs.renameSync(defaultDir, archivePath);
    logger.info('workdir_default_archived', { from: defaultDir, to: archivePath });
    return archivePath;
  }

  cleanupUnusedSessionWorkdirs(referencedWorkdirs: readonly string[]): number {
    if (!fs.existsSync(this.config.workdirRoot)) return 0;

    const referencedSet = this.buildReferencedWorkdirSet(referencedWorkdirs);
    let removed = 0;
    const entries = fs.readdirSync(this.config.workdirRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '_archive' || entry.name === 'default') continue;
      if (!SESSION_ID_WORKDIR_RE.test(entry.name) && !LEGACY_HASHED_WORKDIR_RE.test(entry.name)) {
        continue;
      }

      const targetPath = path.join(this.config.workdirRoot, entry.name);
      const normalizedTarget = this.normalizePathForComparison(targetPath);
      if (referencedSet.has(normalizedTarget)) {
        continue;
      }

      fs.rmSync(targetPath, { recursive: true, force: true });
      removed += 1;
      logger.info('workdir_removed_unused', { path: targetPath });
    }

    if (removed > 0) {
      logger.info('workdir_unused_cleanup_complete', { removed });
    }
    return removed;
  }

  ensureSessionWorkdirs(
    sessions: readonly { workdir: string; tool: ToolName; mode: Mode }[],
    autoApprove = false,
  ): void {
    for (const session of sessions) {
      // P1: readonly mode → auto-approve must never be enabled
      const effectiveAutoApprove = session.mode === 'readonly' ? false : autoApprove;
      this.ensureWorkdir(session.workdir);
      const instruction = buildInstruction({
        tool: session.tool,
        source: 'chat',
        autoApprove: effectiveAutoApprove,
        allowMcp: true,
      });
      const instrPath = getInstructionFilePath(session.workdir, session.tool);
      // Only write if the file does not exist (preserve user-edited content)
      if (!fs.existsSync(instrPath)) {
        fs.writeFileSync(instrPath, instruction, 'utf-8');
      }
      this.seedCatalogSkills(session.workdir, session.tool);
    }
  }

  /**
   * Resolves the skill template source directory.
   * Searches: SKILL_TEMPLATE_DIR env → `skills/` → project root `skills/`.
   */
  private resolveBuiltinSkillsDir(): string | null {
    return resolveBuiltinSkillCatalogDir(this.config.skillTemplateDir);
  }

  private discoverSeedCatalog(tool: ToolName, builtinDir: string | null): SkillCatalogEntry[] {
    return discoverSkillCatalog({
      builtinDir,
      workdirRoot: this.config.workdirRoot,
      sourceKinds: ['builtin', 'local', 'project'],
      tool,
    });
  }

  private hasDuplicateSeedConflict(entry: SkillCatalogEntry): boolean {
    return entry.issues.some((issue) => issue.code === DUPLICATE_DIR_NAME_ISSUE);
  }

  private resolveRequestedBuiltinSkillDirNames(
    tool: ToolName,
    catalogEntries: readonly SkillCatalogEntry[],
    enabledSkills?: SkillRef[] | null,
  ): string[] {
    if (enabledSkills !== undefined && enabledSkills !== null) {
      return [
        ...new Set(
          enabledSkills
            .filter((skillRef) => skillRef.startsWith('builtin:'))
            .map((skillRef) => skillRef.slice('builtin:'.length)),
        ),
      ];
    }
    const requested = new Set<string>();

    for (const entry of catalogEntries) {
      if (
        entry.sourceKind === 'builtin' &&
        !this.hasDuplicateSeedConflict(entry) &&
        this.isCatalogEntryEnabled(entry, tool)
      ) {
        requested.add(entry.dirName);
      }
    }

    return [...requested];
  }

  private resolveExplicitCatalogEntries(
    catalogEntries: readonly SkillCatalogEntry[],
    enabledSkills: readonly SkillRef[],
  ): SkillCatalogEntry[] {
    const entriesByRef = new Map(catalogEntries.map((entry) => [entry.skillRef, entry] as const));
    const requested: SkillCatalogEntry[] = [];
    for (const skillRef of new Set(enabledSkills)) {
      const entry = entriesByRef.get(skillRef);
      if (!entry || this.hasDuplicateSeedConflict(entry)) continue;
      requested.push(entry);
    }
    return requested;
  }

  private isCatalogEntryEnabled(entry: SkillCatalogEntry, tool: ToolName): boolean {
    const enabled = this.deps.skillEnablementStore?.getEnabled(entry.skillRef, tool);
    if (enabled === null || enabled === undefined) {
      return entry.sourceKind !== 'builtin';
    }
    return enabled;
  }

  private findBuiltinCatalogEntry(
    catalogEntries: readonly SkillCatalogEntry[],
    skillDirName: string,
  ): SkillCatalogEntry | null {
    return (
      catalogEntries.find(
        (entry) => entry.sourceKind === 'builtin' && entry.dirName === skillDirName,
      ) ?? null
    );
  }

  private resolveSeedableCatalogEntries(
    tool: ToolName,
    catalogEntries: readonly SkillCatalogEntry[],
    enabledSkills?: SkillRef[] | null,
  ): SkillCatalogEntry[] {
    if (enabledSkills !== undefined && enabledSkills !== null) {
      return this.resolveExplicitCatalogEntries(catalogEntries, enabledSkills);
    }

    const builtins: SkillCatalogEntry[] = [];
    const requestedBuiltinDirNames = this.resolveRequestedBuiltinSkillDirNames(
      tool,
      catalogEntries,
    );
    for (const skillDirName of requestedBuiltinDirNames) {
      const entry = this.findBuiltinCatalogEntry(catalogEntries, skillDirName);
      if (!entry || this.hasDuplicateSeedConflict(entry)) continue;
      builtins.push(entry);
    }
    const customs = catalogEntries.filter(
      (entry) =>
        entry.sourceKind !== 'builtin' &&
        !this.hasDuplicateSeedConflict(entry) &&
        this.isCatalogEntryEnabled(entry, tool),
    );
    return [...builtins, ...customs];
  }

  listSeedableSkillEntries(tool: ToolName, enabledSkills?: SkillRef[] | null): SkillCatalogEntry[] {
    const builtinDir = this.resolveBuiltinSkillsDir();
    const catalogEntries = this.discoverSeedCatalog(tool, builtinDir);
    return this.resolveSeedableCatalogEntries(tool, catalogEntries, enabledSkills);
  }

  listSeedableSkillRefs(tool: ToolName, enabledSkills?: SkillRef[] | null): SkillRef[] {
    return this.listSeedableSkillEntries(tool, enabledSkills).map((entry) => entry.skillRef);
  }

  private seedCatalogSkills(
    workdir: string,
    tool: ToolName,
    enabledSkills?: SkillRef[] | null,
  ): void {
    const builtinDir = this.resolveBuiltinSkillsDir();
    const catalogEntries = this.discoverSeedCatalog(tool, builtinDir);
    const requestedBuiltinDirNames = this.resolveRequestedBuiltinSkillDirNames(
      tool,
      catalogEntries,
      enabledSkills,
    );
    if (!builtinDir) {
      for (const skillDirName of requestedBuiltinDirNames) {
        logger.debug('skill_template_dir_not_found', { skill: skillDirName });
      }
    } else {
      for (const skillDirName of requestedBuiltinDirNames) {
        const entry = this.findBuiltinCatalogEntry(catalogEntries, skillDirName);
        if (entry) continue;
        const sourceDir = path.join(builtinDir, skillDirName);
        if (fs.existsSync(sourceDir)) {
          logger.warn('skill_md_missing', {
            skill: skillDirName,
            tool,
            expected: path.join(sourceDir, TOOL_SKILL_MD[tool]),
          });
        } else {
          logger.debug('skill_source_missing', {
            skill: skillDirName,
            sourceDir,
          });
        }
      }
    }
    for (const entry of this.resolveSeedableCatalogEntries(tool, catalogEntries, enabledSkills)) {
      this.seedCatalogSkill(workdir, tool, entry, {
        seededEvent: entry.sourceKind === 'builtin' ? 'skill_seeded' : 'custom_skill_seeded',
        failedEvent:
          entry.sourceKind === 'builtin' ? 'skill_seed_failed' : 'custom_skill_seed_failed',
        syncExistingAssets: entry.sourceKind === 'builtin',
      });
    }
  }

  /**
   * Seed a single discovered skill into a session workdir.
   *
   * Copies the tool-specific SKILL.md, all files under scripts/, and requirements.txt
   * into the tool's skill discovery directory within the workdir.
   */
  private seedCatalogSkill(
    workdir: string,
    tool: ToolName,
    entry: SkillCatalogEntry,
    options: SeedCatalogSkillOptions,
  ): void {
    const skillDirName = entry.dirName;
    const sourceDir = entry.skillDir;
    // Target: <workdir>/<.claude|.gemini|.agents>/skills/<skillDirName>/
    let targetDir: string;
    let targetSkillMd: string;
    let targetRequirementsPath: string | null = null;
    try {
      targetDir = ensureDirectoryWithinRoot(
        workdir,
        path.join(workdir, TOOL_SKILL_DIR[tool], skillDirName),
      );
      targetSkillMd = prepareFilePathWithinRoot(targetDir, path.join(targetDir, 'SKILL.md'));
      const reqSource = path.join(sourceDir, 'requirements.txt');
      if (fs.existsSync(reqSource)) {
        targetRequirementsPath = prepareFilePathWithinRoot(
          targetDir,
          path.join(targetDir, 'requirements.txt'),
        );
      }
    } catch (err) {
      logger.warn(options.failedEvent, {
        skill: skillDirName,
        tool,
        workdir,
        error: err instanceof Error ? err.message : String(err),
        sourceKind: entry.sourceKind,
      });
      return;
    }

    // Check if already seeded and whether scripts need updating
    if (fs.existsSync(targetSkillMd)) {
      if (!options.syncExistingAssets) {
        return;
      }
      try {
        const existing = fs.readFileSync(targetSkillMd, 'utf-8');
        if (!existing.includes('disable-model-invocation')) {
          // SKILL.md is up-to-date — but still sync assets if source is newer
          try {
            this.syncSkillAssets(sourceDir, targetDir, skillDirName);
          } catch (err) {
            logger.warn('skill_assets_sync_failed', {
              skill: skillDirName,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          this.ensureSkillVenv(targetDir, skillDirName);
          return;
        }
        // Fall through to re-seed with the flag stripped
      } catch {
        return;
      }
    }

    try {
      // 1. Copy tool-specific SKILL.md → SKILL.md
      //    Strip `disable-model-invocation: true` from YAML frontmatter because
      //    the CLI runs in headless mode (-p) where slash commands are unavailable.
      //    Without stripping, Claude Code won't inject the skill content into the
      //    system prompt, making the skill invisible.
      const skillMdSource = path.join(sourceDir, TOOL_SKILL_MD[tool]);
      if (fs.existsSync(skillMdSource)) {
        let content = fs.readFileSync(skillMdSource, 'utf-8');
        content = content.replace(
          /^(---\n[\s\S]*?)disable-model-invocation:\s*true\n([\s\S]*?---)/m,
          '$1$2',
        );
        fs.writeFileSync(targetSkillMd, content, 'utf-8');
      } else {
        logger.warn('skill_md_missing', { skill: skillDirName, tool, expected: skillMdSource });
        return;
      }

      // 2. Recursively copy scripts/ and references/ directories
      for (const subDir of ['scripts', 'references']) {
        const subSource = path.join(sourceDir, subDir);
        if (fs.existsSync(subSource)) {
          this.copyDirRecursive(subSource, path.join(targetDir, subDir), targetDir);
        }
      }

      // 3. Copy requirements.txt
      const reqSource = path.join(sourceDir, 'requirements.txt');
      if (fs.existsSync(reqSource) && targetRequirementsPath) {
        this.copyFileWithMode(reqSource, targetRequirementsPath);
      }

      logger.info(options.seededEvent, {
        skill: skillDirName,
        tool,
        workdir,
        targetDir,
        sourceKind: entry.sourceKind,
      });

      // Auto-setup venv if requirements.txt contains real dependencies
      this.ensureSkillVenv(targetDir, skillDirName);
    } catch (err) {
      logger.warn(options.failedEvent, {
        skill: skillDirName,
        tool,
        workdir,
        error: err instanceof Error ? err.message : String(err),
        sourceKind: entry.sourceKind,
      });
    }
  }

  /**
   * Sync mutable asset directories (scripts/, references/) from source to
   * an already-seeded skill directory.
   *
   * Uses source content as the single source of truth: changed files are
   * overwritten and destination files that no longer exist in the source are
   * pruned. This keeps existing sessions aligned with the built-in template.
   */
  private syncSkillAssets(sourceDir: string, targetDir: string, skillDirName: string): void {
    let totalUpdated = 0;
    let totalRemoved = 0;

    const syncDir = (src: string, dest: string): void => {
      const realDest = ensureDirectoryWithinRoot(targetDir, dest);
      const sourceEntries = new Map(
        fs.readdirSync(src, { withFileTypes: true }).map((entry) => [entry.name, entry]),
      );
      for (const entry of fs.readdirSync(realDest, { withFileTypes: true })) {
        if (sourceEntries.has(entry.name)) continue;
        fs.rmSync(path.join(realDest, entry.name), { recursive: true, force: true });
        totalRemoved++;
      }
      for (const entry of sourceEntries.values()) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(realDest, entry.name);
        if (entry.isDirectory()) {
          if (fs.existsSync(destPath)) {
            const stat = fs.lstatSync(destPath);
            if (stat.isSymbolicLink()) {
              throw new Error(`Symlink path not allowed: ${destPath}`);
            }
            if (!stat.isDirectory()) {
              fs.rmSync(destPath, { recursive: true, force: true });
              totalRemoved++;
            }
          }
          syncDir(srcPath, destPath);
        } else if (entry.isFile()) {
          let needsCopy = !fs.existsSync(destPath);
          if (!needsCopy) {
            const stat = fs.lstatSync(destPath);
            if (stat.isSymbolicLink()) {
              throw new Error(`Symlink path not allowed: ${destPath}`);
            }
            if (!stat.isFile()) {
              fs.rmSync(destPath, { recursive: true, force: true });
              totalRemoved++;
              needsCopy = true;
            } else {
              needsCopy = !fs.readFileSync(srcPath).equals(fs.readFileSync(destPath));
            }
          }
          if (needsCopy) {
            const safeDestPath = prepareFilePathWithinRoot(targetDir, destPath);
            this.copyFileWithMode(srcPath, safeDestPath);
            totalUpdated++;
          }
        }
      }
    };

    for (const subDir of ['scripts', 'references']) {
      const subSource = path.join(sourceDir, subDir);
      if (!fs.existsSync(subSource)) continue;

      const subTarget = path.join(targetDir, subDir);
      if (!fs.existsSync(subTarget)) {
        this.copyDirRecursive(subSource, subTarget, targetDir);
        logger.info('skill_assets_synced', {
          skill: skillDirName,
          subDir,
          reason: 'missing_target',
        });
        continue;
      }
      syncDir(subSource, subTarget);
    }

    if (totalUpdated > 0 || totalRemoved > 0) {
      logger.info('skill_assets_synced', {
        skill: skillDirName,
        filesUpdated: totalUpdated,
        filesRemoved: totalRemoved,
      });
    }
  }

  /**
   * Create a Python venv and install dependencies if requirements.txt
   * contains real package specs (not just comments).
   *
   * Idempotent: skips if .venv/bin/python already exists.
   * Non-fatal: logs a warning on failure so the LLM can fall back
   * to the manual setup instructions in SKILL.md.
   */
  private ensureSkillVenv(skillDir: string, skillDirName: string): void {
    const reqPath = path.join(skillDir, 'requirements.txt');
    if (!fs.existsSync(reqPath)) return;

    // Check if requirements.txt has actual package specs (not just comments/blanks)
    const content = fs.readFileSync(reqPath, 'utf-8');
    const hasRealDeps = content.split('\n').some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    });
    if (!hasRealDeps) return;

    const venvDir = path.join(skillDir, '.venv');
    const venvPythonPath = getVenvPython(venvDir);
    if (fs.existsSync(venvPythonPath)) return; // already set up

    const python = resolvePython();
    if (!python) {
      logger.warn('skill_venv_no_python', { skill: skillDirName, skillDir });
      return;
    }

    try {
      // Create venv
      execFileSync(python.command, [...python.args, '-m', 'venv', venvDir], {
        timeout: TIMEOUTS.venvCreate,
        stdio: 'pipe',
      });

      // Install dependencies
      execFileSync(getVenvPip(venvDir), ['install', '-q', '-r', reqPath], {
        timeout: TIMEOUTS.pipInstall,
        stdio: 'pipe',
      });

      logger.info('skill_venv_created', { skill: skillDirName, skillDir });
    } catch (err) {
      logger.warn('skill_venv_setup_failed', {
        skill: skillDirName,
        skillDir,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal — the LLM can fall back to manual setup via SKILL.md instructions
    }
  }

  /**
   * Copy a single file and make it executable if it is a script (.py/.sh).
   */
  private copyFileWithMode(srcPath: string, destPath: string): void {
    if (fs.existsSync(destPath)) {
      const stat = fs.lstatSync(destPath);
      if (stat.isSymbolicLink()) {
        throw new Error(`Symlink path not allowed: ${destPath}`);
      }
      if (stat.isDirectory()) {
        throw new Error(`Expected file path: ${destPath}`);
      }
    }
    const tempPath = path.join(path.dirname(destPath), `.tmp.${crypto.randomUUID()}`);
    try {
      fs.copyFileSync(srcPath, tempPath);
      if (fs.existsSync(destPath)) {
        const stat = fs.lstatSync(destPath);
        if (stat.isSymbolicLink()) {
          throw new Error(`Symlink path not allowed: ${destPath}`);
        }
        if (stat.isDirectory()) {
          throw new Error(`Expected file path: ${destPath}`);
        }
      }
      fs.renameSync(tempPath, destPath);
    } catch (err) {
      fs.rmSync(tempPath, { force: true });
      throw err;
    }
    if (destPath.endsWith('.py') || destPath.endsWith('.sh') || destPath.endsWith('.ps1')) {
      try {
        fs.chmodSync(destPath, 0o755);
      } catch {
        // non-critical on some filesystems
      }
    }
  }

  /**
   * Recursively copy a directory tree, making scripts executable.
   */
  private copyDirRecursive(src: string, dest: string, rootDir = dest): void {
    const realDest = ensureDirectoryWithinRoot(rootDir, dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(realDest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath, rootDir);
      } else if (entry.isFile()) {
        const safeDestPath = prepareFilePathWithinRoot(rootDir, destPath);
        this.copyFileWithMode(srcPath, safeDestPath);
      }
    }
  }

  /**
   * Seeds skills into a workdir without touching the instruction file.
   * Used when the caller has already written the instruction file via the builder.
   */
  prepareWorkdirSkillsOnly(
    workdir: string,
    tool: ToolName,
    enabledSkills?: SkillRef[] | null,
  ): void {
    this.ensureWorkdir(workdir);
    this.seedCatalogSkills(workdir, tool, enabledSkills);
  }

  willSeedSkills(tool: ToolName, enabledSkills?: SkillRef[] | null): boolean {
    return this.listSeedableSkillEntries(tool, enabledSkills).length > 0;
  }

  prepareDevWorkdir(workdir: string): void {
    this.ensureWorkdir(workdir);
  }

  /**
   * Writes custom instruction content to the tool-specific file in the workdir.
   * Skips if the file already exists (never overwrites).
   * Returns true if the file was created, false if skipped.
   */
  seedDevInstructionFile(workdir: string, tool: ToolName, content: string): boolean {
    const filename = TOOL_INSTRUCTION_FILE[tool];
    const targetPath = path.join(workdir, filename);
    if (fs.existsSync(targetPath)) {
      return false;
    }
    try {
      fs.writeFileSync(targetPath, content, 'utf-8');
      logger.info('dev_instruction_seeded', { tool, target: targetPath });
      return true;
    } catch (err) {
      logger.warn('dev_instruction_seed_failed', {
        tool,
        target: targetPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  cleanupStaleSessions(): number {
    if (!fs.existsSync(this.config.workdirRoot)) return 0;

    const now = Date.now();
    let removed = 0;

    const entries = fs.readdirSync(this.config.workdirRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Match both legacy (sess_<12hex>) and current (<8hex>) workdir naming
      if (!LEGACY_HASHED_WORKDIR_RE.test(entry.name) && !SESSION_ID_WORKDIR_RE.test(entry.name)) {
        continue;
      }

      const dirPath = path.join(this.config.workdirRoot, entry.name);
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > CLEANUP_MAX_AGE_MS) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed++;
        logger.info('workdir_cleaned', { path: dirPath });
      }
    }

    if (removed > 0) {
      logger.info('workdir_cleanup_complete', { removed });
    }
    return removed;
  }
}
