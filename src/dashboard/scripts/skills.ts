/** @module dashboard/scripts/skills — Client-side script for the unified Skills tab. */
import { SENSITIVE_VALUE_MASK } from '../../config.js';
import { ICON_CLAUDE, ICON_CODEX, ICON_GEMINI } from '../icons.js';

export function skillsScript(): string {
  return `
    /* ══════════════════════════════════════════════
       Skills Tab
       ══════════════════════════════════════════════ */

    var skillsCurrentTool = 'claude';
    var skillsCurrentSource = 'all';
    var skillsCurrentScope = 'local';
    var skillsEditingSkill = null;
    var skillsViewingSkill = null;
    var skillsDetailData = null;
    var skillsSupportFileDraft = null;
    var skillsActiveDriver = 'claude';
    var skillsActiveVariant = 'claude';
    var skillsReqEnabled = false;
    var skillsPendingScripts = {};
    var skillsMaskedValueToken = '${SENSITIVE_VALUE_MASK}';
    var skillsToolIcons = {
      claude: '${ICON_CLAUDE}',
      codex: '${ICON_CODEX}',
      gemini: '${ICON_GEMINI}'
    };

    function skillsSwitchTool(tool) {
      if (tool === skillsCurrentTool) return;
      skillsCurrentTool = tool;
      var tabs = document.querySelectorAll('#skills-tool-tabs .driver-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tool') === tool);
      }
      var panel = document.getElementById('skills-tab-panel');
      if (panel) {
        panel.classList.remove('fade-in');
        void panel.offsetWidth;
        panel.classList.add('fade-in');
        panel.addEventListener('animationend', function handler() {
          panel.classList.remove('fade-in');
          panel.removeEventListener('animationend', handler);
        });
      }
      if (skillsViewingSkill) {
        skillsViewDetail(skillsViewingSkill.sourceKind, skillsViewingSkill.dirName);
      } else {
        skillsLoadSkills();
      }
    }

    function skillsSetSource(source) {
      if (skillsCurrentSource === source) return;
      skillsCurrentSource = source;
      var btns = document.querySelectorAll('#skills-source-toggle button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-source') === source);
      }
      skillsLoadSkills();
    }

    function skillsSetScope(scope) {
      skillsCurrentScope = scope;
      var btns = document.querySelectorAll('#skills-scope-toggle button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-scope') === scope);
      }
    }

    function skillsDriverTab(driver) {
      skillsActiveDriver = driver;
      var chips = document.querySelectorAll('#skills-driver-tabs .chip');
      for (var i = 0; i < chips.length; i++) {
        chips[i].classList.toggle('active', chips[i].getAttribute('data-driver') === driver);
      }
      var panels = document.querySelectorAll('.skills-driver-panel');
      for (var i = 0; i < panels.length; i++) {
        panels[i].style.display = 'none';
      }
      document.getElementById('skills-driver-' + driver).style.display = '';
    }

    function skillsToggleRequirements() {
      skillsReqEnabled = !skillsReqEnabled;
      document.getElementById('skills-req-toggle').classList.toggle('on', skillsReqEnabled);
      document.getElementById('skills-input-requirements').style.display = skillsReqEnabled ? '' : 'none';
    }

    function skillsHandleScriptUpload(input) {
      var files = input.files;
      if (!files || files.length === 0) return;
      for (var i = 0; i < files.length; i++) {
        (function(file) {
          var reader = new FileReader();
          reader.onload = function(e) {
            skillsPendingScripts[file.name] = e.target.result;
            skillsRenderScriptRow(file.name, true);
          };
          reader.readAsText(file);
        })(files[i]);
      }
      input.value = '';
    }

    function skillsRenderScriptRow(filename, isPending) {
      var list = document.getElementById('skills-scripts-list');
      var rows = list.children;
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].getAttribute('data-script') === filename) return;
      }
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.25rem;';
      row.setAttribute('data-script', filename);
      row.setAttribute('data-pending', isPending ? 'true' : 'false');
      var badge = isPending ? ' <span class="badge" style="font-size:0.55rem;background:var(--accent2);color:#fff;">new</span>' : '';
      row.innerHTML = '<code style="font-size:0.8rem;min-width:120px;">' + escapeHtml(filename) + '</code>' + badge
        + '<button class="btn btn-danger" style="padding:0.15rem 0.4rem;font-size:0.7rem;" onclick="skillsRemoveScript(this)">Del</button>';
      list.appendChild(row);
    }

    async function skillsRemoveScript(btn) {
      var row = btn.parentElement;
      var filename = row.getAttribute('data-script');
      var isPending = row.getAttribute('data-pending') === 'true';
      if (isPending) {
        delete skillsPendingScripts[filename];
        row.remove();
        return;
      }
      if (!skillsEditingSkill) return;
      if (!confirm('Delete script "' + filename + '"?')) return;
      var result = await fetchApi(
        '/api/skills/multi/' + skillsEditingSkill.sourceKind + '/' + encodeURIComponent(skillsEditingSkill.dirName)
          + '/files/' + encodeURIComponent('scripts/' + filename),
        { method: 'DELETE' }
      );
      if (result && result.success) {
        row.remove();
        toast('Script deleted', 'success');
      }
    }

    function skillsSourceLabel(source) {
      return source === 'all' ? 'All sources' : source.charAt(0).toUpperCase() + source.slice(1);
    }

    function skillsBuildBadge(label, style) {
      return '<span class="badge" style="' + style + '">' + escapeHtml(label) + '</span>';
    }

    function skillsRenderSourceBadge(sourceKind) {
      var palette = {
        builtin: 'background:rgba(37,99,235,0.12);color:#1d4ed8;border:1px solid rgba(37,99,235,0.22);',
        local: 'background:rgba(22,163,74,0.12);color:#15803d;border:1px solid rgba(22,163,74,0.22);',
        project: 'background:rgba(217,119,6,0.12);color:#b45309;border:1px solid rgba(217,119,6,0.22);'
      };
      return skillsBuildBadge(sourceKind, 'font-size:0.65rem;' + (palette[sourceKind] || ''));
    }

    function skillsUpdateListStatus(items) {
      var label = skillsCurrentTool.charAt(0).toUpperCase() + skillsCurrentTool.slice(1);
      var status = skillsSourceLabel(skillsCurrentSource) + ' · ' + items.length + ' skill' + (items.length === 1 ? '' : 's') + ' for ' + label
        + ' · create target: ' + skillsCurrentScope;
      document.getElementById('skills-list-status').textContent = status;
    }

    async function skillsLoadSkills() {
      var d = await fetchApi('/api/skills?tool=' + skillsCurrentTool + '&source=' + skillsCurrentSource);
      if (!Array.isArray(d)) d = [];
      skillsUpdateListStatus(d);

      var list = document.getElementById('skills-list');
      if (d.length === 0) {
        list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-dim);padding:2rem;">No skills found for ' + escapeHtml(skillsCurrentTool) + ' (' + escapeHtml(skillsCurrentSource) + ').</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < d.length; i++) {
        var s = d[i];
        var enabled = !!(s.enabledByDriver && s.enabledByDriver[skillsCurrentTool]);
        var toggleTrackClass = 'mode-toggle-track' + (enabled ? ' on' : '');
        var toggle = '<label class="mode-toggle skill-toggle-sm" onclick="skillsToggleFromList(\\'' + escapeInlineJsArg(s.sourceKind) + '\\',\\'' + escapeInlineJsArg(s.dirName) + '\\',' + (!enabled) + ',event)">'
          + '<span class="' + toggleTrackClass + '"><span class="mode-toggle-knob"></span></span>'
          + '</label>';
        var badges = skillsRenderSourceBadge(s.sourceKind);
        if (!s.editable) {
          badges += skillsBuildBadge('read-only', 'font-size:0.65rem;background:rgba(44,44,44,0.06);color:var(--text-dim);border:1px solid rgba(44,44,44,0.12);');
        }
        if (s.hasErrors) {
          badges += skillsBuildBadge('issues', 'font-size:0.65rem;background:rgba(220,38,38,0.12);color:#b91c1c;border:1px solid rgba(220,38,38,0.18);');
        }
        if (s.envVars && s.envVars.length > 0) {
          badges += skillsBuildBadge('env ' + s.envVars.length, 'font-size:0.65rem;background:rgba(124,58,237,0.10);color:#6d28d9;border:1px solid rgba(124,58,237,0.18);');
        }
        var tools = '';
        if (Array.isArray(s.toolVariants)) {
          for (var t = 0; t < s.toolVariants.length; t++) {
            tools += '<span class="badge" style="font-size:0.62rem;background:rgba(44,44,44,0.06);border:1px solid rgba(44,44,44,0.18);color:var(--text);margin-right:0.25rem;">' + escapeHtml(s.toolVariants[t]) + '</span>';
          }
        }
        var actions = '';
        if (s.editable) {
          actions = '<button class="btn" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="skillsEditSkill(\\'' + escapeInlineJsArg(s.sourceKind) + '\\',\\'' + escapeInlineJsArg(s.dirName) + '\\',event)">Edit</button>'
            + '<button class="btn btn-danger" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="skillsDeleteSkill(\\'' + escapeInlineJsArg(s.sourceKind) + '\\',\\'' + escapeInlineJsArg(s.dirName) + '\\',event)">Del</button>';
        }
        html += '<div class="card" style="padding:1rem;margin-bottom:0.65rem;cursor:pointer;" onclick="skillsViewDetail(\\'' + escapeInlineJsArg(s.sourceKind) + '\\',\\'' + escapeInlineJsArg(s.dirName) + '\\')">'
          + '<div style="display:flex;justify-content:space-between;gap:0.9rem;align-items:flex-start;">'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;flex-wrap:wrap;">'
          + '<div style="font-weight:600;font-size:0.96rem;">' + escapeHtml(s.name || s.dirName) + '</div>'
          + '<div style="display:flex;gap:0.35rem;flex-wrap:wrap;">' + badges + '</div>'
          + '</div>'
          + '<div style="color:var(--text-dim);font-size:0.82rem;margin:0.35rem 0 0.55rem;line-height:1.5;">' + escapeHtml(s.description || 'No description') + '</div>'
          + '<div style="font-size:0.74rem;color:var(--text-dim);margin-bottom:0.45rem;">Directory: <code>' + escapeHtml(s.dirName) + '</code> · Files: ' + ((s.supportFiles && s.supportFiles.length) || 0) + '</div>'
          + '<div style="font-size:0.75rem;color:var(--text-dim);">Tools: ' + tools + '</div>'
          + '</div>'
          + '<div style="display:flex;align-items:center;gap:0.55rem;flex-shrink:0;">'
          + toggle
          + (actions ? '<div style="display:flex;gap:0.3rem;">' + actions + '</div>' : '')
          + '<span style="color:var(--text-dim);font-size:1.1rem;">&#8250;</span>'
          + '</div>'
          + '</div></div>';
      }
      list.innerHTML = html;
    }

    async function skillsToggleSkill(sourceKind, dirName, enable) {
      var result = await fetchApi('/api/skills/entry/' + sourceKind + '/' + encodeURIComponent(dirName) + '/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable, driver: skillsCurrentTool })
      });
      if (result && result.success) {
        toast((enable ? 'Enabled' : 'Disabled') + (result.requiresRestart ? ' (requires restart)' : ''), 'success');
        return true;
      }
      return false;
    }

    async function skillsToggleFromList(sourceKind, dirName, enable, event) {
      event.stopPropagation();
      event.preventDefault();
      var ok = await skillsToggleSkill(sourceKind, dirName, enable);
      if (!ok) return;
      await skillsLoadSkills();
      if (skillsViewingSkill && skillsViewingSkill.sourceKind === sourceKind && skillsViewingSkill.dirName === dirName) {
        skillsViewDetail(sourceKind, dirName);
      }
    }

    async function skillsToggleFromDetail(enable) {
      if (!skillsDetailData) return;
      var ok = await skillsToggleSkill(skillsDetailData.sourceKind, skillsDetailData.dirName, enable);
      if (ok) {
        skillsViewDetail(skillsDetailData.sourceKind, skillsDetailData.dirName);
      }
    }

    function skillsShowCreateModal() {
      skillsEditingSkill = null;
      document.getElementById('skills-modal-title').textContent = 'New ' + skillsCurrentScope + ' Skill';
      document.getElementById('skills-modal-save').textContent = 'Create';
      document.getElementById('skills-input-dirname').value = '';
      document.getElementById('skills-input-dirname').disabled = false;
      skillsResetModalFields();
      document.getElementById('skills-modal').style.display = 'flex';
    }

    function skillsResetModalFields() {
      var ids = ['name', 'body-claude', 'body-codex', 'body-gemini', 'requirements'];
      for (var i = 0; i < ids.length; i++) {
        document.getElementById('skills-input-' + ids[i]).value = '';
      }
      document.getElementById('skills-input-description').value = '';
      document.getElementById('skills-scripts-list').innerHTML = '';
      skillsPendingScripts = {};
      skillsReqEnabled = false;
      document.getElementById('skills-req-toggle').classList.remove('on');
      document.getElementById('skills-input-requirements').style.display = 'none';
      skillsDriverTab('claude');
    }

    async function skillsEditSkill(sourceKind, dirName, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      if (sourceKind === 'builtin') return;
      skillsSetScope(sourceKind);
      var d = await fetchApi('/api/skills/multi/' + sourceKind + '/' + encodeURIComponent(dirName));
      if (!d) return;

      skillsEditingSkill = { sourceKind: sourceKind, dirName: dirName };
      document.getElementById('skills-modal-title').textContent = 'Edit: ' + dirName;
      document.getElementById('skills-modal-save').textContent = 'Save';
      document.getElementById('skills-input-dirname').value = dirName;
      document.getElementById('skills-input-dirname').disabled = true;
      skillsResetModalFields();

      var tools = ['claude', 'codex', 'gemini'];
      var firstFm = null;
      for (var t = 0; t < tools.length; t++) {
        if (d.drivers[tools[t]]) {
          firstFm = d.drivers[tools[t]].frontmatter || {};
          break;
        }
      }
      if (firstFm) {
        if (firstFm.name) document.getElementById('skills-input-name').value = firstFm.name;
        if (firstFm.description) document.getElementById('skills-input-description').value = firstFm.description;
      }

      for (var ti = 0; ti < tools.length; ti++) {
        if (d.drivers[tools[ti]]) {
          document.getElementById('skills-input-body-' + tools[ti]).value = d.drivers[tools[ti]].body || '';
        }
      }

      if (d.requirements) {
        skillsReqEnabled = true;
        document.getElementById('skills-req-toggle').classList.add('on');
        document.getElementById('skills-input-requirements').style.display = '';
        document.getElementById('skills-input-requirements').value = d.requirements;
      }

      if (d.scripts && d.scripts.length > 0) {
        for (var i = 0; i < d.scripts.length; i++) {
          skillsRenderScriptRow(d.scripts[i], false);
        }
      }

      document.getElementById('skills-modal').style.display = 'flex';
    }

    function skillsCloseModal() {
      document.getElementById('skills-modal').style.display = 'none';
      skillsEditingSkill = null;
    }

    function skillsCollectDriverData() {
      var commonFm = {};
      var name = document.getElementById('skills-input-name').value.trim();
      if (name) commonFm.name = name;
      var desc = document.getElementById('skills-input-description').value.trim();
      if (desc) commonFm.description = desc;

      var drivers = {};
      var tools = ['claude', 'codex', 'gemini'];
      for (var i = 0; i < tools.length; i++) {
        var body = document.getElementById('skills-input-body-' + tools[i]).value;
        if (body.trim()) {
          var fm = {};
          for (var k in commonFm) fm[k] = commonFm[k];
          drivers[tools[i]] = { frontmatter: fm, body: body };
        }
      }
      return drivers;
    }

    async function skillsSaveSkill() {
      var dirName = document.getElementById('skills-input-dirname').value.trim();
      if (!dirName) {
        toast('Directory name is required', 'error');
        return;
      }

      var drivers = skillsCollectDriverData();
      if (Object.keys(drivers).length === 0) {
        toast('At least one driver SKILL.md body is required', 'error');
        return;
      }

      var payload = { drivers: drivers };
      if (skillsReqEnabled) {
        payload.requirements = document.getElementById('skills-input-requirements').value;
      } else if (skillsEditingSkill) {
        payload.requirements = null;
      }

      var scripts = [];
      for (var fname in skillsPendingScripts) {
        if (Object.prototype.hasOwnProperty.call(skillsPendingScripts, fname)) {
          scripts.push({ filename: fname, content: skillsPendingScripts[fname] });
        }
      }
      if (scripts.length > 0) {
        payload.scripts = scripts;
      }

      var result;
      if (skillsEditingSkill) {
        result = await fetchApi('/api/skills/multi/' + skillsEditingSkill.sourceKind + '/' + encodeURIComponent(skillsEditingSkill.dirName), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        payload.name = dirName;
        result = await fetchApi('/api/skills/multi/' + skillsCurrentScope, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (result && result.success) {
        var editedSkill = skillsEditingSkill;
        toast(editedSkill ? 'Skill updated' : 'Skill created', 'success');
        skillsCloseModal();
        await skillsLoadSkills();
        if (editedSkill) {
          skillsViewDetail(editedSkill.sourceKind, editedSkill.dirName);
        }
      }
    }

    async function skillsDeleteSkill(sourceKind, dirName, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      if (sourceKind === 'builtin') return;
      if (!confirm('Delete skill "' + dirName + '" and all its files from all drivers?')) return;
      var result = await fetchApi('/api/skills/multi/' + sourceKind + '/' + encodeURIComponent(dirName), {
        method: 'DELETE'
      });
      if (result && result.success) {
        toast('Skill deleted', 'success');
        if (skillsViewingSkill && skillsViewingSkill.sourceKind === sourceKind && skillsViewingSkill.dirName === dirName) {
          skillsBackToList(false);
        }
        skillsLoadSkills();
      }
    }

    function skillsShowDetailView() {
      document.getElementById('skills-main').style.display = 'none';
      document.getElementById('skills-detail').style.display = '';
    }

    function skillsBackToList(reload) {
      if (reload !== false) {
        skillsLoadSkills();
      }
      skillsDetailData = null;
      skillsViewingSkill = null;
      document.getElementById('skills-detail').style.display = 'none';
      document.getElementById('skills-main').style.display = '';
    }

    function skillsToggleEnvVisibility(btn) {
      var row = btn.parentElement;
      var input = row ? row.querySelector('.skill-envvar-input') : null;
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = _eyeOpenSvg;
      } else {
        input.type = 'password';
        btn.innerHTML = _eyeClosedSvg;
      }
    }

    var _eyeOpenSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var _eyeClosedSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

    function skillsDetailSupportsCurrentTool() {
      return !!(
        skillsDetailData &&
        Array.isArray(skillsDetailData.toolVariants) &&
        skillsDetailData.toolVariants.indexOf(skillsCurrentTool) >= 0
      );
    }

    function skillsSyncEnvVarInputState(input) {
      var masked = input.getAttribute('data-envmasked') === 'true';
      var hasValue = input.getAttribute('data-hasvalue') === 'true';
      var clear = input.getAttribute('data-clear') === 'true';
      if (clear) {
        input.placeholder = '(saved value will be cleared on save)';
        return;
      }
      if (masked && hasValue && !input.value) {
        input.placeholder = '(configured — enter new value to update)';
        return;
      }
      input.placeholder = 'Enter value...';
    }

    function skillsMarkEnvVarDirty(input) {
      input.setAttribute('data-dirty', 'true');
      input.setAttribute('data-clear', 'false');
      skillsSyncEnvVarInputState(input);
    }

    function skillsClearEnvVar(key, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      var input = document.getElementById('envvar-' + key);
      if (!input) return;
      input.value = '';
      input.type = 'password';
      input.setAttribute('data-dirty', 'true');
      input.setAttribute('data-clear', 'true');
      skillsSyncEnvVarInputState(input);
    }

    async function skillsSaveEnvVars() {
      if (!skillsDetailData) return;
      var inputs = document.querySelectorAll('.skill-envvar-input');
      var envVars = {};
      for (var i = 0; i < inputs.length; i++) {
        var key = inputs[i].getAttribute('data-envkey');
        var masked = inputs[i].getAttribute('data-envmasked') === 'true';
        var hasValue = inputs[i].getAttribute('data-hasvalue') === 'true';
        var clear = inputs[i].getAttribute('data-clear') === 'true';
        if (clear) {
          envVars[key] = '';
        } else if (masked && hasValue && inputs[i].value === '') {
          envVars[key] = skillsMaskedValueToken;
        } else {
          envVars[key] = inputs[i].value;
        }
      }
      var result = await fetchApi('/api/skills/entry/' + skillsDetailData.sourceKind + '/' + encodeURIComponent(skillsDetailData.dirName) + '/env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envVars: envVars })
      });
      if (result && result.success) {
        toast('Environment variables saved', 'success');
        skillsViewDetail(skillsDetailData.sourceKind, skillsDetailData.dirName);
      }
    }

    async function skillsViewDetail(sourceKind, dirName) {
      var d = await fetchApi('/api/skills/entry/' + sourceKind + '/' + encodeURIComponent(dirName));
      if (!d) return;
      skillsViewingSkill = { sourceKind: sourceKind, dirName: dirName };
      skillsDetailData = d;
      skillsRenderDetail(d);
      skillsShowDetailView();
    }

    function skillsRenderDetail(d) {
      document.getElementById('skills-detail-title').textContent = d.name || d.dirName;
      document.getElementById('skills-detail-ref').textContent = d.skillRef || '';

      var badges = skillsRenderSourceBadge(d.sourceKind);
      if (!d.editable) {
        badges += skillsBuildBadge('read-only', 'font-size:0.68rem;background:rgba(44,44,44,0.06);color:var(--text-dim);border:1px solid rgba(44,44,44,0.12);');
      }
      if (d.manifestStatus && d.manifestStatus !== 'valid') {
        badges += skillsBuildBadge(d.manifestStatus, 'font-size:0.68rem;background:rgba(220,38,38,0.12);color:#b91c1c;border:1px solid rgba(220,38,38,0.18);');
      }
      if (d.envVars && d.envVars.length > 0) {
        badges += skillsBuildBadge('env ' + d.envVars.length, 'font-size:0.68rem;background:rgba(124,58,237,0.10);color:#6d28d9;border:1px solid rgba(124,58,237,0.18);');
      }
      document.getElementById('skills-detail-badges').innerHTML = badges;

      var descEl = document.getElementById('skills-detail-description');
      var descTextEl = document.getElementById('skills-detail-description-text');
      var descWarningEl = document.getElementById('skills-detail-desc-warning');
      var warningsHtml = '';
      if (d.description) {
        descTextEl.textContent = d.description;
      } else {
        descTextEl.textContent = '';
      }
      var missingEnvVars = (d.envVars || []).filter(function(ev) { return !ev.hasValue; });
      if (missingEnvVars.length > 0) {
        var keyList = missingEnvVars.map(function(ev) { return ev.key; }).join(', ');
        warningsHtml += '<div class="builtin-desc-warning"><strong>&#9888; Required:</strong> Set <code>' + escapeHtml(keyList) + '</code> below to use this skill.</div>';
      }
      if (!skillsDetailSupportsCurrentTool()) {
        warningsHtml += '<div class="builtin-desc-warning"><strong>Unavailable:</strong> This skill has no <code>SKILL.' + escapeHtml(skillsCurrentTool) + '.md</code> variant, so ' + escapeHtml(skillsCurrentTool) + ' enablement cannot be changed here.</div>';
      }
      descWarningEl.innerHTML = warningsHtml;
      if (d.description || warningsHtml) {
        descEl.style.display = '';
      } else {
        descEl.style.display = 'none';
      }

      var enabled = !!(d.enabledByDriver && d.enabledByDriver[skillsCurrentTool]);
      var supportsCurrentTool = skillsDetailSupportsCurrentTool();
      var toggleTrack = document.getElementById('skills-detail-toggle-track');
      var toggleLabel = document.getElementById('skills-detail-toggle-label');
      var toggleWrap = document.getElementById('skills-detail-toggle-wrap');
      if (supportsCurrentTool && enabled) {
        toggleTrack.classList.add('on');
        toggleLabel.textContent = 'ON';
      } else if (supportsCurrentTool) {
        toggleTrack.classList.remove('on');
        toggleLabel.textContent = 'OFF';
      } else {
        toggleTrack.classList.remove('on');
        toggleLabel.textContent = 'N/A';
      }
      toggleWrap.style.opacity = supportsCurrentTool ? '' : '0.55';
      toggleWrap.style.cursor = supportsCurrentTool ? '' : 'not-allowed';
      toggleWrap.title = supportsCurrentTool
        ? ('Toggle ' + skillsCurrentTool + ' enablement')
        : ('No SKILL.' + skillsCurrentTool + '.md variant available');
      toggleWrap.onclick = supportsCurrentTool
        ? function() {
            skillsToggleFromDetail(!enabled);
          }
        : function(event) {
            if (event) {
              event.preventDefault();
            }
          };

      var actionsHtml = '';
      if (d.editable) {
        actionsHtml += '<button class="btn" onclick="skillsEditSkill(\\'' + escapeInlineJsArg(d.sourceKind) + '\\',\\'' + escapeInlineJsArg(d.dirName) + '\\',event)">Edit</button>';
        actionsHtml += '<button class="btn btn-danger" onclick="skillsDeleteSkill(\\'' + escapeInlineJsArg(d.sourceKind) + '\\',\\'' + escapeInlineJsArg(d.dirName) + '\\',event)">Delete</button>';
      }
      document.getElementById('skills-detail-actions').innerHTML = actionsHtml;

      var envVarsBody = document.getElementById('skills-detail-envvars-body');
      var envVars = d.envVars || [];
      if (envVars.length === 0) {
        envVarsBody.innerHTML = '<div class="builtin-envvars-empty">No environment variables required for this skill.</div>';
      } else {
        var envHtml = '';
        for (var ei = 0; ei < envVars.length; ei++) {
          var ev = envVars[ei];
          var placeholder = ev.masked && ev.hasValue ? '(configured — enter new value to update)' : 'Enter value...';
          var inputVal = ev.masked ? '' : escapeHtml(ev.value || '');
          envHtml += '<div class="builtin-envvar-row">'
            + '<label class="builtin-envvar-key" for="envvar-' + escapeHtml(ev.key) + '">' + escapeHtml(ev.key) + '</label>'
            + '<input class="builtin-envvar-input skill-envvar-input" type="password" id="envvar-' + escapeHtml(ev.key) + '"'
            + ' data-envkey="' + escapeHtml(ev.key) + '"'
            + ' data-envmasked="' + (ev.masked ? 'true' : 'false') + '"'
            + ' data-hasvalue="' + (ev.hasValue ? 'true' : 'false') + '"'
            + ' data-clear="false"'
            + ' data-dirty="false"'
            + ' value="' + inputVal + '"'
            + ' placeholder="' + escapeHtml(placeholder) + '"'
            + ' oninput="skillsMarkEnvVarDirty(this)"'
            + ' autocomplete="off" spellcheck="false">'
            + '<button class="btn" style="padding:0.25rem 0.55rem;flex-shrink:0;" onclick="skillsClearEnvVar(\\'' + escapeInlineJsArg(ev.key) + '\\',event)" title="Clear saved value">Clear</button>'
            + '<button class="btn" style="padding:0.25rem 0.5rem;flex-shrink:0;line-height:1;" onclick="skillsToggleEnvVisibility(this)" title="Show/hide value">' + _eyeClosedSvg + '</button>'
            + '</div>';
        }
        envHtml += '<div class="builtin-envvars-actions">'
          + '<button class="btn btn-primary" style="padding:0.3rem 0.8rem;font-size:0.8rem;" onclick="skillsSaveEnvVars()">Save</button>'
          + '</div>';
        envVarsBody.innerHTML = envHtml;
      }

      var variants = d.variants ? Object.keys(d.variants) : [];
      var tabsEl = document.getElementById('skills-detail-variant-tabs');
      if (variants.length > 0) {
        var preferred = variants.indexOf(skillsCurrentTool) >= 0 ? skillsCurrentTool : variants[0];
        if (variants.indexOf(skillsActiveVariant) >= 0) preferred = skillsActiveVariant;
        skillsActiveVariant = preferred;
        var tabsHtml = '';
        for (var vi = 0; vi < variants.length; vi++) {
          var tool = variants[vi];
          var logo = skillsToolIcons[tool] || skillsToolIcons.claude;
          var activeClass = tool === skillsActiveVariant ? ' active' : '';
          tabsHtml += '<div class="skill-detail-tab' + activeClass + '" data-tool="' + tool + '" onclick="skillsSwitchVariant(\\'' + tool + '\\')">'
            + '<img class="chip-icon" src="' + logo + '" alt="">' + escapeHtml(tool) + '</div>';
        }
        tabsEl.innerHTML = tabsHtml;
        tabsEl.style.display = '';
        skillsRenderVariantContent(skillsActiveVariant);
      } else {
        tabsEl.innerHTML = '';
        tabsEl.style.display = 'none';
        document.getElementById('skills-detail-variant-content').innerHTML = '<div class="card" style="padding:1rem;color:var(--text-dim);">No variant files available.</div>';
      }

      var filesHtml = '';
      var supportFiles = d.supportFiles || [];
      if (d.editable) {
        filesHtml += '<div class="skill-section-card">'
          + '<div class="skill-section-header">'
          + '<span class="skill-section-title">Support Files</span>'
          + '<div class="skill-section-actions"><button class="btn btn-primary" style="padding:0.2rem 0.55rem;font-size:0.75rem;" onclick="skillsOpenSupportFileModal(null,event)">+ New File</button></div>'
          + '</div>'
          + '<div class="skill-section-desc">Shared files such as scripts, prompts, or references are stored once per custom skill and reused across all driver variants.</div>'
          + '</div>';
      }
      if (supportFiles.length === 0) {
        filesHtml += '<div class="skill-section-card">'
          + '<div class="skill-section-header"><span class="skill-section-title">Files</span></div>'
          + '<div class="skill-section-body"><div style="padding:1rem;color:var(--text-dim);">No support files.</div></div>'
          + '</div>';
      }
      for (var si = 0; si < supportFiles.length; si++) {
        filesHtml += skillsRenderFileSection(supportFiles[si].path);
      }
      document.getElementById('skills-detail-files').innerHTML = filesHtml;

      for (var fi = 0; fi < supportFiles.length; fi++) {
        skillsLoadFileContent(supportFiles[fi].path);
      }
    }

    function skillsSwitchVariant(tool) {
      skillsActiveVariant = tool;
      var tabs = document.querySelectorAll('#skills-detail-variant-tabs .skill-detail-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tool') === tool);
      }
      skillsRenderVariantContent(tool);
    }

    function skillsReconstructVariant(v) {
      var content = '';
      if (v.frontmatter && Object.keys(v.frontmatter).length > 0) {
        content += '---\\n';
        var fmKeys = Object.keys(v.frontmatter);
        for (var ki = 0; ki < fmKeys.length; ki++) {
          var val = v.frontmatter[fmKeys[ki]];
          content += fmKeys[ki] + ': ' + (typeof val === 'string' ? val : JSON.stringify(val)) + '\\n';
        }
        content += '---\\n\\n';
      }
      content += v.body || '';
      return content;
    }

    function skillsRenderVariantContent(tool) {
      var containerEl = document.getElementById('skills-detail-variant-content');
      if (!skillsDetailData || !skillsDetailData.variants) {
        containerEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);">No variant data.</div>';
        return;
      }
      var v = skillsDetailData.variants[tool];
      if (!v) {
        containerEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);">No content for ' + escapeHtml(tool) + ' variant.</div>';
        return;
      }
      var filepath = 'SKILL.' + tool + '.md';
      var descHtml = skillsGetFileDesc(filepath);
      var content = skillsReconstructVariant(v);
      containerEl.innerHTML = '<div class="skill-section-card">'
        + '<div class="skill-section-header">'
        + '<span class="skill-section-title">' + escapeHtml(filepath) + '</span>'
        + '</div>'
        + (descHtml ? '<div class="skill-section-desc">' + descHtml + '</div>' : '')
        + '<div class="skill-section-body"><pre class="code-viewer">' + escapeHtml(content) + '</pre></div>'
        + '</div>';
    }

    function skillsRenderFileSection(filepath) {
      var sectionId = 'skills-file-' + filepath.replace(/[\\\\/.]/g, '-');
      var descHtml = skillsGetFileDesc(filepath);
      var actions = '';
      if (skillsDetailData && skillsDetailData.editable) {
        actions = '<button class="btn" style="padding:0.15rem 0.45rem;font-size:0.72rem;" onclick="skillsOpenSupportFileModal(\\'' + escapeInlineJsArg(filepath) + '\\',event)">Edit</button>'
          + '<button class="btn btn-danger" style="padding:0.15rem 0.45rem;font-size:0.72rem;" onclick="skillsDeleteSupportFile(\\'' + escapeInlineJsArg(filepath) + '\\',event)">Delete</button>';
      }
      return '<div class="skill-section-card" id="' + sectionId + '">'
        + '<div class="skill-section-header">'
        + '<span class="skill-section-title">' + escapeHtml(filepath) + '</span>'
        + '<div class="skill-section-actions">' + actions + '</div>'
        + '</div>'
        + (descHtml ? '<div class="skill-section-desc">' + descHtml + '</div>' : '')
        + '<div class="skill-section-body" id="' + sectionId + '-body"><div style="text-align:center;padding:1.2rem;color:var(--text-dim);">Loading...</div></div>'
        + '</div>';
    }

    function skillsGetFileDesc(filepath) {
      if (/^SKILL\\.(claude|codex|gemini)\\.md$/.test(filepath)) {
        var driver = filepath.replace('SKILL.', '').replace('.md', '');
        var driverLabels = { claude: 'Claude Code', codex: 'Codex CLI', gemini: 'Gemini CLI' };
        var label = driverLabels[driver] || driver;
        return 'Instruction file loaded by <strong>' + label + '</strong> that defines this skill\\u2019s behavior. '
          + 'The file is renamed and seeded into the working directory as a skill when a session starts.';
      }
      if (/requirements\\.txt$/i.test(filepath)) {
        return 'Python dependencies for this skill. '
          + 'Listed packages are auto-installed into a virtual environment (<code>.venv</code>) when the skill is first seeded.';
      }
      if (/scripts\\//i.test(filepath)) {
        var ext = filepath.split('.').pop();
        var lang = ext === 'py' ? 'Python' : ext === 'sh' ? 'Shell' : '';
        return (lang ? lang + ' runner script' : 'Runner script')
          + ' executed by the agent at runtime. '
          + 'The script receives a JSON payload and writes results to stdout.';
      }
      return '';
    }

    function skillsCloseSupportFileModal() {
      document.getElementById('skills-file-modal').style.display = 'none';
      document.getElementById('skills-file-input-path').value = '';
      document.getElementById('skills-file-input-path').disabled = false;
      document.getElementById('skills-file-input-content').value = '';
      skillsSupportFileDraft = null;
    }

    async function skillsOpenSupportFileModal(filepath, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      if (!skillsDetailData || !skillsDetailData.editable) return;
      skillsSupportFileDraft = { filepath: filepath || '', mode: filepath ? 'edit' : 'create' };
      document.getElementById('skills-file-modal-title').textContent = filepath ? ('Edit File: ' + filepath) : 'New Support File';
      document.getElementById('skills-file-save').textContent = filepath ? 'Save' : 'Create';
      document.getElementById('skills-file-input-path').value = filepath || '';
      document.getElementById('skills-file-input-path').disabled = !!filepath;
      document.getElementById('skills-file-input-content').value = '';
      document.getElementById('skills-file-modal').style.display = 'flex';
      if (!filepath) return;

      var d = await fetchApi('/api/skills/entry/' + skillsDetailData.sourceKind + '/' + encodeURIComponent(skillsDetailData.dirName)
        + '/files/' + encodeURIComponent(filepath));
      if (!d) {
        toast('Failed to load file', 'error');
        skillsCloseSupportFileModal();
        return;
      }
      document.getElementById('skills-file-input-content').value = d.content || '';
    }

    async function skillsSaveSupportFile() {
      if (!skillsDetailData || !skillsDetailData.editable) return;
      var filepath = document.getElementById('skills-file-input-path').value.trim();
      if (!filepath) {
        toast('File path is required', 'error');
        return;
      }
      var content = document.getElementById('skills-file-input-content').value;
      var result = await fetchApi('/api/skills/entry/' + skillsDetailData.sourceKind + '/' + encodeURIComponent(skillsDetailData.dirName)
        + '/files/' + encodeURIComponent(filepath), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content })
      });
      if (result && result.success) {
        toast(skillsSupportFileDraft && skillsSupportFileDraft.mode === 'edit' ? 'File updated' : 'File created', 'success');
        skillsCloseSupportFileModal();
        skillsViewDetail(skillsDetailData.sourceKind, skillsDetailData.dirName);
      }
    }

    async function skillsLoadFileContent(filepath) {
      if (!skillsDetailData) return;
      var sectionId = 'skills-file-' + filepath.replace(/[\\\\/.]/g, '-');
      var bodyEl = document.getElementById(sectionId + '-body');
      if (!bodyEl) return;
      var d = await fetchApi('/api/skills/entry/' + skillsDetailData.sourceKind + '/' + encodeURIComponent(skillsDetailData.dirName)
        + '/files/' + encodeURIComponent(filepath));
      if (!d) {
        bodyEl.innerHTML = '<div style="padding:1rem;color:var(--text-dim);">Failed to load file.</div>';
        return;
      }
      bodyEl.innerHTML = '<pre class="code-viewer">' + escapeHtml(d.content || '') + '</pre>';
    }

    async function skillsDeleteSupportFile(filepath, event) {
      if (event) {
        event.stopPropagation();
        event.preventDefault();
      }
      if (!skillsDetailData || !skillsDetailData.editable) return;
      if (!confirm('Delete file "' + filepath + '"?')) return;
      var result = await fetchApi('/api/skills/entry/' + skillsDetailData.sourceKind + '/' + encodeURIComponent(skillsDetailData.dirName)
        + '/files/' + encodeURIComponent(filepath), { method: 'DELETE' });
      if (result && result.success) {
        toast('File deleted', 'success');
        skillsViewDetail(skillsDetailData.sourceKind, skillsDetailData.dirName);
      }
    }

    /* ── Init ── */
    skillsSetScope('local');
    skillsLoadSkills();
    onHashChange();
    setInterval(function() {
      if (location.hash === '' || location.hash === '#overview') refreshOverview();
    }, 5000);
`;
}
