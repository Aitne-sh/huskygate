/** @module dashboard/scripts/metrics-tab — Client-side script for the Metrics tab (data fetching, chart rendering, time-range selector, auto-refresh). */
export const metricsTabScript = `
    /* ═══════════════════════════════════════════════
       Metrics Tab — Client-side Logic
       ═══════════════════════════════════════════════ */

    /* ── State ── */
    var metricsRange = '7d';
    var metricsRefreshTimer = null;
    var metricsAutoRefreshActive = false;
    var metricsCharts = {};

    /* ── Theme helper for Chart.js ── */
    function metricsIsDark() {
      return document.documentElement.getAttribute('data-theme') === 'dark'
        || (!document.documentElement.getAttribute('data-theme')
            && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function metricsPointBorder() { return metricsIsDark() ? '#2a2a2a' : '#fff'; }
    function metricsUpdateChartTheme() {
      var isDark = metricsIsDark();
      if (typeof Chart === 'undefined') return;
      Chart.defaults.color = isDark ? '#a0a0a0' : '#7A7067';
      Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    }

    /* ── Data Loading ── */
    async function metricsLoadData() {
      metricsUpdateChartTheme();
      var d = await fetchApi('/api/metrics?range=' + encodeURIComponent(metricsRange));
      if (!d || !d.data) {
        metricsRenderEmpty();
        return;
      }
      metricsRenderAll(d.data);
    }

    function metricsRenderEmpty() {
      var ids = [
        'metrics-chart-job-activity', 'metrics-chart-job-source',
        'metrics-chart-jobs-errors', 'metrics-chart-duration',
        'metrics-chart-task-runs', 'metrics-chart-orch-runs',
        'metrics-chart-orch-duration', 'metrics-chart-error-dist',
        'metrics-chart-error-trend'
      ];
      for (var i = 0; i < ids.length; i++) {
        var canvas = document.getElementById(ids[i]);
        if (canvas) drawEmptyCanvas(canvas, 'No data');
      }
      var taskSummary = document.getElementById('metrics-task-summary');
      if (taskSummary) taskSummary.innerHTML = '<div class="metrics-empty">No tasks configured</div>';
      var errorByTool = document.getElementById('metrics-error-by-tool-body');
      if (errorByTool) errorByTool.innerHTML = '<div class="metrics-empty">No error data</div>';
      var recentErrors = document.getElementById('metrics-recent-errors-body');
      if (recentErrors) recentErrors.innerHTML = '<div class="metrics-empty">No errors</div>';
      var queueGauge = document.getElementById('metrics-queue-gauge-body');
      if (queueGauge) queueGauge.innerHTML = '<div class="metrics-empty">No queue data</div>';
      var dbSize = document.getElementById('metrics-db-size-body');
      if (dbSize) dbSize.innerHTML = '<div class="metrics-empty">-</div>';
    }

    /* ── Master Render ── */
    function metricsRenderAll(data) {
      metricsRenderJobActivity(data);
      metricsRenderJobSource(data.jobsBySource);
      metricsRenderJobsVsErrors(data);
      metricsRenderDuration(data.durationBuckets);
      metricsRenderTaskSummary(data.taskSummary);
      metricsRenderTaskRuns(data.taskSummary);
      metricsRenderOrchRuns(data.orchDailyRuns);
      metricsRenderOrchDuration(data.orchAvgDuration);
      metricsRenderErrorDist(data.errorCategories);
      metricsRenderErrorTrend(data.errorTrend);
      metricsRenderErrorByTool(data.errorByTool);
      metricsRenderRecentErrors(data.recentErrors);
      metricsRenderQueueGauge(data.queueDepth);
      metricsRenderDbSize(data.dbSizeBytes);
    }

    /* ── Range Selection ── */
    function metricsSetRange(range) {
      metricsRange = range;
      // Update button states
      var btns = document.querySelectorAll('.metrics-range-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-range') === range);
      }
      metricsLoadData();
    }

    /* ── Auto-Refresh ── */
    function metricsToggleAutoRefresh() {
      var toggle = document.getElementById('metrics-auto-refresh');
      if (!toggle) return;
      metricsAutoRefreshActive = !metricsAutoRefreshActive;
      toggle.classList.toggle('active', metricsAutoRefreshActive);
      if (metricsAutoRefreshActive) {
        metricsRefreshTimer = setInterval(metricsLoadData, 30000);
      } else {
        if (metricsRefreshTimer) { clearInterval(metricsRefreshTimer); metricsRefreshTimer = null; }
      }
    }

    function metricsStopAutoRefresh() {
      metricsAutoRefreshActive = false;
      if (metricsRefreshTimer) { clearInterval(metricsRefreshTimer); metricsRefreshTimer = null; }
      var toggle = document.getElementById('metrics-auto-refresh');
      if (toggle) toggle.classList.remove('active');
    }

    /* ── Chart Cleanup ── */
    function metricsDestroyCharts() {
      var keys = Object.keys(metricsCharts);
      for (var i = 0; i < keys.length; i++) {
        if (metricsCharts[keys[i]]) {
          metricsCharts[keys[i]].destroy();
          metricsCharts[keys[i]] = null;
        }
      }
      metricsCharts = {};
    }

    /* ── Date Range Builder ── */
    function metricsBuildDateRange(days) {
      var dates = [];
      var today = new Date();
      for (var d = days - 1; d >= 0; d--) {
        var dt = new Date(today);
        dt.setDate(dt.getDate() - d);
        dates.push(dt.toISOString().substring(0, 10));
      }
      return dates;
    }

    function metricsRangeDays() {
      // 24h uses 2 calendar days (yesterday + today) for meaningful chart display
      // since the backend aggregates by day, not hour.
      if (metricsRange === '24h') return 2;
      if (metricsRange === '30d') return 30;
      return 7;
    }

    /* ═══════════════════════════════════════════════
       Chart Renderers
       ═══════════════════════════════════════════════ */

    function metricsRenderJobActivity(data) {
      var canvas = document.getElementById('metrics-chart-job-activity');
      if (!canvas || typeof Chart === 'undefined') return;
      var dailyJobs = data.dailyJobs || [];
      if (dailyJobs.length === 0) { metricsDestroyChart('jobActivity'); drawEmptyCanvas(canvas, 'No data'); return; }

      var days = metricsRangeDays();
      var range = days === 1 ? metricsBuildDateRange(1) : metricsBuildDateRange(days);
      var jobMap = {}; var toolSet = {};
      for (var i = 0; i < dailyJobs.length; i++) {
        var dj = dailyJobs[i];
        toolSet[dj.tool] = true;
        jobMap[dj.date + ':' + dj.tool] = dj.total;
      }
      var dateSet = {};
      for (var r = 0; r < range.length; r++) dateSet[range[r]] = true;
      for (var j = 0; j < dailyJobs.length; j++) dateSet[dailyJobs[j].date] = true;
      var dates = Object.keys(dateSet).sort();
      var tools = Object.keys(toolSet).sort();
      var shortDates = dates.map(function(d) { return d.substring(5); });

      var datasets = [];
      for (var ti = 0; ti < tools.length; ti++) {
        var t = tools[ti];
        var color = toolColors[t] || { bg: 'rgba(150,150,150,0.7)', border: '#999' };
        var dd = [];
        for (var di = 0; di < dates.length; di++) { dd.push(jobMap[dates[di] + ':' + t] || 0); }
        datasets.push({
          label: t.charAt(0).toUpperCase() + t.slice(1),
          data: dd,
          borderColor: color.border,
          backgroundColor: color.bg.replace('0.7', '0.12'),
          borderWidth: 2, fill: true, tension: 0.3,
          pointRadius: 4, pointBackgroundColor: color.border,
          pointBorderColor: metricsPointBorder(), pointBorderWidth: 1.5, pointHoverRadius: 6
        });
      }

      metricsDestroyChart('jobActivity');
      metricsCharts.jobActivity = new Chart(canvas, {
        type: 'line',
        data: { labels: shortDates, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } }
        }
      });
    }

    function metricsRenderJobSource(jobsBySource) {
      var canvas = document.getElementById('metrics-chart-job-source');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!jobsBySource || jobsBySource.length === 0) { metricsDestroyChart('jobSource'); drawEmptyCanvas(canvas, 'No data'); return; }

      var sourceColors = {
        slack: { bg: 'rgba(37,99,235,0.7)', border: '#2563eb' },
        dashboard: { bg: 'rgba(184,151,90,0.7)', border: '#B8975A' },
        schedule: { bg: 'rgba(99,102,241,0.7)', border: '#6366F1' },
        orchestrator: { bg: 'rgba(13,148,136,0.7)', border: '#0d9488' },
        unknown: { bg: 'rgba(156,163,175,0.7)', border: '#9CA3AF' }
      };
      var labels = []; var values = []; var bgColors = []; var bdColors = [];
      for (var i = 0; i < jobsBySource.length; i++) {
        var s = jobsBySource[i];
        labels.push(s.source.charAt(0).toUpperCase() + s.source.slice(1));
        values.push(s.count);
        var sc = sourceColors[s.source] || sourceColors.unknown;
        bgColors.push(sc.bg);
        bdColors.push(sc.border);
      }

      metricsDestroyChart('jobSource');
      metricsCharts.jobSource = new Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Jobs', data: values, backgroundColor: bgColors, borderColor: bdColors, borderWidth: 1 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    }

    function metricsRenderJobsVsErrors(data) {
      var canvas = document.getElementById('metrics-chart-jobs-errors');
      if (!canvas || typeof Chart === 'undefined') return;
      var dailyJobs = data.dailyJobs || [];
      if (dailyJobs.length === 0) { metricsDestroyChart('jobsErrors'); drawEmptyCanvas(canvas, 'No data'); return; }

      var days = metricsRangeDays();
      var range = metricsBuildDateRange(days);
      var dateMap = {};
      for (var ri = 0; ri < range.length; ri++) dateMap[range[ri]] = { success: 0, errors: 0 };
      for (var i = 0; i < dailyJobs.length; i++) {
        var dj = dailyJobs[i];
        if (!dateMap[dj.date]) dateMap[dj.date] = { success: 0, errors: 0 };
        dateMap[dj.date].errors += (dj.errors || 0);
        dateMap[dj.date].success += ((dj.total || 0) - (dj.errors || 0));
      }
      var dates = Object.keys(dateMap).sort();
      var shortDates = dates.map(function(d) { return d.substring(5); });
      var successData = []; var errorData = [];
      for (var di = 0; di < dates.length; di++) {
        successData.push(dateMap[dates[di]].success);
        errorData.push(dateMap[dates[di]].errors);
      }

      metricsDestroyChart('jobsErrors');
      metricsCharts.jobsErrors = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: shortDates,
          datasets: [
            { label: 'Success', data: successData, backgroundColor: 'rgba(76,175,80,0.7)', borderColor: '#4CAF50', borderWidth: 1 },
            { label: 'Errors', data: errorData, backgroundColor: 'rgba(220,38,38,0.7)', borderColor: '#DC2626', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'rect' } } }
        }
      });
    }

    function metricsRenderDuration(durationBuckets) {
      var canvas = document.getElementById('metrics-chart-duration');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!durationBuckets || durationBuckets.length === 0) { metricsDestroyChart('duration'); drawEmptyCanvas(canvas, 'No data'); return; }

      var labels = []; var values = [];
      for (var i = 0; i < durationBuckets.length; i++) {
        labels.push(durationBuckets[i].label);
        values.push(durationBuckets[i].count);
      }

      metricsDestroyChart('duration');
      metricsCharts.duration = new Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Jobs', data: values, backgroundColor: 'rgba(184,151,90,0.6)', borderColor: '#B8975A', borderWidth: 1 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { display: false } }
        }
      });
    }

    function metricsRenderTaskSummary(ts) {
      var body = document.getElementById('metrics-task-summary');
      if (!body) return;
      if (!ts) { body.innerHTML = '<div class="metrics-empty">No tasks configured</div>'; return; }
      var od = ts.ondemand || {}; var sc = ts.scheduled || {}; var tg = ts.triggered || {};
      var hasData = (od.total || 0) + (sc.total || 0) + (tg.total || 0) > 0;
      if (!hasData) { body.innerHTML = '<div class="metrics-empty">No tasks configured</div>'; return; }

      var h = '<table style="width:100%;font-size:0.8rem;"><thead><tr><th></th><th>Tasks</th><th>Status</th><th>Runs (24h)</th><th>Failed</th><th>Total Runs</th></tr></thead><tbody>';
      h += '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--yellow);margin-right:4px;"></span>On-Demand</td>'
        + '<td>' + (od.total || 0) + '</td>'
        + '<td><span style="color:var(--green);">' + (od.active || 0) + ' active</span></td>'
        + '<td>' + (od.runs24h || 0) + '</td>'
        + '<td style="color:' + ((od.failed24h || 0) > 0 ? 'var(--red)' : 'var(--text-dim)') + ';">' + (od.failed24h || 0) + '</td>'
        + '<td>' + (od.totalRuns || 0) + '</td></tr>';
      h += '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--purple);margin-right:4px;"></span>Scheduled</td>'
        + '<td>' + (sc.total || 0) + '</td>'
        + '<td><span style="color:var(--green);">' + (sc.active || 0) + ' active</span>' + ((sc.paused || 0) > 0 ? ' <span style="color:var(--text-dim);">' + sc.paused + ' paused</span>' : '') + '</td>'
        + '<td>' + (sc.runs24h || 0) + '</td>'
        + '<td style="color:' + ((sc.failed24h || 0) > 0 ? 'var(--red)' : 'var(--text-dim)') + ';">' + (sc.failed24h || 0) + '</td>'
        + '<td>' + (sc.totalRuns || 0) + '</td></tr>';
      h += '<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--teal);margin-right:4px;"></span>Triggered</td>'
        + '<td>' + (tg.total || 0) + '</td>'
        + '<td><span style="color:var(--green);">' + (tg.enabled || 0) + ' enabled</span></td>'
        + '<td>' + (tg.runs24h || 0) + '</td>'
        + '<td style="color:' + ((tg.failed24h || 0) > 0 ? 'var(--red)' : 'var(--text-dim)') + ';">' + (tg.failed24h || 0) + '</td>'
        + '<td>' + (tg.totalRuns || 0) + '</td></tr>';
      h += '</tbody></table>';
      body.innerHTML = h;
    }

    function metricsRenderTaskRuns(ts) {
      var canvas = document.getElementById('metrics-chart-task-runs');
      if (!canvas || typeof Chart === 'undefined') return;
      var daily = ts ? (ts.dailyTaskRuns || []) : [];
      if (daily.length === 0) { metricsDestroyChart('taskRuns'); drawEmptyCanvas(canvas, 'No task runs'); return; }

      var days = metricsRangeDays();
      var range = metricsBuildDateRange(days);
      var dateSet = {};
      for (var ri = 0; ri < range.length; ri++) dateSet[range[ri]] = true;
      for (var i = 0; i < daily.length; i++) dateSet[daily[i].date] = true;
      var dates = Object.keys(dateSet).sort();
      var shortDates = dates.map(function(d) { return d.substring(5); });

      var runMap = {};
      for (var j = 0; j < daily.length; j++) {
        runMap[daily[j].date + ':' + daily[j].source] = { total: daily[j].total, failed: daily[j].failed };
      }
      var sources = ['on-demand', 'scheduled', 'triggered'];
      var datasets = [];
      var failedData = [];
      for (var di = 0; di < dates.length; di++) {
        var dayFailed = 0;
        for (var si2 = 0; si2 < sources.length; si2++) {
          var e2 = runMap[dates[di] + ':' + sources[si2]];
          if (e2) dayFailed += (e2.failed || 0);
        }
        failedData.push(dayFailed);
      }
      for (var si = 0; si < sources.length; si++) {
        var src = sources[si];
        var c = taskSourceColors[src] || { bg: 'rgba(156,163,175,0.7)', border: '#9CA3AF' };
        var successData = [];
        for (var di = 0; di < dates.length; di++) {
          var entry = runMap[dates[di] + ':' + src];
          successData.push(entry ? (entry.total - (entry.failed || 0)) : 0);
        }
        datasets.push({ label: src.charAt(0).toUpperCase() + src.slice(1), data: successData, backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 });
      }
      var hasFailed = failedData.some(function(v) { return v > 0; });
      if (hasFailed) {
        datasets.push({ label: 'Failed', data: failedData, backgroundColor: 'rgba(220,38,38,0.7)', borderColor: '#DC2626', borderWidth: 1 });
      }

      metricsDestroyChart('taskRuns');
      metricsCharts.taskRuns = new Chart(canvas, {
        type: 'bar',
        data: { labels: shortDates, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'rect' } } }
        }
      });
    }

    function metricsRenderOrchRuns(orchDailyRuns) {
      var canvas = document.getElementById('metrics-chart-orch-runs');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!orchDailyRuns || orchDailyRuns.length === 0) { metricsDestroyChart('orchRuns'); drawEmptyCanvas(canvas, 'No data'); return; }

      var days = metricsRangeDays();
      var range = metricsBuildDateRange(days);
      var dateSet = {};
      for (var ri = 0; ri < range.length; ri++) dateSet[range[ri]] = true;
      for (var i = 0; i < orchDailyRuns.length; i++) dateSet[orchDailyRuns[i].date] = true;
      var dates = Object.keys(dateSet).sort();
      var shortDates = dates.map(function(d) { return d.substring(5); });

      var runMap = {};
      for (var j = 0; j < orchDailyRuns.length; j++) {
        runMap[orchDailyRuns[j].date + ':' + orchDailyRuns[j].status] = orchDailyRuns[j].count;
      }

      var statusColors = {
        completed: { bg: 'rgba(76,175,80,0.7)', border: '#4CAF50' },
        failed:    { bg: 'rgba(220,38,38,0.7)', border: '#DC2626' },
        cancelled: { bg: 'rgba(156,163,175,0.7)', border: '#9CA3AF' }
      };
      var statuses = ['completed', 'failed', 'cancelled'];
      var datasets = [];
      for (var si = 0; si < statuses.length; si++) {
        var st = statuses[si];
        var sc = statusColors[st];
        var dd = [];
        for (var di = 0; di < dates.length; di++) dd.push(runMap[dates[di] + ':' + st] || 0);
        datasets.push({ label: st.charAt(0).toUpperCase() + st.slice(1), data: dd, backgroundColor: sc.bg, borderColor: sc.border, borderWidth: 1 });
      }

      metricsDestroyChart('orchRuns');
      metricsCharts.orchRuns = new Chart(canvas, {
        type: 'bar',
        data: { labels: shortDates, datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'rect' } } }
        }
      });
    }

    function metricsRenderOrchDuration(orchAvgDuration) {
      var canvas = document.getElementById('metrics-chart-orch-duration');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!orchAvgDuration || orchAvgDuration.length === 0) { metricsDestroyChart('orchDuration'); drawEmptyCanvas(canvas, 'No data'); return; }

      var labels = []; var values = [];
      for (var i = 0; i < orchAvgDuration.length; i++) {
        labels.push(orchAvgDuration[i].date.substring(5));
        values.push(orchAvgDuration[i].avgSec);
      }

      metricsDestroyChart('orchDuration');
      metricsCharts.orchDuration = new Chart(canvas, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Avg Duration (s)',
            data: values,
            borderColor: '#0d9488',
            backgroundColor: 'rgba(13,148,136,0.1)',
            borderWidth: 2, fill: true, tension: 0.3,
            pointRadius: 4, pointBackgroundColor: '#0d9488',
            pointBorderColor: metricsPointBorder(), pointBorderWidth: 1.5, pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 }, usePointStyle: true, pointStyle: 'circle' } } }
        }
      });
    }

    function metricsRenderErrorDist(errorCategories) {
      var canvas = document.getElementById('metrics-chart-error-dist');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!errorCategories || errorCategories.length === 0) { metricsDestroyChart('errorDist'); drawEmptyCanvas(canvas, 'No errors'); return; }

      var labels = []; var data = []; var bgColors = []; var bdColors = [];
      for (var i = 0; i < errorCategories.length; i++) {
        var c = errorCategories[i];
        var cc = errorCategoryColors[c.category] || errorCategoryColors['Other'];
        labels.push(c.category);
        data.push(c.count);
        bgColors.push(cc.bg);
        bdColors.push(cc.border);
      }

      metricsDestroyChart('errorDist');
      metricsCharts.errorDist = new Chart(canvas, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: bgColors, borderColor: bdColors, borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } } } }
      });
    }

    function metricsRenderErrorTrend(errorTrend) {
      var canvas = document.getElementById('metrics-chart-error-trend');
      if (!canvas || typeof Chart === 'undefined') return;
      if (!errorTrend || errorTrend.length === 0) { metricsDestroyChart('errorTrend'); drawEmptyCanvas(canvas, 'No errors'); return; }

      var dateSet = {}; var catSet = {};
      for (var i = 0; i < errorTrend.length; i++) { dateSet[errorTrend[i].date] = true; catSet[errorTrend[i].category] = true; }
      var dates = Object.keys(dateSet).sort();
      var categories = Object.keys(catSet).sort();
      var trendMap = {};
      for (var j = 0; j < errorTrend.length; j++) trendMap[errorTrend[j].date + ':' + errorTrend[j].category] = errorTrend[j].count;

      var datasets = [];
      for (var ci = 0; ci < categories.length; ci++) {
        var cat = categories[ci];
        var cc = errorCategoryColors[cat] || errorCategoryColors['Other'];
        var dd = [];
        for (var di = 0; di < dates.length; di++) dd.push(trendMap[dates[di] + ':' + cat] || 0);
        datasets.push({
          label: cat, data: dd,
          borderColor: cc.border, backgroundColor: cc.bg.replace('0.7', '0.1'),
          borderWidth: 2, fill: true, tension: 0.3,
          pointRadius: 3, pointBackgroundColor: cc.border,
          pointBorderColor: metricsPointBorder(), pointBorderWidth: 1.5, pointHoverRadius: 5
        });
      }

      metricsDestroyChart('errorTrend');
      metricsCharts.errorTrend = new Chart(canvas, {
        type: 'line',
        data: { labels: dates.map(function(d) { return d.substring(5); }), datasets: datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 10 }, usePointStyle: true, pointStyle: 'circle' } } }
        }
      });
    }

    function metricsRenderErrorByTool(errorByTool) {
      var card = document.getElementById('metrics-error-by-tool-body');
      if (!card) return;
      if (!errorByTool || errorByTool.length === 0) {
        card.innerHTML = '<div class="metrics-empty">No error data</div>';
        return;
      }
      var toolSet = {}; var catSet = {}; var dataMap = {};
      for (var i = 0; i < errorByTool.length; i++) {
        var e = errorByTool[i];
        toolSet[e.tool] = true; catSet[e.category] = true;
        dataMap[e.tool + ':' + e.category] = e.count;
      }
      var tools = Object.keys(toolSet).sort();
      var cats = Object.keys(catSet).sort();
      var h = '<table style="font-size:0.78rem;"><thead><tr><th>Tool</th>';
      for (var ci = 0; ci < cats.length; ci++) h += '<th>' + escapeHtml(cats[ci]) + '</th>';
      h += '<th>Total</th></tr></thead><tbody>';
      for (var ti = 0; ti < tools.length; ti++) {
        var total = 0;
        h += '<tr><td><span class="badge badge-tool">' + escapeHtml(tools[ti]) + '</span></td>';
        for (var cj = 0; cj < cats.length; cj++) {
          var v = dataMap[tools[ti] + ':' + cats[cj]] || 0;
          total += v;
          h += '<td>' + (v || '-') + '</td>';
        }
        h += '<td style="font-weight:600;">' + total + '</td></tr>';
      }
      h += '</tbody></table>';
      card.innerHTML = h;
    }

    function metricsRenderRecentErrors(recentErrors) {
      var card = document.getElementById('metrics-recent-errors-body');
      if (!card) return;
      if (!recentErrors || recentErrors.length === 0) {
        card.innerHTML = '<div class="metrics-empty">No errors</div>';
        return;
      }
      var h = '<table style="font-size:0.78rem;"><thead><tr><th>Job</th><th>Tool</th><th>Error</th><th>When</th></tr></thead><tbody>';
      for (var i = 0; i < recentErrors.length; i++) {
        var e = recentErrors[i];
        h += '<tr>'
          + '<td><code>' + escapeHtml((e.jobId || '').substring(0, 8)) + '</code></td>'
          + '<td><span class="badge badge-tool">' + escapeHtml(e.tool || '') + '</span></td>'
          + '<td style="color:var(--red);">' + escapeHtml(e.errorKind || '-') + '</td>'
          + '<td>' + escapeHtml(timeAgo(e.startedAt)) + '</td>'
          + '</tr>';
      }
      h += '</tbody></table>';
      card.innerHTML = h;
    }

    function metricsRenderQueueGauge(queueDepth) {
      var el = document.getElementById('metrics-queue-gauge-body');
      if (!el) return;
      if (!queueDepth) { el.innerHTML = '<div class="metrics-empty">No queue data</div>'; return; }
      var running = queueDepth.running || 0;
      var pending = queueDepth.pending || 0;
      var total = running + pending;

      el.innerHTML = '<div class="gauge-card">'
        + '<div class="gauge-ring"><canvas id="metrics-gauge-canvas" width="80" height="80"></canvas>'
        + '<div class="gauge-center"><div class="gauge-value">' + total + '</div><div class="gauge-label">jobs</div></div></div>'
        + '<div class="gauge-stats">'
        + '<div class="gauge-stat-row"><span class="gauge-stat-dot" style="background:var(--blue);"></span><span class="gauge-stat-label">Running</span><span class="gauge-stat-value">' + running + '</span></div>'
        + '<div class="gauge-stat-row"><span class="gauge-stat-dot" style="background:var(--yellow);"></span><span class="gauge-stat-label">Pending</span><span class="gauge-stat-value">' + pending + '</span></div>'
        + '</div></div>';

      // Draw gauge arc (HiDPI-aware)
      var gaugeCanvas = document.getElementById('metrics-gauge-canvas');
      if (gaugeCanvas && gaugeCanvas.getContext) {
        var dpr = window.devicePixelRatio || 1;
        var cssSize = 80;
        gaugeCanvas.width = cssSize * dpr;
        gaugeCanvas.height = cssSize * dpr;
        var ctx = gaugeCanvas.getContext('2d');
        ctx.scale(dpr, dpr);
        var cx = cssSize / 2; var cy = cssSize / 2; var r = 32; var lw = 8;
        var startAngle = 0.75 * Math.PI;
        var sweepAngle = 1.5 * Math.PI;
        ctx.lineWidth = lw; ctx.lineCap = 'round';
        // Empty arc (theme-aware)
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark'
          || (!document.documentElement.getAttribute('data-theme')
              && window.matchMedia('(prefers-color-scheme: dark)').matches);
        ctx.strokeStyle = isDark ? 'rgba(100,100,100,0.4)' : 'rgba(156,163,175,0.3)';
        ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, startAngle + sweepAngle); ctx.stroke();
        if (total > 0) {
          var runRatio = running / total;
          var compStyle = getComputedStyle(document.documentElement);
          // Running arc (blue)
          if (running > 0) {
            ctx.strokeStyle = compStyle.getPropertyValue('--blue').trim() || '#2563eb';
            ctx.beginPath(); ctx.arc(cx, cy, r, startAngle, startAngle + sweepAngle * runRatio); ctx.stroke();
          }
          // Pending arc (yellow)
          if (pending > 0) {
            ctx.strokeStyle = compStyle.getPropertyValue('--yellow').trim() || '#d97706';
            ctx.beginPath(); ctx.arc(cx, cy, r, startAngle + sweepAngle * runRatio, startAngle + sweepAngle); ctx.stroke();
          }
        }
      }
    }

    function metricsRenderDbSize(dbSizeBytes) {
      var el = document.getElementById('metrics-db-size-body');
      if (!el) return;
      if (dbSizeBytes == null) { el.innerHTML = '<div class="metrics-empty">-</div>'; return; }

      var size = dbSizeBytes;
      var unit = 'B';
      if (size >= 1073741824) { size = (size / 1073741824).toFixed(1); unit = 'GB'; }
      else if (size >= 1048576) { size = (size / 1048576).toFixed(1); unit = 'MB'; }
      else if (size >= 1024) { size = (size / 1024).toFixed(1); unit = 'KB'; }

      el.innerHTML = '<div class="stat-card-large">'
        + '<div class="stat-number">' + size + '</div>'
        + '<div class="stat-unit">' + unit + '</div>'
        + '</div>';
    }

    /* ── Helper: destroy a single chart by key ── */
    function metricsDestroyChart(key) {
      if (metricsCharts[key]) {
        metricsCharts[key].destroy();
        metricsCharts[key] = null;
      }
    }
`;
