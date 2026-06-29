---
name: obsidian-cli
description: >-
  Interact with Obsidian vaults using the official Obsidian CLI (v1.12.4+).
  Create, read, edit, search notes; manage daily notes, properties, tags, tasks,
  links, templates, plugins, and themes. Trigger for any Obsidian vault operation.
---

# Obsidian CLI Skill

Control Obsidian vaults from the terminal using the `obsidian` command.
The CLI communicates with a running Obsidian desktop app instance via IPC.

For the full command reference with every parameter and flag, read
`references/commands.md` in this skill directory before constructing commands.

## Prerequisites

- Obsidian v1.12.4+ with CLI enabled (Settings → General → Command line interface)
- Obsidian desktop app must be running (GUI required — headless servers are not supported)
- `obsidian` binary registered in system PATH
- **HuskyGate note**: This skill requires a desktop environment. It will not function
  on headless servers without a display. Use on machines where Obsidian is actively running.

## Security Constraints

**Never execute these commands without explicit user confirmation:**
- `eval` — arbitrary JavaScript execution inside the Obsidian process
- `command` — arbitrary Obsidian command execution
- `delete` with `permanent` flag — irreversible file deletion (bypasses trash)
- `reload` / `restart` — may cause unsaved data loss
- `plugins:restrict off` — disables community plugin security restrictions
- `dev:cdp` — raw Chrome DevTools Protocol access (equivalent to arbitrary code execution)
- `dev:debug` — attaches the CDP debugger

**Always prefer safe alternatives:**
- `delete` without `permanent` (uses system trash, recoverable)
- `read` before `create overwrite` (verify content before overwriting)
- `diff` / `history` before destructive edits (check versions first)

## Core Syntax

```
obsidian <command> [parameters] [flags]
```

**Parameters** use `key=value` syntax. Quote values containing spaces:
```
obsidian create name="Meeting Notes" content="# Agenda\n\n- Item 1"
```

**Flags** are bare boolean switches (no `=`):
```
obsidian create name="Draft" open overwrite
```

**Multiline content**: use `\n` for newline, `\t` for tab.

**Clipboard output**: append `--copy` to any command to copy output to clipboard.

## Targeting Vaults and Files

### Vault targeting
- If the terminal's cwd is inside a vault folder, that vault is used automatically.
- Otherwise, the most recently focused vault is used.
- To target a specific vault, place `vault=<name>` **before** the command:
  ```
  obsidian vault="My Notes" search query="project"
  ```

### File targeting
Most file-oriented commands accept `file=` or `path=`:
- `file=<name>` — resolves like a wikilink (fuzzy match by name, no extension needed)
- `path=<path>` — exact vault-relative path including extension
- If neither is provided, the **active file** in Obsidian is used.

```
obsidian read file=Recipe
obsidian read path="Cooking/Recipe.md"
```

## Output Formats

Many commands support `format=` to control output:
- `format=json` — structured JSON (best for programmatic parsing)
- `format=tsv` / `format=csv` — tabular
- `format=md` — markdown
- `format=text` — plain text (default for most commands)

The `total` flag returns only a count instead of listing items.

## Available Command Categories

Before constructing any command, read `references/commands.md` for full parameter details.

