/** @module dashboard/scripts/orchestrator-node-panel — Client-side script for the orchestrator node editing side panel. */

/**
 * Node editing side panel, output mode toggle, return value tags, save/create/delete node.
 * Depends on: orchestrator.ts (orchCurrent, orchEditingId, orchSidePanelMode, orchSelectedNodeId,
 *   orchFieldHtml, orchLoadChannels, orchGetNotifyChannel, orchBuildReturnTemplate,
 *   orchBuildReturnTemplateFromConditions, orchCloseSidePanel, orchCloseSettingsOverlay,
 *   escapeHtml, escapeInlineJsArg, toast, fetchApi, DAG_SNAP_GRID)
 * Depends on: orchestrator-return-modal.ts (orchRcSummaryHtml, orchOpenReturnConditionsModal)
 * Depends on: orchestrator-editor.ts (dagEditor, orchEditorRefreshData, orchEditorMarkDirty,
 *   orchEditorInit, orchEditorMinimapInit, orchEditorGetViewportCenter, orchIsStartNode)
 */

export const orchestratorNodePanelScript = `
var orchNodeEditingUpdatedAt = null;
var orchNodeTriggeredSubscription = null;
var orchWebhookStartSubscription = null;

function orchShowNodePanel(nodeId) {
  // Close settings overlay if open
  orchCloseSettingsOverlay();
  orchSidePanelMode = 'node';
  orchSelectedNodeId = nodeId;
  var panel = document.getElementById('orch-side-panel');
  var title = document.getElementById('orch-panel-title');
  var body = document.getElementById('orch-panel-body');

  var node = null;
  if (nodeId && orchCurrent) {
    node = (orchCurrent.nodes || []).find(function(n) { return n.id === nodeId; });
  }
  orchNodeEditingUpdatedAt = node ? node.updatedAt : null;

  title.textContent = node ? (node.label || '') : 'New Node';
  panel.style.display = '';

  var isEnd = node && node.nodeType === 'end';
  var isGate = node && node.nodeType === 'gate';
  var isTriggered = node && node.nodeType === 'triggered';
  var isTaskLike = !isEnd && !isGate;
  var curWriteInstructionFile = node ? node.writeInstructionFile !== false : true;

  // Determine current output mode and return conditions
  var curOutputMode = (node && node.outputMode) || 'auto';
  var curReturnConditions = (node && node.returnConditions) || null;

  var html = '';
  html += orchFieldHtml('Label', '<input class="settings-input" id="orch-panel-node-label" value="' + escapeHtml(node ? node.label : '') + '">', 'Display name shown on the DAG canvas.');

  // Node type is fixed once created — hidden input preserves the value
  html += '<input type="hidden" id="orch-panel-node-type" value="' + (node ? node.nodeType : 'task') + '">';

  // Hidden inputs for output control state
  html += '<input type="hidden" id="orch-panel-output-mode" value="' + escapeHtml(curOutputMode) + '">';
  html += '<input type="hidden" id="orch-panel-return-conditions" value="' + escapeHtml(curReturnConditions ? JSON.stringify(curReturnConditions) : '') + '">';
  html += '<input type="hidden" id="orch-panel-enabled-mcp-server-ids" value="' + escapeHtml(node && node.enabledMcpServerIds ? JSON.stringify(node.enabledMcpServerIds) : '') + '">';

  // Agent selector (task-like nodes only)
  if (isTaskLike) {
    html += '<div class="orch-panel-task-row">';
    html += '<div class="orch-field"><label class="orch-field-label">Agent</label>';
    html += '<div id="orch-agent-selector"><select class="settings-input" id="orch-panel-agent-select" onchange="orchAgentChanged()"><option value="">-- No Agent --</option></select></div>';
    html += '<div id="orch-agent-inherited" style="display:none;"></div>';
    html += '<div class="orch-field-desc">Pre-configured agent profile (App, MCP, system prompt). Leave empty to use default settings.</div>';
    html += '</div></div>';
  }
  html += '<input type="hidden" id="orch-panel-agent-id" value="' + escapeHtml(node && node.agentId ? node.agentId : '') + '">';

  // Task fields
  var hideTask = isGate || isEnd ? ' style="display:none;"' : '';
  html += '<div class="orch-panel-task-row" id="orch-panel-tool-row"' + hideTask + '>';
  html += orchFieldHtml('App', '<select class="settings-input" id="orch-panel-node-tool" onchange="orchNodeToolChanged()"><option value="claude"' + (node && node.tool === 'claude' ? ' selected' : '') + '>Claude</option><option value="codex"' + (node && node.tool === 'codex' ? ' selected' : '') + '>Codex</option><option value="gemini"' + (node && node.tool === 'gemini' ? ' selected' : '') + '>Gemini</option></select>', 'AI tool to execute this task.');
  html += '</div>';

  html += '<div class="orch-panel-task-row" id="orch-panel-model-row"' + hideTask + '>';
  html += orchFieldHtml('Model', modelFieldHtml('orch-panel-node-model', node ? (node.tool || 'claude') : 'claude', node ? (node.model || '') : ''), 'AI model to use. Leave empty for system default.');
  html += '</div>';

  if (isTaskLike) {
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('Workdir', '<div style="display:flex;gap:0.4rem;align-items:center;"><input class="settings-input" id="orch-panel-node-workdir" value="' + escapeHtml(node && node.workdir ? node.workdir : '') + '" placeholder="Use orchestrator default" style="flex:1;" readonly><button type="button" class="btn btn-browse-dir" onclick="pickDirectory(\\\'orch-panel-node-workdir\\\')" style="white-space:nowrap;">Browse</button><button type="button" class="btn" onclick="document.getElementById(\\\'orch-panel-node-workdir\\\').value=\\\'\\\'" style="padding:0.3rem 0.5rem;font-size:0.75rem;" title="Clear">&times;</button></div>', 'Optional node-level override. Leave empty to use the orchestrator workdir or auto-generated workspace.');
    html += '</div>';
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('Instruction File', '<label class="toggle-switch"><input type="checkbox" id="orch-panel-node-write-instruction"' + (curWriteInstructionFile ? ' checked' : '') + ' onchange="orchNodeWriteInstrToggled()"><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Auto-write instruction file</span></label>', 'When disabled, the system does not auto-generate CLAUDE.md / AGENTS.md / GEMINI.md for this node. Runtime approval and MCP policy enforcement still apply.');
    html += '</div>';
    html += '<div class="orch-panel-task-row" id="orch-panel-node-instruction-file-row"' + (curWriteInstructionFile ? '' : ' style="display:none;"') + '>';
    html += orchFieldHtml('Instruction Content', '<textarea class="settings-input" id="orch-panel-node-instruction-file" rows="4" style="resize:vertical;font-family:monospace;" placeholder="Use orchestrator default instructions when empty">' + escapeHtml(node && node.instructionFile ? node.instructionFile : '') + '</textarea>', 'Optional node-specific instructions appended to the built-in instruction file. Leave empty to inherit the orchestrator-level instructions.');
    html += '</div>';
  }

  // Mode is always 'write' for task nodes (P3); no UI needed

  // ── Output Control Section (task only) ──────────────
  if (!isEnd && !isGate) {
    html += '<div class="orch-panel-task-row" id="orch-panel-output-control-row">';
    html += '<div class="orch-field">';
    html += '<label class="orch-field-label">Output Control</label>';
    html += '<div class="orch-field-desc" style="margin-bottom:0.4rem;">Controls how the node communicates its result via <code>&lt;return:...&gt;</code> tags for downstream routing.<br>'
      + '<b>Auto</b>: Define conditions, and the system appends return-tag instructions to your prompt automatically.<br>'
      + '<b>Manual</b>: You write <code>&lt;return:...&gt;</code> instructions directly in the prompt.</div>';
    html += '<div class="orch-output-mode-toggle">';
    html += '<button type="button" class="orch-toggle-btn' + (curOutputMode === 'auto' ? ' active' : '') + '" data-mode="auto" onclick="orchSwitchOutputMode(\\'auto\\')">Auto</button>';
    html += '<button type="button" class="orch-toggle-btn' + (curOutputMode === 'manual' ? ' active' : '') + '" data-mode="manual" onclick="orchSwitchOutputMode(\\'manual\\')">Manual</button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // ── Manual Section ──
    html += '<div id="orch-manual-section"' + (curOutputMode !== 'manual' ? ' style="display:none;"' : '') + '>';

    // Prompt (manual)
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml(
      'Prompt',
      '<textarea class="settings-input" id="orch-panel-node-prompt" rows="4" style="resize:vertical;font-family:monospace;" placeholder="Task prompt...">' + escapeHtml(node ? (node.prompt || '') : '') + '</textarea>',
      '<div style="color:var(--red);">'
        + '<strong>Important:</strong> This project routes flows using a <code>&lt;return:...&gt;</code> tag in the LLM output.<br>'
        + 'If Return Values are <code>success</code> and <code>error</code>:<br>'
        + '- <code>&lt;return:success&gt;</code> routes to the success flow.<br>'
        + '- <code>&lt;return:error&gt;</code> routes to the error flow.<br>'
        + 'Everything else routes to <code>other</code> (tag missing, value not defined in Return Values, or task error).<br>'
        + 'Always define the output format in this Prompt and explicitly require one <code>&lt;return:...&gt;</code> tag.<br>'
        + 'If you want files to be sent to Slack, write those files to <code>_output/</code>.<br>'
        + 'After all tasks finish, the system sends files from <code>_output/</code> to Slack.<br>'
        + 'Be mindful of data size limits when exporting files (see docs/Guide for limits).<br>'
        + 'Use the Return Value Template below, and repeat the same return-tag rule in Instruction File (Orchestrator Settings) for better reliability.<br>'
        + 'For full details, see the Guide.<br>'
        + '<button type="button" class="btn btn-sm btn-danger" style="margin-top:0.35rem;" onclick="orchShowGuide()">Open Guide</button>'
        + '</div>'
    );
    html += '</div>';

    // Return Values tags (manual)
    var rvList = [];
    if (node && node.returnValues) {
      rvList = node.returnValues.slice();
    } else {
      rvList = ['done', 'other_return', 'error_return'];
    }
    html += '<div class="orch-panel-task-row orch-panel-gate-row"' + (isGate ? ' style="display:none;"' : '') + '>';
    html += '<div class="orch-field">';
    html += '<label class="orch-field-label">Return Values</label>';
    html += '<div class="orch-field-desc" style="margin-bottom:0.4rem;">Output ports for branching. Each value creates an exit port on the node.</div>';
    html += '<div id="orch-rv-tags" class="orch-rv-tags">';
    for (var ri = 0; ri < rvList.length; ri++) {
      var rv = rvList[ri];
      var isSystemReturn = rv === 'other_return' || rv === 'error_return';
      var displayLabel = rv === 'other_return' ? '(other)' : rv === 'error_return' ? '(error)' : rv;
      html += '<span class="orch-rv-tag' + (isSystemReturn ? ' orch-rv-tag-special' : '') + '" data-value="' + escapeHtml(rv) + '">';
      html += escapeHtml(displayLabel);
      if (!isSystemReturn) html += ' <button class="orch-rv-remove" onclick="orchRemoveReturnValue(this)" title="Remove">&times;</button>';
      html += '</span>';
    }
    html += '</div>';
    html += '<div style="display:flex;gap:0.3rem;margin-top:0.3rem;">';
    html += '<input class="settings-input" id="orch-rv-new-input" placeholder="e.g. retry" style="flex:1;font-size:0.8rem;" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();orchAddReturnValue();}">';
    html += '<button class="btn btn-sm" onclick="orchAddReturnValue()">+ Add</button>';
    html += '</div>';
    html += '</div></div>';

    // Return Value Template card (manual) — hidden for gate nodes (fixed true/false)
    var rvTemplateText = orchBuildReturnTemplate(rvList);
    html += '<div class="orch-rv-template-card"' + (isGate ? ' style="display:none;"' : '') + '>';
    html += '<div class="orch-rv-template-header">';
    html += '<strong class="orch-rv-template-title">Return Value Template</strong>';
    html += '<button type="button" class="orch-rv-template-copy-btn" data-copy-label="Copy" data-copied-label="Copied" onclick="orchCopyReturnTemplate(this)">Copy</button>';
    html += '</div>';
    html += '<pre id="orch-rv-template-pre" class="orch-rv-template-pre">' + escapeHtml(rvTemplateText) + '</pre>';
    html += '</div>';

    html += '</div>'; // end #orch-manual-section

    // ── Auto Section ──
    html += '<div id="orch-auto-section"' + (curOutputMode !== 'auto' ? ' style="display:none;"' : '') + '>';

    // Prompt (auto) — uses same ID so save reads from whichever is visible
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml(
      'Prompt',
      '<textarea class="settings-input" id="orch-panel-node-prompt-auto" rows="4" style="resize:vertical;font-family:monospace;" placeholder="Task prompt (return tags will be auto-appended)...">' + escapeHtml(node ? (node.prompt || '') : '') + '</textarea>',
      'Write only the task instructions. The system will auto-append return-tag rules based on your configured conditions below.'
        + '<br>If you want files to be sent to Slack, write those files to <code>_output/</code>.'
    );
    html += '</div>';

    // Return Conditions summary card
    html += '<div class="orch-rc-summary-card">';
    html += '<div class="orch-rc-summary-header">';
    html += '<div>';
    html += '<strong class="orch-rc-summary-title">Return Conditions</strong>';
    html += '<div class="orch-rc-summary-desc">Define when each return value is used. The system auto-generates <code>&lt;return:...&gt;</code> instructions.</div>';
    html += '</div>';
    html += '<button type="button" class="orch-rc-configure-btn" onclick="orchOpenReturnConditionsModal()">';
    html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    html += ' Edit';
    html += '</button>';
    html += '</div>';
    html += '<div id="orch-rc-summary" class="orch-rc-summary-body">';
    html += orchRcSummaryHtml(curReturnConditions);
    html += '</div>';
    html += '</div>';

    // Auto-generated template preview
    var autoTemplateText = curReturnConditions && curReturnConditions.length > 0
      ? orchBuildReturnTemplateFromConditions(curReturnConditions) : '(No conditions configured)';
    html += '<div class="orch-rv-template-card">';
    html += '<div class="orch-rv-template-header">';
    html += '<strong class="orch-rv-template-title">Auto-Generated Template</strong>';
    html += '<button type="button" class="orch-rv-template-copy-btn" data-copy-label="Copy" data-copied-label="Copied" onclick="orchCopyReturnTemplate(this)">Copy</button>';
    html += '</div>';
    html += '<pre id="orch-rc-template-pre" class="orch-rv-template-pre">' + escapeHtml(autoTemplateText) + '</pre>';
    html += '</div>';

    html += '</div>'; // end #orch-auto-section
  } else {
    // Gate / End nodes: just show the prompt without output control
    html += '<div class="orch-panel-task-row"' + hideTask + '>';
    html += orchFieldHtml(
      'Prompt',
      '<textarea class="settings-input" id="orch-panel-node-prompt" rows="4" style="resize:vertical;font-family:monospace;" placeholder="Task prompt...">' + escapeHtml(node ? (node.prompt || '') : '') + '</textarea>',
      null
    );
    html += '</div>';
  }

  html += '<div class="orch-panel-task-row"' + hideTask + '>';
  html += orchFieldHtml('Max Retries', '<input class="settings-input" type="number" id="orch-panel-node-max-retries" value="' + (node ? node.maxRetries : 0) + '" min="0" max="10">', 'Number of retry attempts on failure (0-10).');
  html += '</div>';

  html += '<div class="orch-panel-task-row"' + hideTask + '>';
  html += orchFieldHtml('Timeout (sec)', '<input class="settings-input" type="number" id="orch-panel-node-timeout" value="' + (node && node.timeoutSec ? node.timeoutSec : '') + '" placeholder="No limit" min="0">', 'Per-node timeout. Uses runner default if empty.');
  html += '</div>';

  var triggeredTimeout = node && node.triggeredConfig && node.triggeredConfig.waitTimeoutSec ? node.triggeredConfig.waitTimeoutSec : 3600;
  var triggeredOnTimeout = node && node.triggeredConfig && node.triggeredConfig.onTimeout ? node.triggeredConfig.onTimeout : 'fail';
  html += '<div class="orch-panel-task-row"' + (!isTriggered ? ' style="display:none;"' : '') + '>';
  html += orchFieldHtml('Wait Timeout (sec)', '<input class="settings-input" type="number" id="orch-panel-node-triggered-timeout" value="' + triggeredTimeout + '" min="1" max="86400">', 'How long this node waits for an incoming event before timing out.');
  html += '</div>';
  html += '<div class="orch-panel-task-row"' + (!isTriggered ? ' style="display:none;"' : '') + '>';
  html += orchFieldHtml('On Timeout', '<select class="settings-input" id="orch-panel-node-triggered-on-timeout"><option value="fail"' + (triggeredOnTimeout === 'fail' ? ' selected' : '') + '>Fail Run</option><option value="skip"' + (triggeredOnTimeout === 'skip' ? ' selected' : '') + '>Skip Node</option></select>', 'Controls whether the orchestration fails or continues when no event arrives in time.');
  html += '</div>';

  // ── Event Source (triggered nodes) ──
  html += '<div class="orch-panel-task-row"' + (!isTriggered ? ' style="display:none;"' : '') + '>';
  html += orchFieldHtml('Event Source', '<select class="settings-input" id="orch-panel-node-triggered-endpoint" onchange="orchTriggeredEndpointChanged()"><option value="">Loading...</option></select><div id="orch-triggered-sub-status" style="margin-top:0.3rem;font-size:0.8rem;display:none;"></div>', 'Link a webhook endpoint. Events received will signal this node to proceed.');
  html += '</div>';
  html += '<div id="orch-triggered-sub-detail" style="display:none;">';
  html += '<div class="orch-panel-task-row">';
  html += orchFieldHtml('Event Filter', '<textarea class="settings-input" id="orch-panel-node-triggered-filter" rows="3" style="resize:vertical;font-family:monospace;" placeholder="Optional JSON filter"></textarea>', 'AND filter on the webhook payload. Example: {"match":[{"path":"body.action","eq":"opened"}]}');
  html += '</div>';
  html += '<div class="orch-panel-task-row">';
  html += orchFieldHtml('Context Mapping', '<textarea class="settings-input" id="orch-panel-node-triggered-mapping" rows="3" style="resize:vertical;font-family:monospace;" placeholder="Optional context mapping"></textarea>', 'Maps payload fields to context variables. Example: {"repo":"body.repository.full_name"}');
  html += '</div>';
  html += '<div class="orch-panel-task-row">';
  html += orchFieldHtml('Subscription', '<label class="toggle-switch"><input type="checkbox" id="orch-panel-node-triggered-sub-enabled" checked><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Enabled</span></label>', 'Enable or disable event delivery to this node.');
  html += '</div>';
  html += '</div>';

  // ── Webhook Trigger Event Source (webhook start node only) ──
  var isWebhookStart = !!(orchCurrent && orchCurrent.triggerMode === 'webhook' && node && orchCurrent.startNodeId === node.id);
  if (isWebhookStart) {
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('Webhook Source', '<select class="settings-input" id="orch-panel-webhook-start-endpoint" onchange="orchWebhookStartEndpointChanged()"><option value="">Loading...</option></select><div id="orch-webhook-start-sub-status" style="margin-top:0.3rem;font-size:0.8rem;display:none;"></div>', 'Link a webhook endpoint. Events received will start a new orchestration run.');
    html += '</div>';
    html += '<div id="orch-webhook-start-sub-detail" style="display:none;">';
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('Event Filter', '<textarea class="settings-input" id="orch-panel-webhook-start-filter" rows="3" style="resize:vertical;font-family:monospace;" placeholder="Optional JSON filter"></textarea>', 'AND filter on the webhook payload. Example: {"match":[{"path":"body.action","eq":"opened"}]}');
    html += '</div>';
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('Context Mapping', '<textarea class="settings-input" id="orch-panel-webhook-start-mapping" rows="3" style="resize:vertical;font-family:monospace;" placeholder="Optional context mapping"></textarea>', 'Maps payload fields to context variables. Example: {"repo":"body.repository.full_name"}');
    html += '</div>';
    html += '</div>';
  }

  // MCP guardrail (task nodes only — skills are managed at orchestrator level)
  if (!isEnd && !isGate) {
    html += '<div id="orch-panel-mcp-section">';
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('MCP Access', '<label class="toggle-switch"><input type="checkbox" id="orch-node-allow-mcp"' + (node ? (node.allowMcp ? ' checked' : '') : ' checked') + ' onchange="orchNodeMcpAccessChanged()"><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Allow MCP tools</span></label>', 'Controls whether this node can use MCP tools. Skills are configured in orchestrator settings.');
    html += '</div>';
    html += '<div class="orch-panel-task-row">';
    html += orchFieldHtml('MCP Servers', '<div id="orch-node-mcp-server-list" style="display:grid;gap:0.4rem;"></div>', 'Optional node-specific narrowing. Leave all unchecked to inherit the session MCP allowlist.');
    html += '</div>';
    html += '</div>';
  }

  // Gate mode + match value
  html += '<div class="orch-panel-gate-row"' + (!isGate ? ' style="display:none;"' : '') + '>';
  var gateMode = node && node.gateCondition ? node.gateCondition.mode || 'and' : 'and';
  html += orchFieldHtml('Gate Mode', '<select class="settings-input" id="orch-panel-node-gate-mode"><option value="and"' + (gateMode === 'and' ? ' selected' : '') + '>AND (all must match)</option><option value="or"' + (gateMode === 'or' ? ' selected' : '') + '>OR (any matches)</option></select>', 'How upstream return values are evaluated.');
  var matchVal = node && node.gateCondition && node.gateCondition.matchValue ? node.gateCondition.matchValue : 'done';
  html += orchFieldHtml('Match Value', '<input class="settings-input" id="orch-panel-node-match-value" value="' + escapeHtml(matchVal) + '" placeholder="done">', 'The return value to match against from upstream nodes.');
  html += '</div>';

  // Notify (task/gate)
  if (!isEnd) {
    html += orchFieldHtml('Notify', '<label class="toggle-switch"><input type="checkbox" id="orch-panel-node-notify-enabled"' + (node && node.notifyEnabled ? ' checked' : '') + '><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Enable notifications</span></label>', null);
    html += orchFieldHtml('Notify Channel', '<select class="settings-input" id="orch-panel-node-notify-select"><option value="">None (use orchestrator default)</option><option value="" disabled>Loading...</option></select><input class="settings-input" id="orch-panel-node-notify-manual" style="display:none;" placeholder="Channel ID (e.g. C01234ABCDE)">', 'Overrides the orchestrator-level channel for this node.');
    html += orchFieldHtml('Notify On Error', '<label class="toggle-switch"><input type="checkbox" id="orch-panel-node-notify-on-error"' + (node ? (node.notifyOnError !== false ? ' checked' : '') : ' checked') + '><span class="toggle-switch-track"><span class="toggle-switch-knob"></span></span><span class="toggle-switch-label">Send error notifications</span></label>', 'When enabled, sends a notification if this node fails.');
  }

  html += '<div class="btn-group" style="margin-top:0.75rem;">';
  html += '<button class="btn btn-primary" onclick="orchSaveNodeFromPanel()">Save</button>';
  if (node && !(typeof orchIsStartNode === 'function' && orchIsStartNode(node.id))) {
    html += ' <button class="btn btn-danger" onclick="orchDeleteNode(\\'' + escapeInlineJsArg(node.id) + '\\')">Delete</button>';
  }
  html += '</div>';

  body.innerHTML = html;

  // Load channel selector for node notify channel
  if (!isEnd) {
    orchLoadChannels('orch-panel-node-notify-select', 'orch-panel-node-notify-manual', node ? (node.notifyChannel || '') : '');
  }
  if (isTriggered) {
    orchLoadTriggeredEndpoints(nodeId);
  }
  if (isWebhookStart) {
    orchLoadWebhookStartEndpoints();
  }
  if (isTaskLike) {
    orchLoadNodeMcpServers();
    orchLoadAgentSelector(nodeId);
  }
}

// ── Agent Selector ──────────────────────────────────────

async function orchLoadAgentSelector(nodeId) {
  var agents = await agentsFetchCached();
  var node = orchCurrent ? (orchCurrent.nodes || []).find(function(n) { return n.id === nodeId; }) : null;
  var selectedAgentId = node ? (node.agentId || '') : '';
  var select = document.getElementById('orch-panel-agent-select');
  if (!select) return;

  // Build optgroups by tool
  var byTool = { claude: [], codex: [], gemini: [] };
  for (var i = 0; i < agents.length; i++) {
    var t = agents[i].tool || 'claude';
    if (!byTool[t]) byTool[t] = [];
    byTool[t].push(agents[i]);
  }

  var html = '<option value="">-- No Agent --</option>';
  var tools = ['claude', 'codex', 'gemini'];
  for (var ti = 0; ti < tools.length; ti++) {
    var toolAgents = byTool[tools[ti]];
    if (toolAgents && toolAgents.length > 0) {
      html += '<optgroup label="' + tools[ti] + '">';
      for (var ai = 0; ai < toolAgents.length; ai++) {
        html += '<option value="' + toolAgents[ai].id + '"' + (toolAgents[ai].id === selectedAgentId ? ' selected' : '') + '>' + escapeHtml(toolAgents[ai].name) + '</option>';
      }
      html += '</optgroup>';
    }
  }
  select.innerHTML = html;

  // Set hidden field
  document.getElementById('orch-panel-agent-id').value = selectedAgentId;

  // Show inherited config and apply agent mode if agent selected
  if (selectedAgentId) {
    var agent = agents.find(function(a) { return a.id === selectedAgentId; });
    if (agent) {
      orchShowAgentInheritance(agent);
      orchApplyAgentMode(agent);
    }
  }
}

var orchPreAgentTool = null;

function orchAgentChanged() {
  var select = document.getElementById('orch-panel-agent-select');
  var agentId = select ? select.value : '';
  document.getElementById('orch-panel-agent-id').value = agentId;

  if (!agentId) {
    orchClearAgentMode();
    return;
  }

  agentsFetchCached().then(function(agents) {
    var agent = agents.find(function(a) { return a.id === agentId; });
    if (agent) {
      // Save current tool before agent override (only on first agent selection)
      var toolSelect = document.getElementById('orch-panel-node-tool');
      if (toolSelect && !orchPreAgentTool) orchPreAgentTool = toolSelect.value;
      if (toolSelect) toolSelect.value = agent.tool;
      // Show agent model as hint in the model input placeholder
      var modelInput = document.getElementById('orch-panel-node-model');
      if (modelInput && agent.model) {
        modelInput.placeholder = agent.model + ' (from agent)';
      }
      orchShowAgentInheritance(agent);
      orchApplyAgentMode(agent);
    }
  });
}

/** Apply agent-specific UI mode: hide tool row, force auto mode, hide MCP, relabel instruction. */
function orchApplyAgentMode(agent) {
  // Hide tool row (tool inherited from agent)
  var toolRow = document.getElementById('orch-panel-tool-row');
  if (toolRow) toolRow.style.display = 'none';

  // Hide model row (model inherited from agent)
  var modelRow = document.getElementById('orch-panel-model-row');
  if (modelRow) modelRow.style.display = 'none';

  // Force output mode to 'auto' and hide the toggle
  var outputControlRow = document.getElementById('orch-panel-output-control-row');
  if (outputControlRow) outputControlRow.style.display = 'none';
  orchSwitchOutputMode('auto');
  // Explicitly ensure auto section is visible and manual is hidden
  // (orchSwitchOutputMode handles this, but guard against stale state)
  var autoSection = document.getElementById('orch-auto-section');
  var manualSection = document.getElementById('orch-manual-section');
  if (autoSection) autoSection.style.display = '';
  if (manualSection) manualSection.style.display = 'none';

  // Hide MCP section (inherited from agent)
  var mcpSection = document.getElementById('orch-panel-mcp-section');
  if (mcpSection) mcpSection.style.display = 'none';

  // Relabel instruction content field
  var instrRow = document.getElementById('orch-panel-node-instruction-file-row');
  if (instrRow) {
    var label = instrRow.querySelector('.orch-field-label');
    if (label) label.textContent = 'Additional Instruction (appended to agent)';
  }
}

/** Clear agent-specific UI mode: restore hidden elements and labels. */
function orchClearAgentMode() {
  // Restore tool to pre-agent value
  if (orchPreAgentTool) {
    var toolSelect = document.getElementById('orch-panel-node-tool');
    if (toolSelect) toolSelect.value = orchPreAgentTool;
  }
  orchPreAgentTool = null;

  // Show tool row
  var toolRow = document.getElementById('orch-panel-tool-row');
  if (toolRow) toolRow.style.display = '';

  // Show model row and restore placeholder to match current tool
  var modelRow = document.getElementById('orch-panel-model-row');
  if (modelRow) modelRow.style.display = '';
  var restoredTool = (document.getElementById('orch-panel-node-tool') || {}).value || 'claude';
  updateModelPlaceholder('orch-panel-node-model', restoredTool);

  // Show output control toggle
  var outputControlRow = document.getElementById('orch-panel-output-control-row');
  if (outputControlRow) outputControlRow.style.display = '';

  // Restore auto/manual section visibility to match the current output mode
  var curMode = (document.getElementById('orch-panel-output-mode') || {}).value || 'auto';
  var autoSection = document.getElementById('orch-auto-section');
  var manualSection = document.getElementById('orch-manual-section');
  if (autoSection) autoSection.style.display = curMode === 'auto' ? '' : 'none';
  if (manualSection) manualSection.style.display = curMode === 'manual' ? '' : 'none';

  // Show MCP section and reload servers for the restored tool
  var mcpSection = document.getElementById('orch-panel-mcp-section');
  if (mcpSection) mcpSection.style.display = '';
  orchLoadNodeMcpServers();

  // Restore instruction label
  var instrRow = document.getElementById('orch-panel-node-instruction-file-row');
  if (instrRow) {
    var label = instrRow.querySelector('.orch-field-label');
    if (label) label.textContent = 'Instruction Content';
  }

  // Clear inheritance display
  var inherited = document.getElementById('orch-agent-inherited');
  if (inherited) { inherited.style.display = 'none'; inherited.innerHTML = ''; }
}

function orchShowAgentInheritance(agent) {
  var inherited = document.getElementById('orch-agent-inherited');
  if (!inherited) return;

  var html = '<div class="agent-summary-card">';
  html += '<div class="agent-summary-header">';
  html += '<span class="agent-summary-name">' + escapeHtml(agent.name) + '</span>';
  html += '</div>';
  html += '<div class="agent-summary-row"><span class="agent-summary-key">App</span><span class="agent-summary-val">' + escapeHtml(agent.tool) + '</span></div>';
  if (agent.model) {
    html += '<div class="agent-summary-row"><span class="agent-summary-key">Model</span><span class="agent-summary-val">' + escapeHtml(agent.model) + '</span></div>';
  }
  if (agent.systemInstruction) {
    var instrPreview = agent.systemInstruction.length > 200 ? agent.systemInstruction.substring(0, 200) + '...' : agent.systemInstruction;
    html += '<div class="agent-summary-row"><span class="agent-summary-key">Instruction</span><span class="agent-summary-val agent-summary-instruction">' + escapeHtml(instrPreview) + '</span></div>';
  }
  if (agent.enabledSkills && agent.enabledSkills.length > 0) {
    html += '<div class="agent-summary-row"><span class="agent-summary-key">Skills</span><span class="agent-summary-val">' + escapeHtml(agent.enabledSkills.join(', ')) + '</span></div>';
  }
  var agentMcpLabel = agent.allowMcp === false ? 'Disabled' : (agent.enabledMcpServerIds && agent.enabledMcpServerIds.length > 0 ? agent.enabledMcpServerIds.length + ' server(s)' : 'All allowed');
  html += '<div class="agent-summary-row"><span class="agent-summary-key">MCP</span><span class="agent-summary-val">' + agentMcpLabel + '</span></div>';
  html += '<div class="agent-summary-footer">';
  html += '<a href="#" onclick="orchOpenAgentSettings(\\'' + escapeInlineJsArg(agent.id) + '\\');return false;" class="agent-summary-link">Open Agent Settings &rarr;</a>';
  html += '</div>';
  html += '</div>';

  inherited.innerHTML = html;
  inherited.style.display = '';
}

function orchOpenAgentSettings(agentId) {
  // Navigate to agents tab and open the specific agent's edit modal
  window.location.hash = '#agents';
  var tabLink = document.querySelector('a[data-tab="agents"]');
  if (tabLink) tabLink.click();
  // Wait for tab switch, then open agent edit modal
  setTimeout(function() {
    if (typeof agentEdit === 'function') agentEdit(agentId);
  }, 100);
}

// ── Output Mode Toggle ──────────────────────────────────

function orchSwitchOutputMode(mode) {
  var modeInput = document.getElementById('orch-panel-output-mode');
  if (modeInput) modeInput.value = mode;

  // Toggle button active states via data-mode attribute
  var btns = document.querySelectorAll('.orch-toggle-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.remove('active');
    if (btns[i].getAttribute('data-mode') === mode) btns[i].classList.add('active');
  }

  // Sync prompt text between manual/auto textareas
  var manualPrompt = document.getElementById('orch-panel-node-prompt');
  var autoPrompt = document.getElementById('orch-panel-node-prompt-auto');
  if (mode === 'auto' && manualPrompt && autoPrompt) {
    autoPrompt.value = manualPrompt.value;
  } else if (mode === 'manual' && manualPrompt && autoPrompt) {
    manualPrompt.value = autoPrompt.value;
  }

  // Show/hide sections
  var manualSec = document.getElementById('orch-manual-section');
  var autoSec = document.getElementById('orch-auto-section');
  if (manualSec) manualSec.style.display = mode === 'manual' ? '' : 'none';
  if (autoSec) autoSec.style.display = mode === 'auto' ? '' : 'none';
}

function orchNodeWriteInstrToggled() {
  var toggle = document.getElementById('orch-panel-node-write-instruction');
  var row = document.getElementById('orch-panel-node-instruction-file-row');
  if (!toggle || !row) return;
  row.style.display = toggle.checked ? '' : 'none';
}

function orchGetSelectedNodeMcpServerIds() {
  var hidden = document.getElementById('orch-panel-enabled-mcp-server-ids');
  if (!hidden || !hidden.value) return [];
  try {
    var parsed = JSON.parse(hidden.value);
    return Array.isArray(parsed) ? parsed.filter(function(id) { return typeof id === 'string'; }) : [];
  } catch (_err) {
    return [];
  }
}

function orchSetSelectedNodeMcpServerIds(ids) {
  var hidden = document.getElementById('orch-panel-enabled-mcp-server-ids');
  if (!hidden) return;
  hidden.value = ids && ids.length ? JSON.stringify(ids) : '';
}

function orchSyncNodeMcpServerSelection() {
  var container = document.getElementById('orch-node-mcp-server-list');
  if (!container) return;
  var checks = container.querySelectorAll('input[data-mcp-server-id]');
  var selected = [];
  for (var i = 0; i < checks.length; i++) {
    if (checks[i].checked) selected.push(checks[i].getAttribute('data-mcp-server-id'));
  }
  orchSetSelectedNodeMcpServerIds(selected);
}

function orchNodeMcpAccessChanged() {
  var allowEl = document.getElementById('orch-node-allow-mcp');
  var container = document.getElementById('orch-node-mcp-server-list');
  var disabled = !allowEl || !allowEl.checked;
  if (container) {
    var checks = container.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checks.length; i++) checks[i].disabled = disabled;
    container.style.opacity = disabled ? '0.6' : '1';
  }
}

function orchRenderNodeMcpServers(servers) {
  var container = document.getElementById('orch-node-mcp-server-list');
  if (!container) return;
  var selectedIds = orchGetSelectedNodeMcpServerIds();
  if (!servers || !servers.length) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;">No MCP servers configured for this tool.</div>';
    orchSetSelectedNodeMcpServerIds([]);
    orchNodeMcpAccessChanged();
    return;
  }

  var html = '';
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i];
    var checked = selectedIds.indexOf(server.id) >= 0;
    html += '<label class="agent-checkbox-label" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.45rem 0.55rem;border:1px solid var(--border);border-radius:10px;background:var(--surface);width:100%;">';
    html += '<span><strong>' + escapeHtml(server.name) + '</strong> <span style="color:var(--text-dim);font-size:0.78rem;">(' + escapeHtml(server.transport) + ')</span></span>';
    html += '<input type="checkbox" data-mcp-server-id="' + escapeHtml(server.id) + '"' + (checked ? ' checked' : '') + ' onchange="orchSyncNodeMcpServerSelection()">';
    html += '<span class="cb-mark"></span>';
    html += '</label>';
  }
  container.innerHTML = html;
  orchNodeMcpAccessChanged();
}

async function orchLoadNodeMcpServers() {
  var toolEl = document.getElementById('orch-panel-node-tool');
  var container = document.getElementById('orch-node-mcp-server-list');
  if (!toolEl || !container) return;
  container.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;">Loading MCP servers...</div>';
  var response = await fetchApi('/api/mcp/servers?tool=' + encodeURIComponent(toolEl.value), null, true);
  var serverMap = response && response.servers ? response.servers : {};
  var servers = [];
  for (var name in serverMap) {
    if (!Object.prototype.hasOwnProperty.call(serverMap, name)) continue;
    var server = serverMap[name];
    servers.push({
      id: server.id,
      name: name,
      transport: server.transport || 'stdio'
    });
  }
  servers.sort(function(a, b) { return a.name.localeCompare(b.name); });
  orchRenderNodeMcpServers(servers);
}

function orchNodeToolChanged() {
  var newTool = (document.getElementById('orch-panel-node-tool') || {}).value || 'claude';
  updateModelPlaceholder('orch-panel-node-model', newTool);
  orchSetSelectedNodeMcpServerIds([]);
  orchLoadNodeMcpServers();
}

// ── Triggered Node Event Source ──────────────────────────

function orchTriggeredEndpointChanged() {
  var selectEl = document.getElementById('orch-panel-node-triggered-endpoint');
  var detailEl = document.getElementById('orch-triggered-sub-detail');
  if (detailEl) detailEl.style.display = selectEl && selectEl.value ? '' : 'none';
}

async function orchLoadTriggeredEndpoints(nodeId) {
  var selectEl = document.getElementById('orch-panel-node-triggered-endpoint');
  if (!selectEl) return;

  var epPromise = fetchApi('/api/webhook-endpoints');
  var subPromise = fetchApi('/api/event-subscriptions');
  var epRes = await epPromise;
  var subRes = await subPromise;

  var endpoints = (epRes && epRes.data) ? epRes.data : [];
  var subs = (subRes && subRes.data) ? subRes.data : [];

  var optHtml = '<option value="">None (manual trigger only)</option>';
  for (var i = 0; i < endpoints.length; i++) {
    var ep = endpoints[i];
    var epLabel = (ep.publisherPreset === 'github' ? 'GitHub' : 'Generic') + ' - /webhooks/' + ep.token.substring(0, 8) + '...';
    if (!ep.enabled) epLabel += ' (disabled)';
    optHtml += '<option value="' + escapeHtml(ep.id) + '">' + escapeHtml(epLabel) + '</option>';
  }
  selectEl.innerHTML = optHtml;

  orchNodeTriggeredSubscription = null;
  if (nodeId) {
    for (var j = 0; j < subs.length; j++) {
      if (subs[j].targetType === 'triggered_node' && subs[j].nodeId === nodeId) {
        orchNodeTriggeredSubscription = subs[j];
        break;
      }
    }
  }

  var detailEl = document.getElementById('orch-triggered-sub-detail');
  var statusEl = document.getElementById('orch-triggered-sub-status');

  if (orchNodeTriggeredSubscription) {
    selectEl.value = orchNodeTriggeredSubscription.endpointId;
    var filterEl = document.getElementById('orch-panel-node-triggered-filter');
    var mappingEl = document.getElementById('orch-panel-node-triggered-mapping');
    var enabledEl = document.getElementById('orch-panel-node-triggered-sub-enabled');
    if (filterEl && orchNodeTriggeredSubscription.filterJson) {
      try { filterEl.value = JSON.stringify(JSON.parse(orchNodeTriggeredSubscription.filterJson), null, 2); } catch(e) { filterEl.value = orchNodeTriggeredSubscription.filterJson; }
    }
    if (mappingEl && orchNodeTriggeredSubscription.contextMappingJson) {
      try { mappingEl.value = JSON.stringify(JSON.parse(orchNodeTriggeredSubscription.contextMappingJson), null, 2); } catch(e) { mappingEl.value = orchNodeTriggeredSubscription.contextMappingJson; }
    }
    if (enabledEl) enabledEl.checked = orchNodeTriggeredSubscription.enabled;
    if (detailEl) detailEl.style.display = '';
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.innerHTML = '<span style="color:' + (orchNodeTriggeredSubscription.enabled ? 'var(--green)' : 'var(--yellow)') + ';">\\u25cf ' + (orchNodeTriggeredSubscription.enabled ? 'Subscription active' : 'Subscription paused') + '</span>';
    }
  } else {
    if (detailEl) detailEl.style.display = selectEl.value ? '' : 'none';
    if (statusEl) statusEl.style.display = 'none';
  }
}

async function orchSaveTriggeredSubscription(nodeId) {
  var endpointId = (document.getElementById('orch-panel-node-triggered-endpoint') || {}).value || '';

  if (endpointId) {
    var filterVal = (document.getElementById('orch-panel-node-triggered-filter') || {}).value || '';
    var mappingVal = (document.getElementById('orch-panel-node-triggered-mapping') || {}).value || '';
    var subEnabled = (document.getElementById('orch-panel-node-triggered-sub-enabled') || {}).checked !== false;

    var filterJson = null;
    var contextMapping = null;
    if (filterVal.trim()) {
      try { filterJson = JSON.parse(filterVal); } catch(e) { toast('Invalid filter JSON: ' + e.message, 'error'); return false; }
    }
    if (mappingVal.trim()) {
      try { contextMapping = JSON.parse(mappingVal); } catch(e) { toast('Invalid mapping JSON: ' + e.message, 'error'); return false; }
    }

    var subRes;
    if (orchNodeTriggeredSubscription) {
      subRes = await fetchApi('/api/event-subscriptions/' + orchNodeTriggeredSubscription.id, {
        method: 'PATCH',
        body: JSON.stringify({
          endpointId: endpointId,
          filter: filterJson,
          contextMapping: contextMapping,
          enabled: subEnabled,
          updatedAt: orchNodeTriggeredSubscription.updatedAt,
        })
      });
    } else {
      subRes = await fetchApi('/api/event-subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          endpointId: endpointId,
          targetType: 'triggered_node',
          nodeId: nodeId,
          filter: filterJson,
          contextMapping: contextMapping,
          enabled: subEnabled,
        })
      });
    }
    if (!subRes || !subRes.ok) {
      toast('Node saved but subscription failed: ' + ((subRes && subRes.error) || 'unknown'), 'error');
      return false;
    }
    if (subRes.data) {
      orchNodeTriggeredSubscription = subRes.data;
    }
  } else if (orchNodeTriggeredSubscription) {
    var deleteRes = await fetchApi('/api/event-subscriptions/' + orchNodeTriggeredSubscription.id, { method: 'DELETE' });
    if (!deleteRes || !deleteRes.ok) {
      toast('Node saved but subscription removal failed', 'error');
      return false;
    }
    orchNodeTriggeredSubscription = null;
  }
  return true;
}

// ── Webhook Start Node Event Source ──────────────────────

function orchWebhookStartEndpointChanged() {
  var selectEl = document.getElementById('orch-panel-webhook-start-endpoint');
  var detailEl = document.getElementById('orch-webhook-start-sub-detail');
  if (detailEl) detailEl.style.display = selectEl && selectEl.value ? '' : 'none';
}

async function orchLoadWebhookStartEndpoints() {
  var selectEl = document.getElementById('orch-panel-webhook-start-endpoint');
  if (!selectEl || !orchCurrent) return;

  var epPromise = fetchApi('/api/webhook-endpoints');
  var subPromise = fetchApi('/api/event-subscriptions');
  var epRes = await epPromise;
  var subRes = await subPromise;

  var endpoints = (epRes && epRes.data) ? epRes.data : [];
  var subs = (subRes && subRes.data) ? subRes.data : [];

  var optHtml = '<option value="">None (no webhook trigger)</option>';
  for (var i = 0; i < endpoints.length; i++) {
    var ep = endpoints[i];
    var epLabel = (ep.publisherPreset === 'github' ? 'GitHub' : 'Generic') + ' - /webhooks/' + ep.token.substring(0, 8) + '...';
    if (!ep.enabled) epLabel += ' (disabled)';
    optHtml += '<option value="' + escapeHtml(ep.id) + '">' + escapeHtml(epLabel) + '</option>';
  }
  selectEl.innerHTML = optHtml;

  // Find existing orchestrator-level subscription
  orchWebhookStartSubscription = null;
  for (var j = 0; j < subs.length; j++) {
    if (subs[j].targetType === 'orchestrator' && subs[j].orchestratorId === orchCurrent.id) {
      orchWebhookStartSubscription = subs[j];
      break;
    }
  }

  var detailEl = document.getElementById('orch-webhook-start-sub-detail');
  var statusEl = document.getElementById('orch-webhook-start-sub-status');

  if (orchWebhookStartSubscription) {
    selectEl.value = orchWebhookStartSubscription.endpointId;
    var filterEl = document.getElementById('orch-panel-webhook-start-filter');
    var mappingEl = document.getElementById('orch-panel-webhook-start-mapping');
    if (filterEl && orchWebhookStartSubscription.filterJson) {
      try { filterEl.value = JSON.stringify(JSON.parse(orchWebhookStartSubscription.filterJson), null, 2); } catch(e) { filterEl.value = orchWebhookStartSubscription.filterJson; }
    }
    if (mappingEl && orchWebhookStartSubscription.contextMappingJson) {
      try { mappingEl.value = JSON.stringify(JSON.parse(orchWebhookStartSubscription.contextMappingJson), null, 2); } catch(e) { mappingEl.value = orchWebhookStartSubscription.contextMappingJson; }
    }
    if (detailEl) detailEl.style.display = '';
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.innerHTML = '<span style="color:' + (orchWebhookStartSubscription.enabled ? 'var(--green)' : 'var(--yellow)') + ';">\\u25cf ' + (orchWebhookStartSubscription.enabled ? 'Subscription active' : 'Subscription paused') + '</span>';
    }
  } else {
    if (detailEl) detailEl.style.display = selectEl.value ? '' : 'none';
    if (statusEl) statusEl.style.display = 'none';
  }
}

async function orchSaveWebhookStartSubscription() {
  if (!orchCurrent) return;
  var endpointId = (document.getElementById('orch-panel-webhook-start-endpoint') || {}).value || '';

  if (endpointId) {
    var filterVal = (document.getElementById('orch-panel-webhook-start-filter') || {}).value || '';
    var mappingVal = (document.getElementById('orch-panel-webhook-start-mapping') || {}).value || '';

    var filterJson = null;
    var contextMapping = null;
    if (filterVal.trim()) {
      try { filterJson = JSON.parse(filterVal); } catch(e) { toast('Invalid filter JSON: ' + e.message, 'error'); return false; }
    }
    if (mappingVal.trim()) {
      try { contextMapping = JSON.parse(mappingVal); } catch(e) { toast('Invalid mapping JSON: ' + e.message, 'error'); return false; }
    }

    var subRes;
    if (orchWebhookStartSubscription) {
      subRes = await fetchApi('/api/event-subscriptions/' + orchWebhookStartSubscription.id, {
        method: 'PATCH',
        body: JSON.stringify({
          endpointId: endpointId,
          filter: filterJson,
          contextMapping: contextMapping,
          enabled: orchWebhookStartSubscription.enabled,
          updatedAt: orchWebhookStartSubscription.updatedAt,
        })
      });
    } else {
      subRes = await fetchApi('/api/event-subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          endpointId: endpointId,
          targetType: 'orchestrator',
          orchestratorId: orchCurrent.id,
          filter: filterJson,
          contextMapping: contextMapping,
          enabled: true,
        })
      });
    }
    if (!subRes || !subRes.ok) {
      toast('Node saved but webhook subscription failed: ' + ((subRes && subRes.error) || 'unknown'), 'error');
      return false;
    }
    if (subRes.data) {
      orchWebhookStartSubscription = subRes.data;
    }
  } else if (orchWebhookStartSubscription) {
    var deleteRes = await fetchApi('/api/event-subscriptions/' + orchWebhookStartSubscription.id, { method: 'DELETE' });
    if (!deleteRes || !deleteRes.ok) {
      toast('Node saved but webhook subscription removal failed', 'error');
      return false;
    }
    orchWebhookStartSubscription = null;
  }
  return true;
}

// ── Return Value Tags (Manual Mode) ──────────────────────

function orchAddReturnValue() {
  var input = document.getElementById('orch-rv-new-input');
  if (!input) return;
  var val = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!val) { toast('Enter a valid return value name (alphanumeric, _ or -)', 'error'); return; }
  var container = document.getElementById('orch-rv-tags');
  if (!container) return;
  // Check duplicates
  var existing = container.querySelectorAll('.orch-rv-tag');
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getAttribute('data-value') === val) { toast('Value already exists', 'error'); input.value = ''; return; }
  }
  // Reject reserved system values
  if (val === 'other_return' || val === 'error_return') { toast('Reserved system value', 'error'); input.value = ''; return; }
  // Insert before system tags (other_return / error_return)
  var tag = document.createElement('span');
  tag.className = 'orch-rv-tag';
  tag.setAttribute('data-value', val);
  tag.innerHTML = escapeHtml(val) + ' <button class="orch-rv-remove" onclick="orchRemoveReturnValue(this)" title="Remove">&times;</button>';
  var firstSpecialTag = container.querySelector('.orch-rv-tag-special');
  if (firstSpecialTag) {
    container.insertBefore(tag, firstSpecialTag);
  } else {
    container.appendChild(tag);
  }
  input.value = '';
  input.focus();
}

function orchRemoveReturnValue(btn) {
  var tag = btn.parentElement;
  if (tag && tag.classList.contains('orch-rv-tag')) {
    tag.remove();
  }
}

// ── Save Node from Panel ──────────────────────────────────

async function orchSaveNodeFromPanel() {
  if (!orchCurrent) return;
  try {
    var labelEl = document.getElementById('orch-panel-node-label');
    if (!labelEl) { toast('Form error', 'error'); return; }

    var nodeType = (document.getElementById('orch-panel-node-type') || {}).value || 'task';
    var isEnd = nodeType === 'end';
    var isGate = nodeType === 'gate';
    var isTaskLike = nodeType === 'task' || nodeType === 'triggered';

    var payload = {
      label: labelEl.value.trim(),
      nodeType: nodeType,
    };

    if (!payload.label) { toast('Label is required', 'error'); return; }

    if (isTaskLike) {
      payload.agentId = (document.getElementById('orch-panel-agent-id') || {}).value || null;
      payload.tool = (document.getElementById('orch-panel-node-tool') || {}).value || 'claude';
      var modelInput = document.getElementById('orch-panel-node-model');
      if (modelInput) payload.model = modelInput.value.trim() || null;
      payload.workdir = (document.getElementById('orch-panel-node-workdir') || {}).value?.trim() || null;
      payload.writeInstructionFile = (document.getElementById('orch-panel-node-write-instruction') || {}).checked !== false;
      payload.instructionFile = (document.getElementById('orch-panel-node-instruction-file') || {}).value?.trim() || null;
      payload.maxRetries = parseInt((document.getElementById('orch-panel-node-max-retries') || {}).value) || 0;
      payload.timeoutSec = parseInt((document.getElementById('orch-panel-node-timeout') || {}).value) || null;

      // MCP guardrail — when agent is assigned, inherit MCP from agent (node-level MCP hidden)
      if (payload.agentId) {
        var agentsForMcp = await agentsFetchCached();
        var selectedAgent = agentsForMcp.find(function(a) { return a.id === payload.agentId; });
        payload.allowMcp = selectedAgent ? (selectedAgent.allowMcp !== false) : true;
        payload.enabledMcpServerIds = selectedAgent && selectedAgent.enabledMcpServerIds && selectedAgent.enabledMcpServerIds.length > 0
          ? selectedAgent.enabledMcpServerIds : null;
      } else {
        var mcpEl = document.getElementById('orch-node-allow-mcp');
        payload.allowMcp = mcpEl ? mcpEl.checked : true;
        payload.enabledMcpServerIds = payload.allowMcp ? orchGetSelectedNodeMcpServerIds() : null;
        if (!payload.enabledMcpServerIds || !payload.enabledMcpServerIds.length) {
          payload.enabledMcpServerIds = null;
        }
      }

      // Read output mode — force auto when agent is assigned
      var outputMode = payload.agentId ? 'auto' : ((document.getElementById('orch-panel-output-mode') || {}).value || 'auto');
      payload.outputMode = outputMode;

      if (outputMode === 'auto') {
        // Auto mode: read prompt from auto textarea
        payload.prompt = (document.getElementById('orch-panel-node-prompt-auto') || {}).value || '';

        // Parse return conditions from hidden input
        var rcRaw = (document.getElementById('orch-panel-return-conditions') || {}).value || '';
        var rcParsed = [];
        if (rcRaw) { try { rcParsed = JSON.parse(rcRaw); } catch(e) { rcParsed = []; } }
        payload.returnConditions = rcParsed.length > 0 ? rcParsed : null;

        // Auto-derive return values from conditions (unique values + other_return)
        if (rcParsed.length > 0) {
          var seen = {};
          var rvArr = [];
          for (var ci = 0; ci < rcParsed.length; ci++) {
            var cv = rcParsed[ci].value;
            if (cv && !seen[cv]) { seen[cv] = true; rvArr.push(cv); }
          }
          if (rvArr.indexOf('other_return') < 0) rvArr.push('other_return');
          if (rvArr.indexOf('error_return') < 0) rvArr.push('error_return');
          payload.returnValues = rvArr;
        } else {
          // No conditions → clear stale returnValues
          payload.returnValues = null;
        }
      } else {
        // Manual mode: read prompt from manual textarea
        payload.prompt = (document.getElementById('orch-panel-node-prompt') || {}).value || '';
        payload.returnConditions = null;

        // Return values — read from tag elements
        var rvContainer = document.getElementById('orch-rv-tags');
        if (rvContainer) {
          var rvTags = rvContainer.querySelectorAll('.orch-rv-tag[data-value]');
          var rvArr = [];
          for (var rvi = 0; rvi < rvTags.length; rvi++) {
            var v = rvTags[rvi].getAttribute('data-value');
            if (v) rvArr.push(v);
          }
          if (rvArr.length > 0) payload.returnValues = rvArr;
        }
      }

      if (nodeType === 'triggered') {
        var waitTimeoutSec = parseInt((document.getElementById('orch-panel-node-triggered-timeout') || {}).value, 10) || 3600;
        var onTimeout = (document.getElementById('orch-panel-node-triggered-on-timeout') || {}).value || 'fail';
        payload.triggeredConfig = {
          waitTimeoutSec: waitTimeoutSec,
          onTimeout: onTimeout
        };

        // Include subscription inline for atomic server-side save
        var tEndpointId = (document.getElementById('orch-panel-node-triggered-endpoint') || {}).value || '';
        if (tEndpointId) {
          var tFilterVal = (document.getElementById('orch-panel-node-triggered-filter') || {}).value || '';
          var tMappingVal = (document.getElementById('orch-panel-node-triggered-mapping') || {}).value || '';
          var tEnabled = (document.getElementById('orch-panel-node-triggered-sub-enabled') || {}).checked !== false;
          var tFilterJson = null;
          var tMappingJson = null;
          if (tFilterVal.trim()) {
            try { tFilterJson = JSON.stringify(JSON.parse(tFilterVal)); } catch(e) { toast('Invalid filter JSON: ' + e.message, 'error'); return; }
          }
          if (tMappingVal.trim()) {
            try { tMappingJson = JSON.stringify(JSON.parse(tMappingVal)); } catch(e) { toast('Invalid mapping JSON: ' + e.message, 'error'); return; }
          }
          payload.triggeredSubscription = {
            endpointId: tEndpointId,
            filterJson: tFilterJson,
            contextMappingJson: tMappingJson,
            enabled: tEnabled
          };
        } else {
          // No endpoint selected — remove subscription if exists
          payload.triggeredSubscription = null;
        }
      }
    }

    if (isGate) {
      var gateMode = (document.getElementById('orch-panel-node-gate-mode') || {}).value || 'and';
      var matchValue = (document.getElementById('orch-panel-node-match-value') || {}).value || 'done';
      payload.gateCondition = { mode: gateMode, matchValue: matchValue };
      payload.returnValues = ['true', 'false'];
    }

    if (!isEnd) {
      payload.notifyEnabled = (document.getElementById('orch-panel-node-notify-enabled') || {}).checked || false;
      payload.notifyChannel = orchGetNotifyChannel('orch-panel-node-notify-select', 'orch-panel-node-notify-manual') || null;
      var noeEl = document.getElementById('orch-panel-node-notify-on-error');
      payload.notifyOnError = noeEl ? noeEl.checked : true;
    }

    var url, method;
    if (orchSelectedNodeId) {
      url = '/api/orchestrators/' + orchCurrent.id + '/nodes/' + orchSelectedNodeId;
      method = 'PATCH';
      if (orchNodeEditingUpdatedAt) payload.updatedAt = orchNodeEditingUpdatedAt;
    } else {
      url = '/api/orchestrators/' + orchCurrent.id + '/nodes';
      method = 'POST';
    }

    // Capture old node fields for undo (edit mode only)
    var _undoOldFields = null;
    if (method === 'PATCH' && orchSelectedNodeId) {
      var _curNode = (orchCurrent.nodes || []).find(function(n) { return n.id === orchSelectedNodeId; });
      if (_curNode) {
        _undoOldFields = {};
        var _pKeys = Object.keys(payload);
        for (var _pk = 0; _pk < _pKeys.length; _pk++) {
          if (_pKeys[_pk] === 'updatedAt') continue;
          var _ov = _curNode[_pKeys[_pk]];
          _undoOldFields[_pKeys[_pk]] = _ov !== undefined ? (typeof _ov === 'object' && _ov !== null ? JSON.parse(JSON.stringify(_ov)) : _ov) : null;
        }
      }
    }

    var res = await fetchApi(url, { method: method, body: JSON.stringify(payload) });
    if (res && res.ok) {
      var savedId = orchSelectedNodeId || (res.data ? res.data.id : null);
      // Manage webhook start subscription (orchestrator-level, still separate)
      if (orchCurrent && orchCurrent.triggerMode === 'webhook' && savedId && orchCurrent.startNodeId === savedId) {
        await orchSaveWebhookStartSubscription();
      }
      // Refresh data — single fetch, pass to editor to avoid duplicate request
      var fresh = await fetchApi('/api/orchestrators/' + orchCurrent.id);
      if (fresh && fresh.data) {
        orchCurrent = fresh.data;
        if (dagEditor) orchEditorRefreshData(fresh.data);
        if (savedId) orchShowNodePanel(savedId);
      }
      // Push undo command for node field updates (edit mode only)
      if (_undoOldFields && orchSelectedNodeId) {
        var _redoFields = Object.assign({}, payload);
        delete _redoFields.updatedAt;
        dagUndoManager.push(dagUndoCommandFromData('UpdateNodeField', { nodeId: orchSelectedNodeId, oldFields: _undoOldFields, newFields: _redoFields }, 'Update node'));
      }
      toast('Node saved', 'success');
      orchEditorMarkDirty();
    }
  } catch (err) {
    console.error('orchSaveNodeFromPanel error:', err);
    toast('Failed to save node: ' + (err.message || err), 'error');
  }
}

// ── Auto-create Start Node ────────────────────────────────

async function orchCreateStartNode() {
  if (!orchCurrent) return;
  var pos = orchEditorGetViewportCenter();
  var payload = {
    nodeType: 'task',
    label: 'Start',
    tool: 'claude',
    prompt: '',
    outputMode: 'auto',
    returnConditions: [{ condition: 'The task completes', value: 'done' }],
    returnValues: ['done', 'other_return', 'error_return'],
    positionX: pos.x,
    positionY: pos.y,
  };
  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/nodes', {
    method: 'POST', body: JSON.stringify(payload)
  });
  if (res && res.ok) {
    var fresh = await fetchApi('/api/orchestrators/' + orchCurrent.id);
    if (fresh && fresh.data) {
      orchCurrent = fresh.data;
      if (dagEditor) orchEditorRefreshData(fresh.data);
    }
  }
}

// ── Add Node from Toolbar ─────────────────────────────────

function orchToggleAddMenu() {
  var menu = document.getElementById('orch-add-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? '' : 'none';
}

async function orchAddNodeOfType(type) {
  document.getElementById('orch-add-menu').style.display = 'none';
  if (!orchCurrent) { toast('Save orchestrator settings first', 'error'); return; }

  var defaults = {
    task: { label: 'New Task', tool: 'claude', prompt: '', outputMode: 'auto', returnConditions: [{ condition: 'The task completes', value: 'done' }], returnValues: ['done', 'other_return', 'error_return'] },
    triggered: { label: 'Wait for Event', tool: 'claude', prompt: '', outputMode: 'auto', returnConditions: [{ condition: 'The triggered task completes', value: 'done' }], returnValues: ['done', 'other_return', 'error_return'], triggeredConfig: { waitTimeoutSec: 3600, onTimeout: 'fail' } },
    gate: { label: 'Gate', gateCondition: { mode: 'and', matchValue: 'done' }, returnValues: ['true', 'false'] },
    end:  { label: 'End', returnValues: null },
  };
  var d = defaults[type] || defaults.task;

  // Place at viewport center
  var pos = orchEditorGetViewportCenter();

  var payload = Object.assign({}, d, {
    nodeType: type,
    positionX: pos.x,
    positionY: pos.y,
  });

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/nodes', {
    method: 'POST', body: JSON.stringify(payload)
  });

  if (res && res.ok) {
    var fresh = await fetchApi('/api/orchestrators/' + orchCurrent.id);
    if (fresh && fresh.data) {
      orchCurrent = fresh.data;
      if (dagEditor) orchEditorRefreshData(fresh.data);
      if (res.data && res.data.id) orchShowNodePanel(res.data.id);
    }
    toast(type + ' node added', 'success');
    orchEditorMarkDirty();
    if (res.data && res.data.id) {
      dagUndoManager.push(dagUndoCommandFromData('CreateNode', { nodeId: res.data.id, payload: payload }, 'Add ' + type + ' node'));
    }
  }
}

function orchEditorGetViewportCenter() {
  if (!dagEditor) return { x: 100, y: 100 };
  var rect = dagEditor.svg.getBoundingClientRect();
  return {
    x: Math.round(((rect.width / 2 - dagEditor.translateX) / dagEditor.scale) / DAG_SNAP_GRID) * DAG_SNAP_GRID,
    y: Math.round(((rect.height / 2 - dagEditor.translateY) / dagEditor.scale) / DAG_SNAP_GRID) * DAG_SNAP_GRID
  };
}

// ── Delete Node ───────────────────────────────────────────

async function orchDeleteNode(nodeId) {
  if (!orchCurrent) return;
  if (typeof orchIsStartNode === 'function' && orchIsStartNode(nodeId)) {
    toast('Start node cannot be deleted', 'error'); return;
  }
  if (!confirm('Delete this node and its edges?')) return;

  // Cache node data and connected edges for undo
  var nodes = orchCurrent.nodes || [];
  var edges = orchCurrent.edges || [];
  var nodeData = null;
  for (var ni = 0; ni < nodes.length; ni++) {
    if (nodes[ni].id === nodeId) { nodeData = nodes[ni]; break; }
  }
  var connEdges = [];
  for (var ej = 0; ej < edges.length; ej++) {
    if (edges[ej].fromNodeId === nodeId || edges[ej].toNodeId === nodeId) {
      connEdges.push({ fromNodeId: edges[ej].fromNodeId, toNodeId: edges[ej].toNodeId, conditionValue: edges[ej].conditionValue || null, conditionOperator: edges[ej].conditionOperator || 'eq', sortOrder: edges[ej].sortOrder || 0 });
    }
  }

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/nodes/' + nodeId, { method: 'DELETE' });
  if (res && res.ok) {
    toast('Node deleted', 'success');
    orchEditorMarkDirty();
    if (orchSelectedNodeId === nodeId) orchCloseSidePanel();
    if (nodeData) {
      var np = orchBuildNodePayload(nodeData);
      dagUndoManager.push(dagUndoCommandFromData('DeleteNode', { nodeId: nodeId, nodePayload: np, edgePayloads: connEdges }, 'Delete node'));
    }
    if (dagEditor) orchEditorRefreshData();
  }
}

// ── Duplicate Node ────────────────────────────────────────

async function orchDuplicateNode(nodeId) {
  if (!orchCurrent) return;
  var nodes = orchCurrent.nodes || [];
  var node = null;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].id === nodeId) { node = nodes[i]; break; }
  }
  if (!node) return;

  var pos = dagEditor ? dagEditor.nodePositions[nodeId] : null;
  var payload = {
    label: (node.label || 'Node').replace(/ \\(copy\\)$/, '') + ' (copy)',
    nodeType: node.nodeType,
    tool: node.tool || null,
    prompt: node.prompt || '',
    outputMode: node.outputMode || 'auto',
    returnValues: node.returnValues ? node.returnValues.slice() : null,
    returnConditions: node.returnConditions ? JSON.parse(JSON.stringify(node.returnConditions)) : null,
    positionX: pos ? pos.x + 40 : (node.positionX || 0) + 40,
    positionY: pos ? pos.y + 40 : (node.positionY || 0) + 40,
    maxRetries: node.maxRetries || 0,
    timeoutSec: node.timeoutSec || null,
    notifyEnabled: node.notifyEnabled || false,
    notifyChannel: node.notifyChannel || null,
    notifyOnError: node.notifyOnError !== undefined ? node.notifyOnError : true,
    allowMcp: node.allowMcp !== undefined ? node.allowMcp : true,
    enabledMcpServerIds: node.enabledMcpServerIds ? node.enabledMcpServerIds.slice() : null,
    workdir: node.workdir || null,
    writeInstructionFile: node.writeInstructionFile !== undefined ? node.writeInstructionFile : true,
    instructionFile: node.instructionFile || null,
    agentId: node.agentId || null,
  };
  if (node.nodeType === 'gate' && node.gateCondition) {
    payload.gateCondition = JSON.parse(JSON.stringify(node.gateCondition));
  }
  if (node.nodeType === 'triggered' && node.triggeredConfig) {
    payload.triggeredConfig = JSON.parse(JSON.stringify(node.triggeredConfig));
  }
  // Note: triggeredSubscription (webhook endpoint binding) is intentionally NOT copied.
  // Each subscription must be unique to avoid duplicate event processing.

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/nodes', {
    method: 'POST', body: JSON.stringify(payload)
  });
  if (res && res.ok) {
    toast('Node duplicated', 'success');
    orchEditorMarkDirty();
    if (res.data && res.data.id) {
      dagUndoManager.push(dagUndoCommandFromData('CreateNode', { nodeId: res.data.id, payload: payload }, 'Duplicate node'));
    }
    orchEditorRefreshData();
    if (res.data && res.data.id) orchShowNodePanel(res.data.id);
  }
}
`;
