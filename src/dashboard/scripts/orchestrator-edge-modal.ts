/** @module dashboard/scripts/orchestrator-edge-modal — Client-side script for the orchestrator edge creation modal. */

/**
 * Edge creation modal with from/to selectors and condition fields.
 * Depends on: orchestrator.ts (orchCurrent, escapeHtml, toast, fetchApi)
 * Depends on: orchestrator-editor.ts (dagEditor, orchEditorRefreshData, orchEditorMarkDirty)
 */

export const orchestratorEdgeModalScript = `
function orchShowEdgeModal() {
  var m = document.getElementById('orch-edge-modal');
  if (!m || !orchCurrent) return;

  var nodes = orchCurrent.nodes || [];
  var opts = nodes.map(function(n) { return '<option value="' + n.id + '">' + escapeHtml(n.label) + '</option>'; }).join('');
  document.getElementById('orch-edge-input-from').innerHTML = opts;
  document.getElementById('orch-edge-input-to').innerHTML = opts;
  document.getElementById('orch-edge-input-condition-value').value = '';
  document.getElementById('orch-edge-input-condition-op').value = 'eq';
  m.style.display = 'flex';
}

function orchCloseEdgeModal() {
  var m = document.getElementById('orch-edge-modal');
  if (m) m.style.display = 'none';
}

async function orchSaveEdge() {
  if (!orchCurrent) return;
  try {
    var existingEdges = orchCurrent.edges || [];
    var payload = {
      fromNodeId: (document.getElementById('orch-edge-input-from') || {}).value,
      toNodeId: (document.getElementById('orch-edge-input-to') || {}).value,
      conditionValue: (document.getElementById('orch-edge-input-condition-value') || {}).value?.trim() || null,
      conditionOperator: (document.getElementById('orch-edge-input-condition-op') || {}).value || 'eq',
      sortOrder: existingEdges.length,
    };

    if (!payload.fromNodeId || !payload.toNodeId) { toast('Select both From and To', 'error'); return; }
    if (payload.fromNodeId === payload.toNodeId) { toast('Cannot connect a node to itself', 'error'); return; }

    var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/edges', { method: 'POST', body: JSON.stringify(payload) });
    if (res && res.ok) {
      toast('Edge added', 'success');
      orchEditorMarkDirty();
      orchCloseEdgeModal();
      if (dagEditor) orchEditorRefreshData();
    }
  } catch (err) {
    console.error('orchSaveEdge error:', err);
    toast('Failed to save edge: ' + (err.message || err), 'error');
  }
}

async function orchDeleteEdge(edgeId) {
  if (!orchCurrent || !confirm('Delete this edge?')) return;

  // Cache edge for undo
  var edge = null;
  var edges = orchCurrent.edges || [];
  for (var dei = 0; dei < edges.length; dei++) {
    if (edges[dei].id === edgeId) { edge = edges[dei]; break; }
  }

  var res = await fetchApi('/api/orchestrators/' + orchCurrent.id + '/edges/' + edgeId, { method: 'DELETE' });
  if (res && res.ok) {
    toast('Edge deleted', 'success');
    orchEditorMarkDirty();
    if (edge) {
      dagUndoManager.push(dagUndoCommandFromData('DeleteEdge', {
        edgeId: edgeId,
        payload: { fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId, conditionValue: edge.conditionValue || null, conditionOperator: edge.conditionOperator || 'eq', sortOrder: edge.sortOrder || 0 }
      }, 'Delete edge'));
    }
    if (dagEditor) {
      dagEditor.selectedEdge = null;
      orchEditorRefreshData();
    }
  }
}
`;
