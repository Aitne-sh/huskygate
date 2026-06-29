/** @module styles/pages — Page-specific styles (tasks, logs, settings, skills, events, schedule, traces) */
export const pageStyles = `
    /* Task navigation list (vertical layout) */
    .task-nav-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    /* Task navigation cards — override .card base to avoid border conflicts */
    .task-nav-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      cursor: pointer;
      padding: 1rem 1.25rem;
      border: 1px solid var(--glass-border);
      border-left: 3px solid var(--border);
      transition: transform var(--transition-med),
                  box-shadow var(--transition-med),
                  border-color var(--transition-med),
                  background var(--transition-med);
    }
    .task-nav-card:hover {
      transform: translateX(3px);
      box-shadow: var(--shadow-md);
    }
    .task-nav-card:active {
      transform: translateX(1px);
      box-shadow: var(--shadow-sm);
      transition-duration: 0.08s;
    }
    .task-nav-card h3 { margin: 0 0 0.25rem; font-size: 0.95rem; }
    .task-nav-card p { color: var(--text-muted); font-size: 0.84rem; margin: 0; line-height: 1.4; }
    .task-nav-card .card-chevron {
      flex-shrink: 0;
      color: var(--text-dim);
      transition: transform var(--transition-med), color var(--transition-med);
    }
    .task-nav-card:hover .card-chevron {
      transform: translateX(3px);
    }

    /* Icon */
    .task-nav-icon {
      width: 40px; height: 40px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: transform var(--transition-med);
    }
    .task-nav-card:hover .task-nav-icon { transform: scale(1.06); }

    /* ── Orchestrator ── */
    @keyframes orch-glow {
      0%, 100% { box-shadow: var(--shadow-sm), 0 0 0 0 rgba(124,58,237,0); }
      50%      { box-shadow: var(--shadow-sm), 0 0 12px 2px rgba(124,58,237,0.08); }
    }
    .task-nav-orchestrator {
      border-left: 3px solid var(--purple);
      background: linear-gradient(135deg, rgba(124,58,237,0.04) 0%, var(--glass) 100%);
      animation: orch-glow 3.5s ease-in-out infinite;
    }
    .task-nav-orchestrator:hover {
      border-left-color: var(--purple);
      background: linear-gradient(135deg, rgba(124,58,237,0.08) 0%, var(--surface-hover) 100%);
      box-shadow: 0 4px 16px rgba(124,58,237,0.12);
      animation: none;
    }
    .task-nav-orchestrator .task-nav-icon {
      background: linear-gradient(135deg, #7C3AED, #6366F1);
      color: #fff;
    }
    .task-nav-orchestrator h3 { color: #5B21B6; }
    .task-nav-orchestrator:hover .card-chevron { color: var(--purple); }

    /* ── On-Demand (blue) ── */
    .task-nav-ondemand { border-left-color: var(--blue); }
    .task-nav-ondemand .task-nav-icon { background: rgba(91,141,184,0.12); color: var(--blue); }
    .task-nav-ondemand:hover { border-left-color: var(--blue); background: rgba(91,141,184,0.05); }
    .task-nav-ondemand h3 { color: #3B6F96; }
    .task-nav-ondemand:hover .card-chevron { color: var(--blue); }

    /* ── Schedule (amber) ── */
    .task-nav-schedule { border-left-color: var(--orange); }
    .task-nav-schedule .task-nav-icon { background: rgba(217,119,6,0.10); color: var(--orange); }
    .task-nav-schedule:hover { border-left-color: var(--orange); background: rgba(217,119,6,0.04); }
    .task-nav-schedule h3 { color: #92400E; }
    .task-nav-schedule:hover .card-chevron { color: var(--orange); }

    /* ── Triggered (teal) ── */
    .task-nav-triggered { border-left-color: var(--teal); }
    .task-nav-triggered .task-nav-icon { background: rgba(13,138,106,0.10); color: var(--teal); }
    .task-nav-triggered:hover { border-left-color: var(--teal); background: rgba(13,138,106,0.04); }
    .task-nav-triggered h3 { color: #065F46; }
    .task-nav-triggered:hover .card-chevron { color: var(--teal); }

    /* Apps grid */
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .tool-card {
      text-align: center;
      padding: 1.25rem;
      transition: all var(--transition-med);
      cursor: pointer;
      position: relative;
    }

    .tool-card:hover {
      border-color: var(--border-hover);
      background: var(--surface-hover);
      transform: translateY(-3px);
      box-shadow: var(--shadow-md);
    }
    .tool-card:active { transform: translateY(-1px); box-shadow: var(--shadow-sm); }

    .tool-icon { margin-bottom: 0.5rem; }
    .tool-icon img { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; transition: transform var(--transition-med); }
    .tool-card:hover .tool-icon img { transform: scale(1.08); }
    .tool-card h3 { font-size: 0.95rem; margin-bottom: 0.2rem; }
    .tool-card p { color: var(--text-muted); font-size: 0.8rem; }
    /* Tool card enhanced stats */
    .tool-card-stats { margin-top: 0.6rem; text-align: left; }
    .tool-card-stats-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      padding: 0.15rem 0;
    }
    .tool-card-stats-row .stats-label { color: var(--text-dim); }
    .tool-card-stats-row .stats-value { font-weight: 500; font-variant-numeric: tabular-nums; }
    .tool-card-stats-row .stats-value.has-errors { color: var(--red); }
    .tool-card-stats-row .stats-value.all-good { color: var(--green); }

    .tool-card-rate-bar {
      margin-top: 0.35rem;
      height: 4px;
      border-radius: 2px;
      background: rgba(44,44,44,0.08);
      overflow: hidden;
    }
    .tool-card-rate-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.6s ease;
    }
    .tool-card-divider {
      border: none;
      border-top: 1px solid rgba(44,44,44,0.06);
      margin: 0.4rem 0 0.25rem;
    }
    .tool-card-last-active {
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-top: 0.25rem;
      text-align: center;
    }

    /* Payload URL config bar */
    .evt-url-bar {
      margin-bottom: 0;
      padding: 0.55rem 0.9rem;
      border-radius: 12px 12px 0 0;
      border: 1px solid var(--border);
      border-bottom: none;
      background: linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%);
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .evt-url-bar-label {
      font-weight: 600;
      font-size: 0.78rem;
      color: var(--text-main);
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .evt-url-preview {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .evt-url-preview code {
      font-size: 0.76rem;
      color: var(--text-dim);
      background: rgba(37,99,235,0.06);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      border: 1px solid rgba(37,99,235,0.12);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .evt-url-preview code.evt-url-tunnel {
      color: var(--green-dark);
      background: rgba(76,175,80,0.08);
      border-color: rgba(76,175,80,0.2);
    }

    /* ── Tunnel bar ── */
    .evt-tunnel-bar {
      margin-bottom: 0.75rem;
      padding: 0.45rem 0.9rem;
      border-radius: 0 0 12px 12px;
      border: 1px solid var(--border);
      background: var(--surface-2);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .evt-tunnel-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-dim);
    }
    .evt-tunnel-title {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--text-main);
    }
    .evt-tunnel-status {
      font-size: 0.68rem;
      padding: 0.1rem 0.45rem;
      border-radius: 8px;
      background: rgba(0,0,0,0.06);
      color: var(--text-dim);
    }
    .evt-tunnel-status-active {
      background: rgba(76,175,80,0.14);
      color: var(--green-dark);
    }
    .evt-tunnel-status-pending {
      background: rgba(245,158,11,0.14);
      color: #92400e;
    }
    .evt-tunnel-right {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .evt-tunnel-docs-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      color: var(--accent);
      text-decoration: none;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      border: 1px solid rgba(37,99,235,0.15);
      transition: all 0.15s;
    }
    .evt-tunnel-docs-btn:hover {
      background: rgba(37,99,235,0.06);
      border-color: rgba(37,99,235,0.3);
    }
    /* Toggle switch */
    .evt-tunnel-toggle {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .evt-tunnel-toggle input { opacity: 0; width: 0; height: 0; }
    .evt-tunnel-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--toggle-off);
      border-radius: 20px;
      transition: background 0.25s;
    }
    .evt-tunnel-slider::before {
      content: '';
      position: absolute;
      height: 14px; width: 14px;
      left: 3px; bottom: 3px;
      background: var(--bg-card);
      border-radius: 50%;
      transition: transform 0.25s;
    }
    .evt-tunnel-toggle input:checked + .evt-tunnel-slider {
      background: var(--green-dark);
    }
    .evt-tunnel-toggle input:checked + .evt-tunnel-slider::before {
      transform: translateX(16px);
    }
    .evt-tunnel-toggle input:disabled + .evt-tunnel-slider {
      opacity: 0.5;
      cursor: wait;
    }

    /* Webhook URL cell */
    .evt-url-cell {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 0.25rem 0.35rem 0.25rem 0.55rem;
    }
    .evt-url-cell code {
      flex: 1;
      font-size: 0.73rem;
      color: var(--text-main);
      word-break: break-all;
      line-height: 1.4;
    }
    .evt-url-cell .action-btn {
      flex-shrink: 0;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .evt-url-cell:hover .action-btn { opacity: 1; }

    .session-link { color: var(--accent); text-decoration: none; }
    .session-link:hover { text-decoration: underline; }

    /* Status icons in history table */
    .status-icon {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }

    /* Audit expand */
    .audit-row { display: none; }
    .audit-row.open { display: table-row; }
    .audit-cell { padding: 0.75rem; background: rgba(44,44,44,0.04); }
    .audit-table { width: 100%; font-size: 0.8rem; }
    .audit-table th { font-size: 0.75rem; color: var(--text-dim); }

    .expand-btn {
      background: none; border: none; color: var(--accent);
      cursor: pointer; font-size: 0.85rem; padding: 0.2rem;
    }

    /* Job cards in audit panel */
    .audit-jobs { display: flex; flex-direction: column; gap: 0.5rem; }

    .job-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-card);
      overflow: hidden;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-sm);
    }
    .job-card:hover { border-color: var(--border-hover); box-shadow: var(--shadow-md); }

    .job-card-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 0.85rem;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .job-card-header:hover { background: var(--surface-hover); }

    .job-status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .job-status-dot.success { background: var(--green); }
    .job-status-dot.error { background: var(--red); }
    .job-status-dot.running { background: var(--accent); animation: pulse-dot 1.2s infinite; }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .job-card-id { font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent2); font-weight: 500; }
    .job-card-meta { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; font-size: 0.75rem; color: var(--text-dim); }
    .job-card-meta .badge { font-size: 0.68rem; }
    .job-card-duration { font-family: var(--font-mono); font-size: 0.72rem; }
    .job-card-exit { font-family: var(--font-mono); font-size: 0.72rem; }
    .job-card-exit.fail { color: var(--red); font-weight: 600; }
    .job-card-error { font-size: 0.72rem; color: var(--red); }
    .job-card-expand { color: var(--text-dim); font-size: 0.7rem; transition: transform 0.2s; }
    .job-card.open .job-card-expand { transform: rotate(90deg); }

    .job-card-body {
      border-top: 1px solid var(--border);
      padding: 0;
      background: rgba(44,44,44,0.02);
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease, padding 0.3s ease;
    }
    .job-card.open .job-card-body { max-height: 600px; padding: 0.75rem; overflow-y: auto; }

    /* Conversation messages */
    .job-messages { display: flex; flex-direction: column; gap: 0.5rem; max-height: 400px; overflow-y: auto; }
    .job-messages-empty { text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 1rem; }
    .job-messages-loading { text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 0.75rem; }

    .job-msg {
      padding: 0.6rem 0.85rem;
      border-radius: 8px;
      font-size: 0.82rem;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
      max-width: 90%;
    }
    .job-msg-user {
      background: rgba(184,151,90,0.12);
      border: 1px solid rgba(184,151,90,0.2);
      align-self: flex-end;
    }
    .job-msg-assistant {
      background: rgba(44,44,44,0.04);
      border: 1px solid rgba(44,44,44,0.08);
      align-self: flex-start;
    }
    .job-msg-system {
      background: rgba(96,165,250,0.08);
      border: 1px solid rgba(96,165,250,0.15);
      align-self: center;
      font-size: 0.75rem;
      color: var(--text-dim);
      max-width: 80%;
    }
    .job-msg-role {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin-bottom: 0.25rem;
    }
    .job-msg-user .job-msg-role { color: var(--accent2); }
    .job-msg-assistant .job-msg-role { color: var(--text-muted); }
    .job-msg-content { color: var(--text); }
    .job-msg-content code { background: rgba(44,44,44,0.08); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.78rem; }

    /* Log viewer */
    .log-toolbar {
      display: flex;
      gap: 0.3rem;
      align-items: center;
      flex-wrap: wrap;
      padding: 0.4rem 0.5rem;
      flex-shrink: 0;
      background: rgba(245,241,232,0.6);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 0.35rem;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.78rem;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .chip:hover { border-color: var(--border-hover); background: var(--surface-hover); }
    .chip.active { background: rgba(184,151,90,0.2); border-color: rgba(184,151,90,0.4); color: var(--accent); box-shadow: 0 0 0 2px rgba(184,151,90,0.1); }

    .chip img.chip-icon { width: 16px; height: 16px; border-radius: 3px; object-fit: contain; flex-shrink: 0; }

    /* Level chip colors (scoped to log toolbar — shared .chip class untouched) */
    .log-toolbar .chip[data-level="info"] { color: var(--blue); border-color: rgba(91,141,184,0.3); }
    .log-toolbar .chip[data-level="info"].active { background: rgba(91,141,184,0.18); border-color: rgba(91,141,184,0.45); color: var(--blue); box-shadow: 0 0 0 2px rgba(91,141,184,0.1); }
    .log-toolbar .chip[data-level="warn"] { color: var(--yellow); border-color: rgba(212,160,23,0.3); }
    .log-toolbar .chip[data-level="warn"].active { background: rgba(212,160,23,0.18); border-color: rgba(212,160,23,0.45); color: var(--yellow); box-shadow: 0 0 0 2px rgba(212,160,23,0.1); }
    .log-toolbar .chip[data-level="error"] { color: var(--red); border-color: rgba(192,57,43,0.3); }
    .log-toolbar .chip[data-level="error"].active { background: rgba(192,57,43,0.18); border-color: rgba(192,57,43,0.45); color: var(--red); box-shadow: 0 0 0 2px rgba(192,57,43,0.1); }
    .log-toolbar .chip[data-level="debug"] { color: var(--text-dim); border-color: rgba(166,158,148,0.3); }
    .log-toolbar .chip[data-level="debug"].active { background: rgba(166,158,148,0.18); border-color: rgba(166,158,148,0.45); color: var(--text-dim); box-shadow: 0 0 0 2px rgba(166,158,148,0.1); }

    .log-search {
      flex: 1;
      min-width: 100px;
      padding: 0.22rem 0.5rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-size: 0.76rem;
      outline: none;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .log-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(184,151,90,0.1); }

    .log-scroll {
      flex: 1;
      overflow: auto;
      min-height: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.15rem 0;
    }

    .log-card {
      border-left: 2px solid var(--border);
      padding: 0.18rem 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      white-space: nowrap;
      border-bottom: 1px solid rgba(44,44,44,0.05);
      transition: background var(--transition-fast);
    }
    .log-card:hover { background: rgba(184,151,90,0.05); }

    .log-card-info { border-left-color: var(--blue); }
    .log-card-warn { border-left-color: var(--yellow); }
    .log-card-error { border-left-color: var(--red); background: rgba(192,57,43,0.03); }
    .log-card-debug { border-left-color: var(--text-dim); }

    .log-card .log-level {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.04rem 0.3rem;
      border-radius: 3px;
      font-size: 0.6rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      flex-shrink: 0;
      min-width: 34px;
    }
    .log-card-info .log-level { background: rgba(91,141,184,0.12); color: var(--blue); }
    .log-card-warn .log-level { background: rgba(212,160,23,0.12); color: var(--yellow); }
    .log-card-error .log-level { background: rgba(192,57,43,0.12); color: var(--red); }
    .log-card-debug .log-level { background: rgba(166,158,148,0.12); color: var(--text-dim); }

    .log-card .log-ts {
      font-size: 0.65rem;
      color: var(--text-dim);
      flex-shrink: 0;
      min-width: 42px;
    }

    .log-card .log-msg {
      font-family: var(--font-mono);
      font-size: 0.76rem;
      line-height: 1.35;
      color: var(--text);
      font-weight: 500;
    }

    .log-field-chip {
      display: inline-flex;
      align-items: center;
      padding: 0 0.28rem;
      border-radius: 3px;
      font-size: 0.62rem;
      font-family: var(--font-mono);
      background: rgba(44,44,44,0.06);
      color: var(--text-dim);
      flex-shrink: 0;
      white-space: nowrap;
    }

    .log-source-badge {
      display: inline-flex;
      align-items: center;
      padding: 0 0.3rem;
      border-radius: 3px;
      font-size: 0.6rem;
      font-family: var(--font-mono);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .log-source-server {
      background: rgba(91,141,184,0.12);
      color: #5B8DB8;
    }
    .log-source-dashboard {
      background: rgba(184,151,90,0.12);
      color: #B8975A;
    }

    .btn-log-live {
      padding: 0.2rem 0.6rem;
      font-size: 0.78rem;
      font-weight: 600;
      border-radius: 4px;
      transition: background 0.2s, color 0.2s;
    }
    .btn-log-live.active {
      background: var(--red);
      color: #fff;
      border-color: var(--red);
      animation: livePulse 2s ease-in-out infinite;
    }
    @keyframes livePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .log-footer {
      flex-shrink: 0;
      padding: 0.4rem 0;
      text-align: center;
    }

    .log-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      color: var(--text-dim);
      gap: 0.75rem;
    }
    .log-empty svg { opacity: 0.4; }
    .log-empty span { font-size: 0.88rem; }

    .log-count {
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-left: auto;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .refresh-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      opacity: 0;
      flex-shrink: 0;
      transition: opacity 0.3s;
    }
    .refresh-dot.flash { animation: refreshPulse 1s ease-out; }

    @keyframes refreshPulse {
      0% { opacity: 1; transform: scale(1.2); }
      100% { opacity: 0; transform: scale(1); }
    }

    /* Settings */
    .settings-table { width: 100%; border-collapse: collapse; }
    .settings-table td { padding: 0.5rem 0.5rem; vertical-align: top; }
    .settings-table .key-cell { width: 220px; font-family: var(--font-mono); font-size: 0.82rem; color: var(--accent); padding-top: 0.65rem; }

    .settings-input {
      width: 100%;
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }

    .settings-input:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px rgba(184,151,90,0.12); }
    .settings-input.masked { color: var(--text-dim); }

    /* Mode panel */
    .mode-panel { padding: 0.25rem 0; }
    .mode-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
    }
    .mode-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .mode-card-title {
      font-weight: 600;
      font-size: 1rem;
      color: var(--text);
    }
    .mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      user-select: none;
    }
    .mode-toggle-track {
      position: relative;
      width: 48px;
      height: 26px;
      background: var(--toggle-off);
      border-radius: 13px;
      transition: background 0.25s ease, box-shadow 0.25s ease;
      display: inline-block;
    }
    .mode-toggle-track.on {
      background: var(--toggle-on);
      box-shadow: 0 0 8px rgba(34,197,94,0.3);
    }
    .mode-toggle-knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      background: var(--bg-card);
      border-radius: 50%;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    }
    .mode-toggle-track.on .mode-toggle-knob {
      transform: translateX(22px);
    }
    .mode-toggle-label {
      font-size: 0.82rem;
      font-weight: 600;
      min-width: 28px;
      color: var(--text-dim);
    }
    /* Small toggle variant for skill cards */
    .skill-toggle-sm .mode-toggle-track {
      width: 36px;
      height: 20px;
      border-radius: 10px;
    }
    .skill-toggle-sm .mode-toggle-knob {
      width: 14px;
      height: 14px;
    }
    .skill-toggle-sm .mode-toggle-track.on .mode-toggle-knob {
      transform: translateX(16px);
    }
    /* ── CSS-only toggle switch (checkbox-backed) ── */
    .toggle-switch {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      user-select: none;
      font-size: 0.82rem;
    }
    .toggle-switch input[type="checkbox"] {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
      pointer-events: none;
    }
    .toggle-switch-track {
      position: relative;
      width: 36px;
      height: 20px;
      background: var(--toggle-off);
      border-radius: 10px;
      transition: background 0.25s ease, box-shadow 0.25s ease;
      flex-shrink: 0;
    }
    .toggle-switch-knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      background: var(--bg-card);
      border-radius: 50%;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .toggle-switch input:checked + .toggle-switch-track {
      background: var(--toggle-on);
      box-shadow: 0 0 6px rgba(34,197,94,0.25);
    }
    .toggle-switch input:checked + .toggle-switch-track .toggle-switch-knob {
      transform: translateX(16px);
    }
    .toggle-switch-label {
      line-height: 1.2;
    }
    /* Skill toggles grid */
    .skill-toggles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.35rem 0.75rem;
      margin-top: 0.3rem;
    }
    .skill-toggles .toggle-switch {
      font-size: 0.78rem;
      padding: 0.2rem 0;
    }

    .mode-desc {
      font-size: 0.85rem;
      color: var(--text-dim);
      line-height: 1.5;
      margin: 0 0 0.5rem 0;
    }
    .mode-desc code {
      background: var(--bg);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .mode-warning {
      display: flex;
      gap: 0.6rem;
      background: var(--warning-bg);
      border: 1px solid var(--warning-border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-top: 0.75rem;
      color: var(--warning-text);
      font-size: 0.84rem;
      line-height: 1.5;
    }
    .mode-warning-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .mode-warning strong {
      display: block;
      margin-bottom: 0.25rem;
    }
    .mode-warning p { margin: 0; }

    /* Prompts panel */
    .prompt-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .prompt-section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .prompt-section-title {
      font-weight: 600;
      font-size: 0.92rem;
      color: var(--text);
    }
    .prompt-badge {
      font-size: 0.72rem;
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
      background: var(--bg);
      color: var(--text-dim);
      border: 1px solid var(--border);
    }
    .prompt-mode-tabs {
      margin-left: auto;
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .prompt-mode-tab {
      padding: 0.25rem 0.65rem;
      font-size: 0.76rem;
      font-weight: 500;
      border: none;
      background: var(--bg);
      color: var(--text-dim);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .prompt-mode-tab:not(:last-child) {
      border-right: 1px solid var(--border);
    }
    .prompt-mode-tab.active {
      background: var(--accent);
      color: #fff;
    }
    .prompt-mode-tab:hover:not(.active) {
      background: var(--border);
    }
    .prompt-preview {
      max-height: 500px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .prompt-help {
      font-size: 0.84rem;
      color: var(--text-dim);
      line-height: 1.5;
      margin: 0 0 0.75rem 0;
    }
    .prompt-editor {
      width: 100%;
      padding: 0.75rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 0.82rem;
      line-height: 1.5;
      resize: vertical;
      transition: border-color var(--transition-fast);
    }
    .prompt-editor:focus {
      border-color: var(--accent);
      outline: none;
      box-shadow: 0 0 0 3px rgba(184,151,90,0.12);
    }

    .prompt-reference {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--bg);
    }
    .prompt-reference-summary {
      padding: 0.5rem 0.75rem;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text-dim);
      cursor: pointer;
      user-select: none;
    }
    .prompt-reference-summary:hover { color: var(--text); }
    .prompt-reference-body {
      padding: 0 0.75rem 0.75rem;
    }
    .prompt-ref-table {
      width: 100%;
      font-size: 0.78rem;
      line-height: 1.5;
      border-collapse: collapse;
    }
    .prompt-ref-table td {
      padding: 0.4rem 0.5rem;
      border-top: 1px solid var(--border);
      vertical-align: top;
    }
    .prompt-ref-key {
      font-weight: 600;
      white-space: nowrap;
      width: 120px;
      color: var(--text);
    }
    .prompt-ref-table code {
      font-size: 0.75rem;
      background: rgba(0,0,0,0.04);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
    }

    .code-viewer {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.5;
      max-height: 400px;
      overflow: auto;
      white-space: pre;
      color: var(--text);
      margin: 0;
    }
    .code-editor {
      background: var(--bg-card);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      padding: 1rem;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.5;
      min-height: 200px;
      width: 100%;
      color: var(--text);
      margin: 0;
      resize: vertical;
      box-sizing: border-box;
      tab-size: 4;
    }
    .code-editor:focus { outline: none; border-color: var(--accent2); }
    .builtin-description-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
      line-height: 1.6;
    }
    .builtin-description-card .desc-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent2);
      margin-bottom: 0.5rem;
    }
    .builtin-description-card .desc-text {
      font-size: 0.88rem;
      color: var(--text);
      line-height: 1.6;
    }
    .skill-section-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 0.75rem;
      overflow: hidden;
      background: var(--bg-card);
    }
    .skill-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0.75rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .skill-section-title {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text);
    }
    .skill-section-actions {
      display: flex;
      gap: 0.4rem;
      align-items: center;
      flex-shrink: 0;
    }
    .skill-section-body .code-viewer {
      border: none;
      border-radius: 0;
      max-height: 500px;
      margin: 0;
    }
    .skill-section-body .code-editor {
      border: none;
      border-radius: 0;
      min-height: 300px;
      width: 100%;
      box-sizing: border-box;
    }
    .skill-section-desc {
      padding: 0.6rem 0.75rem;
      font-size: 0.8rem;
      color: var(--text-dim);
      line-height: 1.55;
      border-bottom: 1px solid var(--border);
      background: var(--bg-card);
    }
    .skill-section-desc a {
      color: var(--accent2);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .skill-section-desc a:hover { color: var(--accent); }
    .btn-edit {
      padding: 0.25rem 0.65rem;
      font-size: 0.75rem;
      border-radius: 4px;
      background: var(--editor-bg);
      color: var(--editor-fg);
      border: none;
      cursor: pointer;
      font-weight: 500;
      transition: background var(--transition-fast);
    }
    .btn-edit:hover { background: var(--editor-bg-hover); }
    .builtin-envvars-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
    }
    .builtin-envvars-card .envvars-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent2);
      margin-bottom: 0.5rem;
    }
    .builtin-envvar-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .builtin-envvar-key {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--accent);
      min-width: 200px;
      flex-shrink: 0;
    }
    .builtin-envvar-input {
      flex: 1;
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 0.82rem;
    }
    .builtin-envvar-input:focus { border-color: var(--accent); outline: none; }
    .builtin-envvar-input::placeholder { color: var(--text-dim); opacity: 0.6; }
    .builtin-envvars-empty {
      font-size: 0.82rem;
      color: var(--text-dim);
      font-style: italic;
    }
    .builtin-envvars-actions {
      margin-top: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .builtin-desc-warning {
      margin-top: 0.65rem;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      background: rgba(184,151,90,0.1);
      border-left: 3px solid var(--accent);
      font-size: 0.82rem;
      color: var(--accent2);
      line-height: 1.5;
    }

    /* ── Skill Detail Redesign ── */
    .skill-detail-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-left: 4px solid var(--accent);
      border-radius: var(--radius);
      box-shadow: var(--shadow-sm);
    }
    .skill-detail-header {
      padding: 1.25rem 1.5rem 1rem;
    }
    .skill-detail-header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .skill-detail-name {
      font-size: 1.3rem;
      font-weight: 700;
      margin: 0 0 0.35rem 0;
      color: var(--text);
    }
    .skill-detail-envkey {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      padding: 0.15rem 0.5rem;
      background: rgba(184,151,90,0.1);
      border: 1px solid rgba(184,151,90,0.2);
      border-radius: 4px;
      color: var(--accent2);
    }
    .skill-detail-desc {
      margin-top: 0.85rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--border);
    }
    .skill-detail-desc .desc-text {
      font-size: 0.88rem;
      color: var(--text);
      line-height: 1.6;
    }
    /* ── Driver tabs (shared by Skills / MCP pages) ── */
    .driver-tabs {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--border);
      position: relative;
    }
    .driver-tab {
      padding: 0.6rem 1.15rem;
      cursor: pointer;
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      background: transparent;
      color: var(--text-dim);
      font-size: 0.85rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: -1px;
      position: relative;
      transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      user-select: none;
    }
    .driver-tab::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 50%;
      width: 0;
      height: 2px;
      background: var(--accent);
      border-radius: 1px;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .driver-tab:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
    .driver-tab.active {
      background: var(--bg-card);
      border-color: var(--border);
      color: var(--text);
      font-weight: 600;
    }
    .driver-tab.active::after {
      width: 60%;
      left: 20%;
    }
    .driver-tab .chip-icon {
      width: 16px;
      height: 16px;
      border-radius: 3px;
    }
    .driver-tab-panel {
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      background: var(--bg-card);
      padding: 1.25rem;
    }
    @keyframes driverTabFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .driver-tab-panel.fade-in {
      animation: driverTabFadeIn 0.25s ease-out;
    }

    .skill-detail-tabs {
      display: flex;
      gap: 2px;
      padding: 0 1.5rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .skill-detail-tab {
      padding: 0.55rem 1rem;
      cursor: pointer;
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      background: transparent;
      color: var(--text-dim);
      font-size: 0.82rem;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      margin-bottom: -1px;
      transition: background var(--transition-fast), color var(--transition-fast);
      user-select: none;
    }
    .skill-detail-tab:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
    .skill-detail-tab.active {
      background: var(--bg-card);
      border-color: var(--border);
      color: var(--text);
      font-weight: 600;
    }
    .skill-detail-tab .chip-icon {
      width: 14px;
      height: 14px;
      border-radius: 3px;
    }
    .skill-detail-content {
      padding: 1rem 1.5rem 1.5rem;
    }
    .skill-detail-divider {
      border: none;
      border-top: 1px solid var(--border);
      margin: 1.25rem 0;
    }
    .skill-detail-envarea-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--blue);
      margin-bottom: 0.65rem;
    }

    .settings-help {
      font-size: 0.72rem;
      color: var(--text-dim);
      margin-top: 0.3rem;
      line-height: 1.45;
    }

    .settings-help code {
      background: rgba(44,44,44,0.06);
      padding: 0.05rem 0.3rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-family: var(--font-mono);
    }

    /* Settings nav layout */
    #tab-settings.active { display: flex; flex-direction: column; height: 100%; }

    .settings-layout {
      display: flex;
      flex: 1;
      min-height: 0;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass);
      overflow: hidden;
      box-shadow: var(--shadow-sm);
    }

    .settings-nav {
      width: 180px;
      flex-shrink: 0;
      overflow-y: auto;
      border-right: 1px solid var(--glass-border);
    }

    .settings-nav-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.7rem 0.85rem;
      cursor: pointer;
      user-select: none;
      transition: all var(--transition-fast);
      border-bottom: 1px solid rgba(44,44,44,0.06);
      border-left: 3px solid transparent;
      font-size: 0.88rem;
      color: var(--text);
    }
    .settings-nav-item:hover { background: var(--surface-hover); border-left-color: rgba(184,151,90,0.3); }
    .settings-nav-item.active {
      background: rgba(184,151,90,0.15);
      border-left-color: var(--accent);
      color: var(--accent2);
      font-weight: 500;
    }

    .settings-nav-icon { font-size: 1rem; width: 1.2rem; text-align: center; }

    .settings-subnav {
      width: 160px;
      flex-shrink: 0;
      overflow-y: auto;
      border-right: 1px solid var(--glass-border);
      background: rgba(255,255,255,0.3);
      display: none;
    }
    .settings-subnav.visible { display: block; }

    .settings-subnav-item {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.6rem 0.75rem;
      cursor: pointer;
      user-select: none;
      transition: all var(--transition-fast);
      border-bottom: 1px solid rgba(44,44,44,0.04);
      font-size: 0.84rem;
      color: var(--text-muted);
    }
    .settings-subnav-item:hover { background: var(--surface-hover); color: var(--text); }
    .settings-subnav-item.active {
      background: rgba(184,151,90,0.12);
      color: var(--accent2);
      font-weight: 500;
    }
    .settings-subnav-item img {
      width: 18px; height: 18px;
      border-radius: 3px;
      object-fit: contain;
      transition: transform var(--transition-fast);
    }
    .settings-subnav-item:hover img { transform: scale(1.1); }

    .settings-form-panel {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .settings-form-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-dim);
      font-size: 0.9rem;
    }

    .settings-form-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 0.75rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .settings-form-title img {
      width: 22px; height: 22px;
      border-radius: 4px;
      object-fit: contain;
    }

    /* Settings — type-aware widgets */
    .settings-badge-hot {
      display: inline-block;
      font-size: 0.62rem;
      padding: 0.08rem 0.32rem;
      margin-left: 0.4rem;
      border-radius: 3px;
      background: rgba(234,179,8,0.12);
      color: #b8860b;
      vertical-align: middle;
      font-weight: 500;
      white-space: nowrap;
      letter-spacing: 0.01em;
    }
    .settings-bool-row {
      display: flex;
      align-items: center;
      padding: 0.1rem 0;
    }
    .settings-select {
      appearance: none;
      -webkit-appearance: none;
      padding-right: 1.8rem;
      cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 7'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23888' fill='none' stroke-width='1.5'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.6rem center;
      background-size: 0.65rem;
    }
    .settings-select:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px rgba(184,151,90,0.12); }

    /* Charts */
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .chart-container {
      padding: 1rem 1.25rem;
      position: relative;
      min-height: 220px;
      transition: box-shadow var(--transition-med);
    }
    .chart-container:hover { box-shadow: var(--shadow-md); }
    .chart-container canvas { width: 100% !important; max-height: 280px; }
    .chart-title { font-size: 0.85rem; font-weight: 600; color: var(--accent2); margin-bottom: 0.75rem; letter-spacing: -0.01em; }
    .success-rate-labels { display: flex; justify-content: center; gap: 1.5rem; margin-top: 0.5rem; font-size: 0.78rem; color: var(--text-muted); }
    @media (max-width: 900px) { .charts-grid { grid-template-columns: 1fr; } .charts-grid .chart-span-2 { grid-column: span 1; } }

    /* ── Trace Modal ── */
    .trace-modal-content {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem 2rem;
      min-width: 800px;
      max-width: 95vw;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow-lg);
      animation: modalSlideIn 0.25s ease;
    }
    .trace-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .trace-modal-header h3 { margin: 0; font-size: 1rem; }
    .trace-timeline-container { min-height: 100px; }
    .trace-time-axis {
      position: relative;
      height: 24px;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .trace-time-axis span {
      position: absolute;
      transform: translateX(-50%);
      font-size: 0.68rem;
      color: var(--text-dim);
      font-family: var(--font-mono);
    }
    .trace-job-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.4rem 0;
      cursor: pointer;
      border-bottom: 1px solid rgba(44,44,44,0.06);
      transition: background 0.15s;
    }
    .trace-job-row:hover { background: var(--surface-hover); }
    .trace-job-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-width: 280px;
      flex-shrink: 0;
      font-size: 0.78rem;
    }
    .trace-bar-track {
      flex: 1;
      position: relative;
      height: 18px;
      background: rgba(44,44,44,0.04);
      border-radius: 3px;
      overflow: hidden;
    }
    .trace-bar {
      position: absolute;
      top: 0;
      height: 100%;
      border-radius: 3px;
      min-width: 3px;
      opacity: 0.85;
      transition: opacity 0.15s;
    }
    .trace-job-row:hover .trace-bar { opacity: 1; }
    .trace-detail-container { min-height: 200px; }
    .trace-detail-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .trace-messages {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 60vh;
      overflow-y: auto;
    }

    /* ── Trigger Mode Popup ── */
    .trigger-mode-card {
      cursor: pointer;
      padding: 1.1rem 1rem;
      border: 2px solid var(--border);
      border-radius: 10px;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s, transform 0.1s;
      position: relative;
    }
    .trigger-mode-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    .trigger-mode-card:active {
      transform: translateY(0);
    }
    .trigger-mode-card.card-blue:hover {
      border-color: #2563eb;
      background: rgba(37,99,235,0.05);
    }
    .trigger-mode-card.card-purple:hover {
      border-color: #7c3aed;
      background: rgba(124,58,237,0.05);
    }
    .trigger-mode-icon {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .trigger-mode-card h4 {
      margin: 0;
      font-size: 0.9rem;
      color: var(--text-main);
    }
    .trigger-mode-card p {
      margin: 0.4rem 0 0;
      font-size: 0.8rem;
      color: var(--text-secondary, var(--text-dim));
      line-height: 1.45;
    }
    .trigger-mode-features {
      margin: 0.5rem 0 0;
      padding: 0;
      list-style: none;
      font-size: 0.76rem;
      color: var(--text-dim);
      line-height: 1.5;
    }
    .trigger-mode-features li::before {
      content: '\\2713  ';
      font-weight: 600;
      opacity: 0.5;
    }

    /* ── Schedule Modal Input Override ── */
    #sched-modal .settings-input,
    #sched-modal .settings-input:not(:focus),
    #sched-modal textarea,
    #sched-modal select {
      background: var(--bg-card);
    }

    #qt-modal .settings-input,
    #qt-modal .settings-input:not(:focus),
    #qt-modal textarea,
    #qt-modal select {
      background: var(--bg-card);
    }

    /* ── Schedule History Inline Accordion ── */
    .sched-task-row {
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .sched-task-row:hover td {
      background: rgba(184,151,90,0.06);
    }
    .sched-task-row.expanded td {
      background: rgba(184,151,90,0.10);
      border-bottom-color: transparent;
    }
    tbody tr.task-history-row td,
    tbody tr.task-history-row:nth-child(even) td,
    tbody tr.task-history-row:hover td {
      background: transparent;
    }
    .task-history-panel {
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
    }
    .task-history-inner {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-top: 2px solid var(--accent);
      border-radius: 0 0 var(--radius) var(--radius);
      margin: 0 0.5rem 0.75rem;
      box-shadow: 0 4px 16px rgba(44,44,44,0.07);
      overflow: hidden;
    }
    .task-history-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.6rem 1rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--accent2);
    }
    .task-history-title-bar > span:first-child {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .task-history-count {
      font-weight: 400;
      color: var(--text-dim);
      font-size: 0.72rem;
    }
    .task-history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
      table-layout: fixed;
    }
    .task-history-table th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      color: var(--text-dim);
      font-weight: 600;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 1px solid var(--border);
      background: rgba(245,241,232,0.3);
    }
    .task-history-table col.sh-num      { width: 40px; }
    .task-history-table col.sh-started  { width: 160px; }
    .task-history-table col.sh-status   { width: 120px; }
    .task-history-table col.sh-duration { width: 90px; }
    .task-history-table col.sh-source   { width: 95px; }
    .task-history-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid rgba(44,44,44,0.05);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .task-history-table tbody tr:last-child td {
      border-bottom: none;
    }
    .task-history-table tbody tr:hover td {
      background: rgba(184,151,90,0.04);
    }
    .task-history-output {
      white-space: normal;
      word-break: break-word;
      line-height: 1.45;
      font-size: 0.8rem;
    }
    .qt-output-full {
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 400px;
      overflow-y: auto;
      display: block;
      padding: 0.5rem 0;
    }
    .qt-output-toggle {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0;
      margin-left: 0.25rem;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .qt-output-toggle:hover {
      color: var(--accent);
    }
    .task-history-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2rem 1rem;
      color: var(--text-dim);
      font-size: 0.85rem;
    }

    /* ── Run Detail Modal ── */
    .qt-history-run-row {
      cursor: pointer;
    }
    tbody tr.qt-history-run-row:hover td {
      background: rgba(184,151,90,0.08);
    }
    .qt-run-detail-overlay {
      position: fixed;
      inset: 0;
      z-index: 9500;
      background: rgba(44,44,44,0.5);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: overlayFadeIn 0.2s ease;
      transition: opacity 0.2s ease;
    }
    .qt-run-detail-modal {
      min-width: 600px;
      max-width: 80vw;
      max-height: 85vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: modalSlideIn 0.25s ease;
    }
    .qt-run-detail-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1rem;
      flex-shrink: 0;
    }
    .qt-run-detail-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--text);
    }
    .qt-run-detail-close {
      background: none;
      border: none;
      font-size: 1.4rem;
      color: var(--text-dim);
      cursor: pointer;
      padding: 0 0.25rem;
      line-height: 1;
      transition: color var(--transition-fast);
    }
    .qt-run-detail-close:hover {
      color: var(--text);
    }
    .qt-run-detail-meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem 1.5rem;
      margin-bottom: 1.25rem;
      flex-shrink: 0;
    }
    .qt-run-detail-meta-item {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .qt-run-detail-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-dim);
    }
    .qt-run-detail-meta-item > span:last-child {
      font-size: 0.88rem;
      color: var(--text);
    }
    .qt-run-detail-meta-item:nth-child(2) > span:last-child { color: var(--text-secondary); }
    .qt-run-detail-meta-item:nth-child(3) > span:last-child { color: var(--text-secondary); }
    .qt-run-detail-meta-item:nth-child(4) > span:last-child { color: var(--accent2); font-weight: 600; }
    .qt-run-detail-section-title {
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent2);
      margin-bottom: 0.5rem;
      padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .qt-run-detail-output {
      font-size: 0.88rem;
      line-height: 1.65;
      overflow-y: auto;
      flex: 1 1 auto;
      min-height: 0;
      padding: 0.5rem 0;
    }
    .qt-run-detail-output h1,
    .qt-run-detail-output h2,
    .qt-run-detail-output h3 {
      margin-top: 1rem;
      margin-bottom: 0.4rem;
    }
    .qt-run-detail-output h1 { font-size: 1.15rem; }
    .qt-run-detail-output h2 { font-size: 1.0rem; }
    .qt-run-detail-output h3 { font-size: 0.92rem; }
    .qt-run-detail-output pre {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      overflow-x: auto;
      font-size: 0.82rem;
      margin: 0.5rem 0;
    }
    .qt-run-detail-output ul,
    .qt-run-detail-output ol {
      padding-left: 1.5rem;
      margin: 0.4rem 0;
    }
    .qt-run-detail-output p {
      margin: 0.35rem 0;
    }
    .qt-run-detail-error {
      color: var(--red);
    }
    @media (max-width: 768px) {
      .qt-run-detail-modal { min-width: auto; width: 95vw; max-height: 90vh; }
      .qt-run-detail-meta { grid-template-columns: 1fr; }
    }
    .sched-day-label {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.55rem;
      border-radius: 5px;
      font-size: 0.8rem;
      cursor: pointer;
      background: var(--surface);
      border: 1px solid var(--border);
      transition: all var(--transition-fast);
      user-select: none;
    }
    .sched-day-label:hover { border-color: var(--accent); }
    .sched-day-label:has(input:checked) {
      background: rgba(184,151,90,0.2);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .sched-day-label input[type="checkbox"] { display: none; }
    .sched-help-text {
      font-size: 0.72rem;
      color: var(--text-dim);
      margin-top: 0.2rem;
    }

    /* ═══════════════════════════════════════════════
       Dark Mode Overrides
       ═══════════════════════════════════════════════ */

    /* ── Task navigation cards ── */
    :root[data-theme="dark"] .task-nav-orchestrator h3 { color: #a78bfa; }
    :root[data-theme="dark"] .task-nav-orchestrator:hover {
      background: linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(40,40,40,0.6) 100%);
    }
    :root[data-theme="dark"] .task-nav-ondemand h3 { color: #7bafd4; }
    :root[data-theme="dark"] .task-nav-schedule h3 { color: #fb923c; }
    :root[data-theme="dark"] .task-nav-triggered h3 { color: #2dd4bf; }

    /* ── Log viewer ── */
    :root[data-theme="dark"] .log-toolbar { background: rgba(36,36,36,0.6); }
    :root[data-theme="dark"] .log-search { background: var(--bg-subtle); }
    :root[data-theme="dark"] .log-scroll { background: var(--bg-subtle); }
    :root[data-theme="dark"] .log-card { border-bottom-color: rgba(255,255,255,0.05); }
    :root[data-theme="dark"] .log-field-chip { background: rgba(255,255,255,0.06); }

    /* ── Audit / Job cards ── */
    :root[data-theme="dark"] .audit-cell { background: rgba(255,255,255,0.03); }
    :root[data-theme="dark"] .job-card { background: var(--bg-subtle); }
    :root[data-theme="dark"] .job-card-body { background: rgba(255,255,255,0.02); }
    :root[data-theme="dark"] .job-msg-assistant { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .job-msg-content code { background: rgba(255,255,255,0.08); }

    /* ── Settings ── */
    :root[data-theme="dark"] .settings-input { background: var(--bg-subtle); }
    :root[data-theme="dark"] .settings-subnav { background: rgba(30,30,30,0.5); }
    :root[data-theme="dark"] .settings-help code { background: rgba(255,255,255,0.06); }

    /* ── Code viewer / editor ── */
    :root[data-theme="dark"] .code-viewer { background: var(--bg-subtle); }
    :root[data-theme="dark"] .code-editor { background: var(--bg-subtle); }
    :root[data-theme="dark"] .prompt-editor { background: var(--bg-subtle); }
    :root[data-theme="dark"] .prompt-ref-table code { background: rgba(255,255,255,0.06); }

    /* ── Driver tabs (dark) ── */
    :root[data-theme="dark"] .driver-tab.active { background: var(--bg-card); border-color: var(--border); }
    :root[data-theme="dark"] .driver-tab:hover { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .driver-tab-panel { background: var(--bg-card); }

    /* ── Skill detail page ── */
    :root[data-theme="dark"] .skill-detail-card { background: var(--surface); }
    :root[data-theme="dark"] .skill-detail-tab.active { background: var(--bg-subtle); border-color: var(--border); }
    :root[data-theme="dark"] .skill-detail-tab:hover { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .skill-section-card { background: var(--surface); }
    :root[data-theme="dark"] .skill-section-desc { background: var(--bg-subtle); }
    :root[data-theme="dark"] .builtin-description-card { background: var(--surface); }
    :root[data-theme="dark"] .builtin-envvars-card { background: var(--surface); }
    :root[data-theme="dark"] .builtin-envvar-input { background: var(--bg-subtle); }

    /* ── Webhook / Event URL bar ── */
    :root[data-theme="dark"] .evt-url-bar {
      background: linear-gradient(135deg, var(--surface) 0%, rgba(40,40,40,0.6) 100%);
    }
    :root[data-theme="dark"] .evt-tunnel-status { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .evt-tunnel-status-pending { color: #fbbf24; }

    /* ── Schedule history ── */
    :root[data-theme="dark"] .task-history-inner { background: var(--bg-subtle); }
    :root[data-theme="dark"] .task-history-table th { background: rgba(255,255,255,0.04); }
    :root[data-theme="dark"] .task-history-table td { border-bottom-color: rgba(255,255,255,0.05); }

    /* ── Trace bars ── */
    :root[data-theme="dark"] .trace-bar-track { background: rgba(255,255,255,0.04); }
    :root[data-theme="dark"] .trace-job-row { border-bottom-color: rgba(255,255,255,0.06); }

    /* ── Tool card ── */
    :root[data-theme="dark"] .tool-card-rate-bar { background: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .tool-card-divider { border-top-color: rgba(255,255,255,0.06); }

    /* ── Schedule modal inputs ── */
    :root[data-theme="dark"] #sched-modal .settings-input,
    :root[data-theme="dark"] #sched-modal .settings-input:not(:focus),
    :root[data-theme="dark"] #sched-modal textarea,
    :root[data-theme="dark"] #sched-modal select,
    :root[data-theme="dark"] #qt-modal .settings-input,
    :root[data-theme="dark"] #qt-modal .settings-input:not(:focus),
    :root[data-theme="dark"] #qt-modal textarea,
    :root[data-theme="dark"] #qt-modal select { background: var(--bg-subtle); color: var(--text); }

    /* ── Schedule Card Sections (Active / Archive) ── */
    .sched-card-section { margin-bottom: 1rem; }
    .sched-card-section .table-wrap { margin-top: 0; }
    .sched-card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.65rem 0.75rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    .sched-section-count {
      border-radius: 10px;
      padding: 0.1rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
    }
`;
