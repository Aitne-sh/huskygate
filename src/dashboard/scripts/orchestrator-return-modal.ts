/** @module dashboard/scripts/orchestrator-return-modal — Client-side script for the return conditions modal. */

/**
 * Return conditions summary, modal editor, validation, and copy template.
 * Depends on: orchestrator.ts (orchBuildReturnTemplateFromConditions, escapeHtml, toast)
 */

export const orchestratorReturnModalScript = `
// ── Return Conditions Summary ─────────────────────────

function orchRcSummaryHtml(conditions) {
  if (!conditions || conditions.length === 0) {
    return '<div class="orch-rc-empty">No conditions configured yet. Click <b>Edit</b> to set up routing rules.</div>';
  }
  var html = '';
  for (var i = 0; i < conditions.length; i++) {
    var c = conditions[i];
    html += '<div class="orch-rc-row">';
    html += '<span class="orch-rc-condition">' + escapeHtml(c.condition) + '</span>';
    html += '<span class="orch-rc-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></span>';
    html += '<code class="orch-rc-value-badge">' + escapeHtml(c.value) + '</code>';
    html += '</div>';
  }
  return html;
}

// ── Return Conditions Modal ───────────────────────────

function orchOpenReturnConditionsModal() {
  // Prevent duplicate modal
  if (document.getElementById('orch-rc-modal-overlay')) return;

  // Read current conditions from hidden input
  var hiddenInput = document.getElementById('orch-panel-return-conditions');
  var conditions = [];
  if (hiddenInput && hiddenInput.value) {
    try { conditions = JSON.parse(hiddenInput.value); } catch(e) { conditions = []; }
  }
  // Default: two empty entries when no conditions exist
  if (conditions.length === 0) {
    conditions = [
      { condition: 'The task succeeds and produces the expected result', value: 'success' },
      { condition: 'The task fails or encounters an error', value: 'error' }
    ];
  }

  var html = '<div id="orch-rc-modal-overlay" class="orch-rc-modal-overlay" onclick="if(event.target===this)orchCloseReturnConditionsModal()">';
  html += '<div class="orch-rc-modal-card">';

  // Header
  html += '<div class="orch-rc-modal-header">';
  html += '<div class="orch-rc-modal-header-text">';
  html += '<strong class="orch-rc-modal-title">Return Conditions</strong>';
  html += '<div class="orch-rc-modal-subtitle">Map task outcomes to return values for downstream routing</div>';
  html += '</div>';
  html += '<button type="button" class="orch-rc-modal-close" onclick="orchCloseReturnConditionsModal()">Close</button>';
  html += '</div>';

  // Guide — always visible (outside scrollable body)
  html += '<div class="orch-rc-modal-guide">';
  html += '<div class="orch-rc-modal-guide-row">';
  html += '<span class="orch-rc-modal-guide-label">When</span>';
  html += '<span class="orch-rc-modal-guide-desc">Describe the scenario in natural language (e.g. "The task succeeds").</span>';
  html += '</div>';
  html += '<div class="orch-rc-modal-guide-row">';
  html += '<span class="orch-rc-modal-guide-label">Return</span>';
  html += '<span class="orch-rc-modal-guide-desc">The value used in <code>&lt;return:value&gt;</code> tag. Alphanumeric, underscore, hyphen only.</span>';
  html += '</div>';
  html += '</div>';

  // Body — scrollable entries
  html += '<div class="orch-rc-modal-body">';
  html += '<div id="orch-rc-entries" class="orch-rc-entries">';
  for (var i = 0; i < conditions.length; i++) {
    html += orchRcEntryHtml(i, conditions[i].condition, conditions[i].value);
  }
  html += '</div>';
  html += '</div>';

  // System defaults info
  html += '<div class="orch-rc-system-defaults" style="padding:0.5rem 1rem;border-top:1px solid var(--border-color,#333);font-size:0.78rem;color:var(--text-secondary,#999);">';
  html += '<div style="margin-bottom:0.25rem;font-weight:600;color:var(--text-tertiary,#777);">System defaults (cannot be removed):</div>';
  html += '<div style="display:flex;gap:1rem;">';
  html += '<span><code>other</code> — Unmatched or missing return value</span>';
  html += '<span><code>error</code> — CLI process failure (after retries)</span>';
  html += '</div>';
  html += '</div>';

  // Footer
  html += '<div class="orch-rc-modal-footer">';
  html += '<button type="button" class="orch-rc-add-btn" onclick="orchRcAddEntry()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Condition</button>';
  html += '<div style="flex:1;"></div>';
  html += '<button type="button" class="btn" onclick="orchCloseReturnConditionsModal()">Cancel</button>';
  html += '<button type="button" class="btn btn-primary" onclick="orchRcSaveAndClose()">Save</button>';
  html += '</div>';

  html += '</div></div>';

  // Append to body
  var overlay = document.createElement('div');
  overlay.innerHTML = html;
  document.body.appendChild(overlay.firstChild);
}

function orchRcEntryHtml(idx, condition, value) {
  var html = '<div class="orch-rc-entry" data-idx="' + idx + '">';
  html += '<div class="orch-rc-entry-fields">';
  html += '<div class="orch-rc-condition-input">';
  html += '<label>When</label>';
  html += '<textarea class="settings-input orch-rc-cond-textarea" rows="3" placeholder="Describe the condition...">' + escapeHtml(condition || '') + '</textarea>';
  html += '</div>';
  html += '<div class="orch-rc-arrow-col"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>';
  html += '<div class="orch-rc-value-input">';
  html += '<label>Return</label>';
  html += '<input class="settings-input orch-rc-val-input" value="' + escapeHtml(value || '') + '" placeholder="e.g. success">';
  html += '</div>';
  html += '</div>';
  html += '<div class="orch-rc-entry-actions">';
  html += '<button type="button" class="orch-rc-delete-btn" onclick="orchRcRemoveEntry(this)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg> Delete</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function orchRcAddEntry() {
  var container = document.getElementById('orch-rc-entries');
  if (!container) return;
  var idx = container.querySelectorAll('.orch-rc-entry').length;
  var div = document.createElement('div');
  div.innerHTML = orchRcEntryHtml(idx, '', '');
  container.appendChild(div.firstChild);
}

function orchRcRemoveEntry(btn) {
  var entry = btn.closest('.orch-rc-entry');
  if (entry) entry.remove();
}

var ORCH_RC_MAX_CONDITION_LEN = 2000;
var ORCH_RC_MAX_VALUE_LEN = 100;
var ORCH_RC_MAX_COUNT = 20;
var ORCH_RC_VALUE_RE = /^[a-zA-Z0-9_-]+$/;

function orchRcClearErrors() {
  var els = document.querySelectorAll('.orch-rc-entry-error');
  for (var i = 0; i < els.length; i++) els[i].remove();
  var highlighted = document.querySelectorAll('.orch-rc-entry.orch-rc-entry-invalid');
  for (var i = 0; i < highlighted.length; i++) highlighted[i].classList.remove('orch-rc-entry-invalid');
}

function orchRcShowEntryError(entry, msg) {
  entry.classList.add('orch-rc-entry-invalid');
  var existing = entry.querySelector('.orch-rc-entry-error');
  if (existing) { existing.textContent = msg; return; }
  var div = document.createElement('div');
  div.className = 'orch-rc-entry-error';
  div.textContent = msg;
  entry.appendChild(div);
}

function orchRcSaveAndClose() {
  var container = document.getElementById('orch-rc-entries');
  if (!container) return;

  orchRcClearErrors();

  var entries = container.querySelectorAll('.orch-rc-entry');
  var conditions = [];
  var seenValues = {};
  var hasError = false;

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var condEl = entry.querySelector('.orch-rc-cond-textarea');
    var valEl = entry.querySelector('.orch-rc-val-input');
    var cond = condEl ? condEl.value.trim() : '';
    var rawVal = valEl ? valEl.value.trim() : '';
    var val = rawVal.replace(/[^a-zA-Z0-9_-]/g, '');

    // Empty fields
    if (!cond && !val) {
      orchRcShowEntryError(entry, 'Both fields are empty. Fill in or delete this entry.');
      hasError = true;
      continue;
    }
    if (!cond) {
      orchRcShowEntryError(entry, 'When field is required.');
      hasError = true;
      continue;
    }
    if (!val) {
      orchRcShowEntryError(entry, 'Return value is required.');
      hasError = true;
      continue;
    }

    // Format check
    if (!ORCH_RC_VALUE_RE.test(rawVal)) {
      orchRcShowEntryError(entry, 'Return value may only contain letters, numbers, underscore, hyphen.');
      hasError = true;
      continue;
    }

    // Length limits
    if (cond.length > ORCH_RC_MAX_CONDITION_LEN) {
      orchRcShowEntryError(entry, 'When text exceeds ' + ORCH_RC_MAX_CONDITION_LEN + ' characters.');
      hasError = true;
      continue;
    }
    if (val.length > ORCH_RC_MAX_VALUE_LEN) {
      orchRcShowEntryError(entry, 'Return value exceeds ' + ORCH_RC_MAX_VALUE_LEN + ' characters.');
      hasError = true;
      continue;
    }

    // Reserved system values
    if (val === 'other_return' || val === 'error_return') {
      orchRcShowEntryError(entry, '"' + val + '" is a reserved system value and cannot be used.');
      hasError = true;
      continue;
    }

    // Duplicate return value
    var valLower = val.toLowerCase();
    if (seenValues[valLower]) {
      orchRcShowEntryError(entry, 'Duplicate return value "' + val + '". Each return value must be unique.');
      hasError = true;
      continue;
    }
    seenValues[valLower] = true;

    conditions.push({ condition: cond, value: val });
  }

  if (hasError) return;

  if (conditions.length === 0) {
    toast('Add at least one condition', 'error');
    return;
  }
  if (conditions.length > ORCH_RC_MAX_COUNT) {
    toast('Maximum ' + ORCH_RC_MAX_COUNT + ' conditions allowed', 'error');
    return;
  }

  // Store in hidden input
  var hiddenInput = document.getElementById('orch-panel-return-conditions');
  if (hiddenInput) hiddenInput.value = JSON.stringify(conditions);

  // Update summary
  var summary = document.getElementById('orch-rc-summary');
  if (summary) summary.innerHTML = orchRcSummaryHtml(conditions);

  // Update auto template preview
  var templatePre = document.getElementById('orch-rc-template-pre');
  if (templatePre) {
    templatePre.textContent = orchBuildReturnTemplateFromConditions(conditions);
  }

  orchCloseReturnConditionsModal();
}

function orchCloseReturnConditionsModal() {
  var overlay = document.getElementById('orch-rc-modal-overlay');
  if (overlay) overlay.remove();
}

// ── Copy Template ─────────────────────────────────────────

function orchCopyReturnTemplate(btn) {
  var pre = document.getElementById('orch-rv-template-pre');
  var text = pre ? pre.textContent : '';
  if (!text) return;
  var copyLabel = (btn && btn.getAttribute && btn.getAttribute('data-copy-label')) || 'Copy';
  var copiedLabel = (btn && btn.getAttribute && btn.getAttribute('data-copied-label')) || 'Copied';
  navigator.clipboard.writeText(text).then(function() {
    if (btn && btn.classList) {
      btn.textContent = copiedLabel;
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = copyLabel;
        btn.classList.remove('copied');
      }, 1200);
    }
    toast('Return value template copied', 'success');
  }).catch(function() {
    toast('Failed to copy — try selecting manually', 'error');
  });
}
`;
