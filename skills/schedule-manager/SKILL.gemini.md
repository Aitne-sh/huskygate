---
name: schedule-manager
description: >-
  Manage HuskyGate scheduled tasks by calling the internal schedule API.
  Use when the user asks to add/create, edit/update, pause/resume, delete,
  list, or inspect schedule tasks and run history.
  This skill executes the bundled shell runner and handles API payload validation
  for schedule operations.
---

# Schedule Manager

Manage scheduled tasks via `scripts/run_schedule_manager.sh`.
Use this skill whenever the user requests schedule task operations.

## Prerequisites

1. Resolve runner path:

```bash
SKILL_DIR=$(find . -path '*schedule-manager/scripts' -print -quit | xargs dirname)
RUNNER="$SKILL_DIR/scripts/run_schedule_manager.sh"
```

2. Prepare writable temp dir and verify API connectivity:

```bash
mkdir -p .tmp
export TMPDIR="$PWD/.tmp"
bash "$RUNNER" --check
```

If check fails, tell the user to configure:
- `HUSKYGATE_API_BASE`
- `HUSKYGATE_API_SECRET`
- `SCHEDULE_ENABLED=true` (server side)

## Required Input Before Execution

Collect missing fields before API calls.

- Create:
  - `name`, `prompt`, `schedule_type` (`once` or `recurring`)
  - `run_at` (for `once`) or `cron_expr` (for `recurring`)
  - `tool` (`claude`/`codex`/`gemini`), `mode` (`readonly`/`write`)
  - `timezone` — set `"default"` to use the server OS timezone automatically.
    **Unless the user explicitly specifies a timezone, always use `"default"`.**
    You may also pass an IANA timezone string (e.g. `"America/New_York"`).
  - `notify_channel` (or rely on server default)
- Update:
  - `task_id`
  - only fields the user wants to change
- Delete:
  - `task_id`

## Execute Operations

Use file redirection (`<`) for JSON payload input.

List tasks:

```bash
bash "$RUNNER" list
```

Get detail:

```bash
bash "$RUNNER" get <task_id>
```

Create:

```bash
python3 -c '
import json
payload = {
    "name": "平日レポート",
    "tool": "claude",
    "mode": "readonly",
    "prompt": "前日分の進捗を要約",
    "schedule_type": "recurring",
    "cron_expr": "0 9 * * 1-5",
    "timezone": "default",
    "notify_channel": "C01234ABCDE"
}
with open(".tmp/sched_payload.json", "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" create < .tmp/sched_payload.json
```

Update:

```bash
python3 -c '
import json
payload = {"cron_expr": "0 10 * * 1-5", "prompt": "更新後プロンプト"}
with open(".tmp/sched_payload.json", "w") as f:
    json.dump(payload, f)
'
bash "$RUNNER" update <task_id> < .tmp/sched_payload.json
```

Delete:

```bash
bash "$RUNNER" delete <task_id>
```

Pause / Resume / History:

```bash
bash "$RUNNER" pause <task_id>
bash "$RUNNER" resume <task_id>
bash "$RUNNER" history <task_id>
```

## Error Handling

- `CONNECTION_ERROR`: API接続失敗。環境変数設定を確認して停止。
- `API_ERROR_401`/`API_ERROR_403`: 認証失敗。`HUSKYGATE_API_SECRET` を確認して停止。
- `API_ERROR_404`: タスクID不正。IDを再確認。
- `API_ERROR_503`: スケジュール機能が無効。`SCHEDULE_ENABLED=true` を案内。
- `VALIDATION_ERROR`: 入力不足または不正。項目を補って再実行。

Do not silently retry non-transient errors.
