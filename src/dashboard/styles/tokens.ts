/** @module styles/tokens — Design tokens, global reset, scrollbar, and accessibility */

const darkTokens = `
      --bg: #1a1a1a;
      --bg-subtle: #242424;
      --surface: rgba(40,40,40,0.7);
      --surface-hover: rgba(50,50,50,0.8);
      --surface-active: rgba(60,60,60,0.9);
      --border: #3a3a3a;
      --border-hover: #C5A55A;
      --border-focus: rgba(184,151,90,0.5);
      --text: #e5e5e5;
      --text-muted: #a0a0a0;
      --text-dim: #707070;
      --text-secondary: #999;
      --accent: #D4A96A;
      --accent2: #C5A55A;
      --green: #22c55e;
      --green-dark: #16a34a;
      --red: #f87171;
      --yellow: #fbbf24;
      --blue: #60a5fa;
      --blue-action: #60a5fa;
      --purple: #a78bfa;
      --status-completed: #22c55e;
      --status-failed: #f87171;
      --status-timeout: #fbbf24;
      --status-running: #60a5fa;
      --status-pending: #9ca3af;
      --glass: rgba(40,40,40,0.85);
      --glass-border: #3a3a3a;
      --shadow-xs: 0 1px 2px rgba(0,0,0,0.2);
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2);
      --shadow-md: 0 4px 8px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.2);
      --shadow-lg: 0 10px 20px rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.2);
      --shadow-xl: 0 20px 40px rgba(0,0,0,0.45), 0 8px 16px rgba(0,0,0,0.2);
      --shadow-inner: inset 0 1px 3px rgba(0,0,0,0.2);
      --toggle-off: #4a4a4a;
      --warning-bg: #3a3520;
      --warning-border: #8b7700;
      --warning-text: #fbbf24;
      --editor-bg: #1a1a1e;
      --editor-bg-hover: #2a2a30;
      --dag-canvas-bg: #1e1e1e;
      --dag-grid-dot: #444;
      --dag-edge-stroke: #6b6560;
      --dag-error-stroke: #E53935;
      --dag-node-start-fill: #1b3a1e;
      --dag-node-start-stroke: #66BB6A;
      --dag-node-start-stroke-sel: #81C784;
      --dag-node-task-fill: #1a2940;
      --dag-node-task-stroke: #7BAFD4;
      --dag-node-task-stroke-sel: #90CAF9;
      --dag-node-triggered-fill: #2a1f3d;
      --dag-node-triggered-stroke: #9575CD;
      --dag-node-triggered-stroke-sel: #B39DDB;
      --dag-node-gate-fill: #3a3520;
      --dag-node-gate-stroke: #FBC02D;
      --dag-node-gate-stroke-sel: #FFEE58;
      --dag-node-end-fill: #2a2720;
      --dag-node-end-stroke: #9E9689;
      --dag-node-webhook-fill: #251f3d;
      --dag-node-webhook-stroke: #9775E6;
      --dag-node-webhook-stroke-sel: #B39DDB;
      --bg-card: #2a2a2a;
      --teal: #2dd4bf;
      --orange: #fb923c;
      --pink-slack: #d946ef;
      --gray-neutral: #9ca3af;
      --gray-mid: #aaa;
      --gray-border: #555;
`;

