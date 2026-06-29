/** @module dashboard/scripts/agents — Client-side script for the AI Agents management tab. */

/**
 * Agent list, create/edit/delete modal, and tab lifecycle.
 * Depends on: helpers.ts (escapeHtml, toast, fetchApi)
 */

export const agentsScript = `
var agentsList = [];
var agentEditingId = null;
var agentInitialEnabledSkills = null;

// ── Feather SVG icons (inline) ──
var AGENT_ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
var AGENT_ICON_SM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

async function agentsLoadList() {
  try {
    var result = await fetchApi('/api/agents');
    if (result.ok) {
      agentsList = result.data || [];
      agentsRenderList();
    }
  } catch (err) {
    toast(err.message || 'Failed to load agents', 'error');
  }
}

function agentsRenderList() {
  var container = document.getElementById('agents-list');
  if (!container) return;
  if (agentsList.length === 0) {
    container.innerHTML = '<div class="empty-state" style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">'
      + '<p style="font-size:1.1rem;margin-bottom:0.5rem;">No agents defined yet</p>'
      + '<p style="font-size:0.9rem;">Create your first AI Agent to define reusable personas for orchestrator nodes.</p>'
      + '</div>';
    return;
  }
  var html = '<div class="agent-card-list">';
  for (var i = 0; i < agentsList.length; i++) {
    var a = agentsList[i];
    html += '<div class="agent-card">';
    html += '<div class="agent-card-icon">' + AGENT_ICON_SVG + '</div>';
    html += '<div class="agent-card-body">';
    html += '<div class="agent-card-header">';
    html += '<span class="agent-card-name">' + escapeHtml(a.name) + '</span>';
    html += '<span class="orch-badge">' + escapeHtml(a.tool) + '</span>';
    html += '</div>';
    if (a.description) {
      html += '<div class="agent-card-desc">' + escapeHtml(a.description) + '</div>';
    }
    html += '<div class="agent-card-meta">';
    if (a.enabledSkills && a.enabledSkills.length > 0) {
      for (var s = 0; s < a.enabledSkills.length; s++) {
        html += '<span class="agent-tag">' + escapeHtml(a.enabledSkills[s]) + '</span>';
      }
    }
    if (a.enabledMcpServerIds && a.enabledMcpServerIds.length > 0) {
      html += '<span class="agent-tag">MCP: ' + a.enabledMcpServerIds.length + ' server' + (a.enabledMcpServerIds.length > 1 ? 's' : '') + '</span>';
    }
    if (!a.allowMcp) {
      html += '<span class="agent-tag" style="color:var(--red);">MCP disabled</span>';
    }
    html += '</div>';
    html += '</div>';
    html += '<div class="agent-card-actions">';
    html += '<button class="action-btn" onclick="agentEdit(\\'' + a.id + '\\')" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
    html += '<button class="action-btn action-btn-danger" onclick="agentDelete(\\'' + a.id + '\\', \\'' + escapeHtml(a.name).replace(/'/g, "\\\\'") + '\\')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

async function agentOpenModal(agent) {
  agentEditingId = agent ? agent.id : null;
  agentInitialEnabledSkills = agent && Array.isArray(agent.enabledSkills)
    ? agent.enabledSkills.slice()
    : null;
  var title = agent ? 'Edit Agent' : 'Create Agent';
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'agent-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) agentCloseModal(); };

  var html = '<div class="modal-content">';
  html += '<h3 class="modal-title">' + title + '</h3>';

  html += '<div class="orch-field"><label class="orch-field-label">Name</label>';
  html += '<input class="settings-input" id="agent-field-name" maxlength="100" value="' + escapeHtml(agent ? agent.name : '') + '"></div>';

  html += '<div class="orch-field"><label class="orch-field-label">Description</label>';
  html += '<textarea class="settings-input" id="agent-field-desc" rows="2" style="resize:vertical;">' + escapeHtml(agent && agent.description ? agent.description : '') + '</textarea></div>';

  html += '<div class="orch-field"><label class="orch-field-label">App</label>';
  html += '<select class="settings-input" id="agent-field-tool" onchange="agentToolChanged()">';
  html += '<option value="claude"' + (agent && agent.tool === 'claude' ? ' selected' : (!agent ? ' selected' : '')) + '>Claude</option>';
  html += '<option value="codex"' + (agent && agent.tool === 'codex' ? ' selected' : '') + '>Codex</option>';
  html += '<option value="gemini"' + (agent && agent.tool === 'gemini' ? ' selected' : '') + '>Gemini</option>';
  html += '</select></div>';

  html += '<div class="orch-field"><label class="orch-field-label">Model</label>';
  html += modelFieldHtml('agent-field-model', agent ? agent.tool : 'claude', agent ? agent.model : '');
  html += '<div class="orch-field-help">Leave empty for system default</div></div>';

  html += '<div class="orch-field"><label class="orch-field-label">System Instruction</label>';
  html += '<textarea class="settings-input agent-instruction-input" id="agent-field-instruction" rows="5" maxlength="10000" placeholder="Define the agent persona, role, and behavior...">' + escapeHtml(agent && agent.systemInstruction ? agent.systemInstruction : '') + '</textarea></div>';

  html += '<div class="orch-field"><label class="orch-field-label">Skills</label>';
  html += '<div class="agent-checkbox-grid" id="agent-skills-grid"></div></div>';

  html += '<div class="orch-field"><label class="orch-field-label">MCP Servers</label>';
  html += '<div class="agent-checkbox-grid" id="agent-mcp-grid"></div></div>';

  html += '<div class="orch-field"><label class="orch-field-label">Allow MCP</label>';
  html += '<label class="toggle-switch"><input type="checkbox" id="agent-field-allow-mcp"' + (agent ? (agent.allowMcp ? ' checked' : '') : ' checked') + '>';
  html += '<span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span>';
  html += '<span class="toggle-switch-label">Enable MCP tool use</span></label></div>';

  html += '<div class="btn-group" style="justify-content:flex-end">';
  html += '<button class="btn" onclick="agentCloseModal()">Cancel</button>';
  html += '<button class="btn btn-primary" onclick="agentSave()">Save Agent</button>';
  html += '</div>';

  html += '</div>';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  await agentLoadSkillsGrid(agent ? agent.enabledSkills : null);
  agentLoadMcpGrid(agent);
}

function agentCloseModal() {
  var overlay = document.getElementById('agent-modal-overlay');
  if (overlay) overlay.remove();
  agentEditingId = null;
  agentInitialEnabledSkills = null;
}

function readAgentSelectedSkills() {
  var skillCheckboxes = document.querySelectorAll('input[name="agent-skill"]:checked');
  var enabledSkills = [];
  for (var i = 0; i < skillCheckboxes.length; i++) enabledSkills.push(skillCheckboxes[i].value);
  return enabledSkills;
}

async function agentLoadSkillsGrid(enabledSkills) {
  var grid = document.getElementById('agent-skills-grid');
  if (!grid) return;
  var tool = (document.getElementById('agent-field-tool') || {}).value || 'claude';
  await ensureAvailableSkills(tool);
  var allSkills = getAvailableSkills(tool);
  var enabled = Array.isArray(enabledSkills) ? enabledSkills : [];
  var enabledSet = {};
  for (var i = 0; i < enabled.length; i++) enabledSet[enabled[i]] = true;
  if (allSkills.length === 0) {
    grid.innerHTML = '<span style="font-size:0.8rem;color:var(--text-dim);">No skills available for this app</span>';
    return;
  }
  var html = '';
  for (var s = 0; s < allSkills.length; s++) {
    var skill = allSkills[s];
    html += '<label class="agent-checkbox-label"><input type="checkbox" name="agent-skill" value="' + skill.skillRef + '"' + (enabledSet[skill.skillRef] ? ' checked' : '') + '><span class="cb-mark"></span> ' + escapeHtml(skill.label) + '</label>';
  }
  grid.innerHTML = html;
}

function agentLoadMcpGrid(agent) {
  var grid = document.getElementById('agent-mcp-grid');
  if (!grid) return;
  var tool = document.getElementById('agent-field-tool').value;
  fetchApi('/api/mcp/servers?tool=' + encodeURIComponent(tool)).then(function(result) {
    if (!result || !result.servers) { grid.innerHTML = '<span style="font-size:0.8rem;color:var(--text-dim);">No MCP servers for this app</span>'; return; }
    var serversObj = result.servers;
    var servers = [];
    for (var key in serversObj) {
      if (serversObj.hasOwnProperty(key)) {
        servers.push({ id: serversObj[key].id, name: key });
      }
    }
    var enabled = (agent && agent.enabledMcpServerIds) || [];
    var enabledSet = {};
    for (var i = 0; i < enabled.length; i++) enabledSet[enabled[i]] = true;
    var html = '';
    for (var s = 0; s < servers.length; s++) {
      html += '<label class="agent-checkbox-label"><input type="checkbox" name="agent-mcp" value="' + servers[s].id + '"' + (enabledSet[servers[s].id] ? ' checked' : '') + '><span class="cb-mark"></span> ' + escapeHtml(servers[s].name) + '</label>';
    }
    if (servers.length === 0) {
      html = '<span style="font-size:0.8rem;color:var(--text-dim);">No MCP servers for this app</span>';
    }
    grid.innerHTML = html;
  }).catch(function() {
    grid.innerHTML = '<span style="font-size:0.8rem;color:var(--text-dim);">Failed to load MCP servers</span>';
  });
}

function agentToolChanged() {
  var newTool = (document.getElementById('agent-field-tool') || {}).value || 'claude';
  updateModelPlaceholder('agent-field-model', newTool);
  agentLoadSkillsGrid(readAgentSelectedSkills());
  agentLoadMcpGrid(null);
}

async function agentSave() {
  var name = document.getElementById('agent-field-name').value.trim();
  var description = document.getElementById('agent-field-desc').value.trim() || null;
  var tool = document.getElementById('agent-field-tool').value;
  var systemInstruction = document.getElementById('agent-field-instruction').value.trim() || null;
  var allowMcp = document.getElementById('agent-field-allow-mcp').checked;

  if (!name) { toast('Name is required', 'error'); return; }

  var enabledSkills = readAgentSelectedSkills();
  var normalizedEnabledSkills = enabledSkills.length > 0
    ? enabledSkills
    : (agentInitialEnabledSkills === null ? null : []);

  var mcpCheckboxes = document.querySelectorAll('input[name="agent-mcp"]:checked');
  var enabledMcpServerIds = [];
  for (var j = 0; j < mcpCheckboxes.length; j++) enabledMcpServerIds.push(mcpCheckboxes[j].value);

  var model = (document.getElementById('agent-field-model').value || '').trim() || null;

  var payload = {
    name: name,
    description: description,
    tool: tool,
    model: model,
    systemInstruction: systemInstruction,
    enabledSkills: normalizedEnabledSkills,
    enabledMcpServerIds: enabledMcpServerIds.length > 0 ? enabledMcpServerIds : null,
    allowMcp: allowMcp,
  };

  try {
    var result;
    if (agentEditingId) {
      result = await fetchApi('/api/agents/' + agentEditingId, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      result = await fetchApi('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
    }
    if (result.ok) {
      toast(agentEditingId ? 'Agent updated' : 'Agent created', 'success');
      agentCloseModal();
      await agentsLoadList();
    } else {
      toast(result.error || 'Failed to save agent', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to save agent', 'error');
  }
}

function agentEdit(id) {
  var agent = agentsList.find(function(a) { return a.id === id; });
  if (!agent) { toast('Agent not found', 'error'); return; }
  void agentOpenModal(agent);
}

async function agentDelete(id, name) {
  if (!confirm('Delete agent "' + name + '"? Nodes using it will lose their agent assignment.')) return;
  try {
    var result = await fetchApi('/api/agents/' + id, { method: 'DELETE' });
    if (result.ok) {
      toast('Agent deleted', 'success');
      await agentsLoadList();
    } else {
      toast(result.error || 'Failed to delete agent', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to delete agent', 'error');
  }
}

// ── Agent cache for node panel / editor ──
var agentsCacheAll = null;
var agentsCacheTime = 0;
var AGENTS_CACHE_TTL = 30000;

async function agentsFetchCached() {
  var now = Date.now();
  if (agentsCacheAll && now - agentsCacheTime < AGENTS_CACHE_TTL) return agentsCacheAll;
  try {
    var result = await fetchApi('/api/agents');
    if (result.ok) {
      agentsCacheAll = result.data || [];
      agentsCacheTime = now;
    }
  } catch (e) { /* use stale cache */ }
  return agentsCacheAll || [];
}

function agentsCacheInvalidate() {
  agentsCacheAll = null;
  agentsCacheTime = 0;
}
`;
