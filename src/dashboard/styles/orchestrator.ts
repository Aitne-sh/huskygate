/** @module styles/orchestrator — CSS for orchestrator editor, DAG canvas, runs, and guide */
export const orchestratorStyles = `
    /* ══════════════════════════════════════════════
       Flow Editor — Modern UI
       ══════════════════════════════════════════════ */

    /* ── Orchestrator List Cards ── */
    .orch-card-list { display: flex; flex-direction: column; gap: 1rem; }

    .orch-card {
      display: flex;
      gap: 1.25rem;
      cursor: pointer;
      padding: 1.25rem 1.5rem;
      border-radius: var(--radius);
      background: var(--glass);
      border: 1px solid var(--glass-border);
      box-shadow: var(--shadow-sm);
      transition: transform var(--transition-med),
                  box-shadow var(--transition-med),
                  border-color var(--transition-med),
                  background var(--transition-med);
    }
    .orch-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--border-hover);
      background: rgba(255,255,255,0.75);
    }
    .orch-card:active {
      transform: translateY(0);
      box-shadow: var(--shadow-sm);
      transition-duration: 0.08s;
    }

    /* Card body (left) */
    .orch-card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    /* Header: name + badges */
    .orch-card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .orch-card-name {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.01em;
    }

    /* Badges */
    .orch-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.55rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      line-height: 1.4;
    }
    .orch-badge-active {
      background: rgba(76,175,80,0.12);
      color: var(--green-dark);
      border: 1px solid rgba(76,175,80,0.25);
    }
    .orch-badge-paused {
      background: rgba(255,152,0,0.1);
      color: #b8860b;
      border: 1px solid rgba(255,152,0,0.25);
    }
    .orch-badge-validated {
      background: rgba(33,150,243,0.08);
      color: #1565c0;
      border: 1px solid rgba(33,150,243,0.2);
    }
    .orch-badge-webhook {
      background: rgba(124,58,237,0.1);
      color: var(--purple);
      border: 1px solid rgba(124,58,237,0.2);
    }

    /* Description */
    .orch-card-desc {
      margin: 0;
      font-size: 0.85rem;
      color: var(--text-dim);
      line-height: 1.45;
      max-width: 600px;
    }

    /* Stats grid */
    .orch-card-stats {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.5rem 1.25rem;
      padding-top: 0.4rem;
      border-top: 1px solid rgba(0,0,0,0.05);
    }

    .orch-stat {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .orch-stat-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      opacity: 0.7;
    }
    .orch-stat-value {
      font-size: 0.85rem;
      color: var(--text);
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .orch-stat-value code {
      background: rgba(0,0,0,0.05);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.82rem;
      font-family: var(--font-mono);
      color: var(--accent2);
    }
    .orch-stat-sub {
      color: var(--text-dim);
      font-size: 0.78rem;
      font-family: var(--font-mono);
    }
    .orch-stat-empty {
      color: var(--text-dim);
      opacity: 0.6;
      font-style: italic;
    }
    .orch-stat-error {
      font-size: 0.75rem;
      color: var(--red);
      margin-top: 0.1rem;
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Run status dot */
    .orch-run-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .orch-run-completed { background: var(--status-completed); }
    .orch-run-failed { background: var(--status-failed); }
    .orch-run-running { background: var(--status-running); animation: orchPulse 1.5s ease-in-out infinite; }
    .orch-run-pending { background: var(--status-pending); }
    .orch-run-waiting { background: var(--status-pending); }
    .orch-run-skipped { background: var(--yellow); }
    .orch-run-cancelled { background: var(--orange); }
    .orch-run-unknown { background: var(--gray-neutral); }
    @keyframes orchPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Result badge */
    .orch-result-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.12rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .orch-result-completed {
      background: rgba(76,175,80,0.12);
      color: var(--green-dark);
    }
    .orch-result-failed {
      background: rgba(192,57,43,0.1);
      color: var(--red);
    }
    .orch-result-running {
      background: rgba(33,150,243,0.1);
      color: #1565c0;
    }
    .orch-result-cancelled {
      background: rgba(255,152,0,0.1);
      color: #e65100;
    }
    .orch-result-pending,
    .orch-result-waiting,
    .orch-result-unknown {
      background: rgba(122,112,103,0.12);
      color: var(--text-dim);
    }
    .orch-result-skipped {
      background: rgba(255,152,0,0.1);
      color: #b26a00;
    }

    /* Card right side: actions + chevron */
    .orch-card-right {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-shrink: 0;
      align-self: center;
    }
    .orch-card-actions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .orch-btn-run, .orch-btn-runs, .orch-btn-del {
      padding: 0.5rem 1.2rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      transition: background var(--transition-fast), box-shadow var(--transition-fast);
      white-space: nowrap;
      min-width: 100px;
      text-align: center;
    }
    .orch-btn-run {
      background: rgba(76,175,80,0.1);
      border: 1px solid rgba(76,175,80,0.3);
      color: var(--green-dark);
    }
    .orch-btn-run:hover {
      background: rgba(76,175,80,0.2);
      box-shadow: 0 2px 8px rgba(76,175,80,0.15);
    }
    .orch-btn-runs {
      background: rgba(33,150,243,0.08);
      border: 1px solid rgba(33,150,243,0.2);
      color: #1565c0;
    }
    .orch-btn-runs:hover {
      background: rgba(33,150,243,0.18);
      box-shadow: 0 2px 8px rgba(33,150,243,0.12);
    }
    .orch-btn-del {
      background: rgba(192,57,43,0.06);
      border: 1px solid rgba(192,57,43,0.15);
      color: var(--red);
    }
    .orch-btn-del:hover {
      background: rgba(192,57,43,0.15);
      box-shadow: 0 2px 8px rgba(192,57,43,0.1);
    }

    /* Chevron */
    .orch-card-chevron {
      flex-shrink: 0;
      font-size: 1.6rem;
      color: var(--text-dim);
      opacity: 0.4;
      transition: transform var(--transition-med), color var(--transition-med), opacity var(--transition-med);
      line-height: 1;
      user-select: none;
    }
    .orch-card:hover .orch-card-chevron {
      transform: translateX(4px);
      color: var(--accent);
      opacity: 0.8;
    }

    /* ── Editor Header ── */
    .orch-editor-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 0.65rem 1rem;
      background: linear-gradient(135deg, #2C2C2C 0%, #3A3535 100%);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #F0EDE8;
    }
    .orch-editor-header > .btn { flex-shrink: 0; }
    .orch-editor-header .btn { color: #e0d8cf; border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); }
    .orch-editor-header .btn:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.25); }
    .orch-editor-header #orch-btn-validate {
      background: rgba(59,130,246,0.22);
      border-color: rgba(59,130,246,0.42);
      color: #b9dbff;
    }
    .orch-editor-header #orch-btn-validate:hover {
      background: rgba(59,130,246,0.34);
      border-color: rgba(96,165,250,0.55);
      color: #deefff;
    }
    .orch-editor-header #orch-btn-run {
      background: rgba(76,175,80,0.25);
      border-color: rgba(76,175,80,0.45);
      color: #9be6a0;
    }
    .orch-editor-header #orch-btn-run:hover {
      background: rgba(76,175,80,0.36);
      border-color: rgba(129,199,132,0.58);
      color: #cef7d2;
    }
    .orch-editor-header .btn-danger { background: rgba(192,57,43,0.2); border-color: rgba(192,57,43,0.3); color: #f5a5a0; }
    .orch-editor-header .btn-danger:hover { background: rgba(192,57,43,0.35); }
    .orch-editor-header h2 {
      font-size: 1rem; margin: 0; font-weight: 600;
      color: #F0EDE8; letter-spacing: 0.01em;
      flex-shrink: 0;
    }
    .orch-editor-actions {
      display: flex;
      gap: 0.4rem;
      margin-left: auto;
      align-items: center;
    }

    /* ── Canvas Toolbar ── */
    .orch-canvas-toolbar {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.45rem 1rem;
      background: rgba(237,232,221,0.5);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(8px);
      position: relative; z-index: 10;
    }
    .orch-toolbar-btn {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      padding: 0.34rem 0.8rem;
      border-radius: 12px;
      gap: 0.42rem;
      min-height: 34px;
      box-shadow: 0 1px 3px rgba(44,44,44,0.05);
    }
    .orch-toolbar-btn svg {
      width: 13px;
      height: 13px;
      flex-shrink: 0;
    }
    .orch-toolbar-btn-primary {
      background: linear-gradient(180deg, rgba(184,151,90,0.26) 0%, rgba(184,151,90,0.18) 100%);
      border-color: rgba(184,151,90,0.48);
      color: #9b7637;
    }
    .orch-toolbar-btn-primary:hover {
      background: linear-gradient(180deg, rgba(184,151,90,0.38) 0%, rgba(184,151,90,0.26) 100%);
      border-color: rgba(184,151,90,0.6);
      color: #825f26;
      box-shadow: 0 3px 10px rgba(184,151,90,0.18);
    }
    .orch-toolbar-btn-muted {
      background: rgba(255,255,255,0.86);
      border-color: rgba(44,44,44,0.12);
      color: #413b34;
    }
    .orch-toolbar-btn-muted:hover {
      background: rgba(255,255,255,0.96);
      border-color: rgba(44,44,44,0.2);
      color: #2f2a24;
      box-shadow: 0 3px 10px rgba(44,44,44,0.12);
    }
    .orch-zoom-group {
      display: flex;
      align-items: center;
      gap: 0.28rem;
      font-size: 0.78rem;
      color: var(--text-muted);
      margin-left: auto;
      padding: 0.18rem 0.28rem;
      border-radius: 12px;
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(184,151,90,0.28);
      box-shadow: 0 1px 4px rgba(44,44,44,0.06);
    }
    .orch-zoom-group #orch-zoom-level {
      min-width: 56px;
      text-align: center;
      font-weight: 700;
      font-size: 0.78rem;
      color: #5f5246;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .orch-zoom-btn,
    .orch-zoom-fit-btn {
      height: 31px;
      border-radius: 10px;
      border: 1px solid rgba(184,151,90,0.34);
      background: rgba(255,255,255,0.96);
      color: #4f4338;
      box-shadow: 0 1px 3px rgba(44,44,44,0.06);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .orch-zoom-btn {
      width: 31px;
      min-width: 31px;
    }
    .orch-zoom-btn svg {
      width: 12px;
      height: 12px;
      display: block;
      stroke-width: 2.3;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .orch-zoom-fit-btn {
      min-width: 48px;
      padding: 0 0.6rem;
      font-size: 0.8rem;
      font-weight: 700;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: 0.01em;
    }
    .orch-zoom-btn:hover,
    .orch-zoom-fit-btn:hover {
      background: var(--bg-card);
      border-color: rgba(184,151,90,0.52);
      color: #352f29;
      box-shadow: 0 3px 8px rgba(44,44,44,0.12);
    }
    .orch-toolbar-right-actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      margin-left: 0.35rem;
    }

    /* ── Add Node Dropdown ── */
    .orch-add-node-group { position: relative; }
    .orch-add-menu {
      position: absolute; top: calc(100% + 4px); left: 0; z-index: 100;
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      min-width: 280px; padding: 6px;
    }
    .orch-add-menu-item {
      padding: 10px 14px; cursor: pointer; display: flex; align-items: flex-start; gap: 10px;
      border-radius: 8px; transition: background 0.15s;
    }
    .orch-add-menu-item:hover { background: rgba(184,151,90,0.08); }
    .orch-add-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 6px; font-size: 13px; flex-shrink: 0;
    }
    .orch-add-icon.task { background: rgba(91,141,184,0.12); color: var(--blue); }
    .orch-add-icon.triggered { background: rgba(126,87,194,0.12); color: #7E57C2; }
    .orch-add-icon.gate { background: rgba(212,160,23,0.12); color: var(--yellow); }
    .orch-add-icon.end { background: rgba(122,112,103,0.12); color: var(--text-muted); }
    .orch-add-menu-text { display: flex; flex-direction: column; gap: 1px; }
    .orch-add-menu-text strong { font-size: 0.82rem; font-weight: 600; color: var(--text); }
    .orch-add-desc { font-size: 0.72rem; color: var(--text-muted); line-height: 1.3; }

    /* ── Canvas + Side Panel Layout ── */
    .orch-canvas-layout {
      display: flex; flex: 1;
      min-height: 500px; max-height: calc(100vh - 180px);
      border-radius: 0 0 12px 12px;
      overflow: hidden;
      background: var(--bg-card);
      position: relative;
    }
    .orch-canvas-area {
      flex: 1; position: relative; overflow: hidden; cursor: grab;
    }
    .orch-canvas-area:active { cursor: grabbing; }
    #orch-btn-add-node:disabled {
      opacity: 0.42;
      box-shadow: none;
    }

    /* ── Side Panel ── */
    .orch-side-panel {
      width: 360px; min-width: 320px; max-width: 420px;
      border-left: 1px solid var(--border);
      background: var(--bg-card); overflow-y: auto; overflow-x: hidden;
      box-shadow: -4px 0 16px rgba(0,0,0,0.04);
    }
    .orch-panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.75rem 1rem; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: var(--bg-card); z-index: 1;
    }
    .orch-panel-header h3 {
      margin: 0; font-size: 0.92rem; font-weight: 600;
      color: var(--text); letter-spacing: 0.01em;
    }
    .orch-panel-body { padding: 1rem; overflow-x: hidden; }
    .orch-panel-body .settings-table { font-size: 0.82rem; table-layout: fixed; width: 100%; }
    .orch-panel-body .settings-table .key-cell { width: 100px; font-size: 0.78rem; }
    .orch-panel-body .settings-input,
    .orch-panel-body textarea,
    .orch-panel-body select { max-width: 100%; box-sizing: border-box; }

    /* ── Field Layout (vertical label-above-input) ── */
    .orch-field { margin-bottom: 0.85rem; }
    .orch-field-label {
      display: block; font-size: 0.72rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-muted); margin-bottom: 0.3rem;
    }
    .orch-field-desc {
      font-size: 0.72rem; color: var(--text-dim, #A69E94);
      margin-top: 0.2rem; line-height: 1.45;
    }
    .orch-field .settings-input,
    .orch-field textarea,
    .orch-field select {
      width: 100%; box-sizing: border-box;
      border-radius: 8px; border: 1px solid var(--border);
      padding: 0.45rem 0.65rem; font-size: 0.82rem;
      background: var(--bg-card); color: var(--text);
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .orch-field .settings-input:focus,
    .orch-field textarea:focus,
    .orch-field select:focus {
      outline: none; border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(184,151,90,0.15);
    }

    /* ── Settings Overlay (centered card, full-screen dark backdrop) ── */
    .orch-settings-overlay {
      position: fixed; inset: 0; z-index: 200;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 3rem 1rem;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(3px);
      overflow-y: auto;
      animation: orchOverlayIn 0.2s ease-out;
    }
    @keyframes orchOverlayIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .orch-settings-card {
      width: 100%; max-width: 540px;
      background: var(--glass);
      border: 1px solid rgba(184,151,90,0.28);
      border-radius: 14px;
      box-shadow: 0 16px 48px rgba(44,44,44,0.10), 0 2px 8px rgba(184,151,90,0.08);
      animation: orchCardIn 0.22s ease-out;
    }
    @keyframes orchCardIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .orch-settings-card-header {
      display: flex; align-items: center; gap: 0.75rem;
      padding: 1rem 1.25rem 0.75rem;
    }
    .orch-settings-card-header h3 {
      margin: 0; font-size: 1.05rem; font-weight: 700;
      color: var(--text, #2C2C2C); letter-spacing: -0.01em;
    }
    .orch-settings-back-btn {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 0.3rem 0.65rem; border-radius: 8px;
      border: 1px solid var(--border); background: var(--surface, #F5F1E8);
      color: var(--text-muted); font-size: 0.78rem; font-weight: 500;
      cursor: pointer; transition: all 0.15s; white-space: nowrap;
    }
    .orch-settings-back-btn:hover {
      background: var(--surface-hover); border-color: var(--border-hover);
      color: var(--text);
    }
    .orch-settings-back-btn svg { flex-shrink: 0; }
    .orch-settings-card-divider {
      height: 1px; margin: 0 1.25rem;
      background: linear-gradient(90deg, var(--accent, #B8975A) 0%, rgba(184,151,90,0.15) 100%);
    }
    .orch-settings-card-body {
      padding: 1.1rem 1.25rem 1.25rem;
    }
    .orch-settings-card-body .orch-field {
      margin-bottom: 1rem;
    }
    .orch-settings-card-body .btn-group {
      padding-top: 0.5rem;
      border-top: 1px solid rgba(44,44,44,0.06);
    }

    /* ── Return Value Template ── */
    .orch-rv-template-card {
      margin: 0.75rem 0;
      padding: 0.55rem;
      background: var(--bg, #F5F1E8);
      border: 1px solid rgba(122,112,103,0.18);
      border-radius: 8px;
      font-size: 0.78rem;
    }
    .orch-rv-template-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.35rem;
    }
    .orch-rv-template-title {
      font-size: 0.92rem;
      color: var(--text);
      line-height: 1.2;
    }
    .orch-rv-template-copy-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0.24rem 0.6rem;
      border-radius: 999px;
      border: 1px solid rgba(184,151,90,0.48);
      background: rgba(184,151,90,0.16);
      color: var(--accent2, #9A7A3F);
      font-size: 0.75rem;
      font-weight: 700;
      line-height: 1.2;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .orch-rv-template-copy-btn:hover {
      background: rgba(184,151,90,0.24);
      border-color: rgba(184,151,90,0.62);
      color: var(--accent2, #9A7A3F);
    }
    .orch-rv-template-copy-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(184,151,90,0.2);
    }
    .orch-rv-template-copy-btn.copied {
      border-color: rgba(76,175,80,0.45);
      background: rgba(76,175,80,0.15);
      color: var(--green, #4CAF50);
    }
    .orch-rv-template-pre {
      margin: 0;
      padding: 0.4rem 0.45rem;
      background: var(--bg-card, #FFF);
      border-radius: 6px;
      border: 1px solid rgba(122,112,103,0.1);
      font-size: 0.72rem;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    /* ── Return Value Tags ── */
    .orch-rv-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0.25rem 0; }
    .orch-rv-tag {
      display: inline-flex; align-items: center; gap: 0.3rem;
      background: linear-gradient(135deg, rgba(91,141,184,0.1) 0%, rgba(91,141,184,0.06) 100%);
      color: var(--blue, #5B8DB8);
      border: 1px solid rgba(91,141,184,0.25);
      border-radius: 16px; padding: 0.2rem 0.6rem; font-size: 0.75rem; font-weight: 600;
      white-space: nowrap; transition: all 0.15s;
    }
    .orch-rv-tag:hover { background: rgba(91,141,184,0.15); border-color: rgba(91,141,184,0.4); }
    .orch-rv-tag-special {
      background: rgba(122,112,103,0.06); color: var(--text-dim, #A69E94);
      border-color: rgba(122,112,103,0.2); font-style: italic; font-weight: 500;
    }
    .orch-rv-tag-special:hover { background: rgba(122,112,103,0.1); }
    .orch-rv-remove {
      background: none; border: none; cursor: pointer; font-size: 0.85rem;
      color: inherit; opacity: 0.5; padding: 0; line-height: 1;
      transition: opacity 0.15s;
    }
    .orch-rv-remove:hover { opacity: 1; }

    /* ── Output Mode Toggle ── */
    .orch-output-mode-toggle {
      display: inline-flex;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(122,112,103,0.2);
      margin-top: 0.3rem;
    }
    .orch-toggle-btn {
      background: transparent;
      border: none;
      padding: 0.3rem 0.9rem;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      color: var(--text-dim, #A69E94);
      transition: all 0.15s;
    }
    .orch-toggle-btn:hover { background: rgba(122,112,103,0.08); }
    .orch-toggle-btn.active {
      background: var(--blue, #5B8DB8);
      color: #fff;
    }

    /* ── Return Conditions Summary Card ── */
    .orch-rc-summary-card {
      background: rgba(122,112,103,0.03);
      border: 1px solid rgba(122,112,103,0.12);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 0.25rem;
    }
    .orch-rc-summary-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid rgba(122,112,103,0.08);
    }
    .orch-rc-summary-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--text, #2D2A26);
      display: block;
      margin-bottom: 0.15rem;
    }
    .orch-rc-summary-desc {
      font-size: 0.72rem;
      color: var(--text-dim, #A69E94);
      line-height: 1.4;
    }
    .orch-rc-summary-desc code {
      font-size: 0.7rem;
      background: rgba(91,141,184,0.08);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      color: var(--blue, #5B8DB8);
    }
    .orch-rc-configure-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.3rem 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--blue, #5B8DB8);
      background: rgba(91,141,184,0.08);
      border: 1px solid rgba(91,141,184,0.2);
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .orch-rc-configure-btn:hover {
      background: rgba(91,141,184,0.15);
      border-color: rgba(91,141,184,0.35);
    }
    .orch-rc-summary-body {
      padding: 0.5rem 0.75rem;
    }

    /* ── Return Conditions Summary Rows ── */
    .orch-rc-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.3rem 0;
      font-size: 0.8rem;
    }
    .orch-rc-row + .orch-rc-row {
      border-top: 1px solid rgba(122,112,103,0.06);
    }
    .orch-rc-condition {
      flex: 1;
      color: var(--text, #2D2A26);
      line-height: 1.35;
    }
    .orch-rc-arrow {
      color: var(--text-dim, #A69E94);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }
    .orch-rc-value-badge {
      display: inline-block;
      background: linear-gradient(135deg, rgba(91,141,184,0.1) 0%, rgba(91,141,184,0.06) 100%);
      color: var(--blue, #5B8DB8);
      border: 1px solid rgba(91,141,184,0.2);
      border-radius: 12px;
      padding: 0.15rem 0.55rem;
      font-size: 0.73rem;
      font-weight: 600;
      font-family: monospace;
      white-space: nowrap;
    }
    .orch-rc-empty {
      font-size: 0.8rem;
      color: var(--text-dim, #A69E94);
      font-style: italic;
      padding: 0.3rem 0;
    }

    /* ── Return Conditions Modal ── */
    .orch-rc-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 250;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: orchRcFadeIn 0.15s ease-out;
    }
    @keyframes orchRcFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .orch-rc-modal-card {
      background: var(--bg-card, #FFF);
      border-radius: 16px;
      box-shadow: 0 16px 56px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.08);
      max-width: 720px;
      width: 96%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      animation: orchRcSlideUp 0.2s ease-out;
    }
    @keyframes orchRcSlideUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .orch-rc-modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 1rem 1.25rem 0.85rem;
      border-bottom: 1px solid rgba(122,112,103,0.1);
    }
    .orch-rc-modal-header-text {
      flex: 1;
      min-width: 0;
    }
    .orch-rc-modal-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text, #2D2A26);
      display: block;
      margin-bottom: 0.2rem;
    }
    .orch-rc-modal-subtitle {
      font-size: 0.78rem;
      color: var(--text-dim, #A69E94);
      line-height: 1.35;
    }
    .orch-rc-modal-close {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-dim, #A69E94);
      background: rgba(122,112,103,0.06);
      border: 1px solid rgba(122,112,103,0.15);
      cursor: pointer;
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
      transition: all 0.15s;
      flex-shrink: 0;
      margin-left: 0.75rem;
    }
    .orch-rc-modal-close:hover {
      background: rgba(122,112,103,0.12);
      border-color: rgba(122,112,103,0.25);
      color: var(--text, #2D2A26);
    }

    /* ── Modal Guide Section (always visible, outside scroll) ── */
    .orch-rc-modal-guide {
      background: rgba(91,141,184,0.04);
      border-bottom: 1px solid rgba(91,141,184,0.1);
      padding: 0.6rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .orch-rc-modal-guide-row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      font-size: 0.78rem;
      line-height: 1.4;
    }
    .orch-rc-modal-guide-label {
      font-weight: 700;
      color: var(--blue, #5B8DB8);
      white-space: nowrap;
      min-width: 3.2rem;
    }
    .orch-rc-modal-guide-desc {
      color: var(--text-dim, #A69E94);
    }
    .orch-rc-modal-guide-desc code {
      font-size: 0.72rem;
      background: rgba(91,141,184,0.08);
      padding: 0.1rem 0.3rem;
      border-radius: 3px;
      color: var(--blue, #5B8DB8);
    }

    /* ── Modal Body ── */
    .orch-rc-modal-body {
      padding: 0.85rem 1.25rem;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .orch-rc-entries {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    /* ── Condition Entry Row ── */
    .orch-rc-entry {
      background: rgba(122,112,103,0.025);
      border: 1px solid rgba(122,112,103,0.12);
      border-radius: 10px;
      padding: 0.75rem 0.85rem 0.6rem;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .orch-rc-entry:hover {
      border-color: rgba(122,112,103,0.22);
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .orch-rc-entry-fields {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .orch-rc-condition-input { flex: 2; }
    .orch-rc-condition-input label,
    .orch-rc-value-input label {
      font-size: 0.68rem;
      font-weight: 700;
      color: var(--text-dim, #A69E94);
      margin-bottom: 4px;
      display: block;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .orch-rc-condition-input textarea {
      font-size: 0.82rem;
      resize: vertical;
      min-height: 3.2rem;
    }
    .orch-rc-arrow-col {
      display: flex;
      align-items: center;
      padding-top: 1.4rem;
      color: var(--text-dim, #A69E94);
      flex-shrink: 0;
    }
    .orch-rc-value-input { flex: 1; }
    .orch-rc-value-input input {
      font-size: 0.82rem;
      font-family: monospace;
    }
    .orch-rc-entry-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 0.4rem;
    }
    .orch-rc-delete-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.55rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: #c62828;
      background: rgba(198,40,40,0.05);
      border: 1px solid rgba(198,40,40,0.15);
      border-radius: 5px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .orch-rc-delete-btn:hover {
      background: rgba(198,40,40,0.1);
      border-color: rgba(198,40,40,0.3);
    }
    .orch-rc-delete-btn svg {
      flex-shrink: 0;
    }

    /* ── Entry Validation Error ── */
    .orch-rc-entry-invalid {
      border-color: rgba(198,40,40,0.35);
      background: rgba(198,40,40,0.03);
    }
    .orch-rc-entry-error {
      font-size: 0.72rem;
      color: #c62828;
      margin-top: 0.3rem;
      padding: 0.2rem 0.4rem;
      line-height: 1.35;
    }

    /* ── Modal Footer ── */
    .orch-rc-modal-footer {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      border-top: 1px solid rgba(122,112,103,0.1);
    }
    .orch-rc-add-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.35rem 0.7rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-dim, #A69E94);
      background: transparent;
      border: 1px dashed rgba(122,112,103,0.25);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .orch-rc-add-btn:hover {
      color: var(--blue, #5B8DB8);
      border-color: rgba(91,141,184,0.3);
      background: rgba(91,141,184,0.04);
    }
    /* orch-rc-cancel-btn / orch-rc-save-btn removed — uses shared .btn / .btn.btn-primary-solid */

    /* ── Output Port Labels ── */
    .dag-port-label {
      font-size: 12px; fill: var(--text-muted, #7A7067);
      pointer-events: none; dominant-baseline: middle;
      font-weight: 500;
    }
    .dag-port-label-inner {
      font-size: 12px; pointer-events: none;
      font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Status Lamp + Validation Text (header inline) ── */
    .orch-status-group {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-right: auto;
      min-width: 0;
      overflow: hidden;
    }
    .orch-status-lamp {
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 50%;
      background: var(--gray-neutral);
      box-shadow: 0 0 0 2px rgba(0,0,0,0.08);
      transition: background 0.3s, box-shadow 0.3s;
      flex-shrink: 0;
    }
    .orch-status-lamp.active {
      background: var(--green);
      box-shadow: 0 0 6px rgba(76,175,80,0.6), 0 0 0 2px rgba(76,175,80,0.2);
    }
    .orch-status-lamp.dirty {
      background: var(--yellow);
      box-shadow: 0 0 6px rgba(245,158,11,0.5), 0 0 0 2px rgba(245,158,11,0.2);
    }
    .orch-status-lamp.error {
      background: var(--red);
      box-shadow: 0 0 6px rgba(192,57,43,0.5), 0 0 0 2px rgba(192,57,43,0.2);
    }
    .orch-validation-text {
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: rgba(240,237,232,0.6);
    }
    .orch-validation-text .vbar-ok { color: #81C784; }
    .orch-validation-text .vbar-warn { color: #FFD54F; }
    .orch-validation-text .vbar-err { color: #EF9A9A; }
    .orch-validation-text .vbar-err-count { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
    .orch-validation-text .vbar-err-count:hover { color: #FFCDD2; }

    /* ── Error Log Panel (above Run History) ── */
    .orch-error-log {
      margin: 1.2rem 0 0;
      border: 1px solid rgba(192,57,43,0.22);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(254,249,246,0.97) 100%);
      box-shadow: 0 8px 24px rgba(192,57,43,0.06), 0 2px 8px rgba(44,44,44,0.03);
      overflow: hidden;
      animation: orch-error-log-in 0.25s ease-out;
    }
    @keyframes orch-error-log-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .orch-error-log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.65rem 1rem;
      background: linear-gradient(135deg, rgba(192,57,43,0.07) 0%, rgba(192,57,43,0.03) 100%);
      border-bottom: 1px solid rgba(192,57,43,0.12);
    }
    .orch-error-log-title-wrap {
      display: flex;
      align-items: center;
      gap: 0.55rem;
    }
    .orch-error-log-icon {
      width: 1.7rem;
      height: 1.7rem;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(192,57,43,0.12);
      color: var(--red);
      border: 1px solid rgba(192,57,43,0.2);
      flex-shrink: 0;
    }
    .orch-error-log-title {
      margin: 0;
      font-size: 0.88rem;
      font-weight: 600;
      color: #7B2D26;
    }
    .orch-error-log-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.3rem;
      height: 1.3rem;
      padding: 0 0.4rem;
      border-radius: 999px;
      background: rgba(192,57,43,0.14);
      color: var(--red);
      font-size: 0.72rem;
      font-weight: 700;
      margin-left: 0.35rem;
    }
    .orch-error-log-dismiss {
      background: none;
      border: 1px solid rgba(192,57,43,0.15);
      border-radius: 6px;
      color: #99625B;
      font-size: 0.72rem;
      padding: 0.2rem 0.55rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .orch-error-log-dismiss:hover {
      background: rgba(192,57,43,0.08);
      border-color: rgba(192,57,43,0.3);
      color: #7B2D26;
    }
    .orch-error-log-body {
      padding: 0.5rem 0.75rem;
      max-height: 180px;
      overflow-y: auto;
    }
    .orch-error-log-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.4rem 0.35rem;
      border-radius: 6px;
      font-size: 0.78rem;
      color: #5D3A36;
      line-height: 1.45;
      transition: background 0.12s;
    }
    .orch-error-log-item:not(:last-child) {
      border-bottom: 1px solid rgba(192,57,43,0.07);
    }
    .orch-error-log-item:hover {
      background: rgba(192,57,43,0.04);
    }
    .orch-error-log-item-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #E57373;
      flex-shrink: 0;
      margin-top: 0.38rem;
    }
    .orch-error-log-item-text {
      min-width: 0;
    }

    /* ── Fullscreen mode ── */
    body.orch-fullscreen .sidebar { display: none; }
    body.orch-fullscreen .main { width: 100vw; }

    /* ── Run History Section ── */
    .orch-runs-drawer {
      margin: 1.9rem 0 1.35rem;
      border: 1px solid rgba(184,151,90,0.25);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(250,247,242,0.96) 100%);
      box-shadow: 0 16px 40px rgba(44,44,44,0.08), 0 3px 10px rgba(44,44,44,0.04);
      overflow: hidden;
    }
    .orch-runs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.85rem 1rem;
      background: linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(245,241,232,0.92) 100%);
      border-bottom: 1px solid rgba(184,151,90,0.18);
    }
    .orch-runs-title-wrap {
      display: flex;
      align-items: center;
      gap: 0.62rem;
      min-width: 0;
    }
    .orch-runs-title-icon {
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(184,151,90,0.15);
      color: #7B5E2B;
      border: 1px solid rgba(184,151,90,0.26);
      flex-shrink: 0;
    }
    .orch-runs-title-copy h3 {
      margin: 0;
      font-size: 0.96rem;
      line-height: 1.2;
      font-weight: 700;
      color: #2f2a24;
    }
    .orch-runs-title-copy p {
      margin: 0.12rem 0 0;
      font-size: 0.74rem;
      color: #7e7469;
    }
    .orch-runs-actions {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .orch-runs-actions .btn { white-space: nowrap; }
    .orch-runs-btn {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.74rem;
      letter-spacing: 0.02em;
      font-weight: 600;
      border-radius: 999px;
      padding: 0.34rem 0.72rem;
      gap: 0.35rem;
    }
    .orch-runs-btn svg {
      width: 12px;
      height: 12px;
      stroke-width: 2.1;
      flex-shrink: 0;
    }
    .orch-runs-btn-ghost {
      background: rgba(255,255,255,0.78);
      color: #5f5448;
      border: 1px solid rgba(184,151,90,0.3);
    }
    .orch-runs-btn-ghost:hover {
      background: rgba(255,255,255,0.95);
      border-color: rgba(184,151,90,0.5);
      color: #4a4036;
    }
    .orch-runs-btn-primary {
      color: #9b7637;
      border: 1px solid rgba(184,151,90,0.48);
      background: linear-gradient(135deg, rgba(184,151,90,0.26) 0%, rgba(184,151,90,0.18) 100%);
      box-shadow: 0 2px 10px rgba(184,151,90,0.14);
    }
    .orch-runs-btn-primary:hover {
      border-color: rgba(184,151,90,0.65);
      background: linear-gradient(135deg, rgba(184,151,90,0.38) 0%, rgba(184,151,90,0.26) 100%);
      box-shadow: 0 4px 14px rgba(184,151,90,0.22);
    }
    .orch-runs-body {
      max-height: 420px;
      overflow: auto;
      padding: 0.82rem 1rem 1rem;
      background: linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(248,245,239,0.75) 100%);
    }
    .orch-runs-empty {
      margin: 0;
      min-height: 110px;
      border: 1px dashed rgba(184,151,90,0.25);
      border-radius: 10px;
      background: rgba(255,255,255,0.85);
      color: var(--text-muted);
    }
    .orch-runs-table-wrap {
      min-width: 740px;
    }
    .orch-runs-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0 0.45rem;
      font-size: 0.82rem;
    }
    .orch-runs-table thead th {
      padding: 0.45rem 0.62rem;
      border-bottom: 1px solid rgba(44,44,44,0.08);
      background: rgba(248,244,238,0.97);
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      color: #847a6f;
    }
    .orch-runs-table td {
      padding: 0.6rem 0.68rem;
      border-bottom: none;
      background: var(--bg-card);
      box-shadow: inset 0 -1px 0 rgba(0,0,0,0.03);
    }
    .orch-runs-table tbody tr:nth-child(even) td {
      background: var(--bg-card);
    }
    .orch-runs-table tbody tr:hover td {
      background: rgba(184,151,90,0.08);
    }
    .orch-runs-table tbody tr td:first-child {
      border-radius: 10px 0 0 10px;
      border-left: 1px solid rgba(44,44,44,0.06);
    }
    .orch-runs-table tbody tr td:last-child {
      border-radius: 0 10px 10px 0;
      border-right: 1px solid rgba(44,44,44,0.06);
    }
    .orch-runs-table code {
      background: rgba(44,44,44,0.06);
      border-radius: 6px;
      padding: 0.1rem 0.4rem;
      font-size: 0.78rem;
    }
    .orch-run-detail-view h3 {
      margin: 0 0 0.7rem;
      font-size: 0.96rem;
      color: #2f2a24;
    }
    .orch-run-detail-actions {
      margin-top: 0.7rem;
      display: flex;
      justify-content: flex-end;
    }
    @media (max-width: 900px) {
      .orch-runs-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .orch-runs-actions {
        width: 100%;
      }
      .orch-runs-btn {
        flex: 1;
        justify-content: center;
      }
      .orch-runs-body {
        max-height: 360px;
        padding: 0.68rem 0.75rem 0.85rem;
      }
      .orch-runs-table-wrap {
        min-width: 660px;
      }
    }

    /* ══════════════════════════════════════════════
       DAG Editor
       ══════════════════════════════════════════════ */
    .dag-editor-container {
      position: relative; border: 1px solid var(--border);
      border-radius: 10px; background: var(--bg-card); overflow: hidden; min-height: 400px;
    }
    .dag-editor-toolbar { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }

    /* ── Nodes ── */
    .dag-node rect, .dag-node polygon {
      cursor: grab; transition: filter 0.2s;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.08));
    }
    /* Hover / selected — stroke is in inline style (via isSel), so only filter here */
    .dag-node-start:hover, .dag-node-start.selected {
      filter: drop-shadow(0 4px 12px rgba(76,175,80,0.25));
    }
    .dag-node-task:hover, .dag-node-task.selected {
      filter: drop-shadow(0 4px 12px rgba(91,141,184,0.25));
    }
    .dag-node-gate:hover, .dag-node-gate.selected {
      filter: drop-shadow(0 4px 12px rgba(249,168,37,0.25));
    }
    .dag-node-triggered:hover, .dag-node-triggered.selected {
      filter: drop-shadow(0 4px 12px rgba(126,87,194,0.25));
    }
    .dag-node-end:hover, .dag-node-end.selected {
      filter: drop-shadow(0 4px 12px rgba(122,112,103,0.25));
    }
    .dag-node-webhook-start:hover, .dag-node-webhook-start.selected {
      filter: drop-shadow(0 4px 12px rgba(124,58,237,0.25));
    }
    .dag-node-start.has-error {
      filter: drop-shadow(0 0 6px rgba(76,175,80,0.45)) drop-shadow(0 0 2px rgba(76,175,80,0.3));
    }
    .dag-node-task.has-error {
      filter: drop-shadow(0 0 6px rgba(91,141,184,0.45)) drop-shadow(0 0 2px rgba(91,141,184,0.3));
    }
    .dag-node-gate.has-error {
      filter: drop-shadow(0 0 6px rgba(249,168,37,0.45)) drop-shadow(0 0 2px rgba(249,168,37,0.3));
    }
    .dag-node-triggered.has-error {
      filter: drop-shadow(0 0 6px rgba(126,87,194,0.45)) drop-shadow(0 0 2px rgba(126,87,194,0.3));
    }
    .dag-node-end.has-error {
      filter: drop-shadow(0 0 6px rgba(122,112,103,0.45)) drop-shadow(0 0 2px rgba(122,112,103,0.3));
    }
    .dag-node-webhook-start.has-error {
      filter: drop-shadow(0 0 6px rgba(124,58,237,0.45)) drop-shadow(0 0 2px rgba(124,58,237,0.3));
    }
    /* has-error + selected: combine error glow with selection emphasis */
    .dag-node.has-error.selected {
      filter: drop-shadow(0 0 6px rgba(192,57,43,0.4)) drop-shadow(0 4px 10px rgba(0,0,0,0.12));
    }
    /* Port disconnection — red stroke handled in JS inline style; shadow via CSS */
    .dag-node.ports-disconnected {
      filter: drop-shadow(0 2px 6px rgba(192,57,43,0.3));
    }
    .dag-node.ports-disconnected:hover,
    .dag-node.ports-disconnected.selected {
      filter: drop-shadow(0 4px 12px rgba(192,57,43,0.35));
    }
    /* A11y: keyboard focus ring for nodes */
    .dag-node.focused {
      filter: drop-shadow(0 0 4px var(--accent, #B8975A)) drop-shadow(0 0 10px rgba(184,151,90,0.45));
    }
    .dag-node.focused.ports-disconnected {
      filter: drop-shadow(0 0 4px var(--accent, #B8975A)) drop-shadow(0 2px 6px rgba(192,57,43,0.3));
    }
    .dag-node:focus { outline: none; }
    .dag-node .dag-label {
      pointer-events: none; font-size: 12px; fill: var(--text);
      font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .dag-node .dag-sublabel {
      pointer-events: none; font-size: 12px; fill: var(--text-muted);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* ── Ports ── */
    .dag-port-in, .dag-port-out {
      cursor: crosshair; fill: #fff; stroke: var(--border); stroke-width: 1.5;
      transition: fill 0.15s, stroke 0.15s, r 0.15s;
    }
    .dag-port-in:hover, .dag-port-out:hover { fill: var(--accent); stroke: var(--accent); }

    /* ── Edges ── */
    .dag-edge { cursor: pointer; }
    .dag-edge .dag-edge-visible { transition: stroke 0.15s; }
    .dag-edge:hover .dag-edge-visible { stroke: var(--accent); stroke-width: 2.5; }
    .dag-edge.selected .dag-edge-visible { stroke: var(--accent); stroke-width: 2.5; }
    .dag-edge-label {
      font-size: 12px; fill: var(--text-muted); pointer-events: all; cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .dag-edge-label:hover { fill: var(--accent); }
    .dag-drag-edge { fill: none; stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 4; opacity: 0.7; }

    /* ── Context Menu ── */
    .dag-ctx-menu {
      position: fixed; z-index: 9100; background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      min-width: 180px; padding: 6px; display: none;
    }
    .dag-ctx-menu-item {
      padding: 7px 12px; font-size: 0.82rem; cursor: pointer; color: var(--text);
      border-radius: 6px; transition: background 0.12s;
    }
    .dag-ctx-menu-item:hover { background: rgba(184,151,90,0.08); }
    .dag-ctx-menu-item.danger { color: var(--red, #C0392B); }
    .dag-ctx-menu-item.danger:hover { background: rgba(192,57,43,0.06); }
    .dag-ctx-menu-sep { height: 1px; background: var(--border); margin: 4px 6px; }

    /* ── Minimap ── */
    .dag-minimap {
      position: absolute; bottom: 12px; right: 12px; width: 160px; height: 100px;
      border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,0.9);
      backdrop-filter: blur(8px);
      opacity: 0.9; overflow: hidden; pointer-events: all; cursor: grab;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      transition: opacity 0.2s;
    }
    .dag-minimap:hover { opacity: 1; }
    .dag-minimap.dragging { cursor: grabbing; }
    .dag-minimap-viewport { fill: var(--accent); opacity: 0.15; stroke: var(--accent); stroke-width: 1; }

    /* ── Validation Panel ── */
    .dag-validation-panel {
      position: absolute; bottom: 12px; left: 12px; max-width: 320px; max-height: 120px;
      overflow-y: auto; font-size: 12px; background: rgba(255,255,255,0.92);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .dag-validation-error { color: var(--red, #C0392B); padding: 2px 0; }
    .dag-validation-warning { color: var(--yellow, #D4A017); padding: 2px 0; }

    /* ── Inline Condition Editor ── */
    .dag-inline-edit {
      position: fixed; z-index: 9100; background: var(--bg-card); border: 1px solid var(--border);
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      padding: 10px 14px; display: none; min-width: 260px;
    }
    .dag-inline-edit input, .dag-inline-edit select { font-size: 12px; padding: 5px 8px; border-radius: 6px; }

    /* ── DAG Stats ── */
    .vbar-stats {
      color: rgba(240,237,232,0.45);
      font-size: 0.7rem;
      font-weight: 400;
      letter-spacing: 0.01em;
      margin-left: 4px;
    }

    /* ── Keyboard Shortcuts Overlay ── */
    .dag-shortcuts-overlay {
      position: fixed; inset: 0; z-index: 9200;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      animation: dagShortcutsIn 0.15s ease-out;
    }
    @keyframes dagShortcutsIn {
      from { opacity: 0; } to { opacity: 1; }
    }
    .dag-shortcuts-panel {
      background: var(--bg-card); border-radius: 14px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08);
      min-width: 340px; max-width: 420px;
      overflow: hidden;
      animation: dagShortcutsPanelIn 0.2s ease-out;
    }
    @keyframes dagShortcutsPanelIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .dag-shortcuts-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px; border-bottom: 1px solid var(--border);
    }
    .dag-shortcuts-title {
      font-size: 0.95rem; font-weight: 600; color: var(--text);
    }
    .dag-shortcuts-close {
      background: none; border: none; font-size: 1.4rem; cursor: pointer;
      color: var(--text-muted); line-height: 1; padding: 0 4px;
    }
    .dag-shortcuts-close:hover { color: var(--text); }
    .dag-shortcuts-body {
      padding: 12px 18px 18px;
    }
    .dag-shortcuts-group {
      margin-bottom: 10px;
    }
    .dag-shortcuts-group:last-child { margin-bottom: 0; }
    .dag-shortcut-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 0; font-size: 0.82rem; color: var(--text);
    }
    .dag-shortcut-row kbd {
      display: inline-block;
      padding: 2px 7px; font-size: 0.73rem; font-family: inherit;
      background: var(--bg-muted, #f4f1ec); border: 1px solid var(--border);
      border-radius: 5px; color: var(--text-dim); font-weight: 500;
      min-width: 22px; text-align: center;
    }
    .dag-shortcut-row span { color: var(--text-muted); }

    /* ── Lasso Selection ── */
    .dag-lasso {
      fill: rgba(37, 99, 235, 0.08);
      stroke: #2563eb;
      stroke-width: 1;
      stroke-dasharray: 4 3;
      pointer-events: none;
    }

    /* ── Connectable Port Highlighting ── */
    @keyframes dagPortPulse {
      from { opacity: 0.7; }
      to { opacity: 1; }
    }
    .dag-port-in.connectable {
      r: 8;
      fill: rgba(37, 99, 235, 0.2);
      stroke: #2563eb;
      stroke-width: 2;
      filter: drop-shadow(0 0 5px rgba(37, 99, 235, 0.5));
      animation: dagPortPulse 0.8s ease-in-out infinite alternate;
    }

    /* ── Undo/Redo Toolbar ── */
    .orch-undo-redo-group {
      display: flex;
      gap: 0.2rem;
    }
    .orch-toolbar-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }

    /* ── Run Status Effects ── */
    /* Status indicated via filter glow only — base fill/stroke use inline style and must not be overridden */
    .dag-node.status-running {
      filter: drop-shadow(0 0 6px rgba(91,141,184,0.5)) drop-shadow(0 2px 10px rgba(91,141,184,0.3));
      animation: dagNodePulse 1.8s ease-in-out infinite;
    }
    .dag-node.status-completed {
      filter: drop-shadow(0 0 6px rgba(76,175,80,0.45)) drop-shadow(0 2px 10px rgba(76,175,80,0.25));
    }
    .dag-node.status-failed {
      filter: drop-shadow(0 0 6px rgba(192,57,43,0.5)) drop-shadow(0 2px 10px rgba(192,57,43,0.3));
    }
    .dag-node.status-skipped {
      filter: drop-shadow(0 0 4px rgba(156,163,175,0.3));
      opacity: 0.65;
    }
    .dag-node.status-cancelled {
      filter: drop-shadow(0 0 4px rgba(212,160,23,0.4));
      opacity: 0.7;
    }
    .dag-node.status-waiting {
      filter: drop-shadow(0 0 6px rgba(167,139,250,0.45)) drop-shadow(0 2px 10px rgba(167,139,250,0.25));
      animation: dagNodePulse 2.4s ease-in-out infinite;
    }
    @keyframes dagNodePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* Active card: white + light green tint */
    .sched-card-active { border-left: 3px solid var(--green); background: var(--bg-card); }
    .sched-card-active .sched-card-header { color: var(--green-dark); background: rgba(76,175,80,0.08); }
    .sched-card-active .sched-section-count { background: rgba(76,175,80,0.14); color: var(--green-dark); }
    /* Archive card: white + light gray tint */
    .sched-card-archive { border-left: 3px solid var(--gray-border); background: var(--bg-card); }
    .sched-card-archive .sched-card-header { color: var(--gray-mid); background: rgba(160,160,160,0.1); }
    .sched-card-archive .sched-section-count { background: rgba(160,160,160,0.18); color: var(--gray-mid); }

    /* ── Orchestrator Guide Modal ── */
    .orch-guide-content {
      min-width: 900px;
      max-width: 1200px;
      width: min(92vw, 1180px);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(184,151,90,0.35);
      border-radius: 16px;
      background: linear-gradient(155deg, rgba(255,255,255,0.96) 0%, rgba(248,244,237,0.96) 100%);
      box-shadow: 0 24px 64px rgba(30,30,30,0.28), 0 5px 18px rgba(44,44,44,0.12);
    }
    .orch-guide-header {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.95rem 1.1rem;
      border-bottom: 1px solid rgba(184,151,90,0.24);
      background: linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(243,236,225,0.9) 100%);
      flex-shrink: 0;
    }
    .orch-guide-title {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
      flex: 1;
    }
    .orch-guide-title-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #7a5d2f;
      background: linear-gradient(145deg, rgba(184,151,90,0.26) 0%, rgba(184,151,90,0.14) 100%);
      border: 1px solid rgba(184,151,90,0.34);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 8px rgba(184,151,90,0.12);
      flex-shrink: 0;
    }
    .orch-guide-title-copy {
      min-width: 0;
    }
    .orch-guide-title-copy h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: #2f2a24;
      letter-spacing: -0.01em;
      line-height: 1.15;
    }
    .orch-guide-title-copy p {
      margin: 0.18rem 0 0;
      font-size: 0.75rem;
      color: #7b7065;
      line-height: 1.35;
    }
    .orch-guide-search-wrap {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      width: clamp(260px, 32vw, 390px);
      padding: 0 0.6rem;
      border-radius: 999px;
      border: 1px solid rgba(184,151,90,0.34);
      background: var(--bg-card);
      box-shadow: inset 0 1px 2px rgba(44,44,44,0.06);
    }
    .orch-guide-search-icon {
      color: #92764a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .orch-guide-search-input {
      width: 100%;
      border: none;
      outline: none;
      background: transparent;
      box-shadow: none;
      padding: 0.48rem 0;
      font-size: 0.8rem;
      color: #2f2a24;
    }
    .orch-guide-search-input:focus {
      border: none;
      box-shadow: none;
      background: transparent;
    }
    .orch-guide-close-btn {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0;
      text-align: center;
      border-radius: 999px;
      min-width: 94px;
      height: 36px;
      padding: 0 1rem;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: #2f2a24;
      border-color: rgba(184,151,90,0.3);
      background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(243,236,225,0.88) 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.74), 0 1px 2px rgba(44,44,44,0.08);
    }
    .orch-guide-close-btn > span {
      display: inline-block;
      width: 100%;
      text-align: center;
    }
    .orch-guide-close-btn:hover {
      border-color: rgba(184,151,90,0.45);
      background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(239,231,217,0.96) 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 8px rgba(184,151,90,0.18);
    }
    .orch-guide-close-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px rgba(184,151,90,0.24), inset 0 1px 0 rgba(255,255,255,0.75);
    }
    .orch-guide-layout {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      background: linear-gradient(180deg, rgba(251,248,243,0.94) 0%, rgba(246,242,235,0.86) 100%);
    }
    .orch-guide-nav {
      padding: 0.85rem 0.75rem;
      overflow-y: auto;
      border-right: 1px solid rgba(184,151,90,0.2);
      background: linear-gradient(180deg, rgba(252,249,244,0.95) 0%, rgba(244,237,227,0.9) 100%);
    }
    .guide-nav-item {
      width: 100%;
      display: flex;
      align-items: flex-start;
      gap: 0.58rem;
      padding: 0.62rem 0.66rem;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      color: #64584c;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .guide-nav-item + .guide-nav-item {
      margin-top: 0.35rem;
    }
    .guide-nav-item:hover {
      background: rgba(184,151,90,0.08);
      border-color: rgba(184,151,90,0.2);
      transform: translateX(2px);
    }
    .guide-nav-item.active {
      background: linear-gradient(135deg, rgba(184,151,90,0.18) 0%, rgba(184,151,90,0.08) 100%);
      border-color: rgba(184,151,90,0.34);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 2px 10px rgba(184,151,90,0.14);
    }
    .guide-nav-icon {
      width: 1.65rem;
      height: 1.65rem;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(184,151,90,0.24);
      color: #7c643a;
      flex-shrink: 0;
    }
    .guide-nav-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.06rem;
    }
    .guide-nav-title {
      font-size: 0.79rem;
      font-weight: 700;
      color: #3b342d;
      line-height: 1.3;
    }
    .guide-nav-summary {
      font-size: 0.68rem;
      color: #8d8072;
      line-height: 1.35;
    }
    .orch-guide-body {
      padding: 0.92rem 1rem 1.2rem;
      overflow-y: auto;
      font-size: 0.85rem;
      line-height: 1.68;
      min-height: 0;
    }
    .guide-section {
      border: 1px solid rgba(184,151,90,0.24);
      border-radius: 14px;
      padding: 0.88rem 0.95rem 0.95rem;
      background: linear-gradient(150deg, rgba(255,255,255,0.95) 0%, rgba(250,246,240,0.9) 100%);
      box-shadow: 0 2px 10px rgba(44,44,44,0.04);
      transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
    }
    .guide-section + .guide-section {
      margin-top: 0.75rem;
    }
    .guide-section:hover {
      border-color: rgba(184,151,90,0.38);
      box-shadow: 0 6px 16px rgba(44,44,44,0.08);
      transform: translateY(-1px);
    }
    .guide-section-head {
      display: flex;
      align-items: flex-start;
      gap: 0.62rem;
      margin-bottom: 0.58rem;
    }
    .guide-section-icon {
      width: 1.95rem;
      height: 1.95rem;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(184,151,90,0.14);
      border: 1px solid rgba(184,151,90,0.25);
      color: #765c30;
      flex-shrink: 0;
    }
    .guide-section-title-wrap {
      min-width: 0;
    }
    .guide-section-title-wrap h3 {
      margin: 0;
      font-size: 0.96rem;
      font-weight: 700;
      color: #2f2a24;
      letter-spacing: -0.01em;
      line-height: 1.25;
    }
    .guide-section-summary {
      margin: 0.2rem 0 0;
      color: #7f7367;
      font-size: 0.73rem;
      line-height: 1.4;
    }
    .guide-section-body h4 {
      font-size: 0.82rem;
      font-weight: 700;
      color: #8d6d37;
      margin: 0.72rem 0 0.28rem;
    }
    .guide-section-body p {
      margin: 0.24rem 0 0.56rem;
      color: #3e372f;
    }
    .guide-section-body ul,
    .guide-section-body ol {
      margin: 0.14rem 0 0.58rem 1.08rem;
      padding: 0;
    }
    .guide-section-body li {
      margin-bottom: 0.28rem;
    }
    .guide-section-body code {
      background: rgba(44,44,44,0.06);
      border: 1px solid rgba(44,44,44,0.07);
      padding: 0.1rem 0.36rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-family: var(--font-mono);
      color: #312c26;
    }
    .guide-section-body table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin: 0.38rem 0 0.66rem;
      font-size: 0.79rem;
      border: 1px solid rgba(184,151,90,0.2);
      border-radius: 10px;
      overflow: hidden;
    }
    .guide-section-body th {
      text-align: left;
      padding: 0.46rem 0.6rem;
      background: linear-gradient(180deg, rgba(184,151,90,0.16) 0%, rgba(184,151,90,0.09) 100%);
      border-bottom: 1px solid rgba(184,151,90,0.24);
      font-weight: 700;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.045em;
      color: #7d6539;
    }
    .guide-section-body td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid rgba(44,44,44,0.06);
      vertical-align: top;
      color: #3f382f;
    }
    .guide-section-body tr:last-child td {
      border-bottom: none;
    }
    .guide-hidden {
      display: none !important;
    }
    .guide-section-body .guide-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.12rem 0.54rem;
      border-radius: 999px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .guide-badge-green { background: rgba(76,175,80,0.12); color: #2E7D32; }
    .guide-badge-blue { background: rgba(91,141,184,0.12); color: #1565C0; }
    .guide-badge-yellow { background: rgba(249,168,37,0.12); color: #F57F17; }
    .guide-badge-gray { background: rgba(122,112,103,0.12); color: #5D4E37; }
    .guide-section-body .guide-kbd {
      display: inline-block;
      background: var(--bg-card);
      border: 1px solid rgba(184,151,90,0.35);
      border-radius: 6px;
      padding: 0.03rem 0.36rem;
      font-size: 0.72rem;
      font-weight: 600;
      font-family: var(--font-mono);
      box-shadow: 0 1px 0 rgba(184,151,90,0.28);
    }
    .guide-callout {
      border: 1px dashed rgba(184,151,90,0.48);
      background: rgba(184,151,90,0.08);
      border-radius: 10px;
      padding: 0.55rem 0.72rem;
      margin: 0.36rem 0 0.64rem;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .guide-no-results {
      text-align: center;
      padding: 2rem 0.5rem;
      color: var(--text-dim);
      font-style: italic;
    }
    @media (max-width: 1100px) {
      .orch-guide-content {
        min-width: auto;
        width: 95vw;
      }
      .orch-guide-layout {
        grid-template-columns: 238px minmax(0, 1fr);
      }
      .guide-nav-summary {
        display: none;
      }
    }
    @media (max-width: 820px) {
      .orch-guide-content {
        width: 96vw;
        max-height: 92vh;
      }
      .orch-guide-header {
        flex-wrap: wrap;
        align-items: flex-start;
      }
      .orch-guide-title {
        width: 100%;
      }
      .orch-guide-search-wrap {
        width: 100%;
        margin-left: 0;
      }
      .orch-guide-close-btn {
        margin-left: 0;
      }
      .orch-guide-layout {
        grid-template-columns: 1fr;
      }
      .orch-guide-nav {
        border-right: none;
        border-bottom: 1px solid rgba(184,151,90,0.2);
        display: flex;
        gap: 0.46rem;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 0.68rem 0.74rem;
      }
      .guide-nav-item {
        min-width: 210px;
        margin-top: 0;
        flex: 0 0 auto;
      }
      .guide-nav-item + .guide-nav-item {
        margin-top: 0;
      }
      .guide-nav-summary {
        display: none;
      }
      .orch-guide-body {
        padding: 0.82rem 0.74rem 0.9rem;
      }
      .guide-section {
        padding: 0.78rem 0.8rem 0.86rem;
      }
    }

    /* ── Orchestrator Runs Page ── */
    .orch-runs-page {
      display: none;
      flex-direction: column;
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: linear-gradient(145deg, #f8f6f2 0%, #ede8df 50%, #e5dfd4 100%);
      overflow: hidden;
    }

    .orch-runs-topbar {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #2C2C2C 0%, #3A3535 100%);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #F0EDE8;
      flex-shrink: 0;
    }
    .orch-runs-topbar h1 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #F0EDE8;
      flex: 1;
    }
    .orch-runs-topbar .btn {
      color: #e0d8cf;
      border-color: rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.08);
    }
    .orch-runs-topbar .btn:hover {
      background: rgba(255,255,255,0.15);
      border-color: rgba(255,255,255,0.25);
    }

    .orch-runs-content {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
    }

    /* Metrics summary cards */
    .orun-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .orun-metric-card {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      border-left: 3px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s;
    }
    .orun-metric-success { border-left-color: #4CAF50; }
    .orun-metric-success .orun-metric-value { color: #3d8b40; }
    .orun-metric-warn { border-left-color: #e67e22; }
    .orun-metric-warn .orun-metric-value { color: #c96b15; }
    .orun-metric-danger { border-left-color: #c0392b; }
    .orun-metric-danger .orun-metric-value { color: #c0392b; }
    .orun-metric-neutral { border-left-color: var(--glass-border); }
    .orun-metric-label {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      opacity: 0.7;
      margin-bottom: 0.35rem;
    }
    .orun-metric-value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.2;
    }
    .orun-metric-sub {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-top: 0.2rem;
    }
    .orun-metric-desc {
      font-size: 0.68rem;
      color: var(--text-dim);
      opacity: 0.6;
      margin-top: 0.4rem;
      line-height: 1.3;
      border-top: 1px solid var(--glass-border);
      padding-top: 0.35rem;
    }

    /* Node failure heatmap */
    .orun-section {
      margin-bottom: 1.5rem;
    }
    .orun-section-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--text);
      margin: 0 0 0.75rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Error Trace section */
    .orun-error-section {
      background: var(--bg-card);
      border: 1px solid rgba(192,57,43,0.15);
      border-top: 3px solid #c0392b;
      border-radius: var(--radius);
      padding: 1.25rem;
      background-image: linear-gradient(180deg, rgba(192,57,43,0.04) 0%, transparent 120px);
    }
    .orun-error-section-title {
      color: #c0392b;
    }
    .orun-error-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.4em;
      padding: 0.1em 0.45em;
      font-size: 0.72rem;
      font-weight: 700;
      background: var(--status-failed);
      color: #fff;
      border-radius: 99px;
      line-height: 1;
    }
    .orun-error-summary-line {
      font-size: 0.78rem;
      color: var(--text-dim);
      margin-bottom: 1rem;
    }
    .orun-error-freq,
    .orun-error-log {
      margin-bottom: 1.25rem;
    }
    .orun-error-freq-title,
    .orun-error-log-title {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.5rem;
    }
    .orun-error-freq-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    .orun-error-freq-table th {
      text-align: left;
      padding: 0.4rem 0.6rem;
      font-weight: 600;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-dim);
      border-bottom: 1px solid var(--glass-border);
    }
    .orun-error-freq-table td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--glass-border);
      vertical-align: top;
    }
    .orun-error-freq-table tbody tr:hover {
      background: rgba(192,57,43,0.04);
    }
    .orun-error-msg-cell code,
    .orun-error-msg-inline {
      font-size: 0.75rem;
      color: #c0392b;
      background: rgba(192,57,43,0.08);
      padding: 0.1em 0.35em;
      border-radius: 3px;
    }
    .orun-error-count-cell {
      font-weight: 700;
      font-family: var(--font-mono);
    }

    /* Error log rows (expandable) */
    .orun-errlog-row {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      margin-bottom: 0.4rem;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .orun-errlog-row:hover {
      border-color: rgba(192,57,43,0.3);
    }
    .orun-errlog-errored { border-left: 3px solid #e67e22; }
    .orun-errlog-failed { border-left: 3px solid #c0392b; }

    .orun-errlog-summary {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.55rem 0.75rem;
      cursor: pointer;
      font-size: 0.8rem;
      background: var(--glass);
      user-select: none;
      transition: background 0.15s;
    }
    .orun-errlog-summary:hover { background: rgba(192,57,43,0.04); }
    .orun-errlog-indicator {
      flex-shrink: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .orun-errlog-node {
      flex-shrink: 0;
      min-width: 80px;
    }
    .orun-errlog-meta {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.72rem;
      color: var(--text-dim);
      font-family: var(--font-mono);
      flex-shrink: 0;
    }
    .orun-errlog-tag {
      display: inline-block;
      padding: 0.1em 0.4em;
      border-radius: 3px;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: rgba(192,57,43,0.1);
      color: #c0392b;
    }
    .orun-errlog-tag-errored,
    .orun-errlog-tag-error { background: rgba(230,126,34,0.12); color: #c96b15; }
    .orun-errlog-tag-failed { background: rgba(192,57,43,0.12); color: #c0392b; }
    .orun-errlog-tag-completed { background: rgba(76,175,80,0.12); color: #3d8b40; }
    .orun-errlog-chevron {
      flex-shrink: 0;
      font-size: 1.1rem;
      color: var(--text-dim);
      transition: transform 0.2s;
    }
    .orun-errlog-row.expanded .orun-errlog-chevron {
      transform: rotate(90deg);
    }

    /* Expandable detail */
    .orun-errlog-detail {
      display: none;
      padding: 0.75rem 1rem 1rem;
      background: rgba(0,0,0,0.015);
      border-top: 1px solid var(--glass-border);
    }
    .orun-errlog-row.expanded .orun-errlog-detail {
      display: block;
    }
    .orun-errlog-detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.5rem 1.25rem;
      margin-bottom: 0.75rem;
    }
    .orun-errlog-field {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .orun-errlog-field-label {
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-dim);
      opacity: 0.7;
    }
    .orun-errlog-field-value {
      font-size: 0.82rem;
      color: var(--text);
    }
    .orun-errlog-field-value code {
      font-size: 0.78rem;
      background: var(--glass);
      padding: 0.1em 0.35em;
      border-radius: 3px;
    }
    .orun-errlog-errmsg,
    .orun-errlog-output {
      margin-top: 0.5rem;
    }
    .orun-errlog-error-kind {
      margin-bottom: 0.3rem;
    }
    .orun-errlog-errmsg pre,
    .orun-errlog-output pre {
      margin: 0.3rem 0 0;
      padding: 0.6rem 0.8rem;
      border-radius: var(--radius);
      font-size: 0.75rem;
      font-family: var(--font-mono);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 300px;
      overflow-y: auto;
    }
    .orun-errlog-errmsg pre {
      background: rgba(192,57,43,0.06);
      border: 1px solid rgba(192,57,43,0.12);
      color: #a93226;
    }
    .orun-errlog-output pre {
      background: rgba(0,0,0,0.04);
      border: 1px solid var(--glass-border);
      color: var(--text);
    }

    .orun-heatmap {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .orun-heatmap-node {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.3rem;
      padding: 0.6rem 0.8rem;
      border-radius: var(--radius);
      background: var(--glass);
      border: 1px solid var(--glass-border);
      min-width: 100px;
      cursor: default;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .orun-heatmap-node:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .orun-heatmap-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--text);
      text-align: center;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .orun-heatmap-bar {
      display: flex;
      width: 80px;
      height: 6px;
      border-radius: 3px;
      overflow: hidden;
      background: var(--border);
    }
    .orun-heatmap-bar-ok { background: var(--status-completed); }
    .orun-heatmap-bar-fail { background: var(--status-failed); }
    .orun-heatmap-bar-skip { background: var(--orange); }
    .orun-heatmap-rate {
      font-size: 0.68rem;
      font-weight: 600;
    }
    .orun-heatmap-rate-good { color: var(--green-dark); }
    .orun-heatmap-rate-warn { color: #e65100; }
    .orun-heatmap-rate-bad { color: var(--red); }

    /* Run timeline */
    .orun-timeline {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .orun-run {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass);
      margin-bottom: 0.5rem;
      box-shadow: var(--shadow-sm);
      overflow: hidden;
      transition: box-shadow var(--transition-fast);
    }
    .orun-run:hover {
      box-shadow: var(--shadow-md);
    }
    .orun-run-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .orun-run-header:hover {
      background: rgba(0,0,0,0.02);
    }
    .orun-run-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .orun-run-status-completed { background: var(--status-completed); }
    .orun-run-status-failed { background: var(--status-failed); }
    .orun-run-status-running { background: var(--status-running); animation: orchPulse 1.5s ease-in-out infinite; }
    .orun-run-status-waiting { background: var(--status-pending); }
    .orun-run-status-skipped { background: var(--yellow); }
    .orun-run-status-cancelled { background: var(--orange); }
    .orun-run-status-pending { background: var(--gray-neutral); }
    .orun-run-status-errored { background: var(--status-failed); }
    .orun-run-status-not_executed { background: var(--gray-border); }
    .orun-run-status-unknown { background: var(--gray-neutral); }
    .orun-run-id {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--accent2);
    }
    .orun-run-label {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text);
      text-transform: capitalize;
    }
    .orun-run-meta {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-left: auto;
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    .orun-run-chevron {
      font-size: 1rem;
      color: var(--text-dim);
      opacity: 0.4;
      transition: transform var(--transition-fast);
      user-select: none;
    }
    .orun-run.expanded .orun-run-chevron {
      transform: rotate(90deg);
    }

    /* Run detail (expanded) */
    .orun-run-detail {
      display: none;
      border-top: 1px solid rgba(0,0,0,0.05);
      background: rgba(0,0,0,0.01);
    }
    .orun-run.expanded .orun-run-detail {
      display: block;
    }

    /* Run error banner */
    .orun-run-error {
      margin: 0.75rem 1rem 0;
      padding: 0.6rem 0.8rem;
      border-radius: 6px;
      background: rgba(192,57,43,0.06);
      border: 1px solid rgba(192,57,43,0.15);
      color: var(--red);
      font-size: 0.8rem;
      font-family: var(--font-mono);
      word-break: break-all;
    }

    /* DAG flow visualization */
    .orun-dag-flow {
      padding: 1rem;
      overflow-x: auto;
    }
    .orun-dag-flow-inner {
      display: flex;
      gap: 0;
      align-items: flex-start;
      min-width: fit-content;
    }
    .orun-dag-column {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      align-items: center;
      min-width: 140px;
    }
    .orun-dag-arrow {
      display: flex;
      align-items: center;
      padding: 0 0.3rem;
      color: var(--text-dim);
      opacity: 0.35;
      font-size: 1.2rem;
      align-self: center;
    }

    .orun-node-card {
      width: 140px;
      border-radius: 8px;
      padding: 0.5rem 0.6rem;
      border: 2px solid transparent;
      font-size: 0.72rem;
      cursor: default;
      position: relative;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    }
    .orun-node-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .orun-node-card-completed {
      background: rgba(76,175,80,0.08);
      border-color: rgba(76,175,80,0.3);
    }
    .orun-node-card-failed {
      background: rgba(192,57,43,0.08);
      border-color: rgba(192,57,43,0.4);
    }
    .orun-node-card-running {
      background: rgba(33,150,243,0.08);
      border-color: rgba(33,150,243,0.4);
      animation: orchPulse 1.5s ease-in-out infinite;
    }
    .orun-node-card-skipped {
      background: rgba(255,152,0,0.06);
      border-color: rgba(255,152,0,0.25);
      opacity: 0.7;
    }
    .orun-node-card-pending, .orun-node-card-waiting {
      background: rgba(0,0,0,0.02);
      border-color: rgba(0,0,0,0.08);
      opacity: 0.5;
    }
    .orun-node-card-errored {
      background: rgba(192,57,43,0.06);
      border-color: rgba(192,57,43,0.35);
    }
    .orun-node-card-not_executed {
      background: rgba(0,0,0,0.02);
      border-color: rgba(0,0,0,0.06);
      opacity: 0.45;
    }
    .orun-node-card-cancelled {
      background: rgba(255,152,0,0.05);
      border-color: rgba(255,152,0,0.2);
      opacity: 0.6;
    }
    .orun-node-name {
      font-weight: 700;
      font-size: 0.75rem;
      color: var(--text);
      margin-bottom: 0.25rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .orun-node-type {
      font-size: 0.62rem;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--text-dim);
      margin-bottom: 0.3rem;
    }
    .orun-node-info {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.68rem;
      color: var(--text);
    }
    .orun-node-info code {
      background: rgba(0,0,0,0.05);
      padding: 0.05rem 0.25rem;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 0.65rem;
    }
    .orun-node-info .err {
      color: var(--red);
      font-size: 0.65rem;
      word-break: break-all;
    }
    .orun-node-status-icon {
      position: absolute;
      top: 0.35rem;
      right: 0.35rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      line-height: 1;
    }
    .orun-node-status-icon svg { display: block; }

    /* Node detail table (per-run) */
    .orun-nodes-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .orun-nodes-table th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      border-bottom: 1px solid rgba(0,0,0,0.08);
    }
    .orun-nodes-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid rgba(0,0,0,0.04);
      vertical-align: top;
    }
    .orun-nodes-table tr:last-child td { border-bottom: none; }
    .orun-nodes-table tr:hover td {
      background: rgba(0,0,0,0.015);
    }
    .orun-nodes-table .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 0.35rem;
      vertical-align: middle;
    }
    .orun-output-cell {
      max-width: 400px;
      max-height: 100px;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      white-space: pre-wrap;
      word-break: break-all;
      background: rgba(0,0,0,0.03);
      padding: 0.3rem 0.5rem;
      border-radius: 4px;
    }
    .orun-error-cell {
      color: var(--red);
      font-family: var(--font-mono);
      font-size: 0.72rem;
      word-break: break-all;
    }

    /* Expandable detail rows */
    .orun-expandable-row { cursor: pointer; }
    .orun-expandable-row:hover td { background: rgba(0,0,0,0.025); }
    .orun-row-chevron {
      font-size: 0.6rem;
      color: var(--text-dim);
      margin-left: 0.25rem;
      vertical-align: middle;
    }
    .orun-detail-row td { padding: 0 !important; }
    .orun-detail-row + tr td { padding-top: 1rem; }
    .orun-detail-row-content {
      padding: 1.5rem 1.5rem 2rem !important;
      background: var(--bg-alt, rgba(0,0,0,0.02));
      border-bottom: 2px solid rgba(0,0,0,0.08);
    }
    .orun-detail-section { margin-bottom: 1.5rem; }
    .orun-detail-section:last-child { margin-bottom: 1rem; }
    .orun-detail-label {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 0.5rem;
    }
    .orun-detail-content {
      max-height: 300px;
      overflow: auto;
      padding: 0.75rem 1rem;
      background: var(--bg, #fff);
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 6px;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
    }

    /* Tabs inside run detail */
    .orun-detail-tabs {
      display: flex;
      gap: 0;
      border-bottom: 2px solid rgba(0,0,0,0.06);
      padding: 0 1rem;
    }
    .orun-detail-tab {
      padding: 0.5rem 1rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-dim);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: color var(--transition-fast), border-color var(--transition-fast);
    }
    .orun-detail-tab:hover { color: var(--text); }
    .orun-detail-tab.active {
      color: var(--accent2);
      border-bottom-color: var(--accent);
    }
    .orun-detail-panel {
      display: none;
      padding: 0.75rem 1rem;
    }
    .orun-detail-panel.active { display: block; }

    /* Duration bar chart */
    .orun-duration-bars {
      display: flex;
      align-items: flex-end;
      gap: 0.3rem;
      padding: 0.5rem 0;
    }
    .orun-duration-bar-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      flex: 1;
      min-width: 40px;
      max-width: 80px;
    }
    .orun-duration-bar {
      width: 100%;
      border-radius: 3px 3px 0 0;
      min-height: 2px;
      transition: height var(--transition-med);
    }
    .orun-duration-bar-label {
      font-size: 0.6rem;
      color: var(--text-dim);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 80px;
    }
    .orun-duration-bar-time {
      font-size: 0.58rem;
      font-weight: 600;
      color: var(--text);
      font-family: var(--font-mono);
    }

    /* Empty state */
    .orun-empty {
      text-align: center;
      padding: 3rem;
      color: var(--text-dim);
      font-size: 0.9rem;
    }

    /* Run filter */
    .orun-filter-row {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .orun-filter-btn {
      padding: 0.3rem 0.8rem;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 9999px;
      cursor: pointer;
      border: 1px solid var(--glass-border);
      background: var(--glass);
      color: var(--text-dim);
      transition: all var(--transition-fast);
    }
    .orun-filter-btn:hover { background: rgba(0,0,0,0.05); }
    .orun-filter-btn.active {
      background: rgba(184,151,90,0.15);
      border-color: rgba(184,151,90,0.35);
      color: var(--accent2);
    }

    /* ═══════════════════════════════════════════════
       Dark Mode — DAG Canvas Overrides
       ═══════════════════════════════════════════════ */
    :root[data-theme="dark"] .dag-ctx-menu,
    :root[data-theme="dark"] .dag-inline-edit {
      background: #2a2a2e;
      border-color: #444;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    :root[data-theme="dark"] .dag-ctx-menu-item { color: var(--text); }
    :root[data-theme="dark"] .dag-ctx-menu-item:hover { background: rgba(184,151,90,0.12); }
    :root[data-theme="dark"] .dag-ctx-menu-sep { background: #444; }

    :root[data-theme="dark"] .dag-minimap {
      background: rgba(30,30,30,0.92);
      border-color: #444;
    }
    :root[data-theme="dark"] .dag-validation-panel {
      background: rgba(30,30,30,0.92);
      border-color: #444;
    }
    :root[data-theme="dark"] .dag-shortcuts-panel {
      background: #2a2a2e;
      box-shadow: 0 12px 48px rgba(0,0,0,0.5);
    }
    :root[data-theme="dark"] .dag-shortcuts-header { border-bottom-color: #444; }
    :root[data-theme="dark"] .dag-shortcut-row kbd {
      background: #333;
      border-color: #555;
      color: #aaa;
    }
    :root[data-theme="dark"] .dag-inline-edit input,
    :root[data-theme="dark"] .dag-inline-edit select {
      background: #333;
      color: var(--text);
      border-color: #555;
    }
    :root[data-theme="dark"] .dag-edge-label { fill: #999; }

    /* Dark mode — general component overrides */
    :root[data-theme="dark"] .orch-card:hover { background: rgba(50,50,50,0.8); }
    :root[data-theme="dark"] .orch-card-stats { border-top-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .orch-stat-value code {
      background: rgba(255,255,255,0.08);
      color: var(--accent);
    }
    :root[data-theme="dark"] .orun-detail-tabs { border-bottom-color: rgba(255,255,255,0.08); }

    /* Dark mode — node label readability */
    :root[data-theme="dark"] .dag-node .dag-label { fill: #e5e5e5; }
    :root[data-theme="dark"] .dag-node .dag-sublabel { fill: #999; }
    :root[data-theme="dark"] .dag-node.focused {
      filter: drop-shadow(0 0 5px rgba(184,151,90,0.7)) drop-shadow(0 0 12px rgba(184,151,90,0.35));
    }

    /* ── Performance: disable transitions/animations during drag ── */
    .dag-editor-svg.dag-dragging .dag-node rect,
    .dag-editor-svg.dag-dragging .dag-node polygon { transition: none !important; }
    .dag-editor-svg.dag-dragging .dag-port-in,
    .dag-editor-svg.dag-dragging .dag-port-out { transition: none !important; }
    .dag-editor-svg.dag-dragging .dag-edge .dag-edge-visible { transition: none !important; }
    .dag-editor-svg.dag-dragging .dag-node.status-running,
    .dag-editor-svg.dag-dragging .dag-node.status-waiting { animation: none !important; }
    .dag-editor-svg.dag-dragging .dag-node { will-change: transform; }

    /* ── Collision overlap tint (during drag) ── */
    .dag-node.overlap-warning rect,
    .dag-node.overlap-warning polygon {
      filter: drop-shadow(0 0 8px rgba(220,38,38,0.5)) !important;
    }

    /* ═══════════════════════════════════════════════
       Dark Mode — Orchestrator Panels & Forms
       ═══════════════════════════════════════════════ */

    /* Canvas layout & side panel */
    :root[data-theme="dark"] .dag-editor-container { background: var(--dag-canvas-bg); }
    :root[data-theme="dark"] .orch-canvas-layout { background: var(--dag-canvas-bg); }
    :root[data-theme="dark"] .orch-side-panel { background: var(--bg-subtle); }
    :root[data-theme="dark"] .orch-panel-header { background: var(--bg-subtle); }

    /* Form fields */
    :root[data-theme="dark"] .orch-field .settings-input,
    :root[data-theme="dark"] .orch-field textarea,
    :root[data-theme="dark"] .orch-field select { background: var(--bg); color: var(--text); }

    /* Add node dropdown */
    :root[data-theme="dark"] .orch-add-menu { background: #2a2a2e; border-color: #444; }
    :root[data-theme="dark"] .orch-add-menu-item:hover { background: rgba(184,151,90,0.1); }

    /* Toolbar buttons */
    :root[data-theme="dark"] .orch-toolbar-btn-muted {
      background: rgba(255,255,255,0.08);
      color: var(--text-muted);
    }
    :root[data-theme="dark"] .orch-toolbar-btn-muted:hover {
      background: rgba(255,255,255,0.15);
      color: var(--text);
    }
    :root[data-theme="dark"] .orch-zoom-group {
      background: rgba(255,255,255,0.06);
      border-color: rgba(184,151,90,0.2);
    }
    :root[data-theme="dark"] .orch-zoom-group #orch-zoom-level { color: var(--text-muted); }
    :root[data-theme="dark"] .orch-zoom-btn,
    :root[data-theme="dark"] .orch-zoom-fit-btn {
      background: rgba(255,255,255,0.08);
      color: var(--text-muted);
    }
    :root[data-theme="dark"] .orch-zoom-btn:hover,
    :root[data-theme="dark"] .orch-zoom-fit-btn:hover {
      background: var(--surface-hover);
      color: var(--text);
    }

    /* Settings overlay card */
    :root[data-theme="dark"] .orch-settings-card {
      background: rgba(36,36,36,0.97);
      border-color: rgba(184,151,90,0.2);
    }

    /* Runs drawer & panel */
    :root[data-theme="dark"] .orch-runs-drawer {
      background: linear-gradient(180deg, rgba(36,36,36,0.96) 0%, rgba(30,30,30,0.96) 100%);
      border-color: rgba(184,151,90,0.18);
    }
    :root[data-theme="dark"] .orch-runs-header {
      background: linear-gradient(135deg, rgba(40,40,40,0.95) 0%, rgba(36,36,36,0.92) 100%);
      border-bottom-color: rgba(184,151,90,0.12);
    }
    :root[data-theme="dark"] .orch-runs-title-icon { color: var(--accent); }
    :root[data-theme="dark"] .orch-runs-title-copy h3 { color: var(--text); }
    :root[data-theme="dark"] .orch-runs-title-copy p { color: var(--text-dim); }
    :root[data-theme="dark"] .orch-runs-body {
      background: linear-gradient(180deg, rgba(30,30,30,0.9) 0%, rgba(26,26,26,0.75) 100%);
    }
    :root[data-theme="dark"] .orch-runs-empty { background: rgba(255,255,255,0.04); }
    :root[data-theme="dark"] .orch-runs-table thead th {
      background: rgba(40,40,40,0.97);
      color: var(--text-dim);
    }
    :root[data-theme="dark"] .orch-runs-table td {
      background: var(--bg-subtle);
      box-shadow: inset 0 -1px 0 rgba(255,255,255,0.03);
    }
    :root[data-theme="dark"] .orch-runs-table tbody tr:nth-child(even) td { background: var(--bg-subtle); }
    :root[data-theme="dark"] .orch-runs-table tbody tr:hover td { background: rgba(184,151,90,0.08); }
    :root[data-theme="dark"] .orch-runs-table tbody tr td:first-child { border-left-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .orch-runs-table tbody tr td:last-child { border-right-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .orch-runs-table code { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .orch-runs-btn-ghost {
      background: rgba(255,255,255,0.06);
      color: var(--text-muted);
    }
    :root[data-theme="dark"] .orch-runs-btn-ghost:hover {
      background: rgba(255,255,255,0.12);
      color: var(--text);
    }
    :root[data-theme="dark"] .orch-runs-btn-primary {
      background: linear-gradient(135deg, rgba(212,169,106,0.22) 0%, rgba(212,169,106,0.14) 100%);
      border-color: rgba(212,169,106,0.4);
      color: var(--accent);
      box-shadow: 0 2px 10px rgba(212,169,106,0.12);
    }
    :root[data-theme="dark"] .orch-runs-btn-primary:hover {
      background: linear-gradient(135deg, rgba(212,169,106,0.32) 0%, rgba(212,169,106,0.22) 100%);
      border-color: rgba(212,169,106,0.55);
      color: var(--accent);
      box-shadow: 0 4px 14px rgba(212,169,106,0.18);
    }
    :root[data-theme="dark"] .orch-run-detail-view h3 { color: var(--text); }

    /* Node panel template & return conditions */
    :root[data-theme="dark"] .orch-rv-template-pre { background: var(--bg-card); }
    :root[data-theme="dark"] .orch-rc-modal-card { background: var(--bg-card); }
    :root[data-theme="dark"] .orch-rv-template-card { background: var(--surface); }
    :root[data-theme="dark"] .orch-rc-summary-card {
      background: rgba(255,255,255,0.03);
      border-color: rgba(255,255,255,0.08);
    }
    :root[data-theme="dark"] .orch-rc-summary-header { border-bottom-color: rgba(255,255,255,0.06); }

    /* Toolbar primary button text */
    /* Schedule cards */
    :root[data-theme="dark"] .sched-card-active { background: var(--surface); }
    :root[data-theme="dark"] .sched-card-active .sched-card-header { background: rgba(76,175,80,0.12); }
    :root[data-theme="dark"] .sched-card-archive { background: var(--surface); }
    :root[data-theme="dark"] .sched-card-archive .sched-card-header { background: rgba(160,160,160,0.08); }

    /* Guide modal */
    :root[data-theme="dark"] .orch-guide-content {
      background: linear-gradient(155deg, rgba(36,36,36,0.98) 0%, rgba(30,30,30,0.98) 100%);
    }
    :root[data-theme="dark"] .orch-guide-header {
      background: linear-gradient(135deg, rgba(36,36,36,0.96) 0%, rgba(30,30,30,0.9) 100%);
    }
    :root[data-theme="dark"] .orch-guide-title-copy h2 { color: var(--text); }
    :root[data-theme="dark"] .orch-guide-title-copy p { color: var(--text-muted); }
    :root[data-theme="dark"] .orch-guide-search-wrap { background: var(--bg-subtle); border-color: #444; }
    :root[data-theme="dark"] .orch-guide-search-input { color: var(--text); }
    :root[data-theme="dark"] .orch-guide-search-icon { color: var(--text-dim); }
    :root[data-theme="dark"] .guide-nav-icon { background: rgba(255,255,255,0.06); color: var(--accent); }
    :root[data-theme="dark"] .guide-nav-title { color: var(--text); }
    :root[data-theme="dark"] .guide-nav-summary { color: var(--text-dim); }
    :root[data-theme="dark"] .guide-section {
      background: linear-gradient(150deg, rgba(40,40,40,0.95) 0%, rgba(36,36,36,0.9) 100%);
    }
    :root[data-theme="dark"] .guide-section-icon { background: rgba(184,151,90,0.12); color: var(--accent); }
    :root[data-theme="dark"] .guide-badge-green { color: #4ade80; }
    :root[data-theme="dark"] .guide-badge-blue { color: #60a5fa; }
    :root[data-theme="dark"] .guide-badge-yellow { color: #fbbf24; }
    :root[data-theme="dark"] .guide-badge-gray { color: var(--text-muted); }
    :root[data-theme="dark"] .guide-kbd { background: #333; border-color: #555; }

    /* ── Dark Mode — Error Log Panel (Validation Errors) ── */
    :root[data-theme="dark"] .orch-error-log {
      background: linear-gradient(180deg, rgba(40,30,30,0.97) 0%, rgba(36,28,28,0.97) 100%);
      border-color: rgba(248,113,113,0.25);
      box-shadow: 0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.15);
    }
    :root[data-theme="dark"] .orch-error-log-header {
      background: linear-gradient(135deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.05) 100%);
      border-bottom-color: rgba(248,113,113,0.15);
    }
    :root[data-theme="dark"] .orch-error-log-icon {
      background: rgba(248,113,113,0.15);
      border-color: rgba(248,113,113,0.25);
    }
    :root[data-theme="dark"] .orch-error-log-title { color: #f87171; }
    :root[data-theme="dark"] .orch-error-log-badge {
      background: rgba(248,113,113,0.18);
      color: #f87171;
    }
    :root[data-theme="dark"] .orch-error-log-dismiss {
      border-color: rgba(248,113,113,0.2);
      color: #f09090;
    }
    :root[data-theme="dark"] .orch-error-log-dismiss:hover {
      background: rgba(248,113,113,0.12);
      border-color: rgba(248,113,113,0.35);
      color: #f87171;
    }
    :root[data-theme="dark"] .orch-error-log-item { color: #e0a0a0; }
    :root[data-theme="dark"] .orch-error-log-item:not(:last-child) {
      border-bottom-color: rgba(248,113,113,0.1);
    }
    :root[data-theme="dark"] .orch-error-log-item:hover {
      background: rgba(248,113,113,0.06);
    }
    :root[data-theme="dark"] .orch-error-log-item-dot { background: #f87171; }
    :root[data-theme="dark"] .orch-guide-title-icon { color: var(--accent); }
    :root[data-theme="dark"] .orch-guide-close-btn {
      color: var(--text);
      background: linear-gradient(180deg, rgba(50,50,50,0.98) 0%, rgba(40,40,40,0.88) 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.2);
    }

    /* Error trace section */
    :root[data-theme="dark"] .orun-error-section {
      background: var(--bg-subtle);
      background-image: linear-gradient(180deg, rgba(192,57,43,0.08) 0%, transparent 120px);
    }
    :root[data-theme="dark"] .orun-error-section .orun-error-freq-table th,
    :root[data-theme="dark"] .orun-error-section .orun-error-freq-table td {
      border-bottom-color: rgba(255,255,255,0.06);
    }
    :root[data-theme="dark"] .orun-errlog-detail {
      background: rgba(255,255,255,0.02);
      border-top-color: rgba(255,255,255,0.06);
    }
    :root[data-theme="dark"] .orun-errlog-errmsg pre {
      background: rgba(192,57,43,0.12);
      border-color: rgba(192,57,43,0.2);
      color: #f87171;
    }
    :root[data-theme="dark"] .orun-errlog-output pre {
      background: rgba(255,255,255,0.04);
      border-color: rgba(255,255,255,0.08);
    }

    /* Canvas toolbar */
    :root[data-theme="dark"] .orch-canvas-toolbar {
      background: rgba(30,30,30,0.7);
      border-bottom-color: rgba(255,255,255,0.06);
    }
    :root[data-theme="dark"] .orch-toolbar-btn-primary {
      background: linear-gradient(180deg, rgba(212,169,106,0.22) 0%, rgba(212,169,106,0.14) 100%);
      border-color: rgba(212,169,106,0.4);
      color: var(--accent);
    }
    :root[data-theme="dark"] .orch-toolbar-btn-primary:hover {
      background: linear-gradient(180deg, rgba(212,169,106,0.32) 0%, rgba(212,169,106,0.22) 100%);
      border-color: rgba(212,169,106,0.55);
      color: var(--accent);
      box-shadow: 0 3px 10px rgba(212,169,106,0.15);
    }

    /* ═══════════════════════════════════════════════
       Dark Mode — Runs Full-Page
       ═══════════════════════════════════════════════ */
    :root[data-theme="dark"] .orch-runs-page {
      background: linear-gradient(145deg, #1a1a1a 0%, #1e1e1e 50%, #222 100%);
    }
    :root[data-theme="dark"] .orch-runs-topbar {
      background: linear-gradient(135deg, #1a1a1a 0%, #252525 100%);
      border-bottom-color: rgba(255,255,255,0.06);
    }
    :root[data-theme="dark"] .orch-runs-content {
      color: var(--text);
    }

    /* Metrics cards */
    :root[data-theme="dark"] .orun-metric-card {
      border-color: rgba(255,255,255,0.06);
    }
    :root[data-theme="dark"] .orun-metric-success .orun-metric-value { color: #4ade80; }
    :root[data-theme="dark"] .orun-metric-warn .orun-metric-value { color: #fbbf24; }
    :root[data-theme="dark"] .orun-metric-danger .orun-metric-value { color: #f87171; }

    /* Heatmap */
    :root[data-theme="dark"] .orun-heatmap-bar { background: #3a3a3a; }

    /* Filter row */
    :root[data-theme="dark"] .orun-filter-btn:hover { background: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .orun-filter-btn.active {
      background: rgba(212,169,106,0.15);
      border-color: rgba(212,169,106,0.35);
    }

    /* Run timeline items */
    :root[data-theme="dark"] .orun-run-header:hover { background: rgba(255,255,255,0.03); }
    :root[data-theme="dark"] .orun-run-detail {
      border-top-color: rgba(255,255,255,0.06);
      background: rgba(255,255,255,0.015);
    }

    /* Node detail table */
    :root[data-theme="dark"] .orun-nodes-table th {
      border-bottom-color: rgba(255,255,255,0.08);
    }
    :root[data-theme="dark"] .orun-nodes-table td {
      border-bottom-color: rgba(255,255,255,0.04);
    }
    :root[data-theme="dark"] .orun-nodes-table tr:hover td {
      background: rgba(255,255,255,0.03);
    }
    :root[data-theme="dark"] .orun-expandable-row:hover td {
      background: rgba(255,255,255,0.03);
    }
    :root[data-theme="dark"] .orun-detail-row-content {
      background: rgba(255,255,255,0.02);
      border-bottom-color: rgba(255,255,255,0.08);
    }
    :root[data-theme="dark"] .orun-detail-content {
      background: var(--bg);
      border-color: rgba(255,255,255,0.08);
    }
    :root[data-theme="dark"] .orun-output-cell {
      background: rgba(255,255,255,0.04);
    }
    :root[data-theme="dark"] .orun-node-info code {
      background: rgba(255,255,255,0.08);
    }

    /* Node card pending/waiting/not_executed dark adjustments */
    :root[data-theme="dark"] .orun-node-card-pending,
    :root[data-theme="dark"] .orun-node-card-waiting {
      background: rgba(255,255,255,0.03);
      border-color: rgba(255,255,255,0.08);
    }
    :root[data-theme="dark"] .orun-node-card-not_executed {
      background: rgba(255,255,255,0.02);
      border-color: rgba(255,255,255,0.06);
    }

    /* DAG ports */
    :root[data-theme="dark"] .dag-port-in,
    :root[data-theme="dark"] .dag-port-out { fill: var(--bg-subtle); }

`;
