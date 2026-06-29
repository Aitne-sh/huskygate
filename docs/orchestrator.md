# Task Orchestrator

DAG-based workflow orchestration for AI tasks. Chain Claude, Codex, and Gemini tasks with conditional branching, parallel execution, and Slack notifications.

## Overview

The Orchestrator lets you build multi-step AI workflows as a visual directed acyclic graph (DAG). Each node in the graph is an AI task that runs independently, and edges define the execution order and conditional routing based on task outcomes.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Orchestrator** | A named workflow containing nodes and edges |
| **Node** | A single unit of work: Task, Gate, or End |
| **Edge** | A connection between nodes with optional condition routing |
| **Run** | A single execution of the orchestrator |
| **Return Value** | The output tag a task produces (e.g. `success`, `error`) |

### Node Types

| Type | Color | Purpose |
|------|-------|---------|
| **Start** (root Task) | Green | First task in the flow. Cannot be deleted. Auto-detected as any Task node with no incoming edges |
| **Task** | Blue | Executes an AI tool (Claude / Codex / Gemini) with a prompt |
| **Gate** | Yellow | Evaluates upstream return values to decide branching (AND / OR logic) |
| **End** | Gray | Terminates a flow branch. No output ports |

## Creating an Orchestrator

1. Navigate to **Orchestrators** in the sidebar
2. Click **New Orchestrator**
3. Fill in the settings (see [Settings](#settings)) and click **Create**
4. A default **Start** node is created automatically

## Settings

| Field | Required | Description |
|-------|----------|-------------|
| **Name** | Yes | Display name (e.g. "Deploy Pipeline") |
| **Alias** | No | Short name for Slack triggers (`!orch <alias>` / `!o <alias>`) |
| **Description** | No | Optional description (max 2000 chars) |
| **Workdir** | No | Shared execution directory for all nodes. Leave empty for auto-generated temp dir |
| **Error Policy** | No | `Continue` (default): keep running other nodes on failure. `Fail Fast`: abort immediately |
| **Max Parallelism** | No | Maximum concurrent nodes (1-20, default: 3) |
| **Max Nodes** | No | Safety limit on total DAG nodes (1-200, default: 50) |
| **Timeout (sec)** | No | Overall run timeout. Entire orchestration cancelled after this duration |
| **Instruction File** | No | Written to CLAUDE.md / AGENTS.md / GEMINI.md at runtime. Overrides default template. Shared by all nodes |
| **Slack Notify** | No | Select a user (DM) or channel for run completion notifications |
| **Schedule** | No | `None` (manual), `One-time` (run at specific datetime), or `Recurring` (cron expression) |

### Schedule Options

- **One-time**: Set a specific date/time. The orchestrator runs once at that time.
- **Recurring**: Enter a cron expression (e.g. `0 9 * * 1-5` = weekdays at 9 AM). Set timezone (defaults to the OS timezone if omitted).

## Building a Workflow

### Adding Nodes

Click **+ Add Node** in the toolbar and choose:

- **Task**: An AI-powered step. Configure tool, mode, prompt, and return values.
- **Gate**: A decision point. Evaluates upstream results using AND/OR logic.
- **End**: Marks the end of a branch.

### Connecting Nodes

1. **Drag from output port** (right side circle) to an input port (left side circle)
2. Or **right-click a node** → "Connect from here" then click the target node's input port

### Conditional Edges

Edges can carry a **condition value** that matches against the source node's return values. Double-click an edge label to edit the condition.

Example: A Task node with return values `[success, error, other_return]` creates three output ports. Connect each port to different downstream nodes for conditional branching.

## Configuring Task Nodes

| Field | Description |
|-------|-------------|
| **Label** | Display name shown on the node |
| **Tool** | `claude`, `codex`, or `gemini` |
| **Mode** | `write` (can modify files), `read` (read-only), or `plan` (planning only) |
| **Prompt** | The instruction sent to the AI tool |
| **Max Retries** | Number of retry attempts on failure (0 = no retry) |
| **Timeout (sec)** | Per-node timeout. Overrides the orchestrator-level timeout for this node |
| **Return Values** | List of possible outcomes (e.g. `success`, `error`). The special `other_return` value is auto-added as a catch-all |

### Return Values and Routing

Each task should output a return value tag in its response:

```
<return:success>
```

The orchestrator engine matches this tag against the node's defined `returnValues`:

- **Match found**: Routes to the edge matching that value
- **No match or no tag**: Routes to `other_return` (catch-all)
- **No returnValues defined**: Falls back to legacy `onMissingReturn` policy

Use the **Copy** button next to the Return Value Template in the node panel to copy a ready-to-use prompt snippet.

## Configuring Gate Nodes

Gates evaluate results from upstream nodes before allowing the flow to continue.

| Field | Description |
|-------|-------------|
| **Gate Mode** | `AND` (all upstream must match) or `OR` (any upstream matches) |
| **Match Value** | The return value to check for (default: `success`) |

### Gate Logic

- **AND mode**: All incoming node results must equal the match value. If all match → `pass`, otherwise → `fail`
- **OR mode**: At least one incoming result must match. If any matches → `pass`, otherwise → `fail`

Gate nodes have output ports (typically `pass`, `fail`, `other_return`) for routing based on the evaluation result.

### Gates and Dead Branches

When a branch leading into a gate is skipped (e.g., due to conditional routing upstream), the gate treats that branch as `null` in its evaluation. This has important implications:

**AND mode**: A dead/skipped branch always contributes `null`, which never equals the match value. Therefore, **an AND gate with any dead branch will always evaluate to `fail`**.

Example:

```
A --[left]--> B --> Gate(AND, match='ok')
A --[right]-> C --> Gate
```

If A returns `left`: B runs, C is skipped. Gate evaluates `[B='ok', C=null]` → AND fails because `null ≠ 'ok'`.

**OR mode**: As long as at least one live branch matches, the gate evaluates to `pass`. Dead branches contributing `null` are ignored by the "any matches" logic.

Same example with OR: Gate evaluates `[B='ok', C=null]` → OR passes because B matches.

**Recommendation**: When using conditional branching that may skip some paths into a gate, prefer **OR mode** if you want the gate to pass when any reachable branch succeeds. Use **AND mode** only when you expect all incoming branches to run and succeed.

## Notifications

### Orchestrator-Level

Set **Slack Notify** in Settings to receive a completion summary when the entire run finishes. The summary includes:

- Overall status (completed / failed / cancelled)
- Node tree with per-node status, return values, and durations

### Node-Level

Enable **Notify** on individual nodes for per-step notifications:

| Setting | Description |
|---------|-------------|
| **Enable notifications** | Send notification when this node completes |
| **Notify Channel** | Override the orchestrator-level channel for this specific node. Select from dropdown or enter manually |

**Note**: Gate nodes don't send per-node notifications (they execute synchronously without a job).

### Channel Resolution Order

1. Node-level `notifyChannel` (highest priority)
2. Orchestrator-level `notifyChannel`
3. Global default channel

### Artifacts (`_output/`)

If you want files to be sent to Slack, write them to `workdir/_output/` during task execution.

Artifact lifecycle:

1. Task completion: files in `_output/` are copied to `_artifacts/<jobId>/`
2. After copy: source files are removed from `_output/`
3. Run completion: archived files are uploaded in the Slack completion thread

Limits:

- Maximum scanned files from `_output/`: 10
- Per-file size limit in `_output/`: 50MB (larger files are skipped)
- Run-level artifact upload cap: 10 files

## Running an Orchestrator

### From Dashboard

Click **Run** in the editor toolbar. The run starts immediately and you can watch progress in real-time:

- Node colors change to reflect status (blue=running, green=completed, red=failed, gray=skipped)
- The Runs drawer at the bottom shows run history

### From Slack

```
!orch <alias>
!o <alias>
```

### Via Schedule

Configure a one-time or recurring schedule in Settings. The orchestrator runs automatically at the specified times.

## Validation

Click **Validate** to check the DAG for errors before running:

### Errors (prevent execution)

| Code | Description |
|------|-------------|
| `CYCLE_DETECTED` | The graph contains a cycle (not a valid DAG) |
| `ORPHAN_NODE` | Node has no connections |
| `TASK_NO_TOOL` | Task node missing tool selection |
| `TASK_NO_PROMPT` | Task node missing prompt |
| `GATE_NO_CONDITIONS` | Gate node has no incoming edges to evaluate |
| `END_HAS_OUTGOING` | End node has outgoing edges |
| `SELF_LOOP` | Node connects to itself |
| `DUPLICATE_EDGE` | Same connection exists twice |
| `MAX_NODES_EXCEEDED` | DAG exceeds the max nodes limit |

### Warnings (non-blocking)

| Code | Description |
|------|-------------|
| `NO_TERMINAL_NODE` | No End node found (flow may not terminate cleanly) |
| `UNREACHABLE_EDGE` | Edge can never be traversed |

## Canvas Controls

| Action | Control |
|--------|---------|
| **Pan** | Click and drag on empty canvas |
| **Zoom** | Mouse wheel scroll |
| **Select node** | Click on node |
| **Multi-select** | Ctrl/Cmd + click |
| **Select all** | Ctrl/Cmd + A |
| **Delete** | Select node(s) or edge, press Delete/Backspace |
| **Context menu** | Right-click on node, edge, or canvas |
| **Move node** | Drag node (snaps to 20px grid) |
| **Fit view** | Click "Fit" button in toolbar |
| **Auto Layout** | Click "Auto Layout" to arrange nodes automatically |

## Error Policy Details

| Policy | Behavior |
|--------|----------|
| **Continue** | When a node fails, other independent branches keep running. Failed node's downstream is skipped |
| **Fail Fast** | First failure cancels all running nodes and aborts the entire run |

## Limits

| Setting | Default | Max |
|---------|---------|-----|
| Max Parallelism | 3 | 20 |
| Max Total Nodes | 50 | 200 |
| Run Timeout | No limit | - |
| Node Timeout | No limit (uses global) | - |
| Max Retries | 0 | - |

## LLM Output Logging & Housekeeping

Each orchestrator node run stores two levels of output:

| Column | Content | Purpose |
|--------|---------|---------|
| `output_summary` | First 4,000 chars | Dashboard display, quick inspection |
| `output_full` | Full raw output | `<return:>` tag parsing, debugging |

### Return Tag Parsing

The `<return:value>` tag is parsed from the **full raw output** (`output_full`), not the truncated summary. This ensures that return values emitted after long AI responses are correctly captured and used for DAG edge routing.

### Automatic Cleanup

A background timer runs every **6 hours** to archive old `output_full` data to disk and free DB space.

**Archive path:**

```
data/job-logs/<orchestration_run_id>/<node_id>_<job_id>.log
```

**Defaults:**

| Setting | Default | Description |
|---------|---------|-------------|
| Retention days | 7 | Archive `output_full` older than this |
| Max rows | 1000 | If `output_full IS NOT NULL` exceeds this count, archive oldest first |
| Cleanup interval | 6 hours | Timer period (`setInterval` with `.unref()`) |

**Cleanup steps:**

1. Select node runs where `ended_at` is older than retention days and `output_full IS NOT NULL`
2. Write each to `data/job-logs/<run_id>/<node_id>_<job_id>.log`
3. Set `output_full = NULL` on success
4. If row count still exceeds max, archive oldest rows regardless of age
