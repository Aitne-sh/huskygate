/** @module styles/base — Layout shell (sidebar, main content area, tab panels) and core UI primitives */
export const baseStyles = `
    /* ═══════════════════════════════════════════════
       Sidebar Navigation
       ═══════════════════════════════════════════════ */

    .sidebar {
      width: var(--sidebar-width, 240px);
      height: 100vh;
      background: linear-gradient(180deg, #1a1a1f 0%, #232328 40%, #2a2a30 100%);
      border-right: 1px solid rgba(255,255,255,0.06);
      padding: 1.5rem 0;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      box-shadow: 2px 0 20px rgba(0,0,0,0.2);
      position: relative;
      z-index: 10;
    }

    .sidebar-brand {
      padding: 0 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      margin-bottom: 0.75rem;
    }

    .sidebar-brand h1 {
      font-size: 1.3rem;
      font-style: italic;
      font-weight: 700;
      background: linear-gradient(135deg, #D4B87A 0%, #F0D89A 40%, #C5A55A 70%, #E8CC7E 100%);
      background-size: 300% auto;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: brandShimmer 8s ease-in-out infinite;
      letter-spacing: 0.02em;
    }

    @keyframes brandShimmer {
      0%, 100% { background-position: 0% center; }
      50% { background-position: 300% center; }
    }

    .sidebar-brand .version {
      color: rgba(255,255,255,0.3);
      font-size: 0.7rem;
      margin-top: 0.25rem;
      letter-spacing: 0.06em;
      font-family: var(--font-mono);
    }

    .nav-items { list-style: none; padding: 0 0.6rem; flex: 1; overflow-y: auto; }

    /* ── Integration Card (sidebar bottom) ── */
    .sidebar-integration-card {
      margin: 0.5rem 0.6rem 0;
      padding: 0.6rem 0.7rem;
      border-radius: 10px;
      font-size: 0.75rem;
      line-height: 1.4;
    }

    .sid-header {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    .sid-icon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .sid-icon-ok {
      background: rgba(22,163,74,0.18);
      color: #6ee7b7;
    }
    .sid-icon-warn {
      background: rgba(234,179,8,0.15);
      color: #fbbf24;
    }
    .sid-label {
      font-weight: 600;
      color: rgba(255,255,255,0.75);
      font-size: 0.8rem;
    }
    .sid-badge {
      margin-left: auto;
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.1rem 0.45rem;
      border-radius: var(--radius-pill);
      letter-spacing: 0.02em;
    }
    .sid-badge-ok {
      background: rgba(22,163,74,0.18);
      color: #6ee7b7;
      border: 1px solid rgba(22,163,74,0.3);
    }
    .sid-badge-off {
      background: rgba(234,179,8,0.12);
      color: #fbbf24;
      border: 1px solid rgba(234,179,8,0.25);
    }

    /* Configured state */
    .sid-configured {
      background: rgba(22,163,74,0.08);
      border: 1px solid rgba(22,163,74,0.18);
    }
    .sid-footer {
      margin-top: 0.4rem;
      padding-top: 0.35rem;
      border-top: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .sid-btn-reconfigure {
      background: none;
      border: none;
      color: rgba(255,255,255,0.35);
      font-size: 0.68rem;
      cursor: pointer;
      padding: 0;
      font-family: inherit;
      transition: color 0.15s;
    }
    .sid-btn-reconfigure:hover {
      color: rgba(255,255,255,0.6);
      text-decoration: underline;
    }

    /* Unconfigured state */
    .sid-unconfigured {
      background: rgba(234,179,8,0.06);
      border: 1px solid rgba(234,179,8,0.15);
    }
    .sid-btn-setup {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      width: 100%;
      margin-top: 0.5rem;
      padding: 0.4rem 0.6rem;
      border-radius: 8px;
      border: 1px solid rgba(184,151,90,0.35);
      background: rgba(184,151,90,0.15);
      color: #D4B87A;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all var(--transition-fast);
    }
    .sid-btn-setup:hover {
      background: rgba(184,151,90,0.25);
      border-color: rgba(184,151,90,0.5);
      box-shadow: 0 2px 8px rgba(184,151,90,0.15);
    }
    .sid-btn-setup:active { transform: scale(0.97); }
    .sid-cli-hint {
      text-align: center;
      margin-top: 0.35rem;
      font-size: 0.65rem;
      color: rgba(255,255,255,0.25);
    }
    .sid-cli-hint code {
      font-family: var(--font-mono);
      background: rgba(255,255,255,0.08);
      padding: 0.05rem 0.3rem;
      border-radius: 3px;
      font-size: 0.63rem;
      color: rgba(255,255,255,0.4);
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.55rem 0.75rem;
      border-radius: 10px;
      color: rgba(255,255,255,0.5);
      cursor: pointer;
      transition: all var(--transition-fast);
      font-size: 0.88rem;
      user-select: none;
      text-decoration: none;
      position: relative;
      margin-bottom: 2px;
      border-left: 3px solid transparent;
    }

    .nav-item:hover {
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.85);
    }

    .nav-item.active {
      background: rgba(184,151,90,0.15);
      border-left-color: var(--accent);
      color: #D4B87A;
      font-weight: 600;
    }

    .nav-icon {
      font-size: 1.1rem;
      width: 1.4rem;
      text-align: center;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform var(--transition-fast);
    }
    .nav-item:hover .nav-icon { transform: scale(1.08); }
    .nav-icon svg { flex-shrink: 0; vertical-align: middle; }

    /* ═══════════════════════════════════════════════
       Main Content Area
       ═══════════════════════════════════════════════ */

    .main { flex: 1; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    .main-header {
      padding: 1.25rem 2rem 0.85rem;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      background: rgba(255,255,255,0.4);
      backdrop-filter: blur(var(--glass-blur));
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    :root[data-theme="dark"] .main-header { background: rgba(30,30,30,0.6); }

    .main-header h2 {
      font-size: 1.15rem;
      color: var(--text);
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    /* ── Theme Toggle ── */
    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 0.35rem;
      cursor: pointer;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition-fast);
      width: 32px;
      height: 32px;
      flex-shrink: 0;
    }
    .theme-toggle:hover {
      color: var(--accent);
      border-color: var(--border-hover);
      background: var(--surface);
    }
    .theme-toggle:active { transform: scale(0.92); }
    .theme-toggle .icon-sun { display: block; }
    .theme-toggle .icon-moon { display: none; }
    :root[data-theme="dark"] .theme-toggle .icon-sun { display: none; }
    :root[data-theme="dark"] .theme-toggle .icon-moon { display: block; }

    .content { padding: 1.5rem 2rem; flex: 1; overflow-y: auto; min-height: 0; }

    /* ── Tab Panels ── */
    .tab-panel { display: none; visibility: hidden; opacity: 0; }
    @keyframes tabPanelFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .tab-panel.active { display: block; visibility: visible; opacity: 1; animation: tabPanelFadeIn 0.12s ease-out; }
    #tab-chat.active { display: flex; flex-direction: column; height: 100%; }
    #tab-logs.active { display: flex; flex-direction: column; height: 100%; }

    /* ═══════════════════════════════════════════════
       Cards
       ═══════════════════════════════════════════════ */

    .card {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      padding: 1.25rem;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(8px);
      transition: box-shadow var(--transition-med), border-color var(--transition-med), transform var(--transition-med);
    }

    /* ═══════════════════════════════════════════════
       Status Hero
       ═══════════════════════════════════════════════ */

    .status-hero {
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      transition: all var(--transition-med);
      position: relative;
      overflow: hidden;
    }

    .status-hero.running {
      background: linear-gradient(135deg, rgba(22,163,74,0.04) 0%, rgba(255,255,255,0.8) 100%);
      border: 1px solid rgba(22,163,74,0.2);
      box-shadow: 0 0 0 1px rgba(22,163,74,0.06), var(--shadow-sm);
    }

    .status-hero.stopped {
      background: linear-gradient(135deg, rgba(220,38,38,0.03) 0%, rgba(255,255,255,0.8) 100%);
      border: 1px solid rgba(220,38,38,0.15);
      box-shadow: 0 0 0 1px rgba(220,38,38,0.04), var(--shadow-sm);
    }

    .status-hero-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      position: relative;
      z-index: 1;
    }

    .status-hero-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .status-hero-indicator {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background var(--transition-med);
    }

    .status-hero.running .status-hero-indicator { background: rgba(22,163,74,0.08); }
    .status-hero.stopped .status-hero-indicator { background: rgba(220,38,38,0.06); }

    .status-dot {
      width: 12px; height: 12px; border-radius: 50%;
      flex-shrink: 0;
      position: relative;
    }

    .status-dot.running {
      background: var(--green);
      box-shadow: 0 0 8px rgba(22,163,74,0.5);
      animation: pulseRing 2s ease-in-out infinite;
    }

    .status-dot.running::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid rgba(22,163,74,0.25);
      animation: pulseRingOuter 2s ease-in-out infinite;
    }

    .status-dot.stopped { background: var(--red); }

    .status-hero-info {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      min-width: 0;
    }

    .status-hero-label {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--text);
    }

    .status-hero-pid {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.72rem;
      font-family: var(--font-mono);
      padding: 0.15rem 0.5rem;
      border-radius: var(--radius-pill);
      background: rgba(22,163,74,0.08);
      color: var(--green);
      font-weight: 500;
      letter-spacing: 0.01em;
      transition: opacity var(--transition-fast);
    }

    .status-hero-pid:empty { display: none; }

    .status-hero-actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .btn-daemon {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.45rem 1rem;
      border-radius: var(--radius-lg);
      border: 1px solid transparent;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all var(--transition-fast);
      position: relative;
      overflow: hidden;
    }

    .btn-daemon:active { transform: scale(0.96); }
    .btn-daemon:disabled { opacity: 0.55; cursor: not-allowed; pointer-events: none; }

    .btn-daemon-start {
      background: rgba(22,163,74,0.1);
      border-color: rgba(22,163,74,0.3);
      color: var(--green-dark);
    }
    .btn-daemon-start:hover { background: rgba(22,163,74,0.18); box-shadow: 0 2px 8px rgba(22,163,74,0.15); }

    .btn-daemon-stop {
      background: rgba(220,38,38,0.06);
      border-color: rgba(220,38,38,0.15);
      color: var(--red);
    }
    .btn-daemon-stop:hover { background: rgba(220,38,38,0.12); box-shadow: 0 2px 8px rgba(220,38,38,0.1); }

    .status-hero-meta {
      margin-top: 0.6rem;
      padding-top: 0.6rem;
      border-top: 1px solid rgba(44,44,44,0.05);
      color: var(--text-dim);
      font-size: 0.75rem;
      position: relative;
      z-index: 1;
    }

    .status-hero-meta:empty { display: none; }

    .status-hero-meta code {
      background: rgba(44,44,44,0.06);
      padding: 0.1rem 0.35rem;
      border-radius: var(--radius-sm);
      font-size: 0.72rem;
    }

    /* ═══════════════════════════════════════════════
       Metrics Grid
       ═══════════════════════════════════════════════ */

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.75rem;
      margin-top: 1rem;
    }

    @media (max-width: 900px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .metric-card {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem 1.1rem;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--border-hover);
    }

    .metric-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(184,151,90,0.08);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background var(--transition-fast), transform var(--transition-fast);
    }

    .metric-card--clickable { cursor: pointer; }
    .metric-card:hover .metric-icon { transform: scale(1.05); }

    .metric-icon--success { background: rgba(22,163,74,0.08); color: var(--green); }
    .metric-icon--health { background: rgba(37,99,235,0.08); color: var(--blue); }

    .metric-body { flex: 1; min-width: 0; }

    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
      transition: color var(--transition-fast);
    }

    .metric-label {
      font-size: 0.7rem;
      color: var(--text-dim);
      margin-top: 0.1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.3rem;
      font-variant-numeric: tabular-nums;
    }

    .metric-sub:empty { display: none; }

    .metric-sub .active-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--green);
      font-weight: 500;
    }

    .metric-sub .active-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      flex-shrink: 0;
    }

    .metric-bar {
      height: 4px;
      border-radius: 2px;
      background: rgba(44,44,44,0.06);
      overflow: hidden;
      margin-top: 0.4rem;
    }

    .metric-bar-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--green);
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1), background-color var(--transition-med);
      width: 0%;
    }

    /* ═══════════════════════════════════════════════
       Buttons
       ═══════════════════════════════════════════════ */

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 1rem;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: var(--text-base);
      cursor: pointer;
      transition: all var(--transition-fast);
      font-family: inherit;
      position: relative;
      overflow: hidden;
      font-weight: 500;
    }

    .btn::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(255,255,255,0.25) 0%, transparent 70%);
      opacity: 0;
      transition: opacity var(--transition-fast);
    }

    .btn:hover { background: var(--surface-hover); border-color: var(--border-hover); }
    .btn:hover::after { opacity: 1; }
    .btn:active { transform: scale(0.97); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

    .btn-primary { background: rgba(184,151,90,0.15); border-color: rgba(184,151,90,0.35); color: var(--accent2); font-weight: 600; }
    .btn-primary:hover { background: rgba(184,151,90,0.28); }
    .btn-primary-solid { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
    .btn-primary-solid:hover { background: var(--accent2); border-color: var(--accent2); }
    .btn-success { background: rgba(22,163,74,0.1); border-color: rgba(22,163,74,0.3); color: var(--green); font-weight: 600; }
    .btn-success:hover { background: rgba(22,163,74,0.2); }
    .btn-danger { background: rgba(220,38,38,0.08); border-color: rgba(220,38,38,0.2); color: var(--red); }
    .btn-danger:hover { background: rgba(220,38,38,0.15); }

    /* ═══════════════════════════════════════════════
       Utility Classes
       ═══════════════════════════════════════════════ */

    .text-dim { color: var(--text-dim); }
    .text-secondary { font-size: 0.75rem; color: var(--text-dim); }
    .text-muted { color: var(--text-muted); }
    .text-mono { font-family: var(--font-mono); }
    .text-mono-sm { font-family: var(--font-mono); font-size: 0.82rem; }
    .d-none { display: none; }
    .d-flex { display: flex; }
    .d-flex-center { display: flex; align-items: center; justify-content: center; }
    .gap-sm { gap: 0.35rem; }
    .gap-md { gap: 0.75rem; }
    .flex-1 { flex: 1; }
    .flex-wrap { flex-wrap: wrap; }
    .justify-end { justify-content: flex-end; }
    .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.78rem; }
    .btn-link { background: none; border: none; padding: 0; font-size: 0.72rem; color: var(--text-dim); cursor: pointer; text-decoration: none; }
    .btn-link:hover { color: var(--accent); text-decoration: underline; }

    .btn-group { display: flex; gap: 0.5rem; margin-top: 1rem; }

    .btn-toggle-group { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .btn-toggle-group button { padding: 0.3rem 0.75rem; font-size: 0.78rem; border: none; background: var(--surface); color: var(--text-muted); cursor: pointer; transition: all var(--transition-fast); font-family: inherit; position: relative; }
    .btn-toggle-group button:not(:last-child) { border-right: 1px solid var(--border); }
    .btn-toggle-group button:hover { background: var(--surface-hover); }
    .btn-toggle-group button.active { background: rgba(184,151,90,0.2); color: var(--accent2); font-weight: 600; }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .sidebar { width: 60px; }
      .sidebar-brand h1, .sidebar-brand .version, .nav-label { display: none; }
      .nav-item { justify-content: center; padding: 0.65rem; }
      .nav-icon { margin: 0; }
      .content { padding: 1rem; }
    }

    /* ═══════════════════════════════════════════════
       Dark Mode Overrides
       ═══════════════════════════════════════════════ */

    :root[data-theme="dark"] .status-hero.running {
      background: linear-gradient(135deg, rgba(22,163,74,0.1) 0%, rgba(30,30,30,0.8) 100%);
      border-color: rgba(22,163,74,0.3);
    }
    :root[data-theme="dark"] .status-hero.stopped {
      background: linear-gradient(135deg, rgba(220,38,38,0.1) 0%, rgba(30,30,30,0.8) 100%);
      border-color: rgba(220,38,38,0.25);
    }
    :root[data-theme="dark"] .status-hero-meta { border-top-color: rgba(255,255,255,0.06); }
    :root[data-theme="dark"] .status-hero-meta code { background: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .metric-bar { background: rgba(255,255,255,0.08); }
    :root[data-theme="dark"] .btn::after {
      background: radial-gradient(circle at center, rgba(255,255,255,0.08) 0%, transparent 70%);
    }

    /* ── Dark Mode — Button Variants ── */
    :root[data-theme="dark"] .btn-primary {
      background: rgba(212,169,106,0.14);
      border-color: rgba(212,169,106,0.3);
    }
    :root[data-theme="dark"] .btn-primary:hover {
      background: rgba(212,169,106,0.24);
      border-color: rgba(212,169,106,0.45);
    }
    :root[data-theme="dark"] .btn-primary-solid {
      background: var(--accent2);
      border-color: var(--accent2);
      color: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    :root[data-theme="dark"] .btn-primary-solid:hover {
      background: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 2px 8px rgba(212,169,106,0.3);
    }
    :root[data-theme="dark"] .btn-danger {
      background: rgba(248,113,113,0.1);
      border-color: rgba(248,113,113,0.25);
    }
    :root[data-theme="dark"] .btn-danger:hover {
      background: rgba(248,113,113,0.18);
      border-color: rgba(248,113,113,0.35);
    }
    :root[data-theme="dark"] .btn-success {
      background: rgba(34,197,94,0.1);
      border-color: rgba(34,197,94,0.25);
    }
    :root[data-theme="dark"] .btn-success:hover {
      background: rgba(34,197,94,0.2);
      border-color: rgba(34,197,94,0.35);
    }
`;
