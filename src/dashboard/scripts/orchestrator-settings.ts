/** @module dashboard/scripts/orchestrator-settings — Client-side script for the orchestrator settings overlay. */

import { ORCHESTRATOR_DEFAULTS } from '../../orchestrator/orchestrator-limits.js';

/**
 * Settings overlay for orchestrator CRUD (create/update), schedule toggle.
 * Depends on: orchestrator.ts (orchCurrent, orchEditingId, orchTriggerMode, orchFieldHtml, orchLoadChannels,
 *   orchGetNotifyChannel, orchSetAddNodeAvailability, escapeHtml, toast, fetchApi,
 *   orchEditorInit, orchEditorMinimapInit, orchEditorActive)
 */

export const orchestratorSettingsScript = `
var ORCH_DEFAULTS = ${JSON.stringify(ORCHESTRATOR_DEFAULTS)};

async function orchShowSettingsPanel() {
  // Close node side panel if open
  var sidePanel = document.getElementById('orch-side-panel');
  if (sidePanel) sidePanel.style.display = 'none';
  orchSidePanelMode = null;
  orchSelectedNodeId = null;

  var overlay = document.getElementById('orch-settings-overlay');
  var title = document.getElementById('orch-settings-card-title');
  var body = document.getElementById('orch-settings-card-body');
  if (!overlay || !title || !body) return;
  title.textContent = orchEditingId ? 'Orchestrator Settings' : 'New Orchestrator';
  overlay.style.display = '';

  // Ensure skills are loaded before building the form
  await ensureAvailableSkills();

  var o = orchCurrent || {};
  var isWebhook = orchTriggerMode === 'webhook';
  var html = '';

  // Trigger mode indicator (read-only)
  if (orchEditingId) {
    var modeLabel = isWebhook ? 'Webhook' : 'On-Demand';
    var modeColor = isWebhook ? 'var(--purple)' : 'var(--blue-action)';
    html += '<div style="margin-bottom:0.75rem;padding:0.4rem 0.6rem;background:' + (isWebhook ? 'rgba(124,58,237,0.06)' : 'rgba(37,99,235,0.06)') + ';border:1px solid ' + (isWebhook ? 'rgba(124,58,237,0.15)' : 'rgba(37,99,235,0.15)') + ';border-radius:6px;display:flex;align-items:center;gap:0.5rem;">'
      + '<span style="font-size:0.78rem;font-weight:600;color:' + modeColor + ';">Trigger Mode: ' + modeLabel + '</span>'
      + '</div>';
  }

  html += orchFieldHtml('Name', '<input class="settings-input" id="orch-input-name" value="' + escapeHtml(o.name || '') + '" placeholder="Deploy Pipeline">', 'Display name for this orchestrator');

  // Alias — hidden for webhook mode
  if (!isWebhook) {
    html += orchFieldHtml('Alias', '<input class="settings-input" id="orch-input-alias" value="' + escapeHtml(o.alias || '') + '" placeholder="deploy">', 'Short name for Slack triggers (<code>!orch alias</code> / <code>!o alias</code>)');
  }

  html += orchFieldHtml('Description', '<textarea class="settings-input" id="orch-input-description" rows="3" style="resize:vertical;" placeholder="Optional description" maxlength="2000">' + escapeHtml(o.description || '') + '</textarea>', null);
  html += orchFieldHtml('Workdir', '<div style="display:flex;gap:0.4rem;align-items:center;"><input class="settings-input" id="orch-input-workdir" value="' + escapeHtml(o.workdir || '') + '" placeholder="/path/to/project" style="flex:1;" readonly><button type="button" class="btn btn-browse-dir" onclick="pickDirectory(\\\'orch-input-workdir\\\')" style="white-space:nowrap;">Browse</button><button type="button" class="btn" onclick="document.getElementById(\\\'orch-input-workdir\\\').value=\\\'\\\'" style="padding:0.3rem 0.5rem;font-size:0.75rem;" title="Clear">\\u2715</button></div>', 'Default execution directory for task nodes. Leave empty for an auto-generated workspace. Individual task nodes can override this path.');
  html += orchFieldHtml('Error Policy', '<select class="settings-input" id="orch-input-error-policy"><option value="continue"' + ((o.errorPolicy || ORCH_DEFAULTS.errorPolicy) === 'continue' ? ' selected' : '') + '>Continue</option><option value="fail_fast"' + (o.errorPolicy === 'fail_fast' ? ' selected' : '') + '>Fail Fast</option></select>', '<b>Continue</b>: run remaining nodes even if one fails. <b>Fail Fast</b>: abort immediately on first failure.');
  html += orchFieldHtml('Max Parallelism', '<input class="settings-input" type="number" id="orch-input-max-parallelism" value="' + (o.maxParallelism || ORCH_DEFAULTS.maxParallelism) + '" min="1" max="20">', 'Maximum number of nodes that can execute concurrently (1-20).');
  html += orchFieldHtml('Max Nodes', '<input class="settings-input" type="number" id="orch-input-max-nodes" value="' + (o.maxTotalNodes || ORCH_DEFAULTS.maxTotalNodes) + '" min="1" max="200">', 'Maximum allowed nodes in the DAG (safety limit).');
  html += orchFieldHtml('Timeout (sec)', '<input class="settings-input" type="number" id="orch-input-timeout" value="' + (o.timeoutSec || '') + '" placeholder="No limit" min="0">', 'Overall run timeout in seconds. The entire orchestration is cancelled after this duration.');
  html += orchFieldHtml('Max Run Workdirs', '<input class="settings-input" type="number" id="orch-input-max-run-workdirs" value="' + (o.maxRunWorkdirs != null ? o.maxRunWorkdirs : ORCH_DEFAULTS.maxRunWorkdirs) + '" min="0">', 'Maximum number of run workdirs to keep. Older run workdirs are automatically deleted. Set to <b>0</b> to delete immediately after each run. Only applies when no custom workdir is set.');
  html += orchFieldHtml('Additional Instructions', '<textarea class="settings-input" id="orch-input-instruction-file" rows="3" style="resize:vertical;font-family:monospace;" placeholder="Optional">' + escapeHtml(o.instructionFile || '') + '</textarea>', 'Default instructions appended to the built-in instruction file (CLAUDE.md / AGENTS.md / GEMINI.md) at runtime. Task nodes can override or disable instruction-file generation.');
  html += orchFieldHtml('Skills', buildSkillsOnlyHtml('orch-settings', o.enabledSkills || null, null), 'Skills available to all nodes in this orchestrator. MCP access is configured per-node.');

  var summaryEnabled = o.summaryEnabled === true;
  var summaryTool = o.summaryTool || 'claude';
  html += '<div class="settings-section-divider" style="margin:1rem 0 0.5rem;border-top:1px solid var(--border);padding-top:0.75rem;font-weight:600;font-size:0.85rem;color:var(--muted);">Task Summary</div>';
  html += orchFieldHtml('Enable Summary', '<label class="toggle-switch"><input type="checkbox" id="orch-input-summary-enabled" ' + (summaryEnabled ? 'checked' : '') + ' onchange="orchSummaryToggled()"><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Generate AI summary after run completion</span></label>', 'Posts an AI-generated execution summary to the orchestrator notification thread after the run finishes.');
  html += '<div id="orch-summary-tool-row" style="display:' + (summaryEnabled ? '' : 'none') + ';">';
  html += orchFieldHtml('Summary Tool', '<select class="settings-input" id="orch-input-summary-tool"><option value="claude"' + (summaryTool === 'claude' ? ' selected' : '') + '>Claude</option><option value="codex"' + (summaryTool === 'codex' ? ' selected' : '') + '>Codex</option><option value="gemini"' + (summaryTool === 'gemini' ? ' selected' : '') + '>Gemini</option></select>', 'Tool used to write the post-run summary.');
  html += '</div>';

  // Slack Notify — hidden for webhook mode
  if (!isWebhook) {
    html += orchFieldHtml('Slack Notify', '<select class="settings-input" id="orch-input-notify-select"><option value="">None</option><option value="" disabled>Loading...</option></select><input class="settings-input" id="orch-input-notify-manual" style="display:none;" placeholder="Channel ID (e.g. C01234ABCDE)">', 'Slack channel or user ID for run completion notifications.');
  }

  // Schedule — hidden for webhook mode
  if (!isWebhook) {
    html += orchFieldHtml('Schedule', '<select class="settings-input" id="orch-input-schedule-type" onchange="orchScheduleTypeChanged()"><option value="">None (manual)</option><option value="once"' + (o.scheduleType === 'once' ? ' selected' : '') + '>One-time</option><option value="recurring"' + (o.scheduleType === 'recurring' ? ' selected' : '') + '>Recurring (cron)</option></select>', null);
    html += '<div class="orch-sched-once-row" style="display:none;">';
    html += orchFieldHtml('Run At', '<input class="settings-input" type="datetime-local" id="orch-input-run-at" value="' + (o.runAt ? o.runAt.slice(0, 16) : '') + '">', null);
    html += '</div>';
    html += '<div class="orch-sched-recurring-row" style="display:none;">';
    html += orchFieldHtml('Cron', '<input class="settings-input" id="orch-input-cron-expr" value="' + escapeHtml(o.cronExpr || '') + '" placeholder="0 9 * * 1-5">', 'Standard cron expression (min hour day month weekday).');
    html += '</div>';
    html += '<div class="orch-sched-once-row orch-sched-recurring-row" style="display:none;">';
    html += orchFieldHtml('Timezone', '<input class="settings-input" id="orch-input-timezone" value="' + escapeHtml(o.timezone || '') + '" placeholder="System default timezone">', 'Leave blank to use the OS default timezone, or enter an IANA timezone such as <code>America/Los_Angeles</code>.');
    html += '</div>';
  }

  html += '<div class="btn-group" style="margin-top:0.75rem;">';
  html += '<button class="btn btn-primary" onclick="orchSaveSettings()">' + (orchEditingId ? 'Update' : 'Create') + '</button>';
  html += '</div>';
  body.innerHTML = html;

  if (!isWebhook) {
    orchScheduleTypeChanged();
    orchLoadChannels('orch-input-notify-select', 'orch-input-notify-manual', o.notifyChannel || '');
  }
}

function orchCloseSettingsOverlay() {
  var overlay = document.getElementById('orch-settings-overlay');
  if (overlay) overlay.style.display = 'none';
}

function orchSettingsBack() {
  orchCloseSettingsOverlay();
  // If new (unsaved), cancel and go back to list
  if (!orchEditingId) {
    orchBackToList();
  }
  // If editing existing, just close the overlay (stay in editor)
}

// ── Save Settings ─────────────────────────────────────────

async function orchSaveSettings() {
  try {
    var nameEl = document.getElementById('orch-input-name');
    if (!nameEl) { toast('Form error', 'error'); return; }

    var isWebhook = orchTriggerMode === 'webhook';
    var payload = {
      name: nameEl.value.trim(),
      alias: isWebhook ? null : ((document.getElementById('orch-input-alias') || {}).value?.trim() || null),
      description: (document.getElementById('orch-input-description') || {}).value?.trim() || null,
      workdir: (document.getElementById('orch-input-workdir') || {}).value?.trim() || null,
      notifyChannel: isWebhook ? null : (orchGetNotifyChannel('orch-input-notify-select', 'orch-input-notify-manual') || null),
      maxParallelism: parseInt((document.getElementById('orch-input-max-parallelism') || {}).value) || ORCH_DEFAULTS.maxParallelism,
      maxTotalNodes: parseInt((document.getElementById('orch-input-max-nodes') || {}).value) || ORCH_DEFAULTS.maxTotalNodes,
      errorPolicy: (document.getElementById('orch-input-error-policy') || {}).value || ORCH_DEFAULTS.errorPolicy,
      timeoutSec: parseInt((document.getElementById('orch-input-timeout') || {}).value) || null,
      instructionFile: (document.getElementById('orch-input-instruction-file') || {}).value?.trim() || null,
      scheduleType: isWebhook ? null : ((document.getElementById('orch-input-schedule-type') || {}).value || null),
      runAt: isWebhook ? null : ((document.getElementById('orch-input-run-at') || {}).value || null),
      cronExpr: isWebhook ? null : ((document.getElementById('orch-input-cron-expr') || {}).value?.trim() || null),
      timezone: isWebhook ? 'default' : ((document.getElementById('orch-input-timezone') || {}).value?.trim() || 'default'),
      maxRunWorkdirs: (() => { var v = (document.getElementById('orch-input-max-run-workdirs') || {}).value; var n = parseInt(v); return (v === '' || v == null || isNaN(n)) ? ORCH_DEFAULTS.maxRunWorkdirs : Math.max(0, n); })(),
      enabledSkills: readSkillsOnly('orch-settings'),
      summaryEnabled: (document.getElementById('orch-input-summary-enabled') || {}).checked === true,
      summaryTool: (document.getElementById('orch-input-summary-tool') || {}).value || 'claude',
    };

    // Include triggerMode on create
    if (!orchEditingId) {
      payload.triggerMode = orchTriggerMode;
    }

    if (!payload.name) { toast('Name is required', 'error'); return; }

    var url = orchEditingId ? '/api/orchestrators/' + orchEditingId : '/api/orchestrators';
    var method = orchEditingId ? 'PATCH' : 'POST';
    if (orchEditingId && orchCurrent && orchCurrent.updatedAt) payload.updatedAt = orchCurrent.updatedAt;

    var res = await fetchApi(url, { method: method, body: JSON.stringify(payload) });
    if (res && res.ok) {
      toast(orchEditingId ? 'Settings updated' : 'Orchestrator created', 'success');
      orchCloseSettingsOverlay();
      if (!orchEditingId && res.data) {
        // New: set editing ID and enable canvas
        orchEditingId = res.data.id;
        orchTriggerMode = res.data.triggerMode || orchTriggerMode;
        var createdDetail = await fetchApi('/api/orchestrators/' + orchEditingId, null, true);
        orchCurrent = createdDetail && createdDetail.data ? createdDetail.data : res.data;
        document.getElementById('orch-editor-title').textContent = orchCurrent.name;
        document.getElementById('orch-btn-run').style.display = orchRunButtonDisplayFor(orchCurrent);
        document.getElementById('orch-btn-delete').style.display = '';
        document.getElementById('orch-btn-validate').style.display = '';
        document.getElementById('orch-btn-revert').style.display = '';
        orchSetAddNodeAvailability(true);
        document.getElementById('orch-runs-drawer').style.display = '';
        orchEditorInit('orch-dag-container');
        orchEditorMinimapInit();
        orchEditorActive = true;
      } else if (orchEditingId) {
        // Update current data
        var fresh = await fetchApi('/api/orchestrators/' + orchEditingId);
        if (fresh && fresh.data) {
          orchCurrent = fresh.data;
          document.getElementById('orch-editor-title').textContent = orchCurrent.name;
        }
      }
    }
  } catch (err) {
    console.error('orchSaveSettings error:', err);
    toast('Failed to save: ' + (err.message || err), 'error');
  }
}

// ── Schedule Type Toggle ──────────────────────────────────

function orchScheduleTypeChanged() {
  var typeEl = document.getElementById('orch-input-schedule-type');
  if (!typeEl) return;
  var val = typeEl.value;
  var isOnce = val === 'once';
  var isRecurring = val === 'recurring';

  var onceRows = document.querySelectorAll('.orch-sched-once-row');
  var recurRows = document.querySelectorAll('.orch-sched-recurring-row');

  for (var i = 0; i < onceRows.length; i++) {
    var alsoRecurring = onceRows[i].classList.contains('orch-sched-recurring-row');
    onceRows[i].style.display = (isOnce || (alsoRecurring && isRecurring)) ? '' : 'none';
  }
  for (var j = 0; j < recurRows.length; j++) {
    var alsoOnce = recurRows[j].classList.contains('orch-sched-once-row');
    if (alsoOnce) continue;
    recurRows[j].style.display = isRecurring ? '' : 'none';
  }
}

function orchSummaryToggled() {
  var cb = document.getElementById('orch-input-summary-enabled');
  var row = document.getElementById('orch-summary-tool-row');
  if (!cb || !row) return;
  row.style.display = cb.checked ? '' : 'none';
}
`;
