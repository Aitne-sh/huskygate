# Obsidian CLI — Full Command Reference

All commands follow the syntax: `obsidian [vault=<name>] <command> [parameters] [flags]`

- **Parameters**: `key=value` (quote values with spaces: `key="my value"`)
- **Flags**: bare words that toggle behavior (e.g. `open`, `total`, `verbose`)
- **`--copy`**: append to any command to copy output to clipboard
- **`file=<n>`**: fuzzy wikilink-style match (name only, no path/extension needed)
- **`path=<path>`**: exact vault-relative path (e.g. `folder/note.md`)
- **If neither `file=` nor `path=` is given**: active file is used

---

## Table of Contents

1. [General](#general)
2. [Files & Folders](#files--folders)
3. [Daily Notes](#daily-notes)
4. [Search](#search)
5. [Properties](#properties)
6. [Tags](#tags)
7. [Tasks](#tasks)
8. [Links](#links)
9. [Outline](#outline)
10. [Templates](#templates)
11. [Bookmarks](#bookmarks)
12. [Bases](#bases)
13. [Commands & Hotkeys](#commands--hotkeys)
14. [Tabs & Workspaces](#tabs--workspaces)
15. [Random Notes](#random-notes)
16. [Word Count](#word-count)
17. [Unique Notes](#unique-notes)
18. [Web Viewer](#web-viewer)
19. [Vault](#vault)
20. [Plugins](#plugins)
21. [Themes & Snippets](#themes--snippets)
22. [File History](#file-history)
23. [Sync](#sync)
24. [Publish](#publish)
25. [Developer](#developer)

---

## General

### `help`
Show list of all commands, or help for a specific command.
```
<command>          # show help for specific command
```

### `version`
Show Obsidian version number. No parameters.

### `reload`
Reload the app window. No parameters. **Dangerous** — may disrupt unsaved work.

### `restart`
Restart the application. No parameters. **Dangerous**.

---

## Files & Folders

### `file`
Show file info (name, path, extension, size, created, modified).
```
file=<n>           # file name
path=<path>        # file path
```

### `files`
List files in the vault.
```
folder=<path>      # filter by folder
ext=<extension>    # filter by extension
total              # return file count only
```

### `folder`
Show folder info.
```
path=<path>        # (required) folder path
info=files|folders|size  # return specific info only
```

### `folders`
List folders in the vault.
```
folder=<path>      # filter by parent folder
total              # return folder count
```

### `open`
Open a file in Obsidian.
```
file=<n>           # file name
path=<path>        # file path
newtab             # open in new tab
```

### `create`
Create or overwrite a file.
```
name=<n>           # file name
path=<path>        # file path
content=<text>     # initial content (supports \n, \t)
template=<n>       # template to apply
overwrite          # overwrite if file exists
open               # open file after creating
newtab             # open in new tab
```

### `read`
Read file contents.
```
file=<n>           # file name
path=<path>        # file path
```

### `append`
Append content to a file (default: active file).
```
file=<n>           # file name
path=<path>        # file path
content=<text>     # (required) content to append
inline             # append without preceding newline
```

### `prepend`
Prepend content after frontmatter (default: active file).
```
file=<n>           # file name
path=<path>        # file path
content=<text>     # (required) content to prepend
inline             # prepend without trailing newline
```

### `move`
Move or rename a file. Automatically updates internal links if enabled in settings.
```
file=<n>           # file name
path=<path>        # file path
to=<path>          # (required) destination folder or path
```

### `rename`
Rename a file. Extension is preserved automatically if omitted.
```
file=<n>           # file name
path=<path>        # file path
name=<n>           # (required) new file name
```

### `delete`
Delete a file (goes to trash by default).
```
file=<n>           # file name
path=<path>        # file path
permanent          # skip trash, delete permanently
```

---

## Daily Notes

### `daily`
Open today's daily note (creates it if it doesn't exist).
```
paneType=tab|split|window  # pane type to open in
```

### `daily:path`
Get daily note path. Returns expected path even if file doesn't exist yet. No parameters.

### `daily:read`
Read daily note contents. No parameters.

### `daily:append`
Append content to daily note.
```
content=<text>     # (required) content to append
paneType=tab|split|window
inline             # append without newline
open               # open file after adding
```

### `daily:prepend`
Prepend content to daily note.
```
content=<text>     # (required) content to prepend
paneType=tab|split|window
inline             # prepend without newline
open               # open file after adding
```

---

## Search

### `search`
Search vault for text. Returns matching file paths.
```
query=<text>       # (required) search query
path=<folder>      # limit to folder
limit=<n>          # max files to return
format=text|json   # output format (default: text)
total              # return match count only
case               # case sensitive search
```

### `search:context`
Search with matching line context (grep-style `path:line: text` output).
```
query=<text>       # (required) search query
path=<folder>      # limit to folder
limit=<n>          # max files
format=text|json   # output format (default: text)
case               # case sensitive
```

### `search:open`
Open search view in Obsidian GUI.
```
query=<text>       # initial search query
```

---

## Properties

### `properties`
List properties in the vault, or for a specific file.
```
file=<n>           # show properties for file
path=<path>        # show properties for path
name=<n>           # get specific property count
sort=count         # sort by count (default: name)
format=yaml|json|tsv  # output format (default: yaml)
total              # return property count
counts             # include occurrence counts
active             # show properties for active file
```

### `property:set`
Set a property on a file (default: active file).
```
name=<n>           # (required) property name
value=<value>      # (required) property value
type=text|list|number|checkbox|date|datetime  # property type
file=<n>           # file name
path=<path>        # file path
```

### `property:read`
Read a property value from a file.
```
name=<n>           # (required) property name
file=<n>           # file name
path=<path>        # file path
```

### `property:remove`
Remove a property from a file.
```
name=<n>           # (required) property name
file=<n>           # file name
path=<path>        # file path
```

### `aliases`
List aliases in the vault.
```
file=<n>           # file name
path=<path>        # file path
total              # return alias count
verbose            # include file paths
active             # show aliases for active file
```

---

## Tags

### `tags`
List tags in the vault, or for a specific file.
```
file=<n>           # file name
path=<path>        # file path
sort=count         # sort by count (default: name)
total              # return tag count
counts             # include tag counts
format=json|tsv|csv  # output format (default: tsv)
active             # show tags for active file
```

### `tag`
Get tag info.
```
name=<tag>         # (required) tag name
total              # return occurrence count
verbose            # include file list and count
```

---

## Tasks

### `tasks`
List tasks in the vault.
```
file=<n>           # filter by file name
path=<path>        # filter by file path
status="<char>"    # filter by status character
total              # return task count
done               # show completed tasks only
todo               # show incomplete tasks only
verbose            # group by file with line numbers
format=json|tsv|csv  # output format (default: text)
active             # show tasks for active file
daily              # show tasks from daily note
```

### `task`
Show or update a specific task.
```
ref=<path:line>    # task reference (path:line)
file=<n>           # file name
path=<path>        # file path
line=<n>           # line number
status="<char>"    # set status character
toggle             # toggle task status
daily              # target daily note
done               # mark as done ([x])
todo               # mark as todo ([ ])
```

---

## Links

### `links`
List outgoing links from a file.
```
file=<n>           # file name
path=<path>        # file path
total              # return link count
```

### `backlinks`
List backlinks to a file.
```
file=<n>           # target file name
path=<path>        # target file path
counts             # include link counts
total              # return backlink count
format=json|tsv|csv  # output format (default: tsv)
```

### `unresolved`
List unresolved links in vault.
```
total              # return unresolved link count
counts             # include link counts
verbose            # include source files
format=json|tsv|csv  # output format (default: tsv)
```

### `orphans`
List files with no incoming links.
```
total              # return orphan count
```

### `deadends`
List files with no outgoing links.
```
total              # return dead-end count
```

---

## Outline

### `outline`
Show headings for a file.
```
file=<n>           # file name
path=<path>        # file path
format=tree|md|json  # output format (default: tree)
total              # return heading count
```

---

## Templates

### `templates`
List available templates.
```
total              # return template count
```

### `template:read`
Read template content.
```
name=<template>    # (required) template name
title=<title>      # title for variable resolution
resolve            # resolve {{date}}, {{time}}, {{title}} variables
```

### `template:insert`
Insert template into active file.
```
name=<template>    # (required) template name
```

---

## Bookmarks

### `bookmarks`
List bookmarks.
```
total              # return bookmark count
verbose            # include bookmark types
format=json|tsv|csv  # output format (default: tsv)
```

### `bookmark`
Add a bookmark.
```
file=<path>        # file to bookmark
subpath=<subpath>  # subpath (heading or block) within file
folder=<path>      # folder to bookmark
search=<query>     # search query to bookmark
url=<url>          # URL to bookmark
title=<title>      # bookmark title
```

---

## Bases

### `bases`
List all `.base` files in the vault. No parameters.

### `base:views`
List views in the current base file. No parameters.

### `base:create`
Create a new item in a base.
```
file=<n>           # base file name
path=<path>        # base file path
view=<n>           # view name
name=<n>           # new file name
content=<text>     # initial content
open               # open file after creating
newtab             # open in new tab
```

### `base:query`
Query a base and return results.
```
file=<n>           # base file name
path=<path>        # base file path
view=<n>           # view name to query
format=json|csv|tsv|md|paths  # output format (default: json)
```

---

## Commands & Hotkeys

### `commands`
List available Obsidian command IDs.
```
filter=<prefix>    # filter by ID prefix
```

### `command`
Execute an Obsidian command. **Dangerous**.
```
id=<command-id>    # (required) command ID to execute
```

### `hotkeys`
List hotkeys for all commands.
```
total              # return hotkey count
verbose            # show if hotkey is custom
format=json|tsv|csv  # output format (default: tsv)
```

### `hotkey`
Get hotkey for a command.
```
id=<command-id>    # (required) command ID
verbose            # show if custom or default
```

---

## Tabs & Workspaces

### `tabs`
List open tabs.
```
ids                # include tab IDs
```

### `tab:open`
Open a new tab.
```
group=<id>         # tab group ID
file=<path>        # file to open
view=<type>        # view type to open
```

### `recents`
List recently opened files.
```
total              # return recent file count
```

### `workspace`
Show workspace tree.
```
ids                # include workspace item IDs
```

### `workspaces`
List saved workspaces.
```
total              # return workspace count
```

### `workspace:save`
Save current layout as workspace.
```
name=<n>           # workspace name
```

### `workspace:load`
Load a saved workspace.
```
name=<n>           # (required) workspace name
```

### `workspace:delete`
Delete a saved workspace.
```
name=<n>           # (required) workspace name
```

---

## Random Notes

### `random`
Open a random note.
```
folder=<path>      # limit to folder
newtab             # open in new tab
```

### `random:read`
Read a random note (includes path in output).
```
folder=<path>      # limit to folder
```

---

## Word Count

### `wordcount`
Count words and characters (default: active file).
```
file=<n>           # file name
path=<path>        # file path
words              # return word count only
characters         # return character count only
```

---

## Unique Notes

### `unique`
Create a unique note (Zettelkasten-style).
```
name=<text>        # note name
content=<text>     # initial content
paneType=tab|split|window
open               # open file after creating
```

---

## Web Viewer

### `web`
Open URL in web viewer.
```
url=<url>          # (required) URL to open
newtab             # open in new tab
```

---

## Vault

### `vault`
Show vault info.
```
info=name|path|files|folders|size  # return specific info only
```

### `vaults`
List known vaults.
```
total              # return vault count
verbose            # include vault paths
```

### `vault:open`
Switch to a different vault (TUI only).
```
name=<n>           # (required) vault name
```

---

## Plugins

### `plugins`
List installed plugins.
```
filter=core|community  # filter by plugin type
versions               # include version numbers
format=json|tsv|csv    # output format (default: tsv)
```

### `plugins:enabled`
List enabled plugins.
```
filter=core|community
versions
format=json|tsv|csv
```

### `plugins:restrict`
Toggle or check restricted mode. **Dangerous**.
```
on                 # enable restricted mode
off                # disable restricted mode
```

### `plugin`
Get plugin info.
```
id=<plugin-id>     # (required) plugin ID
```

### `plugin:enable`
Enable a plugin.
```
id=<id>            # (required) plugin ID
filter=core|community
```

### `plugin:disable`
Disable a plugin.
```
id=<id>            # (required) plugin ID
filter=core|community
```

### `plugin:install`
Install a community plugin.
```
id=<id>            # (required) plugin ID
enable             # enable after install
```

### `plugin:uninstall`
Uninstall a community plugin.
```
id=<id>            # (required) plugin ID
```

### `plugin:reload`
Reload a plugin (for developers).
```
id=<id>            # (required) plugin ID
```

---

## Themes & Snippets

### `themes`
List installed themes.
```
versions           # include version numbers
```

### `theme`
Show active theme or get info.
```
name=<n>           # theme name for details
```

### `theme:set`
Set active theme.
```
name=<n>           # (required) theme name (empty string for default)
```

### `theme:install`
Install a community theme.
```
name=<n>           # (required) theme name
enable             # activate after install
```

### `theme:uninstall`
Uninstall a theme.
```
name=<n>           # (required) theme name
```

### `snippets`
List installed CSS snippets. No parameters.

### `snippets:enabled`
List enabled CSS snippets. No parameters.

### `snippet:enable`
Enable a CSS snippet.
```
name=<n>           # (required) snippet name
```

### `snippet:disable`
Disable a CSS snippet.
```
name=<n>           # (required) snippet name
```

---

## File History

### `diff`
List or compare versions from File Recovery and Sync.
Versions are numbered from newest (1) to oldest.
```
file=<n>           # file name
path=<path>        # file path
from=<n>           # version number to diff from
to=<n>             # version number to diff to
filter=local|sync  # filter by version source
```

### `history`
List versions from File Recovery only.
```
file=<n>           # file name
path=<path>        # file path
```

### `history:list`
List all files with local history. No parameters.

### `history:read`
Read a local history version.
```
file=<n>           # file name
path=<path>        # file path
version=<n>        # version number (default: 1)
```

### `history:restore`
Restore a local history version.
```
file=<n>           # file name
path=<path>        # file path
version=<n>        # (required) version number
```

### `history:open`
Open file recovery UI.
```
file=<n>           # file name
path=<path>        # file path
```

---

## Sync

### `sync`
Pause or resume sync.
```
on                 # resume sync
off                # pause sync
```

### `sync:status`
Show sync status and usage. No parameters.

### `sync:history`
List sync version history for a file.
```
file=<n>           # file name
path=<path>        # file path
total              # return version count
```

### `sync:read`
Read a sync version.
```
file=<n>           # file name
path=<path>        # file path
version=<n>        # (required) version number
```

### `sync:restore`
Restore a sync version.
```
file=<n>           # file name
path=<path>        # file path
version=<n>        # (required) version number
```

### `sync:open`
Open sync history.
```
file=<n>           # file name
path=<path>        # file path
```

### `sync:deleted`
List deleted files in sync.
```
total              # return deleted file count
```

---

## Publish

### `publish:site`
Show publish site info (slug, URL). No parameters.

### `publish:list`
List published files.
```
total              # return published file count
```

### `publish:status`
List publish changes.
```
total              # return change count
new                # show new files only
changed            # show changed files only
deleted            # show deleted files only
```

### `publish:add`
Publish a file or all changed files.
```
file=<n>           # file name
path=<path>        # file path
changed            # publish all changed files
```

### `publish:remove`
Unpublish a file.
```
file=<n>           # file name
path=<path>        # file path
```

### `publish:open`
Open file on published site.
```
file=<n>           # file name
path=<path>        # file path
```

---

## Developer

All developer commands are considered **dangerous** and may require
`allowDangerousCommands` setting to be enabled (in plugin contexts).

### `devtools`
Toggle Electron dev tools. No parameters.

### `eval`
Execute JavaScript and return result.
```
code=<javascript>  # (required) JavaScript code to execute
```

### `dev:console`
Show captured console messages.
```
limit=<n>          # max messages (default 50)
level=log|warn|error|info|debug  # filter by log level
clear              # clear the console buffer
```

### `dev:errors`
Show captured JavaScript errors.
```
clear              # clear the error buffer
```

### `dev:screenshot`
Take a screenshot (returns base64 PNG).
```
path=<filename>    # output file path
```

### `dev:dom`
Query DOM elements.
```
selector=<css>     # (required) CSS selector
attr=<n>           # get attribute value
css=<prop>         # get CSS property value
total              # return element count
text               # return text content
inner              # return innerHTML instead of outerHTML
all                # return all matches instead of first
```

### `dev:css`
Inspect CSS with source locations.
```
selector=<css>     # (required) CSS selector
prop=<n>           # filter by property name
```

### `dev:mobile`
Toggle mobile emulation.
```
on                 # enable mobile emulation
off                # disable mobile emulation
```

### `dev:debug`
Attach/detach Chrome DevTools Protocol debugger.
```
on                 # attach debugger
off                # detach debugger
```

### `dev:cdp`
Run a Chrome DevTools Protocol command.
```
method=<CDP.method>  # (required) CDP method to call
params=<json>        # method parameters as JSON
```
