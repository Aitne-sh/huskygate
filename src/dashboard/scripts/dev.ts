/** @module dashboard/scripts/dev — Client-side script for the Developer Aliases tab. */
export const devScript = `
    /* ── Dev ── */
    var devEditingAlias = null;

    async function devLoadAliases() {
      var aliases = await fetchApi('/api/dev-aliases');
      if (!aliases) aliases = [];
      var el = document.getElementById('dev-alias-list');
      if (aliases.length === 0) {
        el.innerHTML = '<div class="card" style="text-align:center;color:var(--text-dim);padding:2rem;">No developer aliases configured yet.</div>';
        return;
      }
      // Store alias data for edit modal access
      window._devAliasData = {};
      var html = '<div class="card table-wrap"><table><thead><tr><th></th><th>Name</th><th>Tool</th><th>Path</th><th>Instruction</th><th>Created</th><th></th></tr></thead><tbody>';
      for (var i = 0; i < aliases.length; i++) {
        var a = aliases[i];
        window._devAliasData[a.name] = a;
        var hasInstruction = a.instructionContent ? '<span class="badge badge-active" style="font-size:0.65rem;">Configured</span>' : '<span class="badge badge-inactive" style="font-size:0.65rem;">None</span>';
        html += '<tr>'
          + '<td><button class="expand-btn" onclick="devToggleAudit(this,\\'' + escapeInlineJsArg(a.name) + '\\')">&blacktriangleright;</button></td>'
          + '<td><code>' + escapeHtml(a.name) + '</code></td>'
          + '<td><span class="badge badge-tool">' + escapeHtml(a.tool) + '</span></td>'
          + '<td>' + escapeHtml(a.path) + '</td>'
          + '<td>' + hasInstruction + '</td>'
          + '<td>' + escapeHtml(a.createdAt) + '</td>'
          + '<td style="display:flex;gap:0.3rem;">'
          + '<button class="btn" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="devEditAlias(\\'' + escapeInlineJsArg(a.name) + '\\')">Edit</button>'
          + '<button class="btn btn-danger" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="devDeleteAlias(\\'' + escapeInlineJsArg(a.name) + '\\')">Delete</button>'
          + '</td></tr>';
        html += '<tr class="audit-row" id="dev-audit-' + escapeHtml(a.name) + '"><td colspan="7" class="audit-cell"><div id="dev-audit-data-' + escapeHtml(a.name) + '">Loading...</div></td></tr>';
      }
      html += '</tbody></table></div>';
      el.innerHTML = html;
    }

    function devBrowsePath() {
      pickDirectory('dev-input-path');
    }

    var DEV_TOOL_INSTRUCTION_FILE = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' };

    function devUpdateInstructionLabel() {
      var tool = document.getElementById('dev-input-tool').value;
      var filename = DEV_TOOL_INSTRUCTION_FILE[tool] || 'CLAUDE.md';
      document.getElementById('dev-instruction-label').textContent = filename;
      var spans = document.querySelectorAll('.dev-instruction-filename');
      for (var i = 0; i < spans.length; i++) spans[i].textContent = filename;
    }

    var _devInstructionEnabled = false;

    function devSetInstructionMode(mode) {
      _devInstructionEnabled = (mode === 'generate');
      document.getElementById('dev-toggle-generate').className = _devInstructionEnabled ? 'active' : '';
      document.getElementById('dev-toggle-skip').className = _devInstructionEnabled ? '' : 'active';
      var textarea = document.getElementById('dev-input-instruction');
      textarea.disabled = !_devInstructionEnabled;
      textarea.style.opacity = _devInstructionEnabled ? '1' : '0.4';
    }

    function devShowCreateModal() {
      devEditingAlias = null;
      document.getElementById('dev-modal-title').textContent = 'New Developer Alias';
      document.getElementById('dev-input-name').value = '';
      document.getElementById('dev-input-name').disabled = false;
      document.getElementById('dev-input-path').value = '';
      document.getElementById('dev-input-tool').value = 'claude';
      document.getElementById('dev-input-instruction').value = '';
      document.getElementById('dev-modal-save').textContent = 'Create';
      document.getElementById('dev-modal').style.display = 'flex';
      devUpdateInstructionLabel();
      devSetInstructionMode('skip');
    }

    function devShowEditModal(name, path, tool, instructionContent) {
      devEditingAlias = name;
      document.getElementById('dev-modal-title').textContent = 'Edit: ' + name;
      document.getElementById('dev-input-name').value = name;
      document.getElementById('dev-input-name').disabled = true;
      document.getElementById('dev-input-path').value = path;
      document.getElementById('dev-input-tool').value = tool;
      document.getElementById('dev-input-instruction').value = instructionContent || '';
      document.getElementById('dev-modal-save').textContent = 'Save';
      document.getElementById('dev-modal').style.display = 'flex';
      devUpdateInstructionLabel();
      devSetInstructionMode(instructionContent ? 'generate' : 'skip');
    }

    function devCloseModal() {
      document.getElementById('dev-modal').style.display = 'none';
      devEditingAlias = null;
    }

    function devEditAlias(name) {
      var data = (window._devAliasData || {})[name];
      if (!data) return;
      devShowEditModal(data.name, data.path, data.tool, data.instructionContent);
    }

    async function devSaveAlias(createPath) {
      var name = document.getElementById('dev-input-name').value.trim();
      var devPath = document.getElementById('dev-input-path').value.trim();
      var tool = document.getElementById('dev-input-tool').value;
      var instructionContent = _devInstructionEnabled ? document.getElementById('dev-input-instruction').value : null;
      if (!name || !devPath) { toast('Name and path are required', 'error'); return; }
      var payload = devEditingAlias
        ? { path: devPath, tool: tool, instructionContent: instructionContent || null }
        : { name: name, path: devPath, tool: tool, instructionContent: instructionContent || null };
      if (createPath) payload.createPath = true;
      var url = devEditingAlias
        ? '/api/dev-aliases/' + encodeURIComponent(devEditingAlias)
        : '/api/dev-aliases';
      var method = devEditingAlias ? 'PUT' : 'POST';
      try {
        var res = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
          body: JSON.stringify(payload)
        });
        var d = await res.json();
        if (!res.ok) {
          if (d.pathNotFound) {
            var resolvedInfo = d.resolvedPath ? ' (' + d.resolvedPath + ')' : '';
            var action = confirm('Path does not exist' + resolvedInfo + '.\\n\\nClick OK to create the directory, or Cancel to fix the path.');
            if (action) { devSaveAlias(true); }
            return;
          }
          toast(d.error || 'Request failed', 'error');
          return;
        }
        if (devEditingAlias) {
          if (d.success) { toast('Alias updated'); devCloseModal(); devLoadAliases(); }
        } else {
          if (d.name) { toast('Alias created'); devCloseModal(); devLoadAliases(); }
        }
      } catch (e) { toast('Network error', 'error'); }
    }

    async function devDeleteAlias(name) {
      if (!confirm('Delete developer alias "' + name + '"?')) return;
      var d = await fetchApi('/api/dev-aliases/' + encodeURIComponent(name), { method: 'DELETE' });
      if (d && d.success) { toast('Alias deleted'); devLoadAliases(); }
    }

    async function devToggleAudit(btn, aliasName) {
      var row = document.getElementById('dev-audit-' + aliasName);
      if (!row) return;
      if (row.classList.contains('open')) {
        row.classList.remove('open');
        btn.innerHTML = '&blacktriangleright;';
        return;
      }
      row.classList.add('open');
      btn.innerHTML = '&blacktriangledown;';
      var div = document.getElementById('dev-audit-data-' + aliasName);
      var d = await fetchApi('/api/dev-aliases/' + encodeURIComponent(aliasName) + '/audit');
      if (!d) { div.textContent = 'Failed to load audit'; return; }
      var summary = d.summary || {};
      var jobs = d.jobs || [];
      var summaryLine = summary.total + ' jobs';
      if (summary.failed > 0) summaryLine += ' \\u00b7 ' + summary.failed + ' error' + (summary.failed > 1 ? 's' : '');
      if (summary.lastRun) summaryLine += ' \\u00b7 Last run: ' + summary.lastRun;
      if (jobs.length === 0) {
        div.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;">No job history</div>';
        return;
      }
      var h = '<div style="color:var(--text-muted);font-size:0.82rem;margin-bottom:0.5rem;">' + escapeHtml(summaryLine) + '</div>';
      h += '<table class="audit-table"><thead><tr><th>Job</th><th>Tool</th><th>Mode</th><th>Started</th><th>Ended</th><th>Exit</th><th>Error</th></tr></thead><tbody>';
      for (var i = 0; i < jobs.length; i++) {
        var r = jobs[i];
        h += '<tr><td><code>' + escapeHtml((r.jobId || '').substring(0, 8)) + '</code></td>'
          + '<td>' + escapeHtml(r.tool || '') + '</td>'
          + '<td>' + escapeHtml(r.mode || '') + '</td>'
          + '<td>' + escapeHtml(r.startedAt || '-') + '</td>'
          + '<td>' + escapeHtml(r.endedAt || '-') + '</td>'
          + '<td>' + escapeHtml(r.exitCode != null ? String(r.exitCode) : '-') + '</td>'
          + '<td>' + escapeHtml(r.errorKind || '-') + '</td></tr>';
      }
      h += '</tbody></table>';
      div.innerHTML = h;
    }
`;
