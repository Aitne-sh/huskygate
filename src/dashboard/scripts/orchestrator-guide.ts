/** @module dashboard/scripts/orchestrator-guide — Client-side script for the orchestrator searchable guide modal. */

/**
 * Searchable guide modal with navigation sidebar covering all orchestrator features.
 * Depends on: orchestrator.ts (ORCH_ICON, orchFormatDuration, escapeHtml)
 */

export const orchestratorGuideScript = `
function orchGuideContent() {
  var sections = [
    {
      title: 'Quick Start',
      summary: 'Create, connect, validate, and run a DAG safely.',
      icon: ORCH_ICON.play,
      body: '<ol>'
        + '<li>Open <b>Settings</b> and save the orchestrator first</li>'
        + '<li>A <b>Start</b> node is auto-created as the first Task node (cannot be deleted)</li>'
        + '<li>Use <b>+ Add Node</b> to place Task, Triggered, Gate, and End nodes</li>'
        + '<li>Connect nodes by dragging from an <b>output port</b> to an <b>input port</b> or the left edge of a <b>Triggered</b> node</li>'
        + '<li>Ensure all required ports are connected, then click <b>Validate</b></li>'
        + '<li>After successful validation, click <b>Run</b> and monitor statuses in the canvas and run drawer</li>'
        + '</ol>'
    },
    {
      title: 'Orchestrator Settings',
      summary: 'Global scheduling, execution, and notification behavior.',
      icon: ORCH_ICON.edit,
      body: '<table><tr><th>Field</th><th>Behavior</th></tr>'
        + '<tr><td><b>Name</b></td><td>Display name (required)</td></tr>'
        + '<tr><td><b>Alias</b></td><td>Slack trigger alias for <code>!orch &lt;alias&gt;</code> / <code>!o &lt;alias&gt;</code>. Must be unique.</td></tr>'
        + '<tr><td><b>Description</b></td><td>Optional note (up to 2000 chars)</td></tr>'
        + '<tr><td><b>Workdir</b></td><td>Shared directory for all nodes in a run. Empty = auto workspace per run.</td></tr>'
        + '<tr><td><b>Error Policy</b></td><td><code>continue</code> keeps other branches running. <code>fail_fast</code> stops the run on first failure.</td></tr>'
        + '<tr><td><b>Max Parallelism</b></td><td>Maximum concurrent running task nodes (UI: 1-20, default 3)</td></tr>'
        + '<tr><td><b>Max Nodes</b></td><td>DAG validation upper bound (UI: 1-200, default 50)</td></tr>'
        + '<tr><td><b>Timeout (sec)</b></td><td>Overall run timeout. On timeout, running/pending nodes are finalized as <code>skipped</code> and the run becomes <code>failed</code>.</td></tr>'
        + '<tr><td><b>Slack Notify</b></td><td>Run-completion notification target (channel/user)</td></tr>'
        + '<tr><td><b>Schedule</b></td><td><code>None</code>, <code>once</code>, or <code>recurring</code></td></tr>'
        + '<tr><td><b>Run At / Cron / Timezone</b></td><td>Used for scheduled execution. Timezone defaults to the OS timezone if not specified.</td></tr>'
        + '</table>'
        + '<p>When schedule fields change, the system recalculates <code>nextRunAt</code> and clears any active scheduler claim.</p>'
    },
    {
      title: 'Node Types',
      summary: 'Runtime role and constraints of each node.',
      icon: ORCH_ICON.history,
      body: '<table><tr><th>Type</th><th>Color</th><th>Purpose</th></tr>'
        + '<tr><td><span class="guide-badge guide-badge-green">Start</span></td><td>Green</td><td>The first-created Task node with no incoming edges (lowest sortOrder). Input port is hidden. Cannot be deleted in UI.</td></tr>'
        + '<tr><td><span class="guide-badge guide-badge-blue">Task</span></td><td>Blue</td><td>Runs an App (<code>claude</code>, <code>codex</code>, <code>gemini</code>) with prompt, mode, retries, timeout, and return-value routing.</td></tr>'
        + '<tr><td><span class="guide-badge" style="background:rgba(13,138,106,0.12);color:#0D8A6A;">Triggered</span></td><td>Teal</td><td>Waits for a webhook subscription during the run, then resumes with the received payload. Incoming flow connects to the node body; the visible left input port is hidden.</td></tr>'
        + '<tr><td><span class="guide-badge guide-badge-yellow">Gate</span></td><td>Yellow</td><td>Waits for all incoming sources to finish, evaluates AND/OR match, and emits <code>true</code> or <code>false</code> (stored as pass/fail internally).</td></tr>'
        + '<tr><td><span class="guide-badge guide-badge-gray">End</span></td><td>Gray</td><td>Terminal marker. No output ports and cannot have outgoing edges.</td></tr>'
        + '</table>'
    },
    {
      title: 'Task Node Settings',
      summary: 'All task fields and their exact runtime effect.',
      icon: ORCH_ICON.clock,
      body: '<table><tr><th>Field</th><th>Description</th></tr>'
        + '<tr><td><b>Label</b></td><td>Display name on the canvas</td></tr>'
        + '<tr><td><b>App</b></td><td><code>claude</code>, <code>codex</code>, or <code>gemini</code></td></tr>'
        + '<tr><td><b>Mode</b></td><td><code>write</code> (file changes allowed) or <code>readonly</code> (read-only)</td></tr>'
        + '<tr><td><b>Prompt</b></td><td>The instruction sent to the AI tool</td></tr>'
        + '<tr><td><b>Instruction File</b></td><td>Optional custom instruction content. Written as <code>CLAUDE.md</code>, <code>AGENTS.md</code>, or <code>GEMINI.md</code> based on App.</td></tr>'
        + '<tr><td><b>Return Values</b></td><td>Output ports used for routing. System defaults: <code>other_return</code> (unmatched/missing) and <code>error_return</code> (CLI process failure after retries).</td></tr>'
        + '<tr><td><b>Max Retries</b></td><td>Retry attempts after failure (UI allows 0-10)</td></tr>'
        + '<tr><td><b>Timeout (sec)</b></td><td>Per-node timeout passed to runner for this task execution</td></tr>'
        + '<tr><td><b>Notify</b></td><td>Per-node notification on completion and optional channel override</td></tr>'
        + '</table>'
    },
    {
      title: 'Return Tags & Ports',
      summary: 'How task output is parsed and routed.',
      icon: ORCH_ICON.history,
      body: '<p>Task routing is driven by <code>&lt;return:value&gt;</code> tags in output.</p>'
        + '<ul>'
        + '<li>Parser is case-insensitive and uses the <b>last</b> return tag in output.</li>'
        + '<li>Parsed value is trimmed and capped at 500 chars.</li>'
        + '<li>If <code>returnValues</code> exists and parsed value is missing or unmatched, engine routes to <code>other_return</code>.</li>'
        + '<li>If the CLI process fails (crash, timeout, non-zero exit) and retries are exhausted, engine routes to <code>error_return</code>.</li>'
        + '</ul>'
        + '<div class="guide-callout"><code>&lt;return:success&gt;</code> / <code>&lt;return:error&gt;</code> / <code>&lt;return:other_return&gt;</code> / <code>&lt;return:error_return&gt;</code></div>'
        + '<p>Use the <b>Copy</b> button in the node panel to generate a prompt template aligned with current return values.</p>'
    },
    {
      title: 'Edge Conditions',
      summary: 'Condition matching rules for each outgoing edge.',
      icon: ORCH_ICON.edit,
      body: '<table><tr><th>Operator</th><th>Meaning</th></tr>'
        + '<tr><td><code>eq</code></td><td>Exact match</td></tr>'
        + '<tr><td><code>neq</code></td><td>Not equal</td></tr>'
        + '<tr><td><code>in</code></td><td>Comma-separated allow list (example: <code>success,retry</code>)</td></tr>'
        + '<tr><td><code>regex</code></td><td>Regular expression match. Invalid regex or patterns over 200 chars evaluate as non-match.</td></tr>'
        + '</table>'
        + '<ul>'
        + '<li>Empty <code>conditionValue</code> means unconditional edge (always passes).</li>'
        + '<li><code>*</code> means wildcard: passes for any non-null return value.</li>'
        + '<li>Gate aliases are normalized: <code>pass</code> and <code>true</code>, <code>fail</code> and <code>false</code>.</li>'
        + '</ul>'
    },
    {
      title: 'Gate Evaluation',
      summary: 'Exact gate readiness and pass/fail computation.',
      icon: ORCH_ICON.checkCircle,
      body: '<table><tr><th>Step</th><th>Behavior</th></tr>'
        + '<tr><td><b>Readiness</b></td><td>Gate becomes runnable only after all unique incoming source nodes reach terminal state (<code>completed</code>, <code>failed</code>, <code>skipped</code>, <code>cancelled</code>).</td></tr>'
        + '<tr><td><b>Source Inputs</b></td><td>Only completed sources contribute return values. Other terminal statuses contribute <code>null</code>.</td></tr>'
        + '<tr><td><b>Logic</b></td><td><code>and</code>: all sources must match. <code>or</code>: any source may match.</td></tr>'
        + '<tr><td><b>Output</b></td><td>Gate node always completes and returns <code>pass</code> or <code>fail</code> (displayed as <code>true</code> or <code>false</code> in UI).</td></tr>'
        + '</table>'
        + '<p>Gate nodes are synchronization barriers and do not enqueue runner jobs.</p>'
    },
    {
      title: 'Validation & Snapshots',
      summary: 'Dry-run validation, commit validation, and revert behavior.',
      icon: ORCH_ICON.alertCircle,
      body: '<p><b>Validate button</b> sends <code>{ commit: true }</code>. On success, the DAG is marked validated and a snapshot is saved for revert.</p>'
        + '<p>Background auto-validation in editor is dry-run only (no <code>dagValidated</code> update and no snapshot write).</p>'
        + '<table><tr><th>Error Code</th><th>Description</th></tr>'
        + '<tr><td><code>CYCLE_DETECTED</code></td><td>Cycle exists in graph</td></tr>'
        + '<tr><td><code>ORPHAN_NODE</code></td><td>Node is unreachable from any root</td></tr>'
        + '<tr><td><code>MISSING_EDGE_TARGET</code></td><td>Edge references missing source or target node</td></tr>'
        + '<tr><td><code>GATE_NO_MATCH_VALUE</code></td><td>Gate has no matchValue</td></tr>'
        + '<tr><td><code>GATE_NO_INCOMING</code></td><td>Gate has no incoming edges</td></tr>'
        + '<tr><td><code>TASK_NO_TOOL</code></td><td>Task missing App selection</td></tr>'
        + '<tr><td><code>TASK_NO_PROMPT</code></td><td>Task prompt is empty</td></tr>'
        + '<tr><td><code>MAX_NODES_EXCEEDED</code></td><td>Total nodes exceed orchestrator limit</td></tr>'
        + '<tr><td><code>DUPLICATE_EDGE</code></td><td>Duplicate from/to/condition edge exists</td></tr>'
        + '<tr><td><code>END_HAS_OUTGOING</code></td><td>End node has outgoing edge</td></tr>'
        + '<tr><td><code>SELF_LOOP</code></td><td>Edge points to the same node</td></tr>'
        + '<tr><td><code>DISCONNECTED_PORT</code></td><td>Declared output port has no outgoing edge</td></tr>'
        + '</table>'
        + '<p>Warnings are non-blocking (for example <code>NO_TERMINAL_NODE</code>).</p>'
        + '<p><b>Revert</b> restores the last validated snapshot and is blocked while a run for that orchestrator is active.</p>'
    },
    {
      title: 'Execution Behavior',
      summary: 'Concurrency, retries, status lifecycle, and completion rules.',
      icon: ORCH_ICON.loader,
      body: '<table><tr><th>Topic</th><th>Behavior</th></tr>'
        + '<tr><td><b>Start condition</b></td><td>Run requires <code>dagValidated=true</code>. Engine validates DAG again before execution.</td></tr>'
        + '<tr><td><b>Runnable nodes</b></td><td>Resolved in topological order. Task/End use edge-condition readiness. Gate uses terminal-source readiness.</td></tr>'
        + '<tr><td><b>Parallelism</b></td><td>At most <code>maxParallelism</code> task jobs run concurrently.</td></tr>'
        + '<tr><td><b>Retries</b></td><td>Failed task node retries while <code>retryCount &lt; maxRetries</code>.</td></tr>'
        + '<tr><td><b>Error policy</b></td><td><code>fail_fast</code> finalizes run immediately on first failed node. <code>continue</code> allows other runnable branches.</td></tr>'
        + '<tr><td><b>Timeouts</b></td><td>Node timeout is passed per task job. Orchestrator timeout finalizes whole run as failed.</td></tr>'
        + '<tr><td><b>Finalize</b></td><td>When no runnable nodes and no running jobs remain, run finalizes as <code>completed</code> or <code>failed</code>.</td></tr>'
        + '</table>'
        + '<p>Rerun can start from a node. Completed ancestor results from the original run are copied into the new run.</p>'
    },
    {
      title: 'Runs & Operations',
      summary: 'Inspect results, rerun failures, and cancel active runs.',
      icon: ORCH_ICON.history,
      body: '<ul>'
        + '<li>Runs drawer shows recent runs with status, trigger, start time, and duration.</li>'
        + '<li><b>Details</b> shows per-node status, return value, exit code, duration, and errors.</li>'
        + '<li><b>Rerun</b> button is available for failed runs.</li>'
        + '<li><b>Cancel</b> button is available for running runs.</li>'
        + '<li><b>Open Runs</b> provides timeline, filters, node health heatmap, and flow/timing tabs.</li>'
        + '</ul>'
        + '<p>Live node status updates stream via SSE while a run is active.</p>'
    },
    {
      title: 'Notifications & Artifacts',
      summary: 'What is notified, where it is sent, and what files are uploaded.',
      icon: ORCH_ICON.clock,
      body: '<table><tr><th>Scope</th><th>Behavior</th></tr>'
        + '<tr><td><b>Node-level</b></td><td>Sent when node notification is enabled and node completes. Failure notifications depend on <code>notifyOnError</code>.</td></tr>'
        + '<tr><td><b>Run-level</b></td><td>Sent on run finalize with status summary and per-node tree.</td></tr>'
        + '<tr><td><b>Channel priority</b></td><td>Node channel override &gt; orchestrator notify channel &gt; global default channel.</td></tr>'
        + '<tr><td><b>Output folder</b></td><td>To send files to Slack, write them to <code>_output/</code> in the task workdir.</td></tr>'
        + '<tr><td><b>Archive flow</b></td><td>On each task completion, files in <code>_output/</code> are archived to <code>_artifacts/{jobId}/</code> and removed from <code>_output/</code>.</td></tr>'
        + '<tr><td><b>Artifacts upload</b></td><td>On run completion notification, archived artifacts are uploaded in the Slack thread.</td></tr>'
        + '<tr><td><b>Limits</b></td><td>Up to 10 files are uploaded per run; files larger than 50MB in <code>_output/</code> are skipped.</td></tr>'
        + '</table>'
    },
    {
      title: 'Canvas Controls',
      summary: 'Editing and navigation controls in the DAG editor.',
      icon: ORCH_ICON.edit,
      body: '<table><tr><th>Action</th><th>Control</th></tr>'
        + '<tr><td>Pan</td><td>Drag on empty canvas</td></tr>'
        + '<tr><td>Zoom</td><td>Mouse wheel or trackpad pinch</td></tr>'
        + '<tr><td>Select node</td><td>Click</td></tr>'
        + '<tr><td>Multi-select</td><td><span class="guide-kbd">Shift</span> + click</td></tr>'
        + '<tr><td>Select all</td><td><span class="guide-kbd">Ctrl</span>/<span class="guide-kbd">Cmd</span> + <span class="guide-kbd">A</span></td></tr>'
        + '<tr><td>Delete selected</td><td><span class="guide-kbd">Delete</span> / <span class="guide-kbd">Backspace</span></td></tr>'
        + '<tr><td>Open node panel</td><td>Double-click node or click node without dragging</td></tr>'
        + '<tr><td>Edit edge condition</td><td>Double-click edge or edge label (or right-click edge)</td></tr>'
        + '<tr><td>Context menu</td><td>Right-click node, edge, or background</td></tr>'
        + '<tr><td>Connect nodes</td><td>Drag output port to target input port</td></tr>'
        + '<tr><td>Auto layout</td><td>Toolbar button or canvas context menu</td></tr>'
        + '</table>'
    },
    {
      title: 'Slack & Schedule',
      summary: 'How to trigger and manage runs outside the dashboard.',
      icon: ORCH_ICON.play,
      body: '<h4>Slack Commands</h4>'
        + '<div class="guide-callout"><code>!orch &lt;alias-or-id&gt;</code> / <code>!o &lt;alias-or-id&gt;</code><br><code>!orch list</code> / <code>!o list</code><br><code>!orch status &lt;alias-or-id&gt;</code> / <code>!o status &lt;alias-or-id&gt;</code><br><code>!orch cancel &lt;runId&gt;</code> / <code>!o cancel &lt;runId&gt;</code></div>'
        + '<h4>Schedule Behavior</h4>'
        + '<ul>'
        + '<li><b>once</b>: runs at <code>runAt</code>, then <code>nextRunAt</code> becomes null.</li>'
        + '<li><b>recurring</b>: computes next run from cron + timezone each cycle.</li>'
        + '<li>Scheduler uses claim/release to avoid duplicate triggers across workers.</li>'
        + '</ul>'
        + '<p>Runs started from Slack or schedule use the same validation and execution engine as dashboard runs.</p>'
    }
  ];
  return sections;
}

function orchShowGuide() {
  var modal = document.getElementById('orch-guide-modal');
  var nav = document.getElementById('orch-guide-nav');
  var body = document.getElementById('orch-guide-body');
  var search = document.getElementById('orch-guide-search');
  if (!modal || !body || !nav) return;

  var sections = orchGuideContent();
  var navHtml = '';
  var html = '';
  for (var i = 0; i < sections.length; i++) {
    var s = sections[i];
    navHtml += '<button type="button" class="guide-nav-item" data-guide-idx="' + i + '" onclick="orchGuideScrollTo(' + i + ')">';
    navHtml += '<span class="guide-nav-icon">' + s.icon + '</span>';
    navHtml += '<span class="guide-nav-copy"><span class="guide-nav-title">' + s.title + '</span>';
    if (s.summary) navHtml += '<span class="guide-nav-summary">' + s.summary + '</span>';
    navHtml += '</span>';
    navHtml += '</button>';

    html += '<section class="guide-section" id="orch-guide-section-' + i + '" data-guide-idx="' + i + '">';
    html += '<div class="guide-section-head">';
    html += '<span class="guide-section-icon">' + s.icon + '</span>';
    html += '<div class="guide-section-title-wrap">';
    html += '<h3>' + s.title + '</h3>';
    if (s.summary) html += '<p class="guide-section-summary">' + s.summary + '</p>';
    html += '</div>';
    html += '</div>';
    html += '<div class="guide-section-body">' + s.body + '</div>';
    html += '</section>';
  }
  nav.innerHTML = navHtml;
  body.innerHTML = html;
  body.onscroll = orchGuideSyncActiveSection;
  modal.style.display = 'flex';
  if (search) {
    search.value = '';
    search.oninput = function() { orchFilterGuide(search.value); };
    search.focus();
  }
  orchFilterGuide('');
}

function orchCloseGuide() {
  var modal = document.getElementById('orch-guide-modal');
  if (modal) modal.style.display = 'none';
}

function orchGuideSetActiveNav(idx) {
  var nav = document.getElementById('orch-guide-nav');
  if (!nav) return;
  var items = nav.querySelectorAll('.guide-nav-item');
  for (var i = 0; i < items.length; i++) {
    var itemIdx = Number(items[i].getAttribute('data-guide-idx'));
    items[i].classList.toggle('active', itemIdx === idx);
  }
}

function orchGuideSyncActiveSection() {
  var body = document.getElementById('orch-guide-body');
  if (!body) return;
  var sections = body.querySelectorAll('.guide-section:not(.guide-hidden)');
  if (!sections.length) {
    orchGuideSetActiveNav(-1);
    return;
  }
  var bodyTop = body.getBoundingClientRect().top;
  var activeIdx = Number(sections[0].getAttribute('data-guide-idx'));
  for (var i = 0; i < sections.length; i++) {
    var rect = sections[i].getBoundingClientRect();
    if (rect.top - bodyTop <= 72) {
      activeIdx = Number(sections[i].getAttribute('data-guide-idx'));
    }
  }
  orchGuideSetActiveNav(activeIdx);
}

function orchGuideScrollTo(idx) {
  var body = document.getElementById('orch-guide-body');
  var target = document.getElementById('orch-guide-section-' + idx);
  if (!body || !target || target.classList.contains('guide-hidden')) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  orchGuideSetActiveNav(idx);
}

function orchFilterGuide(query) {
  var body = document.getElementById('orch-guide-body');
  var nav = document.getElementById('orch-guide-nav');
  if (!body || !nav) return;
  var sections = body.querySelectorAll('.guide-section');
  var navItems = nav.querySelectorAll('.guide-nav-item');
  var q = query.toLowerCase().trim();
  var anyVisible = false;
  for (var i = 0; i < sections.length; i++) {
    var text = sections[i].textContent.toLowerCase();
    var match = !q || text.indexOf(q) >= 0;
    sections[i].classList.toggle('guide-hidden', !match);
    if (navItems[i]) navItems[i].classList.toggle('guide-hidden', !match);
    if (match) anyVisible = true;
  }
  var noRes = body.querySelector('.guide-no-results');
  if (!anyVisible) {
    if (!noRes) {
      var d = document.createElement('div');
      d.className = 'guide-no-results';
      d.textContent = 'No matching sections found.';
      body.appendChild(d);
    }
  } else if (noRes) {
    noRes.remove();
  }
  orchGuideSyncActiveSection();
}
`;
