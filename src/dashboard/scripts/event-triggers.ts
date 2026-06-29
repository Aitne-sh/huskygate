/** @module dashboard/scripts/event-triggers — Client-side script for the Webhooks tab. */
export const eventTriggersScript = `
    /* ── Webhooks (Endpoint Management + Subscription Helpers) ── */

    var evtEndpoints = [];
    var evtSubscriptions = [];
    var evtEndpointEditingId = null;
    var evtEndpointUpdatedAt = null;

    var EVT_ICON = SHARED_ICON;
    var EVT_PRESETS = {
      generic: {
        verificationType: 'none',
        signatureHeader: '',
        signaturePrefix: '',
        deliveryIdHeader: '',
        eventNameHeader: '',
        description: 'No verification. Suitable for custom integrations or testing.'
      },
      github: {
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-hub-signature-256',
        signaturePrefix: 'sha256=',
        deliveryIdHeader: 'x-github-delivery',
        eventNameHeader: 'x-github-event',
        description: 'GitHub Webhooks with HMAC-SHA256 signature verification.'
      },
      slack: {
        verificationType: 'slack-v0',
        signatureHeader: 'x-slack-signature',
        signaturePrefix: 'v0=',
        deliveryIdHeader: '',
        eventNameHeader: '',
        description: 'Slack Events API with v0 signature verification and timestamp replay protection.'
      },
      jira: {
        verificationType: 'hmac-sha256',
        signatureHeader: 'x-hub-signature',
        signaturePrefix: 'sha256=',
        deliveryIdHeader: 'x-atlassian-webhook-identifier',
        eventNameHeader: '',
        description: 'Jira Cloud Webhooks with HMAC-SHA256 signature verification.'
      }
    };

    /* ── Tunnel state & URL management ── */

    var evtTunnelActive = false;
    var evtTunnelUrl = null;
    var evtLocalPort = '3738';

    function evtBuildWebhookUrl(endpoint) {
      var path = endpoint.path || ('/webhooks/' + endpoint.token);
      if (endpoint.publicUrl) return endpoint.publicUrl;
      if (evtTunnelActive && evtTunnelUrl) return evtTunnelUrl.replace(/\\/+$/, '') + path;
      return 'http://localhost:' + evtLocalPort + path;
    }

    function evtUpdateUrlDisplay() {
      var el = document.getElementById('evt-url-value');
      if (!el) return;
      if (evtTunnelActive && evtTunnelUrl) {
        el.textContent = evtTunnelUrl;
        el.className = 'evt-url-tunnel';
      } else {
        el.textContent = 'http://localhost:' + evtLocalPort;
        el.className = '';
      }
    }

    function evtUpdateTunnelBadge() {
      var badge = document.getElementById('evt-tunnel-status-badge');
      if (!badge) return;
      if (evtTunnelActive) {
        badge.textContent = 'Connected';
        badge.className = 'evt-tunnel-status evt-tunnel-status-active';
      } else {
        badge.textContent = 'Inactive';
        badge.className = 'evt-tunnel-status';
      }
    }

    async function evtInitTunnelState() {
      var d = await fetchApi('/api/tunnel/status', null, true);
      if (!d || !d.data) return;
      evtTunnelActive = !!d.data.active;
      evtTunnelUrl = d.data.url || d.data.publicBaseUrl || null;
      if (d.data.localPort) evtLocalPort = String(d.data.localPort);
      var cb = document.getElementById('evt-tunnel-checkbox');
      if (cb) cb.checked = evtTunnelActive;
      evtUpdateTunnelBadge();
      evtUpdateUrlDisplay();
    }

    async function evtToggleTunnel(enabled) {
      var cb = document.getElementById('evt-tunnel-checkbox');
      var badge = document.getElementById('evt-tunnel-status-badge');
      if (badge) {
        badge.textContent = enabled ? 'Connecting...' : 'Stopping...';
        badge.className = 'evt-tunnel-status evt-tunnel-status-pending';
      }
      if (cb) cb.disabled = true;

      try {
        if (enabled) {
          var d = await fetchApi('/api/tunnel/start', { method: 'POST', body: '{}' });
          if (!d || !d.ok) {
            if (cb) { cb.checked = false; cb.disabled = false; }
            evtUpdateTunnelBadge();
            return;
          }
          evtTunnelActive = true;
          evtTunnelUrl = d.data.url || d.data.publicBaseUrl || null;
          toast('Cloudflare Tunnel connected', 'success');
        } else {
          await fetchApi('/api/tunnel/stop', { method: 'POST', body: '{}' });
          evtTunnelActive = false;
          evtTunnelUrl = null;
          toast('Cloudflare Tunnel stopped', 'success');
        }
      } catch (_err) {
        if (cb) cb.checked = !enabled;
      }

      if (cb) cb.disabled = false;
      evtUpdateTunnelBadge();
      evtUpdateUrlDisplay();
      await evtRefreshCollections();
      evtRenderEndpointList();
    }

    async function evtCopyWebhookUrl(endpointId) {
      var ep = evtLookupById(evtEndpoints, endpointId);
      if (!ep) return;
      var url = evtBuildWebhookUrl(ep);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
          toast('Webhook URL copied', 'success');
          return;
        }
      } catch (_err) { /* fall through */ }
      window.prompt('Webhook URL:', url);
    }

    /* ── Webhooks page load ── */

    async function evtLoadPage() {
      var endpointEl = document.getElementById('evt-endpoint-list');
      if (!endpointEl) return;
      endpointEl.innerHTML = '<div class="loading">Loading webhook endpoints...</div>';
      await evtInitTunnelState();

      var ok = await evtRefreshCollections();
      if (!ok) {
        endpointEl.innerHTML = '<div class="empty-state">Server API must be online to manage webhooks.</div>';
        return;
      }
      evtRenderEndpointList();
    }

    async function evtRefreshCollections() {
      var results = await Promise.all([
        fetchApi('/api/webhook-endpoints', null, true),
        fetchApi('/api/event-subscriptions', null, true)
      ]);
      if (!results[0]) return false;
      evtEndpoints = Array.isArray(results[0].data) ? results[0].data : [];
      evtSubscriptions = results[1] && Array.isArray(results[1].data) ? results[1].data : [];
      return true;
    }

    async function evtRefreshEndpointsOnly() {
      var d = await fetchApi('/api/webhook-endpoints', null, true);
      if (!d) return false;
      evtEndpoints = Array.isArray(d.data) ? d.data : [];
      return true;
    }

    /* ── Endpoint list rendering ── */

    function evtRenderEndpointList() {
      var el = document.getElementById('evt-endpoint-list');
      if (!el) return;
      if (!evtEndpoints.length) {
        el.innerHTML = '<div class="card" style="padding:1.5rem;text-align:center;color:var(--text-dim);font-size:0.85rem;">'
          + '<div style="margin-bottom:0.4rem;font-weight:600;color:var(--text-main);">No webhook endpoints</div>'
          + 'Create an endpoint to start receiving external events.'
          + '</div>';
        return;
      }

      var html = '<div class="card" style="overflow:hidden;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;padding:0.55rem 0.85rem;background:rgba(76,175,80,0.06);border-bottom:1px solid var(--border);">'
        + '<div style="display:flex;align-items:center;gap:0.5rem;">'
        + '<span style="font-weight:600;font-size:0.82rem;color:var(--green-dark);">Webhook Endpoints</span>'
        + '<span style="font-size:0.72rem;background:rgba(76,175,80,0.14);color:var(--green-dark);padding:0.05rem 0.45rem;border-radius:8px;">' + evtEndpoints.length + '</span>'
        + '</div></div>'
        + '<div class="table-wrap" style="margin:0;"><table style="margin:0;"><thead><tr>'
        + '<th style="width:130px;">Publisher</th><th style="width:110px;">Verification</th><th>Webhook URL</th><th style="width:100px;">Linked</th><th style="width:80px;">Status</th><th style="width:90px;text-align:right;">Actions</th>'
        + '</tr></thead><tbody>';

      for (var i = 0; i < evtEndpoints.length; i++) {
        var endpoint = evtEndpoints[i];
        var jsId = escapeInlineJsArg(endpoint.id);
        var subscriptionCount = evtCountSubscriptions(endpoint.id);
        var url = evtBuildWebhookUrl(endpoint);
        html += '<tr>'
          + '<td>' + evtPublisherBadge(endpoint.publisherPreset) + '</td>'
          + '<td>' + evtVerificationBadge(endpoint.verificationType) + '</td>'
          + '<td><div class="evt-url-cell"><code>' + escapeHtml(url) + '</code>'
          + '<button class="action-btn" onclick="event.stopPropagation();evtCopyWebhookUrl(\\'' + jsId + '\\')" title="Copy URL">' + EVT_ICON.copy + '</button></div></td>'
          + '<td><span style="font-size:0.78rem;color:var(--text-dim);">' + subscriptionCount + ' sub' + (subscriptionCount !== 1 ? 's' : '') + '</span></td>'
          + '<td>' + (endpoint.enabled
            ? '<span class="badge badge-enabled">Enabled</span>'
            : '<span class="badge badge-disabled">Disabled</span>') + '</td>'
          + '<td style="text-align:right;">'
          + '<button class="action-btn" onclick="evtEditEndpoint(\\'' + jsId + '\\')" title="Edit">' + EVT_ICON.edit + '</button>'
          + '<button class="action-btn action-btn-danger" onclick="evtDeleteEndpoint(\\'' + jsId + '\\')" title="Delete">' + EVT_ICON.trash + '</button>'
          + '</td></tr>';
      }

      html += '</tbody></table></div></div>';
      el.innerHTML = html;
    }

    /* ── Endpoint helpers ── */

    function evtCountSubscriptions(endpointId) {
      var count = 0;
      for (var i = 0; i < evtSubscriptions.length; i++) {
        if (evtSubscriptions[i].endpointId === endpointId) count++;
      }
      return count;
    }

    function evtVerificationBadge(verificationType) {
      var label = verificationType || 'none';
      var cls = 'badge-disabled';
      if (label === 'bearer') cls = 'badge-bearer';
      else if (label === 'slack-v0') cls = 'badge-slack-v0';
      else if (label.indexOf('hmac') === 0) cls = 'badge-hmac';
      return '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
    }

    function evtPublisherBadge(preset) {
      var cls = 'badge-pub-' + (preset || 'generic');
      return '<span class="badge ' + cls + '">' + escapeHtml(preset || 'generic') + '</span>';
    }

    function evtLookupById(items, id) {
      if (!id || !items) return null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].id === id) return items[i];
      }
      return null;
    }

    /* ── Secret banner ── */

    function evtShowSecret(secret, endpoint) {
      if (!secret) return;
      var banner = document.getElementById('evt-secret-banner');
      var text = document.getElementById('evt-secret-value');
      if (!banner || !text) return;
      text.textContent = secret;
      var title = document.getElementById('evt-secret-title');
      if (title) {
        title.textContent = endpoint
          ? 'Save the signing secret for ' + (endpoint.path || endpoint.id)
          : 'Save the signing secret';
      }
      banner.style.display = 'block';
    }

    function evtHideSecret() {
      var banner = document.getElementById('evt-secret-banner');
      if (banner) banner.style.display = 'none';
    }

    async function evtCopySecret() {
      var text = document.getElementById('evt-secret-value');
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text.textContent || '');
          toast('Secret copied', 'success');
          return;
        }
      } catch (_err) { /* fall through */ }
      window.prompt('Secret:', text.textContent || '');
    }

    /* ── Endpoint CRUD modal ── */

    async function evtShowCreateEndpointModal() {
      evtEndpointEditingId = null;
      evtEndpointUpdatedAt = null;
      document.getElementById('evt-endpoint-modal-title').textContent = 'New Webhook Endpoint';
      document.getElementById('evt-endpoint-modal-save').textContent = 'Create';
      document.getElementById('evt-endpoint-input-preset').value = 'generic';
      document.getElementById('evt-endpoint-input-enabled').checked = true;
      document.getElementById('evt-endpoint-input-secret').value = '';
      document.getElementById('evt-endpoint-input-max-body-bytes').value = '262144';
      evtApplyEndpointPreset();
      evtOpenModal('evt-endpoint-modal');
    }

    function evtCloseEndpointModal() {
      evtCloseModal('evt-endpoint-modal');
      evtEndpointEditingId = null;
      evtEndpointUpdatedAt = null;
    }

    function evtApplyEndpointPreset() {
      var preset = document.getElementById('evt-endpoint-input-preset').value;
      var defaults = EVT_PRESETS[preset] || EVT_PRESETS.generic;
      document.getElementById('evt-endpoint-input-verification-type').value = defaults.verificationType;
      document.getElementById('evt-endpoint-input-signature-header').value = defaults.signatureHeader;
      document.getElementById('evt-endpoint-input-signature-prefix').value = defaults.signaturePrefix;
      document.getElementById('evt-endpoint-input-delivery-id-header').value = defaults.deliveryIdHeader;
      document.getElementById('evt-endpoint-input-event-name-header').value = defaults.eventNameHeader;
      evtUpdateEndpointFormVisibility();
    }

    function evtUpdateEndpointFormVisibility() {
      var verification = document.getElementById('evt-endpoint-input-verification-type').value;
      var showSecret = verification !== 'none';
      var showPrefix = verification.indexOf('hmac') === 0 || verification === 'slack-v0';
      evtSetDisplay('evt-endpoint-row-secret', showSecret);
      evtSetDisplay('evt-endpoint-row-signature-header', showSecret);
      evtSetDisplay('evt-endpoint-row-signature-prefix', showPrefix);
      evtUpdatePresetHelpText();
    }

    async function evtEditEndpoint(id) {
      var d = await fetchApi('/api/webhook-endpoints/' + id);
      if (!d || !d.data) return;
      var endpoint = d.data;
      evtEndpointEditingId = id;
      evtEndpointUpdatedAt = endpoint.updatedAt || null;
      document.getElementById('evt-endpoint-modal-title').textContent = 'Edit Webhook Endpoint';
      document.getElementById('evt-endpoint-modal-save').textContent = 'Save';
      document.getElementById('evt-endpoint-input-preset').value = endpoint.publisherPreset || 'generic';
      document.getElementById('evt-endpoint-input-verification-type').value = endpoint.verificationType || 'none';
      document.getElementById('evt-endpoint-input-signature-header').value = endpoint.signatureHeader || '';
      document.getElementById('evt-endpoint-input-signature-prefix').value = endpoint.signaturePrefix || '';
      document.getElementById('evt-endpoint-input-delivery-id-header').value = endpoint.deliveryIdHeader || '';
      document.getElementById('evt-endpoint-input-event-name-header').value = endpoint.eventNameHeader || '';
      document.getElementById('evt-endpoint-input-secret').value = '';
      document.getElementById('evt-endpoint-input-max-body-bytes').value = String(endpoint.maxBodyBytes || 262144);
      document.getElementById('evt-endpoint-input-enabled').checked = endpoint.enabled !== false;
      evtUpdateEndpointFormVisibility();
      evtOpenModal('evt-endpoint-modal');
    }

    async function evtSaveEndpoint() {
      var maxBodyBytes = parseInt(document.getElementById('evt-endpoint-input-max-body-bytes').value || '262144', 10);
      if (!maxBodyBytes || maxBodyBytes <= 0) {
        toast('Max body size must be a positive integer', 'error');
        return;
      }

      var payload = {
        publisherPreset: document.getElementById('evt-endpoint-input-preset').value,
        verificationType: document.getElementById('evt-endpoint-input-verification-type').value,
        signatureHeader: evtNullableField('evt-endpoint-input-signature-header'),
        signaturePrefix: evtNullableField('evt-endpoint-input-signature-prefix'),
        deliveryIdHeader: evtNullableField('evt-endpoint-input-delivery-id-header'),
        eventNameHeader: evtNullableField('evt-endpoint-input-event-name-header'),
        maxBodyBytes: maxBodyBytes,
        enabled: document.getElementById('evt-endpoint-input-enabled').checked
      };
      var secret = evtNullableField('evt-endpoint-input-secret');
      if (secret) payload.secret = secret;
      if (evtEndpointEditingId && evtEndpointUpdatedAt) payload.updatedAt = evtEndpointUpdatedAt;

      var url = evtEndpointEditingId ? '/api/webhook-endpoints/' + evtEndpointEditingId : '/api/webhook-endpoints';
      var method = evtEndpointEditingId ? 'PATCH' : 'POST';
      var d = await fetchApi(url, { method: method, body: JSON.stringify(payload) });
      if (!d || !d.ok) return;
      evtCloseEndpointModal();
      evtShowSecret(d.secret, d.data);
      toast(evtEndpointEditingId ? 'Webhook endpoint updated' : 'Webhook endpoint created', 'success');
      await evtLoadPage();
    }

    async function evtDeleteEndpoint(id) {
      if (!confirm('Delete this webhook endpoint? All linked task subscriptions will also be removed.')) return;
      var d = await fetchApi('/api/webhook-endpoints/' + id, { method: 'DELETE' });
      if (!d || !d.ok) return;
      toast('Webhook endpoint deleted', 'success');
      await evtLoadPage();
    }

    /* ── Subscription helpers for Triggered Tasks ── */

    async function evtFindSubscriptionForTask(taskId) {
      var d = await fetchApi('/api/event-subscriptions', null, true);
      if (!d || !Array.isArray(d.data)) return null;
      for (var i = 0; i < d.data.length; i++) {
        var s = d.data[i];
        if (s.targetType === 'triggered_task' && s.triggeredTaskId === taskId) return s;
      }
      return null;
    }

    async function evtSaveSubscriptionForTask(taskId, endpointId, filterRaw, mappingRaw, existingSub) {
      if (!endpointId) {
        if (existingSub) {
          var deleteRes = await fetchApi('/api/event-subscriptions/' + existingSub.id, { method: 'DELETE' });
          if (!deleteRes || !deleteRes.ok) {
            toast('Triggered task saved but webhook subscription removal failed', 'error');
            return false;
          }
          if (typeof ttCurrentSub !== 'undefined') {
            ttCurrentSub = null;
          }
        }
        return true;
      }

      var filter = null;
      if (filterRaw) {
        try { filter = JSON.parse(filterRaw); } catch (_e) {
          toast('Filter JSON is invalid', 'error'); return false;
        }
      }
      var contextMapping = null;
      if (mappingRaw) {
        try { contextMapping = JSON.parse(mappingRaw); } catch (_e) {
          toast('Context Mapping JSON is invalid', 'error'); return false;
        }
      }

      var payload = {
        endpointId: endpointId,
        targetType: 'triggered_task',
        triggeredTaskId: taskId,
        filter: filter,
        contextMapping: contextMapping,
        enabled: existingSub ? existingSub.enabled : true
      };

      var subRes;
      if (existingSub) {
        payload.updatedAt = existingSub.updatedAt;
        subRes = await fetchApi('/api/event-subscriptions/' + existingSub.id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        subRes = await fetchApi('/api/event-subscriptions', { method: 'POST', body: JSON.stringify(payload) });
      }
      if (!subRes || !subRes.ok) {
        toast('Task saved but webhook subscription failed', 'error');
        return false;
      }
      if (subRes.data && typeof ttCurrentSub !== 'undefined') {
        ttCurrentSub = subRes.data;
      }
      return true;
    }

    function evtDescribeEndpointShort(endpointId) {
      var ep = evtLookupById(evtEndpoints, endpointId);
      if (!ep) return null;
      return ep.publisherPreset + ' · ' + (ep.path || ep.id.substring(0, 8));
    }

    function evtUpdatePresetHelpText() {
      var preset = document.getElementById('evt-endpoint-input-preset').value;
      var defaults = EVT_PRESETS[preset] || EVT_PRESETS.generic;
      var helpEl = document.getElementById('evt-endpoint-preset-help');
      if (helpEl) helpEl.textContent = defaults.description || '';
    }

    var EVT_FILTER_PLACEHOLDERS = {
      generic: '{"match":[{"path":"body.action","eq":"deploy"}]}',
      github: '{"match":[{"path":"_trigger.event","eq":"push"},{"path":"body.ref","eq":"refs/heads/main"}]}',
      slack: '{"match":[{"path":"body.event.type","eq":"message"},{"path":"body.event.text","prefix":"[deploy]"}]}',
      jira: '{"match":[{"path":"body.webhookEvent","eq":"jira:issue_updated"}]}'
    };
    var EVT_MAPPING_PLACEHOLDERS = {
      generic: '{"key":"body.some.field"}',
      github: '{"repo":"body.repository.full_name","branch":"body.ref","sender":"body.sender.login"}',
      slack: '{"text":"body.event.text","channel":"body.event.channel","user":"body.event.user"}',
      jira: '{"issueKey":"body.issue.key","status":"body.issue.fields.status.name","event":"body.webhookEvent"}'
    };

    function evtUpdateTriggerPlaceholders(preset) {
      var filterEl = document.getElementById('tt-input-filter-json');
      var mappingEl = document.getElementById('tt-input-mapping-json');
      if (filterEl) filterEl.placeholder = EVT_FILTER_PLACEHOLDERS[preset] || EVT_FILTER_PLACEHOLDERS.generic;
      if (mappingEl) mappingEl.placeholder = EVT_MAPPING_PLACEHOLDERS[preset] || EVT_MAPPING_PLACEHOLDERS.generic;
    }

    /* ── Shared utilities ── */

    function evtNullableField(id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var value = el.value.trim();
      return value ? value : null;
    }

    function evtPrettyJsonText(raw) {
      if (!raw) return '';
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch (_err) {
        return String(raw);
      }
    }

    function evtOpenModal(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    }

    function evtCloseModal(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    function evtSetDisplay(id, visible) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = visible ? '' : 'none';
    }
`;
