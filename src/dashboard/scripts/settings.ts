/** @module dashboard/scripts/settings — Client-side script for the Settings tab (config, prompts, mode). */
import { ICON_CLAUDE, ICON_CODEX, ICON_GEMINI } from '../icons.js';

export function settingsScript(): string {
  return `
    /* ── Settings ── */
    var SETTINGS_CATEGORIES = {
      mode: {
        label: 'Mode', icon: '&#9889;&#xFE0E;',
        subSections: null
      },
      messaging: {
        label: 'Messaging', icon: '&#9993;&#xFE0E;',
        subSections: {
          slack: { label: 'Slack', iconVar: null }
        }
      },
      apps: {
        label: 'Apps', icon: '&#9881;',
        subSections: {
          general: { label: 'General', iconVar: null },
          claude:  { label: 'Claude',  iconVar: 'claude' },
          gemini:  { label: 'Gemini',  iconVar: 'gemini' },
          codex:   { label: 'Codex',   iconVar: 'codex' }
        }
      },
      prompts: {
        label: 'Prompts', icon: '&#167;',
        subSections: {
          claude:  { label: 'Claude',  iconVar: 'claude' },
          gemini:  { label: 'Gemini',  iconVar: 'gemini' },
          codex:   { label: 'Codex',   iconVar: 'codex' }
        }
      },
      environment: {
        label: 'Environment', icon: '&#9998;',
        subSections: {
          runtime:  { label: 'Runtime',  iconVar: null },
          network:  { label: 'Network',  iconVar: null },
          schedule: { label: 'Schedule', iconVar: null }
        }
      }
    };

    // Client-side sub-category overrides for environment keys (server has sub: null)
    var ENV_SUB_MAP = {
      MAX_CONCURRENCY: 'runtime', MAX_RUNTIME_SEC: 'runtime',
      NO_OUTPUT_TIMEOUT_SEC: 'runtime', WORKDIR_ROOT: 'runtime',
      ALLOWED_WORKDIR_ROOTS: 'runtime', LOG_LEVEL: 'runtime',
      HUSKYGATE_LOG_STACKS: 'runtime',
      SERVER_API_PORT: 'network', SERVER_API_HOST: 'network',
      WEBHOOK_PUBLIC_BASE_URL: 'network',
      CLOUDFLARE_TUNNEL_ENABLED: 'network', CLOUDFLARE_TUNNEL_TOKEN: 'network',
      GITHUB_WEBHOOK_IP_ALLOWLIST: 'network',
      HUSKYGATE_DASHBOARD_COOKIE_SECURE: 'network',
      HUSKYGATE_OAUTH_TRUSTED_HOSTS: 'network',
      SESSION_IDLE_TIMEOUT_SEC: 'schedule',
      SESSION_CLEANUP_ENABLED: 'schedule', SCHEDULE_ENABLED: 'schedule',
      SCHEDULE_POLL_INTERVAL_SEC: 'schedule',
      SCHEDULE_MAX_CONCURRENT: 'schedule', SCHEDULE_DEFAULT_NOTIFY_CHANNEL: 'schedule'
    };

    // Schema-driven key→category mapping (fetched once from /api/settings/schema)
    var settingsSchema = null;

    async function loadSettingsSchema() {
      if (settingsSchema) return;
      var d = await fetchApi('/api/settings/schema');
      if (!d || !d.schema) return;
      settingsSchema = {};
      for (var i = 0; i < d.schema.length; i++) {
        var s = d.schema[i];
        settingsSchema[s.key] = {
          cat: s.cat, sub: s.sub, sensitive: s.sensitive,
          skill: !!s.skill,
          description: s.description || '',
          default: s.default || '',
          valueType: s.valueType || '',
          enumValues: s.enumValues || null,
          mutable: !!s.mutable
        };
      }
      // Apply client-side sub overrides for environment keys
      for (var key in ENV_SUB_MAP) {
        if (settingsSchema[key]) settingsSchema[key].sub = ENV_SUB_MAP[key];
      }
    }

    var settingsToolIcons = { claude: '${ICON_CLAUDE}', codex: '${ICON_CODEX}', gemini: '${ICON_GEMINI}' };
    var settingsActiveCategory = null;
    var settingsActiveSub = null;
    var settingsGrouped = null;
    var settingsData = [];
    var settingsOriginalData = {};
    var keychainAvailable = false;
    var promptsData = null;
    var promptsAutorunMode = false;

    function navigateToAppSettings(appName) {
      location.hash = 'settings';
      // Wait for tab switch to complete, then navigate to the app sub-section
      setTimeout(function() {
        selectSettingsCategory('apps');
        selectSettingsSub(appName);
      }, 50);
    }

    function selectSettingsCategory(cat) {
      // Discard unsaved local prompt edits when leaving Prompts category
      if (settingsActiveCategory === 'prompts' && cat !== 'prompts') {
        promptsData = null;
      }
      settingsActiveCategory = cat;
      settingsActiveSub = null;
      var catDef = SETTINGS_CATEGORIES[cat];
      renderSettingsNav();
      if (catDef.subSections) {
        var firstSub = Object.keys(catDef.subSections)[0];
        selectSettingsSub(firstSub);
      } else {
        document.getElementById('settings-subnav').classList.remove('visible');
        document.getElementById('settings-subnav').innerHTML = '';
        renderSettingsForm();
      }
    }

    function selectSettingsSub(sub) {
      // Discard unsaved local prompt edits when switching tools within Prompts
      if (settingsActiveCategory === 'prompts' && settingsActiveSub && settingsActiveSub !== sub) {
        promptsData = null;
      }
      settingsActiveSub = sub;
      renderSettingsSubNav();
      renderSettingsForm();
    }

    function renderSettingsNav() {
      var catOrder = ['mode', 'messaging', 'apps', 'prompts', 'environment'];
      var html = '';
      for (var ci = 0; ci < catOrder.length; ci++) {
        var catKey = catOrder[ci];
        var catDef = SETTINGS_CATEGORIES[catKey];
        var isActive = settingsActiveCategory === catKey;
        html += '<div class="settings-nav-item' + (isActive ? ' active' : '') + '" onclick="selectSettingsCategory(\\'' + catKey + '\\')">';
        html += '<span class="settings-nav-icon">' + catDef.icon + '</span>';
        html += '<span>' + catDef.label + '</span>';
        html += '</div>';
      }
      document.getElementById('settings-nav').innerHTML = html;
    }

    function renderSettingsSubNav() {
      var el = document.getElementById('settings-subnav');
      if (!settingsActiveCategory) { el.classList.remove('visible'); return; }
      var catDef = SETTINGS_CATEGORIES[settingsActiveCategory];
      if (!catDef.subSections) { el.classList.remove('visible'); el.innerHTML = ''; return; }
      el.classList.add('visible');
      var subs = Object.keys(catDef.subSections);
      var html = '';
      for (var si = 0; si < subs.length; si++) {
        var subKey = subs[si];
        var subDef = catDef.subSections[subKey];
        var isActive = settingsActiveSub === subKey;
        html += '<div class="settings-subnav-item' + (isActive ? ' active' : '') + '" onclick="selectSettingsSub(\\'' + subKey + '\\')">';
        if (subDef.iconVar && settingsToolIcons[subDef.iconVar]) {
          html += '<img src="' + settingsToolIcons[subDef.iconVar] + '" alt="">';
        }
        html += '<span>' + subDef.label + '</span>';
        html += '</div>';
      }
      el.innerHTML = html;
    }

    function renderSettingsFormEmpty(msg) {
      document.getElementById('settings-form-panel').innerHTML = '<div class="settings-form-empty">' + escapeHtml(msg) + '</div>';
    }

    function renderSettingsForm() {
      if (!settingsGrouped) return;

      // Mode category: custom toggle panel
      if (settingsActiveCategory === 'mode') {
        renderModePanel();
        return;
      }

      // Prompts category: custom prompt viewer/editor panel
      if (settingsActiveCategory === 'prompts') {
        renderPromptsPanel();
        return;
      }

      if (!settingsActiveSub || !settingsActiveCategory) {
        renderSettingsFormEmpty('Select a sub-category');
        return;
      }
      var catDef = SETTINGS_CATEGORIES[settingsActiveCategory];
      if (!catDef || !catDef.subSections || !catDef.subSections[settingsActiveSub]) {
        renderSettingsFormEmpty('Select a sub-category');
        return;
      }
      var subDef = catDef.subSections[settingsActiveSub];
      var entries = settingsGrouped[settingsActiveCategory][settingsActiveSub] || [];
      var title = subDef.label;
      var iconSrc = null;
      if (subDef.iconVar && settingsToolIcons[subDef.iconVar]) {
        iconSrc = settingsToolIcons[subDef.iconVar];
      }
      var html = '<div class="settings-form-title">';
      if (iconSrc) html += '<img src="' + iconSrc + '" alt="">';
      html += escapeHtml(title) + '</div>';
      html += '<div id="settings-form-content" style="flex:1;overflow-y:auto;">';
      html += renderSettingsTable(entries);
      html += '</div>';
      html += '<div class="btn-group" style="flex-shrink:0;padding-top:0.75rem;border-top:1px solid var(--border);margin-top:0.75rem;">';
      html += '<button class="btn btn-primary" onclick="saveSettings()">Save</button>';
      html += '<button class="btn" onclick="loadSettings()">Reset</button>';
      html += '</div>';
      document.getElementById('settings-form-panel').innerHTML = html;
    }

    function renderModePanel() {
      var autoApproveVal = '';
      for (var i = 0; i < settingsData.length; i++) {
        if (settingsData[i].key === 'TOOL_AUTO_APPROVE_MODE') { autoApproveVal = settingsData[i].value; break; }
      }
      var isOn = autoApproveVal === 'true' || autoApproveVal === '1';
      var html = '<div class="settings-form-title">Mode</div>';
      html += '<div id="settings-form-content" style="flex:1;overflow-y:auto;">';
      html += '<div class="mode-panel">';
      // Auto-Approve toggle card
      html += '<div class="mode-card">';
      html += '<div class="mode-card-header">';
      html += '<span class="mode-card-title">Auto-Approve Mode</span>';
      html += '<label class="mode-toggle" onclick="toggleAutoApprove()">';
      html += '<span class="mode-toggle-track' + (isOn ? ' on' : '') + '" id="mode-toggle-track">';
      html += '<span class="mode-toggle-knob"></span>';
      html += '</span>';
      html += '<span class="mode-toggle-label" id="mode-toggle-label">' + (isOn ? 'ON' : 'OFF') + '</span>';
      html += '</label>';
      html += '</div>';
      html += '<p class="mode-desc">When enabled, all MCP tool calls (e.g. <code>mcp__aws-api__*</code>) are executed immediately without requiring user approval via <code>!y</code> / <code>!n</code> in Slack.</p>';
      html += '<p class="mode-desc">Use the <code>!autorun</code> command in Slack to toggle auto-approve for individual sessions, regardless of this global setting.</p>';
      html += '<div class="mode-warning">';
      html += '<span class="mode-warning-icon">&#9888;</span>';
      html += '<div>';
      html += '<strong>Use with caution</strong>';
      html += '<p>When auto-approve is active, the AI agent can invoke any connected MCP tool without human confirmation. This is useful for trusted workflows, but can lead to unintended actions (e.g. AWS resource creation/deletion). Recommended only for development and testing environments.</p>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      html += '<div class="btn-group" style="flex-shrink:0;padding-top:0.75rem;border-top:1px solid var(--border);margin-top:0.75rem;">';
      html += '<button class="btn btn-primary" onclick="saveModeSettings()">Save</button>';
      html += '<button class="btn" onclick="loadSettings()">Reset</button>';
      html += '</div>';
      document.getElementById('settings-form-panel').innerHTML = html;
    }

    function toggleAutoApprove() {
      var track = document.getElementById('mode-toggle-track');
      var label = document.getElementById('mode-toggle-label');
      if (!track || !label) return;
      var isOn = track.classList.contains('on');
      var newVal = !isOn;
      if (isOn) {
        track.classList.remove('on');
        label.textContent = 'OFF';
      } else {
        track.classList.add('on');
        label.textContent = 'ON';
      }
      // Keep settingsData in sync with DOM so Save/Reset work correctly
      for (var i = 0; i < settingsData.length; i++) {
        if (settingsData[i].key === 'TOOL_AUTO_APPROVE_MODE') {
          settingsData[i].value = newVal ? 'true' : 'false';
          return;
        }
      }
      settingsData.push({ key: 'TOOL_AUTO_APPROVE_MODE', value: newVal ? 'true' : 'false', masked: false });
    }

    async function saveModeSettings() {
      var patches = [];
      for (var i = 0; i < settingsData.length; i++) {
        if (settingsData[i].key !== 'TOOL_AUTO_APPROVE_MODE') continue;
        var original = settingsOriginalData.TOOL_AUTO_APPROVE_MODE || { value: '' };
        var currentValue = settingsData[i].value || '';
        if (currentValue !== original.value) {
          patches.push({ key: 'TOOL_AUTO_APPROVE_MODE', op: 'set', value: currentValue });
        }
        break;
      }
      if (patches.length === 0) {
        toast('No changes to save', 'success');
        return;
      }
      var d = await fetchApi('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches: patches })
      });
      if (d && d.success) {
        if (d.applied && d.applied.length > 0) {
          toast('Settings applied: ' + d.applied.join(', '), 'success');
        }
        if (d.requiresRestart && d.requiresRestart.length > 0) {
          showRestartBanner(d.requiresRestart);
        } else if (!d.requiresRestart || d.requiresRestart.length === 0) {
          toast('Settings saved', 'success');
        }
        loadSettings();
      }
    }

    /* ── Prompts Panel ── */

    async function loadPromptsData() {
      var d = await fetchApi('/api/settings/prompts');
      if (d && d.prompts) promptsData = d.prompts;
    }

    async function renderPromptsPanel() {
      if (!promptsData) await loadPromptsData();
      if (!promptsData || !settingsActiveSub) {
        renderSettingsFormEmpty('Select a tool');
        return;
      }
      var tool = settingsActiveSub;
      var data = null;
      for (var i = 0; i < promptsData.length; i++) {
        if (promptsData[i].tool === tool) { data = promptsData[i]; break; }
      }
      if (!data) { renderSettingsFormEmpty('Unknown tool'); return; }

      var iconSrc = settingsToolIcons[tool] || '';
      var label = tool.charAt(0).toUpperCase() + tool.slice(1);
      var html = '<div class="settings-form-title">';
      if (iconSrc) html += '<img src="' + iconSrc + '" alt="">';
      html += escapeHtml(label) + ' Prompts</div>';

      html += '<div id="settings-form-content" style="flex:1;overflow-y:auto;">';

      // Base prompt preview (read-only)
      html += '<div class="prompt-section">';
      html += '<div class="prompt-section-header">';
      html += '<span class="prompt-section-title">Base Prompt</span>';
      html += '<span class="prompt-badge">Read-only</span>';
      html += '<div class="prompt-mode-tabs">';
      html += '<button class="prompt-mode-tab' + (!promptsAutorunMode ? ' active' : '') + '" onclick="setPromptsMode(false)">Standard</button>';
      html += '<button class="prompt-mode-tab' + (promptsAutorunMode ? ' active' : '') + '" onclick="setPromptsMode(true)">Autorun</button>';
      html += '</div>';
      html += '</div>';
      var preview = promptsAutorunMode ? data.previewAutorun : data.preview;
      html += '<pre class="code-viewer prompt-preview">' + escapeHtml(preview) + '</pre>';
      html += '</div>';

      // Custom Instructions (editable + enable toggle)
      var isEnabled = !!data.enabled;
      html += '<div class="prompt-section">';
      html += '<div class="prompt-section-header">';
      html += '<span class="prompt-section-title">Custom Instructions</span>';
      html += '<label class="mode-toggle" onclick="toggleCustomInstructions()">';
      html += '<span class="mode-toggle-track' + (isEnabled ? ' on' : '') + '" id="custom-instr-toggle">';
      html += '<span class="mode-toggle-knob"></span>';
      html += '</span>';
      html += '<span class="mode-toggle-label" id="custom-instr-label">' + (isEnabled ? 'ON' : 'OFF') + '</span>';
      html += '</label>';
      html += '</div>';

      // Behaviour description
      if (isEnabled) {
        html += '<p class="prompt-help">Custom Instructions <strong>replace the entire Base Prompt</strong> for <strong>' + escapeHtml(label) + '</strong> tasks. Task-specific instructions (per-job) still take priority when set.</p>';
        // Warning
        html += '<div class="mode-warning" style="margin-bottom:0.75rem;">';
        html += '<span class="mode-warning-icon">&#9888;</span>';
        html += '<div>';
        html += '<strong>Some features may not work correctly</strong>';
        html += '<p style="margin:0.25rem 0 0">The Base Prompt contains directives required by the application. '
          + 'Omitting them may cause MCP tool approval, chat response parsing, or output file delivery to fail. '
          + 'Refer to the <strong>Prompt Reference</strong> below for required elements.</p>';
        html += '</div>';
        html += '</div>';
      } else {
        html += '<p class="prompt-help">Appended as &ldquo;Additional Instructions&rdquo; to the Base Prompt when no task-specific instructions are set. Enable the toggle to use Custom Instructions as a <strong>full replacement</strong> of the Base Prompt.</p>';
      }

      html += '<textarea class="prompt-editor" id="prompt-default-content" rows="8" '
        + 'placeholder="e.g. Always respond in Japanese. Use Python 3.12.">'
        + escapeHtml(data.defaultContent || '') + '</textarea>';

      // Prompt Reference (collapsible) — shown when enabled
      if (isEnabled) {
        html += '<details class="prompt-reference" style="margin-top:0.75rem;">';
        html += '<summary class="prompt-reference-summary">Prompt Reference &mdash; required elements</summary>';
        html += '<div class="prompt-reference-body">';
        html += '<table class="prompt-ref-table"><tbody>';
        html += '<tr><td class="prompt-ref-key">Response Format</td>'
          + '<td>Chat responses must start with <code>&lt;!-- answer --&gt;</code> on its own line. Without this marker, the orchestrator cannot parse the response and messages will not be forwarded to Slack.</td></tr>';
        html += '<tr><td class="prompt-ref-key">MCP Tool Policy</td>'
          + '<td><strong>Standard mode:</strong> Agent must output <code>[MCP_TOOL_REQUEST]</code> blocks instead of calling <code>mcp__*</code> tools directly. '
          + '<strong>Autorun mode:</strong> All <code>mcp__*</code> tools are pre-approved for direct execution. Without the correct policy, tool calls will be blocked or behave unexpectedly.</td></tr>';
        html += '<tr><td class="prompt-ref-key">Output Files</td>'
          + '<td>Deliverables must be placed in <code>_output/</code> for automatic file delivery. Without this directive the agent will not use the delivery directory.</td></tr>';
        html += '<tr><td class="prompt-ref-key">Environment</td>'
          + '<td>No stdin available (never prompt for input). Work within the current directory only. These constraints prevent the agent from hanging on interactive prompts or modifying files outside the workspace.</td></tr>';
        html += '<tr><td class="prompt-ref-key">Constraints</td>'
          + '<td>Never delete instruction files (CLAUDE.md, AGENTS.md, GEMINI.md). Do not expose secrets. Confirm before destructive operations. Do not modify system packages.</td></tr>';
        html += '</tbody></table>';
        html += '</div>';
        html += '</details>';
      }

      html += '</div>';

      html += '</div>';

      html += '<div class="btn-group" style="flex-shrink:0;padding-top:0.75rem;border-top:1px solid var(--border);margin-top:0.75rem;">';
      html += '<button class="btn btn-primary" onclick="savePromptDefaults()">Save</button>';
      html += '<button class="btn" onclick="resetPromptDefaults()">Reset</button>';
      html += '</div>';

      document.getElementById('settings-form-panel').innerHTML = html;
    }

    function setPromptsMode(autorun) {
      if (promptsAutorunMode === autorun) return;
      promptsAutorunMode = autorun;
      renderPromptsPanel();
    }

    function toggleCustomInstructions() {
      if (!settingsActiveSub || !promptsData) return;
      // Preserve textarea content before re-render
      var textarea = document.getElementById('prompt-default-content');
      var currentContent = textarea ? textarea.value : null;
      for (var i = 0; i < promptsData.length; i++) {
        if (promptsData[i].tool === settingsActiveSub) {
          promptsData[i].enabled = !promptsData[i].enabled;
          if (currentContent !== null) promptsData[i].defaultContent = currentContent;
          break;
        }
      }
      renderPromptsPanel();
    }

    async function savePromptDefaults() {
      var textarea = document.getElementById('prompt-default-content');
      if (!textarea || !settingsActiveSub) return;
      var data = null;
      for (var i = 0; i < promptsData.length; i++) {
        if (promptsData[i].tool === settingsActiveSub) { data = promptsData[i]; break; }
      }
      var content = textarea.value;
      var enabled = data ? !!data.enabled : false;
      var d = await fetchApi('/api/settings/prompts/defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: settingsActiveSub, content: content, enabled: enabled })
      });
      if (d && d.success) {
        toast('Custom instructions saved for ' + settingsActiveSub, 'success');
        promptsData = null;
        renderPromptsPanel();
      }
    }

    async function resetPromptDefaults() {
      promptsData = null;
      await renderPromptsPanel();
    }

    function renderSettingsTable(entries) {
      var h = '<table class="settings-table"><tbody>';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var meta = settingsSchema ? settingsSchema[e.key] : null;
        var desc = meta ? meta.description : '';
        var defVal = meta ? meta.default : '';
        var vtype = meta ? meta.valueType : '';
        var enums = meta ? meta.enumValues : null;
        var isMutable = meta ? meta.mutable : false;

        h += '<tr>';
        h += '<td class="key-cell">';
        h += escapeHtml(e.key);
        if (isMutable) h += '<span class="settings-badge-hot" title="Takes effect immediately without restart">&#9889; Hot</span>';
        h += '</td>';

        h += '<td>';
        if (vtype === 'boolean') {
          var isOn = e.value === 'true' || e.value === '1';
          h += '<div class="settings-bool-row">';
          h += '<input type="hidden" class="settings-input" data-key="' + escapeHtml(e.key) + '" value="' + (isOn ? 'true' : 'false') + '">';
          h += '<label class="mode-toggle skill-toggle-sm" onclick="toggleBoolField(this)">';
          h += '<span class="mode-toggle-track' + (isOn ? ' on' : '') + '"><span class="mode-toggle-knob"></span></span>';
          h += '<span class="mode-toggle-label">' + (isOn ? 'ON' : 'OFF') + '</span>';
          h += '</label>';
          h += '</div>';
        } else if ((vtype === 'enum' || vtype === 'mode') && (enums || vtype === 'mode')) {
          var opts = enums || ['write', 'readonly'];
          h += '<select class="settings-input settings-select" data-key="' + escapeHtml(e.key) + '">';
          if (!e.value && defVal) h += '<option value="" disabled selected>Default: ' + escapeHtml(defVal) + '</option>';
          for (var oi = 0; oi < opts.length; oi++) {
            h += '<option value="' + escapeHtml(opts[oi]) + '"' + (e.value === opts[oi] ? ' selected' : '') + '>' + escapeHtml(opts[oi]) + '</option>';
          }
          h += '</select>';
        } else {
          h += '<input class="settings-input' + (e.masked ? ' masked' : '') + '" '
            + 'data-key="' + escapeHtml(e.key) + '" '
            + 'value="' + escapeHtml(e.value) + '"'
            + (e.masked ? ' placeholder="***"' : (defVal ? ' placeholder="Default: ' + escapeHtml(defVal) + '"' : ''))
            + '>';
        }
        if (desc) h += '<div class="settings-help">' + escapeHtml(desc) + '</div>';
        h += '</td></tr>';
      }
      h += '</tbody></table>';
      return h;
    }

    function toggleBoolField(label) {
      var track = label.querySelector('.mode-toggle-track');
      var lbl = label.querySelector('.mode-toggle-label');
      var hidden = label.parentElement.querySelector('input[type="hidden"]');
      if (!track || !lbl || !hidden) return;
      var isOn = track.classList.contains('on');
      if (isOn) {
        track.classList.remove('on');
        lbl.textContent = 'OFF';
        hidden.value = 'false';
      } else {
        track.classList.add('on');
        lbl.textContent = 'ON';
        hidden.value = 'true';
      }
    }

    async function loadSettings() {
      await loadSettingsSchema();
      var kcStatus = await fetchApi('/api/settings/keychain-status');
      if (kcStatus) keychainAvailable = !!kcStatus.available;
      var d = await fetchApi('/api/settings');
      if (!d) return;
      // Filter out internal and skill keys (managed in Skills tab) before building state
      var rawEntries = d.entries || [];
      settingsData = [];
      for (var fi = 0; fi < rawEntries.length; fi++) {
        var fm = settingsSchema ? settingsSchema[rawEntries[fi].key] : null;
        if (fm && (fm.cat === 'internal' || fm.skill)) continue;
        settingsData.push(rawEntries[fi]);
      }
      settingsOriginalData = {};
      for (var oi = 0; oi < settingsData.length; oi++) {
        settingsOriginalData[settingsData[oi].key] = {
          value: settingsData[oi].value || '',
          masked: !!settingsData[oi].masked
        };
      }

      settingsGrouped = { mode: [], messaging: {}, apps: {}, environment: {} };
      var msgSubs = Object.keys(SETTINGS_CATEGORIES.messaging.subSections);
      for (var s = 0; s < msgSubs.length; s++) settingsGrouped.messaging[msgSubs[s]] = [];
      var appsSubs = Object.keys(SETTINGS_CATEGORIES.apps.subSections);
      for (var s = 0; s < appsSubs.length; s++) settingsGrouped.apps[appsSubs[s]] = [];
      var envSubs = Object.keys(SETTINGS_CATEGORIES.environment.subSections);
      for (var s = 0; s < envSubs.length; s++) settingsGrouped.environment[envSubs[s]] = [];

      var existingKeys = {};
      for (var i = 0; i < settingsData.length; i++) {
        var e = settingsData[i];
        existingKeys[e.key] = true;
        var mapping = settingsSchema ? settingsSchema[e.key] : null;
        if (mapping && mapping.sub && settingsGrouped[mapping.cat] && settingsGrouped[mapping.cat][mapping.sub]) {
          settingsGrouped[mapping.cat][mapping.sub].push(e);
        } else if (mapping && !mapping.sub && Array.isArray(settingsGrouped[mapping.cat])) {
          settingsGrouped[mapping.cat].push(e);
        } else {
          settingsGrouped.environment.runtime.push(e);
        }
      }

      // Schema-driven backfill: ensure every registry key has an entry
      if (settingsSchema) {
        var schemaKeys = Object.keys(settingsSchema);
        for (var ki = 0; ki < schemaKeys.length; ki++) {
          var sk = schemaKeys[ki];
          if (existingKeys[sk]) continue;
          var meta = settingsSchema[sk];
          if (meta.cat === 'internal' || meta.skill) continue;
          var entry = { key: sk, value: '', masked: false };
          settingsData.push(entry);
          existingKeys[sk] = true;
          if (meta.sub && settingsGrouped[meta.cat] && settingsGrouped[meta.cat][meta.sub]) {
            settingsGrouped[meta.cat][meta.sub].push(entry);
          } else if (!meta.sub && Array.isArray(settingsGrouped[meta.cat])) {
            settingsGrouped[meta.cat].push(entry);
          } else {
            settingsGrouped.environment.runtime.push(entry);
          }
        }
      }

      if (!settingsActiveCategory) {
        settingsActiveCategory = 'mode';
        settingsActiveSub = null;
      }
      renderSettingsNav();
      renderSettingsSubNav();
      var catDef = SETTINGS_CATEGORIES[settingsActiveCategory];
      if (catDef && catDef.subSections && !settingsActiveSub) {
        var firstSub = Object.keys(catDef.subSections)[0];
        settingsActiveSub = firstSub;
      }
      if (catDef && catDef.subSections) {
        renderSettingsSubNav();
      }
      if (settingsActiveSub || !catDef.subSections) {
        renderSettingsForm();
      }
    }

    async function saveSettings() {
      var inputs = document.querySelectorAll('#settings-form-content .settings-input');
      var patches = [];
      inputs.forEach(function(inp) {
        var key = inp.getAttribute('data-key');
        var currentValue = inp.value;
        for (var i = 0; i < settingsData.length; i++) {
          if (settingsData[i].key === key) { settingsData[i].value = currentValue; break; }
        }

        var original = settingsOriginalData[key] || { value: '', masked: false };
        if (original.masked) {
          if (currentValue === '***') return;
          if (!currentValue) {
            patches.push({ key: key, op: 'clear' });
            return;
          }
          patches.push({ key: key, op: 'set', value: currentValue });
          return;
        }

        if (currentValue === original.value) {
          return;
        }
        if (!currentValue) {
          patches.push({ key: key, op: 'clear' });
        } else {
          patches.push({ key: key, op: 'set', value: currentValue });
        }
      });
      if (patches.length === 0) {
        toast('No changes to save', 'success');
        return;
      }
      var d = await fetchApi('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patches: patches })
      });
      if (d && d.success) {
        if (d.applied && d.applied.length > 0) {
          toast('Settings applied: ' + d.applied.join(', '), 'success');
        }
        if (d.requiresRestart && d.requiresRestart.length > 0) {
          showRestartBanner(d.requiresRestart);
        } else if (!d.requiresRestart || d.requiresRestart.length === 0) {
          toast('Settings saved', 'success');
        }
        loadSettings();
      }
    }
`;
}
