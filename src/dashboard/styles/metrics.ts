/** @module styles/metrics — CSS styles for the Metrics tab (toolbar, sparklines, gauge, stat cards) */
export const metricsStyles = `
    /* ═══════════════════════════════════════════════
       Metrics Tab Styles
       ═══════════════════════════════════════════════ */

    /* ── Metrics Toolbar ── */
    .metrics-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    .metrics-range-group {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .metrics-range-btn {
      padding: 0.3rem 0.75rem;
      font-size: 0.78rem;
      font-family: var(--font-sans);
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .metrics-range-btn:hover {
      background: rgba(184, 151, 90, 0.08);
    }

    .metrics-range-btn.active {
      background: rgba(184, 151, 90, 0.15);
      color: var(--accent2);
      font-weight: 600;
    }

    /* ── Sparkline ── */
    .sparkline-canvas {
      width: 100%;
      height: 48px;
      margin-top: 0.35rem;
    }

    /* ── Gauge Widget (Queue Depth) ── */
    .gauge-card {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      padding: 1.25rem;
    }

    .gauge-ring {
      width: 80px;
      height: 80px;
      position: relative;
    }

    .gauge-ring canvas {
      width: 100%;
      height: 100%;
    }

    .gauge-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }

    .gauge-center .gauge-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }

    .gauge-center .gauge-label {
      font-size: 0.68rem;
      color: var(--text-dim);
    }

    .gauge-stats {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .gauge-stat-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .gauge-stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .gauge-stat-label {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .gauge-stat-value {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      margin-left: auto;
    }

    /* ── DB Size Stat Card ── */
    .stat-card-large {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      text-align: center;
    }

    .stat-card-large .stat-number {
      font-size: 2rem;
      font-weight: 700;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }

    .stat-card-large .stat-unit {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    /* ── Auto-Refresh Indicator ── */
    .auto-refresh-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.78rem;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }

    .auto-refresh-toggle:hover {
      color: var(--text);
    }

    .auto-refresh-toggle.active {
      color: var(--green);
    }

    .auto-refresh-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--text-dim);
      transition: background var(--transition-fast);
    }

    .auto-refresh-toggle.active .auto-refresh-dot {
      background: var(--green);
      animation: livePulse 2s ease-in-out infinite;
    }

    /* ── Metrics Empty State ── */
    .metrics-empty {
      text-align: center;
      color: var(--text-dim);
      padding: 2rem 1rem;
      font-size: 0.85rem;
    }

    /* ── Dark Mode Overrides ── */
    :root[data-theme="dark"] .metrics-range-btn:hover {
      background: rgba(212, 169, 106, 0.1);
    }

    :root[data-theme="dark"] .metrics-range-btn.active {
      background: rgba(212, 169, 106, 0.18);
      color: var(--accent2);
    }
`;
