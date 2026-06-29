/** @module dashboard/scripts/triggered-tasks — Client-side script for the Triggered Tasks tab. */
export const triggeredTasksScript = `
    /* ── Triggered Tasks ── */

    var ttEditingId = null;
    var ttEditingUpdatedAt = null;
    var ttChannelsCache = null;
    var ttRunsCache = {};
    var ttCurrentSub = null;

    var TT_ICON = SHARED_ICON;
    var ttToolBadge = sharedToolBadge;

    function ttToggleWebhookFields() {
      var ep = document.getElementById('tt-input-endpoint');
      var show = ep && ep.value;
      var filterRow = document.getElementById('tt-row-filter');
      var mappingRow = document.getElementById('tt-row-mapping');
      if (filterRow) filterRow.style.display = show ? '' : 'none';
      if (mappingRow) mappingRow.style.display = show ? '' : 'none';
      if (show && ep.value) {
        var selectedEp = evtLookupById(evtEndpoints, ep.value);
        if (selectedEp && typeof evtUpdateTriggerPlaceholders === 'function') {
          evtUpdateTriggerPlaceholders(selectedEp.publisherPreset);
        }
      }
    }

    async function ttPopulateEndpointDropdown(selectedId) {
      var sel = document.getElementById('tt-input-endpoint');
      if (!sel) return;
      await evtRefreshEndpointsOnly();
      while (sel.options.length > 1) sel.remove(1);
      for (var i = 0; i < evtEndpoints.length; i++) {
        var ep = evtEndpoints[i];
        var opt = document.createElement('option');
        opt.value = ep.id;
        opt.textContent = ep.publisherPreset + ' \\u00b7 ' + (ep.path || ep.id.substring(0, 12));
        sel.appendChild(opt);
      }
      if (selectedId) sel.value = selectedId;
      ttToggleWebhookFields();
    }

    async function ttLoadTasks() {
      var el = document.getElementById('tt-task-list');
      if (!el) return;
      el.innerHTML = '<div class="loading">Loading triggered tasks...</div>';
      try {
        var results = await Promise.all([
          fetchApi('/api/triggered-tasks'),
          evtRefreshCollections()
        ]);
        var d = results[0];
        if (!d || !Array.isArray(d.data)) {
          el.innerHTML = '<div class="empty-state">Failed to load triggered tasks.</div>';
          return;
        }
        var tasks = d.data;
        if (tasks.length === 0) {
          el.innerHTML = '<div class="empty-state">No triggered tasks yet. Click "+ New Task" to create one.</div>';
          return;
        }
        el.innerHTML = ttBuildTaskCard(tasks);
      } catch (err) {
        el.innerHTML = '<div class="empty-state">Failed to load triggered tasks: ' + escapeHtml(String(err)) + '</div>';
      }
    }

    function ttBuildTaskCard(tasks) {
      return '<div class="card sched-card-section sched-card-active">'
        + '<div class="sched-card-header">'
        + '<span>Triggered Tasks</span>'
        + '<span class="sched-section-count">' + tasks.length + '</span>'
        + '</div>'
        + '<div class="table-wrap"><table><thead><tr>'
        + '<th>Name</th><th>Tool</th><th>Concurrency</th><th>Status</th><th>Runs</th><th style="width:170px;">Actions</th>'
        + '</tr></thead><tbody>'
        + ttBuildTaskRows(tasks)
        + '</tbody></table></div></div>';
    }

    function ttBuildTaskRows(tasks) {
      var html = '';
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        var safeId = escapeHtml(t.id);
        var jsId = escapeInlineJsArg(t.id);
        var snippet = t.description || t.prompt || '';
        var snippetText = snippet.slice(0, 72) + (snippet.length > 72 ? '...' : '');

        var endpointLabel = ttResolveEndpointLabel(t.id);
        var nameCell = '<strong>' + escapeHtml(t.name) + '</strong>';
        if (endpointLabel) {
          nameCell += '<div style="font-size:0.7rem;color:var(--blue-action);margin-top:0.15rem;">'
            + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:2px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
            + escapeHtml(endpointLabel) + '</div>';
        } else {
          nameCell += '<div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.12rem;">' + escapeHtml(snippetText) + '</div>';
        }

        var concurrencyBadge = t.concurrencyPolicy === 'allow'
          ? '<span class="badge badge-parallel">Allow parallel</span>'
          : '<span class="badge badge-skip-running">Skip if running</span>';
        var statusBadge = t.enabled
          ? '<span class="badge badge-enabled">Enabled</span>'
          : '<span class="badge badge-disabled">Disabled</span>';
        var lastRun = t.lastRunAt
          ? '<br><span style="font-size:0.7rem;color:var(--text-dim);">Last: ' + new Date(t.lastRunAt).toLocaleString() + '</span>'
          : '';
        var toggleTitle = t.enabled ? 'Disable' : 'Enable';
        var toggleIcon = t.enabled ? TT_ICON.pause : TT_ICON.checkCircle;

        html += '<tr class="sched-task-row" data-task-id="' + safeId + '" onclick="ttToggleHistory(this)">'
          + '<td>' + nameCell + '</td>'
          + '<td>' + ttToolBadge(t.tool) + '</td>'
          + '<td>' + concurrencyBadge + '</td>'
          + '<td>' + statusBadge + '</td>'
          + '<td>' + (t.runCount || 0) + lastRun + '</td>'
          + '<td onclick="event.stopPropagation()">'
          + '<button class="action-btn" onclick="ttExecute(\\'' + jsId + '\\')" title="Test Run">' + TT_ICON.play + '</button>'
          + '<button class="action-btn" onclick="ttSetEnabled(\\'' + jsId + '\\',' + (!t.enabled ? 'true' : 'false') + ')" title="' + toggleTitle + '">' + toggleIcon + '</button>'
          + '<button class="action-btn" onclick="ttEdit(\\'' + jsId + '\\')" title="Edit">' + TT_ICON.edit + '</button>'
          + '<button class="action-btn action-btn-danger" onclick="ttDelete(\\'' + jsId + '\\')" title="Delete">' + TT_ICON.trash + '</button>'
          + '</td></tr>';
      }
      return html;
    }

    function ttResolveEndpointLabel(taskId) {
      for (var i = 0; i < evtSubscriptions.length; i++) {
        var s = evtSubscriptions[i];
        if (s.targetType === 'triggered_task' && s.triggeredTaskId === taskId) {
          return evtDescribeEndpointShort(s.endpointId) || 'webhook';
        }
      }
      return null;
    }

    async function ttRefreshSkillsSection(enabledSkills) {
      var skillsEl = document.getElementById('tt-skills-section');
      var tool = (document.getElementById('tt-input-tool') || {}).value || 'claude';
      if (!skillsEl) return;
      await ensureAvailableSkills(tool);
      skillsEl.innerHTML = buildSkillsSectionHtml('tt', enabledSkills, tool);
    }

    async function ttShowCreateModal() {
      ttEditingId = null;
      ttEditingUpdatedAt = null;
      ttCurrentSub = null;
      document.getElementById('tt-modal-title').textContent = 'New Triggered Task';
      document.getElementById('tt-modal-save').textContent = 'Create';
      document.getElementById('tt-input-id').value = '';
      document.getElementById('tt-input-name').value = '';
      document.getElementById('tt-input-description').value = '';
      document.getElementById('tt-input-tool').value = 'claude';
      var ttModelEl = document.getElementById('tt-model-field');
      if (ttModelEl) ttModelEl.innerHTML = modelFieldHtml('tt-input-model', 'claude', '');
      document.getElementById('tt-input-prompt').value = '';
      document.getElementById('tt-input-workdir').value = '';
      document.getElementById('tt-input-max-retries').value = '0';
      document.getElementById('tt-input-concurrency-policy').value = 'skip_if_running';
      document.getElementById('tt-input-enabled').checked = true;
      var mcpEl = document.getElementById('tt-mcp-section');
      if (mcpEl) mcpEl.innerHTML = buildMcpSectionHtml('tt', false);
      await ttRefreshSkillsSection(null);
      document.getElementById('tt-input-instruction-file').value = '';
      var notifySel = document.getElementById('tt-input-notify-select');
      if (notifySel) notifySel.value = '';
      var notifyManual = document.getElementById('tt-input-notify-manual');
      if (notifyManual) { notifyManual.value = ''; notifyManual.style.display = 'none'; }
      var ntEl = document.getElementById('tt-input-notify-thread');
      if (ntEl) ntEl.value = '';
      document.getElementById('tt-input-endpoint').value = '';
      document.getElementById('tt-input-filter-json').value = '';
      document.getElementById('tt-input-mapping-json').value = '';
      ttToggleWebhookFields();
      // Reset agent selector
      var agentSel = document.getElementById('tt-input-agent');
      if (agentSel) agentSel.value = '';
      handleAgentSelectionChange('tt');
      populateAgentSelector('tt', null);
      document.getElementById('tt-modal').style.display = 'flex';
      ttLoadChannels();
      ttPopulateEndpointDropdown(null);
    }

    function ttCloseModal() {
      document.getElementById('tt-modal').style.display = 'none';
      ttEditingId = null;
      ttEditingUpdatedAt = null;
      ttCurrentSub = null;
    }

    function ttGetNotifyChannel() {
      var sel = document.getElementById('tt-input-notify-select');
      if (sel && sel.style.display !== 'none') {
        if (sel.value === '__manual__') {
          var manual = document.getElementById('tt-input-notify-manual');
          return manual ? manual.value.trim() : '';
        }
        return sel.value;
      }
      var manual = document.getElementById('tt-input-notify-manual');
      return manual ? manual.value.trim() : '';
    }

    async function ttLoadChannels() {
      try {
        var sel = document.getElementById('tt-input-notify-select');
        var manual = document.getElementById('tt-input-notify-manual');
        if (!sel || !manual) return;
        if (ttChannelsCache) { ttRenderChannels(sel, manual, ttChannelsCache); return; }
        var d = await fetchApi('/api/slack/targets', {}, true);
        if (d && d.data && d.data.length) {
          ttChannelsCache = d.data;
          ttRenderChannels(sel, manual, d.data);
        } else {
          sel.style.display = 'none';
          manual.style.display = '';
          manual.value = '';
        }
      } catch (_err) {
        var sel = document.getElementById('tt-input-notify-select');
        var manual = document.getElementById('tt-input-notify-manual');
        if (sel) sel.style.display = 'none';
        if (manual) manual.style.display = '';
      }
    }

    function ttRenderChannels(sel, manual, targets) {
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
        if (sel.value === '__manual__') {
          manual.style.display = '';
          manual.focus();
        } else {
          manual.style.display = 'none';
          manual.value = '';
        }
      };
    }

    async function ttSaveTask() {
      try {
        var name = document.getElementById('tt-input-name').value.trim();
        var description = document.getElementById('tt-input-description').value.trim();
        var tool = document.getElementById('tt-input-tool').value;
        var model = (document.getElementById('tt-input-model') || {}).value || '';
        var prompt = document.getElementById('tt-input-prompt').value.trim();
        var maxRetries = parseInt(document.getElementById('tt-input-max-retries').value || '0', 10);
        var concurrencyPolicy = document.getElementById('tt-input-concurrency-policy').value;
        var enabled = document.getElementById('tt-input-enabled').checked;
        var notifyChannel = ttGetNotifyChannel();
        var notifyThread = (document.getElementById('tt-input-notify-thread') || {}).value || '';

        if (!name) { toast('Name is required', 'error'); return; }
        if (!prompt) { toast('Prompt is required', 'error'); return; }

        var execPolicy = readExecutionPolicy('tt');
        var workdir = document.getElementById('tt-input-workdir').value.trim();
        var instrFile = document.getElementById('tt-input-instruction-file').value.trim();
        var payload = {
          name: name,
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
          notifyThread: notifyThread.trim() || null,
          enabled: enabled,
          concurrencyPolicy: concurrencyPolicy
        };
        // Apply agent selection + snapshot agent values for fallback
        await applyAgentToPayload('tt', payload);

        // Include subscription inline for atomic server-side save
        var epVal = document.getElementById('tt-input-endpoint').value;
        var filterVal = document.getElementById('tt-input-filter-json').value.trim();
        var mappingVal = document.getElementById('tt-input-mapping-json').value.trim();
        if (epVal) {
          var subFilterJson = null;
          var subMappingJson = null;
          if (filterVal) {
            try { subFilterJson = JSON.stringify(JSON.parse(filterVal)); } catch(e) { toast('Filter JSON is invalid', 'error'); return; }
          }
          if (mappingVal) {
            try { subMappingJson = JSON.stringify(JSON.parse(mappingVal)); } catch(e) { toast('Context Mapping JSON is invalid', 'error'); return; }
          }
          payload.subscription = {
            endpointId: epVal,
            filterJson: subFilterJson,
            contextMappingJson: subMappingJson,
            enabled: ttCurrentSub ? ttCurrentSub.enabled : true
          };
        } else {
          // No endpoint — signal subscription removal
          payload.subscription = null;
        }

        var url = ttEditingId ? '/api/triggered-tasks/' + ttEditingId : '/api/triggered-tasks';
        var method = ttEditingId ? 'PATCH' : 'POST';
        if (ttEditingId && ttEditingUpdatedAt) payload.updatedAt = ttEditingUpdatedAt;
        var d = await fetchApi(url, { method: method, body: JSON.stringify(payload) });
        if (d && d.ok) {
          toast(ttEditingId ? 'Triggered task updated' : 'Triggered task created', 'success');
          ttCloseModal();
          ttLoadTasks();
        }
      } catch (err) {
        toast('Error saving triggered task: ' + String(err), 'error');
      }
    }

    async function ttEdit(id) {
      try {
        var [d, sub] = await Promise.all([
          fetchApi('/api/triggered-tasks/' + id),
          evtFindSubscriptionForTask(id)
        ]);
        if (!d || !d.data) { toast('Failed to load triggered task', 'error'); return; }
        var t = d.data;
        ttEditingId = id;
        ttEditingUpdatedAt = t.updatedAt || null;
        ttCurrentSub = sub || null;
        document.getElementById('tt-modal-title').textContent = 'Edit Triggered Task';
        document.getElementById('tt-modal-save').textContent = 'Save';
        document.getElementById('tt-input-id').value = t.id;
        document.getElementById('tt-input-name').value = t.name || '';
        document.getElementById('tt-input-description').value = t.description || '';
        document.getElementById('tt-input-tool').value = t.tool || 'claude';
        var ttModelEl2 = document.getElementById('tt-model-field');
        if (ttModelEl2) ttModelEl2.innerHTML = modelFieldHtml('tt-input-model', t.tool || 'claude', t.model || '');
        document.getElementById('tt-input-prompt').value = t.prompt || '';
        document.getElementById('tt-input-workdir').value = t.workdir || '';
        document.getElementById('tt-input-max-retries').value = String(t.maxRetries || 0);
        document.getElementById('tt-input-concurrency-policy').value = t.concurrencyPolicy || 'skip_if_running';
        document.getElementById('tt-input-enabled').checked = t.enabled !== false;
        var mcpEl2 = document.getElementById('tt-mcp-section');
        if (mcpEl2) mcpEl2.innerHTML = buildMcpSectionHtml('tt', t.allowMcp);
        await ttRefreshSkillsSection(t.enabledSkills);
        document.getElementById('tt-input-instruction-file').value = t.instructionFile || '';
        document.getElementById('tt-input-filter-json').value = sub ? evtPrettyJsonText(sub.filterJson) : '';
        document.getElementById('tt-input-mapping-json').value = sub ? evtPrettyJsonText(sub.contextMappingJson) : '';
        var ntEl = document.getElementById('tt-input-notify-thread');
        if (ntEl) ntEl.value = t.notifyThread || '';
        // Populate agent selector with existing agentId
        await populateAgentSelector('tt', t.agentId || null);
        await ttPopulateEndpointDropdown(sub ? sub.endpointId : null);
        document.getElementById('tt-modal').style.display = 'flex';
        await ttLoadChannels();
        var notifySel = document.getElementById('tt-input-notify-select');
        if (t.notifyChannel) {
          notifySel.value = t.notifyChannel;
          if (!notifySel.value || notifySel.value !== t.notifyChannel) {
            notifySel.value = '__manual__';
            document.getElementById('tt-input-notify-manual').style.display = '';
            document.getElementById('tt-input-notify-manual').value = t.notifyChannel;
          }
        } else {
          notifySel.value = '';
        }
      } catch (err) {
        toast('Error loading triggered task: ' + String(err), 'error');
      }
    }

    async function ttDelete(id) {
      if (!confirm('Delete this triggered task? Any linked webhook subscription will also be removed.')) return;
      try {
        var d = await fetchApi('/api/triggered-tasks/' + id, { method: 'DELETE' });
        if (d && d.ok) {
          toast('Triggered task deleted', 'success');
          ttLoadTasks();
        }
      } catch (err) {
        toast('Error deleting triggered task: ' + String(err), 'error');
      }
    }

    async function ttSetEnabled(id, enabled) {
      try {
        var d = await fetchApi('/api/triggered-tasks/' + id, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: enabled })
        });
        if (d && d.ok) {
          toast(enabled ? 'Triggered task enabled' : 'Triggered task disabled', 'success');
          ttLoadTasks();
        }
      } catch (err) {
        toast('Error updating triggered task: ' + String(err), 'error');
      }
    }

    async function ttExecute(id) {
      var row = document.querySelector('[data-task-id="' + id + '"]');
      var execBtn = row ? row.querySelector('.action-btn[title="Test Run"]') : null;
      var origHtml = '';
      if (execBtn) {
        origHtml = execBtn.innerHTML;
        execBtn.innerHTML = TT_ICON.loader;
        execBtn.classList.add('action-btn-running');
      }
      try {
        var d = await fetchApi('/api/triggered-tasks/' + id + '/execute', { method: 'POST' });
        if (d && d.ok) {
          toast('Test run started', 'success');
          setTimeout(function() { ttLoadTasks(); }, 2000);
        } else {
          toast((d && d.error) || 'Failed to start test run', 'error');
          if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
        }
      } catch (err) {
        toast('Error starting test run: ' + String(err), 'error');
        if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
      }
    }

    function ttToggleHistory(rowEl) {
      var taskId = rowEl.getAttribute('data-task-id');
      var existing = document.getElementById('tt-hist-' + taskId);

      document.querySelectorAll('.tt-history-panel').forEach(function(el) {
        if (el.id !== 'tt-hist-' + taskId) {
          el.style.maxHeight = '0';
          el.style.opacity = '0';
          var parentRow = el.closest('tr');
          if (parentRow) setTimeout(function() { parentRow.remove(); }, 250);
          var prevRow = document.querySelector('.sched-task-row.expanded');
          if (prevRow && prevRow !== rowEl) prevRow.classList.remove('expanded');
        }
      });

      if (existing) {
        existing.style.maxHeight = '0';
        existing.style.opacity = '0';
        rowEl.classList.remove('expanded');
        setTimeout(function() { var p = existing.closest('tr'); if (p) p.remove(); }, 250);
        return;
      }

      rowEl.classList.add('expanded');

      var detailRow = document.createElement('tr');
      detailRow.className = 'task-history-row';
      var td = document.createElement('td');
      td.colSpan = rowEl.cells.length;
      td.style.padding = '0';
      td.style.border = 'none';
      td.innerHTML = '<div id="tt-hist-' + escapeHtml(taskId) + '" class="tt-history-panel task-history-panel">'
        + '<div class="task-history-inner"><div class="loading" style="padding:1rem;">Loading history...</div></div></div>';
      detailRow.appendChild(td);
      rowEl.parentNode.insertBefore(detailRow, rowEl.nextSibling);

      var panel = document.getElementById('tt-hist-' + taskId);
      requestAnimationFrame(function() {
        panel.style.maxHeight = '600px';
        panel.style.opacity = '1';
      });

      ttLoadHistory(taskId, panel.querySelector('.task-history-inner'));
    }

    async function ttLoadHistory(taskId, container) {
      try {
        var data = await fetchApi('/api/triggered-tasks/' + taskId + '/runs?limit=20');
        if (!data) {
          container.innerHTML = '<div class="empty-state" style="padding:1rem;">Failed to load history.</div>';
          return;
        }
        var runs = data.data || [];
        ttRunsCache[taskId] = runs;

        if (runs.length === 0) {
          container.innerHTML = '<div class="task-history-empty">' + TT_ICON.clock + '<span>No event runs yet</span></div>';
          return;
        }

        var statusIcon = function(s) {
          var icons = {
            completed: TT_ICON.checkCircle,
            failed: TT_ICON.xCircle,
            cancelled: TT_ICON.alertCircle,
            running: TT_ICON.loader,
            pending: TT_ICON.clock
          };
          return '<span class="status-icon">' + (icons[s] || escapeHtml(s)) + '</span>';
        };

        var html = '<div class="task-history-title-bar">'
          + '<span>' + TT_ICON.history + ' Event Run History</span>'
          + '<span class="task-history-count">' + runs.length + ' run' + (runs.length !== 1 ? 's' : '') + '</span>'
          + '</div>';
        html += '<table class="task-history-table">'
          + '<colgroup><col class="sh-num"><col class="sh-started"><col class="sh-status"><col class="sh-source"><col class="sh-duration"><col></colgroup>'
          + '<thead><tr>'
          + '<th>#</th><th>Started</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Output / Context</th>'
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
          var contextText = !fullText && !errorText && r.triggerContextJson ? ttPrettyJson(r.triggerContextJson) : '';
          var outputCell = '';
          var runIdx = 'tt-out-' + escapeHtml(taskId) + '-' + i;
          var jsRunIdx = escapeInlineJsArg(runIdx);

          if (fullText) {
            outputCell = ttBuildExpandableCell(runIdx, jsRunIdx, fullText, false);
          } else if (errorText) {
            outputCell = ttBuildExpandableCell(runIdx, jsRunIdx, errorText, true);
          } else if (contextText) {
            outputCell = ttBuildExpandableCell(runIdx, jsRunIdx, contextText, false);
          } else {
            outputCell = '—';
          }

          var retryBadge = r.retryCount > 0
            ? ' <span class="badge badge-retry badge-sm">retry ' + r.retryCount + '</span>'
            : '';

          html += '<tr class="qt-history-run-row" onclick="event.stopPropagation();ttShowRunDetail(\\'' + escapeInlineJsArg(taskId) + '\\',' + i + ')">'
            + '<td>' + (runs.length - i) + '</td>'
            + '<td>' + escapeHtml(started) + '</td>'
            + '<td>' + statusIcon(r.status) + ' ' + escapeHtml(r.status) + retryBadge + '</td>'
            + '<td>' + sharedSourceBadge(r.triggeredBy || r.source) + '</td>'
            + '<td>' + escapeHtml(duration) + '</td>'
            + '<td class="task-history-output">' + outputCell + '</td>'
            + '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;

        var panel = container.parentElement;
        if (panel) panel.style.maxHeight = Math.min(container.scrollHeight + 8, 600) + 'px';
      } catch (_err) {
        container.innerHTML = '<div class="task-history-empty">Failed to load history.</div>';
      }
    }

    function ttBuildExpandableCell(runIdx, jsRunIdx, text, isError) {
      var preview = text.length > 140 ? text.substring(0, 140) + '...' : text;
      var color = isError ? ' style="color:var(--red);"' : '';
      var html = '<span id="' + runIdx + '-preview"' + color + '>' + escapeHtml(preview) + '</span>';
      if (text.length > 140) {
        html += '<span id="' + runIdx + '-full" class="qt-output-full"' + color + ' style="display:none;">' + escapeHtml(text) + '</span>';
        html += ' <button class="qt-output-toggle" onclick="event.stopPropagation();ttToggleOutput(\\'' + jsRunIdx + '\\')">[Show all]</button>';
      }
      return html;
    }

    function ttPrettyJson(raw) {
      if (!raw) return '';
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch (_err) {
        return String(raw);
      }
    }

    function ttToggleOutput(runIdx) {
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
      var panel = preview.closest('.tt-history-panel');
      if (panel) {
        var inner = panel.querySelector('.task-history-inner');
        panel.style.maxHeight = inner ? Math.min(inner.scrollHeight + 8, 2000) + 'px' : '2000px';
      }
    }

    function ttShowRunDetail(taskId, runIndex) {
      showRunDetailFromCache(ttRunsCache, taskId, runIndex);
    }

    /* Attach agent selector change handler */
    (function() {
      var sel = document.getElementById('tt-input-agent');
      if (sel) sel.onchange = function() { handleAgentSelectionChange('tt'); };
      var toolSel = document.getElementById('tt-input-tool');
      if (toolSel) {
        toolSel.onchange = function() {
          updateModelPlaceholder('tt-input-model', toolSel.value);
          void ttRefreshSkillsSection(readSkillsOnly('tt'));
        };
      }
    })();
`;