Files (`read`, `create`, `append`, `prepend`, `open`, `move`, `rename`, `delete`, `files`, `folders`) |
Daily Notes (`daily`, `daily:read`, `daily:append`, `daily:prepend`, `daily:path`) |
Search (`search`, `search:context`, `search:open`) |
Properties & Tags (`property:set`, `property:read`, `property:remove`, `properties`, `tags`, `tag`, `aliases`) |
Tasks (`tasks`, `task`) |
Links (`links`, `backlinks`, `unresolved`, `orphans`, `deadends`) |
Outline (`outline`) |
Templates (`templates`, `template:read`, `template:insert`) |
Bookmarks (`bookmarks`, `bookmark`) |
Bases (`bases`, `base:views`, `base:create`, `base:query`) |
Commands & Hotkeys (`commands`, `command`, `hotkeys`, `hotkey`) |
Tabs & Workspaces (`tabs`, `tab:open`, `recents`, `workspace`, `workspaces`, `workspace:save`, `workspace:load`, `workspace:delete`) |
Plugins (`plugins`, `plugins:enabled`, `plugin`, `plugin:enable`, `plugin:disable`, `plugin:install`, `plugin:uninstall`, `plugin:reload`, `plugins:restrict`) |
Themes & Snippets (`themes`, `theme`, `theme:set`, `theme:install`, `theme:uninstall`, `snippets`, `snippet:enable`, `snippet:disable`) |
File History (`diff`, `history`, `history:list`, `history:read`, `history:restore`, `history:open`) |
Sync (`sync`, `sync:status`, `sync:history`, `sync:read`, `sync:restore`, `sync:open`, `sync:deleted`) |
Publish (`publish:site`, `publish:list`, `publish:status`, `publish:add`, `publish:remove`, `publish:open`) |
Developer (`eval`, `devtools`, `dev:console`, `dev:errors`, `dev:screenshot`, `dev:dom`, `dev:css`, `dev:mobile`, `dev:debug`, `dev:cdp`) |
Other (`help`, `version`, `vault`, `vaults`, `vault:open`, `random`, `random:read`, `wordcount`, `unique`, `web`)

## Best Practices for LLM Execution

1. **Always use `format=json` when parsing output programmatically.**
   Plain text output is for human reading; JSON gives structured data you
   can reliably extract fields from.

2. **Prefer `path=` over `file=` when you know the exact location.**
   `file=` uses fuzzy wikilink resolution which can match the wrong file
   if multiple files share the same name. Use `path=` for precision.

3. **Quote all values containing spaces, special characters, or newlines.**

4. **Use `vault=` as the FIRST parameter when targeting a non-default vault.**
   It must come before the command name.

5. **Chain operations sequentially, not in parallel.**
   The CLI communicates with a single Obsidian instance via IPC. Run commands
   one at a time and wait for each to complete before starting the next.

6. **Check if Obsidian is running before batch operations.**
   Use `pgrep -f Obsidian` (macOS/Linux) to verify. The first command will
   launch Obsidian, but subsequent commands may fail if the app hasn't fully started.

7. **Use `total` flag to get counts before listing large result sets.**

8. **Use `search:context` over `search` when you need matching lines.**
   `search` returns only file paths. `search:context` returns grep-style
   `path:line: text` output, far more useful for locating specific content.

## Common Workflow Patterns

Run each command as a separate shell call, sequentially.

### Add tasks to daily note
1. `obsidian daily` — open/create today's note
2. `obsidian daily:append content="- [ ] Review inbox"`
3. `obsidian daily:append content="- [ ] Check calendar"`
4. `obsidian tasks daily todo` — verify tasks were added

### Search and read
1. `obsidian search query="meeting notes" format=json limit=5` — find matches
2. `obsidian read path="exact/path/from/result.md"` — read a specific result using its exact path

### Create a structured note
1. `obsidian create name="Sprint Review" content="# Sprint Review\n\n## Completed\n\n## In Progress\n\n## Blockers" open`

### Batch property update
Run one command per file (do not use shell `for` loops):
1. `obsidian property:set file="Note1" name=status value=reviewed`
2. `obsidian property:set file="Note2" name=status value=reviewed`
3. `obsidian property:set file="Note3" name=status value=reviewed`

## Error Handling

- If Obsidian is not running, commands may hang or fail silently.
  Check with `pgrep -f Obsidian` (macOS/Linux) or equivalent.
- If a file is not found, `file=` based resolution returns an error.
  Verify file exists with `obsidian files` first when uncertain.
- Commands that modify files (create, append, move, delete) are
  **not reversible** via CLI — use `diff` / `history` commands to
  check versions if needed before destructive operations.
