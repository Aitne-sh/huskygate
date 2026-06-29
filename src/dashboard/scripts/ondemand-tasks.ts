/** @module dashboard/scripts/ondemand-tasks — Client-side script for the On-Demand Tasks tab. */
export const ondemandTasksScript = `
    /* ── On-Demand Tasks ── */

    var qtEditingId = null;
    var qtEditingUpdatedAt = null;
    var qtChannelsCache = null;
    var qtRunsCache = {};

    /* Aliases to shared icons/helpers defined in helpers.ts */
    var QT_ICON = SHARED_ICON;
    var qtToolBadge = sharedToolBadge;

    async function qtLoadTasks() {
      var el = document.getElementById('qt-task-list');
      if (!el) return;
      el.innerHTML = '<div class="loading">Loading on-demand tasks...</div>';
      try {
        var d = await fetchApi('/api/ondemand-tasks');
        if (!d || !d.data) { el.innerHTML = '<div class="empty-state">Failed to load tasks.</div>'; return; }
        var tasks = d.data;
        if (tasks.length === 0) {
          el.innerHTML = '<div class="empty-state">No on-demand tasks yet. Click "+ New Task" to create one.</div>';
          return;
        }
        el.innerHTML = qtBuildTaskCard(tasks);
      } catch (err) {
        el.innerHTML = '<div class="empty-state">Failed to load tasks: ' + escapeHtml(String(err)) + '</div>';
      }
    }

    function qtBuildTaskCard(tasks) {
      var html = '<div class="card sched-card-section sched-card-active">'
        + '<div class="sched-card-header">'
        + '<span>Tasks</span>'
        + '<span class="sched-section-count">' + tasks.length + '</span>'
        + '</div>'
        + '<div class="table-wrap"><table><thead><tr>'
        + '<th>Name</th><th>Tool</th><th>Alias</th><th>Runs</th><th style="width:120px;">Actions</th>'
        + '</tr></thead><tbody>'
        + qtBuildTaskRows(tasks)
        + '</tbody></table></div></div>';
      return html;
    }

    function qtBuildTaskRows(tasks) {
      var html = '';
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        var safeId = escapeHtml(t.id);
        var jsId = escapeInlineJsArg(t.id);
        var snippet = t.description || t.prompt || '';
        var snippetText = snippet.slice(0, 60) + (snippet.length > 60 ? '...' : '');
        var aliasHtml = t.alias
          ? '<code style="font-size:0.82rem;">' + escapeHtml(t.alias) + '</code>'
          : '<span style="color:var(--text-dim);">—</span>';
        var lastRun = t.lastRunAt
          ? '<br><span style="font-size:0.7rem;color:var(--text-dim);">Last: ' + new Date(t.lastRunAt).toLocaleString() + '</span>'
          : '';

        html += '<tr class="sched-task-row" data-task-id="' + safeId + '" onclick="qtToggleHistory(this)">'
          + '<td><strong>' + escapeHtml(t.name) + '</strong><br><span style="font-size:0.75rem;color:var(--text-dim);">' + escapeHtml(snippetText) + '</span></td>'
          + '<td>' + qtToolBadge(t.tool) + '</td>'
          + '<td>' + aliasHtml + '</td>'
          + '<td>' + t.runCount + lastRun + '</td>'
          + '<td onclick="event.stopPropagation()">'
          + '<button class="action-btn" onclick="qtExecute(\\'' + jsId + '\\')" title="Execute">' + QT_ICON.play + '</button>'
          + '<button class="action-btn" onclick="qtEdit(\\'' + jsId + '\\')" title="Edit">' + QT_ICON.edit + '</button>'
          + '<button class="action-btn action-btn-danger" onclick="qtDelete(\\'' + jsId + '\\')" title="Delete">' + QT_ICON.trash + '</button>'
          + '</td></tr>';
      }
      return html;
    }

    async function qtRefreshSkillsSection(enabledSkills) {
      var skillsEl = document.getElementById('qt-skills-section');
      var tool = (document.getElementById('qt-input-tool') || {}).value || 'claude';
      if (!skillsEl) return;
      await ensureAvailableSkills(tool);
      skillsEl.innerHTML = buildSkillsSectionHtml('qt', enabledSkills, tool);
    }

    async function qtShowCreateModal() {
      qtEditingId = null;
      qtEditingUpdatedAt = null;
      document.getElementById('qt-modal-title').textContent = 'New On-Demand Task';
      document.getElementById('qt-modal-save').textContent = 'Create';
      document.getElementById('qt-input-id').value = '';
      document.getElementById('qt-input-name').value = '';
      document.getElementById('qt-input-alias').value = '';
      document.getElementById('qt-input-description').value = '';
      document.getElementById('qt-input-tool').value = 'claude';
      var modelFieldEl = document.getElementById('qt-model-field');
      if (modelFieldEl) modelFieldEl.innerHTML = modelFieldHtml('qt-input-model', 'claude', '');
      document.getElementById('qt-input-prompt').value = '';
      document.getElementById('qt-input-workdir').value = '';
      document.getElementById('qt-input-max-retries').value = '0';
      var mcpEl = document.getElementById('qt-mcp-section');
      if (mcpEl) mcpEl.innerHTML = buildMcpSectionHtml('qt', false);
      await qtRefreshSkillsSection(null);
      document.getElementById('qt-input-instruction-file').value = '';
      var notifySel = document.getElementById('qt-input-notify-select');
      if (notifySel) notifySel.value = '';
      var notifyManual = document.getElementById('qt-input-notify-manual');
      if (notifyManual) { notifyManual.value = ''; notifyManual.style.display = 'none'; }
      var ntEl = document.getElementById('qt-input-notify-thread');
      if (ntEl) ntEl.value = '';
      // Reset agent selector
      var agentSel = document.getElementById('qt-input-agent');
      if (agentSel) agentSel.value = '';
      handleAgentSelectionChange('qt');
      populateAgentSelector('qt', null);
      document.getElementById('qt-modal').style.display = 'flex';
      qtLoadChannels();
    }

    function qtCloseModal() {
      document.getElementById('qt-modal').style.display = 'none';
      qtEditingId = null;
    }

    function qtGetNotifyChannel() {
      var sel = document.getElementById('qt-input-notify-select');
      if (sel && sel.style.display !== 'none') {
        if (sel.value === '__manual__') {
          var manual = document.getElementById('qt-input-notify-manual');
          return manual ? manual.value.trim() : '';
        }
        return sel.value;
      }
      var manual = document.getElementById('qt-input-notify-manual');
      return manual ? manual.value.trim() : '';
    }

    async function qtLoadChannels() {
      try {
        var sel = document.getElementById('qt-input-notify-select');
        var manual = document.getElementById('qt-input-notify-manual');
        if (!sel || !manual) return;
        if (qtChannelsCache) { qtRenderChannels(sel, manual, qtChannelsCache); return; }
        var d = await fetchApi('/api/slack/targets', {}, true);
        if (d && d.data && d.data.length) {
          qtChannelsCache = d.data;
          qtRenderChannels(sel, manual, d.data);
        } else {
          sel.style.display = 'none';
          manual.style.display = '';
          manual.value = '';
        }
      } catch (err) {
        var sel = document.getElementById('qt-input-notify-select');
        var manual = document.getElementById('qt-input-notify-manual');
        if (sel) sel.style.display = 'none';
        if (manual) manual.style.display = '';
      }
    }

    function qtRenderChannels(sel, manual, targets) {
      var current = sel.value || '';
      sel.style.display = '';
      manual.style.display = 'none';
      while (sel.options.length > 0) sel.remove(0);

      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'None';
      sel.appendChild(placeholder);

      for (var i = 0; i < targets.length; i++) {
        var opt = document.createElement('option');
        opt.value = targets[i].id;
        opt.textContent = targets[i].type === 'user'
          ? '\\u{1F464} ' + targets[i].name + ' (DM)'
          : '#' + targets[i].name;
        sel.appendChild(opt);
      }

      var manualOpt = document.createElement('option');
      manualOpt.value = '__manual__';
      manualOpt.textContent = 'Enter ID manually';
      sel.appendChild(manualOpt);

      if (current) sel.value = current;
      sel.onchange = function() {
        if (sel.value === '__manual__') { manual.style.display = ''; manual.focus(); }
        else { manual.style.display = 'none'; manual.value = ''; }
      };
    }

    async function qtSaveTask() {
      try {
        var name = document.getElementById('qt-input-name').value.trim();
        var alias = document.getElementById('qt-input-alias').value.trim();
        var description = document.getElementById('qt-input-description').value.trim();
        var tool = document.getElementById('qt-input-tool').value;
        var modelInput = document.getElementById('qt-input-model');
        var model = modelInput ? modelInput.value.trim() : '';
        var prompt = document.getElementById('qt-input-prompt').value.trim();
        var maxRetries = parseInt(document.getElementById('qt-input-max-retries').value || '0', 10);
        var notifyChannel = qtGetNotifyChannel();

        if (!name) { toast('Name is required', 'error'); return; }
        if (!prompt) { toast('Prompt is required', 'error'); return; }

        var execPolicy = readExecutionPolicy('qt');
        var workdir = document.getElementById('qt-input-workdir').value.trim();
        var instrFile = document.getElementById('qt-input-instruction-file').value.trim();
        var notifyThread = (document.getElementById('qt-input-notify-thread') || {}).value || '';
        var payload = {
          name: name,
          alias: alias || null,
          description: description || null,
          tool: tool,
          model: model || null,
          prompt: prompt,
          workdir: workdir || null,
          maxRetries: maxRetries,
          allowMcp: execPolicy.allowMcp,
          enabledSkills: execPolicy.enabledSkills,
          instructionFile: instrFile || null,
          notifyChannel: notifyChannel || null,
          notifyThread: notifyThread.trim() || null
        };
        // Apply agent selection + snapshot agent values for fallback
        await applyAgentToPayload('qt', payload);

        var url = qtEditingId ? '/api/ondemand-tasks/' + qtEditingId : '/api/ondemand-tasks';
        var method = qtEditingId ? 'PATCH' : 'POST';
        if (qtEditingId && qtEditingUpdatedAt) payload.updatedAt = qtEditingUpdatedAt;
        var d = await fetchApi(url, { method: method, body: JSON.stringify(payload) });
        if (d && d.ok) {
          toast(qtEditingId ? 'Task updated' : 'Task created', 'success');
          qtCloseModal();
          qtLoadTasks();
        } else {
          toast((d && d.error) || 'Failed to save task', 'error');
        }
      } catch (err) {
        toast('Error saving task: ' + String(err), 'error');
      }
    }

    async function qtEdit(id) {
      try {
        var d = await fetchApi('/api/ondemand-tasks/' + id);
        if (!d || !d.data) { toast('Failed to load task', 'error'); return; }
        var t = d.data;
        qtEditingId = id;
        qtEditingUpdatedAt = t.updatedAt || null;
        document.getElementById('qt-modal-title').textContent = 'Edit On-Demand Task';
        document.getElementById('qt-modal-save').textContent = 'Save';
        document.getElementById('qt-input-id').value = t.id;
        document.getElementById('qt-input-name').value = t.name || '';
        document.getElementById('qt-input-alias').value = t.alias || '';
        document.getElementById('qt-input-description').value = t.description || '';
        document.getElementById('qt-input-tool').value = t.tool || 'claude';
        var modelFieldEl2 = document.getElementById('qt-model-field');
        if (modelFieldEl2) modelFieldEl2.innerHTML = modelFieldHtml('qt-input-model', t.tool || 'claude', t.model || '');
        document.getElementById('qt-input-prompt').value = t.prompt || '';
        document.getElementById('qt-input-workdir').value = t.workdir || '';
        document.getElementById('qt-input-max-retries').value = String(t.maxRetries || 0);
        var mcpEl2 = document.getElementById('qt-mcp-section');
        if (mcpEl2) mcpEl2.innerHTML = buildMcpSectionHtml('qt', t.allowMcp);
        await qtRefreshSkillsSection(t.enabledSkills);
        document.getElementById('qt-input-instruction-file').value = t.instructionFile || '';
        var ntEditEl = document.getElementById('qt-input-notify-thread');
        if (ntEditEl) ntEditEl.value = t.notifyThread || '';
        // Populate agent selector with existing agentId
        await populateAgentSelector('qt', t.agentId || null);
        document.getElementById('qt-modal').style.display = 'flex';
        await qtLoadChannels();
        var notifySel = document.getElementById('qt-input-notify-select');
        if (t.notifyChannel) {
          notifySel.value = t.notifyChannel;
          if (!notifySel.value || notifySel.value !== t.notifyChannel) {
            notifySel.value = '__manual__';
            document.getElementById('qt-input-notify-manual').style.display = '';
            document.getElementById('qt-input-notify-manual').value = t.notifyChannel;
          }
        } else {
          notifySel.value = '';
        }
      } catch (err) {
        toast('Error loading task: ' + String(err), 'error');
      }
    }

    async function qtDelete(id) {
      if (!confirm('Delete this on-demand task?')) return;
      try {
        var d = await fetchApi('/api/ondemand-tasks/' + id, { method: 'DELETE' });
        if (d && d.ok) {
          toast('Task deleted', 'success');
          qtLoadTasks();
        } else {
          toast((d && d.error) || 'Failed to delete task', 'error');
        }
      } catch (err) {
        toast('Error deleting task: ' + String(err), 'error');
      }
    }

    async function qtExecute(id) {
      /* Swap execute button to spinning state immediately */
      var row = document.querySelector('[data-task-id="' + id + '"]');
      var execBtn = row ? row.querySelector('.action-btn[title="Execute"]') : null;
      var origHtml = '';
      if (execBtn) {
        origHtml = execBtn.innerHTML;
        execBtn.innerHTML = QT_ICON.loader;
        execBtn.classList.add('action-btn-running');
      }

      try {
        var d = await fetchApi('/api/ondemand-tasks/' + id + '/execute', { method: 'POST' });
        if (d && d.ok) {
          toast('Task execution started', 'success');
          /* Keep spinner visible briefly, then refresh list */
          setTimeout(function() { qtLoadTasks(); }, 2000);
        } else {
          toast((d && d.error) || 'Failed to execute task', 'error');
          /* Restore button on failure */
          if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
        }
      } catch (err) {
        toast('Error executing task: ' + String(err), 'error');
        if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
      }
    }

    function qtToggleHistory(rowEl) {
      var taskId = rowEl.getAttribute('data-task-id');
      var existing = document.getElementById('qt-hist-' + taskId);

      /* Close any other open panels */
      document.querySelectorAll('.qt-history-panel').forEach(function(el) {
        if (el.id !== 'qt-hist-' + taskId) {
          el.style.maxHeight = '0';
          el.style.opacity = '0';
          var parentRow = el.closest('tr');
          if (parentRow) setTimeout(function() { parentRow.remove(); }, 250);
          var prevRow = document.querySelector('.sched-task-row.expanded');
          if (prevRow && prevRow !== rowEl) prevRow.classList.remove('expanded');
        }
      });

      /* Toggle: if already open, close it */
      if (existing) {
        existing.style.maxHeight = '0';
        existing.style.opacity = '0';
        rowEl.classList.remove('expanded');
        setTimeout(function() { var p = existing.closest('tr'); if (p) p.remove(); }, 250);
        return;
      }

      rowEl.classList.add('expanded');

      /* Insert detail row */
      var detailRow = document.createElement('tr');
      detailRow.className = 'task-history-row';
      var colCount = rowEl.cells.length;
      var td = document.createElement('td');
      td.colSpan = colCount;
      td.style.padding = '0';
      td.style.border = 'none';
      td.innerHTML = '<div id="qt-hist-' + escapeHtml(taskId) + '" class="qt-history-panel task-history-panel">'
        + '<div class="task-history-inner"><div class="loading" style="padding:1rem;">Loading history...</div></div></div>';
      detailRow.appendChild(td);
      rowEl.parentNode.insertBefore(detailRow, rowEl.nextSibling);

      /* Animate open */
      var panel = document.getElementById('qt-hist-' + taskId);
      requestAnimationFrame(function() {
        panel.style.maxHeight = '600px';
        panel.style.opacity = '1';
      });

      /* Fetch and render */
      qtLoadHistory(taskId, panel.querySelector('.task-history-inner'));
    }

    async function qtLoadHistory(taskId, container) {
      try {
        var data = await fetchApi('/api/ondemand-tasks/' + taskId + '/runs?limit=20');
        if (!data) { container.innerHTML = '<div class="empty-state" style="padding:1rem;">Failed to load history.</div>'; return; }
        var runs = data.data || [];

        qtRunsCache[taskId] = runs;

        if (runs.length === 0) {
          container.innerHTML = '<div class="task-history-empty">' + QT_ICON.clock + '<span>No executions yet</span></div>';
          return;
        }

        var statusIcon = function(s) {
          var icons = { completed: QT_ICON.checkCircle, failed: QT_ICON.xCircle, timeout: QT_ICON.alertCircle, running: QT_ICON.loader, pending: QT_ICON.clock };
          return '<span class="status-icon">' + (icons[s] || escapeHtml(s)) + '</span>';
        };

        var html = '<div class="task-history-title-bar">'
          + '<span>' + QT_ICON.history + ' Execution History</span>'
          + '<span class="task-history-count">' + runs.length + ' run' + (runs.length !== 1 ? 's' : '') + '</span>'
          + '</div>';
        html += '<table class="task-history-table">'
          + '<colgroup><col class="sh-num"><col class="sh-started"><col class="sh-status"><col class="sh-source"><col class="sh-duration"><col></colgroup>'
          + '<thead><tr>'
          + '<th>#</th><th>Started</th><th>Status</th><th>Source</th><th>Duration</th><th>Output</th>'
          + '</tr></thead><tbody>';

        for (var i = 0; i < runs.length; i++) {
          var r = runs[i];
          var started = r.startedAt ? new Date(r.startedAt).toLocaleString() : '—';
          var duration = '—';
          if (r.endedAt && r.startedAt) {
            var ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
            duration = (ms / 1000).toFixed(1) + 's';
          }
          var fullText = r.outputSummary || '';
          var errorText = r.errorMessage || '';
          var outputCell = '';
          var runIdx = 'qt-out-' + escapeHtml(taskId) + '-' + i;
          var jsRunIdx = escapeInlineJsArg(runIdx);
          if (fullText) {
            var preview = fullText.length > 120 ? fullText.substring(0, 120) + '...' : fullText;
            outputCell = '<span id="' + runIdx + '-preview">' + escapeHtml(preview) + '</span>';
            if (fullText.length > 120) {
              outputCell += '<span id="' + runIdx + '-full" class="qt-output-full" style="display:none;">' + escapeHtml(fullText) + '</span>';
              outputCell += ' <button class="qt-output-toggle" onclick="event.stopPropagation();qtToggleOutput(\\'' + jsRunIdx + '\\')">[Show all]</button>';
            }
          } else if (errorText) {
            var errPreview = errorText.length > 120 ? errorText.substring(0, 120) + '...' : errorText;
            outputCell = '<span id="' + runIdx + '-preview" style="color:var(--red);">' + escapeHtml(errPreview) + '</span>';
            if (errorText.length > 120) {
              outputCell += '<span id="' + runIdx + '-full" class="qt-output-full" style="display:none;color:var(--red);">' + escapeHtml(errorText) + '</span>';
              outputCell += ' <button class="qt-output-toggle" onclick="event.stopPropagation();qtToggleOutput(\\'' + jsRunIdx + '\\')">[Show all]</button>';
            }
          } else {
            outputCell = '—';
          }

          var retryBadge = r.retryCount > 0
            ? ' <span class="badge badge-retry badge-sm">retry ' + r.retryCount + '</span>'
            : '';

          var sourceBadge = sharedSourceBadge(r.source);

          html += '<tr class="qt-history-run-row" onclick="event.stopPropagation();qtShowRunDetail(\\'' + escapeInlineJsArg(taskId) + '\\',' + i + ')">'
            + '<td>' + (runs.length - i) + '</td>'
            + '<td>' + escapeHtml(started) + '</td>'
            + '<td>' + statusIcon(r.status) + ' ' + escapeHtml(r.status) + retryBadge + '</td>'
            + '<td>' + sourceBadge + '</td>'
            + '<td>' + escapeHtml(duration) + '</td>'
            + '<td class="task-history-output">' + outputCell + '</td>'
            + '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;

        /* Re-measure for smoother animation */
        var panel = container.parentElement;
        if (panel) panel.style.maxHeight = Math.min(container.scrollHeight + 8, 600) + 'px';
      } catch (err) {
        container.innerHTML = '<div class="task-history-empty">Failed to load history.</div>';
      }
    }

    function qtToggleOutput(runIdx) {
      var preview = document.getElementById(runIdx + '-preview');
      var full = document.getElementById(runIdx + '-full');
      var btn = preview ? preview.parentElement.querySelector('.qt-output-toggle') : null;
      if (!preview || !full) return;
      var isExpanded = full.style.display !== 'none';
      if (isExpanded) {
        preview.style.display = '';
        full.style.display = 'none';
        if (btn) btn.textContent = '[Show all]';
      } else {
        preview.style.display = 'none';
        full.style.display = '';
        if (btn) btn.textContent = '[Collapse]';
      }
      /* Re-measure panel height after expand/collapse */
      var panel = preview.closest('.qt-history-panel');
      if (panel) {
        var inner = panel.querySelector('.task-history-inner');
        panel.style.maxHeight = inner ? Math.min(inner.scrollHeight + 8, 2000) + 'px' : '2000px';
      }
    }

    function qtShowRunDetail(taskId, runIndex) {
      showRunDetailFromCache(qtRunsCache, taskId, runIndex);
    }

    /* Attach agent selector change handler */
    (function() {
      var sel = document.getElementById('qt-input-agent');
      if (sel) sel.onchange = function() { handleAgentSelectionChange('qt'); };
      var toolSel = document.getElementById('qt-input-tool');
      if (toolSel) {
        toolSel.onchange = function() {
          updateModelPlaceholder('qt-input-model', toolSel.value);
          void qtRefreshSkillsSection(readSkillsOnly('qt'));
        };
      }
    })();
`;
