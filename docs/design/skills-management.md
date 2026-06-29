# Skills Management

> SSOT for skill discovery, manifests, runtime seeding, global enablement, persisted skill references, and the unified dashboard Skills API/UI after Phase 7.

---

## 1. Scope

This document covers:

- filesystem-backed skill definitions
- `skill.json` manifest rules
- unified discovery across built-in/local/project roots
- runtime seeding and env propagation
- `skill_enablement` as the runtime source of truth
- persisted `SkillRef[]` contracts
- dashboard Skills API/UI behavior

Out of scope:

- the content of individual skill prompts/scripts
- generic settings storage not specific to skills

---

## 2. Source of Truth

Static skill definition data lives on the filesystem.

| Source kind | Root | Editable |
|---|---|---|
| built-in | `./skills/<name>/` | No |
| local custom | `~/.huskygate/skills/<name>/` | Yes |
| project custom | `<WORKDIR_ROOT>/.huskygate/skills/<name>/` | Yes |

Built-in root resolution is:

1. explicit `config.skillTemplateDir` / `SKILL_TEMPLATE_DIR` when set
2. repo `./skills/`

Discovery derives these runtime-only fields from the source root and current catalog state:

- `skillRef`
- `sourceKind`
- `editable`
- `toolVariants`
- `name`
- `description`
- `supportFiles`
- `enabledByDriver`

Mutable state is not stored in `skill.json`:

- global per-driver enablement
- task / agent / orchestrator skill selections
- secret env values
- migration markers

---

## 3. Manifest Contract

Every skill directory is expected to contain `skill.json`.

```json
{
  "schemaVersion": 1,
  "excludeDirs": [".venv", "__pycache__", ".git", "node_modules"],
  "envVars": ["OPTIONAL_ENV_KEY"]
}
```

### Allowed fields

- `schemaVersion`: must be `1`
- `excludeDirs`: directories omitted from recursive support-file discovery
- `envVars`: built-in skills only; keys must exist in `ENV_REGISTRY`

### Forbidden fields

- `origin`
- `scope`
- `editable`
- `enabledByDriver`

Those values are derived, never trusted from disk.

### Fallback behavior

- missing `skill.json`: warning issue + default manifest
- invalid JSON/schema: error issue + default manifest
- unsupported built-in `envVars`: error issue + unsupported keys dropped
- custom-skill `envVars`: error issue + all requested keys dropped

Default fallback manifest:

```json
{
  "schemaVersion": 1,
  "excludeDirs": [".venv", "__pycache__", ".git", "node_modules"],
  "envVars": []
}
```

---

## 4. Unified Catalog Contract

`src/skills/catalog.ts` enumerates all source roots and returns a single model.

Stable identifier:

- `builtin:<dirName>`
- `local:<dirName>`
- `project:<dirName>`

Catalog entry fields:

- `skillRef`
- `dirName`
- `sourceKind`
- `editable`
- `skillDir`
- `manifest`
- `manifestStatus`
- `toolVariants`
- `variants`
- `name`
- `description`
- `supportFiles`
- `issues`
- `hasErrors`

Error policy:

- invalid dir name: entry excluded
- missing tool variants: entry kept with error issue
- unreadable `SKILL.<tool>.md`: entry kept with error issue
- duplicate `dirName` across roots: all conflicting entries kept with error issue

---

## 5. Stable IDs and Duplicate Names

`SkillRef` is the public identifier used by runtime, persistence, and the dashboard.

```text
builtin:playwright-runner
local:my-research-skill
project:deploy-helper
```

Duplicate `dirName` values across built-in/local/project roots are forbidden in v1.

Reason:

- workdir materialization target is still `<workdir>/.<tool>/skills/<dirName>/`
- same-name entries would collide during seeding

Operational rules:

- catalog discovery marks duplicates with `duplicate-dir-name`
- duplicate entries are excluded from runtime seeding
- custom create routes reject cross-root duplicates with `409`
- adding another driver variant inside the same custom directory is allowed

---

## 6. Global Enablement

Runtime global enablement lives only in SQLite `skill_enablement`.

```sql
CREATE TABLE skill_enablement (
  skill_ref  TEXT NOT NULL,
  tool       TEXT NOT NULL,
  enabled    INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_ref, tool)
);
```

Rules:

- key space is `SkillRef`
- `enabled=1` means globally seedable for that tool
- `enabled=0` means globally disabled for that tool
- missing row applies source-specific defaults

Runtime defaults when no row exists:

- built-in skills: disabled
- local/project custom skills: enabled

---

## 7. Persisted Skill References

Persisted task/agent/orchestrator skill selections use `SkillRef[] | null`.

Canonical contract:

