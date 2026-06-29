/** @module dashboard/scripts/schedule-tasks — Client-side script for the Schedule Tasks tab. */
export const scheduleTasksScript = `
let schedCurrentType = 'once';
let schedEditingId = null;
let schedEditingUpdatedAt = null;
let schedChannelsCache = null;
let schedRepeatMode = 'daily';
let schedAdvancedCron = false;
var schedRunsCache = {};
var SCHED_DISPLAY_LOCALE = 'en-US';

/* Aliases to shared icons defined in helpers.ts */
var ICON = SHARED_ICON;

/** Fetch Slack notification targets (users + channels). Cached. */
async function schedLoadTargets() {
  if (schedChannelsCache) return schedChannelsCache;
  try {
    var data = await fetchApi('/api/slack/targets', {}, true);
    if (data && data.data && data.data.length > 0) {
      schedChannelsCache = data.data;
      return data.data;
    }
  } catch { /* parse error — return cached or null */ }
  return null;
}

/** Get the current notify target value from whichever input is active. */
function schedGetNotifyChannel() {
  var sel = document.getElementById('sched-input-notify-select');
  if (sel && sel.style.display !== 'none') return sel.value;
  var manual = document.getElementById('sched-input-notify-manual');
  return manual ? manual.value.trim() : '';
}

/** Populate notification target selector. Falls back to text input if API unavailable. */
async function schedPopulateChannelSelect(selectedId) {
  var sel = document.getElementById('sched-input-notify-select');
  var manual = document.getElementById('sched-input-notify-manual');
  if (!sel || !manual) return;

  var targets = await schedLoadTargets();
  if (!targets) {
    sel.style.display = 'none';
    manual.style.display = '';
    manual.value = selectedId || '';
    return;
  }

  sel.style.display = '';
  manual.style.display = 'none';
  while (sel.options.length > 0) sel.remove(0);
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = !selectedId;
  placeholder.textContent = 'Select a target...';
  sel.appendChild(placeholder);
  for (var i = 0; i < targets.length; i++) {
    var opt = document.createElement('option');
    opt.value = targets[i].id;
    opt.textContent = targets[i].type === 'user'
      ? '\\u{1F464} ' + targets[i].name + ' (DM)'
      : '#' + targets[i].name;
    sel.appendChild(opt);
  }
  if (selectedId) sel.value = selectedId;
}

/** Detect the local OS/browser timezone. Falls back to UTC if unavailable. */
function schedDetectTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch(e) { return 'UTC'; }
}

function schedFormatDateTime(isoString, timeZone) {
  return new Date(isoString).toLocaleString(SCHED_DISPLAY_LOCALE, { timeZone: timeZone });
}

/** Set repeat mode for recurring schedule (daily/weekdays/custom). */
function schedSetRepeat(mode) {
  schedRepeatMode = mode;
  schedAdvancedCron = false;
  ['daily', 'weekdays', 'custom'].forEach(function(m) {
    var btn = document.getElementById('sched-repeat-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  document.getElementById('sched-custom-days').style.display = mode === 'custom' ? '' : 'none';
  document.getElementById('sched-cron-raw-wrap').style.display = 'none';
  document.getElementById('sched-adv-link').textContent = 'Advanced: cron expression';
}

/** Toggle advanced cron expression input. */
function schedToggleAdvancedCron(e) {
  e.preventDefault();
  schedAdvancedCron = !schedAdvancedCron;
  var wrap = document.getElementById('sched-cron-raw-wrap');
  var link = document.getElementById('sched-adv-link');
  wrap.style.display = schedAdvancedCron ? '' : 'none';
  link.textContent = schedAdvancedCron ? 'Use visual builder' : 'Advanced: cron expression';
  if (schedAdvancedCron) {
    /* Pre-fill with the currently built cron so user can tweak */
    var built = schedBuildCronFromVisual();
    if (built) document.getElementById('sched-input-cron').value = built;
  }
}

/** Build cron expression from the visual time + repeat inputs. */
function schedBuildCronFromVisual() {
  var time = document.getElementById('sched-cron-time').value;
  if (!time) return '';
  var parts = time.split(':');
  var minute = parseInt(parts[1], 10);
  var hour = parseInt(parts[0], 10);
  var dow = '*';
  if (schedRepeatMode === 'weekdays') {
    dow = '1-5';
  } else if (schedRepeatMode === 'custom') {
    var checks = document.querySelectorAll('#sched-custom-days input.sched-day-cb:checked');
    if (checks.length === 0) return '';
    var days = [];
    for (var i = 0; i < checks.length; i++) days.push(checks[i].value);
    dow = days.join(',');
  }
  return minute + ' ' + hour + ' * * ' + dow;
}

/** Get the final cron expression (from advanced input or visual builder). */
function schedBuildCron() {
  if (schedAdvancedCron) {
    return document.getElementById('sched-input-cron').value.trim();
  }
  return schedBuildCronFromVisual();
}

/**
 * Parse a cron expression into visual builder state.
 * Returns { time: 'HH:MM', mode: 'daily'|'weekdays'|'custom', days: string[] } or null if too complex.
 */
function schedParseCron(expr) {
  var parts = (expr || '').trim().split(/\\s+/);
  if (parts.length !== 5) return null;
  var minute = parts[0], hour = parts[1], dom = parts[2], month = parts[3], dow = parts[4];
  if (!/^\\d{1,2}$/.test(minute) || !/^\\d{1,2}$/.test(hour) || dom !== '*' || month !== '*') return null;
  var time = String(parseInt(hour,10)).padStart(2, '0') + ':' + String(parseInt(minute,10)).padStart(2, '0');
  if (dow === '*') return { time: time, mode: 'daily', days: [] };
  if (dow === '1-5') return { time: time, mode: 'weekdays', days: [] };
  if (/^[\\d,]+$/.test(dow)) return { time: time, mode: 'custom', days: dow.split(',') };
  return null;
}

/** Apply parsed cron state to the visual builder UI. */
function schedApplyCronToUI(parsed) {
  document.getElementById('sched-cron-time').value = parsed.time;
  schedSetRepeat(parsed.mode);
  if (parsed.mode === 'custom') {
    var cbs = document.querySelectorAll('#sched-custom-days input.sched-day-cb');
    for (var i = 0; i < cbs.length; i++) {
      cbs[i].checked = parsed.days.indexOf(cbs[i].value) >= 0;
    }
  }
}

/**
 * Convert a user-entered date + time in a given IANA timezone to a UTC ISO string.
 * e.g. localToUtcIso('2026-03-01', '09:00', tz) → '2026-03-01T00:00:00.000Z'
 */
function localToUtcIso(dateStr, timeStr, tz) {
  // 1. Treat the input as UTC to get a reference point
  var guessUtc = new Date(dateStr + 'T' + timeStr + ':00Z');
  // 2. Format that UTC instant in the target timezone to discover the offset
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  var parts = fmt.formatToParts(guessUtc);
  var p = {};
  for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
  // What the guess maps to in the target TZ (parsed back as if UTC for offset calc)
  var hr = p.hour === '24' ? '00' : p.hour;
  var gotLocal = new Date(p.year + '-' + p.month + '-' + p.day + 'T' + hr + ':' + p.minute + ':' + p.second + 'Z');
  // 3. offset = (target TZ local representation) - (UTC instant)
  var offsetMs = gotLocal.getTime() - guessUtc.getTime();
  // 4. Correct UTC = desired local time (as UTC) - offset
  var wantedAsUtc = new Date(dateStr + 'T' + timeStr + ':00Z');
  return new Date(wantedAsUtc.getTime() - offsetMs).toISOString();
}

/**
 * Convert a UTC ISO string to date ('YYYY-MM-DD') and time ('HH:MM') in a given timezone.
 * Used to populate the edit form with timezone-correct values.
 */
function utcToTzParts(isoStr, tz) {
  var d = new Date(isoStr);
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  });
  var parts = fmt.formatToParts(d);
  var p = {};
  for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
  var hr = p.hour === '24' ? '00' : p.hour;
  return { date: p.year + '-' + p.month + '-' + p.day, time: hr + ':' + p.minute };
}

var schedToolBadge = sharedToolBadge;

/** Derive display status: adds 'running' when a job is in-flight for the task. */
function schedDisplayStatus(t) {
  if (t.status === 'active' && t.nextRunAt === null && t.runCount > 0) return 'running';
  return t.status;
}

function schedStatusBadge(s) {
  var map = {
    active:    'badge-active',
    running:   'badge-running',
    paused:    'badge-paused',
    completed: 'badge-inactive'
  };
  return '<span class="badge ' + (map[s] || 'badge-inactive') + '">' + escapeHtml(s) + '</span>';
}

/** Build task table rows. Returns HTML string for <tbody> content. */
function schedBuildTaskRows(tasks) {
  var html = '';
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    var schedule = t.scheduleType === 'once'
      ? (t.runAt ? schedFormatDateTime(t.runAt, t.timezone) : 'N/A')
      : (t.nextRunAt ? schedFormatDateTime(t.nextRunAt, t.timezone) : (t.cronExpr || 'N/A'));
    var isPaused = t.status === 'paused';
    var isCompleted = t.status === 'completed';
    var displayStatus = schedDisplayStatus(t);

    var snippet = t.description || t.prompt || '';
    var snippetText = snippet.slice(0, 60) + (snippet.length > 60 ? '...' : '');

    var safeId = escapeHtml(t.id);
    var jsId = escapeInlineJsArg(t.id);
    html += '<tr class="sched-task-row" data-task-id="' + safeId + '" data-task-name="' + escapeHtml(t.name) + '" data-task-tz="' + escapeHtml(t.timezone || schedDetectTz()) + '" onclick="schedToggleHistory(this)">'
      + '<td><strong>' + escapeHtml(t.name) + '</strong><br><span style="font-size:0.75rem;color:var(--text-dim);">' + escapeHtml(snippetText) + '</span></td>'
      + '<td>' + schedToolBadge(t.tool) + '</td>'
      + '<td style="font-family:monospace;font-size:0.82rem;">' + escapeHtml(schedule) + '</td>'
      + '<td>' + schedStatusBadge(displayStatus) + '</td>'
      + '<td>' + t.runCount + (t.maxRuns ? '/' + t.maxRuns : '') + '</td>'
      + '<td onclick="event.stopPropagation()">';

    html += '<button class="action-btn" onclick="schedExecute(\\'' + jsId + '\\')" title="Test Run">' + ICON.play + '</button>';
    if (!isCompleted) {
      if (isPaused) {
        html += '<button class="action-btn" onclick="schedResume(\\'' + jsId + '\\')" title="Resume">' + ICON.play + '</button>';
      } else {
        html += '<button class="action-btn" onclick="schedPause(\\'' + jsId + '\\')" title="Pause">' + ICON.pause + '</button>';
      }
      html += '<button class="action-btn" onclick="schedEdit(\\'' + jsId + '\\')" title="Edit">' + ICON.edit + '</button>';
    }
    html += '<button class="action-btn action-btn-danger" onclick="schedDelete(\\'' + jsId + '\\')" title="Delete">' + ICON.trash + '</button>';
    html += '</td></tr>';
  }
  return html;
}

/** Build a card with an inline section header + task table. variant: 'active' | 'archive' */
function schedBuildTaskCard(label, count, tasks, variant) {
  var html = '<div class="card sched-card-section sched-card-' + variant + '">'
    + '<div class="sched-card-header">'
    + '<span>' + escapeHtml(label) + '</span>'
    + '<span class="sched-section-count">' + count + '</span>'
    + '</div>';
  if (tasks.length > 0) {
    html += '<div class="table-wrap"><table><thead><tr>'
      + '<th>Name</th><th>Tool</th><th>Schedule</th><th>Status</th><th>Runs</th><th style="width:140px;">Actions</th>'
      + '</tr></thead><tbody>'
      + schedBuildTaskRows(tasks)
      + '</tbody></table></div>';
  } else {
    html += '<div class="empty-state" style="padding:1.5rem;">No tasks</div>';
  }
  html += '</div>';
  return html;
}

async function schedLoadTasks() {
  const list = document.getElementById('sched-task-list');
  if (!list) return;
  list.innerHTML = '<div class="loading">Loading schedule tasks...</div>';

  try {
    const data = await fetchApi('/api/schedule-tasks');
    if (!data) { list.innerHTML = '<div class="empty-state">Schedule feature is not enabled or server is offline.</div>'; return; }
    const tasks = data.data || [];
    if (tasks.length === 0) {
      list.innerHTML = '<div class="empty-state">No scheduled tasks yet. Click "+ New Task" to create one.</div>';
      return;
    }

    var activeTasks = [];
    var archivedTasks = [];
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].status === 'completed') {
        archivedTasks.push(tasks[i]);
      } else {
        activeTasks.push(tasks[i]);
      }
    }

    var html = schedBuildTaskCard('Active Tasks', activeTasks.length, activeTasks, 'active');
    if (archivedTasks.length > 0) {
      html += schedBuildTaskCard('Archive', archivedTasks.length, archivedTasks, 'archive');
    }

    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = '<div class="empty-state">Failed to load schedule tasks: ' + escapeHtml(String(err)) + '</div>';
  }
}

function schedSetType(type) {
  schedCurrentType = type;
  document.getElementById('sched-toggle-once').classList.toggle('active', type === 'once');
  document.getElementById('sched-toggle-recurring').classList.toggle('active', type === 'recurring');
  document.getElementById('sched-row-once').style.display = type === 'once' ? '' : 'none';
  var rec = type === 'recurring' ? '' : 'none';
  document.getElementById('sched-row-cron-time').style.display = rec;
  document.getElementById('sched-row-cron-days').style.display = rec;
  document.getElementById('sched-row-cron-adv').style.display = rec;
  document.getElementById('sched-row-max-runs').style.display = rec;
  if (type === 'once') {
    document.getElementById('sched-input-max-runs').value = '';
  }
}

async function schedShowCreateModal() {
  schedEditingId = null;
  schedEditingUpdatedAt = null;
  document.getElementById('sched-modal-title').textContent = 'New Schedule Task';
  document.getElementById('sched-modal-save').textContent = 'Create';
  document.getElementById('sched-input-id').value = '';
  document.getElementById('sched-input-name').value = '';
  document.getElementById('sched-input-description').value = '';
  document.getElementById('sched-input-tool').value = 'claude';
  var schedModelCell = document.getElementById('sched-model-cell');
  if (schedModelCell) {
    schedModelCell.innerHTML = modelFieldHtml('schedule-model', 'claude', '')
      + '<div class="sched-help-text">Leave empty for system default</div>';
  }
  document.getElementById('sched-input-prompt').value = '';
  document.getElementById('sched-input-workdir').value = '';
  schedSetType('once');
  // Always use the OS/browser timezone — not user-selectable
  var osTz = schedDetectTz();
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: osTz, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  document.getElementById('sched-input-date').value = tomorrowFmt.format(tomorrow);
  document.getElementById('sched-input-time').value = '09:00';
  document.getElementById('sched-cron-time').value = '09:00';
  schedSetRepeat('daily');
  schedAdvancedCron = false;
  document.getElementById('sched-cron-raw-wrap').style.display = 'none';
  document.getElementById('sched-adv-link').textContent = 'Advanced: cron expression';
  document.getElementById('sched-input-cron').value = '';
  /* Clear custom day checkboxes */
  var cbs = document.querySelectorAll('#sched-custom-days input.sched-day-cb');
  for (var ci = 0; ci < cbs.length; ci++) cbs[ci].checked = false;
  document.getElementById('sched-input-tz').value = osTz;
  document.getElementById('sched-tz-label').textContent = osTz;
  document.getElementById('sched-input-max-retries').value = '0';
  var mcpEl = document.getElementById('sched-mcp-section');
  if (mcpEl) mcpEl.innerHTML = buildMcpSectionHtml('sched', false);
  await schedRefreshSkillsSection(null);
  document.getElementById('sched-input-instruction-file').value = '';
  var ntEl = document.getElementById('sched-input-notify-thread');
  if (ntEl) ntEl.value = '';
  // Reset agent selector
  var agentSel = document.getElementById('sched-input-agent');
  if (agentSel) agentSel.value = '';
  handleAgentSelectionChange('sched');
  populateAgentSelector('sched', null);
  document.getElementById('sched-modal').style.display = 'flex';
  schedPopulateChannelSelect('');
}

function schedCloseModal() {
  document.getElementById('sched-modal').style.display = 'none';
}

async function schedRefreshSkillsSection(enabledSkills) {
  var skillsEl = document.getElementById('sched-skills-section');
  var tool = (document.getElementById('sched-input-tool') || {}).value || 'claude';
  if (!skillsEl) return;
  await ensureAvailableSkills(tool);
  skillsEl.innerHTML = buildSkillsSectionHtml('sched', enabledSkills, tool);
}

async function schedSaveTask() {
  const name = document.getElementById('sched-input-name').value.trim();
  const tool = document.getElementById('sched-input-tool').value;
  const prompt = document.getElementById('sched-input-prompt').value.trim();
  const maxRunsRaw = document.getElementById('sched-input-max-runs').value;
  const notify = schedGetNotifyChannel();

  const description = document.getElementById('sched-input-description').value.trim();
  const maxRetriesRaw = document.getElementById('sched-input-max-retries').value;

  if (!name) { toast('Name is required', 'error'); return; }
  if (!prompt) { toast('Prompt is required', 'error'); return; }
  if (!notify) { toast('Please select a Slack notification target', 'error'); return; }

  var modelInput = document.getElementById('schedule-model');
  var model = modelInput ? modelInput.value.trim() : '';
  var workdir = document.getElementById('sched-input-workdir').value.trim();
  var execPolicy = readExecutionPolicy('sched');
  var instrFile = document.getElementById('sched-input-instruction-file').value.trim();
  const notifyThread = (document.getElementById('sched-input-notify-thread') || {}).value || '';
  const body = {
    name, tool, prompt,
    model: model || null,
    description: description || null,
    workdir: workdir || null,
    scheduleType: schedCurrentType,
    timezone: document.getElementById('sched-input-tz').value,
    notifyChannel: notify,
    notifyThread: notifyThread.trim() || null,
    maxRuns: maxRunsRaw ? parseInt(maxRunsRaw, 10) : null,
    maxRetries: maxRetriesRaw ? parseInt(maxRetriesRaw, 10) : 0,
    allowMcp: execPolicy.allowMcp,
    enabledSkills: execPolicy.enabledSkills,
    instructionFile: instrFile || null,
  };
  // Apply agent selection + snapshot agent values for fallback
  await applyAgentToPayload('sched', body);

  if (schedCurrentType === 'once') {
    const date = document.getElementById('sched-input-date').value;
    const time = document.getElementById('sched-input-time').value;
    if (!date || !time) { toast('Date and time are required', 'error'); return; }
    // Convert the user-entered date/time in the selected timezone to UTC.
    // We find the UTC offset for the target timezone at the given date/time,
    // then construct an ISO string that represents the correct UTC instant.
    body.runAt = localToUtcIso(date, time, body.timezone || schedDetectTz());
  } else {
    var cronTime = document.getElementById('sched-cron-time').value;
    if (!schedAdvancedCron && !cronTime) { toast('Time is required', 'error'); return; }
    if (!schedAdvancedCron && schedRepeatMode === 'custom') {
      var anyDay = document.querySelectorAll('#sched-custom-days input.sched-day-cb:checked');
      if (anyDay.length === 0) { toast('Please select at least one day', 'error'); return; }
    }
    const cron = schedBuildCron();
    if (!cron) { toast('Cron expression is required', 'error'); return; }
    body.cronExpr = cron;
  }

  try {
    const isEdit = !!schedEditingId;
    const url = isEdit ? '/api/schedule-tasks/' + schedEditingId : '/api/schedule-tasks';
    const method = isEdit ? 'PATCH' : 'POST';
    if (isEdit && schedEditingUpdatedAt) body.updatedAt = schedEditingUpdatedAt;
    const data = await fetchApi(url, { method, body: JSON.stringify(body) });
    if (!data) return;  // fetchApi already showed error toast
    if (!data.ok) {
      toast(data.error || 'Failed to save task', 'error');
      return;
    }
    toast(isEdit ? 'Task updated' : 'Task created', 'success');
    schedCloseModal();
    schedLoadTasks();
  } catch (err) {
    toast('Error: ' + String(err), 'error');
  }
}

async function schedPause(id) {
  await fetchApi('/api/schedule-tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
  schedLoadTasks();
}

async function schedResume(id) {
  await fetchApi('/api/schedule-tasks/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  schedLoadTasks();
}

async function schedDelete(id) {
  if (!confirm('Delete this scheduled task?')) return;
  await fetchApi('/api/schedule-tasks/' + id, { method: 'DELETE' });
  toast('Task deleted', 'success');
  schedLoadTasks();
}

async function schedExecute(id) {
  var row = document.querySelector('[data-task-id="' + id + '"]');
  var execBtn = row ? row.querySelector('.action-btn[title="Test Run"]') : null;
  var origHtml = '';
  if (execBtn) {
    origHtml = execBtn.innerHTML;
    execBtn.innerHTML = ICON.loader;
    execBtn.classList.add('action-btn-running');
  }
  try {
    var d = await fetchApi('/api/schedule-tasks/' + id + '/execute', { method: 'POST' });
    if (d && d.ok) {
      toast('Test run started', 'success');
      setTimeout(function() { schedLoadTasks(); }, 2000);
    } else {
      toast((d && d.error) || 'Failed to start test run', 'error');
      if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
    }
  } catch (err) {
    toast('Error starting test run: ' + String(err), 'error');
    if (execBtn) { execBtn.innerHTML = origHtml; execBtn.classList.remove('action-btn-running'); }
  }
}

async function schedEdit(id) {
  try {
    var data = await fetchApi('/api/schedule-tasks/' + id);
    if (!data) { toast('Task not found', 'error'); return; }
    const t = data.data;

    schedEditingId = id;
    schedEditingUpdatedAt = t.updatedAt || null;
    document.getElementById('sched-modal-title').textContent = 'Edit Schedule Task';
    document.getElementById('sched-modal-save').textContent = 'Update';
    document.getElementById('sched-input-id').value = id;
    document.getElementById('sched-input-name').value = t.name || '';
    document.getElementById('sched-input-description').value = t.description || '';
    document.getElementById('sched-input-tool').value = t.tool || 'claude';
    var schedModelCell2 = document.getElementById('sched-model-cell');
    if (schedModelCell2) {
      schedModelCell2.innerHTML = modelFieldHtml('schedule-model', t.tool || 'claude', t.model || '')
        + '<div class="sched-help-text">Leave empty for system default</div>';
    }
    document.getElementById('sched-input-prompt').value = t.prompt || '';
    document.getElementById('sched-input-workdir').value = t.workdir || '';
    document.getElementById('sched-input-max-runs').value = t.maxRuns || '';
    document.getElementById('sched-input-max-retries').value = t.maxRetries || '0';
    var mcpEl2 = document.getElementById('sched-mcp-section');
    if (mcpEl2) mcpEl2.innerHTML = buildMcpSectionHtml('sched', t.allowMcp);
    await schedRefreshSkillsSection(t.enabledSkills);
    document.getElementById('sched-input-instruction-file').value = t.instructionFile || '';
    var ntEl = document.getElementById('sched-input-notify-thread');
    if (ntEl) ntEl.value = t.notifyThread || '';
    // Populate agent selector with existing agentId
    await populateAgentSelector('sched', t.agentId || null);
    await schedPopulateChannelSelect(t.notifyChannel || '');

    var taskTz = t.timezone || schedDetectTz();
    document.getElementById('sched-input-tz').value = taskTz;
    document.getElementById('sched-tz-label').textContent = taskTz;

    schedSetType(t.scheduleType || 'once');
    if (t.scheduleType === 'once' && t.runAt) {
      const tzParts = utcToTzParts(t.runAt, taskTz);
      document.getElementById('sched-input-date').value = tzParts.date;
      document.getElementById('sched-input-time').value = tzParts.time;
    }
    if (t.scheduleType === 'recurring' && t.cronExpr) {
      var parsed = schedParseCron(t.cronExpr);
      if (parsed) {
        schedApplyCronToUI(parsed);
        schedAdvancedCron = false;
        document.getElementById('sched-cron-raw-wrap').style.display = 'none';
        document.getElementById('sched-adv-link').textContent = 'Advanced: cron expression';
      } else {
        schedAdvancedCron = true;
        document.getElementById('sched-input-cron').value = t.cronExpr;
        document.getElementById('sched-cron-raw-wrap').style.display = '';
        document.getElementById('sched-adv-link').textContent = 'Use visual builder';
      }
    }

    document.getElementById('sched-modal').style.display = 'flex';
  } catch (err) {
    toast('Error loading task: ' + String(err), 'error');
  }
}

function schedToggleHistory(rowEl) {
  const taskId = rowEl.getAttribute('data-task-id');
  const existing = document.getElementById('sched-hist-' + taskId);

  /* Close any other open history panels */
  document.querySelectorAll('.task-history-panel').forEach(function(el) {
    if (el.id !== 'sched-hist-' + taskId) {
      el.style.maxHeight = '0';
      el.style.opacity = '0';
      var parentRow = el.closest('tr');
      if (parentRow) setTimeout(function() { parentRow.remove(); }, 250);
      var prevTaskRow = document.querySelector('.sched-task-row.expanded');
      if (prevTaskRow && prevTaskRow !== rowEl) prevTaskRow.classList.remove('expanded');
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

  /* Insert a detail row right after the clicked row */
  var detailRow = document.createElement('tr');
  detailRow.className = 'task-history-row';
  var colCount = rowEl.cells.length;
  var td = document.createElement('td');
  td.colSpan = colCount;
  td.style.padding = '0';
  td.style.border = 'none';
  td.innerHTML = '<div id="sched-hist-' + taskId + '" class="task-history-panel"><div class="task-history-inner"><div class="loading" style="padding:1rem;">Loading history...</div></div></div>';
  detailRow.appendChild(td);
  rowEl.parentNode.insertBefore(detailRow, rowEl.nextSibling);

  /* Animate open */
  var panel = document.getElementById('sched-hist-' + taskId);
  requestAnimationFrame(function() {
    panel.style.maxHeight = '500px';
    panel.style.opacity = '1';
  });

  /* Fetch history data */
  var taskName = rowEl.getAttribute('data-task-name');
  var taskTz = rowEl.getAttribute('data-task-tz') || schedDetectTz();
  schedLoadHistory(taskId, taskName, taskTz, panel.querySelector('.task-history-inner'));
}

async function schedLoadHistory(taskId, taskName, taskTz, container) {
  try {
    const data = await fetchApi('/api/schedule-tasks/' + taskId + '/runs?limit=20');
    if (!data) { container.innerHTML = '<div class="empty-state" style="padding:1rem;">Failed to load history.</div>'; return; }
    const runs = data.data || [];

    schedRunsCache[taskId] = runs;

    if (runs.length === 0) {
      container.innerHTML = '<div class="task-history-empty">' + ICON.clock + '<span>No executions yet</span></div>';
      return;
    }

    const statusIcon = (s) => {
      const icons = { completed: ICON.checkCircle, failed: ICON.xCircle, timeout: ICON.alertCircle, running: ICON.loader, pending: ICON.clock };
      return '<span class="status-icon">' + (icons[s] || escapeHtml(s)) + '</span>';
    };

    let html = '<div class="task-history-title-bar">'
      + '<span>' + ICON.history + ' Execution History</span>'
      + '<span class="task-history-count">' + runs.length + ' run' + (runs.length !== 1 ? 's' : '') + '</span>'
      + '</div>';
    html += '<table class="task-history-table">'
      + '<colgroup><col class="sh-num"><col class="sh-started"><col class="sh-status"><col class="sh-source"><col class="sh-duration"><col></colgroup>'
      + '<thead><tr>'
      + '<th>#</th><th>Started</th><th>Status</th><th>Source</th><th>Duration</th><th>Output</th>'
      + '</tr></thead><tbody>';

    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const started = schedFormatDateTime(r.startedAt, taskTz);
      let duration = '-';
      if (r.endedAt && r.startedAt) {
        const ms = new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime();
        duration = (ms / 1000).toFixed(1) + 's';
      }
      const output = r.outputSummary
        ? escapeHtml(r.outputSummary.slice(0, 500)) + (r.outputSummary.length > 500 ? '...' : '')
        : (r.errorMessage ? '<span style="color:var(--red);">' + escapeHtml(r.errorMessage.slice(0, 500)) + '</span>' : '-');

      var retryBadge = r.retryCount > 0
        ? ' <span class="badge badge-retry badge-sm">retry ' + r.retryCount + '</span>'
        : '';

      var sourceBadge = sharedSourceBadge(r.source);

      html += '<tr class="qt-history-run-row" onclick="event.stopPropagation();schedShowRunDetail(\\'' + escapeInlineJsArg(taskId) + '\\',' + i + ')">'
        + '<td>' + (runs.length - i) + '</td>'
        + '<td>' + escapeHtml(started) + '</td>'
        + '<td>' + statusIcon(r.status) + ' ' + escapeHtml(r.status) + retryBadge + '</td>'
        + '<td>' + sourceBadge + '</td>'
        + '<td>' + escapeHtml(duration) + '</td>'
        + '<td class="task-history-output">' + output + '</td>'
        + '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;

    /* Re-measure after content loaded for smoother animation */
    var panel = container.parentElement;
    if (panel) panel.style.maxHeight = Math.min(container.scrollHeight + 8, 500) + 'px';
  } catch (err) {
    container.innerHTML = '<div class="empty-state" style="padding:1rem;">Failed to load history.</div>';
  }
}

function schedShowRunDetail(taskId, runIndex) {
  showRunDetailFromCache(schedRunsCache, taskId, runIndex);
}

/* Attach agent selector change handler */
(function() {
  var sel = document.getElementById('sched-input-agent');
  if (sel) sel.onchange = function() { handleAgentSelectionChange('sched'); };
  var toolSel = document.getElementById('sched-input-tool');
  if (toolSel) {
    toolSel.onchange = function() {
      updateModelPlaceholder('schedule-model', toolSel.value);
      void schedRefreshSkillsSection(readSkillsOnly('sched'));
    };
  }
})();
`;
