/** @module styles/components — Core reusable UI components (page banners, tables, badges, modals, page structure) */
export const componentStyles = `
    /* ═══════════════════════════════════════════════
       Page Description Banner
       ═══════════════════════════════════════════════ */

    .page-desc {
      background: var(--bg-card);
      border: 1px solid var(--glass-border);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius);
      padding: 0.9rem 1.1rem;
      margin-bottom: 1rem;
      line-height: 1.6;
      animation: fadeSlideIn var(--transition-med) ease-out both;
    }
    .page-desc h4 {
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--accent2);
      margin: 0 0 0.45rem;
    }
    .page-desc p {
      color: var(--text-muted);
      font-size: 0.83rem;
      margin: 0;
    }
    .page-desc code {
      font-size: 0.78rem;
      background: var(--surface);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    /* ═══════════════════════════════════════════════
       Tables
       ═══════════════════════════════════════════════ */

    .table-wrap { overflow-x: auto; margin-top: 1rem; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    th {
      text-align: left;
      padding: 0.6rem 0.75rem;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 2px solid var(--border);
      white-space: nowrap;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid rgba(44,44,44,0.06);
      white-space: nowrap;
    }

    tbody tr { transition: background var(--transition-fast); }
    tbody tr:nth-child(even) td { background: rgba(245,241,232,0.3); }
    tr:hover td { background: rgba(184,151,90,0.06); }

    /* ═══════════════════════════════════════════════
       Badges
       ═══════════════════════════════════════════════ */

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.18rem 0.55rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    .badge-active { background: rgba(76,175,80,0.12); color: var(--green); }
    .badge-inactive { background: rgba(166,158,148,0.12); color: var(--text-dim); }
    .badge-tool { background: rgba(184,151,90,0.12); color: var(--accent); }
    .badge-success { background: rgba(76,175,80,0.12); color: var(--green-dark); }
    .badge-error { background: rgba(192,57,43,0.12); color: var(--red); }
    .badge-info { background: rgba(33,150,243,0.12); color: #1565c0; }
    .badge-warning { background: rgba(255,152,0,0.12); color: #e65100; }

    /* Tool badges */
    .badge-claude { background: rgba(184,90,58,0.14); color: #B85A3A; }
    .badge-codex { background: rgba(13,138,106,0.14); color: var(--teal); }
    .badge-gemini { background: rgba(51,103,189,0.14); color: #3367BD; }

    /* Source badges */
    .badge-src-dashboard { background: rgba(37,99,235,0.12); color: var(--blue-action); }
    .badge-src-schedule { background: rgba(76,175,80,0.12); color: #388e3c; }
    .badge-src-slack { background: rgba(97,31,105,0.12); color: var(--pink-slack); }
    .badge-src-webhook { background: rgba(13,138,106,0.12); color: var(--teal); }
    .badge-src-polling { background: rgba(217,119,6,0.12); color: var(--orange); }
    .badge-src-chat { background: rgba(168,85,247,0.12); color: #a855f7; }
    .badge-src-ondemand { background: rgba(212,160,23,0.12); color: #b8860b; }
    .badge-src-triggered { background: rgba(13,138,106,0.12); color: var(--teal); }
    .badge-src-orchestrator { background: rgba(51,103,189,0.12); color: #3367bd; }
    .badge-src-unknown { background: rgba(107,114,128,0.12); color: var(--gray-neutral); }

    /* Status badges */
    .badge-enabled { background: rgba(22,163,74,0.12); color: var(--status-completed); }
    .badge-disabled { background: rgba(107,114,128,0.12); color: var(--gray-neutral); }
    .badge-parallel { background: rgba(37,99,235,0.12); color: var(--blue-action); }
    .badge-skip-running { background: rgba(13,138,106,0.12); color: var(--teal); }
    .badge-running { background: rgba(37,99,235,0.15); color: var(--blue-action); }
    .badge-paused { background: rgba(212,160,23,0.15); color: var(--yellow); }
    .badge-retry { background: rgba(212,160,23,0.15); color: var(--yellow); }
    .badge-gate { background: rgba(212,160,23,0.12); color: #b8860b; }
    .badge-sm { font-size: 0.7rem; }

    /* Verification badges */
    .badge-bearer { background: rgba(37,99,235,0.12); color: var(--blue-action); }
    .badge-hmac { background: rgba(13,138,106,0.12); color: var(--teal); }
    .badge-slack-v0 { background: rgba(97,31,105,0.12); color: #611f69; }

    /* Publisher preset badges */
    .badge-pub-github { background: rgba(36,41,47,0.10); color: #24292f; }
    .badge-pub-slack { background: rgba(97,31,105,0.10); color: #611f69; }
    .badge-pub-jira { background: rgba(0,82,204,0.10); color: #0052cc; }
    .badge-pub-generic { background: rgba(107,114,128,0.10); color: var(--gray-neutral); }

    /* ═══════════════════════════════════════════════
       Action Buttons
       ═══════════════════════════════════════════════ */

    .action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      margin: 1px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
      vertical-align: middle;
    }
    .action-btn:hover {
      background: var(--surface-hover);
      border-color: var(--border-hover);
      color: var(--accent2);
      transform: scale(1.08);
    }
    .action-btn:active { transform: scale(0.95); }
    .action-btn-danger { color: var(--text-dim); }
    .action-btn-danger:hover {
      color: var(--red);
      border-color: var(--red);
      background: rgba(220,38,38,0.06);
    }
    .action-btn svg { display: block; flex-shrink: 0; }
    .action-btn.action-btn-running {
      border-color: var(--blue-action);
      background: rgba(37,99,235,0.08);
      color: var(--blue-action);
      cursor: default;
      pointer-events: none;
    }
    .action-btn.action-btn-running svg { animation: actionSpin 1s linear infinite; }

    /* ═══════════════════════════════════════════════
       Modals
       ═══════════════════════════════════════════════ */

    .modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      background: rgba(44,44,44,0.5);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: overlayFadeIn 0.2s ease;
    }

    .modal-content {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem 2rem;
      min-width: 640px;
      max-width: 90vw;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow-lg);
      animation: modalSlideIn 0.25s ease;
    }

    .modal-content-wide { min-width: 700px; }

    .modal-title {
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--text);
      margin: 0 0 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .modal-section-title {
      margin: 1.25rem 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent2);
    }

    .modal-section-title:first-child { margin-top: 0; }

    /* ── MCP Modal compact spacing ── */
    #mcp-modal .modal-section-title { margin: 0.75rem 0 0.25rem; }
    #mcp-modal .settings-table td { padding: 0.35rem 0.5rem; }
    #mcp-stdio-fields,
    #mcp-url-fields { margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }

    /* ═══════════════════════════════════════════════
       Page Structure
       ═══════════════════════════════════════════════ */

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .page-header h2 { margin: 0; font-size: 1.1rem; }

    .page-toolbar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 0.5rem;
    }

    .section-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--accent2);
      margin: 1.5rem 0 0.75rem;
    }

    .section-title:first-child { margin-top: 0; }

    .section-divider {
      margin-top: 2rem;
      border-top: 1px solid var(--border);
      padding-top: 1.5rem;
    }

    .card-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent2);
      margin: 0 0 0.5rem;
    }

    .chip-group {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .chip-divider {
      display: inline-block;
      width: 1px;
      height: 1.2rem;
      background: var(--border);
      margin: 0 0.15rem;
      vertical-align: middle;
    }

    .config-path {
      font-size: 0.8rem;
      color: var(--text-dim);
      font-family: var(--font-mono);
      margin-bottom: 1rem;
    }

    .empty-state-inline {
      text-align: center;
      color: var(--text-dim);
      padding: 1.5rem 1rem;
      font-size: 0.85rem;
    }

    .data-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }

    @media (max-width: 768px) {
      .data-grid-2 { grid-template-columns: 1fr; }
      .modal-content, .modal-content-wide { min-width: auto; width: 95vw; }
    }

    /* ═══════════════════════════════════════════════
       Schedule Modal Input Overrides
       ═══════════════════════════════════════════════ */

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

    /* ═══════════════════════════════════════════════
       Model Field Warning
       ═══════════════════════════════════════════════ */
    .model-mismatch-warning {
      color: #b45309;
      font-size: 0.85em;
      margin-top: 4px;
    }
    :root[data-theme="dark"] .model-mismatch-warning {
      color: #fbbf24;
    }

    /* ═══════════════════════════════════════════════
       Dark Mode Overrides
       ═══════════════════════════════════════════════ */

    :root[data-theme="dark"] .page-desc { background: var(--surface); border-color: var(--border); }

    :root[data-theme="dark"] td { border-bottom-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] tbody tr:nth-child(even) td { background: rgba(255,255,255,0.03); }
    :root[data-theme="dark"] tr:hover td { background: rgba(184,151,90,0.08); }

    :root[data-theme="dark"] .badge-info { color: var(--blue); }
    :root[data-theme="dark"] .badge-warning { color: var(--yellow); }
    :root[data-theme="dark"] .badge-claude { color: #e8926e; }
    :root[data-theme="dark"] .badge-gemini { color: #7aabf5; }
    :root[data-theme="dark"] .badge-src-schedule { color: #4ade80; }
    :root[data-theme="dark"] .badge-src-slack { color: #d946ef; }
    :root[data-theme="dark"] .badge-pub-github { color: #e5e5e5; background: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .badge-pub-slack { color: #d946ef; }
    :root[data-theme="dark"] .badge-pub-jira { color: #60a5fa; }
    :root[data-theme="dark"] .badge-slack-v0 { color: #d946ef; }

    :root[data-theme="dark"] .badge-src-ondemand { color: #d4a017; }
    :root[data-theme="dark"] .badge-src-orchestrator { color: #7aabf5; }
    :root[data-theme="dark"] .badge-gate { color: #d4a017; }

    :root[data-theme="dark"] .modal-overlay { background: rgba(0,0,0,0.6); }

    /* ═══════════════════════════════════════════════
       Webhook Trigger Section (used in triggered tasks modal)
       ═══════════════════════════════════════════════ */
    .webhook-trigger-section {
      margin: 0.75rem 0 0.5rem;
      padding: 0.55rem 0.7rem;
      background: rgba(184,151,90,0.06);
      border: 1px solid rgba(184,151,90,0.18);
      border-radius: 8px;
    }
    .webhook-trigger-title {
      font-weight: 600;
      font-size: 0.8rem;
      color: var(--accent2);
      margin-bottom: 0.5rem;
    }
    :root[data-theme="dark"] .webhook-trigger-section {
      background: rgba(212,169,106,0.06);
      border-color: rgba(212,169,106,0.15);
    }
`;
