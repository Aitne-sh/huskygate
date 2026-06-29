/** @module templates/layout — Main dashboard HTML shell with sidebar navigation and tab structure */
import { ICON_CHAT, ICON_CLAUDE, ICON_CODEX, ICON_GEMINI } from '../icons.js';

export function layoutHtml(config: { version: string }, escapeHtml: (s: string) => string): string {
  return `
</head>
<body>
  <nav class="sidebar">
    <div class="sidebar-brand">
      <h1>HuskyGate</h1>
      <div class="version">v${escapeHtml(config.version)}</div>
    </div>
    <ul class="nav-items">
      <!-- Core (fixed) -->
      <li><a class="nav-item" href="#overview" data-tab="overview">
        <span class="nav-icon">&#9673;</span><span class="nav-label">Overview</span>
      </a></li>
      <li><a class="nav-item" href="#chat" data-tab="chat">
        <span class="nav-icon"><img src="${ICON_CHAT}" alt="Chat" style="width:18px;height:18px;vertical-align:middle;border-radius:4px;"></span><span class="nav-label">Chat</span>
      </a></li>
      <li><a class="nav-item" href="#sessions" data-tab="sessions">
        <span class="nav-icon">&#9776;</span><span class="nav-label">Sessions</span>
      </a></li>
      <!-- Operations -->
      <li><a class="nav-item" href="#tasks" data-tab="tasks">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><span class="nav-label">Tasks</span>
      </a></li>
      <li><a class="nav-item" href="#metrics" data-tab="metrics">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span><span class="nav-label">Metrics</span>
      </a></li>
      <!-- Automation & Integration -->
      <li><a class="nav-item" href="#skills" data-tab="skills">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span><span class="nav-label">Skills</span>
      </a></li>
      <li><a class="nav-item" href="#agents" data-tab="agents">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span><span class="nav-label">Agents</span>
      </a></li>
      <li><a class="nav-item" href="#mcp" data-tab="mcp">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4m-3.5-7.5L17 7m-10 10l-1.5 1.5M20.5 17.5L19 17M5 7L3.5 5.5"/></svg></span><span class="nav-label">MCP</span>
      </a></li>
      <li><a class="nav-item" href="#webhooks" data-tab="webhooks">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span><span class="nav-label">Webhooks</span>
      </a></li>
      <!-- Admin -->
      <li><a class="nav-item" href="#dev" data-tab="dev">
        <span class="nav-icon">&#9672;</span><span class="nav-label">Developer</span>
      </a></li>
      <li><a class="nav-item" href="#logs" data-tab="logs">
        <span class="nav-icon">&#9998;</span><span class="nav-label">Logs</span>
      </a></li>
      <li><a class="nav-item" href="#settings" data-tab="settings">
        <span class="nav-icon">&#9881;</span><span class="nav-label">Settings</span>
      </a></li>
      <li><a class="nav-item" href="#docs" data-tab="docs">
        <span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span><span class="nav-label">Docs</span>
      </a></li>
    </ul>
    <div id="setup-status" class="sidebar-integration-card"></div>
  </nav>

  <div class="main">
    <div class="main-header">
      <h2 id="page-title">Overview</h2>
      <button class="theme-toggle" id="theme-toggle" onclick="toggleTheme()" title="Toggle dark mode">
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </div>
    <div class="content">

      <div class="offline-banner" id="offline-banner">Server is not running. Chat and session mutations are disabled.</div>
      <div class="restart-banner" id="restart-banner">
        <span style="flex:1;">Settings changed. Restart required for: <span class="restart-keys" id="restart-keys"></span></span>
        <button class="btn btn-primary" style="padding:0.25rem 0.75rem;font-size:0.8rem;" onclick="restartServer()">Restart Server</button>
        <button class="btn" style="padding:0.25rem 0.5rem;font-size:0.75rem;" onclick="dismissRestart()">Dismiss</button>
      </div>

      <!-- Overview Tab -->
      <div id="tab-overview" class="tab-panel">
        <div class="status-hero stopped" id="status-hero">
          <div class="status-hero-main">
            <div class="status-hero-left">
              <div class="status-hero-indicator">
                <span class="status-dot stopped" id="status-dot"></span>
              </div>
              <div class="status-hero-info">
                <span class="status-hero-label" id="status-text">Checking...</span>
                <span class="status-hero-pid" id="status-pid"></span>
              </div>
            </div>
            <div class="status-hero-actions">
              <button class="btn-daemon btn-daemon-start" id="btn-daemon-start" onclick="daemonStart()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Start
              </button>
              <button class="btn-daemon btn-daemon-stop" id="btn-daemon-stop" onclick="daemonStop()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                Stop
              </button>
            </div>
          </div>
          <div class="status-hero-meta" id="status-meta"></div>
        </div>
        <div class="metrics-grid" id="metrics-grid">
          <div class="card metric-card metric-card--clickable" id="metric-sessions" onclick="scrollToSection('sessions')" title="Go to Sessions">
            <div class="metric-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div class="metric-body">
              <div class="metric-value" id="stat-sessions">-</div>
              <div class="metric-label">Sessions</div>
              <div class="metric-sub" id="stat-active-sub"></div>
              <canvas class="sparkline-canvas" id="spark-sessions"></canvas>
            </div>
          </div>
          <div class="card metric-card metric-card--clickable" id="metric-jobs" onclick="location.hash='metrics'" title="Go to Metrics">
            <div class="metric-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div class="metric-body">
              <div class="metric-value" id="stat-jobs-24h">-</div>
              <div class="metric-label">Jobs (24h)</div>
              <div class="metric-sub" id="stat-total-jobs-sub"></div>
              <canvas class="sparkline-canvas" id="spark-jobs"></canvas>
            </div>
          </div>
          <div class="card metric-card metric-card--clickable" id="metric-success" onclick="location.hash='metrics'" title="Go to Metrics">
            <div class="metric-icon metric-icon--success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <div class="metric-body">
              <div class="metric-value" id="stat-success-rate">-</div>
              <div class="metric-label">Success Rate (7d)</div>
              <div class="metric-bar"><div class="metric-bar-fill" id="stat-success-bar"></div></div>
              <canvas class="sparkline-canvas" id="spark-success"></canvas>
            </div>
          </div>
          <div class="card metric-card metric-card--clickable" id="metric-health" onclick="location.hash='metrics'" title="Go to Metrics">
            <div class="metric-icon metric-icon--health">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </div>
            <div class="metric-body">
              <div class="metric-value" id="stat-errors-24h">-</div>
              <div class="metric-label">Errors (24h)</div>
              <div class="metric-sub" id="stat-errors-sub"></div>
              <canvas class="sparkline-canvas" id="spark-errors"></canvas>
            </div>
          </div>
        </div>
        <h3 class="section-title">Apps</h3>
        <div class="tools-grid">
          <div class="card tool-card" id="tool-card-claude" onclick="navigateToAppChat('claude')">
            <div class="tool-icon"><img src="${ICON_CLAUDE}" alt="Claude"></div>
            <h3>Claude</h3><p>Anthropic Claude Code CLI</p>
            <div class="tool-card-stats" id="tool-stats-claude"></div>
          </div>
          <div class="card tool-card" id="tool-card-codex" onclick="navigateToAppChat('codex')">
            <div class="tool-icon"><img src="${ICON_CODEX}" alt="Codex"></div>
            <h3>Codex</h3><p>OpenAI Codex CLI</p>
            <div class="tool-card-stats" id="tool-stats-codex"></div>
          </div>
          <div class="card tool-card" id="tool-card-gemini" onclick="navigateToAppChat('gemini')">
            <div class="tool-icon"><img src="${ICON_GEMINI}" alt="Gemini"></div>
            <h3>Gemini</h3><p>Google Gemini CLI</p>
            <div class="tool-card-stats" id="tool-stats-gemini"></div>
          </div>
        </div>
        <h3 class="section-title">Recent Activity</h3>
        <div class="card table-wrap" id="recent-activity-card">
          <div class="empty-state-inline">No job history yet</div>
        </div>
      </div>

      <!-- Metrics Tab -->
      <div id="tab-metrics" class="tab-panel">
        <div class="page-desc">
          <h4>About Metrics</h4>
          <p>
            Operational analytics for all AI task execution across the platform.<br>
            Tracks job activity, error rates, duration distribution, orchestrator performance, and system health.
            Use the time range filters (24h / 7d / 30d) to analyze trends and identify issues.
          </p>
          <p style="margin-top:0.5rem;">
            <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
            </a>
          </p>
        </div>
        <div class="metrics-toolbar">
          <div class="metrics-range-group">
            <button class="metrics-range-btn" data-range="24h" onclick="metricsSetRange('24h')">24h</button>
            <button class="metrics-range-btn active" data-range="7d" onclick="metricsSetRange('7d')">7d</button>
            <button class="metrics-range-btn" data-range="30d" onclick="metricsSetRange('30d')">30d</button>
          </div>
          <span class="auto-refresh-toggle" id="metrics-auto-refresh" onclick="metricsToggleAutoRefresh()">
            <span class="auto-refresh-dot"></span>
            Auto-refresh: 30s
          </span>
        </div>

        <h3 class="section-title">Job Activity</h3>
        <div class="charts-grid">
          <div class="card chart-container">
            <h4 class="chart-title">Job Activity</h4>
            <canvas id="metrics-chart-job-activity"></canvas>
          </div>
          <div class="card chart-container">
            <h4 class="chart-title">Jobs by Source</h4>
            <canvas id="metrics-chart-job-source"></canvas>
          </div>
        </div>

        <h3 class="section-title">Job Health</h3>
        <div class="charts-grid">
          <div class="card chart-container">
            <h4 class="chart-title">Jobs vs Errors</h4>
            <canvas id="metrics-chart-jobs-errors"></canvas>
          </div>
          <div class="card chart-container">
            <h4 class="chart-title">Duration Distribution</h4>
            <canvas id="metrics-chart-duration"></canvas>
          </div>
        </div>

        <h3 class="section-title">Task Runs</h3>
        <div class="charts-grid">
          <div class="card chart-container" id="metrics-task-summary-card">
            <h4 class="chart-title">Task Summary</h4>
            <div id="metrics-task-summary" style="font-size:0.82rem;padding:0.25rem 0;">
              <div class="metrics-empty">Loading...</div>
            </div>
          </div>
          <div class="card chart-container">
            <h4 class="chart-title">Task Runs by Source</h4>
            <canvas id="metrics-chart-task-runs"></canvas>
          </div>
        </div>

        <h3 class="section-title">Orchestrator</h3>
        <div class="charts-grid">
          <div class="card chart-container">
            <h4 class="chart-title">Orchestration Runs Status</h4>
            <canvas id="metrics-chart-orch-runs"></canvas>
          </div>
          <div class="card chart-container">
            <h4 class="chart-title">Avg Orchestration Duration</h4>
            <canvas id="metrics-chart-orch-duration"></canvas>
          </div>
        </div>

        <h3 class="section-title">Error Analysis</h3>
        <div class="charts-grid">
          <div class="card chart-container">
            <h4 class="chart-title">Error Distribution</h4>
            <canvas id="metrics-chart-error-dist"></canvas>
          </div>
          <div class="card chart-container">
            <h4 class="chart-title">Error Trend</h4>
            <canvas id="metrics-chart-error-trend"></canvas>
          </div>
        </div>
        <div class="data-grid-2">
          <div class="card table-wrap" id="metrics-error-by-tool">
            <h4 class="card-title">Errors by Tool</h4>
            <div id="metrics-error-by-tool-body"><div class="metrics-empty">No error data</div></div>
          </div>
          <div class="card table-wrap" id="metrics-recent-errors">
            <h4 class="card-title">Recent Errors</h4>
            <div id="metrics-recent-errors-body"><div class="metrics-empty">No errors</div></div>
          </div>
        </div>

        <h3 class="section-title">System</h3>
        <div class="charts-grid">
          <div class="card chart-container" id="metrics-queue-gauge">
            <h4 class="chart-title">Queue Depth</h4>
            <div id="metrics-queue-gauge-body"><div class="metrics-empty">Loading...</div></div>
          </div>
          <div class="card chart-container" id="metrics-db-size">
            <h4 class="chart-title">Database Size</h4>
            <div id="metrics-db-size-body"><div class="metrics-empty">Loading...</div></div>
          </div>
        </div>
      </div>

      <!-- Sessions Tab -->
      <div id="tab-sessions" class="tab-panel">
        <div class="page-toolbar">
          <button class="btn btn-danger" onclick="clearAllSessions()">Clear All Sessions</button>
        </div>
        <div class="page-desc">
          <h4>About Sessions</h4>
          <p>
            Active AI agent instances managed by HuskyGate.<br>
            Each session tracks a running AI agent (Claude / Codex / Gemini) with its working directory, execution mode, and current status.
            Sessions are created when tasks, orchestrator nodes, or Slack commands execute, and can be monitored or terminated from here.
          </p>
          <p style="margin-top:0.5rem;">
            <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
            </a>
          </p>
        </div>
        <div class="card table-wrap">
          <table>
            <thead>
              <tr>
                <th></th><th>ID</th><th>User</th><th>Tool</th><th>Mode</th>
                <th>Status</th><th>Started</th><th>Updated</th><th></th>
              </tr>
            </thead>
            <tbody id="sessions-tbody"></tbody>
          </table>
        </div>
      </div>

      <!-- Logs Tab -->
      <div id="tab-logs" class="tab-panel">
        <div class="log-toolbar">
          <span class="chip active" data-source="all" onclick="switchLogSource(this)">All</span>
          <span class="chip" data-source="server" onclick="switchLogSource(this)">Server</span>
          <span class="chip" data-source="dashboard" onclick="switchLogSource(this)">Dashboard</span>
          <span class="chip-divider"></span>
          <span class="chip active" data-level="all" onclick="filterLog(this)">All</span>
          <span class="chip" data-level="info" onclick="filterLog(this)">Info</span>
          <span class="chip" data-level="warn" onclick="filterLog(this)">Warn</span>
          <span class="chip" data-level="error" onclick="filterLog(this)">Error</span>
          <span class="chip" data-level="debug" onclick="filterLog(this)">Debug</span>
          <input class="log-search" id="log-search" placeholder="Search..." oninput="renderLogs()">
          <span class="log-count" id="log-count"></span>
          <span class="refresh-dot" id="refresh-dot"></span>
          <button class="btn btn-log-live" id="btn-log-live" onclick="logToggleLive()" title="Toggle live tail">Live</button>
          <button class="btn" id="btn-log-refresh" onclick="refreshLogs()" title="Refresh" style="padding:0.2rem 0.5rem;font-size:0.78rem;">&#x21bb;</button>
        </div>
        <div class="log-scroll" id="log-container"></div>
        <div class="log-footer">
          <button class="btn" id="btn-load-more" onclick="loadMoreLogs()" style="display:none">Load More</button>
        </div>
      </div>

      <!-- Settings Tab -->
      <div id="tab-settings" class="tab-panel">
        <div class="settings-layout">
          <div class="settings-nav" id="settings-nav"></div>
          <div class="settings-subnav" id="settings-subnav"></div>
          <div class="settings-form-panel" id="settings-form-panel">
            <div class="settings-form-empty">Select a category</div>
          </div>
        </div>
      </div>

      <!-- Docs Tab -->
      <div id="tab-docs" class="tab-panel">
        <div class="docs-layout">
          <div class="docs-nav" id="docs-nav"></div>
          <div class="docs-content-panel" id="docs-content"></div>
          <div class="docs-back-top" id="docs-back-top" onclick="docsScrollTop()" title="Back to top">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </div>
        </div>
      </div>

      <!-- Tasks Landing Tab -->
      <div id="tab-tasks" class="tab-panel">
        <div class="task-nav-list">
          <div class="card task-nav-card task-nav-orchestrator" onclick="location.hash='orchestrators'">
            <div class="task-nav-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="7" x2="5" y2="17"/><line x1="12" y1="7" x2="19" y2="17"/><line x1="5" y1="17" x2="19" y2="17"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <h3>Orchestrators</h3>
              <p>DAG-based multi-task workflows that orchestrate multiple AI agents. Connect tasks as a directed graph with return-value branching, fan-out/fan-in parallelism, and conditional routing.</p>
            </div>
            <svg class="card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </div>
          <div class="card task-nav-card task-nav-ondemand" onclick="location.hash='ondemand-tasks'">
            <div class="task-nav-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <h3>On-Demand Tasks</h3>
              <p>Pre-defined tasks you can execute instantly from the dashboard or Slack. Configure a prompt, target AI agent, retry policy, and notification settings for repeatable operations like deployments or report generation.</p>
            </div>
            <svg class="card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </div>
          <div class="card task-nav-card task-nav-schedule" onclick="location.hash='schedule-tasks'">
            <div class="task-nav-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <h3>Schedule Tasks</h3>
              <p>Time-triggered tasks that run automatically on a schedule. Supports one-time execution at a specific date/time or recurring runs via cron expressions with timezone and max-run limits.</p>
            </div>
            <svg class="card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </div>
          <div class="card task-nav-card task-nav-triggered" onclick="location.hash='triggered-tasks'">
            <div class="task-nav-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
              <h3>Triggered Tasks</h3>
              <p>Event-driven tasks that start automatically when an incoming webhook matches a subscription filter. Payload context is extracted and routed to the AI agent as part of the task prompt.</p>
            </div>
            <svg class="card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
          </div>
        </div>
      </div>

      <!-- On-Demand Tasks Tab -->
      <div id="tab-ondemand-tasks" class="tab-panel">
        <div class="page-header">
          <button class="btn" onclick="location.hash='tasks'" style="font-size:0.82rem;display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>Back</button>
          <button class="btn btn-primary" onclick="qtShowCreateModal()">+ New Task</button>
        </div>
        <div class="page-desc">
          <h4>About On-Demand Tasks</h4>
          <p>
            Pre-defined tasks you can execute instantly from the dashboard or Slack via <code>!task &lt;name|alias&gt;</code>.<br>
            Each task stores a prompt, target app (Claude / Codex / Gemini), and optional retry &amp; Slack notification settings.<br>
            Use these for repeatable operations such as deployments, report generation, or repository maintenance.
          </p>
        </div>
        <div id="qt-task-list"></div>

        <!-- Create/Edit Modal -->
        <div id="qt-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)qtCloseModal()">
          <div class="modal-content">
            <h3 id="qt-modal-title" class="modal-title">New On-Demand Task</h3>
            <input type="hidden" id="qt-input-id" value="">
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:110px;">Name</td><td><input class="settings-input" id="qt-input-name" placeholder="Deploy Staging"></td></tr>
              <tr><td class="key-cell">Alias</td><td><input class="settings-input" id="qt-input-alias" placeholder="deploy (optional, for Slack !task)"><div class="sched-help-text">Short name for Slack: <code>!task deploy</code>. If empty, the task name is used.</div></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Description</td><td><textarea class="settings-input" id="qt-input-description" rows="2" style="resize:vertical;font-size:0.82rem;" placeholder="Optional summary of what this task does" maxlength="2000"></textarea></td></tr>
              <tr><td class="key-cell">Working Directory</td><td><div style="display:flex;gap:0.4rem;align-items:center;"><input class="settings-input" id="qt-input-workdir" placeholder="(auto-generated if empty)" style="flex:1;" readonly><button type="button" class="btn btn-browse-dir" onclick="pickDirectory('qt-input-workdir')" style="white-space:nowrap;">Browse</button><button type="button" class="btn" onclick="document.getElementById('qt-input-workdir').value=''" style="padding:0.3rem 0.5rem;font-size:0.75rem;" title="Clear">&times;</button></div><div class="sched-help-text">Custom working directory path. Leave empty to auto-generate.</div></td></tr>
              <tr id="qt-row-agent"><td class="key-cell">Agent</td><td>
                <select class="settings-input" id="qt-input-agent"><option value="">None (configure manually)</option></select>
                <div class="sched-help-text">Select a pre-defined agent. Tool, MCP, and Skills will be inherited.</div>
                <div id="qt-agent-summary" style="display:none;"></div>
              </td></tr>
              <tr id="qt-row-tool"><td class="key-cell">App</td><td><select class="settings-input" id="qt-input-tool"><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option></select></td></tr>
              <tr id="qt-row-model"><td class="key-cell">Model</td><td><div id="qt-model-field"></div><div class="sched-help-text">Leave empty for system default</div></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Prompt</td><td><textarea class="settings-input" id="qt-input-prompt" rows="4" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Enter the prompt to execute..."></textarea></td></tr>
              <tr><td class="key-cell">Max Retries</td><td>
                <input class="settings-input" type="number" id="qt-input-max-retries" value="0" min="0" max="10" style="width:100px;">
                <div class="sched-help-text">Number of automatic retries on failure (0 = no retry)</div>
              </td></tr>
              <tr id="qt-row-mcp"><td class="key-cell">MCP</td><td>
                <div id="qt-mcp-section"></div>
              </td></tr>
              <tr id="qt-row-skills"><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Skills</td><td>
                <div id="qt-skills-section"></div>
              </td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Additional Instructions</td><td>
                <textarea class="settings-input" id="qt-input-instruction-file" rows="3" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Optional custom instructions appended to the built-in instruction file"></textarea>
                <div class="sched-help-text">Custom content appended to the instruction file (CLAUDE.md / AGENTS.md / GEMINI.md) at runtime. Leave empty for default.</div>
              </td></tr>
              <tr><td class="key-cell">Slack Notify</td><td>
                <select class="settings-input" id="qt-input-notify-select"><option value="">None</option><option value="" disabled>Loading...</option></select>
                <input class="settings-input" id="qt-input-notify-manual" style="display:none;" placeholder="Channel ID (e.g. C01234ABCDE)">
              </td></tr>
              <tr><td class="key-cell">Thread ID</td><td>
                <input class="settings-input" id="qt-input-notify-thread" placeholder="e.g. 1234567890.123456" style="font-family:monospace;font-size:0.85rem;">
                <div class="sched-help-text">Optional Slack thread timestamp. Replies will be posted in this thread.</div>
              </td></tr>
            </tbody></table>
            <div class="btn-group" style="justify-content:flex-end">
              <button class="btn" onclick="qtCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="qt-modal-save" onclick="qtSaveTask()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Schedule Tasks Tab -->
      <div id="tab-schedule-tasks" class="tab-panel">
        <div class="page-header">
          <button class="btn" onclick="location.hash='tasks'" style="font-size:0.82rem;display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>Back</button>
          <button class="btn btn-primary" onclick="schedShowCreateModal()">+ New Task</button>
        </div>
        <div class="page-desc">
          <h4>About Schedule Tasks</h4>
          <p>
            Time-triggered tasks that run automatically on a schedule.<br>
            Supports one-time execution at a specific date/time or recurring runs via cron expressions with timezone support.<br>
            Configure max runs to auto-stop after N executions, and enable Slack notifications to receive results.
          </p>
        </div>
        <div id="sched-task-list"></div>

        <!-- Create/Edit Modal -->
        <div id="sched-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)schedCloseModal()">
          <div class="modal-content">
            <h3 id="sched-modal-title" class="modal-title">New Schedule Task</h3>
            <input type="hidden" id="sched-input-id" value="">
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:110px;">Name</td><td><input class="settings-input" id="sched-input-name" placeholder="Daily Report"></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Description</td><td><textarea class="settings-input" id="sched-input-description" rows="2" style="resize:vertical;font-size:0.82rem;" placeholder="Optional summary of what this task does" maxlength="2000"></textarea></td></tr>
              <tr><td class="key-cell">Working Directory</td><td><div style="display:flex;gap:0.4rem;align-items:center;"><input class="settings-input" id="sched-input-workdir" placeholder="(auto-generated if empty)" style="flex:1;" readonly><button type="button" class="btn btn-browse-dir" onclick="pickDirectory('sched-input-workdir')" style="white-space:nowrap;">Browse</button><button type="button" class="btn" onclick="document.getElementById('sched-input-workdir').value=''" style="padding:0.3rem 0.5rem;font-size:0.75rem;" title="Clear">&times;</button></div><div class="sched-help-text">Custom working directory path. Leave empty to auto-generate.</div></td></tr>
              <tr id="sched-row-agent"><td class="key-cell">Agent</td><td>
                <select class="settings-input" id="sched-input-agent"><option value="">None (configure manually)</option></select>
                <div class="sched-help-text">Select a pre-defined agent. Tool, MCP, and Skills will be inherited.</div>
                <div id="sched-agent-summary" style="display:none;"></div>
              </td></tr>
              <tr id="sched-row-tool"><td class="key-cell">App</td><td><select class="settings-input" id="sched-input-tool"><option value="claude">Claude</option><option value="codex">Code</option><option value="gemini">Gemini</option></select></td></tr>
              <tr id="sched-row-model"><td class="key-cell">Model</td><td id="sched-model-cell"></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Prompt</td><td><textarea class="settings-input" id="sched-input-prompt" rows="4" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Enter the prompt to execute..."></textarea></td></tr>
              <tr><td class="key-cell">Type</td><td>
                <div class="btn-toggle-group" id="sched-type-toggle">
                  <button type="button" onclick="schedSetType('once')" id="sched-toggle-once" class="active">One-time</button>
                  <button type="button" onclick="schedSetType('recurring')" id="sched-toggle-recurring">Recurring</button>
                </div>
              </td></tr>
              <tr id="sched-row-once"><td class="key-cell">Date / Time</td><td style="display:flex;gap:0.5rem;">
                <input class="settings-input" type="date" id="sched-input-date" style="flex:1;">
                <input class="settings-input" type="time" id="sched-input-time" style="flex:1;">
              </td></tr>
              <tr id="sched-row-cron-time" style="display:none;"><td class="key-cell">Time</td><td>
                <input class="settings-input" type="time" id="sched-cron-time" value="09:00" style="width:140px;">
              </td></tr>
              <tr id="sched-row-cron-days" style="display:none;"><td class="key-cell">Repeat</td><td>
                <div class="btn-toggle-group" id="sched-repeat-toggle">
                  <button type="button" onclick="schedSetRepeat('daily')" id="sched-repeat-daily" class="active">Every day</button>
                  <button type="button" onclick="schedSetRepeat('weekdays')" id="sched-repeat-weekdays">Weekdays</button>
                  <button type="button" onclick="schedSetRepeat('custom')" id="sched-repeat-custom">Custom</button>
                </div>
                <div id="sched-custom-days" style="display:none;">
                  <div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.5rem;">
                    <label class="sched-day-label"><input type="checkbox" value="1" class="sched-day-cb"> Mon</label>
                    <label class="sched-day-label"><input type="checkbox" value="2" class="sched-day-cb"> Tue</label>
                    <label class="sched-day-label"><input type="checkbox" value="3" class="sched-day-cb"> Wed</label>
                    <label class="sched-day-label"><input type="checkbox" value="4" class="sched-day-cb"> Thu</label>
                    <label class="sched-day-label"><input type="checkbox" value="5" class="sched-day-cb"> Fri</label>
                    <label class="sched-day-label"><input type="checkbox" value="6" class="sched-day-cb"> Sat</label>
                    <label class="sched-day-label"><input type="checkbox" value="0" class="sched-day-cb"> Sun</label>
                  </div>
                </div>
              </td></tr>
              <tr id="sched-row-cron-adv" style="display:none;"><td></td><td>
                <a href="#" onclick="schedToggleAdvancedCron(event)" id="sched-adv-link" style="font-size:0.75rem;color:var(--text-dim);text-decoration:none;">Advanced: cron expression</a>
                <div id="sched-cron-raw-wrap" style="display:none;margin-top:0.35rem;">
                  <input class="settings-input" id="sched-input-cron" placeholder="0 9 * * 1-5">
                  <div class="sched-help-text">Format: minute hour day-of-month month day-of-week</div>
                </div>
              </td></tr>
              <tr><td class="key-cell">Timezone</td><td>
                <input type="hidden" id="sched-input-tz" value="">
                <span id="sched-tz-label" class="settings-input" style="display:inline-block;background:var(--surface);cursor:default;opacity:0.85;"></span>
              </td></tr>
              <tr id="sched-row-max-runs" style="display:none;"><td class="key-cell">Run Limit</td><td>
                <input class="settings-input" type="number" id="sched-input-max-runs" placeholder="unlimited" min="1">
                <div class="sched-help-text">Auto-completes after N executions (empty = unlimited)</div>
              </td></tr>
              <tr><td class="key-cell">Max Retries</td><td>
                <input class="settings-input" type="number" id="sched-input-max-retries" value="0" min="0" max="10" style="width:100px;">
                <div class="sched-help-text">Number of automatic retries on failure (0 = no retry)</div>
              </td></tr>
              <tr id="sched-row-mcp"><td class="key-cell">MCP</td><td>
                <div id="sched-mcp-section"></div>
              </td></tr>
              <tr id="sched-row-skills"><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Skills</td><td>
                <div id="sched-skills-section"></div>
              </td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Additional Instructions</td><td>
                <textarea class="settings-input" id="sched-input-instruction-file" rows="3" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Optional custom instructions appended to the built-in instruction file"></textarea>
                <div class="sched-help-text">Custom content appended to the instruction file (CLAUDE.md / AGENTS.md / GEMINI.md) at runtime. Leave empty for default.</div>
              </td></tr>
              <tr><td class="key-cell">Slack Notify <span style="color:var(--red);">*</span></td><td>
                <select class="settings-input" id="sched-input-notify-select"><option value="" disabled selected>Loading...</option></select>
                <input class="settings-input" id="sched-input-notify-manual" style="display:none;" placeholder="Channel ID (e.g. C01234ABCDE)">
              </td></tr>
              <tr><td class="key-cell">Thread ID</td><td>
                <input class="settings-input" id="sched-input-notify-thread" placeholder="e.g. 1234567890.123456" style="font-family:monospace;font-size:0.85rem;">
                <div class="sched-help-text">Optional Slack thread timestamp. Replies will be posted in this thread.</div>
              </td></tr>
            </tbody></table>
            <div class="btn-group" style="justify-content:flex-end">
              <button class="btn" onclick="schedCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="sched-modal-save" onclick="schedSaveTask()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Triggered Tasks Tab -->
      <div id="tab-triggered-tasks" class="tab-panel">
        <div class="page-header">
          <button class="btn" onclick="location.hash='tasks'" style="font-size:0.82rem;display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>Back</button>
          <button class="btn btn-primary" onclick="ttShowCreateModal()">+ New Task</button>
        </div>
        <div class="page-desc">
          <h4>About Triggered Tasks</h4>
          <p>
            Event-driven tasks that execute automatically when a matching webhook event is received.<br>
            Link a task to a webhook endpoint with optional filter rules and context mapping to extract data from the payload.<br>
            Use these for automated workflows such as PR reviews, deployment hooks, or CI/CD event responses.
          </p>
        </div>
        <div id="tt-task-list"></div>

        <div id="tt-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)ttCloseModal()">
          <div class="modal-content">
            <h3 id="tt-modal-title" class="modal-title">New Triggered Task</h3>
            <input type="hidden" id="tt-input-id" value="">
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:120px;">Name</td><td><input class="settings-input" id="tt-input-name" placeholder="Review Pull Request"></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Description</td><td><textarea class="settings-input" id="tt-input-description" rows="2" style="resize:vertical;font-size:0.82rem;" placeholder="Optional summary of what this task does" maxlength="2000"></textarea></td></tr>
              <tr><td class="key-cell">Working Directory</td><td><div style="display:flex;gap:0.4rem;align-items:center;"><input class="settings-input" id="tt-input-workdir" placeholder="(auto-generated if empty)" style="flex:1;" readonly><button type="button" class="btn btn-browse-dir" onclick="pickDirectory('tt-input-workdir')" style="white-space:nowrap;">Browse</button><button type="button" class="btn" onclick="document.getElementById('tt-input-workdir').value=''" style="padding:0.3rem 0.5rem;font-size:0.75rem;" title="Clear">&times;</button></div><div class="sched-help-text">Custom working directory path. Leave empty to auto-generate.</div></td></tr>
              <tr id="tt-row-agent"><td class="key-cell">Agent</td><td>
                <select class="settings-input" id="tt-input-agent"><option value="">None (configure manually)</option></select>
                <div class="sched-help-text">Select a pre-defined agent. Tool, MCP, and Skills will be inherited.</div>
                <div id="tt-agent-summary" style="display:none;"></div>
              </td></tr>
              <tr id="tt-row-tool"><td class="key-cell">App</td><td><select class="settings-input" id="tt-input-tool"><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option></select></td></tr>
              <tr id="tt-row-model"><td class="key-cell">Model</td><td><div id="tt-model-field"></div><div class="sched-help-text">Leave empty for system default</div></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Prompt</td><td><textarea class="settings-input" id="tt-input-prompt" rows="4" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Enter the prompt to execute after the event matches..."></textarea></td></tr>
              <tr><td class="key-cell">Max Retries</td><td><input class="settings-input" type="number" id="tt-input-max-retries" value="0" min="0" max="10" style="width:100px;"><div class="sched-help-text">Number of automatic retries on failure (0 = no retry)</div></td></tr>
              <tr><td class="key-cell">Concurrency</td><td><select class="settings-input" id="tt-input-concurrency-policy"><option value="skip_if_running">Skip if running</option><option value="allow">Allow parallel runs</option></select><div class="sched-help-text">Choose whether duplicate events can run concurrently or should be ignored while a previous run is still active.</div></td></tr>
              <tr id="tt-row-mcp"><td class="key-cell">MCP</td><td><div id="tt-mcp-section"></div></td></tr>
              <tr id="tt-row-skills"><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Skills</td><td><div id="tt-skills-section"></div></td></tr>
              <tr><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Additional Instructions</td><td><textarea class="settings-input" id="tt-input-instruction-file" rows="3" style="resize:vertical;font-family:monospace;font-size:0.82rem;" placeholder="Optional custom instructions appended to the built-in instruction file"></textarea><div class="sched-help-text">Custom content appended to the instruction file (CLAUDE.md / AGENTS.md / GEMINI.md) at runtime. Leave empty for default.</div></td></tr>
              <tr><td class="key-cell">Slack Notify</td><td><select class="settings-input" id="tt-input-notify-select"><option value="">None</option><option value="" disabled>Loading...</option></select><input class="settings-input" id="tt-input-notify-manual" style="display:none;" placeholder="Channel ID (e.g. C01234ABCDE)"><div class="sched-help-text">Optional notification target for completed runs. If a DM user ID is selected, it is also used as the task owner.</div></td></tr>
              <tr><td class="key-cell">Notify Thread</td><td><input class="settings-input" id="tt-input-notify-thread" placeholder="e.g. 1234567890.123456" style="font-family:monospace;font-size:0.85rem;"><div class="sched-help-text">Optional Slack thread timestamp. Leave empty to post to the channel directly.</div></td></tr>
              <tr><td class="key-cell">Enabled</td><td><label class="toggle-switch"><input type="checkbox" id="tt-input-enabled" checked><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Accept events immediately after saving</span></label></td></tr>
            </tbody></table>
            <div class="webhook-trigger-section">
              <div class="webhook-trigger-title">Webhook Trigger</div>
              <table class="settings-table" style="margin:0;"><tbody>
                <tr><td class="key-cell" style="width:120px;">Endpoint</td><td><select class="settings-input" id="tt-input-endpoint" onchange="ttToggleWebhookFields()"><option value="">None (manual trigger only)</option></select><div class="sched-help-text">Select a webhook endpoint configured in the Webhooks page. Leave empty for manual-only tasks.</div></td></tr>
                <tr id="tt-row-filter" style="display:none;"><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Filter JSON</td><td><textarea class="settings-input" id="tt-input-filter-json" rows="5" style="resize:vertical;font-family:monospace;font-size:0.8rem;" placeholder='{"match":[{"path":"_trigger.event","eq":"pull_request"},{"path":"body.action","in":["opened","synchronize"]}]}'></textarea><div class="sched-help-text">AND array with operators <code>eq</code>, <code>in</code>, <code>exists</code>, <code>prefix</code>. Leave empty to match every event.</div></td></tr>
                <tr id="tt-row-mapping" style="display:none;"><td class="key-cell" style="vertical-align:top;padding-top:0.6rem;">Context Mapping</td><td><textarea class="settings-input" id="tt-input-mapping-json" rows="5" style="resize:vertical;font-family:monospace;font-size:0.8rem;" placeholder='{"repo":"body.repository.full_name","branch":"body.pull_request.head.ref","action":"body.action","sender":"body.sender.login"}'></textarea><div class="sched-help-text">Map output keys to dot-path expressions extracted from the webhook payload.</div></td></tr>
              </tbody></table>
            </div>
            <div class="btn-group" style="justify-content:flex-end;margin-top:0.5rem;">
              <button class="btn" onclick="ttCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="tt-modal-save" onclick="ttSaveTask()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Agents Tab -->
      <div id="tab-agents" class="tab-panel">
        <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span style="font-size:1.1rem;font-weight:600;">Agents</span>
          </div>
          <button class="btn btn-primary" onclick="agentOpenModal(null)" style="display:flex;align-items:center;gap:0.3rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Agent
          </button>
        </div>
        <div class="page-desc">
          <h4>About Agents</h4>
          <p>
            Reusable AI personas with pre-configured app, system instruction, skills, and MCP servers.<br>
            Agents defined here can be assigned to <strong>On-Demand Tasks</strong>, <strong>Orchestrator Nodes</strong>, and <strong>Triggered Tasks</strong> as execution targets.<br>
            When a task uses an agent, the agent's configuration (app, instruction, skills, MCP) is inherited automatically.
          </p>
          <p style="margin-top:0.5rem;">
            <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
            </a>
          </p>
        </div>
        <div id="agents-list"></div>
      </div>

      <!-- Webhooks Tab -->
      <div id="tab-webhooks" class="tab-panel">
        <div class="page-header">
          <div></div>
          <div class="btn-group" style="margin-left:auto;">
            <button class="btn" onclick="evtLoadPage()">Refresh</button>
            <button class="btn btn-primary" onclick="evtShowCreateEndpointModal()">+ New Endpoint</button>
          </div>
        </div>
        <div class="page-desc">
          <h4>About Webhooks</h4>
          <p>
            Receive external events via HTTP endpoints with configurable signature verification.<br>
            Create endpoints with publisher-specific presets (GitHub, Slack, Jira) or generic HMAC / bearer token verification.
            Incoming payloads can trigger <a href="#tasks" style="color:var(--link);">Triggered Tasks</a> automatically through event subscriptions, routing context to the AI agent as part of the prompt.
            Optionally expose endpoints publicly via <strong>Cloudflare Tunnel</strong>.
          </p>
          <p style="margin-top:0.5rem;">
            <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
            </a>
          </p>
        </div>
        <div class="evt-url-bar">
          <span class="evt-url-bar-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>Payload URL</span>
          <div class="evt-url-preview" id="evt-url-display">
            <code id="evt-url-value">http://localhost:3738</code>
          </div>
        </div>
        <div class="evt-tunnel-bar">
          <div class="evt-tunnel-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span class="evt-tunnel-title">Cloudflare Tunnel</span>
            <span class="evt-tunnel-status" id="evt-tunnel-status-badge">Inactive</span>
          </div>
          <div class="evt-tunnel-right">
            <a class="evt-tunnel-docs-btn" href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/" target="_blank" rel="noopener noreferrer" title="Cloudflare Tunnel Documentation">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              Docs
            </a>
            <label class="evt-tunnel-toggle" title="Enable Cloudflare Tunnel for secure public webhook URL">
              <input type="checkbox" id="evt-tunnel-checkbox" onchange="evtToggleTunnel(this.checked)">
              <span class="evt-tunnel-slider"></span>
            </label>
          </div>
        </div>
        <div id="evt-secret-banner" style="display:none;margin-bottom:0.75rem;padding:0.6rem 0.85rem;border-radius:10px;border:1px solid rgba(13,138,106,0.22);background:rgba(13,138,106,0.06);animation:fadeSlideIn 0.2s ease-out both;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D8A6A" stroke-width="2" style="flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <div style="flex:1;min-width:0;">
              <span id="evt-secret-title" style="font-weight:600;font-size:0.82rem;">Save the signing secret</span>
              <span style="font-size:0.72rem;color:var(--text-dim);margin-left:0.5rem;">Shown once only</span>
            </div>
            <code id="evt-secret-value" style="font-size:0.78rem;background:var(--surface-2);padding:0.25rem 0.6rem;border-radius:6px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></code>
            <div class="btn-group" style="flex-shrink:0;">
              <button class="btn" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="evtCopySecret()">Copy</button>
              <button class="btn" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="evtHideSecret()">Dismiss</button>
            </div>
          </div>
        </div>
        <div id="evt-endpoint-list"></div>

        <div id="evt-endpoint-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)evtCloseEndpointModal()">
          <div class="modal-content">
            <h3 id="evt-endpoint-modal-title" class="modal-title">New Webhook Endpoint</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:130px;">Publisher</td><td><select class="settings-input" id="evt-endpoint-input-preset" onchange="evtApplyEndpointPreset()"><option value="generic">generic</option><option value="github">github</option><option value="slack">slack</option><option value="jira">jira</option></select><div class="sched-help-text" id="evt-endpoint-preset-help">Choose a preset to pre-fill verification and header names.</div></td></tr>
              <tr><td class="key-cell">Verification</td><td><select class="settings-input" id="evt-endpoint-input-verification-type" onchange="evtUpdateEndpointFormVisibility()"><option value="none">none</option><option value="hmac-sha256">hmac-sha256</option><option value="hmac-sha1">hmac-sha1</option><option value="bearer">bearer</option><option value="slack-v0">slack-v0</option></select></td></tr>
              <tr id="evt-endpoint-row-secret"><td class="key-cell">Secret</td><td><input class="settings-input" id="evt-endpoint-input-secret" placeholder="Leave empty to auto-generate or keep the current secret"><div class="sched-help-text">Used for HMAC or bearer verification. Returned once after save if set or generated.</div></td></tr>
              <tr id="evt-endpoint-row-signature-header"><td class="key-cell">Signature Header</td><td><input class="settings-input" id="evt-endpoint-input-signature-header" placeholder="x-hub-signature-256"></td></tr>
              <tr id="evt-endpoint-row-signature-prefix"><td class="key-cell">Signature Prefix</td><td><input class="settings-input" id="evt-endpoint-input-signature-prefix" placeholder="sha256="></td></tr>
              <tr><td class="key-cell">Delivery ID Header</td><td><input class="settings-input" id="evt-endpoint-input-delivery-id-header" placeholder="x-github-delivery"></td></tr>
              <tr><td class="key-cell">Event Name Header</td><td><input class="settings-input" id="evt-endpoint-input-event-name-header" placeholder="x-github-event"></td></tr>
              <tr><td class="key-cell">Max Body Bytes</td><td><input class="settings-input" type="number" id="evt-endpoint-input-max-body-bytes" min="65536" max="1048576" value="262144"><div class="sched-help-text">Allowed range: 65536 to 1048576 bytes.</div></td></tr>
              <tr><td class="key-cell">Enabled</td><td><label class="toggle-switch"><input type="checkbox" id="evt-endpoint-input-enabled" checked><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Accept requests immediately</span></label></td></tr>
            </tbody></table>
            <div class="btn-group" style="justify-content:flex-end">
              <button class="btn" onclick="evtCloseEndpointModal()">Cancel</button>
              <button class="btn btn-primary" id="evt-endpoint-modal-save" onclick="evtSaveEndpoint()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Orchestrators Tab -->
      <div id="tab-orchestrators" class="tab-panel">
        <!-- LIST VIEW -->
        <div id="orch-list-view">
          <div class="page-header">
            <button class="btn" onclick="location.hash='tasks'" style="font-size:0.82rem;display:inline-flex;align-items:center;gap:0.3rem;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>Back</button>
            <button class="btn btn-primary" onclick="orchOpenEditor(null)">+ New Orchestrator</button>
          </div>
          <div class="page-desc">
            <h4>About Orchestrators</h4>
            <p>
              DAG-based multi-task workflows that orchestrate multiple AI agents (Claude / Codex / Gemini).<br>
              Tasks are connected as a directed acyclic graph with return-value-based branching and fan-out/fan-in support.
            </p>
          </div>
          <div id="orch-list"></div>
        </div>

        <!-- TRIGGER MODE SELECTION POPUP -->
        <div id="orch-trigger-mode-popup" class="modal-overlay" style="display:none;" onclick="if(event.target===this)orchCloseTriggerModePopup()">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:1.5rem 1.5rem 1.2rem;max-width:440px;width:92%;box-shadow:0 16px 48px rgba(0,0,0,0.18);">
            <div style="text-align:center;margin-bottom:1rem;">
              <h3 style="margin:0 0 0.25rem;font-size:1rem;font-weight:700;color:var(--text-main);">New Orchestrator</h3>
              <p style="margin:0;font-size:0.8rem;color:var(--text-dim);">Choose a trigger mode</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
              <div class="trigger-mode-card card-blue" onclick="orchSelectTriggerMode('ondemand')">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div class="trigger-mode-icon" style="background:rgba(37,99,235,0.1);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  </div>
                  <h4>On-Demand</h4>
                </div>
                <p>Manual or scheduled execution from dashboard and Slack.</p>
                <ul class="trigger-mode-features">
                  <li>Cron / one-time schedule</li>
                  <li>Slack alias trigger</li>
                </ul>
              </div>
              <div class="trigger-mode-card card-purple" onclick="orchSelectTriggerMode('webhook')">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div class="trigger-mode-icon" style="background:rgba(124,58,237,0.1);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </div>
                  <h4>Webhook</h4>
                </div>
                <p>Triggered by external events such as GitHub pushes or PR events.</p>
                <ul class="trigger-mode-features">
                  <li>Event-driven start node</li>
                  <li>Payload context mapping</li>
                </ul>
              </div>
            </div>
            <div style="text-align:center;margin-top:0.9rem;">
              <button class="btn btn-sm" onclick="orchCloseTriggerModePopup()" style="font-size:0.78rem;padding:0.3rem 1rem;color:var(--text-dim);">Cancel</button>
            </div>
          </div>
        </div>

        <!-- EDITOR VIEW -->
        <div id="orch-editor-view" style="display:none;">
          <!-- Editor Header (dark bar) -->
          <div class="orch-editor-header">
            <button class="btn btn-sm" onclick="orchBackToList()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg> Back</button>
            <h2 id="orch-editor-title">New Orchestrator</h2>
            <div class="orch-status-group">
              <span id="orch-status-lamp" class="orch-status-lamp" title="Flow has not been validated yet"></span>
              <span id="orch-validation-bar" class="orch-validation-text"></span>
            </div>
            <div class="orch-editor-actions">
              <button class="btn btn-sm" id="orch-btn-revert" style="display:none;" onclick="orchRevertToValidated()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Revert</button>
              <button class="btn btn-sm" id="orch-btn-validate" style="display:none;" onclick="orchValidateFromEditor()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Validate</button>
              <button class="btn btn-sm" id="orch-btn-run" style="display:none;" onclick="orchExecuteFromEditor()"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run</button>
              <button class="btn btn-sm btn-danger" id="orch-btn-delete" style="display:none;" onclick="orchDeleteFromEditor()">Delete</button>
            </div>
          </div>

          <!-- Toolbar -->
          <div class="orch-canvas-toolbar">
            <div class="orch-add-node-group">
              <button class="btn btn-sm btn-primary orch-toolbar-btn orch-toolbar-btn-primary" id="orch-btn-add-node" onclick="orchToggleAddMenu()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add Node</button>
              <div id="orch-add-menu" class="orch-add-menu" style="display:none;">
                <div class="orch-add-menu-item" onclick="orchAddNodeOfType('task')">
                  <span class="orch-add-icon task"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg></span>
                  <div class="orch-add-menu-text"><strong>Task</strong><span class="orch-add-desc">AI agent execution (Claude / Codex / Gemini)</span></div>
                </div>
                <div class="orch-add-menu-item" onclick="orchAddNodeOfType('triggered')">
                  <span class="orch-add-icon triggered"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"></path><path d="M12 15v6"></path><path d="M4.93 4.93l4.24 4.24"></path><path d="M14.83 14.83l4.24 4.24"></path><path d="M3 12h6"></path><path d="M15 12h6"></path><path d="M4.93 19.07l4.24-4.24"></path><path d="M14.83 9.17l4.24-4.24"></path><circle cx="12" cy="12" r="2.5"></circle></svg></span>
                  <div class="orch-add-menu-text"><strong>Triggered</strong><span class="orch-add-desc">Wait for an external event, then resume with payload context</span></div>
                </div>
                <div class="orch-add-menu-item" onclick="orchAddNodeOfType('gate')">
                  <span class="orch-add-icon gate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon></svg></span>
                  <div class="orch-add-menu-text"><strong>Gate</strong><span class="orch-add-desc">Fan-in merge with conditional logic</span></div>
                </div>
                <div class="orch-add-menu-item" onclick="orchAddNodeOfType('end')">
                  <span class="orch-add-icon end"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><rect x="8" y="8" width="8" height="8" rx="1"></rect></svg></span>
                  <div class="orch-add-menu-text"><strong>End</strong><span class="orch-add-desc">Workflow termination point</span></div>
                </div>
              </div>
            </div>
            <div class="orch-undo-redo-group">
              <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" id="dag-undo-btn" onclick="dagUndoManager.undo()" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
              </button>
              <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" id="dag-redo-btn" onclick="dagUndoManager.redo()" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"></path></svg>
              </button>
            </div>
            <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" onclick="orchEditorAutoLayout(); orchEditorSaveAllPositions(); orchEditorRender();"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg> Auto Layout</button>
            <div class="orch-zoom-group">
              <button class="btn btn-sm orch-zoom-btn" onclick="orchEditorZoomOut()" title="Zoom out" aria-label="Zoom out">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <span id="orch-zoom-level">100%</span>
              <button class="btn btn-sm orch-zoom-btn" onclick="orchEditorZoomIn()" title="Zoom in" aria-label="Zoom in">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button class="btn btn-sm orch-zoom-fit-btn" onclick="orchEditorZoomReset()">Fit</button>
            </div>
            <div class="orch-toolbar-right-actions">
              <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" id="orch-btn-settings" onclick="orchShowSettingsPanel()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Settings</button>
              <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" onclick="orchShowGuide()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Guide</button>
              <button class="btn btn-sm orch-toolbar-btn orch-toolbar-btn-muted" onclick="orchEditorToggleShortcutsHelp()" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"></path></svg> Keys</button>
            </div>
          </div>

          <!-- Canvas + Side Panel -->
          <div class="orch-canvas-layout">
            <div id="orch-dag-container" class="orch-canvas-area"></div>
            <!-- Side Panel (node editing) -->
            <div id="orch-side-panel" class="orch-side-panel" style="display:none;">
              <div class="orch-panel-header">
                <h3 id="orch-panel-title">Node</h3>
                <button class="btn btn-sm" onclick="orchCloseSidePanel()">×</button>
              </div>
              <div id="orch-panel-body" class="orch-panel-body"></div>
            </div>
            <!-- Settings Overlay (centered card, full-screen dark backdrop) -->
            <div id="orch-settings-overlay" class="orch-settings-overlay" style="display:none;" onclick="if(event.target===this)orchSettingsBack()">
              <div class="orch-settings-card">
                <div class="orch-settings-card-header">
                  <button class="btn btn-sm orch-settings-back-btn" onclick="orchSettingsBack()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg> Back</button>
                  <h3 id="orch-settings-card-title">New Orchestrator</h3>
                </div>
                <div class="orch-settings-card-divider"></div>
                <div id="orch-settings-card-body" class="orch-settings-card-body"></div>
              </div>
            </div>
          </div>

          <!-- Error Log -->
          <div id="orch-error-log" class="orch-error-log" style="display:none;"></div>

          <!-- Recent Runs -->
          <div id="orch-runs-drawer" class="orch-runs-drawer" style="display:none;">
            <div class="orch-runs-header">
              <div class="orch-runs-title-wrap">
                <span class="orch-runs-title-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5l3 2"></path><circle cx="12" cy="12" r="9"></circle></svg></span>
                <div class="orch-runs-title-copy">
                  <h3>Recent Runs</h3>
                  <p>Recent executions are always visible</p>
                </div>
              </div>
              <div class="orch-runs-actions">
                <button class="btn btn-sm orch-runs-btn orch-runs-btn-ghost" onclick="if(orchCurrent&&orchCurrent.id)orchLoadRunList(orchCurrent.id)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.5 9a9 9 0 0 1 14.65-3.36L23 10"></path><path d="M20.5 15a9 9 0 0 1-14.65 3.36L1 14"></path></svg>
                  <span>Refresh</span>
                </button>
                <button class="btn btn-sm orch-runs-btn orch-runs-btn-primary" onclick="if(orchCurrent&&orchCurrent.id)orchOpenRuns(orchCurrent.id)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 3h7v7H3z"></path><path d="M14 3h7v7h-7z"></path><path d="M14 14h7v7h-7z"></path><path d="M3 14h7v7H3z"></path></svg>
                  <span>Open Runs</span>
                </button>
              </div>
            </div>
            <div id="orch-run-list" class="orch-runs-body"></div>
          </div>
        </div>

        <!-- Edge Modal -->
        <div id="orch-edge-modal" class="modal-overlay" style="display:none;">
          <div class="modal-content">
            <h3 class="modal-title">Edge Condition</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:130px;">From Node</td><td>
                <select class="settings-input" id="orch-edge-input-from"></select>
              </td></tr>
              <tr><td class="key-cell">To Node</td><td>
                <select class="settings-input" id="orch-edge-input-to"></select>
              </td></tr>
              <tr><td class="key-cell">Condition Value</td><td>
                <input class="settings-input" id="orch-edge-input-condition-value" placeholder="e.g. success (optional — empty = always)">
                <div class="sched-help-text">The return value to match. Leave empty for unconditional edge.</div>
              </td></tr>
              <tr><td class="key-cell">Condition Operator</td><td>
                <select class="settings-input" id="orch-edge-input-condition-op">
                  <option value="eq">eq (equals)</option>
                  <option value="neq">neq (not equals)</option>
                  <option value="in">in (comma-separated list)</option>
                  <option value="regex">regex (pattern match)</option>
                </select>
              </td></tr>
            </tbody></table>
            <div class="btn-group" style="justify-content:flex-end">
              <button class="btn" onclick="orchCloseEdgeModal()">Cancel</button>
              <button class="btn btn-primary" onclick="orchSaveEdge()">Create</button>
            </div>
          </div>
        </div>

        <!-- Guide Modal -->
        <div id="orch-guide-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)orchCloseGuide()">
          <div class="modal-content orch-guide-content">
            <div class="orch-guide-header">
              <div class="orch-guide-title">
                <span class="orch-guide-title-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg>
                </span>
                <div class="orch-guide-title-copy">
                  <h2>Orchestrator Guide</h2>
                  <p>Build, validate, and run DAG workflows with confidence.</p>
                </div>
              </div>
              <label class="orch-guide-search-wrap">
                <span class="orch-guide-search-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                </span>
                <input type="text" id="orch-guide-search" class="settings-input orch-guide-search-input" placeholder="Search sections, fields, or controls...">
              </label>
              <button class="btn btn-sm orch-guide-close-btn" onclick="orchCloseGuide()"><span>Close</span></button>
            </div>
            <div class="orch-guide-layout">
              <nav id="orch-guide-nav" class="orch-guide-nav" aria-label="Guide sections"></nav>
              <div id="orch-guide-body" class="orch-guide-body"></div>
            </div>
          </div>
        </div>

        <!-- DAG Editor Overlays -->
        <div id="dag-editor-context-menu" class="dag-ctx-menu"></div>
        <div id="dag-editor-inline-edit" class="dag-inline-edit"></div>
        <!-- Shortcuts Help Overlay -->
        <div id="dag-shortcuts-overlay" class="dag-shortcuts-overlay" style="display:none;" onclick="if(event.target===this)this.style.display='none'">
          <div class="dag-shortcuts-panel">
            <div class="dag-shortcuts-header">
              <span class="dag-shortcuts-title">Keyboard Shortcuts</span>
              <button class="dag-shortcuts-close" onclick="document.getElementById('dag-shortcuts-overlay').style.display='none'">&times;</button>
            </div>
            <div class="dag-shortcuts-body">
              <div class="dag-shortcuts-group">
                <div class="dag-shortcut-row"><kbd>Esc</kbd><span>Deselect all / Cancel</span></div>
                <div class="dag-shortcut-row"><kbd>Delete</kbd><span>Delete selected</span></div>
                <div class="dag-shortcut-row"><kbd>Ctrl+A</kbd><span>Select all nodes</span></div>
              </div>
              <div class="dag-shortcuts-group">
                <div class="dag-shortcut-row"><kbd>F</kbd> / <kbd>Ctrl+0</kbd><span>Fit to view</span></div>
                <div class="dag-shortcut-row"><kbd>+</kbd> / <kbd>=</kbd><span>Zoom in</span></div>
                <div class="dag-shortcut-row"><kbd>-</kbd><span>Zoom out</span></div>
              </div>
              <div class="dag-shortcuts-group">
                <div class="dag-shortcut-row"><kbd>Ctrl+Z</kbd><span>Undo</span></div>
                <div class="dag-shortcut-row"><kbd>Ctrl+Shift+Z</kbd><span>Redo</span></div>
                <div class="dag-shortcut-row"><kbd>Ctrl+D</kbd><span>Duplicate selected node</span></div>
              </div>
              <div class="dag-shortcuts-group">
                <div class="dag-shortcut-row"><kbd>Tab</kbd><span>Focus next node</span></div>
                <div class="dag-shortcut-row"><kbd>Shift+Tab</kbd><span>Focus previous node</span></div>
                <div class="dag-shortcut-row"><kbd>Enter</kbd><span>Open focused node panel</span></div>
                <div class="dag-shortcut-row"><kbd>&larr; &rarr;</kbd><span>Navigate to connected node</span></div>
                <div class="dag-shortcut-row"><kbd>&uarr; &darr;</kbd><span>Navigate to sibling node</span></div>
              </div>
              <div class="dag-shortcuts-group">
                <div class="dag-shortcut-row"><kbd>Shift+Drag</kbd><span>Lasso select</span></div>
                <div class="dag-shortcut-row"><kbd>?</kbd><span>Toggle this panel</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Dev Tab -->
      <div id="tab-dev" class="tab-panel">
        <div class="page-header">
          <h2>Developer Aliases</h2>
          <button class="btn btn-primary" onclick="devShowCreateModal()">+ New Alias</button>
        </div>
        <div class="page-desc">
          <h4>About Developer Aliases</h4>
          <p>
            Map local project directories to named aliases with a pre-configured AI tool (Claude / Codex / Gemini).<br>
            When a Slack command or dashboard task references an alias, HuskyGate automatically sets the working directory and applies the project-specific instruction file (<code>CLAUDE.md</code> / <code>AGENTS.md</code> / <code>.gemini</code>).<br>
            Useful for managing multiple projects with different tool preferences and custom instructions.
          </p>
          <p style="margin-top:0.5rem;">
            <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
            </a>
          </p>
        </div>
        <div id="dev-alias-list"></div>
        <div id="dev-modal" class="modal-overlay" style="display:none;">
          <div class="modal-content">
            <h3 id="dev-modal-title" class="modal-title">New Developer Alias</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:80px;">Name</td><td><input class="settings-input" id="dev-input-name" placeholder="my-project"></td></tr>
              <tr><td class="key-cell" style="width:80px;">Path</td><td style="display:flex;gap:0.5rem;"><input class="settings-input" id="dev-input-path" placeholder="/Users/you/projects/my-project" style="flex:1;"><button class="btn btn-browse-dir" type="button" style="padding:0.25rem 0.6rem;font-size:0.78rem;white-space:nowrap;" onclick="pickDirectory('dev-input-path')">Browse</button></td></tr>
              <tr><td class="key-cell" style="width:80px;">Tool</td><td><select class="settings-input" id="dev-input-tool" onchange="devUpdateInstructionLabel()"><option value="claude">Claude</option><option value="codex">Codex</option><option value="gemini">Gemini</option></select></td></tr>
              <tr><td class="key-cell" style="width:80px;vertical-align:top;padding-top:0.6rem;" colspan="2">
                <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.4rem;">
                  <span id="dev-instruction-label" style="font-family:monospace;font-size:0.82rem;color:var(--accent);">CLAUDE.md</span>
                  <div class="btn-toggle-group" id="dev-instruction-toggle">
                    <button type="button" onclick="devSetInstructionMode('generate')" id="dev-toggle-generate">Generate</button>
                    <button type="button" onclick="devSetInstructionMode('skip')" id="dev-toggle-skip" class="active">Skip</button>
                  </div>
                </div>
                <div style="font-size:0.73rem;color:var(--text-dim);margin-bottom:0.5rem;">Generates an instruction file (<span class="dev-instruction-filename">CLAUDE.md</span>) in the project directory based on the selected tool. Only created on first launch; existing files are never overwritten.</div>
                <textarea class="settings-input" id="dev-input-instruction" rows="6" style="resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="Custom instruction content" disabled></textarea>
              </td></tr>
            </tbody></table>
            <div class="btn-group" style="justify-content:flex-end">
              <button class="btn" onclick="devCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="dev-modal-save" onclick="devSaveAlias()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Tab -->
      <div id="tab-mcp" class="tab-panel">
        <div class="driver-tabs" id="mcp-tool-tabs">
          <div class="driver-tab active" data-tool="claude" onclick="mcpSwitchTool('claude')"><img class="chip-icon" src="${ICON_CLAUDE}" alt="">Claude</div>
          <div class="driver-tab" data-tool="gemini" onclick="mcpSwitchTool('gemini')"><img class="chip-icon" src="${ICON_GEMINI}" alt="">Gemini</div>
          <div class="driver-tab" data-tool="codex" onclick="mcpSwitchTool('codex')"><img class="chip-icon" src="${ICON_CODEX}" alt="">Codex</div>
        </div>
        <div class="driver-tab-panel" id="mcp-tab-panel">
          <div class="page-desc" style="margin-top:0;border-radius:0;">
            <h4>About MCP Servers</h4>
            <p>
              Configure <strong>Model Context Protocol</strong> servers that extend AI agent capabilities with external tool access.<br>
              Each server is registered per app (Claude / Gemini / Codex) and provides tools, resources, or prompts to the AI agent at runtime.
              Servers can be assigned to <a href="#agents" style="color:var(--link);">Agents</a> or used directly in task sessions.
              Supports <code>stdio</code>, <code>SSE</code>, and <code>HTTP</code> transports.
            </p>
            <p style="margin-top:0.5rem;">
              <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
              </a>
            </p>
          </div>
          <div id="mcp-config-path" class="config-path"></div>
          <div class="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Transport</th><th>Command / URL</th><th>Status</th><th style="width:80px;"></th>
                </tr>
              </thead>
              <tbody id="mcp-servers-tbody"></tbody>
            </table>
          </div>
          <button class="btn btn-primary" style="margin-top:0.75rem;" onclick="mcpShowAddModal()">+ Add Server</button>
          <div id="mcp-global-section" style="display:none;margin-top:1.5rem;">
            <details>
              <summary class="section-title" style="cursor:pointer;margin:0;font-size:0.9rem;">Global MCP Settings (Gemini, read-only)</summary>
              <div class="card" style="margin-top:0.5rem;">
                <table class="settings-table"><tbody id="mcp-global-tbody"></tbody></table>
                <p style="margin:0.75rem 0 0;color:var(--text-dim);font-size:0.85rem;">Gemini global settings are preserved from the CLI config and are not edited in HuskyGate.</p>
              </div>
            </details>
          </div>
        </div>
        <!-- MCP Server Modal -->
        <div id="mcp-modal" class="modal-overlay" style="display:none;">
          <div class="modal-content">
            <h3 id="mcp-modal-title" class="modal-title">Add MCP Server</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:120px;">Server Name</td><td><input class="settings-input" id="mcp-input-name" placeholder="github"></td></tr>
              <tr><td class="key-cell">Transport</td><td>
                <div class="btn-toggle-group" id="mcp-transport-toggle">
                  <button type="button" class="active" onclick="mcpSetTransport('stdio')">stdio</button>
                  <button type="button" onclick="mcpSetTransport('sse')">SSE</button>
                  <button type="button" onclick="mcpSetTransport('http')">HTTP</button>
                </div>
              </td></tr>
            </tbody></table>
            <div id="mcp-stdio-fields">
              <h4 class="modal-section-title">stdio Settings</h4>
              <table class="settings-table"><tbody>
                <tr><td class="key-cell" style="width:120px;">Command</td><td><input class="settings-input" id="mcp-input-command" placeholder="npx"></td></tr>
                <tr><td class="key-cell">Args</td><td><input class="settings-input" id="mcp-input-args" placeholder="-y, @modelcontextprotocol/server-github"></td></tr>
                <tr><td class="key-cell">CWD</td><td><input class="settings-input" id="mcp-input-cwd" placeholder="/path/to/dir"></td></tr>
              </tbody></table>
            </div>
            <div id="mcp-url-fields" style="display:none;">
              <h4 class="modal-section-title">URL Settings</h4>
              <table class="settings-table"><tbody>
                <tr id="mcp-row-url"><td class="key-cell" style="width:120px;">URL</td><td><input class="settings-input" id="mcp-input-url" placeholder="https://api.example.com/mcp"></td></tr>
                <tr id="mcp-row-httpUrl" style="display:none;"><td class="key-cell">HTTP URL</td><td><input class="settings-input" id="mcp-input-httpUrl" placeholder="https://api.example.com/mcp"></td></tr>
              </tbody></table>
            </div>
            <h4 class="modal-section-title">Environment Variables</h4>
            <div id="mcp-env-list"></div>
            <button class="btn" style="font-size:0.78rem;margin-top:0.25rem;margin-bottom:0.75rem;" onclick="mcpAddEnvRow()">+ Add Env Var</button>
            <div id="mcp-advanced-fields" style="display:none;">
              <h4 class="modal-section-title">Advanced</h4>
              <table class="settings-table"><tbody>
                <tr id="mcp-row-timeout"><td class="key-cell" style="width:120px;">Timeout (sec)</td><td><input class="settings-input" id="mcp-input-timeout" type="number" placeholder="30"></td></tr>
                <tr id="mcp-row-toolTimeout"><td class="key-cell">Tool Timeout</td><td><input class="settings-input" id="mcp-input-toolTimeout" type="number" placeholder="120"></td></tr>
                <tr id="mcp-row-trust"><td class="key-cell">Trust</td><td><label class="toggle-switch"><input type="checkbox" id="mcp-input-trust"><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Auto-approve tools</span></label></td></tr>
                <tr id="mcp-row-enabled"><td class="key-cell">Enabled</td><td><label class="toggle-switch"><input type="checkbox" id="mcp-input-enabled" checked><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Server enabled</span></label></td></tr>
                <tr id="mcp-row-required"><td class="key-cell">Required</td><td><label class="toggle-switch"><input type="checkbox" id="mcp-input-required"><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Required for startup</span></label></td></tr>
                <tr id="mcp-row-includeTools"><td class="key-cell">Include Tools</td><td><input class="settings-input" id="mcp-input-includeTools" placeholder="tool1, tool2"></td></tr>
                <tr id="mcp-row-excludeTools"><td class="key-cell">Exclude Tools</td><td><input class="settings-input" id="mcp-input-excludeTools" placeholder="tool3"></td></tr>
              </tbody></table>
            </div>
            <div id="mcp-auth-fields" style="display:none;">
              <h4 class="modal-section-title" id="mcp-auth-title">Authentication</h4>
              <table class="settings-table"><tbody>
                <tr id="mcp-row-bearerToken"><td class="key-cell" style="width:120px;">Bearer Token</td><td><input class="settings-input" id="mcp-input-bearerToken" placeholder="sk-xxx"></td></tr>
                <tr id="mcp-row-bearerTokenEnvVar"><td class="key-cell">Token Env Var</td><td><input class="settings-input" id="mcp-input-bearerTokenEnvVar" placeholder="MY_API_TOKEN"></td></tr>
                <tr id="mcp-row-httpHeaders"><td class="key-cell">HTTP Headers</td><td><input class="settings-input" id="mcp-input-httpHeaders" placeholder='{"X-Custom": "value"}'></td></tr>
                <tr id="mcp-row-envHttpHeaders"><td class="key-cell">Env HTTP Headers</td><td><input class="settings-input" id="mcp-input-envHttpHeaders" placeholder='{"Authorization": "MY_API_TOKEN"}'></td></tr>
                <tr id="mcp-row-scopes"><td class="key-cell">Scopes</td><td><input class="settings-input" id="mcp-input-scopes" placeholder="read, write"></td></tr>
              </tbody></table>
            </div>
            <div id="mcp-oauth-fields" style="display:none;">
              <h4 class="modal-section-title">OAuth (Gemini)</h4>
              <table class="settings-table"><tbody>
                <tr><td class="key-cell" style="width:120px;">Auth Provider</td><td><input class="settings-input" id="mcp-input-authProvider" placeholder="dynamic_discovery"></td></tr>
                <tr><td class="key-cell" style="vertical-align:top;">OAuth JSON</td><td><textarea class="settings-input" id="mcp-input-oauth" rows="4" style="font-family:monospace;font-size:0.8rem;" placeholder='{"client_id": "...", "auth_uri": "..."}'></textarea></td></tr>
              </tbody></table>
            </div>
            <div class="btn-group" style="justify-content:flex-end;margin-top:1rem;">
              <button class="btn" onclick="mcpCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="mcp-modal-save" onclick="mcpSaveServer()">Save</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Skills Tab -->
      <div id="tab-skills" class="tab-panel">
        <div id="skills-main">
          <div class="driver-tabs" id="skills-tool-tabs">
            <div class="driver-tab active" data-tool="claude" onclick="skillsSwitchTool('claude')"><img class="chip-icon" src="${ICON_CLAUDE}" alt="">Claude</div>
            <div class="driver-tab" data-tool="gemini" onclick="skillsSwitchTool('gemini')"><img class="chip-icon" src="${ICON_GEMINI}" alt="">Gemini</div>
            <div class="driver-tab" data-tool="codex" onclick="skillsSwitchTool('codex')"><img class="chip-icon" src="${ICON_CODEX}" alt="">Codex</div>
          </div>
          <div class="driver-tab-panel" id="skills-tab-panel">
            <div class="page-desc" style="margin-top:0;border-radius:0;">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;">
                <h4 style="margin:0;">About Skills</h4>
                <div class="btn-toggle-group" id="skills-source-toggle" style="flex-shrink:0;flex-wrap:wrap;">
                  <button type="button" class="active" data-source="all" onclick="skillsSetSource('all')">All</button>
                  <button type="button" data-source="builtin" onclick="skillsSetSource('builtin')">Built-in</button>
                  <button type="button" data-source="local" onclick="skillsSetSource('local')">Local</button>
                  <button type="button" data-source="project" onclick="skillsSetSource('project')">Project</button>
                </div>
              </div>
              <p>
                Reusable instruction templates that teach AI agents specialized capabilities.<br>
                The catalog unifies <strong>built-in</strong> and <strong>custom</strong> skills under one list, with source badges, read-only built-in detail, and per-driver enablement toggles.<br>
                Custom skills share one directory across Claude / Codex / Gemini variants and can be assigned to <a href="#agents" style="color:var(--link);">Agents</a> for reuse across tasks.
              </p>
              <p style="margin-top:0.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
                <span style="font-size:0.82rem;color:var(--text-dim);">
                  Create target:
                  <span class="btn-toggle-group" id="skills-scope-toggle" style="margin-left:0.5rem;vertical-align:middle;">
                    <button type="button" class="active" data-scope="local" onclick="skillsSetScope('local')">Local</button>
                    <button type="button" data-scope="project" onclick="skillsSetScope('project')">Project</button>
                  </span>
                </span>
                <a href="#docs" style="color:var(--link);font-size:0.82rem;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:0.2rem;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>View Documentation
                </a>
              </p>
            </div>
            <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.85rem;">
              <div>
                <h3 class="section-title" style="margin-bottom:0.15rem;">Skills Catalog</h3>
                <div id="skills-list-status" class="config-path"></div>
              </div>
              <button class="btn btn-primary" style="margin-top:0.25rem;" onclick="skillsShowCreateModal()">+ New Skill</button>
            </div>
            <div id="skills-list"></div>
          </div>
        </div>
        <div id="skills-detail" style="display:none;">
          <div class="skill-detail-card">
            <div class="skill-detail-header">
              <div class="skill-detail-header-top">
                <button class="btn" onclick="skillsBackToList()" style="font-size:0.82rem;">&larr; Back to Skills</button>
                <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end;">
                  <div id="skills-detail-actions" style="display:flex;gap:0.5rem;flex-wrap:wrap;"></div>
                  <label class="mode-toggle" id="skills-detail-toggle-wrap" style="flex-shrink:0;">
                    <span class="mode-toggle-track" id="skills-detail-toggle-track"><span class="mode-toggle-knob"></span></span>
                    <span class="mode-toggle-label" id="skills-detail-toggle-label"></span>
                  </label>
                </div>
              </div>
              <h2 id="skills-detail-title" class="skill-detail-name"></h2>
              <div id="skills-detail-badges" style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.45rem;"></div>
              <code id="skills-detail-ref" class="skill-detail-envkey"></code>
              <div id="skills-detail-description" class="skill-detail-desc" style="display:none;">
                <div class="desc-text" id="skills-detail-description-text"></div>
                <div id="skills-detail-desc-warning"></div>
              </div>
            </div>
            <div class="skill-detail-tabs" id="skills-detail-variant-tabs"></div>
            <div class="skill-detail-content">
              <div id="skills-detail-variant-content"></div>
              <div id="skills-detail-files"></div>
              <div class="skill-detail-divider" id="skills-detail-env-divider"></div>
              <div id="skills-detail-envvars" class="skill-detail-envarea">
                <div class="skill-detail-envarea-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Environment Variables</div>
                <div id="skills-detail-envvars-body"></div>
              </div>
            </div>
          </div>
        </div>
        <!-- Skills Modal -->
        <div id="skills-modal" class="modal-overlay" style="display:none;">
          <div class="modal-content modal-content-wide">
            <h3 id="skills-modal-title" class="modal-title">New Skill</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:140px;">Directory Name</td><td><input class="settings-input" id="skills-input-dirname" placeholder="my-skill"></td></tr>
              <tr><td class="key-cell">Name</td><td><input class="settings-input" id="skills-input-name" placeholder="My Skill"></td></tr>
              <tr><td class="key-cell">Description</td><td><textarea class="settings-input" id="skills-input-description" rows="2" style="resize:vertical;" placeholder="What this skill does"></textarea></td></tr>
            </tbody></table>

            <h4 class="modal-section-title">SKILL.md (per driver)</h4>
            <div class="chip-group" id="skills-driver-tabs" style="margin-bottom:0.75rem;">
              <span class="chip active" data-driver="claude" onclick="skillsDriverTab('claude')"><img class="chip-icon" src="${ICON_CLAUDE}" alt="">Claude</span>
              <span class="chip" data-driver="codex" onclick="skillsDriverTab('codex')"><img class="chip-icon" src="${ICON_CODEX}" alt="">Codex</span>
              <span class="chip" data-driver="gemini" onclick="skillsDriverTab('gemini')"><img class="chip-icon" src="${ICON_GEMINI}" alt="">Gemini</span>
            </div>

            <div id="skills-driver-claude" class="skills-driver-panel">
              <textarea class="settings-input" id="skills-input-body-claude" rows="12" style="resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="# Skill instructions\nDescribe what this skill does and how the agent should use it..."></textarea>
            </div>
            <div id="skills-driver-codex" class="skills-driver-panel" style="display:none;">
              <textarea class="settings-input" id="skills-input-body-codex" rows="12" style="resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="# Skill instructions\nDescribe what this skill does and how the agent should use it..."></textarea>
            </div>
            <div id="skills-driver-gemini" class="skills-driver-panel" style="display:none;">
              <textarea class="settings-input" id="skills-input-body-gemini" rows="12" style="resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="# Skill instructions\nDescribe what this skill does and how the agent should use it..."></textarea>
            </div>

            <!-- requirements.txt toggle -->
            <div style="margin-top:1.25rem;">
              <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
                <label class="mode-toggle" onclick="skillsToggleRequirements()">
                  <span class="mode-toggle-track" id="skills-req-toggle"><span class="mode-toggle-knob"></span></span>
                </label>
                <h4 class="modal-section-title" style="margin:0;">requirements.txt</h4>
              </div>
              <textarea class="settings-input" id="skills-input-requirements" rows="4" style="display:none;resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="pandas&#10;requests&#10;selenium"></textarea>
            </div>

            <!-- Script files upload -->
            <div style="margin-top:1.25rem;">
              <h4 class="modal-section-title" style="margin-top:0;">Script Files <span style="font-weight:normal;color:var(--text-dim);font-size:0.78rem;">(deployed to scripts/)</span></h4>
              <div id="skills-scripts-list"></div>
              <label class="btn" style="font-size:0.78rem;cursor:pointer;margin-top:0.35rem;display:inline-block;">
                Choose Files
                <input type="file" id="skills-script-upload" accept=".sh,.py,.js,.ts,.bash" multiple style="display:none;" onchange="skillsHandleScriptUpload(this)">
              </label>
            </div>

            <div class="btn-group" style="justify-content:flex-end;margin-top:1.25rem;">
              <button class="btn" onclick="skillsCloseModal()">Cancel</button>
              <button class="btn btn-primary" id="skills-modal-save" onclick="skillsSaveSkill()">Create</button>
            </div>
          </div>
        </div>
        <div id="skills-file-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)skillsCloseSupportFileModal()">
          <div class="modal-content modal-content-wide">
            <h3 id="skills-file-modal-title" class="modal-title">New Support File</h3>
            <table class="settings-table"><tbody>
              <tr><td class="key-cell" style="width:140px;">File Path</td><td><input class="settings-input" id="skills-file-input-path" placeholder="scripts/helper.sh"></td></tr>
            </tbody></table>
            <h4 class="modal-section-title">Content</h4>
            <textarea class="settings-input" id="skills-file-input-content" rows="16" style="resize:vertical;font-family:monospace;font-size:0.8rem;width:100%;" placeholder="# file contents"></textarea>
            <div class="btn-group" style="justify-content:flex-end;margin-top:1.25rem;">
              <button class="btn" onclick="skillsCloseSupportFileModal()">Cancel</button>
              <button class="btn btn-primary" id="skills-file-save" onclick="skillsSaveSupportFile()">Create</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Tab -->
      <div id="tab-chat" class="tab-panel">
        <div class="chat-layout">
          <div class="chat-sidebar">
            <div class="chat-sidebar-header">
              <div class="chat-sidebar-header-row">
                <span class="chat-sidebar-title">Sessions</span>
                <button class="btn chat-refresh-btn" onclick="refreshChatTree()" title="Refresh Sessions">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M2.5 22v-6h6"/><path d="M3.34 8A9.96 9.96 0 0 1 12 3c3.73 0 6.93 2.05 8.63 5.09"/><path d="M20.66 16A9.96 9.96 0 0 1 12 21c-3.73 0-6.93-2.05-8.63-5.09"/></svg>
                </button>
              </div>
              <button class="btn btn-primary chat-new-session-btn" onclick="chatCreateSession()" title="New Chat">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Session
              </button>
            </div>
            <div class="chat-tree" id="chat-tree"></div>
          </div>
          <div class="chat-main">
            <div class="chat-main-header" id="chat-main-header">
              <span class="chat-main-session-label" id="chat-main-session-label"></span>
              <button class="btn btn-danger" style="padding:0.25rem 0.6rem;font-size:0.78rem;" id="chat-main-delete-btn" onclick="chatDeleteCurrentSession()">Delete Session</button>
            </div>
            <div class="chat-messages" id="chat-messages">
              <div class="chat-messages-empty">Select a session to start chatting</div>
            </div>
            <div id="chat-working-bar">
              <div class="working-dots" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
              <div class="working-label">Working</div>
              <div class="working-streaming-text"></div>
            </div>
            <div class="chat-file-preview" id="chat-file-preview"></div>
            <div class="chat-input-area">
              <button class="chat-attach-btn" id="chat-attach-btn" onclick="chatAttachClick()" disabled title="Attach files">+</button>
              <input type="file" id="chat-file-input" multiple style="display:none" onchange="chatFilesSelected(this)">
              <textarea class="chat-input" id="chat-input" placeholder="Type a message..." rows="1" disabled></textarea>
              <button class="btn btn-primary chat-send-btn" id="chat-send-btn" onclick="chatSend()" disabled>Send</button>
            </div>
            <div class="chat-drop-overlay" id="chat-drop-overlay">Drop files here</div>
          </div>
        </div>
      </div>

      <!-- Tool picker modal -->
      <div class="chat-tool-modal-overlay" id="chat-tool-modal">
        <div class="chat-tool-modal">
          <h3>Select a tool</h3>
          <div class="chat-tool-modal-subtitle">Choose an AI assistant to start a new session</div>
          <div class="chat-tool-modal-grid">
            <div class="chat-tool-modal-item tool-claude" onclick="chatCreateWithTool('claude')">
              <img src="${ICON_CLAUDE}" alt="Claude">
              <span class="tool-name">Claude</span>
              <span class="tool-desc">Code &amp; general tasks</span>
            </div>
            <div class="chat-tool-modal-item tool-codex" onclick="chatCreateWithTool('codex')">
              <img src="${ICON_CODEX}" alt="Codex">
              <span class="tool-name">Codex</span>
              <span class="tool-desc">Autonomous coding</span>
            </div>
            <div class="chat-tool-modal-item tool-gemini" onclick="chatCreateWithTool('gemini')">
              <img src="${ICON_GEMINI}" alt="Gemini">
              <span class="tool-name">Gemini</span>
              <span class="tool-desc">Multi-modal analysis</span>
            </div>
          </div>
          <div class="chat-tool-modal-mode">
            <span class="chat-tool-modal-mode-label">Mode</span>
            <div class="chat-tool-modal-segments">
              <input type="radio" name="chat-tool-mode" id="chat-tool-mode-default" value="" checked>
              <label for="chat-tool-mode-default">Default</label>
              <input type="radio" name="chat-tool-mode" id="chat-tool-mode-readonly" value="readonly">
              <label for="chat-tool-mode-readonly">Read-only</label>
              <input type="radio" name="chat-tool-mode" id="chat-tool-mode-write" value="write">
              <label for="chat-tool-mode-write">Write</label>
            </div>
          </div>
          <button class="chat-tool-modal-cancel" onclick="chatCloseToolModal()">Cancel</button>
        </div>
      </div>

    </div>
  </div>

  <!-- Trace Modal -->
  <div id="trace-modal" class="modal-overlay" style="display:none;">
    <div class="trace-modal-content">
      <div class="trace-modal-header">
        <h3 id="trace-modal-title">Execution Trace</h3>
        <button class="btn" onclick="closeTraceModal()" style="padding:0.2rem 0.6rem;">&times;</button>
      </div>
      <div id="trace-timeline-container" class="trace-timeline-container">
        <div style="text-align:center;color:var(--text-dim);padding:2rem;">Loading trace...</div>
      </div>
      <div id="trace-detail-container" class="trace-detail-container" style="display:none;">
        <div class="trace-detail-header">
          <button class="btn" onclick="traceBackToTimeline()" style="padding:0.2rem 0.5rem;font-size:0.78rem;">&larr; Back</button>
          <span id="trace-detail-title" style="font-weight:600;font-size:0.85rem;"></span>
        </div>
        <div id="trace-messages" class="trace-messages"></div>
      </div>
    </div>
  </div>

  <!-- Orchestrator Runs Page (fullscreen, no sidebar) -->
  <div class="orch-runs-page" id="orch-runs-page">
    <div class="orch-runs-topbar">
      <button class="btn" onclick="orchCloseRuns()">&larr; Back</button>
      <h1 id="orch-runs-title">Orchestrator Runs</h1>
    </div>
    <div class="orch-runs-content" id="orch-runs-content">
      <div class="orun-empty">Loading...</div>
    </div>
  </div>

  <div class="toast-container" id="toast-container"></div>
`;
}
