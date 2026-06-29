/** @module dashboard/scripts/orchestrator-runs — Client-side script for the orchestrator runs overview page. */

/**
 * Full-screen page showing runs overview, per-node metrics,
 * DAG flow visualization, and failure heatmap.
 */

export const orchestratorRunsScript = `
// ── Runs Page State ───────────────────────────────────
var orunData = null;       // { orchestrator, runs }
var orunOrchId = null;
var orunFilter = 'all';    // 'all' | 'completed' | 'error' | 'failed' | 'running' | 'cancelled'
var orunExpandedRuns = {};
var orunActiveStreams = {};  // { runId: EventSource }
var ORUN_ALLOWED_RUN_STATUSES = {
  pending: true,
  waiting: true,
  running: true,
  completed: true,
  failed: true,
  skipped: true,
  cancelled: true,
  errored: true,
  not_executed: true,
};

function orunNormalizeRunStatus(status) {
  var normalized = typeof status === 'string' ? status.toLowerCase().trim() : '';
  return ORUN_ALLOWED_RUN_STATUSES[normalized] ? normalized : 'unknown';
}

// ── Load Runs ─────────────────────────────────────────

async function orchRunsLoad(orchId, preserveState) {
  orunStopStreams();
  orunOrchId = orchId;
  if (!preserveState) {
    orunExpandedRuns = {};
    orunFilter = 'all';
  }

  var content = document.getElementById('orch-runs-content');
  if (content) content.innerHTML = '<div class="orun-empty">Loading runs...</div>';

  var res = await fetchApi('/api/orchestrators/' + orchId + '/runs-overview');
  if (!res || !res.data) {
    if (content) content.innerHTML = '<div class="orun-empty">Failed to load runs</div>';
    return;
  }

  orunData = res.data;
  var title = document.getElementById('orch-runs-title');
  if (title) title.textContent = (orunData.orchestrator.name || 'Orchestrator') + ' — Runs';

  orunRender();
}

// ── Main Render ──────────────────────────────────────────

function orunRender() {
  var content = document.getElementById('orch-runs-content');
  if (!content || !orunData) return;

  var orch = orunData.orchestrator;
  var allRuns = orunData.runs || [];

  if (allRuns.length === 0) {
    content.innerHTML = '<div class="orun-empty">No runs yet. Execute the orchestrator to see results.</div>';
    return;
  }

  var html = '';

  // ── Aggregate Metrics ──
  html += orunRenderMetrics(allRuns);

  // ── Node Failure Heatmap ──
  html += orunRenderHeatmap(allRuns, orch);

  // ── Error Trace ──
  html += orunRenderErrorTrace(allRuns, orch);

  // ── Filter Bar ──
  html += '<div class="orun-section">';
  html += '<h3 class="orun-section-title">' + SHARED_ICON.history + ' Run Timeline</h3>';
  html += '<div class="orun-filter-row">';
  var filters = ['all', 'completed', 'error', 'failed', 'running', 'cancelled'];
  for (var fi = 0; fi < filters.length; fi++) {
    var f = filters[fi];
    var cnt;
    if (f === 'all') { cnt = allRuns.length; }
    else if (f === 'error') { cnt = allRuns.filter(function(r) { return orunRunHasError(r); }).length; }
    else { cnt = allRuns.filter(function(r) { return r.status === f; }).length; }
    html += '<button class="orun-filter-btn' + (orunFilter === f ? ' active' : '') + '" onclick="orunSetFilter(\\'' + f + '\\')">';
    html += f.charAt(0).toUpperCase() + f.slice(1) + ' (' + cnt + ')';
    html += '</button>';
  }
  html += '</div>';

  // ── Run Timeline ──
  var runs;
  if (orunFilter === 'all') { runs = allRuns; }
  else if (orunFilter === 'error') { runs = allRuns.filter(function(r) { return orunRunHasError(r); }); }
  else { runs = allRuns.filter(function(r) { return r.status === orunFilter; }); }

  if (runs.length === 0) {
    html += '<div class="orun-empty">No ' + escapeHtml(orunFilter) + ' runs found.</div>';
  } else {
    html += '<div class="orun-timeline">';
    for (var i = 0; i < runs.length; i++) {
      html += orunRenderRun(runs[i], orch, i);
    }
    html += '</div>';
  }
  html += '</div>';

  content.innerHTML = html;

  // Start SSE streams for active runs
  orunStartStreams();
}

// ── Metrics Cards ────────────────────────────────────────

function orunRenderMetrics(runs) {
  var total = runs.length;
  var completed = 0;
  var failed = 0;
  var cancelled = 0;
  var erroredRuns = 0;
  var cleanRuns = 0;
  var totalDuration = 0;
  var durationCount = 0;
  var longestRun = 0;
  var shortestRun = Infinity;
  var erroredNodeRuns = 0;
  var failedNodeRuns = 0;
  var retriedNodes = 0;
  var retriedRuns = 0;
  var maxRetryCount = 0;
  var maxRetryNode = '';

  var allNodes = (orunData && orunData.orchestrator && orunData.orchestrator.nodes) || [];
  var nmap = {};
  for (var k = 0; k < allNodes.length; k++) nmap[allNodes[k].id] = allNodes[k];

  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (r.status === 'completed') completed++;
    if (r.status === 'failed') failed++;
    if (r.status === 'cancelled') cancelled++;
    if (r.startedAt && r.endedAt) {
      var dur = new Date(r.endedAt) - new Date(r.startedAt);
      totalDuration += dur;
      durationCount++;
      if (dur > longestRun) longestRun = dur;
      if (dur < shortestRun) shortestRun = dur;
    }
    var runHasError = false;
    var runHasRetry = false;
    var nrs = r.nodeRuns || [];
    for (var j = 0; j < nrs.length; j++) {
      var mvs = orunVisualStatus(nrs[j], nmap[nrs[j].nodeId]);
      if (mvs === 'failed') failedNodeRuns++;
      if (mvs === 'errored') { erroredNodeRuns++; runHasError = true; }
      if (nrs[j].retryCount > 0) {
        retriedNodes++;
        runHasRetry = true;
        if (nrs[j].retryCount > maxRetryCount) {
          maxRetryCount = nrs[j].retryCount;
          var nd = nmap[nrs[j].nodeId];
          maxRetryNode = nd ? nd.label : nrs[j].nodeId.substring(0, 8);
        }
      }
    }
    if (runHasError) erroredRuns++;
    if (runHasRetry) retriedRuns++;
    if (r.status === 'completed' && !runHasError) cleanRuns++;
  }

  var avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;
  var completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  var cleanRate = total > 0 ? Math.round((cleanRuns / total) * 100) : 0;
  if (shortestRun === Infinity) shortestRun = 0;

  var html = '<div class="orun-metrics">';

  // 1. Total Runs
  var totalBreakdown = completed + ' completed';
  if (failed > 0) totalBreakdown += ' \\u{b7} ' + failed + ' failed';
  if (cancelled > 0) totalBreakdown += ' \\u{b7} ' + cancelled + ' cancelled';
  html += orunMetricCard('Total Runs', total, totalBreakdown, 'neutral',
    'All orchestrator executions');

  // 2. Completion Rate
  html += orunMetricCard('Completion Rate', completionRate + '%', completed + ' of ' + total + ' reached end node', completionRate >= 80 ? 'success' : completionRate >= 50 ? 'warn' : 'danger',
    'Runs reaching end node, including error-routed');

  // 3. Clean Rate
  html += orunMetricCard('Clean Rate', cleanRate + '%', cleanRuns + ' of ' + total + ' with zero issues', cleanRate >= 80 ? 'success' : cleanRate >= 50 ? 'warn' : 'danger',
    'Runs completed with no node errors or failures');

  // 4. Errors
  html += orunMetricCard('Errors', erroredRuns, erroredNodeRuns + ' node errors in ' + erroredRuns + ' runs', erroredRuns > 0 ? 'warn' : 'neutral',
    'Node errors handled by error routing');

  // 5. Failed
  html += orunMetricCard('Failed', failed, failedNodeRuns + ' node failures across all runs', failed > 0 ? 'danger' : 'neutral',
    'Runs that could not reach end node');

  // 6. Retries
  var retriesSub = retriedNodes + ' nodes retried across ' + retriedRuns + ' runs';
  if (maxRetryCount > 0) retriesSub += ' \\u{b7} max ' + maxRetryCount + ' on ' + maxRetryNode;
  html += orunMetricCard('Retries', retriedNodes, retriesSub, retriedNodes > 0 ? 'warn' : 'neutral',
    'Nodes that were re-executed after failure');

  // 7. Avg Duration
  html += orunMetricCard('Avg Duration', orchFormatDuration(avgDuration), 'Shortest: ' + orchFormatDuration(shortestRun) + ' / Longest: ' + orchFormatDuration(longestRun), 'neutral',
    'Average run duration across all completed runs');

  html += '</div>';
  return html;
}

function orunMetricCard(label, value, sub, accent, desc) {
  var cls = 'orun-metric-card';
  if (accent) cls += ' orun-metric-' + accent;
  var html = '<div class="' + cls + '">';
  html += '<div class="orun-metric-label">' + escapeHtml(label) + '</div>';
  html += '<div class="orun-metric-value">' + escapeHtml(String(value)) + '</div>';
  if (sub) html += '<div class="orun-metric-sub">' + escapeHtml(sub) + '</div>';
  if (desc) html += '<div class="orun-metric-desc">' + escapeHtml(desc) + '</div>';
  html += '</div>';
  return html;
}

// ── Node Failure Heatmap ─────────────────────────────────

function orunRenderHeatmap(runs, orch) {
  var nodes = (orch.nodes || []);
  if (nodes.length === 0) return '';

  // Build per-node stats
  var nodeMap = {};
  var nodeStats = {};
  for (var n = 0; n < nodes.length; n++) {
    nodeMap[nodes[n].id] = nodes[n];
    nodeStats[nodes[n].id] = { label: nodes[n].label, type: nodes[n].nodeType, ok: 0, fail: 0, skip: 0, total: 0, totalDur: 0, durCount: 0 };
  }

  for (var i = 0; i < runs.length; i++) {
    var nrs = runs[i].nodeRuns || [];
    for (var j = 0; j < nrs.length; j++) {
      var nr = nrs[j];
      var nd = nodeMap[nr.nodeId];
      var st = nodeStats[nr.nodeId];
      if (!st) continue;
      st.total++;
      var vs = orunVisualStatus(nr, nd);
      if (vs === 'completed') st.ok++;
      else if (vs === 'failed' || vs === 'errored') st.fail++;
      else if (vs === 'skipped' || vs === 'cancelled') st.skip++;
      if (nr.startedAt && nr.endedAt) {
        st.totalDur += (new Date(nr.endedAt) - new Date(nr.startedAt));
        st.durCount++;
      }
    }
  }

  var html = '<div class="orun-section">';
  html += '<h3 class="orun-section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> Node Health</h3>';
  html += '<div class="orun-heatmap">';

  for (var n = 0; n < nodes.length; n++) {
    var nid = nodes[n].id;
    var st = nodeStats[nid];
    if (!st || st.total === 0) continue;

    var rate = st.total > 0 ? Math.round((st.ok / st.total) * 100) : 0;
    var rateClass = rate >= 90 ? 'orun-heatmap-rate-good' : rate >= 60 ? 'orun-heatmap-rate-warn' : 'orun-heatmap-rate-bad';
    var okPct = st.total > 0 ? (st.ok / st.total * 100) : 0;
    var failPct = st.total > 0 ? (st.fail / st.total * 100) : 0;
    var avgDur = st.durCount > 0 ? orchFormatDuration(st.totalDur / st.durCount) : '-';

    html += '<div class="orun-heatmap-node" title="' + escapeHtml(st.label) + '\\nSuccess: ' + st.ok + ' | Fail: ' + st.fail + ' | Skip: ' + st.skip + '\\nAvg Duration: ' + avgDur + '">';
    html += '<div class="orun-heatmap-label">' + escapeHtml(st.label) + '</div>';
    html += '<div class="orun-heatmap-bar">';
    if (okPct > 0) html += '<div class="orun-heatmap-bar-ok" style="width:' + okPct + '%"></div>';
    if (failPct > 0) html += '<div class="orun-heatmap-bar-fail" style="width:' + failPct + '%"></div>';
    var skipPct = 100 - okPct - failPct;
    if (skipPct > 0 && st.skip > 0) html += '<div class="orun-heatmap-bar-skip" style="width:' + skipPct + '%"></div>';
    html += '</div>';
    html += '<div class="orun-heatmap-rate ' + rateClass + '">' + rate + '% (' + avgDur + ')</div>';
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

// ── Error Trace Section ──────────────────────────────────

function orunRenderErrorTrace(runs, orch) {
  var nodes = orch.nodes || [];
  var nmap = {};
  for (var k = 0; k < nodes.length; k++) nmap[nodes[k].id] = nodes[k];

  // Collect all errored + failed node runs with context
  var errors = [];
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var nrs = r.nodeRuns || [];
    for (var j = 0; j < nrs.length; j++) {
      var nr = nrs[j];
      var nd = nmap[nr.nodeId];
      var vs = orunVisualStatus(nr, nd);
      if (vs === 'errored' || vs === 'failed') {
        errors.push({
          runId: r.id,
          runStatus: r.status,
          nodeLabel: nd ? nd.label : nr.nodeId.substring(0, 8),
          nodeType: nd ? nd.nodeType : '-',
          tool: nd && nd.tool ? nd.tool : '-',
          vs: vs,
          errorMessage: nr.errorMessage || '-',
          exitCode: nr.exitCode,
          returnValue: nr.returnValue || '-',
          retryCount: nr.retryCount || 0,
          startedAt: nr.startedAt,
          endedAt: nr.endedAt,
          time: nr.endedAt || nr.startedAt || r.startedAt,
          outputSummary: nr.outputSummary || ''
        });
      }
    }
  }

  if (errors.length === 0) return '';

  // Group by errorMessage for frequency summary
  var msgFreq = {};
  for (var i = 0; i < errors.length; i++) {
    var msg = errors[i].errorMessage;
    if (!msgFreq[msg]) msgFreq[msg] = { count: 0, nodes: {}, lastSeen: '' };
    msgFreq[msg].count++;
    msgFreq[msg].nodes[errors[i].nodeLabel] = true;
    if (errors[i].time > msgFreq[msg].lastSeen) msgFreq[msg].lastSeen = errors[i].time;
  }

  // Sort frequency entries by count desc
  var freqList = [];
  for (var msg in msgFreq) {
    if (!msgFreq.hasOwnProperty(msg)) continue;
    var nodeNames = [];
    for (var n in msgFreq[msg].nodes) { if (msgFreq[msg].nodes.hasOwnProperty(n)) nodeNames.push(n); }
    freqList.push({ msg: msg, count: msgFreq[msg].count, nodes: nodeNames, lastSeen: msgFreq[msg].lastSeen });
  }
  freqList.sort(function(a, b) { return b.count - a.count; });

  // Count retried entries within errors
  var traceRetried = 0;
  for (var i = 0; i < errors.length; i++) {
    if (errors[i].retryCount > 0) traceRetried++;
  }

  var html = '<div class="orun-section orun-error-section">';
  html += '<h3 class="orun-section-title orun-error-section-title">' + SHARED_ICON.xCircle + ' Error Trace <span class="orun-error-badge">' + errors.length + '</span></h3>';

  // ── Summary line ──
  var summaryParts = [errors.length + ' error' + (errors.length !== 1 ? 's' : '')];
  if (traceRetried > 0) summaryParts.push(traceRetried + ' retried');
  summaryParts.push('across ' + freqList.length + ' unique error type' + (freqList.length !== 1 ? 's' : ''));
  html += '<div class="orun-error-summary-line">' + escapeHtml(summaryParts.join(' \\u{b7} ')) + '</div>';

  // ── Frequency summary ──
  html += '<div class="orun-error-freq">';
  html += '<div class="orun-error-freq-title">Error Frequency</div>';
  html += '<table class="orun-error-freq-table"><thead><tr>';
  html += '<th>Error</th><th>Count</th><th>Affected Nodes</th><th>Last Seen</th>';
  html += '</tr></thead><tbody>';
  for (var i = 0; i < freqList.length; i++) {
    var f = freqList[i];
    html += '<tr>';
    html += '<td class="orun-error-msg-cell"><code>' + escapeHtml(f.msg) + '</code></td>';
    html += '<td class="orun-error-count-cell">' + f.count + '</td>';
    html += '<td>' + escapeHtml(f.nodes.join(', ')) + '</td>';
    html += '<td>' + escapeHtml(f.lastSeen ? orunTimeAgo(f.lastSeen) : '-') + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '</div>';

  // ── Detailed error log (most recent first, capped at 20) ──
  var recent = errors.slice(0, 20);
  html += '<div class="orun-error-log">';
  html += '<div class="orun-error-log-title">Recent Errors' + (errors.length > 20 ? ' (showing 20 of ' + errors.length + ')' : ' (' + errors.length + ')') + '</div>';

  for (var i = 0; i < recent.length; i++) {
    var e = recent[i];
    var vsColor = orunVisualColor(e.vs);
    var vsLabel = e.vs === 'errored' ? 'error' : e.vs;
    var rowId = 'orun-errlog-' + i;
    var dur = e.startedAt && e.endedAt ? orchFormatDuration(new Date(e.endedAt) - new Date(e.startedAt)) : '-';

    html += '<div class="orun-errlog-row orun-errlog-' + escapeHtml(e.vs) + '">';

    // Summary bar (clickable)
    html += '<div class="orun-errlog-summary" onclick="orunToggleErrDetail(\\'' + rowId + '\\')">';
    html += '<span class="orun-errlog-indicator" style="background:' + vsColor + '"></span>';
    html += '<span class="orun-errlog-node"><strong>' + escapeHtml(e.nodeLabel) + '</strong></span>';
    html += '<code class="orun-error-msg-inline">' + escapeHtml(e.errorMessage) + '</code>';
    html += '<span class="orun-errlog-meta">';
    html += '<span class="orun-errlog-tag">' + escapeHtml(vsLabel) + '</span>';
    html += '<span>#' + escapeHtml((e.runId || '').substring(0, 8)) + '</span>';
    html += '<span>' + escapeHtml(e.time ? orunTimeAgo(e.time) : '-') + '</span>';
    html += '</span>';
    html += '<span class="orun-errlog-chevron">\\u{203A}</span>';
    html += '</div>';

    // Expandable detail panel
    html += '<div class="orun-errlog-detail" id="' + rowId + '">';
    html += '<div class="orun-errlog-detail-grid">';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Run</span><span class="orun-errlog-field-value">#' + escapeHtml((e.runId || '').substring(0, 8)) + ' <span class="orun-errlog-tag orun-errlog-tag-' + escapeHtml(e.runStatus) + '">' + escapeHtml(e.runStatus) + '</span></span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Node</span><span class="orun-errlog-field-value">' + escapeHtml(e.nodeLabel) + '</span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Type</span><span class="orun-errlog-field-value">' + escapeHtml(e.nodeType) + (e.tool !== '-' ? ' / ' + escapeHtml(e.tool) : '') + '</span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Status</span><span class="orun-errlog-field-value"><span class="orun-errlog-tag orun-errlog-tag-' + escapeHtml(e.vs) + '">' + escapeHtml(vsLabel) + '</span></span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Exit Code</span><span class="orun-errlog-field-value">' + (e.exitCode !== null && e.exitCode !== undefined ? e.exitCode : '-') + '</span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Return</span><span class="orun-errlog-field-value">' + (e.returnValue !== '-' ? '<code>' + escapeHtml(e.returnValue) + '</code>' : '-') + '</span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Retries</span><span class="orun-errlog-field-value">' + e.retryCount + '</span></div>';
    html += '<div class="orun-errlog-field"><span class="orun-errlog-field-label">Duration</span><span class="orun-errlog-field-value">' + escapeHtml(dur) + '</span></div>';
    html += '</div>';

    // Error message + Output log
    if (e.outputSummary) {
      // When output is available, show error as inline label and output as the main detail
      html += '<div class="orun-errlog-output"><span class="orun-errlog-field-label">Output Log</span>';
      html += '<div class="orun-errlog-error-kind"><code class="orun-error-msg-inline">' + escapeHtml(e.errorMessage) + '</code></div>';
      html += '<pre>' + escapeHtml(e.outputSummary) + '</pre></div>';
    } else {
      // No output (e.g. workdir/enqueue failure) — show errorMessage as the primary detail
      html += '<div class="orun-errlog-errmsg"><span class="orun-errlog-field-label">Error</span><pre>' + escapeHtml(e.errorMessage) + '</pre></div>';
    }
    html += '</div>'; // end detail

    html += '</div>'; // end row
  }

  html += '</div>';
  html += '</div>';
  return html;
}

// ── Single Run Render ────────────────────────────────────

function orunRenderRun(run, orch, runIndex) {
  var expanded = !!orunExpandedRuns[run.id];
  var normalizedStatus = orunNormalizeRunStatus(run.status);
  var statusLabel = typeof run.status === 'string' && run.status ? run.status : normalizedStatus;
  var dur = run.startedAt && run.endedAt ? orchFormatDuration(new Date(run.endedAt) - new Date(run.startedAt)) : (normalizedStatus === 'running' ? 'In progress...' : '-');
  var rid = (run.id || '').substring(0, 8);

  var html = '<div class="orun-run' + (expanded ? ' expanded' : '') + '" id="orun-run-' + runIndex + '" data-run-id="' + escapeHtml(run.id) + '">';

  // Header
  html += '<div class="orun-run-header" onclick="orunToggleRun(' + runIndex + ', \\'' + escapeInlineJsArg(run.id) + '\\')">';
  html += '<span class="orun-run-status orun-run-status-' + normalizedStatus + '"></span>';
  html += '<span class="orun-run-label">' + escapeHtml(statusLabel) + '</span>';
  html += '<span class="orun-run-id">#' + escapeHtml(rid) + '</span>';
  html += '<span class="orun-run-meta">';
  html += '<span>' + escapeHtml(run.triggeredBy || 'manual') + '</span>';
  html += '<span>' + escapeHtml(run.startedAt ? orunTimeAgo(run.startedAt) : '-') + '</span>';
  html += '<span>' + escapeHtml(dur) + '</span>';
  html += '</span>';
  html += '<span class="orun-run-chevron">\\u{203A}</span>';
  html += '</div>';

  // Detail (always rendered, shown/hidden via CSS)
  html += '<div class="orun-run-detail">';

  if (run.errorMessage) {
    html += '<div class="orun-run-error">' + escapeHtml(run.errorMessage) + '</div>';
  }

  var nodeRuns = run.nodeRuns || [];
  var nodes = orch.nodes || [];

  if (nodeRuns.length > 0) {
    // Tabs: Flow | Table | Duration
    var tabId = 'rtab-' + runIndex;
    html += '<div class="orun-detail-tabs">';
    html += '<div class="orun-detail-tab active" data-tab="flow" onclick="orunSwitchTab(this, \\'' + tabId + '\\', \\'flow\\')">Flow</div>';
    html += '<div class="orun-detail-tab" data-tab="table" onclick="orunSwitchTab(this, \\'' + tabId + '\\', \\'table\\')">Details</div>';
    html += '<div class="orun-detail-tab" data-tab="duration" onclick="orunSwitchTab(this, \\'' + tabId + '\\', \\'duration\\')">Timing</div>';
    html += '</div>';

    // Flow panel
    html += '<div class="orun-detail-panel active" data-panel="flow" id="' + tabId + '-flow">';
    html += orunRenderDagFlow(nodeRuns, nodes, orch.edges || []);
    html += '</div>';

    // Table panel
    html += '<div class="orun-detail-panel" data-panel="table" id="' + tabId + '-table">';
    html += orunRenderNodeTable(nodeRuns, nodes);
    html += '</div>';

    // Duration panel
    html += '<div class="orun-detail-panel" data-panel="duration" id="' + tabId + '-duration">';
    html += orunRenderDurationChart(nodeRuns, nodes);
    html += '</div>';
  } else {
    html += '<div style="padding:1rem;color:var(--text-dim);font-size:0.82rem;">No node executions recorded.</div>';
  }

  html += '</div>'; // end detail
  html += '</div>'; // end run
  return html;
}

// ── DAG Flow Visualization ───────────────────────────────

function orunRenderDagFlow(nodeRuns, nodes, edges) {
  // Build a node lookup and find topological layers
  var nodeMap = {};
  for (var i = 0; i < nodes.length; i++) nodeMap[nodes[i].id] = nodes[i];

  var nrMap = {};
  for (var i = 0; i < nodeRuns.length; i++) nrMap[nodeRuns[i].nodeId] = nodeRuns[i];

  // Build adjacency from edges
  var incoming = {};
  var outgoing = {};
  for (var i = 0; i < nodes.length; i++) {
    incoming[nodes[i].id] = [];
    outgoing[nodes[i].id] = [];
  }
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    if (outgoing[e.fromNodeId]) outgoing[e.fromNodeId].push(e.toNodeId);
    if (incoming[e.toNodeId]) incoming[e.toNodeId].push(e.fromNodeId);
  }

  // Longest-path layering: each node's layer = max(parent layers) + 1
  var depth = {};
  var visited = {};

  function computeDepth(nid) {
    if (visited[nid]) return depth[nid] || 0;
    visited[nid] = true;
    var parents = incoming[nid] || [];
    var maxParent = -1;
    for (var p = 0; p < parents.length; p++) {
      var pd = computeDepth(parents[p]);
      if (pd > maxParent) maxParent = pd;
    }
    depth[nid] = maxParent + 1;
    return depth[nid];
  }

  var maxDepth = 0;
  for (var i = 0; i < nodes.length; i++) {
    var d = computeDepth(nodes[i].id);
    if (d > maxDepth) maxDepth = d;
  }

  var layers = [];
  for (var lv = 0; lv <= maxDepth; lv++) layers.push([]);
  for (var i = 0; i < nodes.length; i++) {
    var lv = depth[nodes[i].id] || 0;
    layers[lv].push(nodes[i].id);
  }
  // Remove empty layers
  layers = layers.filter(function(l) { return l.length > 0; });

  if (layers.length === 0) return '<div class="orun-empty">No nodes to display</div>';

  var html = '<div class="orun-dag-flow"><div class="orun-dag-flow-inner">';

  for (var li = 0; li < layers.length; li++) {
    if (li > 0) html += '<div class="orun-dag-arrow">\\u{2192}</div>';

    html += '<div class="orun-dag-column">';
    for (var ni = 0; ni < layers[li].length; ni++) {
      var nid = layers[li][ni];
      var node = nodeMap[nid];
      var nr = nrMap[nid];
      html += orunRenderNodeCard(node, nr);
    }
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

// Resolve visual status: DB may say 'completed' but the node had errors semantically.
// Returns: 'completed' | 'failed' | 'errored' | 'running' | 'skipped' | 'cancelled' | 'not_executed' | 'pending' | 'waiting'
function orunVisualStatus(nr, node) {
  if (!nr) return 'not_executed';
  var s = nr.status;
  if (s === 'failed') return 'failed';
  if (s === 'skipped' || s === 'cancelled') return s;
  if (s === 'running' || s === 'waiting' || s === 'pending') return s;
  // s === 'completed' — check for semantic errors
  // Gate nodes return 'fail' as normal routing (not an error), so only
  // flag errorMessage when it's NOT a gate doing its normal true/fail evaluation.
  if (nr.errorMessage) {
    if (node && node.nodeType === 'gate') return 'completed';
    return 'errored';
  }
  return 'completed';
}

// Check if a run has at least one node with errored visual status
// (node completed but has errorMessage, e.g. exit_error with a parsed return value)
function orunRunHasError(run) {
  var nrs = run.nodeRuns || [];
  if (nrs.length === 0) return false;
  var allNodes = (orunData && orunData.orchestrator && orunData.orchestrator.nodes) || [];
  var nmap = {};
  for (var k = 0; k < allNodes.length; k++) nmap[allNodes[k].id] = allNodes[k];
  for (var i = 0; i < nrs.length; i++) {
    var vs = orunVisualStatus(nrs[i], nmap[nrs[i].nodeId]);
    if (vs === 'errored') return true;
  }
  return false;
}

function orunVisualIcon(vs) {
  if (vs === 'completed') return SHARED_ICON.checkCircle;
  if (vs === 'failed' || vs === 'errored') return SHARED_ICON.xCircle;
  if (vs === 'running') return SHARED_ICON.loader;
  if (vs === 'skipped' || vs === 'cancelled') return SHARED_ICON.alertCircle;
  if (vs === 'not_executed') return SHARED_ICON.clock;
  return SHARED_ICON.clock;
}

function orunVisualColor(vs) {
  if (vs === 'completed') return 'var(--green)';
  if (vs === 'failed' || vs === 'errored') return 'var(--red)';
  if (vs === 'running') return 'var(--status-running)';
  if (vs === 'skipped' || vs === 'cancelled') return 'var(--orange)';
  return 'var(--gray-neutral)';
}

function orunRenderNodeCard(node, nr) {
  if (!node) return '';
  var vs = orunVisualStatus(nr, node);
  var statusIcon = orunVisualIcon(vs);

  var html = '<div class="orun-node-card orun-node-card-' + escapeHtml(vs) + '">';
  html += '<span class="orun-node-status-icon">' + statusIcon + '</span>';
  html += '<div class="orun-node-name" title="' + escapeHtml(node.label) + '">' + escapeHtml(node.label) + '</div>';
  html += '<div class="orun-node-type">' + escapeHtml(node.nodeType) + (node.tool ? ' / ' + escapeHtml(node.tool) : '') + '</div>';

  html += '<div class="orun-node-info">';
  if (nr) {
    if (nr.returnValue) html += '<div>Return: <code>' + escapeHtml(nr.returnValue) + '</code></div>';
    if (nr.startedAt && nr.endedAt) html += '<div>' + orchFormatDuration(new Date(nr.endedAt) - new Date(nr.startedAt)) + '</div>';
    if (nr.errorMessage) html += '<div class="err">' + escapeHtml(nr.errorMessage.substring(0, 60)) + '</div>';
    if (nr.retryCount > 0) html += '<div>Retries: ' + nr.retryCount + '</div>';
  } else {
    html += '<div style="color:var(--text-dim);font-style:italic;">Not executed</div>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

// ── Node Detail Table ────────────────────────────────────

function orunToggleDetail(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'table-row' : 'none';
  // Toggle chevron icon on the trigger row
  var chevron = document.getElementById(id + '-chevron');
  if (chevron) chevron.textContent = isHidden ? '\\u25B2' : '\\u25BC';
}

function orunRenderNodeTable(nodeRuns, nodes) {
  var nodeMap = {};
  for (var i = 0; i < nodes.length; i++) nodeMap[nodes[i].id] = nodes[i];

  var html = '<table class="orun-nodes-table">';
  html += '<thead><tr>';
  html += '<th>Node</th><th>Type</th><th>Status</th><th>Return Value</th><th>Exit Code</th><th>Duration</th><th>Output</th><th>Error</th><th>Retries</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < nodeRuns.length; i++) {
    var nr = nodeRuns[i];
    var node = nodeMap[nr.nodeId];
    var name = node ? node.label : nr.nodeId.substring(0, 8);
    var type = node ? node.nodeType : '-';
    var vs = orunVisualStatus(nr, node);
    var statusColor = orunVisualColor(vs);
    var statusLabel = vs === 'errored' ? 'error' : nr.status;
    var dur = nr.startedAt && nr.endedAt ? orchFormatDuration(new Date(nr.endedAt) - new Date(nr.startedAt)) : '-';
    var hasDetail = nr.prompt || nr.outputFull || nr.gateEvaluation;
    var detailId = 'orun-nodedetail-' + (nr.id || String(i));

    html += '<tr' + (hasDetail ? ' class="orun-expandable-row" onclick="orunToggleDetail(\\'' + detailId + '\\')"' : '') + '>';
    html += '<td><strong>' + escapeHtml(name) + '</strong>';
    if (hasDetail) html += ' <span id="' + detailId + '-chevron" class="orun-row-chevron">\\u25BC</span>';
    html += '</td>';
    html += '<td style="font-size:0.72rem;text-transform:uppercase;color:var(--text-dim);">' + escapeHtml(type) + '</td>';
    html += '<td><span class="status-dot" style="background:' + statusColor + '"></span>' + escapeHtml(statusLabel) + '</td>';
    html += '<td>' + (nr.returnValue ? '<code>' + escapeHtml(nr.returnValue) + '</code>' : '<span style="color:var(--text-dim)">-</span>') + '</td>';
    html += '<td>' + (nr.exitCode !== null && nr.exitCode !== undefined ? nr.exitCode : '-') + '</td>';
    html += '<td style="font-family:var(--font-mono);font-size:0.75rem;">' + dur + '</td>';
    html += '<td>';
    if (nr.outputSummary) {
      html += '<div class="orun-output-cell">' + escapeHtml(nr.outputSummary) + '</div>';
    } else {
      html += '<span style="color:var(--text-dim)">-</span>';
    }
    html += '</td>';
    html += '<td>';
    if (nr.errorMessage) {
      html += '<div class="orun-error-cell">' + escapeHtml(nr.errorMessage) + '</div>';
    } else {
      html += '<span style="color:var(--text-dim)">-</span>';
    }
    html += '</td>';
    html += '<td>' + (nr.retryCount || 0) + '</td>';
    html += '</tr>';

    // Expandable detail row for Prompt / Full Output
    if (hasDetail) {
      html += '<tr id="' + detailId + '" class="orun-detail-row" style="display:none;">';
      html += '<td colspan="9" class="orun-detail-row-content">';
      if (nr.gateEvaluation) {
        html += '<div style="margin-bottom:8px;"><span class="badge badge-gate badge-sm">Gate</span> ' + orchFormatGateEval(nr.gateEvaluation) + '</div>';
      }
      if (nr.prompt) {
        html += '<div class="orun-detail-section">';
        html += '<div class="orun-detail-label">Prompt</div>';
        html += '<pre class="orun-detail-content">' + escapeHtml(nr.prompt) + '</pre>';
        html += '</div>';
      }
      if (nr.outputFull) {
        html += '<div class="orun-detail-section">';
        html += '<div class="orun-detail-label">Full Output</div>';
        html += '<pre class="orun-detail-content">' + escapeHtml(nr.outputFull) + '</pre>';
        html += '</div>';
      }
      html += '</td></tr>';
    }
  }

  html += '</tbody></table>';
  return html;
}

// ── Duration Chart ───────────────────────────────────────

function orunRenderDurationChart(nodeRuns, nodes) {
  var nodeMap = {};
  for (var i = 0; i < nodes.length; i++) nodeMap[nodes[i].id] = nodes[i];

  var items = [];
  var maxDur = 0;
  for (var i = 0; i < nodeRuns.length; i++) {
    var nr = nodeRuns[i];
    if (!nr.startedAt || !nr.endedAt) continue;
    var dur = new Date(nr.endedAt) - new Date(nr.startedAt);
    var node = nodeMap[nr.nodeId];
    var name = node ? node.label : nr.nodeId.substring(0, 8);
    var vs = orunVisualStatus(nr, node);
    items.push({ name: name, dur: dur, vs: vs });
    if (dur > maxDur) maxDur = dur;
  }

  if (items.length === 0) return '<div style="padding:1rem;color:var(--text-dim);">No timing data available.</div>';

  var html = '<div class="orun-duration-bars">';
  for (var i = 0; i < items.length; i++) {
    var pct = maxDur > 0 ? Math.max((items[i].dur / maxDur) * 70, 2) : 2;
    var color = orunVisualColor(items[i].vs);
    html += '<div class="orun-duration-bar-item">';
    html += '<div class="orun-duration-bar-time">' + orchFormatDuration(items[i].dur) + '</div>';
    html += '<div class="orun-duration-bar" style="height:' + pct + 'px;background:' + color + ';"></div>';
    html += '<div class="orun-duration-bar-label" title="' + escapeHtml(items[i].name) + '">' + escapeHtml(items[i].name) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// ── Interactions ─────────────────────────────────────────

function orunToggleRun(runIndex, runId) {
  orunExpandedRuns[runId] = !orunExpandedRuns[runId];
  var runEl = document.getElementById('orun-run-' + runIndex);
  if (runEl) {
    runEl.classList.toggle('expanded', !!orunExpandedRuns[runId]);
  }
}

function orunToggleErrDetail(rowId) {
  var el = document.getElementById(rowId);
  if (!el) return;
  var row = el.parentElement;
  if (row) row.classList.toggle('expanded');
}

function orunSetFilter(filter) {
  orunFilter = filter;
  orunRender();
}

function orunSwitchTab(tabEl, tabGroupId, panelName) {
  var parent = tabEl.parentElement;
  var tabs = parent.querySelectorAll('.orun-detail-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  tabEl.classList.add('active');

  var panels = parent.parentElement.querySelectorAll('.orun-detail-panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var target = document.getElementById(tabGroupId + '-' + panelName);
  if (target) target.classList.add('active');
}

// ── Real-time SSE Streaming ──────────────────────────────

function orunStartStreams() {
  orunStopStreams();
  if (!orunData || !orunOrchId) return;
  var runs = orunData.runs || [];
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    if (r.status === 'running' || r.status === 'pending' || r.status === 'waiting') {
      // Auto-expand running runs so user sees live flow
      if (!orunExpandedRuns[r.id]) {
        orunExpandedRuns[r.id] = true;
        var el = document.querySelector('.orun-run[data-run-id="' + r.id + '"]');
        if (el) el.classList.add('expanded');
      }
      orunStreamRun(orunOrchId, r.id);
    }
  }
}

function orunStopStreams() {
  for (var id in orunActiveStreams) {
    if (orunActiveStreams.hasOwnProperty(id)) {
      orunActiveStreams[id].close();
    }
  }
  orunActiveStreams = {};
}

function orunStreamRun(orchId, runId) {
  if (orunActiveStreams[runId]) return;
  var url = '/api/orchestrators/' + orchId + '/runs/' + runId + '/stream';
  var es = new EventSource(url);
  orunActiveStreams[runId] = es;

  es.onmessage = function(event) {
    try {
      var data = JSON.parse(event.data);
      if (data.type === 'done') {
        es.close();
        delete orunActiveStreams[runId];
        // Reload full page to update metrics, heatmap, error trace
        // preserveState=true to keep expanded runs and filter
        orchRunsLoad(orunOrchId, true);
        return;
      }
      if (data.type === 'state' && data.nodeRuns) {
        orunUpdateLiveRun(runId, data);
      }
    } catch (e) { /* ignore parse errors */ }
  };

  es.onerror = function() {
    es.close();
    delete orunActiveStreams[runId];
  };
}

function orunUpdateLiveRun(runId, data) {
  if (!orunData) return;
  var runs = orunData.runs || [];
  var run = null;
  for (var i = 0; i < runs.length; i++) {
    if (runs[i].id === runId) { run = runs[i]; break; }
  }
  if (!run) return;

  // Update run-level fields if final state included
  if (data.run) {
    run.status = data.run.status;
    run.endedAt = data.run.endedAt;
    run.errorMessage = data.run.errorMessage;
  }

  // Merge node run statuses into in-memory data
  var nodeRuns = data.nodeRuns || [];
  if (!run.nodeRuns) run.nodeRuns = [];
  for (var i = 0; i < nodeRuns.length; i++) {
    var nr = nodeRuns[i];
    var found = false;
    for (var j = 0; j < run.nodeRuns.length; j++) {
      if (run.nodeRuns[j].nodeId === nr.nodeId) {
        run.nodeRuns[j].status = nr.status;
        if (nr.returnValue !== undefined) run.nodeRuns[j].returnValue = nr.returnValue;
        if (nr.exitCode !== undefined) run.nodeRuns[j].exitCode = nr.exitCode;
        if (nr.errorMessage !== undefined) run.nodeRuns[j].errorMessage = nr.errorMessage;
        found = true;
        break;
      }
    }
    if (!found) {
      // SSE snapshots are partial — fill defaults for fields not included in stream
      run.nodeRuns.push({
        nodeId: nr.nodeId,
        status: nr.status,
        returnValue: nr.returnValue || null,
        exitCode: nr.exitCode !== undefined ? nr.exitCode : null,
        errorMessage: nr.errorMessage || null,
        startedAt: null,
        endedAt: null,
        retryCount: 0,
        outputSummary: null,
        id: null,
        orchestrationRunId: run.id
      });
    }
  }

  // Update DOM — find by data-run-id for stability across filter changes
  var runEl = document.querySelector('.orun-run[data-run-id="' + runId + '"]');
  if (!runEl) return;

  // Update header: status dot + label
  var normalizedStatus = orunNormalizeRunStatus(run.status);
  var statusDot = runEl.querySelector('.orun-run-status');
  if (statusDot) statusDot.className = 'orun-run-status orun-run-status-' + normalizedStatus;
  var labelEl = runEl.querySelector('.orun-run-label');
  if (labelEl) labelEl.textContent = run.status || normalizedStatus;

  // Update header: duration
  var metaSpans = runEl.querySelectorAll('.orun-run-meta > span');
  if (metaSpans.length >= 3) {
    var dur = run.startedAt && run.endedAt
      ? orchFormatDuration(new Date(run.endedAt) - new Date(run.startedAt))
      : (normalizedStatus === 'running' ? 'In progress...' : '-');
    metaSpans[2].textContent = dur;
  }

  // Re-render detail panels if this run is expanded
  if (orunExpandedRuns[runId]) {
    var orch = orunData.orchestrator;
    var nodes = orch.nodes || [];
    var edges = orch.edges || [];
    var nrData = run.nodeRuns || [];

    var flowPanel = runEl.querySelector('.orun-detail-panel[data-panel="flow"]');
    if (flowPanel) flowPanel.innerHTML = orunRenderDagFlow(nrData, nodes, edges);

    var tablePanel = runEl.querySelector('.orun-detail-panel[data-panel="table"]');
    if (tablePanel) tablePanel.innerHTML = orunRenderNodeTable(nrData, nodes);

    var durationPanel = runEl.querySelector('.orun-detail-panel[data-panel="duration"]');
    if (durationPanel) durationPanel.innerHTML = orunRenderDurationChart(nrData, nodes);
  }
}

// ── Time Ago Helper ──────────────────────────────────────

function orunTimeAgo(isoDate) {
  if (!isoDate) return '-';
  var diff = Date.now() - new Date(isoDate).getTime();
  var s = Math.floor(diff / 1000);
  if (s < 60) return s + 's ago';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  var d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(isoDate).toLocaleDateString();
}
`;
