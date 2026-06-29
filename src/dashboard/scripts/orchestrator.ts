/** @module dashboard/scripts/orchestrator — Client-side entry point for the Orchestrator tab (shared state and list view). */

/**
 * Shared state, utility functions, list view, and editor view navigation.
 * Must be loaded before all other orchestrator-*.ts scripts.
 */

export const orchestratorScript = `
// ── State ─────────────────────────────────────────────────
var orchList = [];
var orchCurrent = null;       // editing orchestrator data (with nodes/edges)
var orchEditingId = null;     // editing ID (null = new)
var orchRunsCache = {};
var orchEditorActive = false;
var orchSidePanelMode = null; // 'node' | null  (settings use orch-settings-overlay)
var orchSelectedNodeId = null;
var orchChannelsCache = null;
var orchTriggerMode = 'ondemand'; // 'ondemand' | 'webhook'
var ORCH_ICON = SHARED_ICON;
var ORCH_ALLOWED_RUN_STATUSES = {
  pending: true,
  waiting: true,
  running: true,
  completed: true,
  failed: true,
  skipped: true,
  cancelled: true,
};

function orchNormalizeRunStatus(status) {
  var normalized = typeof status === 'string' ? status.toLowerCase().trim() : '';
  return ORCH_ALLOWED_RUN_STATUSES[normalized] ? normalized : 'unknown';
}

function orchStatusBadgeClass(status) {
  var normalized = orchNormalizeRunStatus(status);
  if (normalized === 'completed') return 'badge-success';
  if (normalized === 'failed') return 'badge-error';
  if (normalized === 'running' || normalized === 'waiting' || normalized === 'pending') return 'badge-info';
  if (normalized === 'cancelled' || normalized === 'skipped') return 'badge-warning';
  return 'badge-inactive';
}

function orchRunButtonDisplayFor(orch) {
  if (!orch) return 'none';
  return orch.triggerMode === 'webhook' ? 'none' : '';
}

// ── Slack Channel Selector Helpers ───────────────────────

async function orchLoadChannels(selectId, manualId, currentValue) {
  try {
    var sel = document.getElementById(selectId);
    var manual = document.getElementById(manualId);
    if (!sel || !manual) return;
    if (!orchChannelsCache) {
      var d = await fetchApi('/api/slack/targets', {}, true);
      if (d && d.data && d.data.length) {
        orchChannelsCache = d.data;
      } else {
        sel.style.display = 'none';
        manual.style.display = '';
        return;
      }
    }
    orchRenderChannels(sel, manual, orchChannelsCache);
    if (currentValue) {
      sel.value = currentValue;
      if (!sel.value || sel.value !== currentValue) {
        sel.value = '__manual__';
        manual.style.display = '';
        manual.value = currentValue;
      }
    }
  } catch (err) {
    var sel = document.getElementById(selectId);
    var manual = document.getElementById(manualId);
    if (sel) sel.style.display = 'none';
    if (manual) manual.style.display = '';
  }
}

function orchRenderChannels(sel, manual, targets) {
  sel.style.display = '';
  manual.style.display = 'none';
  while (sel.options.length > 0) sel.remove(0);
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'None';
  sel.appendChild(placeholder);
  for (var i = 0; i < targets.length; i++) {
    var opt = document.createElement('option');
    opt.value = targets[i].id;
    opt.textContent = targets[i].type === 'user'
      ? '\\u{1F464} ' + targets[i].name + ' (DM)'
      : '#' + targets[i].name;
    sel.appendChild(opt);
  }
  var manualOpt = document.createElement('option');
  manualOpt.value = '__manual__';
  manualOpt.textContent = 'Enter ID manually';
  sel.appendChild(manualOpt);
  sel.onchange = function() {
    if (sel.value === '__manual__') { manual.style.display = ''; manual.focus(); }
    else { manual.style.display = 'none'; manual.value = ''; }
  };
}

function orchGetNotifyChannel(selectId, manualId) {
  var sel = document.getElementById(selectId);
  if (sel && sel.style.display !== 'none') {
    if (sel.value === '__manual__') {
      var manual = document.getElementById(manualId);
      return manual ? manual.value.trim() : '';
    }
    return sel.value;
  }
  var manual = document.getElementById(manualId);
  return manual ? manual.value.trim() : '';
}

function orchDisplayGateReturnValue(value) {
  if (value === 'pass') return 'true';
  if (value === 'fail') return 'false';
  return value;
}

function orchSetAddNodeAvailability(enabled) {
  var addBtn = document.getElementById('orch-btn-add-node');
  var menu = document.getElementById('orch-add-menu');
  if (!addBtn) return;
  addBtn.disabled = !enabled;
  if (!enabled && menu) menu.style.display = 'none';
  addBtn.title = enabled
    ? 'Add a node to the canvas'
    : 'Create the orchestrator first to unlock node editing';
}

function orchRenderPreSaveCanvasState() {
  var container = document.getElementById('orch-dag-container');
  if (!container) return;
  container.innerHTML = '';
}

// ── Constants ─────────────────────────────────────────────
function orchBuildReturnTemplate(returnValues) {
  var rvList = returnValues && returnValues.length > 0
    ? returnValues.slice()
    : ['done'];
  var instructionValues = [];
  for (var idx = 0; idx < rvList.length; idx++) {
    if (rvList[idx] !== 'other_return' && rvList[idx] !== 'error_return') instructionValues.push(rvList[idx]);
  }
  if (instructionValues.length === 0) instructionValues = ['done'];
  var lines = [];
  lines.push('IMPORTANT: Follow these output rules exactly.');
  lines.push('Output:');
  lines.push('- Start your response with exactly one return tag in this format: <return:value>.');
  for (var i = 0; i < instructionValues.length; i++) {
    var rv = instructionValues[i];
    if (rv === 'success') {
      lines.push('- Use <return:success> when the task succeeds.');
    } else if (rv === 'error') {
      lines.push('- Use <return:error> when the task fails.');
    } else {
      lines.push('- Use <return:' + rv + '> when the task outcome is "' + rv + '".');
    }
  }
  lines.push('- After the opening tag, continue with the normal response content.');
  lines.push('- Do not include any additional <return:...> tags.');
  lines.push('Example: <return:success> Completed the requested work and verified the result.');
  return lines.join('\\n');
}

/**
 * Build return-tag template from condition→value mappings (auto output mode).
 * Mirrors server-side buildReturnTemplateFromConditions in return-value.ts.
 */
function orchBuildReturnTemplateFromConditions(conditions) {
  if (!conditions || conditions.length === 0) return '';
  var lines = [];
  lines.push('IMPORTANT: Follow these output rules exactly.');
  lines.push('Output:');
  lines.push('- Start your response with exactly one return tag in this format: <return:value>.');
  for (var i = 0; i < conditions.length; i++) {
    var c = conditions[i];
    lines.push('- Use <return:' + c.value + '> when: ' + c.condition);
  }
  lines.push('- After the opening tag, continue with the normal response content.');
  lines.push('- Do not include any additional <return:...> tags.');
  lines.push('Example: <return:' + conditions[0].value + '> Completed the requested work and verified the result.');
  return lines.join('\\n');
}

// ── Shared UI Helpers ─────────────────────────────────────

function orchFieldHtml(label, inputHtml, desc) {
  var html = '<div class="orch-field">';
  html += '<label class="orch-field-label">' + label + '</label>';
  html += inputHtml;
  if (desc) html += '<div class="orch-field-desc">' + desc + '</div>';
  html += '</div>';
  return html;
}

function orchCloseSidePanel() {
  orchSidePanelMode = null;
  orchSelectedNodeId = null;
  var panel = document.getElementById('orch-side-panel');
  if (panel) panel.style.display = 'none';
}

function orchFormatDuration(ms) {
  var s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

// ── Load ──────────────────────────────────────────────────

async function orchLoadList() {
  var data = await fetchApi('/api/orchestrators');
  if (!data) return;
  orchList = data.data || [];
  orchRenderList();
}

function orchRenderList() {
  var el = document.getElementById('orch-list');
  if (!el) return;

  if (orchList.length === 0) {
    el.innerHTML = '<div class="empty-state">No orchestrators yet. Create one to get started.</div>';
    return;
  }

  var html = '<div class="orch-card-list">';
  for (var i = 0; i < orchList.length; i++) {
    var o = orchList[i];
    var oid = escapeInlineJsArg(o.id);

    html += '<div class="orch-card" onclick="orchOpenEditor(\\'' + oid + '\\')">';

    // ── Left: Card Body ──
    html += '<div class="orch-card-body">';

    // Header row: name + badges
    html += '<div class="orch-card-header">';
    html += '<h3 class="orch-card-name">' + escapeHtml(o.name) + '</h3>';
    if (o.status === 'active') {
      html += '<span class="orch-badge orch-badge-active">Active</span>';
    } else {
      html += '<span class="orch-badge orch-badge-paused">Paused</span>';
    }
    if (o.dagValidated) {
      html += '<span class="orch-badge orch-badge-validated">DAG Validated</span>';
    }
    if (o.triggerMode === 'webhook') {
      html += '<span class="orch-badge orch-badge-webhook">Webhook</span>';
    }
    html += '</div>';

    // Description (if any)
    if (o.description) {
      html += '<p class="orch-card-desc">' + escapeHtml(o.description) + '</p>';
    }

    // Stats grid
    html += '<div class="orch-card-stats">';

    // Alias
    if (o.alias) {
      html += '<div class="orch-stat">';
      html += '<span class="orch-stat-label">Shortcut</span>';
      html += '<span class="orch-stat-value"><code>!orch ' + escapeHtml(o.alias) + '</code> / <code>!o ' + escapeHtml(o.alias) + '</code></span>';
      html += '</div>';
    }

    // Trigger type
    html += '<div class="orch-stat">';
    html += '<span class="orch-stat-label">Trigger</span>';
	    if (o.scheduleType === 'recurring') {
	      html += '<span class="orch-stat-value">' + ORCH_ICON.history + ' Recurring <span class="orch-stat-sub">' + escapeHtml(o.cronExpr || '') + '</span></span>';
	    } else if (o.scheduleType === 'once') {
	      html += '<span class="orch-stat-value">' + ORCH_ICON.clock + ' One-time</span>';
	    } else if (o.triggerMode === 'webhook') {
	      html += '<span class="orch-stat-value">Webhook endpoint</span>';
	    } else {
	      html += '<span class="orch-stat-value">' + ORCH_ICON.play + ' Manual only</span>';
	    }
	    html += '</div>';

    // Node count
    html += '<div class="orch-stat">';
    html += '<span class="orch-stat-label">Tasks</span>';
    var nc = o.nodeCount || 0;
    html += '<span class="orch-stat-value">' + nc + ' node' + (nc !== 1 ? 's' : '') + '</span>';
    html += '</div>';

    // Total runs
    html += '<div class="orch-stat">';
    html += '<span class="orch-stat-label">Total Runs</span>';
    html += '<span class="orch-stat-value">' + (o.runCount || 0) + '</span>';
    html += '</div>';

    // Last run
    html += '<div class="orch-stat">';
    html += '<span class="orch-stat-label">Last Run</span>';
    if (o.lastRunAt) {
      var lrDate = new Date(o.lastRunAt).toLocaleString();
      var lrStatus = orchNormalizeRunStatus(o.lastRunStatus);
      var lrClass = 'orch-run-' + lrStatus;
      html += '<span class="orch-stat-value"><span class="orch-run-dot ' + lrClass + '"></span>' + escapeHtml(lrDate) + '</span>';
    } else {
      html += '<span class="orch-stat-value orch-stat-empty">No runs yet</span>';
    }
    html += '</div>';

    // Last run result status
    if (o.lastRunStatus) {
      html += '<div class="orch-stat">';
      html += '<span class="orch-stat-label">Latest Result</span>';
      var resultStatus = orchNormalizeRunStatus(o.lastRunStatus);
      var statusLabel = resultStatus.charAt(0).toUpperCase() + resultStatus.slice(1);
      var resultClass = 'orch-result-' + resultStatus;
      html += '<span class="orch-stat-value"><span class="orch-result-badge ' + resultClass + '">' + escapeHtml(statusLabel) + '</span></span>';
      if (o.lastRunError) {
        html += '<span class="orch-stat-error">' + escapeHtml(o.lastRunError.substring(0, 80)) + '</span>';
      }
      html += '</div>';
    }

    // Next run (for scheduled)
    if (o.nextRunAt) {
      html += '<div class="orch-stat">';
      html += '<span class="orch-stat-label">Next Run</span>';
      html += '<span class="orch-stat-value">' + ORCH_ICON.clock + ' ' + escapeHtml(new Date(o.nextRunAt).toLocaleString()) + '</span>';
      html += '</div>';
    }

    html += '</div>'; // end stats grid
    html += '</div>'; // end body

	    // ── Right: Actions + Chevron ──
	    html += '<div class="orch-card-right">';
	    html += '<div class="orch-card-actions">';
	    if (o.triggerMode !== 'webhook') {
	      html += '<button class="btn orch-btn-run" onclick="event.stopPropagation(); orchExecute(\\'' + oid + '\\')">' + ORCH_ICON.play + ' Run</button>';
	    }
	    html += '<button class="btn orch-btn-runs" onclick="event.stopPropagation(); orchOpenRuns(\\'' + oid + '\\')">' + ORCH_ICON.history + ' Runs</button>';
	    html += '<button class="btn orch-btn-del" onclick="event.stopPropagation(); orchDelete(\\'' + oid + '\\')">' + ORCH_ICON.trash + ' Delete</button>';
	    html += '</div>';
    html += '<span class="orch-card-chevron">\\u{203A}</span>';
    html += '</div>';

    html += '</div>'; // end card
  }
  html += '</div>';
  el.innerHTML = html;
}

// ── Editor View ─────────────────────────────────────────

async function orchOpenEditor(id) {
  if (id) {
    var data = await fetchApi('/api/orchestrators/' + id);
    if (!data || !data.data) return;
    orchCurrent = data.data;
    orchEditingId = id;
    orchTriggerMode = orchCurrent.triggerMode || 'ondemand';
  } else {
    // New orchestrator: show trigger mode selection popup
    orchCurrent = null;
    orchEditingId = null;
    orchShowTriggerModePopup();
    return;
  }

  orchEnterEditorView();
}

function orchShowTriggerModePopup() {
  var popup = document.getElementById('orch-trigger-mode-popup');
  if (popup) popup.style.display = 'flex';
}

function orchCloseTriggerModePopup() {
  var popup = document.getElementById('orch-trigger-mode-popup');
  if (popup) popup.style.display = 'none';
}

function orchSelectTriggerMode(mode) {
  orchTriggerMode = mode;
  orchCloseTriggerModePopup();
  orchEnterEditorView();
}

function orchEnterEditorView() {
  // View toggle — go fullscreen (hide sidebar for more canvas space)
  document.getElementById('orch-list-view').style.display = 'none';
  document.getElementById('orch-editor-view').style.display = '';
  document.body.classList.add('orch-fullscreen');

  // Header
  document.getElementById('orch-editor-title').textContent =
    orchCurrent ? orchCurrent.name : 'New Orchestrator';

  // Action buttons visibility
  var show = orchCurrent ? '' : 'none';
  document.getElementById('orch-btn-run').style.display = orchRunButtonDisplayFor(orchCurrent);
  document.getElementById('orch-btn-delete').style.display = show;
  document.getElementById('orch-btn-validate').style.display = show;
  document.getElementById('orch-btn-revert').style.display = show;

  if (orchCurrent) {
    orchSetAddNodeAvailability(true);
    // Existing: init canvas + DAG editor
    orchEditorInit('orch-dag-container');
    orchEditorMinimapInit();
    orchEditorRenderStatusLamp();
    orchEditorActive = true;
    orchLoadRunList(orchCurrent.id);
    // Show runs drawer
    document.getElementById('orch-runs-drawer').style.display = '';
  } else {
    orchSetAddNodeAvailability(false);
    // New: show empty canvas + settings panel
    orchRenderPreSaveCanvasState();
    document.getElementById('orch-runs-drawer').style.display = 'none';
    orchShowSettingsPanel();
  }
}

function orchBackToList() {
  if (orchActiveEventSource) {
    orchActiveEventSource.close();
    orchActiveEventSource = null;
  }
  if (dagEditor) orchEditorDestroy();
  orchEditorActive = false;
  orchCloseSidePanel();
  orchCloseSettingsOverlay();
  orchCurrent = null;
  orchEditingId = null;
  orchSelectedNodeId = null;
  orchSidePanelMode = null;
  orchTriggerMode = 'ondemand';
  document.getElementById('orch-editor-view').style.display = 'none';
  document.getElementById('orch-list-view').style.display = '';
  document.body.classList.remove('orch-fullscreen');
  orchLoadList();
}

// ── Runs Page Navigation ──────────────────────────────

function orchOpenRuns(orchId) {
  var page = document.getElementById('orch-runs-page');
  var sidebar = document.querySelector('.sidebar');
  var mainContent = document.querySelector('.main-content');
  if (!page) return;

  // Hide sidebar + main content, show runs page
  if (sidebar) sidebar.style.display = 'none';
  if (mainContent) mainContent.style.display = 'none';
  page.style.display = 'flex';

  orchRunsLoad(orchId);
}

function orchCloseRuns() {
  orunStopStreams();
  var page = document.getElementById('orch-runs-page');
  var sidebar = document.querySelector('.sidebar');
  var mainContent = document.querySelector('.main-content');
  if (!page) return;

  page.style.display = 'none';
  if (sidebar) sidebar.style.display = '';
  if (mainContent) mainContent.style.display = '';

  // Clear stale run-status overlay when returning to editor
  if (dagEditor && Object.keys(dagEditor.runStatuses).length > 0) {
    dagEditor.runStatuses = {};
    orchEditorRender();
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var page = document.getElementById('orch-runs-page');
    if (page && page.style.display !== 'none') {
      orchCloseRuns();
    }
  }
});
`;
