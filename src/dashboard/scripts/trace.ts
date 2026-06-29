/** @module dashboard/scripts/trace — Client-side script for the session trace modal. */
export function traceScript(): string {
  return `
    /* ── Trace Modal ── */
    var traceCurrentSessionId = null;

    function openTraceModal(sessionId) {
      traceCurrentSessionId = sessionId;
      var modal = document.getElementById('trace-modal');
      modal.style.display = 'flex';
      document.getElementById('trace-modal-title').textContent = 'Execution Trace — ' + sessionId;
      document.getElementById('trace-timeline-container').style.display = 'block';
      document.getElementById('trace-detail-container').style.display = 'none';
      document.getElementById('trace-timeline-container').innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:2rem;">Loading trace...</div>';
      loadTrace(sessionId);
    }

    function closeTraceModal() {
      document.getElementById('trace-modal').style.display = 'none';
      traceCurrentSessionId = null;
    }

    function traceBackToTimeline() {
      document.getElementById('trace-timeline-container').style.display = 'block';
      document.getElementById('trace-detail-container').style.display = 'none';
    }

    async function loadTrace(sessionId) {
      var trace = await fetchApi('/api/sessions/' + sessionId + '/trace');
      if (!trace || !trace.jobs || trace.jobs.length === 0) {
        document.getElementById('trace-timeline-container').innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:2rem;">No jobs found for this session</div>';
        return;
      }
      renderTraceTimeline(trace);
    }

    function renderTraceTimeline(trace) {
      var jobs = trace.jobs;
      var container = document.getElementById('trace-timeline-container');

      // Compute time bounds
      var minTime = new Date(jobs[0].startedAt).getTime();
      var maxTime = minTime;
      for (var i = 0; i < jobs.length; i++) {
        var start = new Date(jobs[i].startedAt).getTime();
        var end = jobs[i].endedAt ? new Date(jobs[i].endedAt).getTime() : Date.now();
        if (start < minTime) minTime = start;
        if (end > maxTime) maxTime = end;
      }
      var totalSpan = maxTime - minTime;
      if (totalSpan <= 0) totalSpan = 1;

      function padTime(n) { return n < 10 ? '0' + n : '' + n; }

      var h = '<div class="trace-time-axis">';
      // 5 time markers
      for (var ti = 0; ti <= 4; ti++) {
        var t = new Date(minTime + (totalSpan * ti / 4));
        var label = padTime(t.getHours()) + ':' + padTime(t.getMinutes()) + ':' + padTime(t.getSeconds());
        h += '<span style="left:' + (ti * 25) + '%">' + label + '</span>';
      }
      h += '</div>';

      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        var startMs = new Date(j.startedAt).getTime();
        var endMs = j.endedAt ? new Date(j.endedAt).getTime() : Date.now();
        var leftPct = ((startMs - minTime) / totalSpan * 100).toFixed(2);
        var widthPct = Math.max(0.5, ((endMs - startMs) / totalSpan * 100));
        widthPct = widthPct.toFixed(2);

        var barColor;
        if (!j.endedAt) barColor = 'var(--accent)';
        else if (j.errorKind && (j.errorKind === 'user_exit' || j.errorKind === 'user_stop' || j.errorKind === 'dashboard_stop' || j.errorKind === 'reset')) barColor = 'var(--yellow)';
        else if (j.errorKind || (j.exitCode !== null && j.exitCode !== 0)) barColor = 'var(--red)';
        else barColor = 'var(--green)';

        var durLabel = '-';
        if (j.durationMs !== null) {
          if (j.durationMs < 1000) durLabel = j.durationMs + 'ms';
          else if (j.durationMs < 60000) durLabel = (j.durationMs / 1000).toFixed(1) + 's';
          else durLabel = Math.floor(j.durationMs / 60000) + 'm ' + Math.round((j.durationMs % 60000) / 1000) + 's';
        }

        var traceJobSource = j.source || '';
        h += '<div class="trace-job-row" onclick="loadTraceJobDetail(\\'' + escapeInlineJsArg(traceCurrentSessionId) + '\\',\\'' + escapeInlineJsArg(j.jobId) + '\\',\\'' + escapeInlineJsArg(j.jobId.substring(0, 8)) + '\\',\\'' + escapeInlineJsArg(traceJobSource) + '\\')" title="' + escapeHtml(j.jobId) + '">';
        h += '<div class="trace-job-label">';
        h += '<code>' + escapeHtml(j.jobId.substring(0, 8)) + '</code>';
        h += '<span class="badge badge-tool" style="font-size:0.65rem;">' + escapeHtml(j.tool) + '</span>';
        h += '<span style="font-size:0.72rem;color:var(--text-dim);">' + escapeHtml(durLabel) + '</span>';
        h += '<span style="font-size:0.72rem;color:var(--text-dim);">' + escapeHtml(String(j.messageCount)) + ' msgs</span>';
        if (j.errorKind) h += '<span style="font-size:0.72rem;color:var(--red);">' + escapeHtml(j.errorKind) + '</span>';
        h += '</div>';
        h += '<div class="trace-bar-track">';
        h += '<div class="trace-bar" style="left:' + leftPct + '%;width:' + widthPct + '%;background:' + barColor + ';"></div>';
        h += '</div>';
        h += '</div>';
      }

      container.innerHTML = h;
    }

    async function loadTraceJobDetail(sessionId, jobId, jobIdShort, source) {
      document.getElementById('trace-timeline-container').style.display = 'none';
      var detailC = document.getElementById('trace-detail-container');
      detailC.style.display = 'block';
      document.getElementById('trace-detail-title').textContent = 'Job ' + jobIdShort;
      var msgC = document.getElementById('trace-messages');

      // Non-chat sources have their own history views
      var nav = typeof jobSourceNavInfo === 'function' ? jobSourceNavInfo(source) : null;
      if (nav) {
        msgC.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:2rem;">'
          + 'This job was dispatched from <strong>' + escapeHtml(nav.label) + '</strong>.<br>'
          + '<a href="#' + nav.tab + '" style="color:var(--accent);cursor:pointer;" '
          + 'onclick="event.stopPropagation();closeTraceModal();switchTab(\\'' + nav.tab + '\\')">View run history</a>'
          + '</div>';
        return;
      }

      msgC.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:2rem;">Loading messages...</div>';
      var msgs = await fetchApi('/api/sessions/' + sessionId + '/audit/' + jobId + '/messages');
      if (!msgs || msgs.length === 0) {
        msgC.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:2rem;">No messages recorded</div>';
        return;
      }
      msgC.innerHTML = renderMessageList(msgs);
    }
`;
}
