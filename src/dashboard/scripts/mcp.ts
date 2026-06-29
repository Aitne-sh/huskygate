/** @module dashboard/scripts/mcp — Client-side script for the MCP Servers tab. */
export const mcpScript = `
    /* ══════════════════════════════════════════════
       MCP Servers Tab
       ══════════════════════════════════════════════ */

    var mcpCurrentTool = 'claude';
    var mcpEditingServer = null;
    var mcpConfigData = null;
    var mcpCurrentTransport = 'stdio';

    /* ── Field visibility rules per tool × transport ── */
    var MCP_FIELD_RULES = {
      claude: { transports: ['stdio', 'sse', 'http'], advanced: false, auth: true, authTitle: 'Authentication (Claude HTTP/SSE)', authFields: ['httpHeaders'], oauth: false, httpUrl: true },
      gemini: { transports: ['stdio', 'sse'], advanced: true, advancedFields: ['timeout', 'excludeTools'], auth: false, oauth: true, httpUrl: false },
      codex:  { transports: ['stdio', 'http'], advanced: true, advancedFields: ['enabled', 'required', 'includeTools', 'excludeTools'], auth: true, authTitle: 'Authentication (Codex HTTP)', authFields: ['bearerToken', 'bearerTokenEnvVar', 'httpHeaders', 'envHttpHeaders', 'scopes'], oauth: false, httpUrl: true }
    };

    function mcpSwitchTool(tool) {
      if (tool === mcpCurrentTool) return;
      mcpCurrentTool = tool;
      var tabs = document.querySelectorAll('#mcp-tool-tabs .driver-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tool') === tool);
      }
      // Trigger panel fade-in (auto-cleanup via animationend)
      var panel = document.getElementById('mcp-tab-panel');
      if (panel) {
        panel.classList.remove('fade-in');
        void panel.offsetWidth;
        panel.classList.add('fade-in');
        panel.addEventListener('animationend', function handler() {
          panel.classList.remove('fade-in');
          panel.removeEventListener('animationend', handler);
        });
      }
      mcpLoadConfig();
    }

    async function mcpLoadConfig() {
      var d = await fetchApi('/api/mcp/servers?tool=' + mcpCurrentTool);
      if (!d) return;
      mcpConfigData = d;
      document.getElementById('mcp-config-path').textContent = d.filePath || '';

      // Render servers table
      var tbody = document.getElementById('mcp-servers-tbody');
      var servers = d.servers || {};
      var names = Object.keys(servers);
      if (names.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:1.5rem;">No MCP servers configured.</td></tr>';
      } else {
        var html = '';
        for (var i = 0; i < names.length; i++) {
          var name = names[i];
          var srv = servers[name];
          var transport = srv.transport || 'stdio';
          var cmdUrl = transport === 'stdio'
            ? escapeHtml((srv.command || '') + (srv.args ? ' ' + (Array.isArray(srv.args) ? srv.args.join(' ') : srv.args) : ''))
            : escapeHtml(srv.url || srv.httpUrl || '');
          var enabled = srv.enabled === false ? '<span class="badge badge-inactive">disabled</span>' : '<span class="badge badge-active">active</span>';
          html += '<tr>'
            + '<td><code>' + escapeHtml(name) + '</code></td>'
            + '<td><span class="badge badge-tool">' + escapeHtml(transport) + '</span></td>'
            + '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + cmdUrl + '</td>'
            + '<td>' + enabled + '</td>'
            + '<td style="display:flex;gap:0.3rem;">'
            + '<button class="btn" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="mcpEditServer(\\'' + escapeInlineJsArg(srv.id || name) + '\\')">Edit</button>'
            + '<button class="btn btn-danger" style="padding:0.2rem 0.5rem;font-size:0.75rem;" onclick="mcpDeleteServer(\\'' + escapeInlineJsArg(srv.id || name) + '\\')">Del</button>'
            + '</td></tr>';
        }
        tbody.innerHTML = html;
      }

      // Global MCP settings (Gemini only)
      var globalSection = document.getElementById('mcp-global-section');
      if (mcpCurrentTool === 'gemini' && d.globalMcp) {
        globalSection.style.display = 'block';
        var gTbody = document.getElementById('mcp-global-tbody');
        var gHtml = '';
        var gKeys = Object.keys(d.globalMcp);
        for (var g = 0; g < gKeys.length; g++) {
          var gk = gKeys[g];
          gHtml += '<tr><td class="key-cell" style="width:180px;">' + escapeHtml(gk) + '</td>'
            + '<td><input class="settings-input" disabled value="' + escapeHtml(String(d.globalMcp[gk] != null ? d.globalMcp[gk] : '')) + '"></td></tr>';
        }
        gTbody.innerHTML = gHtml;
      } else {
        globalSection.style.display = 'none';
      }
    }

    function mcpUpdateFieldVisibility() {
      var rules = MCP_FIELD_RULES[mcpCurrentTool] || MCP_FIELD_RULES.claude;
      var transport = mcpCurrentTransport;

      // Transport toggle: only show allowed transports
      var toggleBtns = document.querySelectorAll('#mcp-transport-toggle button');
      for (var t = 0; t < toggleBtns.length; t++) {
        var btn = toggleBtns[t];
        var btnTransport = ['stdio', 'sse', 'http'][t];
        btn.style.display = rules.transports.indexOf(btnTransport) >= 0 ? '' : 'none';
      }

      // stdio vs url fields
      document.getElementById('mcp-stdio-fields').style.display = transport === 'stdio' ? '' : 'none';
      document.getElementById('mcp-url-fields').style.display = transport !== 'stdio' ? '' : 'none';

      // httpUrl vs url field within url-fields section
      document.getElementById('mcp-row-url').style.display = (transport === 'sse') ? '' : 'none';
      document.getElementById('mcp-row-httpUrl').style.display = (transport === 'http') ? '' : 'none';

      // Advanced fields
      var advancedSection = document.getElementById('mcp-advanced-fields');
      if (rules.advanced) {
        advancedSection.style.display = '';
        var advRows = ['timeout', 'toolTimeout', 'trust', 'enabled', 'required', 'includeTools', 'excludeTools'];
        var allowed = rules.advancedFields || [];
        for (var a = 0; a < advRows.length; a++) {
          var row = document.getElementById('mcp-row-' + advRows[a]);
          if (row) row.style.display = allowed.indexOf(advRows[a]) >= 0 ? '' : 'none';
        }
      } else {
        advancedSection.style.display = 'none';
      }

      // Auth fields
      var authVisible = rules.auth && (mcpCurrentTool === 'claude' ? transport !== 'stdio' : transport === 'http');
      document.getElementById('mcp-auth-fields').style.display = authVisible ? '' : 'none';
      document.getElementById('mcp-auth-title').textContent = rules.authTitle || 'Authentication';
      var authRows = ['bearerToken', 'bearerTokenEnvVar', 'httpHeaders', 'envHttpHeaders', 'scopes'];
      var allowedAuth = rules.authFields || [];
      for (var r = 0; r < authRows.length; r++) {
        var authRow = document.getElementById('mcp-row-' + authRows[r]);
        if (authRow) authRow.style.display = authVisible && allowedAuth.indexOf(authRows[r]) >= 0 ? '' : 'none';
      }

      // OAuth fields (Gemini SSE)
      document.getElementById('mcp-oauth-fields').style.display = (rules.oauth && transport === 'sse') ? '' : 'none';
    }

    function mcpSetTransport(t) {
      mcpCurrentTransport = t;
      var btns = document.querySelectorAll('#mcp-transport-toggle button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', ['stdio', 'sse', 'http'][i] === t);
      }
      mcpUpdateFieldVisibility();
    }

    function mcpAddEnvRow(key, val) {
      var list = document.getElementById('mcp-env-list');
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.25rem;';
      row.innerHTML = '<input class="settings-input mcp-env-key" style="width:40%;" placeholder="KEY" value="' + escapeHtml(key || '') + '">'
        + '<input class="settings-input mcp-env-val" style="flex:1;" placeholder="value" value="' + escapeHtml(val || '') + '">'
        + '<button class="btn btn-danger" style="padding:0.15rem 0.4rem;font-size:0.7rem;" onclick="this.parentElement.remove()">x</button>';
      list.appendChild(row);
    }

    function mcpShowAddModal() {
      mcpEditingServer = null;
      document.getElementById('mcp-modal-title').textContent = 'Add MCP Server';
      document.getElementById('mcp-input-name').value = '';
      document.getElementById('mcp-input-name').disabled = false;
      document.getElementById('mcp-modal-save').textContent = 'Create';
      mcpResetModalFields();
      mcpCurrentTransport = 'stdio';
      mcpSetTransport('stdio');
      mcpUpdateFieldVisibility();
      document.getElementById('mcp-modal').style.display = 'flex';
    }

    function mcpResetModalFields() {
      var ids = ['command', 'args', 'cwd', 'url', 'httpUrl', 'timeout', 'toolTimeout',
                 'includeTools', 'excludeTools', 'bearerToken', 'bearerTokenEnvVar',
                 'envHttpHeaders',
                 'httpHeaders', 'scopes', 'authProvider', 'oauth'];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById('mcp-input-' + ids[i]);
        if (el) el.value = '';
      }
      document.getElementById('mcp-input-trust').checked = false;
      document.getElementById('mcp-input-enabled').checked = true;
      document.getElementById('mcp-input-required').checked = false;
      document.getElementById('mcp-env-list').innerHTML = '';
    }

    function mcpFindServerEntry(identifier) {
      if (!mcpConfigData || !mcpConfigData.servers) return null;
      var names = Object.keys(mcpConfigData.servers);
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var srv = mcpConfigData.servers[name];
        if (name === identifier || (srv && srv.id === identifier)) {
          return { name: name, server: srv };
        }
      }
      return null;
    }

    function mcpEditServer(identifier) {
      var entry = mcpFindServerEntry(identifier);
      if (!entry) return;
      mcpEditingServer = entry.server.id || entry.name;
      var srv = entry.server;
      var name = entry.name;

      document.getElementById('mcp-modal-title').textContent = 'Edit: ' + name;
      document.getElementById('mcp-input-name').value = name;
      document.getElementById('mcp-input-name').disabled = true;
      document.getElementById('mcp-modal-save').textContent = 'Save';
      mcpResetModalFields();

      // Set transport
      var transport = srv.transport || 'stdio';
      mcpCurrentTransport = transport;
      mcpSetTransport(transport);

      // Populate fields
      if (srv.command) document.getElementById('mcp-input-command').value = srv.command;
      if (srv.args) document.getElementById('mcp-input-args').value = Array.isArray(srv.args) ? srv.args.join(', ') : srv.args;
      if (srv.cwd) document.getElementById('mcp-input-cwd').value = srv.cwd;
      if (srv.url) document.getElementById('mcp-input-url').value = srv.url;
      if (srv.httpUrl || (mcpCurrentTool === 'claude' && transport === 'http' && srv.url)) {
        document.getElementById('mcp-input-httpUrl').value = srv.httpUrl || srv.url;
      }
      if (srv.timeout != null) document.getElementById('mcp-input-timeout').value = srv.timeout;
      if (srv.toolTimeout != null) document.getElementById('mcp-input-toolTimeout').value = srv.toolTimeout;
      if (srv.trust) document.getElementById('mcp-input-trust').checked = true;
      if (srv.enabled === false) document.getElementById('mcp-input-enabled').checked = false;
      if (srv.required) document.getElementById('mcp-input-required').checked = true;
      if (srv.includeTools) document.getElementById('mcp-input-includeTools').value = Array.isArray(srv.includeTools) ? srv.includeTools.join(', ') : srv.includeTools;
      if (srv.excludeTools) document.getElementById('mcp-input-excludeTools').value = Array.isArray(srv.excludeTools) ? srv.excludeTools.join(', ') : srv.excludeTools;
      if (srv.bearerToken || srv.bearer_token) document.getElementById('mcp-input-bearerToken').value = srv.bearerToken || srv.bearer_token || '';
      if (srv.bearerTokenEnvVar) document.getElementById('mcp-input-bearerTokenEnvVar').value = srv.bearerTokenEnvVar;
      if (srv.httpHeaders || srv.headers) {
        var headerValue = srv.httpHeaders || srv.headers;
        try { document.getElementById('mcp-input-httpHeaders').value = typeof headerValue === 'string' ? headerValue : JSON.stringify(headerValue); } catch { /* non-serializable — skip */ }
      }
      if (srv.envHttpHeaders || srv.env_http_headers) {
        var envHeaderValue = srv.envHttpHeaders || srv.env_http_headers;
        try { document.getElementById('mcp-input-envHttpHeaders').value = typeof envHeaderValue === 'string' ? envHeaderValue : JSON.stringify(envHeaderValue); } catch { /* non-serializable — skip */ }
      }
      if (srv.scopes) document.getElementById('mcp-input-scopes').value = Array.isArray(srv.scopes) ? srv.scopes.join(', ') : srv.scopes;
      if (srv.authProvider) document.getElementById('mcp-input-authProvider').value = srv.authProvider;
      if (srv.oauth) {
        try { document.getElementById('mcp-input-oauth').value = typeof srv.oauth === 'string' ? srv.oauth : JSON.stringify(srv.oauth, null, 2); } catch { /* non-serializable — skip */ }
      }

      // Env vars
      document.getElementById('mcp-env-list').innerHTML = '';
      if (srv.env && typeof srv.env === 'object') {
        var envKeys = Object.keys(srv.env);
        for (var i = 0; i < envKeys.length; i++) {
          mcpAddEnvRow(envKeys[i], String(srv.env[envKeys[i]]));
        }
      }

      mcpUpdateFieldVisibility();
      document.getElementById('mcp-modal').style.display = 'flex';
    }

    function mcpCloseModal() {
      document.getElementById('mcp-modal').style.display = 'none';
      mcpEditingServer = null;
    }

    function mcpCollectDefinition() {
      var def = {};
      var transport = mcpCurrentTransport;

      if (transport === 'stdio') {
        var cmd = document.getElementById('mcp-input-command').value.trim();
        if (!cmd) { toast('Command is required for stdio', 'error'); return null; }
        def.command = cmd;
        var argsStr = document.getElementById('mcp-input-args').value.trim();
        if (argsStr) def.args = argsStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var cwd = document.getElementById('mcp-input-cwd').value.trim();
        if (cwd) def.cwd = cwd;
      } else if (transport === 'sse') {
        var url = document.getElementById('mcp-input-url').value.trim();
        if (!url) { toast('URL is required for SSE', 'error'); return null; }
        def.url = url;
      } else if (transport === 'http') {
        var httpUrl = document.getElementById('mcp-input-httpUrl').value.trim();
        if (!httpUrl) { toast('HTTP URL is required', 'error'); return null; }
        if (mcpCurrentTool === 'codex') {
          def.url = httpUrl;
        } else {
          def.httpUrl = httpUrl;
        }
      }

      // Env vars
      var envKeys = document.querySelectorAll('.mcp-env-key');
      var envVals = document.querySelectorAll('.mcp-env-val');
      var env = {};
      var hasEnv = false;
      for (var i = 0; i < envKeys.length; i++) {
        var k = envKeys[i].value.trim();
        if (k) { env[k] = envVals[i].value; hasEnv = true; }
      }
      if (hasEnv) def.env = env;

      // Advanced fields
      var rules = MCP_FIELD_RULES[mcpCurrentTool] || {};
      if (rules.advanced) {
        var allowed = rules.advancedFields || [];
        if (allowed.indexOf('timeout') >= 0) {
          var timeout = document.getElementById('mcp-input-timeout').value;
          if (timeout) def.timeout = Number(timeout);
        }
        if (allowed.indexOf('excludeTools') >= 0) {
          var et = document.getElementById('mcp-input-excludeTools').value.trim();
          if (et) def.excludeTools = et.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        }
        if (allowed.indexOf('enabled') >= 0) {
          def.enabled = document.getElementById('mcp-input-enabled').checked;
        }
        if (allowed.indexOf('required') >= 0) {
          def.required = document.getElementById('mcp-input-required').checked;
        }
        if (allowed.indexOf('includeTools') >= 0) {
          var it = document.getElementById('mcp-input-includeTools').value.trim();
          if (it) def.includeTools = it.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        }
      }

      // Auth
      if (rules.auth && (mcpCurrentTool === 'claude' ? transport !== 'stdio' : transport === 'http')) {
        var allowedAuth = rules.authFields || [];
        var bt = document.getElementById('mcp-input-bearerToken').value.trim();
        if (bt && allowedAuth.indexOf('bearerToken') >= 0) def.bearerToken = bt;
        var btEnv = document.getElementById('mcp-input-bearerTokenEnvVar').value.trim();
        if (btEnv && allowedAuth.indexOf('bearerTokenEnvVar') >= 0) def.bearerTokenEnvVar = btEnv;
        var hdrs = document.getElementById('mcp-input-httpHeaders').value.trim();
        if (hdrs && allowedAuth.indexOf('httpHeaders') >= 0) {
          try {
            var parsedHeaders = JSON.parse(hdrs);
            if (!parsedHeaders || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
              toast('HTTP Headers must be a JSON object', 'error');
              return null;
            }
            def.httpHeaders = parsedHeaders;
          } catch(e) {
            toast('Invalid HTTP Headers JSON', 'error');
            return null;
          }
        }
        var envHdrs = document.getElementById('mcp-input-envHttpHeaders').value.trim();
        if (envHdrs && allowedAuth.indexOf('envHttpHeaders') >= 0) {
          try {
            var parsedEnvHeaders = JSON.parse(envHdrs);
            if (!parsedEnvHeaders || typeof parsedEnvHeaders !== 'object' || Array.isArray(parsedEnvHeaders)) {
              toast('Env HTTP Headers must be a JSON object', 'error');
              return null;
            }
            def.envHttpHeaders = parsedEnvHeaders;
          } catch(e) {
            toast('Invalid Env HTTP Headers JSON', 'error');
            return null;
          }
        }
        var scopes = document.getElementById('mcp-input-scopes').value.trim();
        if (scopes && allowedAuth.indexOf('scopes') >= 0) def.scopes = scopes.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      }

      // OAuth (Gemini SSE)
      if (rules.oauth && transport === 'sse') {
        var ap = document.getElementById('mcp-input-authProvider').value.trim();
        if (ap) def.authProvider = ap;
        var oauthStr = document.getElementById('mcp-input-oauth').value.trim();
        if (oauthStr) {
          try { def.oauth = JSON.parse(oauthStr); } catch(e) { toast('Invalid OAuth JSON', 'error'); return null; }
        }
      }

      return def;
    }

    async function mcpSaveServer() {
      var name = document.getElementById('mcp-input-name').value.trim();
      if (!name) { toast('Server name is required', 'error'); return; }

      var def = mcpCollectDefinition();
      if (!def) return;

      var result;
      if (mcpEditingServer) {
        // PUT update
        result = await fetchApi('/api/mcp/servers/' + encodeURIComponent(mcpEditingServer), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transport: mcpCurrentTransport, definition: def })
        });
      } else {
        // POST create
        result = await fetchApi('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, tool: mcpCurrentTool, transport: mcpCurrentTransport, definition: def })
        });
      }

      if (result && (result.success || result.server || result.id)) {
        toast(mcpEditingServer ? 'Server updated' : 'Server created', 'success');
        mcpCloseModal();
        mcpLoadConfig();
      }
    }

    async function mcpDeleteServer(identifier) {
      var entry = mcpFindServerEntry(identifier);
      if (!entry) return;
      if (!confirm('Delete MCP server "' + entry.name + '"?')) return;
      var url = '/api/mcp/servers/' + encodeURIComponent(entry.server.id || entry.name);
      var result = await fetchApi(url, { method: 'DELETE' });
      if (result && result.success) {
        toast('Server deleted', 'success');
        mcpLoadConfig();
      }
    }

    async function mcpSaveGlobal() {
      toast('Gemini global MCP settings are read-only in Phase 2.', 'info');
    }
`;
