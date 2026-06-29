/** @module dashboard/scripts/logs — Client-side script for the Logs tab. */
export const logsScript = `
    /* ── Logs ── */
    var logData = [];
    var logLevel = 'all';
    var logOffset = 0;
    var logSource = 'all';
    var logLive = false;
    var logEventSource = null;
    var logRenderPending = false;

    function logApiUrl(limit, offset) {
      var url = '/api/logs?limit=' + limit + '&offset=' + offset;
      if (logSource !== 'all') url += '&source=' + encodeURIComponent(logSource);
      return url;
    }

    function logStreamUrl() {
      var url = '/api/logs/stream';
      if (logSource !== 'all') url += '?source=' + encodeURIComponent(logSource);
      return url;
    }

    function logRelTime(iso) {
      if (!iso) return '';
      var diff = (Date.now() - new Date(iso).getTime()) / 1000;
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function renderLogFields(data) {
      if (!data) return '';
      var html = '';
      for (var k in data) {
        html += ' <span class="log-field-chip">' + escapeHtml(k) + '=' + escapeHtml(String(data[k])) + '</span>';
      }
      return html;
    }

    async function refreshLogs() {
      logOffset = 0;
      var d = await fetchApi(logApiUrl(200, 0));
      if (!d) return;
      logData = d.lines || [];
      document.getElementById('btn-load-more').style.display = d.hasMore ? '' : 'none';
      var dot = document.getElementById('refresh-dot');
      if (dot) {
        dot.classList.remove('flash');
        void dot.offsetWidth;
        dot.classList.add('flash');
      }
      renderLogs();
    }

    async function loadMoreLogs() {
      logOffset += 200;
      var d = await fetchApi(logApiUrl(200, logOffset));
      if (!d) return;
      logData = logData.concat(d.lines || []);
      document.getElementById('btn-load-more').style.display = d.hasMore ? '' : 'none';
      renderLogs();
    }

    function switchLogSource(el) {
      document.querySelectorAll('.log-toolbar .chip[data-source]').forEach(function(c) { c.classList.remove('active'); });
      el.classList.add('active');
      logSource = el.getAttribute('data-source');
      if (logLive) {
        logStopLive();
        logStartLive();
      }
      refreshLogs();
    }

    function filterLog(el) {
      document.querySelectorAll('.log-toolbar .chip[data-level]').forEach(function(c) { c.classList.remove('active'); });
      el.classList.add('active');
      logLevel = el.getAttribute('data-level');
      renderLogs();
    }

    /* ── Live tail ── */

    function logToggleLive() {
      if (logLive) {
        logStopLive();
      } else {
        logStartLive();
      }
    }

    function logStartLive() {
      logLive = true;
      logUpdateLiveUI();
      logConnectSSE();
    }

    function logStopLive() {
      logLive = false;
      if (logEventSource) {
        logEventSource.close();
        logEventSource = null;
      }
      logUpdateLiveUI();
    }

    function logUpdateLiveUI() {
      var btn = document.getElementById('btn-log-live');
      var refreshBtn = document.getElementById('btn-log-refresh');
      var loadMoreBtn = document.getElementById('btn-load-more');
      if (btn) {
        btn.classList.toggle('active', logLive);
        btn.textContent = logLive ? 'Live \\u25cf' : 'Live';
      }
      if (refreshBtn) refreshBtn.disabled = logLive;
      if (loadMoreBtn) loadMoreBtn.disabled = logLive;
    }

    /** Schedule a renderLogs() via requestAnimationFrame to batch rapid SSE events. */
    function logScheduleRender() {
      if (logRenderPending) return;
      logRenderPending = true;
      requestAnimationFrame(function() {
        logRenderPending = false;
        renderLogs();
        var container = document.getElementById('log-container');
        if (container) container.scrollTop = 0;
      });
    }

    function logConnectSSE() {
      if (logEventSource) {
        logEventSource.close();
        logEventSource = null;
      }
      var es = new EventSource(logStreamUrl());
      logEventSource = es;

      es.onmessage = function(e) {
        try {
          var line = JSON.parse(e.data);
          // Always add to logData — renderLogs handles display filtering
          logData.unshift(line);
          // Cap in-memory buffer
          if (logData.length > 2000) logData.length = 2000;
          logScheduleRender();
        } catch (err) {
          // ignore parse errors
        }
      };

      es.onerror = function() {
        // Auto-reconnect is built into EventSource.
        // If we intentionally stopped, don't show error.
        if (!logLive) return;
        var dot = document.getElementById('refresh-dot');
        if (dot) {
          dot.classList.remove('flash');
          void dot.offsetWidth;
          dot.classList.add('flash');
        }
      };
    }

    function renderLogs() {
      var search = (document.getElementById('log-search').value || '').toLowerCase();
      var container = document.getElementById('log-container');
      var html = '';
      var count = 0;
      for (var i = 0; i < logData.length; i++) {
        var l = logData[i];
        if (logLevel !== 'all' && l.level !== logLevel) continue;
        var dataStr = '';
        if (l.data) {
          var parts = [];
          for (var k in l.data) { parts.push(k + '=' + l.data[k]); }
          dataStr = parts.join(' ');
        }
        var line = (l.ts || '') + ' ' + (l.level || '') + ' ' + (l.msg || '') + ' ' + dataStr;
        if (search && line.toLowerCase().indexOf(search) === -1) continue;
        count++;
        var lvl = escapeHtml(l.level || 'info');
        var srcBadge = l.source ? '<span class="log-source-badge log-source-' + escapeHtml(l.source) + '">' + escapeHtml(l.source) + '</span>' : '';
        html += '<div class="log-card log-card-' + lvl + '">'
          + '<span class="log-level">' + lvl + '</span>'
          + srcBadge
          + '<span class="log-ts" title="' + escapeHtml(l.ts || '') + '">' + escapeHtml(logRelTime(l.ts)) + '</span>'
          + '<span class="log-msg">' + escapeHtml(l.msg || '') + '</span>'
          + renderLogFields(l.data)
          + '</div>';
      }
      var countEl = document.getElementById('log-count');
      if (countEl) countEl.textContent = count + ' ' + (count === 1 ? 'entry' : 'entries');
      if (!html) {
        container.innerHTML = '<div class="log-empty">'
          + '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'
          + '<span>No log entries match</span>'
          + '</div>';
      } else {
        container.innerHTML = html;
      }
    }
`;
