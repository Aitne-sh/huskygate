/** @module dashboard/styles/agents — CSS for the AI Agents management page and modal. */
export const agentStyles = `
/* ── Agent Card List ── */
.agent-card-list { display:flex; flex-direction:column; gap:var(--space-3); }
.agent-card {
  display:flex; align-items:flex-start; gap:var(--space-4);
  padding:var(--space-4) var(--space-5);
  background:var(--glass); border:1px solid var(--glass-border);
  border-radius:var(--radius); backdrop-filter:blur(var(--glass-blur));
  box-shadow:var(--shadow-xs);
  transition:transform var(--transition-med), box-shadow var(--transition-med);
  animation:fadeSlideIn 0.3s ease both;
}
.agent-card:hover { transform:translateY(-2px); box-shadow:var(--shadow-md); }
.agent-card:nth-child(1){animation-delay:0s}
.agent-card:nth-child(2){animation-delay:0.05s}
.agent-card:nth-child(3){animation-delay:0.1s}
.agent-card:nth-child(4){animation-delay:0.15s}
.agent-card:nth-child(5){animation-delay:0.2s}

.agent-card-icon {
  width:40px; height:40px; border-radius:10px;
  background:rgba(184,151,90,0.08); color:var(--accent);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.agent-card-body { flex:1; min-width:0; }
.agent-card-header { display:flex; align-items:center; gap:var(--space-2); margin-bottom:var(--space-1); }
.agent-card-name { font-size:var(--text-base); font-weight:600; color:var(--text); }
.agent-card-desc {
  font-size:var(--text-sm); color:var(--text-muted); line-height:1.45;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
  margin-bottom:var(--space-2);
}
.agent-card-meta { display:flex; flex-wrap:wrap; gap:var(--space-2); align-items:center; }

.agent-tag {
  display:inline-flex; align-items:center; gap:0.2rem;
  padding:0.15rem 0.5rem; border-radius:var(--radius-pill);
  font-size:var(--text-xs); background:rgba(184,151,90,0.06);
  color:var(--text-muted); border:1px solid rgba(184,151,90,0.12);
}

.agent-card-actions { display:flex; gap:var(--space-1); flex-shrink:0; align-self:flex-start; }

/* ── Agent Modal – input background override (match other task modals) ── */
#agent-modal-overlay .settings-input,
#agent-modal-overlay textarea,
#agent-modal-overlay select { background:var(--bg-card); }

.agent-instruction-input {
  font-family:var(--font-mono); font-size:var(--text-sm);
  resize:vertical; min-height:120px; line-height:1.5;
}
.agent-checkbox-grid {
  display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));
  gap:var(--space-2);
}
.agent-checkbox-label {
  display:inline-flex; align-items:center; gap:var(--space-2);
  font-size:var(--text-sm); color:var(--text-muted); cursor:pointer;
  user-select:none; transition:color var(--transition-fast);
  padding:0.25rem 0.4rem; border-radius:var(--radius-sm);
}
.agent-checkbox-label:hover { color:var(--text); background:var(--surface); }
.agent-checkbox-label input[type="checkbox"] {
  position:absolute; opacity:0; width:0; height:0; pointer-events:none;
}
.cb-mark {
  width:16px; height:16px; flex-shrink:0;
  border:1.5px solid var(--border);
  border-radius:3px; background:transparent;
  display:inline-flex; align-items:center; justify-content:center;
  transition:all var(--transition-fast);
  position:relative;
}
.agent-checkbox-label:hover .cb-mark { border-color:var(--accent); }
.agent-checkbox-label input:checked + .cb-mark {
  background:var(--accent); border-color:var(--accent);
}
.agent-checkbox-label input:checked + .cb-mark::after {
  content:''; display:block;
  width:4px; height:8px;
  border:solid #fff; border-width:0 1.5px 1.5px 0;
  transform:rotate(45deg) translate(-0.5px,-0.5px);
}
.agent-checkbox-label input:focus-visible + .cb-mark {
  box-shadow:0 0 0 2px var(--border-focus);
}

/* agent-modal-footer removed — uses shared .btn-group */

/* ── Node Panel Agent Selector ── */
.agent-selected {
  display:flex; align-items:center; gap:var(--space-2);
  padding:var(--space-2) var(--space-3); background:var(--surface);
  border:1px solid var(--border); border-radius:var(--radius-md);
  animation:fadeSlideIn 0.2s ease;
}
.agent-selected-icon { color:var(--accent); flex-shrink:0; }
.agent-selected-name { font-weight:600; font-size:var(--text-base); color:var(--text); flex:1; }
.agent-selected-clear {
  width:20px; height:20px; border-radius:var(--radius-sm); border:1px solid var(--border);
  background:transparent; color:var(--text-muted); cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  font-size:0.7rem; transition:all var(--transition-fast);
}
.agent-selected-clear:hover { background:var(--surface); color:var(--text); }

.agent-inherited-card {
  background:rgba(184,151,90,0.04); border:1px dashed var(--border);
  border-radius:var(--radius-md); padding:var(--space-3); margin-top:var(--space-2);
}
.agent-inherited-header {
  font-size:var(--text-xs); text-transform:uppercase; letter-spacing:0.04em;
  color:var(--text-dim); margin-bottom:var(--space-2);
}
.agent-inherited-row {
  display:flex; gap:var(--space-2); font-size:var(--text-sm); margin-bottom:var(--space-1);
}
.agent-inherited-key { font-weight:600; color:var(--text-muted); min-width:80px; flex-shrink:0; }
.agent-inherited-val {
  color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
}

/* ── Agent Summary Card (node panel, read-only) ── */
.agent-summary-card {
  background:rgba(33,150,243,0.04); border:1px solid rgba(33,150,243,0.2);
  border-radius:var(--radius-md); padding:var(--space-3); margin-top:var(--space-2);
}
.agent-summary-header {
  display:flex; align-items:center; gap:var(--space-2);
  margin-bottom:var(--space-2); padding-bottom:var(--space-2);
  border-bottom:1px solid var(--border);
}
.agent-summary-name {
  font-weight:700; font-size:var(--text-base); color:var(--text);
}
.agent-summary-row {
  display:flex; gap:var(--space-2); font-size:var(--text-sm); margin-bottom:var(--space-1);
}
.agent-summary-key {
  font-weight:600; color:var(--text-muted); min-width:80px; flex-shrink:0;
}
.agent-summary-val {
  color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
}
.agent-summary-instruction {
  font-family:monospace; font-size:var(--text-xs);
  max-height:4rem; overflow-y:auto;
}
.agent-summary-footer {
  margin-top:var(--space-2); padding-top:var(--space-2);
  border-top:1px solid var(--border);
  text-align:right;
}
.agent-summary-link {
  font-size:var(--text-xs); color:var(--link); text-decoration:none;
}
.agent-summary-link:hover { text-decoration:underline; }

/* ── Dark Mode Overrides ── */
:root[data-theme="dark"] .agent-tag {
  background:rgba(212,169,106,0.08);
  border-color:rgba(212,169,106,0.15);
}
:root[data-theme="dark"] .agent-card-icon {
  background:rgba(212,169,106,0.1);
}
:root[data-theme="dark"] .agent-inherited-card {
  background:rgba(212,169,106,0.04);
  border-color:rgba(255,255,255,0.08);
}
:root[data-theme="dark"] .agent-summary-card {
  background:rgba(33,150,243,0.06);
  border-color:rgba(33,150,243,0.15);
}
`;