- `TaskExecutionPolicy.enabledSkills: SkillRef[] | null`
- `AiAgent.enabledSkills: SkillRef[] | null`
- `TriggeredTask.enabledSkills: SkillRef[] | null`
- `ScheduledTask.enabledSkills: SkillRef[] | null`
- `OndemandTask.enabledSkills: SkillRef[] | null`
- `Orchestrator.enabledSkills: SkillRef[] | null`

Semantics:

- `null`: inherit global enablement
- `[]`: explicitly seed no skills
- non-empty array: explicit allowlist of built-in and/or custom refs

Validation rules:

- routes validate against the unified catalog
- when the executing tool is known, refs must exist and expose `SKILL.<tool>.md`
- orchestrator-level refs validate catalog membership only because the effective tool is resolved later

---

## 8. Workdir Seeding

`WorkdirManager` seeds skills directly from the unified catalog.

Source roots:

- built-in: resolved built-in catalog root
- local custom: `~/.huskygate/skills/`
- project custom: `<WORKDIR_ROOT>/.huskygate/skills/`

Important properties:

- built-in skills are read directly from their source root
- HuskyGate does not copy built-ins into another `.huskygate/skills/` directory first
- `SKILL.<tool>.md` is materialized as `SKILL.md` in the session workdir
- `scripts/`, `references/`, `requirements.txt`, and other support files are synchronized
- stale previously-seeded files are pruned
- Python skills still support venv setup

Selection semantics:

- `enabledSkills === null` or omitted: use global enablement from `skill_enablement`
- `enabledSkills === []`: seed nothing
- explicit `SkillRef[]`: seed only those refs
- duplicate entries and missing tool variants are skipped at runtime

Env propagation:

- runtime forwards only built-in `manifest.envVars` for seedable entries
- env-var collection logic is shared, but custom manifests contribute no keys
- secret values still come from settings/keychain resolution, not from the skill directory

---

## 9. Dashboard Skills API / UI

The Skills tab is fully unified under `/api/skills/*`.

### Catalog and list

- `GET /api/skills/catalog?tool=&source=`: raw discovery result
- `GET /api/skills?tool=&source=all|builtin|local|project`: unified list used by the Skills tab
- `GET /api/skills?tool=&scope=local|project`: custom-only legacy CRUD list retained for editor flows

Unified list entries include:

- `skillRef`
- `dirName`
- `sourceKind`
- `editable`
- `toolVariants`
- `name`
- `description`
- `supportFiles`
- `excludeDirs`
- `envVars`
- `manifestStatus`
- `issues`
- `enabledByDriver`

### Detail and mutations

- `GET /api/skills/entry/:source/:name`
- `GET|PUT|DELETE /api/skills/entry/:source/:name/files/:filename`
- `PUT /api/skills/entry/:source/:name/toggle`
- `GET|PUT /api/skills/entry/:source/:name/env`

Rules:

- built-in entries are visible but read-only
- local/project entries are editable
- built-in file writes return `403`
- env-var editing is allowed only for built-in keys declared in `skill.json`
- masked secret values round-trip through the settings/keychain patch flow
- toggle requests fail when the requested tool variant is missing

Custom authoring endpoints remain:

- single-driver CRUD: `/api/skills/:tool/:scope/...`
- multi-driver CRUD: `/api/skills/multi/:scope/...`

Removed in Phase 6:

- `/api/builtin-skills/*`
- `builtinSkillsDir` dashboard plumbing
- code-registry-backed built-in metadata for dashboard/runtime behavior

---

## 10. Operational Rules

### Adding a built-in skill

Required files:

- `skills/<name>/skill.json`
- at least one `SKILL.<tool>.md`
- optional `requirements.txt`
- optional `scripts/`
- optional `references/`

No dashboard/server registry update is required unless the skill introduces new editable env keys.

### Creating a custom skill

- local/project custom skills use the same shared directory for all tool variants
- dashboard create/update auto-writes `skill.json` when missing
- support files are shared across drivers inside the same custom directory
- local/project custom skills may not declare `envVars`; secret injection requires a future explicit trust/allowlist mechanism

---

## 11. Verification

```bash
npm run typecheck
npm run test -- src/store/skill-enablement.test.ts src/runner/driver-utils.test.ts
npm run test -- src/skills/catalog.test.ts src/dashboard/routes/skills.coverage.test.ts src/dashboard/skills.coverage.test.ts
npm run test -- src/server/routes/settings-api.coverage.test.ts src/server/api.test.ts
npm run test -- src/workdir/manager.test.ts src/workdir/manager.more.test.ts src/workdir/manager.coverage.test.ts
```

Manual checks:

- `GET /api/skills?tool=claude&source=all` returns built-in/local/project entries with `skillRef`
- built-in entries default to disabled when no `skill_enablement` row exists
- custom entries default to enabled when no `skill_enablement` row exists
- creating a custom skill with a built-in name returns `409`
- built-in file writes return `403`
