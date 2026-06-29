/** @module dashboard/scripts/orchestrator-editor — Client-side script for the interactive SVG DAG editor. */

/**
 * Interactive SVG DAG editor with:
 * - Multi-output port rendering (returnValues per node)
 * - Node drag & drop with snap-to-grid
 * - Edge creation by dragging from output port to input port
 * - Zoom / pan via mouse wheel and background drag
 * - Minimap with viewport indicator
 * - Context menu (right-click)
 * - Inline condition editor (double-click edge label)
 * - Real-time DAG validation
 * - Run status color overlay
 * - End node support (double-border, no output ports)
 */

export const orchestratorEditorScript = `
// ── Constants ─────────────────────────────────────────────
var DAG_NODE_W = 160, DAG_NODE_H = 50, DAG_PORT_R = 6;
var DAG_ZOOM_MIN = 0.2, DAG_ZOOM_MAX = 3.0, DAG_ZOOM_STEP = 0.1;
var DAG_SNAP_GRID = 20;
var DAG_SAVE_DEBOUNCE = 800;
var DAG_CULL_MARGIN = 200;
var DAG_PORT_SPACING = 22;
// DAG_ALLOWED_RUN_STATUSES — reuse ORCH_ALLOWED_RUN_STATUSES from orchestrator.ts (loaded first)
var DAG_ALLOWED_RUN_STATUSES = ORCH_ALLOWED_RUN_STATUSES;

// ── Singleton State ───────────────────────────────────────
var dagEditor = null;
var dagFocusedNodeId = null;

// ── Undo/Redo Manager (Command Pattern) ──────────────────
var DAG_UNDO_MAX = 50;

var dagUndoManager = {
  _stack: [],
  _redoStack: [],

  push: function(cmd) {
    dagUndoManager._stack.push(cmd);
    if (dagUndoManager._stack.length > DAG_UNDO_MAX) dagUndoManager._stack.shift();
    dagUndoManager._redoStack = [];
    dagUndoManager.save();
    dagUndoManager.renderButtons();
  },

  undo: async function() {
    if (dagUndoManager._stack.length === 0) return;
    var cmd = dagUndoManager._stack.pop();
    try {
      await cmd.undo();
      dagUndoManager._redoStack.push(cmd);
      dagUndoManager.save();
      dagUndoManager.renderButtons();
      orchEditorMarkDirty();
      await orchEditorRefreshData();
      if (orchSelectedNodeId && typeof orchShowNodePanel === 'function') orchShowNodePanel(orchSelectedNodeId);
      toast('Undo: ' + cmd.description, 'info');
    } catch (err) {
      console.error('[DAG Undo] Failed:', err);
      dagUndoManager._stack = [];
      dagUndoManager._redoStack = [];
      dagUndoManager.save();
      dagUndoManager.renderButtons();
      toast('Undo failed — refreshing', 'error');
      orchEditorRefreshData();
    }
  },

  redo: async function() {
    if (dagUndoManager._redoStack.length === 0) return;
    var cmd = dagUndoManager._redoStack.pop();
    try {
      await cmd.redo();
      dagUndoManager._stack.push(cmd);
      dagUndoManager.save();
      dagUndoManager.renderButtons();
      orchEditorMarkDirty();
      await orchEditorRefreshData();
      if (orchSelectedNodeId && typeof orchShowNodePanel === 'function') orchShowNodePanel(orchSelectedNodeId);
      toast('Redo: ' + cmd.description, 'info');
    } catch (err) {
      console.error('[DAG Redo] Failed:', err);
      dagUndoManager._stack = [];
      dagUndoManager._redoStack = [];
      dagUndoManager.save();
      dagUndoManager.renderButtons();
      toast('Redo failed — refreshing', 'error');
      orchEditorRefreshData();
    }
  },

  canUndo: function() { return dagUndoManager._stack.length > 0; },
  canRedo: function() { return dagUndoManager._redoStack.length > 0; },

  clear: function() {
    dagUndoManager._stack = [];
    dagUndoManager._redoStack = [];
    dagUndoManager.save();
    dagUndoManager.renderButtons();
  },

  save: function() {
    if (!orchCurrent) return;
    try {
      var data = dagUndoManager._stack.map(function(c) { return { type: c.type, data: c.data, description: c.description }; });
      var redoData = dagUndoManager._redoStack.map(function(c) { return { type: c.type, data: c.data, description: c.description }; });
      localStorage.setItem('dagUndo_' + orchCurrent.id, JSON.stringify({ undo: data, redo: redoData }));
    } catch (e) { /* localStorage full or unavailable */ }
  },

  restore: function(orchId) {
    dagUndoManager._stack = [];
    dagUndoManager._redoStack = [];
    try {
      var raw = localStorage.getItem('dagUndo_' + orchId);
      if (!raw) { dagUndoManager.renderButtons(); return; }
      var parsed = JSON.parse(raw);
      if (parsed.undo) {
        for (var i = 0; i < parsed.undo.length; i++) {
          var cmd = dagUndoCommandFromData(parsed.undo[i].type, parsed.undo[i].data, parsed.undo[i].description);
          if (cmd) dagUndoManager._stack.push(cmd);
        }
      }
      if (parsed.redo) {
        for (var j = 0; j < parsed.redo.length; j++) {
          var rcmd = dagUndoCommandFromData(parsed.redo[j].type, parsed.redo[j].data, parsed.redo[j].description);
          if (rcmd) dagUndoManager._redoStack.push(rcmd);
        }
      }
    } catch (e) {
      dagUndoManager._stack = [];
      dagUndoManager._redoStack = [];
    }
    dagUndoManager.renderButtons();
  },

  renderButtons: function() {
    var undoBtn = document.getElementById('dag-undo-btn');
    var redoBtn = document.getElementById('dag-redo-btn');
    if (undoBtn) undoBtn.disabled = !dagUndoManager.canUndo();
    if (redoBtn) redoBtn.disabled = !dagUndoManager.canRedo();
  }
};

function dagUndoCommandFromData(type, data, description) {
  if (!orchCurrent) return null;
  var orchId = orchCurrent.id;
  var base = { type: type, data: data, description: description || type };

  switch (type) {
    case 'MoveNodes':
      base.undo = async function() {
        var promises = data.moves.map(function(m) {
          return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + m.nodeId, { method: 'PATCH', body: JSON.stringify({ positionX: m.oldX, positionY: m.oldY }) });
        });
        await Promise.all(promises);
      };
      base.redo = async function() {
        var promises = data.moves.map(function(m) {
          return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + m.nodeId, { method: 'PATCH', body: JSON.stringify({ positionX: m.newX, positionY: m.newY }) });
        });
        await Promise.all(promises);
      };
      return base;

    case 'CreateEdge':
      base.undo = function() { return fetchApi('/api/orchestrators/' + orchId + '/edges/' + data.edgeId, { method: 'DELETE' }); };
      base.redo = async function() {
        var oldEid = data.edgeId;
        var res = await fetchApi('/api/orchestrators/' + orchId + '/edges', { method: 'POST', body: JSON.stringify(data.payload) });
        if (res && res.ok && res.data && res.data.id) {
          data.edgeId = res.data.id;
          if (oldEid && oldEid !== data.edgeId) dagUndoUpdateEdgeIdRef(oldEid, data.edgeId);
        }
      };
      return base;

    case 'DeleteEdge':
      base.undo = async function() {
        var oldEid = data.edgeId;
        var res = await fetchApi('/api/orchestrators/' + orchId + '/edges', { method: 'POST', body: JSON.stringify(data.payload) });
        if (res && res.ok && res.data && res.data.id) {
          data.edgeId = res.data.id;
          if (oldEid !== data.edgeId) dagUndoUpdateEdgeIdRef(oldEid, data.edgeId);
        }
      };
      base.redo = function() { return fetchApi('/api/orchestrators/' + orchId + '/edges/' + data.edgeId, { method: 'DELETE' }); };
      return base;

    case 'CreateNode':
      base.undo = function() { return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + data.nodeId, { method: 'DELETE' }); };
      base.redo = async function() {
        var oldNid = data.nodeId;
        var res = await fetchApi('/api/orchestrators/' + orchId + '/nodes', { method: 'POST', body: JSON.stringify(data.payload) });
        if (res && res.ok && res.data && res.data.id) {
          data.nodeId = res.data.id;
          if (oldNid !== data.nodeId) dagUndoUpdateNodeIdRefs(oldNid, data.nodeId);
        }
      };
      return base;

    case 'DeleteNode':
      base.undo = async function() {
        var np = Object.assign({}, data.nodePayload);
        var res = await fetchApi('/api/orchestrators/' + orchId + '/nodes', { method: 'POST', body: JSON.stringify(np) });
        if (res && res.ok && res.data && res.data.id) {
          var oldId = data.nodeId;
          var newId = res.data.id;
          for (var i = 0; i < (data.edgePayloads || []).length; i++) {
            var ep = Object.assign({}, data.edgePayloads[i]);
            if (ep.fromNodeId === oldId) ep.fromNodeId = newId;
            if (ep.toNodeId === oldId) ep.toNodeId = newId;
            data.edgePayloads[i].fromNodeId = ep.fromNodeId;
            data.edgePayloads[i].toNodeId = ep.toNodeId;
            await fetchApi('/api/orchestrators/' + orchId + '/edges', { method: 'POST', body: JSON.stringify(ep) });
          }
          data.nodeId = newId;
          if (oldId !== newId) dagUndoUpdateNodeIdRefs(oldId, newId);
        }
      };
      base.redo = function() { return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + data.nodeId, { method: 'DELETE' }); };
      return base;

    case 'DeleteNodes':
      base.undo = async function() {
        var idMap = {};
        for (var i = 0; i < data.nodes.length; i++) {
          var np = Object.assign({}, data.nodes[i].nodePayload);
          var res = await fetchApi('/api/orchestrators/' + orchId + '/nodes', { method: 'POST', body: JSON.stringify(np) });
          if (res && res.ok && res.data && res.data.id) {
            idMap[data.nodes[i].nodeId] = res.data.id;
            data.nodes[i].nodeId = res.data.id;
          }
        }
        for (var j = 0; j < data.edges.length; j++) {
          var ep = Object.assign({}, data.edges[j]);
          if (idMap[ep.fromNodeId]) ep.fromNodeId = idMap[ep.fromNodeId];
          if (idMap[ep.toNodeId]) ep.toNodeId = idMap[ep.toNodeId];
          data.edges[j].fromNodeId = ep.fromNodeId;
          data.edges[j].toNodeId = ep.toNodeId;
          await fetchApi('/api/orchestrators/' + orchId + '/edges', { method: 'POST', body: JSON.stringify(ep) });
        }
        var mapKeys = Object.keys(idMap);
        for (var mk = 0; mk < mapKeys.length; mk++) {
          if (mapKeys[mk] !== idMap[mapKeys[mk]]) dagUndoUpdateNodeIdRefs(mapKeys[mk], idMap[mapKeys[mk]]);
        }
      };
      base.redo = async function() {
        for (var i = 0; i < data.nodes.length; i++) {
          try {
            await fetchApi('/api/orchestrators/' + orchId + '/nodes/' + data.nodes[i].nodeId, { method: 'DELETE' });
          } catch (e) { console.warn('[DAG Redo] Failed to delete node', data.nodes[i].nodeId); }
        }
      };
      return base;

    case 'UpdateEdgeCondition':
      base.undo = function() { return fetchApi('/api/orchestrators/' + orchId + '/edges/' + data.edgeId, { method: 'PATCH', body: JSON.stringify({ conditionOperator: data.oldOp, conditionValue: data.oldVal }) }); };
      base.redo = function() { return fetchApi('/api/orchestrators/' + orchId + '/edges/' + data.edgeId, { method: 'PATCH', body: JSON.stringify({ conditionOperator: data.newOp, conditionValue: data.newVal }) }); };
      return base;

    case 'UpdateNodeField':
      base.undo = function() { return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + data.nodeId, { method: 'PATCH', body: JSON.stringify(data.oldFields) }); };
      base.redo = function() { return fetchApi('/api/orchestrators/' + orchId + '/nodes/' + data.nodeId, { method: 'PATCH', body: JSON.stringify(data.newFields) }); };
      return base;

    default:
      return null;
  }
}

// ── Node Payload Builder (shared by delete/undo) ─────────

function orchBuildNodePayload(node) {
  var p = {
    label: node.label, nodeType: node.nodeType, agentId: node.agentId || null, tool: node.tool, prompt: node.prompt,
    outputMode: node.outputMode,
    returnValues: node.returnValues ? node.returnValues.slice() : null,
    returnConditions: node.returnConditions ? JSON.parse(JSON.stringify(node.returnConditions)) : null,
    positionX: node.positionX, positionY: node.positionY, sortOrder: node.sortOrder,
    maxRetries: node.maxRetries || 0, timeoutSec: node.timeoutSec || null,
    notifyEnabled: node.notifyEnabled || false, notifyChannel: node.notifyChannel || null,
    notifyOnError: node.notifyOnError !== undefined ? node.notifyOnError : true,
    allowMcp: node.allowMcp !== undefined ? node.allowMcp : true,
    enabledMcpServerIds: node.enabledMcpServerIds ? node.enabledMcpServerIds.slice() : null,
    workdir: node.workdir || null,
    writeInstructionFile: node.writeInstructionFile !== undefined ? node.writeInstructionFile : true,
    instructionFile: node.instructionFile || null
  };
  if (node.gateCondition) p.gateCondition = JSON.parse(JSON.stringify(node.gateCondition));
  if (node.triggeredConfig) p.triggeredConfig = JSON.parse(JSON.stringify(node.triggeredConfig));
  return p;
}

// ── Undo/Redo ID Propagation ─────────────────────────────
// When undo/redo recreates a node or edge, the server assigns a new ID.
// These helpers update all references in the remaining stack commands
// so that subsequent undo/redo operations target the correct entities.

function dagUndoUpdateNodeIdRefs(oldId, newId) {
  function scanStack(stack) {
    for (var i = 0; i < stack.length; i++) {
      var d = stack[i].data;
      if (!d) continue;
      switch (stack[i].type) {
        case 'MoveNodes':
          if (d.moves) for (var m = 0; m < d.moves.length; m++) {
            if (d.moves[m].nodeId === oldId) d.moves[m].nodeId = newId;
          }
          break;
        case 'CreateEdge':
        case 'DeleteEdge':
          if (d.payload) {
            if (d.payload.fromNodeId === oldId) d.payload.fromNodeId = newId;
            if (d.payload.toNodeId === oldId) d.payload.toNodeId = newId;
          }
          break;
        case 'CreateNode':
          if (d.nodeId === oldId) d.nodeId = newId;
          break;
        case 'DeleteNode':
          if (d.nodeId === oldId) d.nodeId = newId;
          if (d.edgePayloads) for (var e = 0; e < d.edgePayloads.length; e++) {
            if (d.edgePayloads[e].fromNodeId === oldId) d.edgePayloads[e].fromNodeId = newId;
            if (d.edgePayloads[e].toNodeId === oldId) d.edgePayloads[e].toNodeId = newId;
          }
          break;
        case 'DeleteNodes':
          if (d.nodes) for (var n = 0; n < d.nodes.length; n++) {
            if (d.nodes[n].nodeId === oldId) d.nodes[n].nodeId = newId;
          }
          if (d.edges) for (var j = 0; j < d.edges.length; j++) {
            if (d.edges[j].fromNodeId === oldId) d.edges[j].fromNodeId = newId;
            if (d.edges[j].toNodeId === oldId) d.edges[j].toNodeId = newId;
          }
          break;
        case 'UpdateNodeField':
          if (d.nodeId === oldId) d.nodeId = newId;
          break;
      }
    }
  }
  scanStack(dagUndoManager._stack);
  scanStack(dagUndoManager._redoStack);
}

function dagUndoUpdateEdgeIdRef(oldId, newId) {
  function scanStack(stack) {
    for (var i = 0; i < stack.length; i++) {
      var d = stack[i].data;
      if (!d) continue;
      switch (stack[i].type) {
        case 'CreateEdge':
        case 'DeleteEdge':
          if (d.edgeId === oldId) d.edgeId = newId;
          break;
        case 'UpdateEdgeCondition':
          if (d.edgeId === oldId) d.edgeId = newId;
          break;
      }
    }
  }
  scanStack(dagUndoManager._stack);
  scanStack(dagUndoManager._redoStack);
}

// ── Start-Node Detection ──────────────────────────────────
// Prefer the persisted startNodeId from the backend. Fall back to the
// legacy heuristic (lowest sortOrder task node with no incoming edges)
// while working with older data.
// Result is cached in dagEditor.startNodeId by orchEditorRender().

function orchFindStartNodeId(nodeList, incomingMap) {
  // Verify persisted startNodeId still exists in the node list
  if (orchCurrent && orchCurrent.startNodeId) {
    for (var si = 0; si < nodeList.length; si++) {
      if (nodeList[si].id === orchCurrent.startNodeId) return orchCurrent.startNodeId;
    }
    console.warn('[DAG] startNodeId', orchCurrent.startNodeId, 'not found in', nodeList.length, 'nodes — falling back to heuristic');
  }
  // Fallback heuristic: lowest sortOrder task node with no incoming edges
  var best = null;
  for (var i = 0; i < nodeList.length; i++) {
    var n = nodeList[i];
    if (n.nodeType === 'gate' || n.nodeType === 'end') continue;
    if (incomingMap[n.id]) continue;
    if (!best || n.sortOrder < best.sortOrder || (n.sortOrder === best.sortOrder && n.createdAt < best.createdAt)) best = n;
  }
  return best ? best.id : null;
}

function orchIsStartNode(nodeId) {
  if (dagEditor && dagEditor.startNodeId !== undefined) return dagEditor.startNodeId === nodeId;
  // Fallback when dagEditor is not yet initialized
  if (!orchCurrent) return false;
  var nodes = orchCurrent.nodes || [];
  var edges = orchCurrent.edges || [];
  var inc = {};
  for (var j = 0; j < edges.length; j++) inc[edges[j].toNodeId] = true;
  return orchFindStartNodeId(nodes, inc) === nodeId;
}

// ── Node Height (dynamic based on output ports) ──────────

function orchEdEffectiveReturnValues(node) {
  if (node.nodeType === 'gate') return ['true', 'false'];
  return node.returnValues;
}

function orchEdNodeHeight(node) {
  if (node.nodeType === 'end') return DAG_NODE_H;
  var rv = orchEdEffectiveReturnValues(node);
  var ports = (rv && rv.length) || 0;
  if (ports <= 1) return DAG_NODE_H;
  var portH = ports * DAG_PORT_SPACING + 16;
  return Math.max(DAG_NODE_H, portH);
}

// ── Port Connectivity Check ──────────────────────────────

function orchEdNodeAllPortsConnected(node, hasIncoming, outEdgesByPort, hasOutgoing, startNodeId) {
  var isEnd = node.nodeType === 'end';
  var isStart = node.id === startNodeId;
  var hasInputPort = !isStart;
  // Input port must be connected (if it exists)
  if (hasInputPort && !hasIncoming[node.id]) return false;
  // Output ports must all be connected (end nodes have none)
  if (!isEnd) {
    var rvCheck = orchEdEffectiveReturnValues(node);
    if (rvCheck && rvCheck.length > 0) {
      var nodeOut = outEdgesByPort[node.id] || {};
      for (var rv_i = 0; rv_i < rvCheck.length; rv_i++) {
        if (!nodeOut[rvCheck[rv_i]]) return false;
      }
    } else {
      if (!hasOutgoing[node.id]) return false;
    }
  }
  return true;
}

// ── Output Port Position ─────────────────────────────────

function orchEdGetOutputPortPos(node, pos, conditionValue) {
  var h = orchEdNodeHeight(node);
  var rv = orchEdEffectiveReturnValues(node);
  if (!rv || rv.length === 0) {
    return { x: pos.x + DAG_NODE_W, y: pos.y + h / 2 };
  }
  var idx = -1;
  for (var i = 0; i < rv.length; i++) {
    if (rv[i] === conditionValue) { idx = i; break; }
  }
  if (idx < 0) idx = 0; // fallback to first port
  var portSpacing = h / (rv.length + 1);
  return { x: pos.x + DAG_NODE_W, y: pos.y + portSpacing * (idx + 1) };
}

function orchEdDisplayPortLabel(node, returnValue) {
  if (returnValue === 'other_return') return 'other';
  if (returnValue === 'error_return') return 'error';
  if (node.nodeType === 'gate') {
    if (returnValue === 'pass') return 'true';
    if (returnValue === 'fail') return 'false';
  }
  return returnValue;
}

function orchEdPortColor(node, isStart, returnValue) {
  if (returnValue === 'other_return') return '#A69E94'; // always gray
  if (returnValue === 'error_return') return '#E53935'; // system error red
  if (node.nodeType === 'gate') return '#F57F17'; // orange
  if (isStart) return '#4CAF50'; // start green
  if (node.nodeType === 'triggered') return '#00897B'; // teal
  return '#5B8DB8'; // task blue
}

function orchEdToolIconSvg(tool, x, y) {
  var inner;
  switch (tool) {
    case 'claude':
      // Sparkle — four-pointed star (fill)
      inner = '<path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" fill="var(--text-muted)"/>';
      break;
    case 'codex':
      // Code angle brackets (stroke)
      inner = '<polyline points="9 6 3 12 9 18" fill="none" stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<polyline points="15 6 21 12 15 18" fill="none" stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
      break;
    case 'gemini':
      // Twin sparkles (fill)
      inner = '<path d="M8 3l1.8 5.2L15 10l-5.2 1.8L8 17l-1.8-5.2L1 10l5.2-1.8z" fill="var(--text-muted)"/>'
        + '<path d="M18 10l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="var(--text-muted)"/>';
      break;
    default:
      // Generic circle for unknown tools
      inner = '<circle cx="12" cy="12" r="4" fill="var(--text-muted)"/>';
      break;
  }
  return '<svg x="' + x + '" y="' + y + '" width="12" height="12" viewBox="0 0 24 24">' + inner + '</svg>';
}

function orchEdNormalizeRunStatus(status) {
  var normalized = typeof status === 'string' ? status.toLowerCase().trim() : '';
  return DAG_ALLOWED_RUN_STATUSES[normalized] ? normalized : '';
}

// ── Coordinate Transform ──────────────────────────────────

function orchEdScreenToSvg(clientX, clientY) {
  var rect = dagEditor._cachedSvgRect || dagEditor.svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - dagEditor.translateX) / dagEditor.scale,
    y: (clientY - rect.top - dagEditor.translateY) / dagEditor.scale
  };
}

// ── Lifecycle ─────────────────────────────────────────────

function orchEditorInit(containerId) {
  var container = document.getElementById(containerId);
  if (!container || !orchCurrent) return;

  if (dagEditor) orchEditorDestroy();

  container.innerHTML = '';
  container.classList.add('dag-editor-container');

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'dag-editor-svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.minHeight = '450px';
  svg.style.display = 'block';

  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<marker id="dag-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--dag-edge-stroke)" /></marker>'
    + '<marker id="dag-arrowhead-accent" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--accent)" /></marker>'
    + '<pattern id="dag-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.7" fill="var(--dag-grid-dot)" opacity="0.6" /></pattern>';
  svg.appendChild(defs);

  var viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  viewport.setAttribute('class', 'dag-viewport');
  svg.appendChild(viewport);

  container.appendChild(svg);

  // Minimap container
  var minimap = document.createElement('div');
  minimap.className = 'dag-minimap';
  minimap.id = 'dag-minimap';
  container.appendChild(minimap);

  // Build node positions from data
  var nodes = orchCurrent.nodes || [];
  var positions = {};
  var allZero = true;
  for (var i = 0; i < nodes.length; i++) {
    positions[nodes[i].id] = { x: nodes[i].positionX || 0, y: nodes[i].positionY || 0 };
    if (nodes[i].positionX !== 0 || nodes[i].positionY !== 0) allZero = false;
  }

  dagEditor = {
    svg: svg,
    viewport: viewport,
    container: container,
    scale: 1,
    translateX: 20,
    translateY: 20,
    nodePositions: positions,
    selectedNodes: {},
    selectedEdge: null,
    dragging: null,
    panning: null,
    connecting: null,
    lasso: null,
    dirtyPositions: {},
    saveTimer: null,
    validationResult: null,
    validated: !!(orchCurrent && orchCurrent.dagValidated === true),
    runStatuses: {},
    _listeners: {}
  };

  if (allZero && nodes.length > 0) {
    orchEditorAutoLayout();
  }

  orchEditorBindEvents();
  dagUndoManager.restore(orchCurrent.id);
  orchEditorRender();
  orchEditorScheduleSaveAndValidate();
}

function orchEditorDestroy() {
  if (!dagEditor) return;
  orchEditorUnbindEvents();
  if (dagEditor.saveTimer) { clearTimeout(dagEditor.saveTimer); dagEditor.saveTimer = null; }
  if (dagEditor._cullRenderTimer) { clearTimeout(dagEditor._cullRenderTimer); dagEditor._cullRenderTimer = null; }
  if (dagEditor._panMinimapTimer) { clearTimeout(dagEditor._panMinimapTimer); dagEditor._panMinimapTimer = null; }
  // Clean up drag state if destroyed mid-drag
  dagEditor.svg.classList.remove('dag-dragging');
  dagEditor._dragRafPending = false;
  orchEditorSavePositions();
  orchEditorHideContextMenu();
  orchEditorHideInlineEdit();
  if (dagEditor.container) dagEditor.container.classList.remove('dag-editor-container');
  dagUndoManager.save();
  dagEditor = null;
  dagFocusedNodeId = null;
}

// ── Events ────────────────────────────────────────────────

function orchEditorBindEvents() {
  var svg = dagEditor.svg;

  function onMouseDown(e) { orchEditorOnMouseDown(e); }
  function onMouseMove(e) { orchEditorOnMouseMove(e); }
  function onMouseUp(e) { orchEditorOnMouseUp(e); }
  function onWheel(e) { orchEditorOnWheel(e); }
  function onCtxMenu(e) { orchEditorOnContextMenu(e); }
  function onDblClick(e) { orchEditorOnDblClick(e); }
  function onKeyDown(e) { orchEditorOnKeyDown(e); }
  function onClickAway(e) { orchEditorOnClickAway(e); }

  svg.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', onCtxMenu);
  svg.addEventListener('dblclick', onDblClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onClickAway);

  dagEditor._listeners = {
    mousedown: onMouseDown, mousemove: onMouseMove, mouseup: onMouseUp,
    wheel: onWheel, contextmenu: onCtxMenu, dblclick: onDblClick,
    keydown: onKeyDown, clickaway: onClickAway
  };
}

function orchEditorUnbindEvents() {
  if (!dagEditor || !dagEditor._listeners) return;
  var svg = dagEditor.svg;
  var L = dagEditor._listeners;
  if (svg) {
    svg.removeEventListener('mousedown', L.mousedown);
    svg.removeEventListener('wheel', L.wheel);
    svg.removeEventListener('contextmenu', L.contextmenu);
    svg.removeEventListener('dblclick', L.dblclick);
  }
  document.removeEventListener('mousemove', L.mousemove);
  document.removeEventListener('mouseup', L.mouseup);
  document.removeEventListener('keydown', L.keydown);
  document.removeEventListener('mousedown', L.clickaway);
  if (L.minimapMouseMove) document.removeEventListener('mousemove', L.minimapMouseMove);
  if (L.minimapMouseUp) document.removeEventListener('mouseup', L.minimapMouseUp);
  if (L.minimapMouseDown) {
    var mm = document.getElementById('dag-minimap');
    if (mm) {
      mm.removeEventListener('mousedown', L.minimapMouseDown);
      mm.classList.remove('dragging');
    }
  }
}

// ── Rendering ─────────────────────────────────────────────

function orchEditorRender() {
  if (!dagEditor || !orchCurrent) return;
  // During active drag, skip full DOM rebuild to preserve cached element refs.
  // Transform-only updates in the RAF loop handle visuals; full render runs on mouseup.
  if (dagEditor.dragging) return;

  var vp = dagEditor.viewport;
  vp.setAttribute('transform', 'translate(' + dagEditor.translateX + ',' + dagEditor.translateY + ') scale(' + dagEditor.scale + ')');

  var nodes = orchCurrent.nodes || [];
  var edges = orchCurrent.edges || [];
  var pos = dagEditor.nodePositions;
  var html = '';

  // Viewport culling: calculate visible area in SVG coordinates
  var _svgRect = dagEditor.svg.getBoundingClientRect();
  var visMinX = -dagEditor.translateX / dagEditor.scale - DAG_CULL_MARGIN;
  var visMinY = -dagEditor.translateY / dagEditor.scale - DAG_CULL_MARGIN;
  var visMaxX = visMinX + _svgRect.width / dagEditor.scale + DAG_CULL_MARGIN * 2;
  var visMaxY = visMinY + _svgRect.height / dagEditor.scale + DAG_CULL_MARGIN * 2;

  // Build node lookup + incoming-edge set (for start-node detection)
  var nodeMap = {};
  for (var mi = 0; mi < nodes.length; mi++) nodeMap[nodes[mi].id] = nodes[mi];
  var hasIncoming = {};
  var outEdgesByPort = {};
  var hasOutgoing = {};
  for (var _ei = 0; _ei < edges.length; _ei++) {
    hasIncoming[edges[_ei].toNodeId] = true;
    var _fromId = edges[_ei].fromNodeId;
    if (!outEdgesByPort[_fromId]) outEdgesByPort[_fromId] = {};
    outEdgesByPort[_fromId][edges[_ei].conditionValue || ''] = true;
    hasOutgoing[_fromId] = true;
  }

  // Determine the single start node (lowest sortOrder task with no incoming edges)
  var startNodeId = orchFindStartNodeId(nodes, hasIncoming);
  dagEditor.startNodeId = startNodeId;

  // Canvas background + grid dots
  html += '<rect width="10000" height="10000" x="-2000" y="-2000" fill="var(--dag-canvas-bg)" />';
  html += '<rect width="10000" height="10000" x="-2000" y="-2000" fill="url(#dag-grid)" />';

  // Edges
  for (var ei = 0; ei < edges.length; ei++) {
    var edge = edges[ei];
    var fp = pos[edge.fromNodeId];
    var tp = pos[edge.toNodeId];
    if (!fp || !tp) continue;

    var fromNode = nodeMap[edge.fromNodeId];
    var toNode = nodeMap[edge.toNodeId];
    if (!fromNode || !toNode) continue;

    // Get output port position based on conditionValue
    var outPort = orchEdGetOutputPortPos(fromNode, fp, edge.conditionValue);
    var toH = orchEdNodeHeight(toNode);
    var x1 = outPort.x;
    var y1 = outPort.y;
    var x2 = tp.x;
    var y2 = tp.y + toH / 2;

    // Viewport culling: skip edges where both endpoints are outside on same side
    if (x1 < visMinX && x2 < visMinX) continue;
    if (x1 > visMaxX && x2 > visMaxX) continue;
    if (y1 < visMinY && y2 < visMinY) continue;
    if (y1 > visMaxY && y2 > visMaxY) continue;

    var pathD;
    if (x2 < x1 - 20) {
      // Backward edge: route around with two Bézier segments
      var backOff = Math.max(50, Math.abs(x1 - x2) * 0.3);
      var goBelow = y2 >= y1;
      var loopY = goBelow ? Math.max(y1, y2) + 50 : Math.min(y1, y2) - 50;
      var midX = (x1 + x2) / 2;
      pathD = 'M' + x1 + ',' + y1
        + ' C' + (x1 + backOff) + ',' + y1 + ' ' + (x1 + backOff) + ',' + loopY + ' ' + midX + ',' + loopY
        + ' C' + (x2 - backOff) + ',' + loopY + ' ' + (x2 - backOff) + ',' + y2 + ' ' + x2 + ',' + y2;
    } else {
      var dx = Math.abs(x2 - x1) * 0.5;
      pathD = 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
    }

    var isSelected = dagEditor.selectedEdge === edge.id;
    var hasError = orchEditorEdgeHasError(edge.id);
    var edgeCls = 'dag-edge' + (isSelected ? ' selected' : '') + (hasError ? ' has-error' : '');
    var strokeColor = hasError ? 'var(--dag-error-stroke)' : (isSelected ? 'var(--accent)' : 'var(--dag-edge-stroke)');
    var sw = isSelected ? 2.5 : 1.5;
    var marker = isSelected ? 'url(#dag-arrowhead-accent)' : 'url(#dag-arrowhead)';

    var safeEdgeId = escapeHtml(edge.id);
    html += '<g class="' + edgeCls + '" data-edge-id="' + safeEdgeId + '">';
    html += '<path class="dag-edge-hit" d="' + pathD + '" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke" style="cursor:pointer" />';
    html += '<path class="dag-edge-visible" d="' + pathD + '" fill="none" stroke="' + strokeColor + '" stroke-width="' + sw + '" marker-end="' + marker + '" pointer-events="none" />';

    // Edge label
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2 - 6;
    var labelRaw = edge.conditionValue || '';
    if (fromNode.nodeType === 'gate') {
      if (labelRaw === 'pass') labelRaw = 'true';
      else if (labelRaw === 'fail') labelRaw = 'false';
    }
    var label = labelRaw ? escapeHtml(labelRaw) : '';
    if (label) {
      html += '<text class="dag-edge-label" x="' + mx + '" y="' + my + '" text-anchor="middle" data-edge-id="' + safeEdgeId + '">' + label + '</text>';
    }
    html += '</g>';
  }

  // Drag edge (connecting)
  if (dagEditor.connecting) {
    var conn = dagEditor.connecting;
    var fromP = pos[conn.fromNodeId];
    if (fromP) {
      var connNode = nodeMap[conn.fromNodeId];
      var connOut = connNode ? orchEdGetOutputPortPos(connNode, fromP, conn.returnValue) : { x: fromP.x + DAG_NODE_W, y: fromP.y + DAG_NODE_H / 2 };
      var cx1 = connOut.x;
      var cy1 = connOut.y;
      var cdx = Math.abs(conn.x - cx1) * 0.5;
      html += '<path class="dag-drag-edge" d="M' + cx1 + ',' + cy1 + ' C' + (cx1 + cdx) + ',' + cy1 + ' ' + (conn.x - cdx) + ',' + conn.y + ' ' + conn.x + ',' + conn.y + '" />';
    }
  }

  // Lasso selection rectangle
  if (dagEditor.lasso) {
    var lx = Math.min(dagEditor.lasso.startX, dagEditor.lasso.currentX);
    var ly = Math.min(dagEditor.lasso.startY, dagEditor.lasso.currentY);
    var lw = Math.abs(dagEditor.lasso.currentX - dagEditor.lasso.startX);
    var lh = Math.abs(dagEditor.lasso.currentY - dagEditor.lasso.startY);
    html += '<rect class="dag-lasso" x="' + lx + '" y="' + ly + '" width="' + lw + '" height="' + lh + '" />';
  }

  // Nodes
  for (var ni = 0; ni < nodes.length; ni++) {
    var node = nodes[ni];
    var np = pos[node.id];
    if (!np) continue;

    var h = orchEdNodeHeight(node);

    // Viewport culling: skip nodes outside visible bounds
    if (np.x + DAG_NODE_W < visMinX || np.x > visMaxX || np.y + h < visMinY || np.y > visMaxY) continue;

    var isEnd = node.nodeType === 'end';
    var isGate = node.nodeType === 'gate';
    var isTriggered = node.nodeType === 'triggered';
    var isStart = node.id === startNodeId;
    var isWebhookStart = isStart && orchTriggerMode === 'webhook';
    var isSel = !!dagEditor.selectedNodes[node.id];
    var nodeErrs = orchEditorNodeErrors(node.id);
    var nodeHasErr = nodeErrs.count > 0;
    var runStatus = dagEditor.runStatuses[node.id] || '';
    var allConnected = orchEdNodeAllPortsConnected(node, hasIncoming, outEdgesByPort, hasOutgoing, startNodeId);
    var typeClass = isEnd ? 'dag-node-end' : isGate ? 'dag-node-gate' : isTriggered ? 'dag-node-triggered' : isWebhookStart ? 'dag-node-webhook-start' : isStart ? 'dag-node-start' : 'dag-node-task';
    var isFocused = dagFocusedNodeId === node.id;
    var nodeCls = 'dag-node ' + typeClass + (isSel ? ' selected' : '') + (isFocused ? ' focused' : '') + (nodeHasErr ? ' has-error' : '') + (!allConnected ? ' ports-disconnected' : '') + (runStatus ? ' status-' + runStatus : '') + (isEnd ? ' end-node' : '');
    var safeNodeId = escapeHtml(node.id);

    // 5.1 A11y: build aria-label with type, label, tool, status, agent, retries, and errors
    var ariaType = isEnd ? 'End' : isGate ? 'Gate' : isTriggered ? 'Triggered' : isWebhookStart ? 'Webhook Start' : isStart ? 'Start' : 'Task';
    var ariaLabel = ariaType + ' node: ' + (node.label || 'unnamed');
    if (node.tool) ariaLabel += ', tool: ' + node.tool;
    if (node._agentName) ariaLabel += ', agent: ' + node._agentName;
    if (runStatus) ariaLabel += ', status: ' + runStatus;
    if (node.maxRetries > 0) ariaLabel += ', max retries: ' + node.maxRetries;
    if (nodeHasErr) ariaLabel += ', ' + nodeErrs.count + ' error' + (nodeErrs.count > 1 ? 's' : '');

    html += '<g class="' + nodeCls + '" data-node-id="' + safeNodeId + '" transform="translate(' + np.x + ',' + np.y + ')" role="button" tabindex="0" aria-label="' + escapeHtml(ariaLabel) + '">';

    // Node body — color by type via CSS custom properties for dark mode support.
    // Disconnected ports → error stroke is also applied here.
    var sw = isSel ? 2.5 : 1.5;
    var errStroke = 'var(--dag-error-stroke)';
    if (isEnd) {
      var endStroke = !allConnected ? errStroke : 'var(--dag-node-end-stroke)';
      html += '<rect width="' + DAG_NODE_W + '" height="' + h + '" rx="10" style="fill:var(--dag-node-end-fill);stroke:' + endStroke + ';stroke-width:2.5" />';
      html += '<rect x="4" y="4" width="' + (DAG_NODE_W - 8) + '" height="' + (h - 8) + '" rx="7" style="fill:none;stroke:' + endStroke + ';stroke-width:1" />';
    } else if (isGate) {
      var gInset = 18;
      var pts = gInset + ',0 ' + (DAG_NODE_W - gInset) + ',0 ' + DAG_NODE_W + ',' + (h / 2) + ' ' + (DAG_NODE_W - gInset) + ',' + h + ' ' + gInset + ',' + h + ' 0,' + (h / 2);
      var gateStroke = !allConnected ? errStroke : (isSel ? 'var(--dag-node-gate-stroke-sel)' : 'var(--dag-node-gate-stroke)');
      html += '<polygon points="' + pts + '" ';
      html += 'style="fill:var(--dag-node-gate-fill);stroke:' + gateStroke + ';stroke-width:' + sw + '" />';
    } else if (isWebhookStart) {
      var whStroke = !allConnected ? errStroke : (isSel ? 'var(--dag-node-webhook-stroke-sel)' : 'var(--dag-node-webhook-stroke)');
      html += '<rect width="' + DAG_NODE_W + '" height="' + h + '" rx="10" style="fill:var(--dag-node-webhook-fill);stroke:' + whStroke + ';stroke-width:' + sw + '" />';
      html += '<rect x="0" y="6" width="4" height="' + (h - 12) + '" rx="2" style="fill:' + (allConnected ? 'var(--dag-node-webhook-stroke)' : errStroke) + '" />';
      html += '<g transform="translate(' + (DAG_NODE_W - 22) + ',6)" opacity="0.5"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dag-node-webhook-stroke)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></g>';
    } else if (isStart) {
      var startStroke = !allConnected ? errStroke : (isSel ? 'var(--dag-node-start-stroke-sel)' : 'var(--dag-node-start-stroke)');
      html += '<rect width="' + DAG_NODE_W + '" height="' + h + '" rx="10" style="fill:var(--dag-node-start-fill);stroke:' + startStroke + ';stroke-width:' + sw + '" />';
      html += '<rect x="0" y="6" width="4" height="' + (h - 12) + '" rx="2" style="fill:' + (allConnected ? 'var(--dag-node-start-stroke)' : errStroke) + '" />';
    } else if (isTriggered) {
      var trigStroke = !allConnected ? errStroke : (isSel ? 'var(--dag-node-triggered-stroke-sel)' : 'var(--dag-node-triggered-stroke)');
      html += '<rect width="' + DAG_NODE_W + '" height="' + h + '" rx="10" style="fill:var(--dag-node-triggered-fill);stroke:' + trigStroke + ';stroke-width:' + sw + '" />';
      html += '<rect x="0" y="6" width="4" height="' + (h - 12) + '" rx="2" style="fill:' + (allConnected ? 'var(--dag-node-triggered-stroke)' : errStroke) + '" />';
    } else {
      var taskStroke = !allConnected ? errStroke : (isSel ? 'var(--dag-node-task-stroke-sel)' : 'var(--dag-node-task-stroke)');
      html += '<rect width="' + DAG_NODE_W + '" height="' + h + '" rx="10" style="fill:var(--dag-node-task-fill);stroke:' + taskStroke + ';stroke-width:' + sw + '" />';
      html += '<rect x="0" y="6" width="4" height="' + (h - 12) + '" rx="2" style="fill:' + (allConnected ? 'var(--dag-node-task-stroke)' : errStroke) + '" />';
    }

    // Label
    var effRV = orchEdEffectiveReturnValues(node);
    var hasPorts = effRV && effRV.length > 1;
    var labelX, labelY, labelAnchor;
    if (isGate) {
      // Gate: center text in diamond
      labelX = DAG_NODE_W / 2;
      labelY = h / 2 - 7;
      labelAnchor = 'middle';
    } else if (isEnd) {
      labelX = DAG_NODE_W / 2;
      labelY = h / 2 - 7;
      labelAnchor = 'middle';
    } else {
      labelX = isTriggered ? 28 : 14;
      labelY = hasPorts ? 18 : (h / 2 - 2);
      labelAnchor = 'start';
    }
    var fullLabel = node.label || '';
    html += '<text class="dag-label" x="' + labelX + '" y="' + labelY + '" text-anchor="' + labelAnchor + '" dominant-baseline="middle">' + escapeHtml(fullLabel.substring(0, 16)) + (fullLabel.length > 16 ? '<title>' + escapeHtml(fullLabel) + '</title>' : '') + '</text>';

    // Sublabel (agent badge or tool name / node type)
    var subY = labelY + 15;
    if (!isEnd) {
      if (node.agentId && node._agentName) {
        // Agent badge: Feather user SVG icon (12x12) + agent name + tool
        var agentLabel = node._agentName.length > 18 ? node._agentName.substring(0, 18) + '..' : node._agentName;
        html += '<svg x="' + labelX + '" y="' + (subY - 6) + '" width="12" height="12" viewBox="0 0 24 24" fill="none"'
          + ' stroke="var(--text-muted)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>'
          + '<circle cx="12" cy="7" r="4"/></svg>';
        html += '<text class="dag-sublabel" x="' + (labelX + 15) + '" y="' + subY + '" text-anchor="' + labelAnchor + '" dominant-baseline="middle">'
          + escapeHtml(agentLabel) + ' \\u00b7 ' + escapeHtml(node.tool || '')
          + '<title>' + escapeHtml(node._agentName) + '</title></text>';
      } else {
        var sub = isGate
          ? (node.gateCondition && node.gateCondition.mode ? node.gateCondition.mode : 'gate')
          : isTriggered
            ? ('triggered' + (node.tool ? ' \\u00b7 ' + node.tool : ''))
            : isWebhookStart
              ? ('webhook \\u00b7 ' + (node.tool || 'claude'))
              : (node.tool ? node.tool : node.nodeType);
        if (node.tool && !isGate) {
          html += orchEdToolIconSvg(node.tool, labelX, subY - 6);
          html += '<text class="dag-sublabel" x="' + (labelX + 15) + '" y="' + subY + '" text-anchor="' + labelAnchor + '" dominant-baseline="middle">' + escapeHtml(sub) + '</text>';
        } else {
          html += '<text class="dag-sublabel" x="' + labelX + '" y="' + subY + '" text-anchor="' + labelAnchor + '" dominant-baseline="middle">' + escapeHtml(sub) + '</text>';
        }
      }
    } else {
      html += '<text class="dag-sublabel" x="' + labelX + '" y="' + subY + '" text-anchor="' + labelAnchor + '" dominant-baseline="middle">END</text>';
    }

    // Input port (left center) — skip for Start node (no incoming edges)
    if (!isStart && !isTriggered) {
      var portInCls = 'dag-port-in';
      if (dagEditor.connecting && dagEditor.connecting.fromNodeId !== node.id) portInCls += ' connectable';
      html += '<circle class="' + portInCls + '" cx="0" cy="' + (h / 2) + '" r="' + DAG_PORT_R + '" data-node-id="' + safeNodeId + '" />';
    } else if (isTriggered && dagEditor.connecting && dagEditor.connecting.fromNodeId !== node.id) {
      // Triggered nodes accept connections via body click but have no persistent input port —
      // show a connectable indicator during connection drag so users can see it is a valid target
      html += '<circle class="dag-port-in connectable" cx="0" cy="' + (h / 2) + '" r="' + DAG_PORT_R + '" data-node-id="' + safeNodeId + '" style="opacity:0.7" />';
    }

    // Output ports (right side, per returnValue)
    if (effRV && effRV.length > 0 && !isEnd) {
      var portSpacing = h / (effRV.length + 1);
      for (var p = 0; p < effRV.length; p++) {
        var py = portSpacing * (p + 1);
        var rv = effRV[p];
        var portColor = orchEdPortColor(node, isStart, rv);
        var portLabel = orchEdDisplayPortLabel(node, rv);
        // Label inside node (right-aligned to the left of the port)
        html += '<text class="dag-port-label-inner" x="' + (DAG_NODE_W - 10) + '" y="' + (py + 1) + '" text-anchor="end" dominant-baseline="middle" fill="' + portColor + '">' + escapeHtml(portLabel) + '<title>' + escapeHtml(rv) + '</title></text>';
        // Port circle
        html += '<circle class="dag-port-out" cx="' + DAG_NODE_W + '" cy="' + py + '" r="' + DAG_PORT_R + '" data-node-id="' + safeNodeId + '" data-return-value="' + escapeHtml(rv) + '" style="stroke:' + portColor + ';" />';
      }
    } else if (!isEnd) {
      // No returnValues defined: single unconditional output port
      html += '<circle class="dag-port-out" cx="' + DAG_NODE_W + '" cy="' + (h / 2) + '" r="' + DAG_PORT_R + '" data-node-id="' + safeNodeId + '" data-return-value="" />';
    }
    // End nodes: no output ports

    // Error badge (top-right)
    if (nodeHasErr) {
      var errCnt = nodeErrs.count;
      var errMsgs = nodeErrs.messages;
      var errBadgeX = DAG_NODE_W - 6;
      var errBadgeY = -6;
      html += '<circle cx="' + errBadgeX + '" cy="' + errBadgeY + '" r="9" fill="var(--dag-error-stroke)" stroke="var(--dag-canvas-bg)" stroke-width="1.5" />';
      html += '<text x="' + errBadgeX + '" y="' + (errBadgeY + 1) + '" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="12" font-weight="700">' + errCnt + '<title>' + escapeHtml(errMsgs.join('\\n')) + '</title></text>';
    }

    // Retry badge (top-right inside node, offset from error badge)
    if (node.maxRetries > 0 && !isEnd) {
      var retryX = DAG_NODE_W - (nodeHasErr ? 24 : 14);
      html += '<g transform="translate(' + retryX + ',10)"><rect x="-14" y="-8" width="28" height="16" rx="4" fill="rgba(100,100,100,0.12)" />'
        + '<text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="var(--text-muted)" font-weight="600">\\u21BB' + node.maxRetries + '</text></g>';
    }

    // Run status icon (bottom-right)
    if (runStatus && !isEnd) {
      var sX = DAG_NODE_W - 14;
      var sY = h - 12;
      html += '<g transform="translate(' + sX + ',' + sY + ')" aria-hidden="true">';
      if (runStatus === 'completed') {
        html += '<circle r="7" fill="rgba(22,163,74,0.15)" />';
        html += '<polyline points="-3,0 -1,3 4,-3" fill="none" stroke="var(--status-completed)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />';
      } else if (runStatus === 'failed') {
        html += '<circle r="7" fill="rgba(220,38,38,0.12)" />';
        html += '<line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke="var(--status-failed)" stroke-width="1.5" stroke-linecap="round" />';
        html += '<line x1="2.5" y1="-2.5" x2="-2.5" y2="2.5" stroke="var(--status-failed)" stroke-width="1.5" stroke-linecap="round" />';
      } else if (runStatus === 'running') {
        html += '<circle r="4" fill="var(--status-running)" opacity="0.8"><animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" /></circle>';
      } else if (runStatus === 'pending' || runStatus === 'waiting') {
        html += '<circle r="6" fill="none" stroke="var(--status-pending)" stroke-width="1.2" />';
        html += '<line x1="0" y1="0" x2="0" y2="-3" stroke="var(--status-pending)" stroke-width="1.2" stroke-linecap="round" />';
        html += '<line x1="0" y1="0" x2="2.5" y2="0" stroke="var(--status-pending)" stroke-width="1.2" stroke-linecap="round" />';
        html += '<circle r="0.8" fill="var(--status-pending)" />';
      } else if (runStatus === 'skipped') {
        html += '<polyline points="-3,-3 3,0 -3,3" fill="none" stroke="var(--status-timeout)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />';
      }
      html += '</g>';
    }

    html += '</g>';
  }

  vp.innerHTML = html;

  // 5.3 A11y: restore DOM focus on the focused node after innerHTML rebuild
  if (dagFocusedNodeId) {
    var focusEl = vp.querySelector('[data-node-id="' + dagFocusedNodeId + '"]');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  // Update zoom display
  var zoomEl = document.getElementById('orch-zoom-level');
  if (zoomEl) zoomEl.textContent = Math.round(dagEditor.scale * 100) + '%';

  orchEditorRenderMinimap();
  orchEditorRenderValidationBar();
}

// ── Validation Bar ─────────────────────────────────────────

function orchEditorRenderValidationBar() {
  var bar = document.getElementById('orch-validation-bar');
  if (!bar || !dagEditor) return;

  var vr = dagEditor.validationResult;
  var logEl = document.getElementById('orch-error-log');

  if (!vr) {
    bar.innerHTML = '';
    if (logEl) logEl.style.display = 'none';
    return;
  }

  var nodeCount = orchCurrent ? (orchCurrent.nodes || []).length : 0;
  var edgeCount = orchCurrent ? (orchCurrent.edges || []).length : 0;

  // Compute DAG depth and max parallelism via topological layering
  var dagDepth = 0, dagParallelism = 0;
  if (orchCurrent && nodeCount > 0) {
    var _sNodes = orchCurrent.nodes || [];
    var _sEdges = orchCurrent.edges || [];
    var _sInDeg = {}, _sAdj = {};
    for (var _si = 0; _si < _sNodes.length; _si++) {
      _sInDeg[_sNodes[_si].id] = 0; _sAdj[_sNodes[_si].id] = [];
    }
    for (var _sj = 0; _sj < _sEdges.length; _sj++) {
      if (!_sAdj[_sEdges[_sj].fromNodeId]) _sAdj[_sEdges[_sj].fromNodeId] = [];
      _sAdj[_sEdges[_sj].fromNodeId].push(_sEdges[_sj].toNodeId);
      _sInDeg[_sEdges[_sj].toNodeId] = (_sInDeg[_sEdges[_sj].toNodeId] || 0) + 1;
    }
    var _sLayers = [], _sQueue = [], _sLayerOf = {};
    for (var _sk in _sInDeg) {
      if (_sInDeg[_sk] === 0) { _sQueue.push(_sk); _sLayerOf[_sk] = 0; }
    }
    while (_sQueue.length > 0) {
      var _sCur = _sQueue.shift();
      var _sLayer = _sLayerOf[_sCur] || 0;
      if (!_sLayers[_sLayer]) _sLayers[_sLayer] = 0;
      _sLayers[_sLayer]++;
      var _sNb = _sAdj[_sCur] || [];
      for (var _sn = 0; _sn < _sNb.length; _sn++) {
        _sInDeg[_sNb[_sn]]--;
        _sLayerOf[_sNb[_sn]] = Math.max(_sLayerOf[_sNb[_sn]] || 0, _sLayer + 1);
        if (_sInDeg[_sNb[_sn]] === 0) _sQueue.push(_sNb[_sn]);
      }
    }
    dagDepth = _sLayers.length;
    for (var _sl = 0; _sl < _sLayers.length; _sl++) {
      if (_sLayers[_sl] > dagParallelism) dagParallelism = _sLayers[_sl];
    }
  }

  var statsHtml = '<span class="vbar-stats">' + nodeCount + ' nodes \\u00b7 ' + edgeCount + ' edges \\u00b7 depth ' + dagDepth + ' \\u00b7 parallelism ' + dagParallelism + '</span>';

  if (vr.valid !== false && (!vr.errors || vr.errors.length === 0)) {
    var validHtml = '<span class="vbar-ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><polyline points="20 6 9 17 4 12"/></svg> Valid</span> ' + statsHtml;
    if (vr.warnings && vr.warnings.length > 0) {
      for (var w = 0; w < vr.warnings.length; w++) {
        validHtml += ' <span class="vbar-warn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + escapeHtml(typeof vr.warnings[w] === 'string' ? vr.warnings[w] : (vr.warnings[w].message || '')) + '</span>';
      }
    }
    bar.innerHTML = validHtml;
    if (logEl) logEl.style.display = 'none';
  } else {
    var errCount = vr.errors ? vr.errors.length : 0;
    bar.innerHTML = '<span class="vbar-err"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> <span class="vbar-err-count" onclick="orchScrollToErrorLog()" title="Click to view details">' + errCount + ' error' + (errCount !== 1 ? 's' : '') + '</span></span> ' + statsHtml;
    orchRenderErrorLog(vr.errors || []);
  }
}

function orchRenderErrorLog(errors) {
  var el = document.getElementById('orch-error-log');
  if (!el) return;
  if (!errors || errors.length === 0) { el.style.display = 'none'; return; }

  var html = '<div class="orch-error-log-header">';
  html += '<div class="orch-error-log-title-wrap">';
  html += '<span class="orch-error-log-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></span>';
  html += '<h4 class="orch-error-log-title">Validation Errors<span class="orch-error-log-badge">' + errors.length + '</span></h4>';
  html += '</div>';
  html += '<button class="orch-error-log-dismiss" onclick="document.getElementById(\\'orch-error-log\\').style.display=\\'none\\'">Dismiss</button>';
  html += '</div>';
  html += '<div class="orch-error-log-body">';
  for (var i = 0; i < errors.length; i++) {
    var msg = typeof errors[i] === 'string' ? errors[i] : (errors[i].message || '');
    html += '<div class="orch-error-log-item"><span class="orch-error-log-item-dot"></span><span class="orch-error-log-item-text">' + escapeHtml(msg) + '</span></div>';
  }
  html += '</div>';

  el.innerHTML = html;
  el.style.display = '';
}

function orchScrollToErrorLog() {
  var el = document.getElementById('orch-error-log');
  if (el) { el.style.display = ''; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

// Single-pass node error collection: returns { count, messages }
function orchEditorNodeErrors(nodeId) {
  if (!dagEditor || !dagEditor.validationResult) return { count: 0, messages: [] };
  var errors = dagEditor.validationResult.errors || [];
  var count = 0, msgs = [];
  for (var i = 0; i < errors.length; i++) {
    var err = errors[i];
    if (typeof err === 'object' && err.nodeId === nodeId) {
      count++;
      msgs.push(err.message || err.code || 'Error');
    } else {
      // Fallback: string matching for unstructured errors
      var errStr = typeof err === 'string' ? err : (err.nodeId || err.message || '');
      if (errStr.indexOf(nodeId) !== -1) {
        count++;
        msgs.push(typeof err === 'string' ? err : (err.message || 'Error'));
      }
    }
  }
  return { count: count, messages: msgs };
}

function orchEditorNodeHasError(nodeId) {
  return orchEditorNodeErrors(nodeId).count > 0;
}

function orchEditorEdgeHasError(edgeId) {
  if (!dagEditor || !dagEditor.validationResult) return false;
  var errors = dagEditor.validationResult.errors || [];
  for (var i = 0; i < errors.length; i++) {
    var err = errors[i];
    // Structured check first (exact match)
    if (typeof err === 'object' && err.edgeId === edgeId) return true;
    // Fallback: string matching for unstructured errors
    var errStr = typeof err === 'string' ? err : (err.message || '');
    if (errStr.indexOf(edgeId) !== -1) return true;
  }
  return false;
}

// ── Minimap ───────────────────────────────────────────────

function orchEditorRenderMinimap() {
  var mm = document.getElementById('dag-minimap');
  if (!mm || !dagEditor || !orchCurrent) return;

  var nodes = orchCurrent.nodes || [];
  var pos = dagEditor.nodePositions;
  if (nodes.length === 0) { mm.innerHTML = ''; return; }

  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var p = pos[nodes[i].id];
    if (!p) continue;
    var nh = orchEdNodeHeight(nodes[i]);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + DAG_NODE_W > maxX) maxX = p.x + DAG_NODE_W;
    if (p.y + nh > maxY) maxY = p.y + nh;
  }

  var pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  var dw = maxX - minX || 1;
  var dh = maxY - minY || 1;
  var mmW = 160, mmH = 100;
  var scale = Math.min(mmW / dw, mmH / dh);

  var svg = '<svg width="' + mmW + '" height="' + mmH + '" xmlns="http://www.w3.org/2000/svg">';

  for (var j = 0; j < nodes.length; j++) {
    var np = pos[nodes[j].id];
    if (!np) continue;
    var nx = (np.x - minX) * scale;
    var ny = (np.y - minY) * scale;
    var nw = DAG_NODE_W * scale;
    var mnh = orchEdNodeHeight(nodes[j]) * scale;
    var runSt = dagEditor.runStatuses[nodes[j].id] || '';
    var fill = runSt === 'completed' ? '#22c55e' : runSt === 'failed' ? '#ef4444' : runSt === 'running' ? '#3b82f6' : 'var(--text-secondary)';
    svg += '<rect x="' + nx + '" y="' + ny + '" width="' + nw + '" height="' + mnh + '" rx="1" fill="' + fill + '" opacity="0.6" />';
  }

  var svgRect = dagEditor.svg.getBoundingClientRect();
  var vpX = (-dagEditor.translateX / dagEditor.scale - minX) * scale;
  var vpY = (-dagEditor.translateY / dagEditor.scale - minY) * scale;
  var vpW = (svgRect.width / dagEditor.scale) * scale;
  var vpH = (svgRect.height / dagEditor.scale) * scale;
  svg += '<rect class="dag-minimap-viewport" x="' + vpX + '" y="' + vpY + '" width="' + vpW + '" height="' + vpH + '" />';

  svg += '</svg>';
  mm.innerHTML = svg;
  mm._bounds = { minX: minX, minY: minY, dw: dw, dh: dh, scale: scale, width: mmW, height: mmH };
}

// ── Performance: Transform-Only Drag ──────────────────────

function orchEditorCacheDragElements() {
  if (!dagEditor || !dagEditor.dragging) return;
  dagEditor._dragNodeEls = {};
  dagEditor._dragEdgeEls = {};

  var selectedIds = Object.keys(dagEditor.selectedNodes);
  if (selectedIds.length === 0) selectedIds = [dagEditor.dragging.nodeId];
  var selectedSet = {};
  for (var si = 0; si < selectedIds.length; si++) selectedSet[selectedIds[si]] = true;

  // Cache node <g> elements
  var nodeGs = dagEditor.viewport.querySelectorAll('g.dag-node');
  for (var ni = 0; ni < nodeGs.length; ni++) {
    var nid = nodeGs[ni].getAttribute('data-node-id');
    if (selectedSet[nid]) dagEditor._dragNodeEls[nid] = nodeGs[ni];
  }

  // Cache edge elements connected to selected nodes
  var edges = orchCurrent ? orchCurrent.edges || [] : [];
  var nodeMap = {};
  var allNodes = orchCurrent ? orchCurrent.nodes || [] : [];
  for (var mi = 0; mi < allNodes.length; mi++) nodeMap[allNodes[mi].id] = allNodes[mi];

  for (var ei = 0; ei < edges.length; ei++) {
    var edge = edges[ei];
    if (selectedSet[edge.fromNodeId] || selectedSet[edge.toNodeId]) {
      var edgeG = dagEditor.viewport.querySelector('g[data-edge-id="' + edge.id + '"]');
      if (edgeG) {
        dagEditor._dragEdgeEls[edge.id] = {
          hit: edgeG.querySelector('.dag-edge-hit'),
          visible: edgeG.querySelector('.dag-edge-visible'),
          label: edgeG.querySelector('.dag-edge-label'),
          edge: edge
        };
      }
    }
  }
  dagEditor._dragNodeMap = nodeMap;
}

// Fast path: transform + edge path updates only (no overlap detection)
function orchEditorUpdateDragVisualsTransformOnly() {
  if (!dagEditor) return;
  var pos = dagEditor.nodePositions;
  var nodeMap = dagEditor._dragNodeMap || {};

  // Update node transforms
  var dragNodes = dagEditor._dragNodeEls;
  if (dragNodes) {
    for (var nid in dragNodes) {
      var np = pos[nid];
      if (np) dragNodes[nid].setAttribute('transform', 'translate(' + np.x + ',' + np.y + ')');
    }
  }

  // Update edge paths
  var dragEdges = dagEditor._dragEdgeEls;
  if (dragEdges) {
    for (var eid in dragEdges) {
      var cached = dragEdges[eid];
      var edge = cached.edge;
      var fp = pos[edge.fromNodeId];
      var tp = pos[edge.toNodeId];
      if (!fp || !tp) continue;

      var fromNode = nodeMap[edge.fromNodeId];
      var toNode = nodeMap[edge.toNodeId];
      if (!fromNode || !toNode) continue;

      var outPort = orchEdGetOutputPortPos(fromNode, fp, edge.conditionValue);
      var toH = orchEdNodeHeight(toNode);
      var x1 = outPort.x, y1 = outPort.y;
      var x2 = tp.x, y2 = tp.y + toH / 2;
      var pathD;
      if (x2 < x1 - 20) {
        var backOff = Math.max(50, Math.abs(x1 - x2) * 0.3);
        var goBelow = y2 >= y1;
        var loopY = goBelow ? Math.max(y1, y2) + 50 : Math.min(y1, y2) - 50;
        var midX = (x1 + x2) / 2;
        pathD = 'M' + x1 + ',' + y1
          + ' C' + (x1 + backOff) + ',' + y1 + ' ' + (x1 + backOff) + ',' + loopY + ' ' + midX + ',' + loopY
          + ' C' + (x2 - backOff) + ',' + loopY + ' ' + (x2 - backOff) + ',' + y2 + ' ' + x2 + ',' + y2;
      } else {
        var dx = Math.abs(x2 - x1) * 0.5;
        pathD = 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
      }

      if (cached.hit) cached.hit.setAttribute('d', pathD);
      if (cached.visible) cached.visible.setAttribute('d', pathD);
      if (cached.label) {
        cached.label.setAttribute('x', (x1 + x2) / 2);
        cached.label.setAttribute('y', (y1 + y2) / 2 - 6);
      }
    }
  }
}

// Throttled: overlap warning detection (O(n²), separated from hot path)
function orchEditorUpdateDragOverlap() {
  if (!dagEditor) return;
  var pos = dagEditor.nodePositions;
  var nodeMap = dagEditor._dragNodeMap || {};
  var dragNodes = dagEditor._dragNodeEls;

  if (dragNodes && orchCurrent) {
    var owAllNodes = orchCurrent.nodes || [];
    for (var owNid in dragNodes) {
      var owNp = pos[owNid];
      if (!owNp) continue;
      var owNode = nodeMap[owNid];
      if (!owNode) continue;
      var owH = orchEdNodeHeight(owNode);
      var owOverlap = false;
      for (var owi = 0; owi < owAllNodes.length; owi++) {
        var owOther = owAllNodes[owi];
        if (owOther.id === owNid || dagEditor.selectedNodes[owOther.id]) continue;
        var owOp = pos[owOther.id];
        if (!owOp) continue;
        var owOh = orchEdNodeHeight(owOther);
        if (owNp.x < owOp.x + DAG_NODE_W && owNp.x + DAG_NODE_W > owOp.x &&
            owNp.y < owOp.y + owOh && owNp.y + owH > owOp.y) {
          owOverlap = true;
          break;
        }
      }
      if (owOverlap) dragNodes[owNid].classList.add('overlap-warning');
      else dragNodes[owNid].classList.remove('overlap-warning');
    }
  }
}

// Combined: full drag visual update (used by mouseup final sync)
function orchEditorUpdateDragVisuals() {
  orchEditorUpdateDragVisualsTransformOnly();
  orchEditorUpdateDragOverlap();
}

function orchEditorUpdateConnectingVisual() {
  if (!dagEditor || !dagEditor.connecting) return;
  var conn = dagEditor.connecting;
  var fromP = dagEditor.nodePositions[conn.fromNodeId];
  if (!fromP) return;

  var dragEdge = dagEditor.viewport.querySelector('.dag-drag-edge');
  if (!dragEdge) { orchEditorRender(); return; }

  var nodes = orchCurrent ? orchCurrent.nodes || [] : [];
  var connNode = null;
  for (var ci = 0; ci < nodes.length; ci++) {
    if (nodes[ci].id === conn.fromNodeId) { connNode = nodes[ci]; break; }
  }
  var connOut = connNode ? orchEdGetOutputPortPos(connNode, fromP, conn.returnValue) : { x: fromP.x + DAG_NODE_W, y: fromP.y + DAG_NODE_H / 2 };
  var cx1 = connOut.x, cy1 = connOut.y;
  var cdx = Math.abs(conn.x - cx1) * 0.5;
  dragEdge.setAttribute('d', 'M' + cx1 + ',' + cy1 + ' C' + (cx1 + cdx) + ',' + cy1 + ' ' + (conn.x - cdx) + ',' + conn.y + ' ' + conn.x + ',' + conn.y);
}

// ── Mouse Interactions ────────────────────────────────────

function orchEditorFindTarget(e) {
  var el = e.target;
  while (el && el !== dagEditor.svg) {
    if (el.classList) {
      if (el.classList.contains('dag-port-out')) return { type: 'port-out', nodeId: el.getAttribute('data-node-id'), returnValue: el.getAttribute('data-return-value'), el: el };
      if (el.classList.contains('dag-port-in')) return { type: 'port-in', nodeId: el.getAttribute('data-node-id'), el: el };
      if (dagEditor && dagEditor.connecting && el.classList.contains('dag-node-triggered')) {
        return { type: 'port-in', nodeId: el.getAttribute('data-node-id'), el: el };
      }
      if (el.classList.contains('dag-node')) return { type: 'node', nodeId: el.getAttribute('data-node-id'), el: el };
      if (el.classList.contains('dag-edge')) return { type: 'edge', edgeId: el.getAttribute('data-edge-id'), el: el };
      if (el.classList.contains('dag-edge-label')) return { type: 'edge-label', edgeId: el.getAttribute('data-edge-id'), el: el };
    }
    el = el.parentElement;
  }
  return { type: 'background' };
}

function orchEditorOnMouseDown(e) {
  if (!dagEditor || e.button === 2) return;
  orchEditorHideContextMenu();

  var target = orchEditorFindTarget(e);

  if (target.type === 'port-out') {
    var portPos = orchEdScreenToSvg(e.clientX, e.clientY);
    dagEditor.connecting = {
      fromNodeId: target.nodeId,
      returnValue: target.returnValue || null,
      x: portPos.x, y: portPos.y
    };
    dagEditor._connectingRendered = false;
    e.preventDefault();
    return;
  }

  if (target.type === 'node') {
    var nodeId = target.nodeId;
    if (!e.shiftKey && !dagEditor.selectedNodes[nodeId]) {
      dagEditor.selectedNodes = {};
    }
    dagEditor.selectedNodes[nodeId] = true;
    dagEditor.selectedEdge = null;
    dagFocusedNodeId = nodeId;

    var svgP = orchEdScreenToSvg(e.clientX, e.clientY);
    var np = dagEditor.nodePositions[nodeId] || { x: 0, y: 0 };
    // Capture original positions for undo
    var origPos = {};
    var sKeys = Object.keys(dagEditor.selectedNodes);
    if (sKeys.length === 0) sKeys = [nodeId];
    for (var oi = 0; oi < sKeys.length; oi++) {
      var op = dagEditor.nodePositions[sKeys[oi]];
      if (op) origPos[sKeys[oi]] = { x: op.x, y: op.y };
    }
    e.preventDefault();
    // Flush pending save from prior drag (fire-and-forget) and cancel validate
    // to prevent orchEditorValidate → orchEditorRender firing mid-drag
    if (dagEditor.saveTimer) { clearTimeout(dagEditor.saveTimer); dagEditor.saveTimer = null; orchEditorSavePositions(); }
    // Render selection state BEFORE setting drag state (render guard skips during drag)
    orchEditorRender();
    dagEditor.dragging = {
      nodeId: nodeId,
      startX: svgP.x,
      startY: svgP.y,
      offsetX: svgP.x - np.x,
      offsetY: svgP.y - np.y,
      moved: false,
      originalPositions: origPos
    };
    dagEditor._dragRafPending = false;
    dagEditor._lastOverlapCheck = 0;
    // Cache SVG rect for coordinate conversion during drag (avoids repeated getBoundingClientRect)
    dagEditor._cachedSvgRect = dagEditor.svg.getBoundingClientRect();
    orchEditorCacheDragElements();
    // Disable CSS transitions during drag for smooth performance
    dagEditor.svg.classList.add('dag-dragging');
    return;
  }

  if (target.type === 'edge' || target.type === 'edge-label') {
    dagEditor.selectedNodes = {};
    dagEditor.selectedEdge = target.edgeId;
    dagFocusedNodeId = null;
    e.preventDefault();
    orchEditorRender();
    return;
  }

  // Background — Shift+drag = lasso (additive), plain drag = pan
  if (!e.shiftKey) dagEditor.selectedNodes = {};
  dagEditor.selectedEdge = null;
  dagFocusedNodeId = null;
  if (e.shiftKey) {
    var lassoStart = orchEdScreenToSvg(e.clientX, e.clientY);
    dagEditor.lasso = { startX: lassoStart.x, startY: lassoStart.y, currentX: lassoStart.x, currentY: lassoStart.y };
  } else {
    dagEditor.panning = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: dagEditor.translateX,
      startTy: dagEditor.translateY
    };
  }
  e.preventDefault();
  orchEditorRender();
}

function orchEditorOnMouseMove(e) {
  if (!dagEditor) return;

  if (dagEditor.connecting) {
    var p = orchEdScreenToSvg(e.clientX, e.clientY);
    dagEditor.connecting.x = p.x;
    dagEditor.connecting.y = p.y;
    if (!dagEditor._connectingRendered) {
      dagEditor._connectingRendered = true;
      orchEditorRender();
    } else {
      orchEditorUpdateConnectingVisual();
    }
    return;
  }

  if (dagEditor.dragging) {
    var svgP = orchEdScreenToSvg(e.clientX, e.clientY);
    dagEditor.dragging.moved = true;
    var selectedIds = Object.keys(dagEditor.selectedNodes);

    if (selectedIds.length <= 1) {
      var nid = dagEditor.dragging.nodeId;
      dagEditor.nodePositions[nid] = {
        x: svgP.x - dagEditor.dragging.offsetX,
        y: svgP.y - dagEditor.dragging.offsetY
      };
    } else {
      // Use absolute delta from original positions to avoid floating-point drift
      var refOrig = dagEditor.dragging.originalPositions[dagEditor.dragging.nodeId];
      if (refOrig) {
        var absDx = (svgP.x - dagEditor.dragging.offsetX) - refOrig.x;
        var absDy = (svgP.y - dagEditor.dragging.offsetY) - refOrig.y;
        for (var i = 0; i < selectedIds.length; i++) {
          var orig = dagEditor.dragging.originalPositions[selectedIds[i]];
          if (orig) {
            dagEditor.nodePositions[selectedIds[i]] = { x: orig.x + absDx, y: orig.y + absDy };
          }
        }
      }
    }
    // Batch visual updates via requestAnimationFrame to avoid redundant paints
    if (!dagEditor._dragRafPending) {
      dagEditor._dragRafPending = true;
      requestAnimationFrame(function() {
        if (dagEditor) {
          dagEditor._dragRafPending = false;
          orchEditorUpdateDragVisualsTransformOnly();
          // Throttle overlap detection to ~100ms to avoid O(n²) per frame
          var now = performance.now();
          if (!dagEditor._lastOverlapCheck || now - dagEditor._lastOverlapCheck > 100) {
            dagEditor._lastOverlapCheck = now;
            orchEditorUpdateDragOverlap();
          }
        }
      });
    }
    return;
  }

  if (dagEditor.lasso) {
    var lp = orchEdScreenToSvg(e.clientX, e.clientY);
    dagEditor.lasso.currentX = lp.x;
    dagEditor.lasso.currentY = lp.y;
    orchEditorRender();
    return;
  }

  if (dagEditor.panning) {
    dagEditor.translateX = dagEditor.panning.startTx + (e.clientX - dagEditor.panning.startX);
    dagEditor.translateY = dagEditor.panning.startTy + (e.clientY - dagEditor.panning.startY);
    dagEditor.viewport.setAttribute('transform', 'translate(' + dagEditor.translateX + ',' + dagEditor.translateY + ') scale(' + dagEditor.scale + ')');
    // Debounce minimap rebuild during pan (expensive innerHTML rebuild)
    if (!dagEditor._panMinimapTimer) {
      dagEditor._panMinimapTimer = setTimeout(function() {
        dagEditor._panMinimapTimer = null;
        orchEditorRenderMinimap();
      }, 80);
    }
    orchEditorScheduleCullRender();
    return;
  }
}

function orchEditorOnMouseUp(e) {
  if (!dagEditor) return;

  if (dagEditor.connecting) {
    var target = orchEditorFindTarget(e);
    if (target.type === 'port-in' && target.nodeId !== dagEditor.connecting.fromNodeId) {
      orchEditorCreateEdge(dagEditor.connecting.fromNodeId, target.nodeId, dagEditor.connecting.returnValue);
    }
    dagEditor.connecting = null;
    orchEditorRender();
    return;
  }

  if (dagEditor.lasso) {
    // Compute selection from lasso rectangle
    var minLX = Math.min(dagEditor.lasso.startX, dagEditor.lasso.currentX);
    var minLY = Math.min(dagEditor.lasso.startY, dagEditor.lasso.currentY);
    var maxLX = Math.max(dagEditor.lasso.startX, dagEditor.lasso.currentX);
    var maxLY = Math.max(dagEditor.lasso.startY, dagEditor.lasso.currentY);
    var lassoNodes = orchCurrent ? orchCurrent.nodes || [] : [];
    for (var li = 0; li < lassoNodes.length; li++) {
      var lnp = dagEditor.nodePositions[lassoNodes[li].id];
      if (!lnp) continue;
      var lnh = orchEdNodeHeight(lassoNodes[li]);
      if (lnp.x + DAG_NODE_W > minLX && lnp.x < maxLX && lnp.y + lnh > minLY && lnp.y < maxLY) {
        dagEditor.selectedNodes[lassoNodes[li].id] = true;
      }
    }
    dagEditor.lasso = null;
    orchEditorRender();
    return;
  }

  if (dagEditor.dragging) {
    // Remove drag mode class to restore CSS transitions
    dagEditor.svg.classList.remove('dag-dragging');
    // Cancel any pending RAF to avoid stale updates after drag ends
    dagEditor._dragRafPending = false;
    dagEditor._cachedSvgRect = null;

    if (dagEditor.dragging.moved) {
      var selectedIds = Object.keys(dagEditor.selectedNodes);
      if (selectedIds.length === 0) selectedIds = [dagEditor.dragging.nodeId];
      // Snap using the dragged node as reference so relative positions are preserved
      var refP = dagEditor.nodePositions[dagEditor.dragging.nodeId];
      var snapDx = 0, snapDy = 0;
      if (refP) {
        snapDx = Math.round(refP.x / DAG_SNAP_GRID) * DAG_SNAP_GRID - refP.x;
        snapDy = Math.round(refP.y / DAG_SNAP_GRID) * DAG_SNAP_GRID - refP.y;
      }
      for (var i = 0; i < selectedIds.length; i++) {
        var np = dagEditor.nodePositions[selectedIds[i]];
        if (np) {
          np.x += snapDx;
          np.y += snapDy;
          dagEditor.dirtyPositions[selectedIds[i]] = true;
        }
      }
      // Collision detection: nudge overlapping nodes
      var selectedSet = {};
      for (var ci = 0; ci < selectedIds.length; ci++) selectedSet[selectedIds[ci]] = true;
      for (var ri = 0; ri < selectedIds.length; ri++) {
        orchEditorResolveOverlap(selectedIds[ri], selectedSet);
      }
      // Push MoveNodes undo command
      if (dagEditor.dragging.originalPositions) {
        var moves = [];
        for (var ui = 0; ui < selectedIds.length; ui++) {
          var origP = dagEditor.dragging.originalPositions[selectedIds[ui]];
          var newP = dagEditor.nodePositions[selectedIds[ui]];
          if (origP && newP && (origP.x !== newP.x || origP.y !== newP.y)) {
            moves.push({ nodeId: selectedIds[ui], oldX: origP.x, oldY: origP.y, newX: newP.x, newY: newP.y });
          }
        }
        if (moves.length > 0) {
          dagUndoManager.push(dagUndoCommandFromData('MoveNodes', { moves: moves }, 'Move ' + moves.length + ' node' + (moves.length > 1 ? 's' : '')));
        }
      }
      orchEditorScheduleSaveAndValidate();
      // Clear drag state BEFORE render so the render guard allows full rebuild
      dagEditor._dragNodeEls = null;
      dagEditor._dragEdgeEls = null;
      dagEditor._dragNodeMap = null;
      dagEditor.dragging = null;
      orchEditorRender();
    } else {
      // Click without move — open side panel
      var clickedId = dagEditor.dragging.nodeId;
      dagEditor._dragNodeEls = null;
      dagEditor._dragEdgeEls = null;
      dagEditor._dragNodeMap = null;
      dagEditor.dragging = null;
      if (typeof orchShowNodePanel === 'function') orchShowNodePanel(clickedId);
    }
    return;
  }

  if (dagEditor.panning) {
    dagEditor.panning = null;
    // Clear any pending minimap debounce so full render handles it
    if (dagEditor._panMinimapTimer) {
      clearTimeout(dagEditor._panMinimapTimer);
      dagEditor._panMinimapTimer = null;
    }
    orchEditorRender();
    return;
  }
}

function orchEditorOnWheel(e) {
  if (!dagEditor) return;
  e.preventDefault();

  // Normalize deltaY: trackpad pinch sends small fractional values,
  // mouse wheel sends large values (~100). Use proportional scaling
  // clamped to a reasonable range for smooth behavior on both inputs.
  var rawDelta = e.deltaY;
  // deltaMode 1 = lines (~40px each), deltaMode 2 = pages
  if (e.deltaMode === 1) rawDelta *= 40;
  else if (e.deltaMode === 2) rawDelta *= 800;
  // Scale factor: 0.003 gives ~0.3 per 100px of mouse wheel delta,
  // and ~0.01 per 3px of trackpad pinch — responsive for both.
  var zoomAmount = -rawDelta * 0.003 * dagEditor.scale;
  // Clamp max step to prevent huge jumps from mouse wheel
  zoomAmount = Math.max(-0.2, Math.min(0.2, zoomAmount));
  var newScale = Math.max(DAG_ZOOM_MIN, Math.min(DAG_ZOOM_MAX, dagEditor.scale + zoomAmount));
  if (Math.abs(newScale - dagEditor.scale) < 0.001) return;

  var rect = dagEditor.svg.getBoundingClientRect();
  var mx = e.clientX - rect.left;
  var my = e.clientY - rect.top;

  var ratio = newScale / dagEditor.scale;
  dagEditor.translateX = mx - (mx - dagEditor.translateX) * ratio;
  dagEditor.translateY = my - (my - dagEditor.translateY) * ratio;
  dagEditor.scale = newScale;

  dagEditor.viewport.setAttribute('transform', 'translate(' + dagEditor.translateX + ',' + dagEditor.translateY + ') scale(' + dagEditor.scale + ')');
  orchEditorRenderMinimap();
  orchEditorScheduleCullRender();

  var zoomEl = document.getElementById('orch-zoom-level');
  if (zoomEl) zoomEl.textContent = Math.round(dagEditor.scale * 100) + '%';
}

// ── Context Menu ──────────────────────────────────────────

function orchEditorOnContextMenu(e) {
  if (!dagEditor) return;
  e.preventDefault();

  var target = orchEditorFindTarget(e);
  var items = [];

  if (target.type === 'node') {
    dagEditor.selectedNodes = {};
    dagEditor.selectedNodes[target.nodeId] = true;
    dagEditor.selectedEdge = null;
    items = [
      { label: 'Edit in Panel', action: function() { orchShowNodePanel(target.nodeId); } },
      { label: 'Duplicate', action: function() { orchDuplicateNode(target.nodeId); } },
    ];
    if (!orchIsStartNode(target.nodeId)) {
      items.push({ label: 'Delete Node', cls: 'danger', action: function() { orchDeleteNode(target.nodeId); } });
    }
    items.push(
      { sep: true },
      { label: 'Connect from here', action: function() {
        var np = dagEditor.nodePositions[target.nodeId];
        dagEditor.connecting = { fromNodeId: target.nodeId, returnValue: null, x: np ? np.x + DAG_NODE_W + 40 : 0, y: np ? np.y + DAG_NODE_H / 2 : 0 };
        orchEditorRender();
      }}
    );
  } else if (target.type === 'edge' || target.type === 'edge-label') {
    var eid = target.edgeId;
    dagEditor.selectedNodes = {};
    dagEditor.selectedEdge = eid;
    items = [
      { label: 'Edit Condition', action: function() { orchEditorShowInlineEdit(eid, e.clientX, e.clientY); } },
      { label: 'Delete Edge', cls: 'danger', action: function() { orchDeleteEdge(eid); } }
    ];
  } else {
    var svgPos = orchEdScreenToSvg(e.clientX, e.clientY);
    items = [
      { label: 'Add Task', action: function() { orchAddNodeOfType('task'); } },
      { label: 'Add Triggered', action: function() { orchAddNodeOfType('triggered'); } },
      { label: 'Add Gate', action: function() { orchAddNodeOfType('gate'); } },
      { label: 'Add End', action: function() { orchAddNodeOfType('end'); } },
      { sep: true },
      { label: 'Smart Layout', action: function() { orchEditorAutoLayout(true); orchEditorSaveAllPositions(); orchEditorRender(); } },
      { label: 'Simple Layout', action: function() { orchEditorAutoLayout(false); orchEditorSaveAllPositions(); orchEditorRender(); } },
      { label: 'Validate', action: function() { orchEditorValidate(true); } }
    ];
  }

  orchEditorRender();
  orchEditorShowContextMenu(e.clientX, e.clientY, items);
}

function orchEditorShowContextMenu(x, y, items) {
  var menu = document.getElementById('dag-editor-context-menu');
  if (!menu) return;

  var html = '';
  for (var i = 0; i < items.length; i++) {
    if (items[i].sep) {
      html += '<div class="dag-ctx-menu-sep"></div>';
    } else {
      html += '<div class="dag-ctx-menu-item' + (items[i].cls ? ' ' + items[i].cls : '') + '" data-idx="' + i + '">' + escapeHtml(items[i].label) + '</div>';
    }
  }
  menu.innerHTML = html;
  // Show off-screen to measure dimensions, then clamp to viewport
  menu.style.left = '-9999px';
  menu.style.top = '-9999px';
  menu.style.display = 'block';
  var menuW = menu.offsetWidth;
  var menuH = menu.offsetHeight;
  var vpW = window.innerWidth;
  var vpH = window.innerHeight;
  if (x + menuW > vpW) x = vpW - menuW - 8;
  if (y + menuH > vpH) y = vpH - menuH - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  menu._items = items;
  var menuItems = menu.querySelectorAll('.dag-ctx-menu-item');
  for (var j = 0; j < menuItems.length; j++) {
    menuItems[j].addEventListener('click', function(ev) {
      var idx = parseInt(ev.currentTarget.getAttribute('data-idx'));
      orchEditorHideContextMenu();
      if (menu._items[idx] && menu._items[idx].action) menu._items[idx].action();
    });
  }
}

function orchEditorHideContextMenu() {
  var menu = document.getElementById('dag-editor-context-menu');
  if (menu) menu.style.display = 'none';
}

// ── Double Click ──────────────────────────────────────────

function orchEditorOnDblClick(e) {
  if (!dagEditor) return;
  var target = orchEditorFindTarget(e);
  if (target.type === 'node') {
    orchShowNodePanel(target.nodeId);
  } else if (target.type === 'edge-label' || target.type === 'edge') {
    orchEditorShowInlineEdit(target.edgeId, e.clientX, e.clientY);
  }
}

// ── Keyboard ──────────────────────────────────────────────

function orchEditorOnKeyDown(e) {
  if (!dagEditor) return;
  var tag = (e.target || {}).tagName || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // 5.3 A11y: Focus navigation — Tab cycles nodes, Enter opens panel, Arrows navigate connections
  if (e.key === 'Tab') {
    e.preventDefault();
    var sortedNodes = orchEditorGetSortedNodeIds();
    if (sortedNodes.length === 0) return;
    var curIdx = dagFocusedNodeId ? sortedNodes.indexOf(dagFocusedNodeId) : -1;
    if (e.shiftKey) {
      dagFocusedNodeId = sortedNodes[curIdx <= 0 ? sortedNodes.length - 1 : curIdx - 1];
    } else {
      dagFocusedNodeId = sortedNodes[curIdx >= sortedNodes.length - 1 ? 0 : curIdx + 1];
    }
    orchEditorPanToNode(dagFocusedNodeId);
    orchEditorRender();
    return;
  }

  if (e.key === 'Enter' && dagFocusedNodeId) {
    e.preventDefault();
    orchShowNodePanel(dagFocusedNodeId);
    return;
  }

  if (dagFocusedNodeId && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    var arrowTarget = orchEditorFocusArrowTarget(dagFocusedNodeId, e.key);
    if (arrowTarget) {
      dagFocusedNodeId = arrowTarget;
      orchEditorPanToNode(dagFocusedNodeId);
      orchEditorRender();
    }
    return;
  }

  if (e.key === 'Escape') {
    dagEditor.selectedNodes = {};
    dagEditor.selectedEdge = null;
    dagEditor.connecting = null;
    dagFocusedNodeId = null;
    orchEditorHideContextMenu();
    orchEditorHideInlineEdit();
    orchEditorRender();
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (dagEditor.selectedEdge) {
      orchDeleteEdge(dagEditor.selectedEdge);
      dagEditor.selectedEdge = null;
      return;
    }
    var selIds = Object.keys(dagEditor.selectedNodes).filter(function(id) { return !orchIsStartNode(id); });
    if (selIds.length === 0) return;
    if (confirm('Delete ' + selIds.length + ' selected node(s)?')) {
      // Cache nodes and edges for undo
      var delNodes = [];
      var delEdgeSet = {};
      var delEdges = [];
      var allNodes = orchCurrent ? orchCurrent.nodes || [] : [];
      var allEdges = orchCurrent ? orchCurrent.edges || [] : [];
      for (var di = 0; di < selIds.length; di++) {
        var dNode = null;
        for (var dn = 0; dn < allNodes.length; dn++) {
          if (allNodes[dn].id === selIds[di]) { dNode = allNodes[dn]; break; }
        }
        if (dNode) {
          delNodes.push({ nodeId: selIds[di], nodePayload: orchBuildNodePayload(dNode) });
        }
        for (var de = 0; de < allEdges.length; de++) {
          if ((allEdges[de].fromNodeId === selIds[di] || allEdges[de].toNodeId === selIds[di]) && !delEdgeSet[allEdges[de].id]) {
            delEdgeSet[allEdges[de].id] = true;
            delEdges.push({ fromNodeId: allEdges[de].fromNodeId, toNodeId: allEdges[de].toNodeId, conditionValue: allEdges[de].conditionValue || null, conditionOperator: allEdges[de].conditionOperator || 'eq', sortOrder: allEdges[de].sortOrder || 0 });
          }
        }
      }
      for (var i = 0; i < selIds.length; i++) {
        orchDeleteNodeSilent(selIds[i]);
      }
      dagEditor.selectedNodes = {};
      if (dagFocusedNodeId && selIds.indexOf(dagFocusedNodeId) !== -1) {
        dagFocusedNodeId = null;
      }
      if (delNodes.length > 0) {
        dagUndoManager.push(dagUndoCommandFromData('DeleteNodes', { nodes: delNodes, edges: delEdges }, 'Delete ' + delNodes.length + ' node' + (delNodes.length > 1 ? 's' : '')));
      }
      orchEditorRefreshData();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    var nodes = orchCurrent ? orchCurrent.nodes || [] : [];
    dagEditor.selectedNodes = {};
    for (var j = 0; j < nodes.length; j++) dagEditor.selectedNodes[nodes[j].id] = true;
    orchEditorRender();
    return;
  }

  // Zoom shortcuts
  if (e.key === 'f' || ((e.ctrlKey || e.metaKey) && e.key === '0')) {
    e.preventDefault();
    orchEditorZoomReset();
    return;
  }
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    orchEditorZoomIn();
    return;
  }
  if (e.key === '-') {
    e.preventDefault();
    orchEditorZoomOut();
    return;
  }

  // Undo / Redo / Duplicate
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    dagUndoManager.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
    e.preventDefault();
    dagUndoManager.redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault();
    var dupIds = Object.keys(dagEditor.selectedNodes);
    if (dupIds.length === 1) {
      orchDuplicateNode(dupIds[0]);
    } else if (dupIds.length > 1) {
      toast('Select a single node to duplicate', 'info');
    }
    return;
  }

  // Shortcuts help overlay
  if (e.key === '?') {
    orchEditorToggleShortcutsHelp();
    return;
  }
}

function orchEditorToggleShortcutsHelp() {
  var overlay = document.getElementById('dag-shortcuts-overlay');
  if (!overlay) return;
  if (overlay.style.display === 'flex') {
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
  }
}

// ── A11y Focus Navigation Helpers ─────────────────────────

function orchEditorGetSortedNodeIds() {
  if (!orchCurrent) return [];
  var nodes = orchCurrent.nodes || [];
  var pos = dagEditor ? dagEditor.nodePositions : {};
  return nodes.map(function(n) { return n.id; }).sort(function(a, b) {
    var pa = pos[a] || { x: 0, y: 0 };
    var pb = pos[b] || { x: 0, y: 0 };
    return pa.x !== pb.x ? pa.x - pb.x : pa.y - pb.y;
  });
}

function orchEditorFocusArrowTarget(nodeId, key) {
  if (!orchCurrent) return null;
  var edges = orchCurrent.edges || [];
  var pos = dagEditor ? dagEditor.nodePositions : {};
  var np = pos[nodeId];
  if (!np) return null;

  if (key === 'ArrowRight') {
    for (var i = 0; i < edges.length; i++) {
      if (edges[i].fromNodeId === nodeId) return edges[i].toNodeId;
    }
  } else if (key === 'ArrowLeft') {
    for (var i = 0; i < edges.length; i++) {
      if (edges[i].toNodeId === nodeId) return edges[i].fromNodeId;
    }
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    var threshold = DAG_NODE_W;
    var siblings = [];
    var allNodes = orchCurrent.nodes || [];
    for (var i = 0; i < allNodes.length; i++) {
      var p = pos[allNodes[i].id];
      if (p && Math.abs(p.x - np.x) < threshold) {
        siblings.push({ id: allNodes[i].id, y: p.y });
      }
    }
    siblings.sort(function(a, b) { return a.y - b.y; });
    var curIdx = -1;
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].id === nodeId) { curIdx = i; break; }
    }
    if (key === 'ArrowUp' && curIdx > 0) return siblings[curIdx - 1].id;
    if (key === 'ArrowDown' && curIdx < siblings.length - 1) return siblings[curIdx + 1].id;
  }
  return null;
}

function orchEditorPanToNode(nodeId) {
  if (!dagEditor || !dagEditor.nodePositions[nodeId]) return;
  var np = dagEditor.nodePositions[nodeId];
  var svgRect = dagEditor.svg.getBoundingClientRect();
  var cx = np.x * dagEditor.scale + dagEditor.translateX;
  var cy = np.y * dagEditor.scale + dagEditor.translateY;
  var margin = 80;
  if (cx < margin || cx > svgRect.width - margin || cy < margin || cy > svgRect.height - margin) {
    dagEditor.translateX = svgRect.width / 2 - np.x * dagEditor.scale;
    dagEditor.translateY = svgRect.height / 2 - np.y * dagEditor.scale;
  }
}

function orchEditorOnClickAway(e) {
  if (!dagEditor) return;
  var ctxMenu = document.getElementById('dag-editor-context-menu');
  if (ctxMenu && ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target)) {
    orchEditorHideContextMenu();
  }
  var inlineEdit = document.getElementById('dag-editor-inline-edit');
  if (inlineEdit && inlineEdit.style.display === 'block' && !inlineEdit.contains(e.target)) {
    orchEditorHideInlineEdit();
  }
  // Close add menu on click away
  var addMenu = document.getElementById('orch-add-menu');
  if (addMenu && addMenu.style.display !== 'none') {
    var addGroup = addMenu.parentElement;
    if (addGroup && !addGroup.contains(e.target)) {
      addMenu.style.display = 'none';
    }
  }
}

// ── Edge Creation ─────────────────────────────────────────

async function orchEditorCreateEdge(fromNodeId, toNodeId, returnValue) {
  if (!orchCurrent) return;

  if (fromNodeId === toNodeId) {
    toast('Cannot connect a node to itself', 'error');
    return;
  }

  // Check for end node (no outgoing edges)
  var fromNode = null;
  var nodes = orchCurrent.nodes || [];
  for (var n = 0; n < nodes.length; n++) {
    if (nodes[n].id === fromNodeId) { fromNode = nodes[n]; break; }
  }
  if (fromNode && fromNode.nodeType === 'end') {
    toast('End nodes cannot have outgoing edges', 'error');
    return;
  }

  var existingEdges = orchCurrent.edges || [];
  var payload = {
    fromNodeId: fromNodeId,
    toNodeId: toNodeId,
    conditionValue: returnValue || null,
    conditionOperator: 'eq',
    sortOrder: existingEdges.length,
  };

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/edges', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  if (res && res.ok) {
    toast('Edge created', 'success');
    orchEditorMarkDirty();
    if (res.data && res.data.id) {
      dagUndoManager.push(dagUndoCommandFromData('CreateEdge', { edgeId: res.data.id, payload: payload }, 'Create edge'));
    }
    orchEditorRefreshData();
  }
}

// ── Silent Node Delete (for multi-delete) ─────────────────

async function orchDeleteNodeSilent(nodeId) {
  if (!orchCurrent) return;
  await fetchApi('/api/orchestrators/' + orchCurrent.id + '/nodes/' + nodeId, { method: 'DELETE' });
}

// ── Position Persistence ──────────────────────────────────

function orchEditorScheduleSaveAndValidate() {
  if (!dagEditor) return;
  if (dagEditor.saveTimer) clearTimeout(dagEditor.saveTimer);
  dagEditor.saveTimer = setTimeout(async function() {
    await orchEditorSavePositions();
    orchEditorValidate();
  }, DAG_SAVE_DEBOUNCE);
}

// Debounced re-render after zoom/pan to sync viewport culling with visible bounds
function orchEditorScheduleCullRender() {
  if (!dagEditor) return;
  if (dagEditor._cullRenderTimer) clearTimeout(dagEditor._cullRenderTimer);
  dagEditor._cullRenderTimer = setTimeout(function() { orchEditorRender(); }, 120);
}

function orchEditorSavePositions() {
  if (!dagEditor || !orchCurrent) return Promise.resolve();
  var orchId = orchCurrent.id;
  var ids = Object.keys(dagEditor.dirtyPositions);
  if (ids.length === 0) return Promise.resolve();
  dagEditor.dirtyPositions = {};

  var promises = [];
  for (var i = 0; i < ids.length; i++) {
    (function(nid) {
      var p = dagEditor ? dagEditor.nodePositions[nid] : null;
      if (!p) return;
      promises.push(fetchApi('/api/orchestrators/' + orchId + '/nodes/' + nid, {
        method: 'PATCH',
        body: JSON.stringify({ positionX: p.x, positionY: p.y })
      }).then(function(r) {
        // Keep orchNodeEditingUpdatedAt in sync when the edited node is repositioned
        if (r && r.ok && r.data && r.data.updatedAt && nid === orchSelectedNodeId) {
          orchNodeEditingUpdatedAt = r.data.updatedAt;
        }
      }).catch(function() {
        if (dagEditor) dagEditor.dirtyPositions[nid] = true;
      }));
    })(ids[i]);
  }
  return Promise.all(promises);
}

function orchEditorSaveAllPositions() {
  if (!dagEditor || !orchCurrent) return;
  var nodes = orchCurrent.nodes || [];
  for (var i = 0; i < nodes.length; i++) {
    dagEditor.dirtyPositions[nodes[i].id] = true;
  }
  orchEditorSavePositions();
}

// ── Validation ────────────────────────────────────────────

async function orchEditorValidate(showToast) {
  if (!orchCurrent || !dagEditor) return;
  // When showToast is true, this is a manual validate (commit mode).
  // Auto-validation (showToast falsy) is a dry-run — no dagValidated change on server.
  var commit = !!showToast;
  var opts = { method: 'POST' };
  if (commit) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify({ commit: true });
  }
  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/validate', opts, true);
  if (res && res.data && dagEditor) {
    dagEditor.validationResult = res.data;
    var isValid = res.data.valid !== false && (!res.data.errors || res.data.errors.length === 0);
    // Only mark as validated (registered) when committing succeeded
    if (commit) {
      dagEditor.validated = isValid;
    }
    orchEditorRenderStatusLamp();
    orchEditorRender();
    if (showToast) {
      if (isValid) {
        toast('DAG validated and registered', 'success');
      } else {
        var errCount = (res.data.errors || []).length;
        toast('Validation failed (' + errCount + ' error' + (errCount !== 1 ? 's' : '') + '). Flow not registered.', 'error');
      }
    }
  } else if (showToast) {
    toast('Validation request failed', 'error');
  }
}

function orchEditorMarkDirty() {
  if (!dagEditor) return;
  dagEditor.validated = false;
  orchEditorRenderStatusLamp();
}

function orchEditorRenderStatusLamp() {
  var lamp = document.getElementById('orch-status-lamp');
  if (!lamp || !dagEditor) return;
  if (dagEditor.validated) {
    lamp.className = 'orch-status-lamp active';
    lamp.title = 'Flow is validated and registered';
  } else if (dagEditor.validationResult) {
    var hasErrors = dagEditor.validationResult.valid === false || (dagEditor.validationResult.errors && dagEditor.validationResult.errors.length > 0);
    if (hasErrors) {
      lamp.className = 'orch-status-lamp error';
      lamp.title = 'Flow has validation errors';
    } else {
      lamp.className = 'orch-status-lamp dirty';
      lamp.title = 'Flow has unsaved changes since last validation';
    }
  } else {
    lamp.className = 'orch-status-lamp';
    lamp.title = 'Flow has not been validated yet';
  }
}

// ── Auto Layout ───────────────────────────────────────────

// ── Collision Detection ────────────────────────────────────

function orchEditorResolveOverlap(nodeId, skipSet) {
  if (!dagEditor || !orchCurrent) return;
  var np = dagEditor.nodePositions[nodeId];
  if (!np) return;
  var nodes = orchCurrent.nodes || [];
  var nodeById = {};
  for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].id] = nodes[ni];
  var thisNode = nodeById[nodeId];
  if (!thisNode) return;
  var h = orchEdNodeHeight(thisNode);

  for (var iter = 0; iter < 3; iter++) {
    var pushed = false;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === nodeId) continue;
      if (skipSet && skipSet[nodes[i].id]) continue;
      var op = dagEditor.nodePositions[nodes[i].id];
      if (!op) continue;
      var oh = orchEdNodeHeight(nodes[i]);
      // Check rectangle overlap
      if (np.x < op.x + DAG_NODE_W && np.x + DAG_NODE_W > op.x &&
          np.y < op.y + oh && np.y + h > op.y) {
        var nudgeRight = op.x + DAG_NODE_W - np.x + DAG_SNAP_GRID;
        var nudgeLeft = np.x + DAG_NODE_W - op.x + DAG_SNAP_GRID;
        var nudgeDown = op.y + oh - np.y + DAG_SNAP_GRID;
        var nudgeUp = np.y + h - op.y + DAG_SNAP_GRID;
        var minNudge = Math.min(nudgeRight, nudgeLeft, nudgeDown, nudgeUp);
        if (minNudge === nudgeRight) np.x = op.x + DAG_NODE_W + DAG_SNAP_GRID;
        else if (minNudge === nudgeLeft) np.x = op.x - DAG_NODE_W - DAG_SNAP_GRID;
        else if (minNudge === nudgeDown) np.y = op.y + oh + DAG_SNAP_GRID;
        else np.y = op.y - h - DAG_SNAP_GRID;
        np.x = Math.round(np.x / DAG_SNAP_GRID) * DAG_SNAP_GRID;
        np.y = Math.round(np.y / DAG_SNAP_GRID) * DAG_SNAP_GRID;
        dagEditor.dirtyPositions[nodeId] = true;
        pushed = true;
      }
    }
    if (!pushed) break;
  }
}

// ── Auto-Layout ───────────────────────────────────────────

function orchEditorAutoLayout(smart) {
  if (!dagEditor || !orchCurrent) return;
  var nodes = orchCurrent.nodes || [];
  var edges = orchCurrent.edges || [];

  if (nodes.length === 0) return;

  // 1. Layer assignment (Kahn's algorithm)
  var inDeg = {};
  var adj = {};
  var revAdj = {};
  for (var i = 0; i < nodes.length; i++) {
    inDeg[nodes[i].id] = 0;
    adj[nodes[i].id] = [];
    revAdj[nodes[i].id] = [];
  }
  for (var j = 0; j < edges.length; j++) {
    if (!adj[edges[j].fromNodeId]) adj[edges[j].fromNodeId] = [];
    adj[edges[j].fromNodeId].push(edges[j].toNodeId);
    if (!revAdj[edges[j].toNodeId]) revAdj[edges[j].toNodeId] = [];
    revAdj[edges[j].toNodeId].push(edges[j].fromNodeId);
    inDeg[edges[j].toNodeId] = (inDeg[edges[j].toNodeId] || 0) + 1;
  }

  var layers = [];
  var queue = [];
  var layerOf = {};
  for (var k in inDeg) {
    if (inDeg[k] === 0) { queue.push(k); layerOf[k] = 0; }
  }
  while (queue.length > 0) {
    var cur = queue.shift();
    var layer = layerOf[cur] || 0;
    if (!layers[layer]) layers[layer] = [];
    layers[layer].push(cur);
    var neighbors = adj[cur] || [];
    for (var n = 0; n < neighbors.length; n++) {
      inDeg[neighbors[n]]--;
      layerOf[neighbors[n]] = Math.max(layerOf[neighbors[n]] || 0, layer + 1);
      if (inDeg[neighbors[n]] === 0) queue.push(neighbors[n]);
    }
  }

  // Handle disconnected nodes
  for (var gi = 0; gi < nodes.length; gi++) {
    if (layerOf[nodes[gi].id] === undefined) {
      var maxLayer = layers.length;
      layerOf[nodes[gi].id] = maxLayer;
      if (!layers[maxLayer]) layers[maxLayer] = [];
      layers[maxLayer].push(nodes[gi].id);
    }
  }

  // Build node lookup for dynamic heights
  var nodeById = {};
  for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].id] = nodes[ni];

  var padX = 100, padY = 30;

  if (smart !== false && layers.length > 1) {
    // 2. Sugiyama-inspired barycenter ordering
    // Initial Y assignment
    var posY = {};
    for (var initLi = 0; initLi < layers.length; initLi++) {
      var initYOff = 0;
      for (var initNi = 0; initNi < layers[initLi].length; initNi++) {
        var initNid = layers[initLi][initNi];
        var initNh = nodeById[initNid] ? orchEdNodeHeight(nodeById[initNid]) : DAG_NODE_H;
        posY[initNid] = initYOff + initNh / 2;
        initYOff += initNh + padY;
      }
    }

    // Forward + backward passes (2 iterations)
    for (var pass = 0; pass < 2; pass++) {
      // Forward pass: sort each layer by barycenter of predecessors
      for (var fi = 1; fi < layers.length; fi++) {
        for (var fni = 0; fni < layers[fi].length; fni++) {
          var fnid = layers[fi][fni];
          var preds = revAdj[fnid] || [];
          if (preds.length > 0) {
            var fsum = 0;
            for (var fpi = 0; fpi < preds.length; fpi++) fsum += posY[preds[fpi]] || 0;
            posY[fnid] = fsum / preds.length;
          }
        }
        layers[fi].sort(function(a, b) { return (posY[a] || 0) - (posY[b] || 0); });
        var fYOff = 0;
        for (var frni = 0; frni < layers[fi].length; frni++) {
          var frnid = layers[fi][frni];
          var frnh = nodeById[frnid] ? orchEdNodeHeight(nodeById[frnid]) : DAG_NODE_H;
          posY[frnid] = fYOff + frnh / 2;
          fYOff += frnh + padY;
        }
      }
      // Backward pass: sort each layer by barycenter of successors
      for (var bi = layers.length - 2; bi >= 0; bi--) {
        for (var bni = 0; bni < layers[bi].length; bni++) {
          var bnid = layers[bi][bni];
          var succs = adj[bnid] || [];
          if (succs.length > 0) {
            var bsum = 0;
            for (var bsi = 0; bsi < succs.length; bsi++) bsum += posY[succs[bsi]] || 0;
            posY[bnid] = bsum / succs.length;
          }
        }
        layers[bi].sort(function(a, b) { return (posY[a] || 0) - (posY[b] || 0); });
        var bYOff = 0;
        for (var brni = 0; brni < layers[bi].length; brni++) {
          var brnid = layers[bi][brni];
          var brnh = nodeById[brnid] ? orchEdNodeHeight(nodeById[brnid]) : DAG_NODE_H;
          posY[brnid] = bYOff + brnh / 2;
          bYOff += brnh + padY;
        }
      }
    }

    // Assign final positions from ordered layers
    for (var pli = 0; pli < layers.length; pli++) {
      var pYOff = 0;
      for (var plni = 0; plni < layers[pli].length; plni++) {
        var pnid = layers[pli][plni];
        var pnh = nodeById[pnid] ? orchEdNodeHeight(nodeById[pnid]) : DAG_NODE_H;
        dagEditor.nodePositions[pnid] = { x: pli * (DAG_NODE_W + padX), y: pYOff };
        pYOff += pnh + padY;
      }
    }
  } else {
    // Simple layout (original algorithm)
    for (var sli = 0; sli < layers.length; sli++) {
      var sYOff = 0;
      for (var slni = 0; slni < layers[sli].length; slni++) {
        var snid = layers[sli][slni];
        var snh = nodeById[snid] ? orchEdNodeHeight(nodeById[snid]) : DAG_NODE_H;
        dagEditor.nodePositions[snid] = { x: sli * (DAG_NODE_W + padX), y: sYOff };
        sYOff += snh + padY;
      }
    }
  }

  dagEditor.translateX = 20;
  dagEditor.translateY = 20;
  dagEditor.scale = 1;
}

// ── Inline Condition Editor ───────────────────────────────

function orchEditorShowInlineEdit(edgeId, x, y) {
  if (!orchCurrent || !dagEditor) return;

  var edge = null;
  var edges = orchCurrent.edges || [];
  for (var i = 0; i < edges.length; i++) {
    if (edges[i].id === edgeId) { edge = edges[i]; break; }
  }
  if (!edge) return;

  var el = document.getElementById('dag-editor-inline-edit');
  if (!el) return;

  el.innerHTML = '<div style="margin-bottom:6px;font-weight:500;font-size:13px;">Edge Condition</div>'
    + '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">'
    + '<select id="dag-inline-op" style="padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;">'
    + '<option value="eq"' + (edge.conditionOperator === 'eq' ? ' selected' : '') + '>eq</option>'
    + '<option value="neq"' + (edge.conditionOperator === 'neq' ? ' selected' : '') + '>neq</option>'
    + '<option value="in"' + (edge.conditionOperator === 'in' ? ' selected' : '') + '>in</option>'
    + '<option value="regex"' + (edge.conditionOperator === 'regex' ? ' selected' : '') + '>regex</option>'
    + '</select>'
    + '<input id="dag-inline-val" style="flex:1;padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:4px;" placeholder="value (empty = unconditional)" value="' + escapeHtml(edge.conditionValue || '') + '">'
    + '</div>'
    + '<div style="display:flex;gap:6px;justify-content:flex-end;">'
    + '<button class="btn btn-sm" onclick="orchEditorHideInlineEdit()">Cancel</button>'
    + '<button class="btn btn-sm btn-primary" onclick="orchEditorSaveInlineEdit(\\'' + escapeInlineJsArg(edgeId) + '\\')">Save</button>'
    + '</div>';

  // Show off-screen to measure, then clamp to viewport
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.style.display = 'block';
  var elW = el.offsetWidth;
  var elH = el.offsetHeight;
  var vpW = window.innerWidth;
  var vpH = window.innerHeight;
  if (x + elW > vpW) x = vpW - elW - 8;
  if (y + elH > vpH) y = vpH - elH - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
}

function orchEditorHideInlineEdit() {
  var el = document.getElementById('dag-editor-inline-edit');
  if (el) el.style.display = 'none';
}

async function orchEditorSaveInlineEdit(edgeId) {
  if (!orchCurrent) return;

  // Cache current edge values for undo
  var oldEdge = null;
  var curEdges = orchCurrent.edges || [];
  for (var ei = 0; ei < curEdges.length; ei++) {
    if (curEdges[ei].id === edgeId) { oldEdge = curEdges[ei]; break; }
  }

  var opEl = document.getElementById('dag-inline-op');
  var valEl = document.getElementById('dag-inline-val');
  if (!opEl || !valEl) return;

  var payload = {
    conditionOperator: opEl.value,
    conditionValue: valEl.value.trim() || null
  };

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/edges/' + edgeId, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  if (res && res.ok) {
    toast('Edge updated', 'success');
    orchEditorHideInlineEdit();
    orchEditorMarkDirty();
    if (oldEdge) {
      dagUndoManager.push(dagUndoCommandFromData('UpdateEdgeCondition', {
        edgeId: edgeId,
        oldOp: oldEdge.conditionOperator || 'eq',
        oldVal: oldEdge.conditionValue || null,
        newOp: payload.conditionOperator,
        newVal: payload.conditionValue
      }, 'Update edge condition'));
    }
    orchEditorRefreshData();
  }
}

// ── Refresh Data ──────────────────────────────────────────

async function orchEditorRefreshData(prefetchedData) {
  if (!orchCurrent) return;
  if (prefetchedData) {
    orchCurrent = prefetchedData;
  } else {
    var data = await fetchApi('/api/orchestrators/' + orchCurrent.id);
    if (!data || !data.data) return;
    orchCurrent = data.data;
  }

  // Populate agent names for badge display (batch load, avoids N+1)
  var nodes = orchCurrent.nodes || [];
  var hasAgentNodes = false;
  for (var ai = 0; ai < nodes.length; ai++) {
    if (nodes[ai].agentId) { hasAgentNodes = true; break; }
  }
  if (hasAgentNodes) {
    try {
      var agents = await agentsFetchCached();
      var agentMap = {};
      for (var aj = 0; aj < agents.length; aj++) agentMap[agents[aj].id] = agents[aj];
      for (var ak = 0; ak < nodes.length; ak++) {
        if (nodes[ak].agentId && agentMap[nodes[ak].agentId]) {
          nodes[ak]._agentName = agentMap[nodes[ak].agentId].name;
        } else {
          nodes[ak]._agentName = null;
        }
      }
    } catch (e) { /* agent fetch failed — render without badges */ }
  }

  if (dagEditor) {
    var newPos = {};
    for (var i = 0; i < nodes.length; i++) {
      var existing = dagEditor.nodePositions[nodes[i].id];
      if (existing) {
        // Keep local position for existing nodes (dirty unsaved positions, auto-layout, or user-dragged)
        newPos[nodes[i].id] = existing;
      } else {
        // New node — use server position
        newPos[nodes[i].id] = { x: nodes[i].positionX || 0, y: nodes[i].positionY || 0 };
      }
    }
    dagEditor.nodePositions = newPos;
    // Skip render during drag — cached DOM refs would become stale; mouseup triggers full render
    if (!dagEditor.dragging) {
      orchEditorRender();
      orchEditorScheduleSaveAndValidate();
    }
  }
}

// ── Run Status ────────────────────────────────────────────

function orchEditorUpdateRunStatus(nodeRuns) {
  if (!dagEditor) return;
  dagEditor.runStatuses = {};
  for (var i = 0; i < nodeRuns.length; i++) {
    dagEditor.runStatuses[nodeRuns[i].nodeId] = orchEdNormalizeRunStatus(nodeRuns[i].status);
  }
  orchEditorRender();
}

// ── Zoom Controls ─────────────────────────────────────────

function orchEditorApplyZoom() {
  if (!dagEditor) return;
  dagEditor.viewport.setAttribute('transform', 'translate(' + dagEditor.translateX + ',' + dagEditor.translateY + ') scale(' + dagEditor.scale + ')');
  orchEditorRenderMinimap();
  orchEditorScheduleCullRender();
  var zoomEl = document.getElementById('orch-zoom-level');
  if (zoomEl) zoomEl.textContent = Math.round(dagEditor.scale * 100) + '%';
}

function orchEditorZoomIn() {
  if (!dagEditor) return;
  dagEditor.scale = Math.min(DAG_ZOOM_MAX, dagEditor.scale + DAG_ZOOM_STEP);
  orchEditorApplyZoom();
}

function orchEditorZoomOut() {
  if (!dagEditor) return;
  dagEditor.scale = Math.max(DAG_ZOOM_MIN, dagEditor.scale - DAG_ZOOM_STEP);
  orchEditorApplyZoom();
}

function orchEditorZoomReset() {
  if (!dagEditor) return;
  dagEditor.scale = 1;
  dagEditor.translateX = 20;
  dagEditor.translateY = 20;
  orchEditorApplyZoom();
}

// ── Minimap Navigation (click + drag) ─────────────────────

function orchEditorMinimapInit() {
  var mm = document.getElementById('dag-minimap');
  if (!mm || !dagEditor) return;

  var minimapDragActive = false;

  function minimapMoveViewport(clientX, clientY, smooth) {
    if (!dagEditor || !mm._bounds) return;
    var rect = mm.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;
    var b = mm._bounds;
    var mmW = b.width || rect.width || 1;
    var mmH = b.height || rect.height || 1;
    var svgRect = dagEditor.svg.getBoundingClientRect();

    if (mx < 0) mx = 0;
    if (mx > mmW) mx = mmW;
    if (my < 0) my = 0;
    if (my > mmH) my = mmH;

    var svgX = mx / b.scale + b.minX;
    var svgY = my / b.scale + b.minY;

    dagEditor.translateX = svgRect.width / 2 - svgX * dagEditor.scale;
    dagEditor.translateY = svgRect.height / 2 - svgY * dagEditor.scale;

    // Smooth CSS transition for minimap click (not during interactive drag)
    if (smooth) {
      dagEditor.viewport.style.transition = 'transform 0.15s ease-out';
      setTimeout(function() { if (dagEditor && dagEditor.viewport) dagEditor.viewport.style.transition = ''; }, 160);
    }
    dagEditor.viewport.setAttribute('transform', 'translate(' + dagEditor.translateX + ',' + dagEditor.translateY + ') scale(' + dagEditor.scale + ')');
    orchEditorRenderMinimap();
  }

  function onMinimapMouseDown(e) {
    if (e.button !== 0) return;
    minimapDragActive = true;
    mm.classList.add('dragging');
    minimapMoveViewport(e.clientX, e.clientY, true);
    e.preventDefault();
  }

  function onMinimapMouseMove(e) {
    if (!minimapDragActive) return;
    minimapMoveViewport(e.clientX, e.clientY, false);
    e.preventDefault();
  }

  function onMinimapMouseUp() {
    if (!minimapDragActive) return;
    minimapDragActive = false;
    mm.classList.remove('dragging');
    orchEditorRender();
  }

  mm.addEventListener('mousedown', onMinimapMouseDown);
  document.addEventListener('mousemove', onMinimapMouseMove);
  document.addEventListener('mouseup', onMinimapMouseUp);

  dagEditor._listeners.minimapMouseDown = onMinimapMouseDown;
  dagEditor._listeners.minimapMouseMove = onMinimapMouseMove;
  dagEditor._listeners.minimapMouseUp = onMinimapMouseUp;
}
`;
