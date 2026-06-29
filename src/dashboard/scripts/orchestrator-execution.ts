/** @module dashboard/scripts/orchestrator-execution — Client-side script for orchestrator execution and SSE streaming. */

/**
 * Execute, SSE streaming, delete, runs, rerun, cancel.
 * Depends on: orchestrator.ts (orchCurrent, orchEditingId, orchNormalizeRunStatus,
 *   orchStatusBadgeClass, orchFormatDuration, orchDisplayGateReturnValue,
 *   orchLoadList, orchBackToList, escapeHtml, escapeInlineJsArg, toast, fetchApi)
 * Depends on: orchestrator-editor.ts (dagEditor, orchEditorValidate, orchEditorInit,
 *   orchEditorMinimapInit, orchEditorRenderStatusLamp, orchEditorUpdateRunStatus,
 *   orchEditorMarkDirty, orchEditorDestroy)
 */

export const orchestratorExecutionScript = `
var orchActiveEventSource = null;

function orchFormatGateEval(jsonStr) {
  if (!jsonStr) return '';
  try {
    var g = JSON.parse(jsonStr);
    var mode = (g.mode || '').toUpperCase();
    var result = g.satisfied ? 'pass' : 'fail';
    var resultColor = g.satisfied ? 'var(--green)' : 'var(--red)';
    return '<span style="font-size:0.75rem;">' + escapeHtml(mode) + ' \\u2192 <span style="color:' + resultColor + ';font-weight:600;">' + escapeHtml(result) + '</span></span>';
  } catch (e) {
    return '<code style="font-size:0.7rem;">' + escapeHtml(jsonStr.substring(0, 80)) + '</code>';
  }
}

function orchNodeRunDetailsCell(nr, nodeMeta, uniquePrefix) {
  var parts = [];
  if (nr.gateEvaluation) {
    parts.push('<span class="badge badge-gate badge-sm">Gate</span> ' + orchFormatGateEval(nr.gateEvaluation));
  }
  if (nr.prompt) {
    parts.push('<div class="orun-detail-section">'
      + '<div class="orun-detail-label">Prompt</div>'
      + '<pre class="orun-detail-content">' + escapeHtml(nr.prompt) + '</pre>'
      + '</div>');
  }
  if (nr.outputFull) {
    parts.push('<div class="orun-detail-section">'
      + '<div class="orun-detail-label">Full Output</div>'
      + '<pre class="orun-detail-content">' + escapeHtml(nr.outputFull) + '</pre>'
      + '</div>');
  }
  return parts.length > 0 ? parts.join('') : '<span style="color:var(--text-dim);">-</span>';
}

function orchExecuteFromEditor() {
  if (orchCurrent) orchExecute(orchCurrent.id);
}

function orchValidateFromEditor() {
  if (dagEditor) orchEditorValidate(true);
}

function orchDeleteFromEditor() {
  if (orchCurrent) {
    orchDelete(orchCurrent.id).then(function(ok) { if (ok) orchBackToList(); });
  }
}

async function orchRevertToValidated() {
  if (!orchCurrent || !orchEditingId) return;
  if (!confirm('Revert to the last validated state? All changes since the last validation will be undone.')) return;
  var res = await fetchApi('/api/orchestrators/' + orchEditingId + '/revert', { method: 'POST' });
  if (res && res.ok) {
    toast('Reverted to last validated state', 'success');
    var fresh = await fetchApi('/api/orchestrators/' + orchEditingId);
    if (fresh && fresh.data) {
      orchCurrent = fresh.data;
      orchEditorInit('orch-dag-container');
      orchEditorMinimapInit();
      if (dagEditor) {
        dagEditor.validated = true;
        orchEditorRenderStatusLamp();
      }
    }
  } else {
    var errMsg = (res && res.error) ? res.error : 'Failed to revert';
    toast(errMsg, 'error');
  }
}

async function orchExecute(id) {
  var orch = null;
  if (orchCurrent && orchCurrent.id === id) {
    orch = orchCurrent;
  } else {
    for (var i = 0; i < orchList.length; i++) {
      if (orchList[i].id === id) {
        orch = orchList[i];
        break;
      }
    }
  }
  if (orch && orch.triggerMode === 'webhook') {
    toast('Webhook-triggered orchestrators cannot be started manually.', 'error');
    return;
  }
  if (dagEditor && !dagEditor.validated) {
    toast('Flow must be validated before execution. Click Validate first.', 'error');
    return;
  }
  if (!confirm('Execute this orchestrator?')) return;
  var res = await fetchApi('/api/orchestrators/' + id + '/execute', { method: 'POST' });
  if (res && res.ok) {
    var runId = res.data.runId || '';
    toast('Orchestration started (Run: ' + runId.substring(0, 8) + ')', 'success');
    if (orchCurrent && orchCurrent.id === id) {
      orchLoadRunList(id);
      orchStreamRunStatus(id, runId);
    }
  }
}

function orchStreamRunStatus(orchId, runId) {
  if (orchActiveEventSource) {
    orchActiveEventSource.close();
    orchActiveEventSource = null;
  }

  var url = '/api/orchestrators/' + orchId + '/runs/' + runId + '/stream';
  var es = new EventSource(url);
  orchActiveEventSource = es;

  es.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'done') {
        es.close();
        orchActiveEventSource = null;
        // Clear run-status overlay so DAG nodes return to neutral styling
        if (dagEditor) { dagEditor.runStatuses = {}; orchEditorRender(); }
        if (orchCurrent && orchCurrent.id === orchId) orchLoadRunList(orchId);
        return;
      }
      if (data.type === 'state' && data.nodeRuns) {
        orchUpdateDAGWithRunStatus(data.nodeRuns);
      }
    } catch (e) { /* ignore parse errors */ }
  };

  es.onerror = function() {
    es.close();
    orchActiveEventSource = null;
    if (dagEditor) { dagEditor.runStatuses = {}; orchEditorRender(); }
  };
}

function orchUpdateDAGWithRunStatus(nodeRuns) {
  if (dagEditor) {
    orchEditorUpdateRunStatus(nodeRuns);
  }
}

async function orchDelete(id) {
  if (!confirm('Delete this orchestrator?')) return false;
  var res = await fetchApi('/api/orchestrators/' + id, { method: 'DELETE' });
  if (res && res.ok) {
    toast('Deleted', 'success');
    orchLoadList();
    return true;
  }
  return false;
}

// ── Run List ─────────────────────────────────────────────

async function orchLoadRunList(orchId) {
  var el = document.getElementById('orch-run-list');
  if (!el) return;

  var data = await fetchApi('/api/orchestrators/' + orchId + '/runs');
  if (!data || !data.data) { el.innerHTML = '<div class="empty-state orch-runs-empty">No runs yet</div>'; return; }

  var runs = data.data;
  if (runs.length === 0) { el.innerHTML = '<div class="empty-state orch-runs-empty">No runs yet</div>'; return; }

  var html = '<div class="orch-runs-table-wrap"><table class="data-table orch-runs-table"><thead><tr><th>Run</th><th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th><th>Actions</th></tr></thead><tbody>';
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var runStatus = orchNormalizeRunStatus(r.status);
    var statusClass = orchStatusBadgeClass(runStatus);
    var dur = r.startedAt && r.endedAt ? orchFormatDuration(new Date(r.endedAt) - new Date(r.startedAt)) : (runStatus === 'running' ? 'In progress...' : '-');
    html += '<tr>';
    html += '<td><code>' + escapeHtml((r.id || '').substring(0, 8)) + '</code></td>';
    html += '<td><span class="badge ' + statusClass + '">' + escapeHtml(runStatus) + '</span></td>';
    html += '<td>' + escapeHtml(r.triggeredBy) + '</td>';
    html += '<td>' + (r.startedAt ? new Date(r.startedAt).toLocaleString() : '-') + '</td>';
    html += '<td>' + dur + '</td>';
    html += '<td>';
    html += '<button class="btn btn-sm" onclick="orchViewRun(\\'' + escapeInlineJsArg(orchId) + '\\', \\'' + escapeInlineJsArg(r.id) + '\\')">Details</button>';
    if (runStatus === 'failed') {
      html += ' <button class="btn btn-sm" onclick="orchRerun(\\'' + escapeInlineJsArg(orchId) + '\\', \\'' + escapeInlineJsArg(r.id) + '\\')">Rerun</button>';
    }
    if (runStatus === 'running') {
      html += ' <button class="btn btn-sm btn-danger" onclick="orchCancelRun(\\'' + escapeInlineJsArg(orchId) + '\\', \\'' + escapeInlineJsArg(r.id) + '\\')">Cancel</button>';
    }
    html += '</td></tr>';
  }
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

async function orchViewRun(orchId, runId) {
  var data = await fetchApi('/api/orchestrators/' + orchId + '/runs/' + runId);
  if (!data || !data.data) return;
  var run = data.data;
  var nodeRuns = run.nodeRuns || [];

  var html = '<div class="detail-view orch-run-detail-view">';
  html += '<h3>Run ' + escapeHtml((run.id || '').substring(0, 8)) + ' — ' + escapeHtml(run.status) + '</h3>';
  if (run.errorMessage) html += '<div class="alert alert-error">' + escapeHtml(run.errorMessage) + '</div>';

  var isRunFailed = run.status === 'failed' || run.status === 'completed';
  html += '<div class="orch-runs-table-wrap"><table class="data-table orch-runs-table orch-runs-table-detail orun-nodes-table"><thead><tr><th>Node</th><th>Status</th><th>Return</th><th>Exit</th><th>Duration</th><th>Error</th></tr></thead><tbody>';
  for (var i = 0; i < nodeRuns.length; i++) {
    var nr = nodeRuns[i];
    var nodeName = nr.nodeId;
    var nodeMeta = null;
    if (orchCurrent && orchCurrent.nodes) {
      nodeMeta = orchCurrent.nodes.find(function(n) { return n.id === nr.nodeId; }) || null;
      if (nodeMeta) nodeName = nodeMeta.label;
    }
    var nodeStatus = orchNormalizeRunStatus(nr.status);
    var statusClass = orchStatusBadgeClass(nodeStatus);
    var dur = nr.startedAt && nr.endedAt ? orchFormatDuration(new Date(nr.endedAt) - new Date(nr.startedAt)) : '-';
    var returnValue = nr.returnValue || '-';
    if (nodeMeta && nodeMeta.nodeType === 'gate') returnValue = orchDisplayGateReturnValue(returnValue);
    var hasDetail = nr.prompt || nr.outputFull || nr.gateEvaluation;
    var detailId = 'orch-viewrun-detail-' + (nr.id || String(i));
    html += '<tr' + (hasDetail ? ' class="orun-expandable-row" onclick="orunToggleDetail(\\'' + detailId + '\\')"' : '') + '>';
    html += '<td>' + escapeHtml(nodeName);
    if (hasDetail) html += ' <span id="' + detailId + '-chevron" class="orun-row-chevron">\\u25BC</span>';
    html += '</td>';
    html += '<td><span class="badge ' + statusClass + '">' + escapeHtml(nodeStatus) + '</span></td>';
    html += '<td><code>' + escapeHtml(returnValue) + '</code></td>';
    html += '<td>' + (nr.exitCode !== null ? nr.exitCode : '-') + '</td>';
    html += '<td>' + dur + '</td>';
    html += '<td>' + escapeHtml((nr.errorMessage || '').substring(0, 100)) + '</td>';
    html += '</tr>';
    if (hasDetail) {
      html += '<tr id="' + detailId + '" class="orun-detail-row" style="display:none;">';
      html += '<td colspan="6" class="orun-detail-row-content">';
      html += orchNodeRunDetailsCell(nr, nodeMeta, escapeHtml(nr.id || String(i)));
      html += '</td></tr>';
    }
  }
  html += '</tbody></table></div></div>';

  var el = document.getElementById('orch-run-list');
  if (el) {
    var actionsHtml = '<div class="orch-run-detail-actions">'
      + '<button class="btn btn-sm" onclick="orchLoadRunList(\\'' + escapeInlineJsArg(orchId) + '\\')">\\u2190 Back to runs</button>';
    if (isRunFailed) {
      actionsHtml += ' <button class="btn btn-sm" onclick="orchRerun(\\'' + escapeInlineJsArg(orchId) + '\\', \\'' + escapeInlineJsArg(runId) + '\\')">Rerun (full)</button>';
      // Build rerun-from-node selector (deduplicated by nodeId)
      var rerunNodes = [];
      var rerunNodeSeen = {};
      for (var ri = 0; ri < nodeRuns.length; ri++) {
        var rnr = nodeRuns[ri];
        if (rerunNodeSeen[rnr.nodeId]) continue;
        rerunNodeSeen[rnr.nodeId] = true;
        var rnMeta = orchCurrent && orchCurrent.nodes ? orchCurrent.nodes.find(function(n) { return n.id === rnr.nodeId; }) : null;
        var rnLabel = rnMeta ? rnMeta.label : rnr.nodeId.substring(0, 8);
        rerunNodes.push({ id: rnr.nodeId, label: rnLabel });
      }
      if (rerunNodes.length > 1) {
        actionsHtml += ' <select id="orch-rerun-from-node" class="settings-input" style="display:inline-block;width:auto;max-width:200px;font-size:0.78rem;padding:0.2rem 0.4rem;">';
        for (var rni = 0; rni < rerunNodes.length; rni++) {
          actionsHtml += '<option value="' + escapeHtml(rerunNodes[rni].id) + '">' + escapeHtml(rerunNodes[rni].label) + '</option>';
        }
        actionsHtml += '</select>';
        actionsHtml += ' <button class="btn btn-sm" onclick="orchRerunFromSelected(\\'' + escapeInlineJsArg(orchId) + '\\', \\'' + escapeInlineJsArg(runId) + '\\')">Rerun from node</button>';
      }
    }
    actionsHtml += '</div>';
    el.innerHTML = html + actionsHtml;
  }
}

async function orchRerun(orchId, runId, fromNodeId) {
  var msg = fromNodeId ? 'Rerun from the selected node?' : 'Rerun this orchestration?';
  if (!confirm(msg)) return;
  var opts = { method: 'POST' };
  if (fromNodeId) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ fromNodeId: fromNodeId });
  }
  var res = await fetchApi('/api/orchestrators/' + orchId + '/rerun/' + runId, opts);
  if (res && res.ok) {
    var newRunId = res.data && res.data.runId ? res.data.runId.substring(0, 8) : '';
    toast('Rerun started' + (newRunId ? ' (' + newRunId + ')' : ''), 'success');
    orchLoadRunList(orchId);
    if (res.data && res.data.runId) orchStreamRunStatus(orchId, res.data.runId);
  }
}

function orchRerunFromSelected(orchId, runId) {
  var selectEl = document.getElementById('orch-rerun-from-node');
  var fromNodeId = selectEl ? selectEl.value : null;
  orchRerun(orchId, runId, fromNodeId || undefined);
}

async function orchCancelRun(orchId, runId) {
  if (!confirm('Cancel this run?')) return;
  var res = await fetchApi('/api/orchestrators/' + orchId + '/cancel/' + runId, { method: 'POST' });
  if (res && res.ok) {
    toast('Cancelled', 'success');
    orchLoadRunList(orchId);
  }
}
`;
