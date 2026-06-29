/** @module dashboard/scripts/overview — Client-side script for the Overview tab and global navigation. */
export const overviewScript = `
    /* ── Navigation ── */
    var TAB_TITLES = { overview: 'Overview', metrics: 'Metrics', sessions: 'Sessions', tasks: 'Tasks', 'ondemand-tasks': 'On-Demand Tasks', 'schedule-tasks': 'Schedule Tasks', 'triggered-tasks': 'Triggered Tasks', orchestrators: 'Orchestrators', agents: 'Agents', webhooks: 'Webhooks', logs: 'Logs', settings: 'Settings', docs: 'Docs', dev: 'Developer', mcp: 'MCP Servers', skills: 'Skills', chat: 'Chat' };

    function switchTab(name, chatSessionId) {
      // Force all panels to be visually hidden before any class changes.
      // This prevents a compositor-level flash where the previous tab's GPU
      // texture lingers for 1-2 frames during the display:none/block toggle.
      document.querySelectorAll('.tab-panel.active').forEach(function(p) { p.style.visibility = 'hidden'; });
      document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); p.style.visibility = ''; });
      document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
      var panel = document.getElementById('tab-' + name);
      var link = document.querySelector('[data-tab="' + name + '"]');
      // Sub-tabs highlight parent "tasks" nav item
      if (!link && (name === 'ondemand-tasks' || name === 'schedule-tasks' || name === 'triggered-tasks' || name === 'orchestrators')) {
        link = document.querySelector('[data-tab="tasks"]');
      }
      if (panel) panel.classList.add('active');
      if (link) link.classList.add('active');
      // Reset scroll position so the new tab starts at the top
      var contentEl = document.querySelector('.content');
      if (contentEl) contentEl.scrollTop = 0;
      document.getElementById('page-title').textContent = TAB_TITLES[name] || name;
      // Exit orchestrator fullscreen when switching away
      if (name !== 'orchestrators') document.body.classList.remove('orch-fullscreen');
      // Always refresh server status on tab switch (non-blocking)
      if (name !== 'overview') checkServerOnline();
      if (name === 'overview') refreshOverview();
      if (name === 'sessions') refreshSessions();
      if (name === 'logs') refreshLogs();
      if (name === 'settings') loadSettings();
      if (name === 'docs') renderDocs();
      if (name === 'ondemand-tasks') qtLoadTasks();
      if (name === 'schedule-tasks') schedLoadTasks();
      if (name === 'triggered-tasks') ttLoadTasks();
      if (name === 'webhooks') evtLoadPage();
      if (name === 'orchestrators') orchLoadList();
      if (name === 'dev') devLoadAliases();
      if (name === 'mcp') mcpLoadConfig();
      if (name === 'skills') skillsLoadSkills();
      if (name === 'agents') agentsLoadList();
      if (name === 'metrics') metricsLoadData();
      if (name !== 'metrics') { metricsStopAutoRefresh(); metricsDestroyCharts(); }
      if (name === 'chat') refreshChatTree(chatSessionId);
    }

    function onHashChange() {
      var h = location.hash.replace('#','') || 'overview';
      // Support #chat/<sessionId> deep-link
      if (h.indexOf('chat/') === 0) {
        var chatSessionId = h.substring(5);
        switchTab('chat', chatSessionId);
      } else {
        switchTab(h);
      }
    }
    // hashchange handles browser back/forward navigation
    window.addEventListener('hashchange', onHashChange);
    // Direct click handling on nav links — avoids the async gap between
    // the browser's native hash navigation and the hashchange event,
    // which can cause a 1-frame flash of the previous tab.
    document.querySelectorAll('.nav-item[data-tab]').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var tab = this.getAttribute('data-tab');
        if (tab) {
          history.pushState(null, '', '#' + tab);
          switchTab(tab);
        }
      });
    });

    function navigateToAppChat(tool) {
      chatExpandedTools[tool] = true;
      location.hash = 'chat';
    }

    function scrollToSection(target) {
      // 'sessions' navigates to the Sessions tab; others scroll within overview
      if (target === 'sessions') {
        location.hash = 'sessions';
        return;
      }
      var el = document.getElementById(target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ── Server online tracking ── */
    var serverOnline = false;

    async function checkServerOnline() {
      var d = await fetchApi('/api/status');
      if (d) {
        serverOnline = d.serverApiOnline === true;
        updateOfflineBanner();
      }
      return serverOnline;
    }

    function updateOfflineBanner() {
      var banner = document.getElementById('offline-banner');
      if (serverOnline) {
        banner.classList.remove('visible');
      } else {
        banner.classList.add('visible');
      }
      // Disable/enable mutation buttons based on server status
      var chatInput = document.getElementById('chat-input');
      var chatSendBtn = document.getElementById('chat-send-btn');
      if (!serverOnline && chatCurrentSessionId && !chatStreaming) {
        chatInput.disabled = true;
        chatSendBtn.disabled = true;
      }
    }

    /* ── Chart colors (shared with metrics-tab) ── */
    var toolColors = {
      claude: { bg: 'rgba(184,151,90,0.7)', border: '#B8975A' },
      codex:  { bg: 'rgba(91,141,184,0.7)', border: '#5B8DB8' },
      gemini: { bg: 'rgba(76,175,80,0.7)',  border: '#4CAF50' }
    };

    /* ── Error category colors (shared with metrics-tab) ── */
    var errorCategoryColors = {
      'Exit Error':   { bg: 'rgba(220,38,38,0.7)',  border: '#DC2626' },
      'Timeout':      { bg: 'rgba(234,179,8,0.7)',   border: '#EAB308' },
      'MCP Issue':    { bg: 'rgba(147,51,234,0.7)',  border: '#9333EA' },
      'User Stopped': { bg: 'rgba(59,130,246,0.7)',  border: '#3B82F6' },
      'Spawn Error':  { bg: 'rgba(249,115,22,0.7)',  border: '#F97316' },
      'System':       { bg: 'rgba(156,163,175,0.7)', border: '#9CA3AF' },
      'Other':        { bg: 'rgba(107,114,128,0.7)', border: '#6B7280' }
    };

    function timeAgo(isoStr) {
      if (!isoStr) return '';
      var now = Date.now();
      var then = new Date(isoStr).getTime();
      if (isNaN(then)) return '';
      var diff = Math.max(0, Math.floor((now - then) / 1000));
      if (diff < 60) return diff + 's ago';
      if (diff < 3600) return Math.floor(diff / 60) + 'min ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function drawEmptyCanvas(canvas, text) {
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#999';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    }

    function formatMs(ms) {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
    }

    var taskSourceColors = {
      'on-demand': { bg: 'rgba(234,179,8,0.7)',  border: '#EAB308' },
      'scheduled': { bg: 'rgba(99,102,241,0.7)', border: '#6366F1' },
      'triggered': { bg: 'rgba(13,138,106,0.7)', border: '#0D8A6A' }
    };

    /* ── Sparkline Renderer ── */
    function getSparklineColor(type) {
      var style = getComputedStyle(document.documentElement);
      var colors = {
        sessions: style.getPropertyValue('--blue').trim() || '#2563eb',
        jobs:     style.getPropertyValue('--accent').trim() || '#B8975A',
        success:  style.getPropertyValue('--green').trim() || '#16a34a',
        errors:   style.getPropertyValue('--red').trim() || '#dc2626'
      };
      return colors[type] || colors.jobs;
    }

    function drawSparkline(canvasId, data, colorType) {
      var canvas = document.getElementById(canvasId);
      if (!canvas || !canvas.getContext) return;
      // Skip if no meaningful data (all zeroes or empty)
      if (!data || data.length === 0) return;
      var hasValue = false;
      for (var i = 0; i < data.length; i++) { if (data[i] > 0) { hasValue = true; break; } }
      if (!hasValue) {
        // Clear canvas for empty state
        var ctxEmpty = canvas.getContext('2d');
        if (ctxEmpty) ctxEmpty.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // HiDPI scaling
      var dpr = window.devicePixelRatio || 1;
      var rect = canvas.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // Compute min/max with padding
      var minVal = data[0], maxVal = data[0];
      for (var i = 1; i < data.length; i++) {
        if (data[i] < minVal) minVal = data[i];
        if (data[i] > maxVal) maxVal = data[i];
      }
      var range = maxVal - minVal || 1;
      var padY = 4; // px padding top/bottom

      // Map data points to canvas coordinates
      var points = [];
      var stepX = w / Math.max(data.length - 1, 1);
      for (var i = 0; i < data.length; i++) {
        var x = i * stepX;
        var y = padY + (1 - (data[i] - minVal) / range) * (h - 2 * padY);
        points.push({ x: x, y: y });
      }

      var color = getSparklineColor(colorType);

      // Gradient fill
      var gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, color.replace(')', ', 0.15)').replace('rgb(', 'rgba('));
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      // For hex colors, convert to rgba
      if (color.charAt(0) === '#') {
        var r = parseInt(color.slice(1, 3), 16);
        var g = parseInt(color.slice(3, 5), 16);
        var b = parseInt(color.slice(5, 7), 16);
        gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0.15)');
        gradient.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
      }

      ctx.clearRect(0, 0, w, h);

      // Draw fill area
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.lineTo(points[points.length - 1].x, h);
      ctx.lineTo(points[0].x, h);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw line
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (var i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    /* ── Overview ── */
    async function refreshOverview() {
      var d = await fetchApi('/api/status');
      var hero = document.getElementById('status-hero');
      var dot = document.getElementById('status-dot');
      var txt = document.getElementById('status-text');
      var pidBadge = document.getElementById('status-pid');
      var meta = document.getElementById('status-meta');
      var btnStart = document.getElementById('btn-daemon-start');
      var btnStop = document.getElementById('btn-daemon-stop');

      if (!d) {
        if (hero) hero.className = 'status-hero stopped';
        if (dot) dot.className = 'status-dot stopped';
        if (txt) txt.textContent = 'Unable to check status';
        if (pidBadge) pidBadge.textContent = '';
        if (btnStart) btnStart.disabled = false;
        if (btnStop) btnStop.disabled = true;
        return;
      }

      serverOnline = d.serverApiOnline === true;
      updateOfflineBanner();

      if (d.running) {
        hero.className = 'status-hero running';
        dot.className = 'status-dot running';
        txt.textContent = 'Server Running';
        pidBadge.textContent = 'PID ' + d.pid;
        btnStart.disabled = true;
        btnStop.disabled = false;
      } else {
        hero.className = 'status-hero stopped';
        dot.className = 'status-dot stopped';
        txt.textContent = 'Server Stopped';
        pidBadge.textContent = '';
        btnStart.disabled = false;
        btnStop.disabled = true;
      }

      meta.innerHTML = '<span>PID file: <code>' + escapeHtml(d.pidFile) + '</code></span> <span style="margin:0 0.4rem;">·</span> <span>Log: <code>' + escapeHtml(d.logFile) + '</code></span>';

      // Metric cards (null-guarded — elements may be absent if template changes)
      var sessEl = document.getElementById('stat-sessions');
      if (sessEl) sessEl.textContent = d.sessionCount != null ? String(d.sessionCount) : '-';
      var activeSub = document.getElementById('stat-active-sub');
      if (activeSub) {
        if (d.activeSessionCount > 0) {
          activeSub.innerHTML = '<span class="active-badge">' + escapeHtml(String(d.activeSessionCount)) + ' active</span>';
        } else {
          activeSub.textContent = 'No active sessions';
        }
      }

      var jobsEl = document.getElementById('stat-jobs-24h');
      if (jobsEl) jobsEl.textContent = d.jobs24h != null ? String(d.jobs24h) : '-';
      var totalJobsSub = document.getElementById('stat-total-jobs-sub');
      if (totalJobsSub) totalJobsSub.textContent = (d.totalJobs != null ? d.totalJobs : 0) + ' total';

      // Success rate
      var cd = d.chartData || {};
      var hasJobs7d = cd.totalRange > 0;
      var rate7d = hasJobs7d ? cd.successRateRange : 100;
      var rateColor = hasJobs7d ? (rate7d >= 90 ? 'var(--green)' : rate7d >= 70 ? 'var(--yellow)' : 'var(--red)') : 'var(--text-dim)';
      var rateEl = document.getElementById('stat-success-rate');
      if (rateEl) {
        rateEl.textContent = hasJobs7d ? rate7d + '%' : 'N/A';
        rateEl.style.color = rateColor;
      }
      var rateBar = document.getElementById('stat-success-bar');
      if (rateBar) {
        rateBar.style.width = (hasJobs7d ? rate7d : 0) + '%';
        rateBar.style.background = rateColor;
      }

      // Errors / health
      var errCount = d.errors24h != null ? d.errors24h : 0;
      var errEl = document.getElementById('stat-errors-24h');
      if (errEl) {
        errEl.textContent = String(errCount);
        errEl.style.color = errCount > 0 ? 'var(--red)' : 'var(--green)';
      }
      var errorsSub = document.getElementById('stat-errors-sub');
      if (errorsSub) {
        var errCats = d.errorCategories || [];
        if (errCats.length > 0) {
          var totalErr7d = 0;
          for (var ei = 0; ei < errCats.length; ei++) totalErr7d += errCats[ei].count;
          errorsSub.textContent = totalErr7d + ' errors (7d)';
        } else {
          errorsSub.textContent = 'No errors (7d)';
        }
      }

      // App tool stats (enhanced cards)
      var toolStatsMap = {};
      if (d.toolStats) {
        for (var ti = 0; ti < d.toolStats.length; ti++) {
          toolStatsMap[d.toolStats[ti].tool] = d.toolStats[ti].count;
        }
      }
      var appToolMap = {};
      if (d.appToolStats) {
        for (var ati = 0; ati < d.appToolStats.length; ati++) {
          appToolMap[d.appToolStats[ati].tool] = d.appToolStats[ati];
        }
      }
      var toolNames = ['claude', 'codex', 'gemini'];
      for (var tn = 0; tn < toolNames.length; tn++) {
        var appName = toolNames[tn];
        var statsEl = document.getElementById('tool-stats-' + appName);
        if (!statsEl) continue;

        var totalJobs = toolStatsMap[appName] || 0;
        var sess = d.appSessionStats && d.appSessionStats[appName] ? d.appSessionStats[appName] : { total: 0, active: 0 };
        var ats = appToolMap[appName] || { jobs24h: 0, errors24h: 0, successRate7d: 100, avgDurationMs: null, lastActivityAt: null };

        var durText = ats.avgDurationMs != null ? formatMs(ats.avgDurationMs) : '-';

        // Success rate: show N/A when no jobs exist for this tool
        var hasJobs = totalJobs > 0;
        var rateColor = hasJobs
          ? (ats.successRate7d >= 90 ? 'var(--green)' : ats.successRate7d >= 70 ? 'var(--yellow)' : 'var(--red)')
          : 'var(--text-dim)';
        var rateClass = ats.errors24h > 0 ? 'has-errors' : (ats.jobs24h > 0 ? 'all-good' : '');
        var rateDisplay = hasJobs ? ats.successRate7d + '%' : 'N/A';
        var rateBarWidth = hasJobs ? ats.successRate7d : 0;

        // Session line
        var sessText = sess.total + ' session' + (sess.total !== 1 ? 's' : '');
        if (sess.active > 0) sessText += ' &middot; <span class="active-count" style="color:var(--green);font-weight:500;">' + sess.active + ' active</span>';

        var h = '<div class="tool-card-stats-row"><span class="stats-label">Total</span><span class="stats-value">' + totalJobs + ' jobs</span></div>'
          + '<div class="tool-card-stats-row"><span class="stats-label">Sessions</span><span class="stats-value">' + sessText + '</span></div>'
          + '<hr class="tool-card-divider">'
          + '<div class="tool-card-stats-row"><span class="stats-label">24h</span><span class="stats-value">' + ats.jobs24h + ' jobs' + (ats.errors24h > 0 ? ' &middot; <span class="' + rateClass + '">' + ats.errors24h + ' err</span>' : '') + '</span></div>'
          + '<div class="tool-card-stats-row"><span class="stats-label">Success (7d)</span><span class="stats-value">' + rateDisplay + '</span></div>'
          + '<div class="tool-card-rate-bar"><div class="tool-card-rate-fill" style="width:' + rateBarWidth + '%;background:' + rateColor + ';"></div></div>'
          + '<div class="tool-card-stats-row"><span class="stats-label">Avg duration</span><span class="stats-value">' + durText + '</span></div>';

        if (ats.lastActivityAt) {
          h += '<div class="tool-card-last-active">Last used ' + timeAgo(ats.lastActivityAt) + '</div>';
        }

        statsEl.innerHTML = h;
      }

      // Recent activity
      var recentCard = document.getElementById('recent-activity-card');
      if (d.recentJobs && d.recentJobs.length > 0) {
        var rh = '<table><thead><tr><th>Job ID</th><th>Tool</th><th>Workdir</th><th>Started</th><th>Duration</th><th>Exit</th><th>Error</th></tr></thead><tbody>';
        for (var ri = 0; ri < d.recentJobs.length; ri++) {
          var rj = d.recentJobs[ri];
          var dur = formatDuration(rj.startedAt, rj.endedAt);
          var wdBase = rj.workdir ? rj.workdir.split(/[\\/]/).pop() || rj.workdir : '-';
          rh += '<tr>'
            + '<td><code>' + escapeHtml((rj.jobId || '').substring(0, 8)) + '</code></td>'
            + '<td><span class="badge badge-tool">' + escapeHtml(rj.tool || '') + '</span></td>'
            + '<td>' + escapeHtml(wdBase) + '</td>'
            + '<td>' + escapeHtml(rj.startedAt || '-') + (rj.startedAt ? ' <span style="color:var(--text-dim);font-size:0.72rem;">(' + escapeHtml(timeAgo(rj.startedAt)) + ')</span>' : '') + '</td>'
            + '<td>' + escapeHtml(dur) + '</td>'
            + '<td>' + (rj.exitCode != null ? escapeHtml(String(rj.exitCode)) : '-') + '</td>'
            + '<td>' + escapeHtml(rj.errorKind || '-') + '</td>'
            + '</tr>';
        }
        rh += '</tbody></table>';
        recentCard.innerHTML = rh;
      } else {
        recentCard.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:1.5rem;">No job history yet</div>';
      }

      // Sparklines on metric cards (Phase 4)
      if (d.sparklines) {
        drawSparkline('spark-sessions', d.sparklines.sessions, 'sessions');
        drawSparkline('spark-jobs', d.sparklines.jobs, 'jobs');
        drawSparkline('spark-success', d.sparklines.successRate, 'success');
        drawSparkline('spark-errors', d.sparklines.errors, 'errors');
      }
    }

    async function daemonStart() {
      var d = await fetchApi('/api/daemon/start', { method: 'POST' });
      if (d && d.success) toast('Daemon started (PID: ' + d.pid + ')');
      refreshOverview();
    }

    async function daemonStop() {
      var d = await fetchApi('/api/daemon/stop', { method: 'POST' });
      if (d && d.success) toast('Daemon stopped');
      refreshOverview();
    }

    /* ── Sessions ── */
    var openAuditId = null;

    async function refreshSessions() {
      var sessions = await fetchApi('/api/sessions');
      if (!sessions) return;
      var tbody = document.getElementById('sessions-tbody');
      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:2rem;">No sessions</td></tr>';
        return;
      }
      var html = '';
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        html += '<tr style="cursor:pointer;" onclick="location.hash=\\\'#chat/' + escapeHtml(s.sessionId) + '\\\'">'
          + '<td><button class="expand-btn" onclick="event.stopPropagation();toggleAudit(this,\\'' + escapeInlineJsArg(s.sessionId) + '\\')">&blacktriangleright;</button></td>'
          + '<td><a href="#chat/' + escapeHtml(s.sessionId) + '" class="session-link" onclick="event.stopPropagation();"><code>' + escapeHtml(s.sessionId) + '</code></a></td>'
          + '<td>' + escapeHtml(s.userId) + '</td>'
          + '<td><span class="badge badge-tool">' + escapeHtml(s.tool) + '</span></td>'
          + '<td>' + escapeHtml(s.mode) + '</td>'
          + '<td>' + (s.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Idle</span>') + '</td>'
          + '<td>' + escapeHtml(s.startedAt) + '</td>'
          + '<td>' + escapeHtml(s.updatedAt) + '</td>'
          + '<td><button class="btn btn-danger" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="event.stopPropagation();deleteSession(\\'' + escapeInlineJsArg(s.sessionId) + '\\')">Delete</button></td>'
          + '</tr>';
        html += '<tr class="audit-row" id="audit-' + escapeHtml(s.sessionId) + '"><td colspan="9" class="audit-cell"><div id="audit-data-' + escapeHtml(s.sessionId) + '">Loading...</div></td></tr>';
      }
      tbody.innerHTML = html;
    }

    function formatDuration(startedAt, endedAt) {
      if (!startedAt || !endedAt) return '-';
      var ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      if (isNaN(ms) || ms < 0) return '-';
      return formatMs(ms);
    }

    function formatTimestamp(ts) {
      if (!ts) return '-';
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '-';
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    function renderSessionMcpPanel(sessionId, data) {
      if (!data) {
        return '<div id="session-mcp-' + escapeHtml(sessionId) + '" style="margin-bottom:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:12px;background:var(--surface);">'
          + '<div style="font-weight:600;margin-bottom:0.35rem;">MCP Servers</div>'
          + '<div style="color:var(--text-dim);font-size:0.82rem;">Failed to load session MCP settings.</div>'
          + '</div>';
      }

      var h = '<div id="session-mcp-' + escapeHtml(sessionId) + '" style="margin-bottom:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:12px;background:var(--surface);">';
      h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">';
      h += '<div><div style="font-weight:600;">MCP Servers</div><div style="color:var(--text-dim);font-size:0.82rem;">'
        + (data.filterActive ? 'Session-specific filter active. Changes apply to new jobs.' : 'Default policy: all configured servers are enabled.')
        + '</div></div>';
      h += '<button class="btn" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="event.stopPropagation();sessionMcpReset(\\'' + escapeInlineJsArg(sessionId) + '\\')"' + (data.filterActive ? '' : ' disabled') + '>Reset</button>';
      h += '</div>';
      if ((data.servers || []).length === 0) {
        h += '<div style="margin-top:0.6rem;color:var(--text-dim);font-size:0.82rem;">No MCP servers are configured for <code>' + escapeHtml(data.tool || '') + '</code>.</div>';
      } else {
        h += '<div style="display:grid;gap:0.45rem;margin-top:0.75rem;">';
        for (var i = 0; i < data.servers.length; i++) {
          var server = data.servers[i];
          h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.45rem 0.55rem;border:1px solid var(--border);border-radius:10px;background:var(--surface);">';
          h += '<span><strong>' + escapeHtml(server.name) + '</strong> <span style="color:var(--text-dim);font-size:0.78rem;">(' + escapeHtml(server.transport) + ')</span></span>';
          h += '<label class="toggle-switch" style="margin:0;">';
          h += '<input type="checkbox" ' + (server.enabled ? 'checked ' : '') + 'onchange="sessionMcpToggle(\\'' + escapeInlineJsArg(sessionId) + '\\',\\'' + escapeInlineJsArg(server.id) + '\\', this.checked, this)">';
          h += '<span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span>';
          h += '</label>';
          h += '</div>';
        }
        h += '</div>';
      }
      if (data.mode === 'readonly') {
        h += '<div style="margin-top:0.65rem;color:var(--text-dim);font-size:0.8rem;">Readonly session: MCP stays blocked at runtime until write mode is enabled.</div>';
      }
      h += '</div>';
      return h;
    }

    function updateSessionMcpPanel(sessionId, data) {
      var container = document.getElementById('session-mcp-' + sessionId);
      if (!container) return;
      container.outerHTML = renderSessionMcpPanel(sessionId, data);
    }

    async function sessionMcpToggle(sessionId, serverId, enabled, checkbox) {
      var response = await fetchApi('/api/sessions/' + sessionId + '/mcp-servers/' + serverId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled })
      });
      if (!response || !response.data) {
        if (checkbox) checkbox.checked = !enabled;
        return;
      }
      updateSessionMcpPanel(sessionId, response.data);
    }

    async function sessionMcpReset(sessionId) {
      var response = await fetchApi('/api/sessions/' + sessionId + '/mcp-servers', {
        method: 'DELETE'
      });
      if (!response || !response.data) return;
      updateSessionMcpPanel(sessionId, response.data);
    }

    async function toggleAudit(btn, sessionId) {
      var row = document.getElementById('audit-' + sessionId);
      if (row.classList.contains('open')) {
        row.classList.remove('open');
        btn.innerHTML = '&blacktriangleright;';
        return;
      }
      row.classList.add('open');
      btn.innerHTML = '&blacktriangledown;';
      var div = document.getElementById('audit-data-' + sessionId);
      var rows = await fetchApi('/api/sessions/' + sessionId + '/audit');
      var mcpState = await fetchApi('/api/sessions/' + sessionId + '/mcp-servers', null, true);
      var h = renderSessionMcpPanel(sessionId, mcpState);
      h += '<div style="margin-bottom:0.5rem;"><button class="btn btn-primary" style="padding:0.25rem 0.65rem;font-size:0.78rem;" onclick="event.stopPropagation();openTraceModal(\\'' + escapeInlineJsArg(sessionId) + '\\')">View Timeline</button></div>';
      if (!rows || rows.length === 0) { div.innerHTML = h + '<div style="text-align:center;color:var(--text-dim);padding:1rem;">No job history</div>'; return; }
      h += '<div class="audit-jobs">';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var dur = formatDuration(r.startedAt, r.endedAt);
        var dotClass = r.endedAt === null ? 'running' : (r.exitCode === 0 || r.exitCode === null ? 'success' : 'error');
        var exitHtml = r.exitCode !== null ? '<span class="job-card-exit' + (r.exitCode !== 0 ? ' fail' : '') + '">exit ' + escapeHtml(String(r.exitCode)) + '</span>' : '';
        var errorHtml = r.errorKind ? ' <span class="job-card-error">' + escapeHtml(r.errorKind) + '</span>' : '';
        var jobIdShort = escapeHtml((r.jobId || '').substring(0, 8));
        var jobSource = r.source || '';
        h += '<div class="job-card" id="job-card-' + escapeHtml(r.jobId) + '">'
          + '<div class="job-card-header" onclick="toggleJobMessages(\\'' + escapeInlineJsArg(sessionId) + '\\',\\'' + escapeInlineJsArg(r.jobId) + '\\',\\'' + escapeInlineJsArg(jobSource) + '\\')">'
          + '<span class="job-card-expand">&blacktriangleright;</span>'
          + '<span class="job-status-dot ' + dotClass + '"></span>'
          + '<span class="job-card-id">' + jobIdShort + '</span>'
          + '<span class="job-card-meta">'
          + '<span class="badge badge-tool">' + escapeHtml(r.tool) + '</span>'
          + '<span>' + escapeHtml(r.mode) + '</span>'
          + '<span class="job-card-duration">' + escapeHtml(dur) + '</span>'
          + exitHtml + errorHtml
          + '<span style="color:var(--text-dim);font-size:0.72rem;">' + escapeHtml(formatTimestamp(r.startedAt)) + '</span>'
          + '</span>'
          + '</div>'
          + '<div class="job-card-body" id="job-msgs-' + escapeHtml(r.jobId) + '">'
          + '<div class="job-messages-loading">Click to load messages...</div>'
          + '</div>'
          + '</div>';
      }
      h += '</div>';
      div.innerHTML = h;
    }

    /** Render a list of job messages as HTML string. Shared by audit panel and trace view. */
    function renderMessageList(msgs) {
      var h = '';
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var roleClass = m.role === 'user' ? 'job-msg-user' : (m.role === 'assistant' ? 'job-msg-assistant' : 'job-msg-system');
        var roleLabel = m.role === 'user' ? 'User' : (m.role === 'assistant' ? 'Assistant' : 'System');
        var raw = m.content || '';
        // Truncate raw content before escaping to avoid breaking HTML entities mid-sequence
        var truncated = raw.length > 2000;
        var content = escapeHtml(truncated ? raw.substring(0, 2000) : raw);
        if (truncated) {
          content += '\\n\\n... (' + raw.length + ' chars total)';
        }
        h += '<div class="job-msg ' + roleClass + '">'
          + '<div class="job-msg-role">' + roleLabel + '</div>'
          + '<div class="job-msg-content">' + content + '</div>'
          + '</div>';
      }
      return h;
    }

    /** Map job source to the tab name and label for navigation. */
    function jobSourceNavInfo(source) {
      var map = {
        'ondemand-task': { tab: 'ondemand-tasks', label: 'On-Demand Tasks' },
        'schedule':      { tab: 'schedule-tasks', label: 'Schedule Tasks' },
        'triggered-task':{ tab: 'triggered-tasks', label: 'Triggered Tasks' },
        'orchestrator':  { tab: 'orchestrators',  label: 'Orchestrators' },
        'orchestrator-summary': { tab: 'orchestrators', label: 'Orchestrators' },
      };
      return map[source] || null;
    }

    async function toggleJobMessages(sessionId, jobId, source) {
      var card = document.getElementById('job-card-' + jobId);
      if (!card) return;
      if (card.classList.contains('open')) {
        card.classList.remove('open');
        return;
      }
      card.classList.add('open');
      var body = document.getElementById('job-msgs-' + jobId);
      if (!body) return;
      // Only fetch once (on success)
      if (body.dataset.loaded) return;

      // Non-chat sources store history in their own task views — show navigation link
      var nav = jobSourceNavInfo(source);
      if (nav) {
        body.dataset.loaded = '1';
        body.innerHTML = '<div class="job-messages-empty">'
          + 'This job was dispatched from <strong>' + escapeHtml(nav.label) + '</strong>.<br>'
          + '<a href="#' + nav.tab + '" style="color:var(--accent);cursor:pointer;" '
          + 'onclick="event.stopPropagation();switchTab(\\'' + nav.tab + '\\')">View run history</a>'
          + '</div>';
        return;
      }

      body.innerHTML = '<div class="job-messages-loading">Loading messages...</div>';
      var msgs = await fetchApi('/api/sessions/' + sessionId + '/audit/' + jobId + '/messages');
      if (!msgs) {
        body.innerHTML = '<div class="job-messages-empty">Failed to load messages</div>';
        return;
      }
      body.dataset.loaded = '1';
      if (msgs.length === 0) {
        body.innerHTML = '<div class="job-messages-empty">No messages recorded for this job</div>';
        return;
      }
      body.innerHTML = '<div class="job-messages">' + renderMessageList(msgs) + '</div>';
    }

    async function deleteSession(id) {
      if (!serverOnline && !(await checkServerOnline())) { toast('Server is not running. Please start the server from the Overview tab.', 'error'); return; }
      if (!confirm('Delete session ' + id + '?')) return;
      var d = await fetchApi('/api/sessions/' + id, { method: 'DELETE' });
      if (d && d.success) {
        toast('Session deleted');
        refreshSessions();
        // If deleted session was active in chat, reset chat panel
        if (typeof chatCurrentSessionId !== 'undefined' && chatCurrentSessionId === id) {
          chatStopPoll();
          resetChatPanel();
        }
        refreshChatTree();
      }
    }

    async function clearAllSessions() {
      if (!serverOnline && !(await checkServerOnline())) { toast('Server is not running. Please start the server from the Overview tab.', 'error'); return; }
      if (!confirm('Delete ALL sessions? This cannot be undone.')) return;
      var d = await fetchApi('/api/sessions', { method: 'DELETE' });
      if (d && d.success) {
        var msg = 'Cleared ' + d.deleted + ' sessions';
        if (d.orphanRemoved > 0) msg += ' (+' + d.orphanRemoved + ' orphaned workdirs)';
        toast(msg);
        refreshSessions();
        // Reset chat panel since all sessions were deleted
        chatStopPoll();
        resetChatPanel();
        refreshChatTree();
      }
    }
`;