export const tokenStyles = `
    /* ═══════════════════════════════════════════════
       Design Tokens — HuskyGate Dashboard
       ═══════════════════════════════════════════════ */

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      /* ── Color Palette ── */
      --bg: #F5F1E8;
      --bg-subtle: #EDE8DF;
      --surface: rgba(255,255,255,0.52);
      --surface-hover: rgba(255,255,255,0.72);
      --surface-active: rgba(255,255,255,0.85);
      --border: #DDD5C8;
      --border-hover: #C5A55A;
      --border-focus: rgba(184,151,90,0.5);
      --text: #2C2C2C;
      --text-muted: #7A7067;
      --text-dim: #A69E94;
      --text-secondary: #555;
      --accent: #B8975A;
      --accent2: #A07D3F;

      /* Semantic Colors */
      --green: #16a34a;
      --green-dark: #15803d;
      --red: #dc2626;
      --yellow: #d97706;
      --blue: #2563eb;
      --blue-action: #2563eb;
      --purple: #7C3AED;
      --teal: #0d9488;
      --orange: #ea580c;
      --pink-slack: #611f69;
      --gray-neutral: #6b7280;
      --gray-mid: #888;
      --gray-border: #bbb;

      /* Status Colors */
      --status-completed: #16a34a;
      --status-failed: #dc2626;
      --status-timeout: #d97706;
      --status-running: #2563eb;
      --status-pending: #6b7280;

      /* ── Typography ── */
      --font-body: 'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'Menlo', monospace;

      /* Font Sizes */
      --text-xs: 0.68rem;
      --text-sm: 0.78rem;
      --text-base: 0.85rem;
      --text-md: 0.92rem;
      --text-lg: 1.05rem;
      --text-xl: 1.25rem;
      --text-2xl: 1.5rem;

      /* ── Spacing Scale ── */
      --space-0: 0;
      --space-px: 1px;
      --space-0-5: 0.125rem;
      --space-1: 0.25rem;
      --space-1-5: 0.375rem;
      --space-2: 0.5rem;
      --space-3: 0.75rem;
      --space-4: 1rem;
      --space-5: 1.25rem;
      --space-6: 1.5rem;
      --space-8: 2rem;
      --space-10: 2.5rem;
      --space-12: 3rem;

      /* ── Border Radius ── */
      --radius-xs: 3px;
      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 8px;
      --radius-xl: 12px;
      --radius-2xl: 16px;
      --radius-pill: 9999px;
      --radius: 12px;

      /* ── Shadows ── */
      --shadow-xs: 0 1px 2px rgba(44,44,44,0.04);
      --shadow-sm: 0 1px 3px rgba(44,44,44,0.06), 0 1px 2px rgba(44,44,44,0.04);
      --shadow-md: 0 4px 8px rgba(44,44,44,0.07), 0 2px 4px rgba(44,44,44,0.04);
      --shadow-lg: 0 10px 20px rgba(44,44,44,0.08), 0 4px 8px rgba(44,44,44,0.04);
      --shadow-xl: 0 20px 40px rgba(44,44,44,0.10), 0 8px 16px rgba(44,44,44,0.05);
      --shadow-inner: inset 0 1px 3px rgba(44,44,44,0.04);

      /* Glass */
      --glass: rgba(255,255,255,0.52);
      --glass-border: #DDD5C8;
      --glass-blur: 12px;

      /* ── Transitions ── */
      --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      --transition-med: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      --transition-slow: 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

      /* ── Component Tokens ── */
      --toggle-off: #d1d5db;
      --toggle-on: #16a34a;
      --warning-bg: #fef9c3;
      --warning-border: #facc15;
      --warning-text: #713f12;
      --editor-bg: #1e1e2e;
      --editor-bg-hover: #313244;
      --editor-fg: #cdd6f4;

      /* Card background (for elements using var(--bg-card)) */
      --bg-card: #fff;

      /* Sidebar */
      --sidebar-width: 240px;

      /* ── DAG Canvas Tokens ── */
      --dag-canvas-bg: #fff;
      --dag-grid-dot: #D0D0D0;
      --dag-edge-stroke: #C5BEB4;
      --dag-error-stroke: #C0392B;
      --dag-node-start-fill: #E8F5E9;
      --dag-node-start-stroke: #4CAF50;
      --dag-node-start-stroke-sel: #388E3C;
      --dag-node-task-fill: #E3F2FD;
      --dag-node-task-stroke: #5B8DB8;
      --dag-node-task-stroke-sel: #1565C0;
      --dag-node-triggered-fill: #EDE7F6;
      --dag-node-triggered-stroke: #7E57C2;
      --dag-node-triggered-stroke-sel: #512DA8;
      --dag-node-gate-fill: #FFF8E1;
      --dag-node-gate-stroke: #F9A825;
      --dag-node-gate-stroke-sel: #F57F17;
      --dag-node-end-fill: #EDE8DD;
      --dag-node-end-stroke: #7A7067;
      --dag-node-webhook-fill: #F5F3FF;
      --dag-node-webhook-stroke: #7C3AED;
      --dag-node-webhook-stroke-sel: #6D28D9;
    }

    /* ── Dark Mode ── */
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) { ${darkTokens} }
    }
    :root[data-theme="dark"] { ${darkTokens} }

    /* ── Accessibility ── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(184,151,90,0.2); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(184,151,90,0.4); }
    * { scrollbar-width: thin; scrollbar-color: rgba(184,151,90,0.2) transparent; }

    /* ── Body ── */
    body {
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      overflow: hidden;
      display: flex;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* ── Selection ── */
    ::selection { background: rgba(184,151,90,0.25); color: var(--text); }

    /* ── Shared Animations ── */
    @keyframes fadeSlideIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes overlayFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes modalSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes pulseRing {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.15); }
    }

    @keyframes pulseRingOuter {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 0; transform: scale(1.6); }
    }

    @keyframes actionSpin {
      to { transform: rotate(360deg); }
    }
`;
