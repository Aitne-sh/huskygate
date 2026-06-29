/** @module dashboard/scripts/docs — Client-side script for the Docs tab. */
export const docsScript = `
    /* ── Docs ── */
    var docsActiveSection = 'about';

    var DOCS_SECTIONS = [
      { id: 'about',          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>', label: 'About' },
      { id: 'getting-started', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',  label: 'Getting Started' },
      { id: 'commands',        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',  label: 'Slack Commands' },
      { id: 'sessions',        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>', label: 'Sessions' },
      { id: 'apps',            icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/></svg>', label: 'Apps & Models' },
      { id: 'modes',           icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', label: 'Modes & Permissions' },
      { id: 'mcp',             icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>', label: 'MCP & Approvals' },
      { id: 'dev',             icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',  label: 'Developer Mode' },
      { id: 'workdir',         icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>', label: 'Working Directories' },
      { id: 'attachments',     icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>', label: 'File Attachments' },
      { id: 'dashboard',       icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>', label: 'Dashboard' },
      { id: 'agents',          icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', label: 'Agents' },
      { id: 'tasks',           icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', label: 'Tasks' },
      { id: 'event-triggers',  icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>', label: 'Event Triggers' },
      { id: 'config-ref',      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', label: 'Configuration' },
      { id: 'metrics',         icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>', label: 'Metrics' },
      { id: 'security',        icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>', label: 'Security & Audit' },
      { id: 'troubleshooting', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', label: 'Troubleshooting' },
      { id: 'faq',             icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>', label: 'FAQ' }
    ];

    var DOCS_CATEGORIES = [
      { title: 'Getting Started', items: ['about', 'getting-started'] },
      { title: 'Usage Guide', items: ['commands', 'sessions', 'apps', 'modes'] },
      { title: 'Features', items: ['mcp', 'agents', 'dev', 'workdir', 'attachments', 'tasks', 'event-triggers', 'dashboard'] },
      { title: 'Reference', items: ['config-ref', 'metrics', 'security', 'troubleshooting', 'faq'] }
    ];

    var DOCS_SUBTITLES = {
      'about': 'Overview of HuskyGate capabilities and architecture',
      'getting-started': 'Installation, configuration, and first steps',
      'commands': 'Complete reference for all Slack bang commands',
      'sessions': 'Session lifecycle, state management, and cleanup',
      'apps': 'Claude, Codex, and Gemini CLI configuration',
      'modes': 'Permission modes, write/readonly, and approval flow',
      'mcp': 'Model Context Protocol tools and OAuth authentication',
      'agents': 'Reusable AI agent personas with tool, skill, and MCP presets',
      'dev': 'Developer aliases for quick project access',
      'workdir': 'Working directory management and isolation',
      'attachments': 'File upload support and artifact delivery',
      'tasks': 'On-demand, scheduled, triggered, and orchestrated task execution',
      'event-triggers': 'Webhook endpoints, event subscriptions, and triggered tasks',
      'dashboard': 'Web dashboard features and tab overview',
      'config-ref': 'Complete reference for all configuration keys and environment variables',
      'metrics': 'Job activity charts, error analysis, and operational monitoring',
      'security': 'Secret masking, audit trail, and keychain integration',
      'troubleshooting': 'Common issues and their solutions',
      'faq': 'Frequently asked questions'
    };

    var DOCS_CONTENT = {
      'about':
        '<h2>About HuskyGate</h2>'
        + '<p>HuskyGate is a Slack-first orchestration layer for coding CLIs: '
        + '<strong>Claude Code</strong>, <strong>Codex CLI</strong>, and <strong>Gemini CLI</strong>. '
        + 'It provides session continuity, approval controls, queueing, workdir isolation, and a web dashboard on top of those CLIs.</p>'
        + '<h3>Current Implementation Snapshot</h3>'
        + '<ul>'
        + '<li><strong>TypeScript files</strong>: ~568 total (278 production + 290 tests).</li>'
        + '<li><strong>Main runtime areas</strong>: <code>src/slack/</code>, <code>src/dashboard/</code>, <code>src/runner/</code>, <code>src/store/</code>, <code>src/server/</code>, <code>src/session/</code>, <code>src/orchestrator/</code>, <code>src/event/</code>, <code>src/schedule/</code>, <code>src/queue/</code>, <code>src/shared/</code>, <code>src/workdir/</code>, <code>src/context/</code>, <code>src/instructions/</code>, <code>src/utils/</code>, <code>src/cli/</code>, <code>src/config/</code>.</li>'
        + '<li><strong>Persistence</strong>: SQLite (<code>data/orchestrator.db</code>) in WAL mode.</li>'
        + '</ul>'
        + '<h3>Core Capabilities</h3>'
        + '<ul>'
        + '<li><strong>Multi-tool sessions</strong> &mdash; one thread can keep multiple tool sessions and switch between them.</li>'
        + '<li><strong>Streaming output</strong> &mdash; CLI events stream to Slack and Dashboard chat (SSE).</li>'
        + '<li><strong>Approval gate</strong> &mdash; MCP/tool invocations are intercepted and approved/rejected by user.</li>'
        + '<li><strong>Mode control</strong> &mdash; <code>readonly</code>/<code>write</code> mode per session with confirmation codes.</li>'
        + '<li><strong>Workdir management</strong> &mdash; isolated per-session dirs, validated custom dirs, template + skill seeding.</li>'
        + '<li><strong>Task automation</strong> &mdash; on-demand, scheduled, triggered (webhook), and orchestrator (DAG) task execution.</li>'
        + '<li><strong>Event triggers</strong> &mdash; webhook endpoints with GitHub/Slack/Jira presets, signature verification, and Cloudflare Tunnel.</li>'
        + '<li><strong>AI agents</strong> &mdash; reusable agent personas with tool, skills, and MCP presets for orchestrator nodes.</li>'
        + '<li><strong>Observability</strong> &mdash; audit logs, runtime logs, 9+ metric charts, and dashboard stats.</li>'
        + '</ul>'
        + '<h3>Runtime Topology</h3>'
        + '<ul>'
        + '<li><strong>Server API</strong>: <code>127.0.0.1:3738</code> by default (<code>SERVER_API_PORT</code>).</li>'
        + '<li><strong>Dashboard UI</strong>: <code>http://localhost:3737</code> by default (CLI <code>dashboard start</code> port option).</li>'
        + '<li><strong>Bridge model</strong>: Dashboard proxies to Server API with bearer auth; browser uses dashboard cookie auth.</li>'
        + '</ul>'
        + '<h3>Execution Flow</h3>'
        + '<ol>'
        + '<li>Message ingress (Slack event or Dashboard chat request).</li>'
        + '<li>Parse command/prompt and resolve active session.</li>'
        + '<li>Queue job with global + per-session concurrency control.</li>'
        + '<li>Run tool-specific driver (Claude/Codex/Gemini) via Runner.</li>'
        + '<li>Persist audit + conversation rows and stream output to client.</li>'
        + '</ol>'
        + '<h3>Persistent Data</h3>'
        + '<p>Main tables (30 total): '
        + '<code>sessions</code>, <code>session_registry</code>, <code>thread_contexts</code>, <code>audit</code>, <code>dashboard_messages</code>, <code>dedupe</code>, <code>dev_aliases</code>, '
        + '<code>mcp_servers</code>, <code>session_mcp_servers</code>, <code>metadata</code>, <code>config</code>, <code>mode_changes</code>, <code>skill_enablement</code>, <code>job_queue</code>, '
        + '<code>scheduled_tasks</code>, <code>scheduled_task_runs</code>, <code>ondemand_tasks</code>, <code>ondemand_task_runs</code>, '
        + '<code>orchestrators</code>, <code>orchestrator_nodes</code>, <code>orchestrator_edges</code>, <code>orchestration_runs</code>, <code>orchestration_node_runs</code>, '
        + '<code>webhook_endpoints</code>, <code>webhook_deliveries</code>, <code>triggered_tasks</code>, <code>triggered_task_runs</code>, <code>event_subscriptions</code>, '
        + '<code>default_instructions</code>, <code>ai_agents</code>.</p>'
        + '<div class="docs-tip"><strong>Note:</strong> Session mode defaults: all three tools default to write. '
        + 'Configurable via <code>CLAUDE_DEFAULT_MODE</code>, <code>CODEX_DEFAULT_SANDBOX_MODE</code>, <code>GEMINI_DEFAULT_MODE</code> in Settings.</div>',

      'getting-started':
        '<h2>Getting Started</h2>'
        + '<h3>Prerequisites</h3>'
        + '<ul>'
        + '<li>Node.js 22+ installed on your machine</li>'
        + '<li>At least one CLI tool installed: <code>claude</code>, <code>codex</code>, or <code>gemini</code></li>'
        + '<li>A Slack workspace with permissions to create an app</li>'
        + '</ul>'
        + '<h3>1. Create a Slack App</h3>'
        + '<p><strong>Option A: Interactive setup (recommended)</strong></p>'
        + '<p>After building (<code>npm install &amp;&amp; npm run build &amp;&amp; npm link</code>), run:</p>'
        + '<pre><code>huskygate setup</code></pre>'
        + '<p>This interactive wizard guides you through Slack app creation with the correct manifest, scopes, and token configuration. '
        + 'Use <code>--open</code> to auto-open the Slack app creation page, or <code>--manifest-only</code> to print the app manifest JSON.</p>'
        + '<table class="docs-cmd-table"><thead><tr><th>Option</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>huskygate setup</code></td><td>Interactive guided setup.</td></tr>'
        + '<tr><td><code>huskygate setup --open</code></td><td>Open the setup URL in your browser.</td></tr>'
        + '<tr><td><code>huskygate setup --manifest-only</code></td><td>Print the Slack app manifest JSON and exit.</td></tr>'
        + '<tr><td><code>huskygate setup --status</code></td><td>Check if setup has been completed.</td></tr>'
        + '<tr><td><code>huskygate setup --reset</code></td><td>Clear all setup-related configuration (with confirmation).</td></tr>'
        + '</tbody></table>'
        + '<p><strong>Option B: Manual Slack App creation</strong></p>'
        + '<ol>'
        + '<li>Go to <strong>api.slack.com/apps</strong> and click &ldquo;Create New App&rdquo;.</li>'
        + '<li>Choose &ldquo;From an app manifest&rdquo; or configure manually.</li>'
        + '<li>Enable <strong>Socket Mode</strong> under &ldquo;Socket Mode&rdquo; settings.</li>'
        + '<li>Generate an <strong>App-Level Token</strong> with <code>connections:write</code> scope.</li>'
        + '<li>Under &ldquo;OAuth &amp; Permissions&rdquo;, add the required Bot Token Scopes:<br>'
        + '<code>chat:write</code>, <code>files:read</code>, <code>files:write</code>, <code>app_mentions:read</code>, <code>channels:history</code>, <code>groups:history</code>, <code>im:history</code>, <code>mpim:history</code>.</li>'
        + '<li>Install the app to your workspace and copy the <strong>Bot User OAuth Token</strong> (<code>xoxb-...</code>).</li>'
        + '</ol>'
        + '<h3>2. Configure Credentials</h3>'
        + '<p><strong>Recommended: Dashboard UI (secure)</strong></p>'
        + '<p>The dashboard provides a Settings panel for configuring all credentials. '
        + 'On <strong>macOS</strong>, <strong>Linux</strong>, and <strong>Windows</strong>, sensitive values (API tokens, secret keys) are automatically stored in the <strong>OS Keychain</strong> '
        + '(macOS Keychain / Linux Secret Service / Windows Credential Manager) instead of plaintext files, providing OS-level encryption at rest.</p>'
        + '<ol>'
        + '<li>Start the dashboard: <code>huskygate dashboard</code></li>'
        + '<li>Open <code>http://localhost:3737</code> in your browser.</li>'
        + '<li>Navigate to <strong>Settings &rarr; Messaging &rarr; Slack</strong>.</li>'
        + '<li>Enter your <code>SLACK_BOT_TOKEN</code>, <code>SLACK_APP_TOKEN</code>, and <code>ALLOWED_USER_IDS</code>, then click <strong>Save</strong>.</li>'
        + '<li>Sensitive values are automatically routed to the OS Keychain when available.</li>'
        + '</ol>'
        + '<div class="docs-tip"><strong>Security:</strong> When Keychain is available, sensitive keys (tokens, secrets, API keys) are stored with OS-level encryption. '
        + 'The <code>.env</code> file only contains non-sensitive configuration. Values stored in Keychain are never exposed in API responses &mdash; they appear as <code>***</code> in the UI.</div>'
        + '<p><strong>Alternative: Manual <code>.env</code> file (fallback)</strong></p>'
        + '<p>If the OS Keychain is unavailable (e.g. headless servers without a desktop session), you can configure credentials via <code>.env</code>:</p>'
        + '<pre><code>'
        + 'cp .env.example .env\\n'
        + '# Edit .env and set required values:\\n'
        + 'SLACK_BOT_TOKEN=xoxb-your-bot-token\\n'
        + 'SLACK_APP_TOKEN=xapp-your-app-token\\n'
        + 'ALLOWED_USER_IDS=U12345678'
        + '</code></pre>'
        + '<p>The <code>.env</code> file is written with <code>0600</code> permissions (owner read/write only). '
        + 'Managed settings are stored in DB + Keychain automatically.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> Find your Slack User ID by clicking on your profile in Slack &gt; &ldquo;Copy member ID&rdquo;. '
        + '<code>ALLOWED_USER_IDS</code> is required &mdash; only listed users can interact with the bot.</div>'
        + '<h4>Credential Storage Priority</h4>'
        + '<p>At startup, HuskyGate loads credentials in this order (higher priority wins):</p>'
        + '<ol>'
        + '<li><strong>OS Keychain</strong> (macOS Keychain / Linux Secret Service / Windows Credential Manager) &mdash; encrypted, preferred</li>'
        + '<li><strong><code>.env</code> file</strong> &mdash; plaintext fallback</li>'
        + '<li><strong>Default values</strong> (where applicable)</li>'
        + '</ol>'
        + '<h4>Keychain CLI Commands</h4>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>huskygate keychain status</code></td><td>Check Keychain availability on your platform.</td></tr>'
        + '<tr><td><code>huskygate keychain list</code></td><td>List keys currently stored in Keychain.</td></tr>'
        + '</tbody></table>'
        + '<h3>3. Build &amp; Register CLI</h3>'
        + '<pre><code>npm install\\nnpm run build\\nnpm link</code></pre>'
        + '<p><code>npm link</code> registers the <code>huskygate</code> command globally so you can run it from anywhere. '
        + 'After this step, <code>huskygate start</code>, <code>huskygate dashboard</code>, etc. are available in your terminal.</p>'
        + '<div class="docs-tip"><strong>Note:</strong> If you skip <code>npm link</code>, you can still use <code>node dist/cli.js &lt;command&gt;</code> instead of <code>huskygate &lt;command&gt;</code>.</div>'
        + '<h3>4. Start HuskyGate</h3>'
        + '<p><strong>Recommended: Dashboard-first flow</strong></p>'
        + '<pre><code>huskygate dashboard          # Dashboard only &mdash; configure credentials via Settings\\nhuskygate start              # Start server + dashboard together</code></pre>'
        + '<p><strong>Alternative: Direct start</strong> (requires credentials already configured via Keychain or <code>.env</code>):</p>'
        + '<pre><code>huskygate start</code></pre>'
        + '<p>This starts server + dashboard together. Default endpoints:</p>'
        + '<ul>'
        + '<li>Dashboard: <code>http://localhost:3737</code></li>'
        + '<li>Internal Server API: <code>127.0.0.1:3738</code></li>'
        + '</ul>'
        + '<h3>CLI Command Reference</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>huskygate setup</code></td><td>Interactive first-time setup. Options: <code>--open</code>, <code>--manifest-only</code>, <code>--status</code>, <code>--reset</code></td></tr>'
        + '<tr><td><code>huskygate start</code></td><td>Start server + dashboard (background). Options: <code>--port</code>, <code>--no-open</code>, <code>--force</code></td></tr>'
        + '<tr><td><code>huskygate stop</code></td><td>Stop both server and dashboard.</td></tr>'
        + '<tr><td><code>huskygate restart</code></td><td>Restart both processes.</td></tr>'
        + '<tr><td><code>huskygate status</code></td><td>Show running status of both processes.</td></tr>'
        + '<tr><td><code>huskygate server start</code></td><td>Start only the server daemon. Use <code>--force</code> to stop existing first.</td></tr>'
        + '<tr><td><code>huskygate server stop</code></td><td>Stop the server daemon.</td></tr>'
        + '<tr><td><code>huskygate server status</code></td><td>Show server daemon status.</td></tr>'
        + '<tr><td><code>huskygate dashboard</code></td><td>Start only the dashboard (auto-opens browser). Options: <code>--port</code>, <code>--no-open</code>, <code>--force</code></td></tr>'
        + '<tr><td><code>huskygate dashboard stop</code></td><td>Stop the dashboard daemon.</td></tr>'
        + '<tr><td><code>huskygate dashboard status</code></td><td>Show dashboard status.</td></tr>'
        + '<tr><td><code>huskygate dev</code></td><td>Run server in foreground (development mode, no dashboard).</td></tr>'
        + '<tr><td><code>huskygate keychain status</code></td><td>Check OS keychain availability.</td></tr>'
        + '<tr><td><code>huskygate keychain list</code></td><td>List keys stored in the OS keychain.</td></tr>'
        + '</tbody></table>'
        + '<h3>5. Start Using</h3>'
        + '<p>In any Slack channel where the bot is invited, start a thread and type:</p>'
        + '<pre><code>!claude Hello, can you see this directory?</code></pre>'
        + '<p>The bot will create a session using Claude and execute the prompt. You can also type <code>!menu</code> '
        + 'to open the interactive dashboard with tool-selection buttons.</p>',

      'commands':
        '<h2>Slack Commands Reference</h2>'
        + '<p>All commands start with <code>!</code> (full-width <code>\\uFF01</code> is also accepted). '
        + 'Commands are case-insensitive.</p>'
        + '<h3>Help &amp; Navigation</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!help</code></td><td>Display the full list of available commands.</td></tr>'
        + '<tr><td><code>!menu</code></td><td>Open the interactive dashboard with tool-selection buttons, session controls, and dev aliases.</td></tr>'
        + '</tbody></table>'
        + '<h3>Session Management</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!s</code></td><td>Show the list of sessions in the current thread. Alias: <code>!session</code></td></tr>'
        + '<tr><td><code>!current</code></td><td>Show the currently active session details (ID, tool, mode, model, workdir).</td></tr>'
        + '<tr><td><code>!session &lt;id&gt;</code></td><td>Resume a previously created session by its ID.</td></tr>'
        + '<tr><td><code>!session-clear &lt;id&gt;</code></td><td>Delete a specific session and its working directory.</td></tr>'
        + '<tr><td><code>!session-clear all</code></td><td>Delete all sessions in the current thread.</td></tr>'
        + '<tr><td><code>!exit</code></td><td>Leave the currently active session.</td></tr>'
        + '</tbody></table>'
        + '<h3>App Switching</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!claude</code></td><td>Switch to or create a Claude session (resumes latest if one exists).</td></tr>'
        + '<tr><td><code>!codex</code></td><td>Switch to or create a Codex session.</td></tr>'
        + '<tr><td><code>!gemini</code></td><td>Switch to or create a Gemini session.</td></tr>'
        + '<tr><td><code>!claude &lt;prompt&gt;</code> / <code>!codex &lt;prompt&gt;</code> / <code>!gemini &lt;prompt&gt;</code></td><td>Execute with the selected app (auto-creates session if needed).</td></tr>'
        + '<tr><td><code>!new claude</code></td><td>Start a brand new Claude session. Also: <code>!new codex</code>, <code>!new gemini</code>.</td></tr>'
        + '</tbody></table>'
        + '<h3>Model Selection</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!model</code></td><td>Show the current model for the active session. Alias: <code>!m</code></td></tr>'
        + '<tr><td><code>!model &lt;name&gt;</code></td><td>Set the model for the current session. Aliases: <code>!m &lt;name&gt;</code>, <code>!m=&lt;name&gt;</code></td></tr>'
        + '<tr><td><code>!model default</code></td><td>Reset to the default model (uses CLI built-in default).</td></tr>'
        + '</tbody></table>'
        + '<h3>On-Demand Tasks</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!task &lt;name|alias&gt;</code> / <code>!t &lt;name|alias&gt;</code></td><td>Execute a configured on-demand task immediately.</td></tr>'
        + '</tbody></table>'
        + '<h3>Orchestrator</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!orch &lt;alias-or-id&gt;</code> / <code>!o &lt;alias-or-id&gt;</code></td><td>Start an orchestrator run manually.</td></tr>'
        + '<tr><td><code>!orch list</code> / <code>!o list</code></td><td>List active orchestrators.</td></tr>'
        + '<tr><td><code>!orch status &lt;alias-or-id&gt;</code> / <code>!o status &lt;alias-or-id&gt;</code></td><td>Show recent runs for the target orchestrator.</td></tr>'
        + '<tr><td><code>!orch cancel &lt;runId&gt;</code> / <code>!o cancel &lt;runId&gt;</code></td><td>Cancel a running orchestration.</td></tr>'
        + '</tbody></table>'
        + '<h3>Run Control</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!stop</code></td><td>Stop the currently running job.</td></tr>'
        + '<tr><td><code>!status</code></td><td>Show the queue status: active session, mode, model, running job, and pending count.</td></tr>'
        + '<tr><td><code>!reset</code></td><td>Reset the active session (clears conversation context and restarts).</td></tr>'
        + '</tbody></table>'
        + '<h3>Approval &amp; Confirmation</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!yes</code> / <code>!y</code></td><td>Approve a pending tool execution or MCP auth request.</td></tr>'
        + '<tr><td><code>!no</code> / <code>!n</code></td><td>Reject a pending request.</td></tr>'
        + '<tr><td><code>!confirm &lt;CODE&gt;</code></td><td>Confirm a mode or workdir change using the 4-character code.</td></tr>'
        + '</tbody></table>'
        + '<h3>Mode &amp; Working Directory</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!mode=readonly</code></td><td>Switch to read-only mode (immediate).</td></tr>'
        + '<tr><td><code>!mode=write</code></td><td>Request write mode (requires <code>!confirm XXXX</code> within 30 seconds).</td></tr>'
        + '<tr><td><code>!mode=net</code></td><td>Currently disabled (responds with guidance to use readonly/write).</td></tr>'
        + '<tr><td><code>!workdir</code></td><td>Show the current working directory.</td></tr>'
        + '<tr><td><code>!workdir=&lt;path&gt;</code></td><td>Request a directory change (requires confirmation).</td></tr>'
        + '<tr><td><code>!workdir=reset</code></td><td>Reset working directory to the session default.</td></tr>'
        + '</tbody></table>'
        + '<h3>Auto-Approve Mode</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!autorun</code></td><td>Toggle auto-approve for the current session (write mode only).</td></tr>'
        + '<tr><td><code>!autorun on</code> / <code>!autorun off</code></td><td>Explicitly enable/disable auto-approve (write mode only).</td></tr>'
        + '</tbody></table>'
        + '<div class="docs-tip"><strong>Note:</strong> Auto-approve is only available in write mode. In readonly mode, MCP tools and write tools are out of scope.</div>'
        + '<h3>MCP Server Control</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!mcp</code></td><td>Show the list of MCP servers available for the current session.</td></tr>'
        + '<tr><td><code>!mcp + &lt;server&gt;</code></td><td>Enable an MCP server for the current session.</td></tr>'
        + '<tr><td><code>!mcp - &lt;server&gt;</code></td><td>Disable an MCP server for the current session.</td></tr>'
        + '<tr><td><code>!mcp reset</code></td><td>Reset MCP server selection to defaults for the current session.</td></tr>'
        + '</tbody></table>'
        + '<h3>Developer Mode</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Command</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>!dev</code></td><td>Show all developer aliases.</td></tr>'
        + '<tr><td><code>!dev &lt;alias&gt;</code></td><td>Start or resume a developer session with the specified alias.</td></tr>'
        + '<tr><td><code>!new-dev &lt;alias&gt;</code></td><td>Clear and restart a developer session with the specified alias.</td></tr>'
        + '</tbody></table>',

      'sessions':
        '<h2>Sessions</h2>'
        + '<p>HuskyGate manages sessions per Slack thread. Each thread can have multiple sessions '
        + '(e.g., one for Claude and one for Gemini), but only one can be <strong>active</strong> at a time.</p>'
        + '<h3>Session Lifecycle</h3>'
        + '<ol>'
        + '<li><strong>Creation</strong> &mdash; A session is created when you first use a tool command (e.g., <code>!claude</code>). '
        + 'A unique session ID is generated and a dedicated working directory is provisioned.</li>'
        + '<li><strong>Active</strong> &mdash; Messages sent in the thread are forwarded to the active session\\u2019s CLI process.</li>'
        + '<li><strong>Switching</strong> &mdash; Use <code>!exit</code> to leave the current session, then start or resume another.</li>'
        + '<li><strong>Resuming</strong> &mdash; Use <code>!session &lt;id&gt;</code> or the <code>!menu</code> Resume button to resume a previous session with its full context.</li>'
        + '<li><strong>Auto-exit</strong> &mdash; Sessions automatically exit after a configurable period of inactivity (default: <strong>24 hours</strong>, set via <code>SESSION_IDLE_TIMEOUT_SEC</code> in Settings). The bot posts a notification and clears all pending approvals.</li>'
        + '</ol>'
        + '<h3>Session State</h3>'
        + '<p>Each session persists the following in SQLite:</p>'
        + '<ul>'
        + '<li><strong>Tool</strong> &mdash; Which CLI is in use (claude / codex / gemini).</li>'
        + '<li><strong>Mode</strong> &mdash; Current permission mode (readonly / write).</li>'
        + '<li><strong>Model</strong> &mdash; Session-level model override (if set).</li>'
        + '<li><strong>Working directory</strong> &mdash; The filesystem path the CLI operates in.</li>'
        + '<li><strong>Tool state</strong> &mdash; Tool-specific metadata (e.g., Claude <code>session_id</code> for resume, Gemini <code>session_index</code>).</li>'
        + '</ul>'
        + '<h3>Session Cleanup</h3>'
        + '<p>When a session is deleted (<code>!session-clear &lt;id&gt;</code>), its working directory is also removed '
        + '(unless it lives outside <code>WORKDIR_ROOT</code>, e.g., a dev alias directory). '
        + 'Use <code>!session-clear all</code> to delete every session in the thread at once.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> You can have sessions for different tools in the same thread. '
        + 'Use <code>!exit</code> to leave one before switching to another. The <code>!menu</code> dashboard shows all sessions with Resume buttons.</div>'
        + '<h3>Dashboard Chat Sessions</h3>'
        + '<p>Sessions can also be created and used from the Dashboard <strong>Chat</strong> tab without Slack. '
        + 'Dashboard chat supports tool selection, mode choice at creation, real-time SSE streaming, file upload, and tool approval &mdash; all through the browser.</p>',

      'apps':
        '<h2>Apps &amp; Models</h2>'
        + '<p>HuskyGate supports three AI coding assistants. Each runs as a local CLI process spawned per job.</p>'
        + '<h3>Claude Code (Anthropic)</h3>'
        + '<p>Anthropic\\u2019s Claude Code CLI. Requires <code>ANTHROPIC_API_KEY</code> (or Bedrock / Vertex credentials).</p>'
        + '<ul>'
        + '<li>Default model: CLI default (typically the latest Sonnet).</li>'
        + '<li>Override: <code>CLAUDE_MODEL</code> in Settings or <code>!model &lt;name&gt;</code> per session.</li>'
        + '<li>Examples: <code>opus</code>, <code>claude-opus-4-6</code>, <code>claude-sonnet-4-6</code></li>'
        + '<li><strong>Session resume</strong>: Claude sessions are resumed via <code>--session-id</code>. The session ID is pre-stored before execution so that even early terminations preserve CLI conversation history.</li>'
        + '<li><strong>MCP auth</strong>: Set <code>CLAUDE_MCP_AUTH_SERVER</code> to enable automatic OAuth pre-auth for a specific MCP server.</li>'
        + '</ul>'
        + '<h3>Codex CLI (OpenAI)</h3>'
        + '<p>OpenAI\\u2019s Codex CLI. Requires <code>OPENAI_API_KEY</code>.</p>'
        + '<ul>'
        + '<li>Default model: CLI default.</li>'
        + '<li>Override: <code>CODEX_MODEL</code> in Settings or <code>!model &lt;name&gt;</code> per session.</li>'
        + '<li>Examples: <code>o3</code>, <code>o3-pro</code></li>'
        + '<li><strong>Approval mode</strong>: Controlled by <code>CODEX_ASK_FOR_APPROVAL</code>. Values: <code>on-request</code> (default), <code>on-failure</code>, <code>untrusted</code>, <code>never</code>.</li>'
        + '<li><strong>MCP auth</strong>: Set <code>CODEX_MCP_AUTH_SERVER</code> if your Codex setup uses MCP servers with OAuth.</li>'
        + '</ul>'
        + '<h3>Gemini CLI (Google)</h3>'
        + '<p>Google\\u2019s Gemini CLI. Requires <code>GOOGLE_API_KEY</code> or <code>GEMINI_API_KEY</code>.</p>'
        + '<ul>'
        + '<li>Default model: CLI default.</li>'
        + '<li>Override: <code>GEMINI_MODEL</code> in Settings or <code>!model &lt;name&gt;</code> per session.</li>'
        + '<li>Examples: <code>gemini-2.5-pro</code>, <code>gemini-2.0-flash</code></li>'
        + '<li><strong>Runtime isolation</strong>: Each Gemini job runs with an isolated runtime home directory (<code>.gemini_runtime_home/</code>) inside the session workdir. '
        + 'HuskyGate copies settings and OAuth tokens from <code>~/.gemini</code>, normalizes MCP server URLs and aliases, '
        + 'then sets <code>GEMINI_CLI_HOME</code> to this directory. After execution, credential files (<code>oauth_creds.json</code>, <code>mcp-oauth-tokens.json</code>, etc.) are automatically cleaned up. '
        + 'This folder is transient and can be safely deleted.</li>'
        + '<li><strong>MCP auth</strong>: Set <code>GEMINI_MCP_AUTH_SERVER</code> to enable MCP OAuth token alias repair and pre-auth.</li>'
        + '</ul>'
        + '<h3>Model Priority Chain</h3>'
        + '<p>When deciding which model to use, HuskyGate checks in order:</p>'
        + '<ol>'
        + '<li><strong>Session model</strong> &mdash; Set via <code>!model &lt;name&gt;</code>. Applies only to the current session.</li>'
        + '<li><strong>Environment variable</strong> &mdash; <code>CLAUDE_MODEL</code> / <code>CODEX_MODEL</code> / <code>GEMINI_MODEL</code> from Settings.</li>'
        + '<li><strong>CLI default</strong> &mdash; If none is set, no <code>--model</code> flag is passed and the CLI uses its own default.</li>'
        + '</ol>'
        + '<div class="docs-tip"><strong>Tip:</strong> Setting the model to <code>default</code> (via <code>!model default</code> or in Settings) '
        + 'clears the override &mdash; the CLI\\u2019s own default model will be used.</div>',

      'modes':
        '<h2>Modes &amp; Permissions</h2>'
        + '<p>HuskyGate starts every session in <strong>write mode</strong> by default, enabling full tool access including network and file writes. '
        + 'Each tool\\u2019s default mode is configurable via Settings: <code>CLAUDE_DEFAULT_MODE</code>, <code>CODEX_DEFAULT_SANDBOX_MODE</code>, <code>GEMINI_DEFAULT_MODE</code>.</p>'
        + '<h3>Write Mode (default)</h3>'
        + '<p>In write mode, the CLI tool has full access: reading and writing files, executing shell commands, and making outbound network calls. '
        + 'Cloud CLI skills (AWS, Azure, GCP), Playwright, and Perplexity all require write mode to function.</p>'
        + '<div class="docs-warn"><strong>Note (Codex):</strong> In write mode, Codex runs with <code>--dangerously-bypass-approvals-and-sandbox</code> to fully bypass the OS-level sandbox (macOS Seatbelt). '
        + 'This is required for browser automation (Playwright/Chrome) which needs local socket binding, and for skills that call external APIs.</div>'
        + '<h3>Read-Only Mode</h3>'
        + '<p>In read-only mode, the CLI tool can read files and answer questions but cannot modify your codebase or make network calls (Codex). '
        + 'This is the safest mode for general queries and code review.</p>'
        + '<div class="docs-warn"><strong>Warning:</strong> In Codex read-only mode, the OS-level <em>read-only</em> sandbox blocks all network access. '
        + 'Cloud CLI skills and other network-dependent skills <strong>will not function</strong>.</div>'
        + '<p>To switch to read-only mode:</p>'
        + '<pre><code>!mode=readonly</code></pre>'
        + '<h3>Switching to Write Mode</h3>'
        + '<p>If a session is in read-only mode, request write mode:</p>'
        + '<pre><code>!mode=write</code></pre>'
        + '<p>The bot responds with a random 4-character alphanumeric confirmation code. You must reply within <strong>30 seconds</strong>:</p>'
        + '<pre><code>!confirm XXXX</code></pre>'
        + '<p>This two-step confirmation prevents accidental writes.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> Both write and read-only modes are permanent until explicitly changed. '
        + 'Switch back with <code>!mode=readonly</code> at any time.</div>'
        + '<h3>Read-Only Permission Modes</h3>'
        + '<p>Claude and Gemini support a fine-grained read-only permission mode that controls CLI behavior when in read-only mode:</p>'
        + '<ul>'
        + '<li><code>CLAUDE_READONLY_PERMISSION_MODE</code> &mdash; <code>default</code> or <code>plan</code>. When set to <code>plan</code>, Claude enters plan mode in read-only sessions.</li>'
        + '<li><code>GEMINI_READONLY_APPROVAL_MODE</code> &mdash; <code>default</code> or <code>plan</code>. Controls Gemini\\u2019s behavior similarly.</li>'
        + '</ul>'
        + '<p>Configure these in Settings &gt; Apps.</p>'
        + '<h3>Tool Approval (MCP)</h3>'
        + '<p>When a CLI tool requests permission to execute a specific action (e.g., a shell command or MCP tool call), '
        + 'HuskyGate intercepts the request and presents it in Slack with <strong>Approve</strong> / <strong>Reject</strong> buttons. '
        + 'You can also reply with <code>!yes</code> or <code>!no</code>. See the <em>MCP &amp; Approvals</em> section for full details.</p>',

      'mcp':
        '<h2>MCP &amp; Approvals</h2>'
        + '<p>HuskyGate intercepts MCP (Model Context Protocol) tool calls and authentication requests, presenting them to the user for approval before execution.</p>'
        + '<h3>Tool Approval Flow</h3>'
        + '<ol>'
        + '<li>The CLI attempts to use an MCP tool (e.g., <code>Bash</code>, <code>Write</code>, a custom MCP server tool).</li>'
        + '<li>HuskyGate captures the request and posts a Block Kit message showing the tool name and arguments.</li>'
        + '<li>The user approves via the <strong>Approve</strong> button or <code>!yes</code> / <code>!y</code>, or rejects via <strong>Reject</strong> / <code>!no</code> / <code>!n</code>.</li>'
        + '<li>On approval, the previous prompt is automatically re-run with the approved tool whitelisted for one execution.</li>'
        + '<li>The approval request expires after <strong>2 minutes</strong> if no response is given.</li>'
        + '</ol>'
        + '<div class="docs-tip"><strong>Tip:</strong> Only the user who initiated the original request can approve or reject the tool execution.</div>'
        + '<h3>MCP Auth (OAuth) Flow</h3>'
        + '<p>When an MCP server requires OAuth authentication, HuskyGate presents two options:</p>'
        + '<ul>'
        + '<li><strong>Re-authenticate &amp; retry</strong> &mdash; Runs a pre-auth discovery check against the MCP server, then retries the prompt.</li>'
        + '<li><strong>Skip auth check &amp; retry</strong> &mdash; Bypasses the OAuth preflight for one run (useful when tokens are already valid).</li>'
        + '</ul>'
        + '<p>This request also expires after <strong>2 minutes</strong>.</p>'
        + '<h3>MCP Server Configuration</h3>'
        + '<p>Each tool can have an MCP auth server configured in Settings:</p>'
        + '<ul>'
        + '<li><code>CLAUDE_MCP_AUTH_SERVER</code> &mdash; MCP server name for Claude OAuth.</li>'
        + '<li><code>GEMINI_MCP_AUTH_SERVER</code> &mdash; MCP server name for Gemini OAuth.</li>'
        + '<li><code>CODEX_MCP_AUTH_SERVER</code> &mdash; MCP server name for Codex OAuth.</li>'
        + '</ul>'
        + '<p>When set, HuskyGate automatically handles token refresh failures and presents the approval flow. '
        + 'Claude MCP servers managed in the Dashboard are stored in SQLite and materialized into '
        + '<code>&lt;workdir&gt;/.huskygate/</code> as a generated strict config at execution time. '
        + '<code>CLAUDE_MCP_CONFIG_PATH</code> remains available for manual/operator compatibility, while '
        + '<code>GEMINI_MCP_CONFIG_PATH</code> and <code>CODEX_MCP_CONFIG_PATH</code> control the file-based configs for Gemini and Codex.</p>'
        + '<div class="docs-warn"><strong>Claude setting scope:</strong> HuskyGate passes <code>--setting-sources project</code> by default. '
        + 'That means user-level settings from <code>~/.claude/settings.json</code> such as global <code>CLAUDE.md</code>, permissions, and MCP definitions are not loaded unless the session overrides <code>claude_setting_sources</code> (for example <code>user,project</code>).</div>',

      'dev':
        '<h2>Developer Mode</h2>'
        + '<p>Developer aliases let you pre-configure project settings for quick access. Each alias stores:</p>'
        + '<ul>'
        + '<li><strong>Working directory</strong> &mdash; The project directory to use (can be outside <code>ALLOWED_WORKDIR_ROOTS</code>).</li>'
        + '<li><strong>CLI tool</strong> &mdash; Which AI assistant to use (claude / codex / gemini).</li>'
        + '<li><strong>Custom instructions</strong> &mdash; Additional instructions passed to the CLI as a system prompt.</li>'
        + '</ul>'
        + '<h3>Creating an Alias</h3>'
        + '<p>Use the Dashboard &gt; Developer page to create aliases. Click &ldquo;+ New Alias&rdquo; and fill in the name, tool, '
        + 'working directory path, and optional instructions. The directory path is validated on creation and can be auto-created if it does not exist.</p>'
        + '<h3>Using an Alias</h3>'
        + '<pre><code>!dev my-project</code></pre>'
        + '<p>This creates or resumes a session with the pre-configured settings for &ldquo;my-project&rdquo;. '
        + 'The working directory is set to the alias path, and instruction files are seeded into the project.</p>'
        + '<pre><code>!new-dev my-project</code></pre>'
        + '<p>This clears any existing session for the alias and starts fresh.</p>'
        + '<h3>Listing Aliases</h3>'
        + '<pre><code>!dev</code></pre>'
        + '<p>Shows all available developer aliases with their tool and path.</p>'
        + '<div class="docs-warn"><strong>Note:</strong> Dev alias directories bypass the <code>ALLOWED_WORKDIR_ROOTS</code> restriction. '
        + 'When a dev session is deleted, its working directory is <strong>not</strong> removed (since it points to your real project). '
        + 'The <code>!menu</code> dashboard also shows dev alias buttons for quick access.</div>',

      'workdir':
        '<h2>Working Directories</h2>'
        + '<p>Each session has an associated working directory where the CLI tool reads and writes files.</p>'
        + '<h3>Default Behavior</h3>'
        + '<p>The base directory is set by <code>WORKDIR_ROOT</code> (default: <code>./workdir</code>). '
        + 'Each session automatically gets its own isolated directory under this root.</p>'
        + '<h3>Changing Working Directory</h3>'
        + '<p>To point a session at a specific project:</p>'
        + '<pre><code>!workdir=/Users/me/projects/my-app</code></pre>'
        + '<p>This requires a 4-character confirmation code (like write mode). The target path must be under one of the directories listed in '
        + '<code>ALLOWED_WORKDIR_ROOTS</code>.</p>'
        + '<p>To reset back to the session default:</p>'
        + '<pre><code>!workdir=reset</code></pre>'
        + '<h3>Workdir Isolation</h3>'
        + '<p>Each session workdir is created using a SHA-256 hash of the session key (first 12 characters), '
        + 'resulting in the path <code>WORKDIR_ROOT/sess_&lt;hash&gt;</code>. This ensures unique, collision-free directories per session.</p>'
        + '<h3>Instruction &amp; Skill Seeding</h3>'
        + '<p>When a session workdir is initialized, HuskyGate seeds the following into the directory:</p>'
        + '<ul>'
        + '<li><strong>Instruction file</strong> &mdash; A tool-specific instruction file (<code>CLAUDE.md</code>, <code>AGENTS.md</code>, or <code>GEMINI.md</code>) is generated from code-managed sections and written into the workdir.</li>'
        + '<li><strong>Skills</strong> &mdash; Enabled built-in skills are copied into the tool-specific skill directory '
        + '(Claude: <code>.claude/skills/</code>, Gemini: <code>.gemini/skills/</code>, Codex: <code>.agents/skills/</code>). '
        + 'Custom skills from <code>.huskygate/skills/</code> are also seeded.</li>'
        + '</ul>'
        + '<h3>MCP Config Materialization</h3>'
        + '<p>For Claude sessions, dashboard-managed MCP server configurations are rendered into '
        + '<code>&lt;workdir&gt;/.huskygate/claude.mcp.json</code> at execution time with <code>0600</code> permissions. '
        + 'Ownership is tracked via a sidecar metadata file to prevent conflicts.</p>',

      'attachments':
        '<h2>File Attachments</h2>'
        + '<p>You can attach files to your Slack messages and they will be forwarded to the CLI tool as part of the prompt.</p>'
        + '<h3>Supported File Types</h3>'
        + '<ul>'
        + '<li><strong>Images</strong> &mdash; JPEG, PNG, GIF, WebP, SVG, HEIC/HEIF (auto-converted to JPEG).</li>'
        + '<li><strong>Text</strong> &mdash; Plain text, Markdown, CSV, HTML, XML, YAML.</li>'
        + '<li><strong>Code</strong> &mdash; JavaScript, TypeScript, Python, Shell scripts, SQL, GraphQL, and more.</li>'
        + '<li><strong>Documents</strong> &mdash; PDF, JSON, Office formats (DOCX, PPTX, XLSX).</li>'
        + '</ul>'
        + '<h3>Size Limits</h3>'
        + '<ul>'
        + '<li>Single file: <strong>50 MB</strong> maximum.</li>'
        + '<li>Total per message: <strong>100 MB</strong> across all attachments.</li>'
        + '<li>Download timeout: 30 seconds per file.</li>'
        + '</ul>'
        + '<h3>HEIC/HEIF Conversion</h3>'
        + '<p>Apple HEIC/HEIF images (common from iPhones) are automatically detected via magic-byte analysis '
        + 'and converted to JPEG (quality 90) using the <code>sharp</code> library. EXIF rotation is also auto-corrected. '
        + 'If <code>sharp</code> is not available, the original file is forwarded with a warning.</p>'
        + '<h3>Output Files &amp; Artifacts</h3>'
        + '<p>If the CLI writes files to an <code>_output/</code> directory inside the working directory, '
        + 'HuskyGate archives them to <code>_artifacts/{jobId}/</code> when the job completes and delivers them to the active channel:</p>'
        + '<ul>'
        + '<li><strong>Slack</strong> &mdash; Files are uploaded to the Slack thread (up to 10 files, 50 MB each).</li>'
        + '<li><strong>Dashboard</strong> &mdash; Files appear as inline artifact cards. Images are displayed with a preview; other files show an icon and download link.</li>'
        + '</ul>'
        + '<p>Artifacts are persisted per job, so they remain accessible when switching between Slack and Dashboard for the same session.</p>',

      'tasks':
        '<h2>Tasks</h2>'
        + '<p>HuskyGate provides four task systems for repeatable execution: <strong>On-Demand Tasks</strong>, <strong>Schedule Tasks</strong>, <strong>Triggered Tasks</strong>, and <strong>Orchestrators</strong>. '
        + 'Use these when you want stable, reusable automation instead of ad-hoc chat prompts.</p>'
        + '<h3>Task Types</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Type</th><th>Best for</th><th>How to run</th></tr></thead><tbody>'
        + '<tr><td>On-Demand Task</td><td>Manual, reusable operation (deploy, report, cleanup)</td><td>Dashboard Execute button or Slack <code>!task &lt;name|alias&gt;</code></td></tr>'
        + '<tr><td>Schedule Task</td><td>Time-based automation (once or recurring)</td><td>Automatic scheduler trigger</td></tr>'
        + '<tr><td>Triggered Task</td><td>Event-driven execution (webhook, GitHub push, Slack event)</td><td>Fires automatically when a matching webhook event arrives</td></tr>'
        + '<tr><td>Orchestrator</td><td>Multi-step DAG workflow with branching and parallelism</td><td>Dashboard Run, Slack <code>!orch</code>, or orchestrator schedule</td></tr>'
        + '</tbody></table>'
        + '<h3>On-Demand Tasks</h3>'
        + '<p>On-Demand Tasks are predefined prompts you can execute immediately.</p>'
        + '<h4>What you can do</h4>'
        + '<ul>'
        + '<li>Create, edit, delete, and manually execute tasks from the dashboard.</li>'
        + '<li>Run the same task from Slack with <code>!task &lt;name|alias&gt;</code> or <code>!t &lt;name|alias&gt;</code>.</li>'
        + '<li>Store a reusable prompt with selected tool (<code>claude</code>, <code>codex</code>, <code>gemini</code>).</li>'
        + '<li>Configure automatic retries with <code>maxRetries</code> (0-10).</li>'
        + '<li>Optionally set a notify target; for Slack command execution, notification uses task channel first, then the invoking channel.</li>'
        + '</ul>'
        + '<h4>Execution behavior</h4>'
        + '<ul>'
        + '<li>Each run creates a standalone session and isolated workdir.</li>'
        + '<li>Runs are queued through the normal job queue with auto-approve enabled for unattended execution.</li>'
        + '<li>History view shows status, duration, output preview, retry count, and a run detail modal.</li>'
        + '</ul>'
        + '<h4>Main fields</h4>'
        + '<table class="docs-cmd-table"><thead><tr><th>Field</th><th>Details</th></tr></thead><tbody>'
        + '<tr><td>Name / Alias</td><td>Name is required. Alias is optional and can be used in Slack commands.</td></tr>'
        + '<tr><td>Prompt</td><td>Required. Maximum 50,000 characters.</td></tr>'
        + '<tr><td>Description</td><td>Optional summary (up to 2,000 characters).</td></tr>'
        + '<tr><td>Max Retries</td><td>0-10 automatic retries on failure.</td></tr>'
        + '<tr><td>Slack Notify</td><td>Optional notification target (channel or DM user).</td></tr>'
        + '</tbody></table>'
        + '<h3>Schedule Tasks</h3>'
        + '<p>Schedule Tasks execute automatically at configured times.</p>'
        + '<h4>What you can do</h4>'
        + '<ul>'
        + '<li>Create <strong>One-time</strong> tasks (specific datetime) and <strong>Recurring</strong> tasks (cron expression).</li>'
        + '<li>Use visual repeat builder (daily, weekdays, custom days) or advanced raw cron input.</li>'
        + '<li>Pause, resume, edit, delete, and inspect run history from the dashboard.</li>'
        + '<li>Set <code>maxRuns</code> to auto-stop after N runs.</li>'
        + '<li>Set <code>maxRetries</code> (0-10) for automatic retry behavior.</li>'
        + '</ul>'
        + '<h4>Scheduling behavior</h4>'
        + '<ul>'
        + '<li>Schedule feature must be enabled via <code>SCHEDULE_ENABLED=true</code>.</li>'
        + '<li>A notify channel is required per task or via <code>SCHEDULE_DEFAULT_NOTIFY_CHANNEL</code>.</li>'
        + '<li>The scheduler polls due tasks every <code>SCHEDULE_POLL_INTERVAL_SEC</code> and applies concurrency limit <code>SCHEDULE_MAX_CONCURRENT</code>.</li>'
        + '<li>Claim/release locking prevents duplicate execution across workers and recovers stale claims automatically.</li>'
        + '</ul>'
        + '<h4>Status and history</h4>'
        + '<ul>'
        + '<li>Task status: <code>active</code>, <code>paused</code>, <code>completed</code>, <code>deleted</code>.</li>'
        + '<li>Run status: <code>pending</code>, <code>running</code>, <code>completed</code>, <code>failed</code>, <code>timeout</code>.</li>'
        + '<li>History view includes output summary, errors, duration, retries, and run detail modal.</li>'
        + '</ul>'
        + '<h3>Triggered Tasks</h3>'
        + '<p>Triggered Tasks fire automatically when a matching webhook event arrives at one of your configured endpoints.</p>'
        + '<h4>What you can do</h4>'
        + '<ul>'
        + '<li>Create tasks linked to a <strong>webhook endpoint</strong> via an event subscription.</li>'
        + '<li>Define a prompt, tool, and optional filter/mapping rules for the incoming payload.</li>'
        + '<li>Configure concurrency limits per task.</li>'
        + '<li>View run history with status, duration, and output.</li>'
        + '</ul>'
        + '<h4>Execution behavior</h4>'
        + '<ul>'
        + '<li>When a webhook delivery matches the task\\u2019s event subscription, the task is queued automatically.</li>'
        + '<li>The incoming payload (trigger context) is forwarded to the prompt as context.</li>'
        + '<li>Each run creates an isolated session and workdir, similar to on-demand tasks.</li>'
        + '</ul>'
        + '<p>For webhook endpoint configuration and event subscription setup, see the <em>Event Triggers</em> docs section.</p>'
        + '<h3>Orchestrators (Workflow Tasks)</h3>'
        + '<p>Orchestrators are DAG (Directed Acyclic Graph) workflows for advanced multi-step automation.</p>'
        + '<h4>What you can do</h4>'
        + '<ul>'
        + '<li>Build graph workflows with Task/Triggered/Gate/End nodes and edge conditions.</li>'
        + '<li>Branch by return tags (<code>&lt;return:value&gt;</code>) and combine inputs with gate logic (AND/OR).</li>'
        + '<li>Configure per-node tool, mode, prompt, retries, timeout, and notification.</li>'
        + '<li>Assign an <strong>Agent</strong> to a node to inherit its full configuration (tool, instructions, skills, MCP).</li>'
        + '<li>Validate graph integrity before execution and run with live status updates.</li>'
        + '<li>Run manually, run from Slack (<code>!orch</code>/<code>!o</code>), or run on a schedule.</li>'
        + '<li>Review runs, inspect node-level results, rerun failed runs, and cancel active runs.</li>'
        + '</ul>'
        + '<h4>Node Types</h4>'
        + '<table class="docs-cmd-table"><thead><tr><th>Type</th><th>Purpose</th></tr></thead><tbody>'
        + '<tr><td><strong>Task</strong></td><td>Executes a prompt with a selected tool. Requires a tool + prompt (or an Agent reference).</td></tr>'
        + '<tr><td><strong>Triggered</strong></td><td>Pauses and waits for an external webhook event before continuing. Configurable wait timeout.</td></tr>'
        + '<tr><td><strong>Gate</strong></td><td>Conditional join point. Mode: <code>AND</code> (all incoming edges must match) or <code>OR</code> (any one match suffices).</td></tr>'
        + '<tr><td><strong>End</strong></td><td>Terminal node. No outgoing edges. Marks the end of a workflow branch.</td></tr>'
        + '</tbody></table>'
        + '<h4>Edge Conditions</h4>'
        + '<p>Edges connect nodes and can carry conditions based on the source node\\u2019s <code>&lt;return:value&gt;</code> output:</p>'
        + '<table class="docs-cmd-table"><thead><tr><th>Operator</th><th>Meaning</th><th>Example</th></tr></thead><tbody>'
        + '<tr><td><code>eq</code></td><td>Exact match</td><td><code>return == "success"</code></td></tr>'
        + '<tr><td><code>neq</code></td><td>Not equal</td><td><code>return != "skip"</code></td></tr>'
        + '<tr><td><code>in</code></td><td>Value in list</td><td><code>return in ["a","b","c"]</code></td></tr>'
        + '<tr><td><code>regex</code></td><td>Regex pattern match</td><td><code>return matches /^ok.*/</code></td></tr>'
        + '</tbody></table>'
        + '<p>Edges without conditions are unconditional and always fire.</p>'
        + '<h4>Error Policy</h4>'
        + '<p>Each orchestrator has an error policy that controls behavior when a node fails:</p>'
        + '<ul>'
        + '<li><code>fail_fast</code> &mdash; Stop the entire orchestration immediately on the first node failure.</li>'
        + '<li><code>continue</code> &mdash; Mark the failed node and continue executing other branches.</li>'
        + '</ul>'
        + '<h4>LLM Output Logging &amp; Housekeeping</h4>'
        + '<ul>'
        + '<li>Each node run stores full raw output (<code>output_full</code>) and a 4,000-char summary (<code>output_summary</code>).</li>'
        + '<li><code>&lt;return:value&gt;</code> tags are parsed from the full output, so tags beyond the 4,000-char boundary are correctly captured.</li>'
        + '<li>After completion notification and summary snapshot creation, raw output is offloaded to <code>data/job-logs/</code> and <code>output_full</code> is NULLed in SQLite.</li>'
        + '<li>A 6-hour safety-net cleanup still archives legacy rows older than 7 days and enforces the 1,000-row cap.</li>'
        + '<li>Archived log path: <code>data/job-logs/&lt;run_id&gt;/&lt;node_run_id&gt;.log</code></li>'
        + '</ul>'
        + '<p>For node-level return-value rules and DAG behavior, see the Orchestrator editor Guide.</p>'
        + '<h3>Output Files and Artifacts</h3>'
        + '<p>All task types can emit files for Slack and dashboard artifact delivery.</p>'
        + '<ul>'
        + '<li>Write files to <code>_output/</code> inside the task workdir.</li>'
        + '<li>On completion, files are archived to <code>_artifacts/{jobId}/</code>.</li>'
        + '<li>Upload/scan limits: up to 10 files, 50MB per file.</li>'
        + '</ul>'
        + '<div class="docs-tip"><strong>Tip:</strong> Use On-Demand for human-triggered repeat jobs, Schedule for time-triggered jobs, and Orchestrator for branching multi-step workflows.</div>',

      'dashboard':
        '<h2>Dashboard</h2>'
        + '<p>The Dashboard is a dedicated local web process started by <code>huskygate dashboard start</code>. '
        + 'Default URL is <code>http://localhost:3737</code>. It proxies runtime actions to the internal Server API on <code>127.0.0.1:3738</code>.</p>'
        + '<h3>Auth &amp; Process Model</h3>'
        + '<ul>'
        + '<li>CLI start injects a one-time token in URL, then Dashboard sets an auth cookie and removes the token from address bar.</li>'
        + '<li>Dashboard PID/log: <code>data/dashboard.pid</code>, <code>data/dashboard.log</code>.</li>'
        + '<li>Server PID/log: <code>data/huskygate.pid</code>, <code>data/huskygate.log</code>.</li>'
        + '</ul>'
        + '<h3>Overview</h3>'
        + '<p>Server status indicator, daemon start/stop controls, metrics grid (sessions, 24h jobs, success rate, errors), '
        + '7-day activity chart, tool distribution, success rate trends, error analysis, tool cards for Claude / Codex / Gemini, and recent job activity feed.</p>'
        + '<h3>Chat</h3>'
        + '<p>A full-featured web-based chat interface for direct interaction with AI sessions &mdash; useful for testing without Slack or for browser-only workflows.</p>'
        + '<ul>'
        + '<li><strong>Session creation</strong> &mdash; Select a tool (Claude / Codex / Gemini) and mode (write / readonly) when creating a new chat session.</li>'
        + '<li><strong>Real-time streaming</strong> &mdash; Assistant responses stream in real time via Server-Sent Events (SSE) with a live typing indicator.</li>'
        + '<li><strong>File upload</strong> &mdash; Attach files via drag-and-drop or the upload button. Files are previewed before sending.</li>'
        + '<li><strong>Tool approval</strong> &mdash; When the CLI requests tool execution approval, inline Approve / Reject buttons appear in the chat.</li>'
        + '<li><strong>Artifacts</strong> &mdash; Output files and images are displayed as inline artifact cards with download links.</li>'
        + '<li><strong>Message history</strong> &mdash; Full message history with pagination (\\u201CLoad older messages\\u201D). Messages are polled every 3 seconds for updates.</li>'
        + '<li><strong>Markdown rendering</strong> &mdash; Assistant output is rendered with code blocks, lists, and inline formatting.</li>'
        + '</ul>'
        + '<h3>Sessions</h3>'
        + '<p>Browse all sessions across all threads. Each row shows the session ID, tool, thread, timestamps, and mode. '
        + 'Expand a session to view its audit log or open the execution trace modal for a timeline visualization. '
        + 'Delete individual sessions or clear all at once.</p>'
        + '<h3>Tasks</h3>'
        + '<p>The dashboard task area includes <strong>On-Demand Tasks</strong>, <strong>Schedule Tasks</strong>, <strong>Triggered Tasks</strong>, and <strong>Orchestrators</strong>. '
        + 'Open the dedicated <strong>Tasks</strong> docs section for full capability details, execution behavior, status model, and limits.</p>'
        + '<h3>Agents</h3>'
        + '<p>Create and manage reusable AI agent personas. Each agent combines a tool, system instructions, skill set, and MCP server configuration '
        + 'into a named profile that can be selected as the executor for orchestrator nodes or triggered tasks. '
        + 'See the <em>Agents</em> docs section for full details.</p>'
        + '<h3>Developer</h3>'
        + '<p>Manage developer aliases: create, edit, or delete pre-configured project setups. '
        + 'Each alias defines a name, tool, working directory path, and optional custom instructions. '
        + 'Use the OS-native directory picker to browse for paths. View audit history per alias.</p>'
        + '<h3>MCP</h3>'
        + '<p>View and manage MCP server configurations for each tool (Claude, Gemini, Codex). '
        + 'Claude servers are managed in SQLite from the Dashboard and rendered into a generated per-workdir config at execution time; '
        + 'Gemini and Codex continue to edit their home-directory config files. '
        + 'All tools support transport selection (stdio, SSE, HTTP), environment variables, and advanced settings including OAuth configuration.</p>'
        + '<h3>Skills</h3>'
        + '<p>Manage both built-in skills and custom Markdown skills. Multi-driver editing lets one skill be maintained across Claude/Codex/Gemini variants.</p>'
        + '<ul>'
        + '<li><strong>Built-in skills</strong>: Playwright Runner, Perplexity Research, Research Freshness, Schedule Manager, AWS CLI, Azure CLI, GCP CLI, Gmail Composer, Obsidian CLI, PPTX Composer &mdash; toggle on/off and configure environment variables.</li>'
        + '<li><strong>Scope</strong>: local (home) or project (under <code>WORKDIR_ROOT</code>).</li>'
        + '<li><strong>Paths</strong>: Local <code>~/.huskygate/skills/</code>, Project <code>&lt;WORKDIR_ROOT&gt;/.huskygate/skills/</code>.</li>'
        + '<li><strong>Naming rule</strong>: lowercase alphanumeric and dashes, max 64 chars.</li>'
        + '<li><strong>Instruction templates</strong>: Edit <code>CLAUDE.md</code>, <code>AGENTS.md</code>, <code>GEMINI.md</code> templates from the Skills tab.</li>'
        + '</ul>'
        + '<h3>Metrics</h3>'
        + '<p>Visual operational monitoring with 9+ chart types covering job activity, error analysis, task/orchestrator runs, and duration trends. '
        + 'Supports 24h/7d/30d range selector, auto-refresh, queue depth gauge, and database size tracking. See the <em>Metrics</em> docs section for details.</p>'
        + '<h3>Logs</h3>'
        + '<p>Real-time server and dashboard log viewer. Switch between server and dashboard log sources. Filter by level (debug, info, warn, error) or search by keyword.</p>'
        + '<h3>Settings</h3>'
        + '<p>Configure HuskyGate through schema-driven categorized forms:</p>'
        + '<ul>'
        + '<li><strong>Mode</strong> &mdash; Global auto-approve default (<code>TOOL_AUTO_APPROVE_MODE</code>).</li>'
        + '<li><strong>Messaging</strong> &mdash; Slack tokens, allowed user IDs, team restrictions.</li>'
        + '<li><strong>Apps</strong> &mdash; Per-tool CLI path, model, default mode, readonly permission mode, MCP auth server, and MCP config path.</li>'
        + '<li><strong>Prompts</strong> &mdash; Per-tool default instructions (Claude, Codex, Gemini) with enable/disable toggle for full-replace vs. append mode.</li>'
        + '<li><strong>Environment</strong> &mdash; Runtime (concurrency, timeouts, workdir, log level), Network (webhook URL, tunnel, cookie), Skills (API keys for cloud CLIs/Perplexity), and Schedule settings.</li>'
        + '</ul>'
        + '<div class="docs-tip"><strong>Tip:</strong> Changes in Settings are persisted to SQLite or the OS Keychain (for sensitive values, where available). '
        + 'Some changes take effect immediately (Hot-reload); others require a daemon restart &mdash; the UI will display which keys need a restart. '
        + 'Sensitive values (tokens, keys) are masked in the UI.</div>'
        + '<h3>Docs</h3>'
        + '<p>This documentation page &mdash; an in-app reference for all HuskyGate features.</p>',

      'security':
        '<h2>Security &amp; Audit</h2>'
        + '<p>HuskyGate is designed with safety and observability in mind.</p>'
        + '<h3>Secret Masking</h3>'
        + '<p>All CLI output is scanned and sensitive tokens are automatically replaced with <code>[REDACTED]</code> before display. Detected patterns include:</p>'
        + '<ul>'
        + '<li>Slack tokens: <code>xoxb-*</code>, <code>xoxp-*</code>, <code>xapp-*</code></li>'
        + '<li>OpenAI keys: <code>sk-*</code> (20+ characters)</li>'
        + '<li>Google keys: <code>AIza*</code> (30+ characters)</li>'
        + '<li>GitHub tokens: <code>ghp_*</code>, <code>gho_*</code>, <code>github_pat_*</code></li>'
        + '<li>AWS access keys: <code>AKIA*</code> (16 characters)</li>'
        + '<li>Anthropic keys: <code>sk-ant-*</code></li>'
        + '</ul>'
        + '<p>ANSI escape codes are also stripped from all output before display.</p>'
        + '<h3>Audit Trail</h3>'
        + '<p>Every job execution is recorded in the audit log (stored in SQLite):</p>'
        + '<ul>'
        + '<li><strong>Job start</strong>: job ID, session key, user ID, tool, mode, workdir, prompt hash (SHA-256), timestamp.</li>'
        + '<li><strong>Job complete</strong>: end timestamp, exit code, error kind.</li>'
        + '<li><strong>Mode changes</strong>: from/to mode, user ID, timestamp.</li>'
        + '</ul>'
        + '<div class="docs-tip"><strong>Note:</strong> Prompts are stored as SHA-256 hashes for privacy &mdash; the raw prompt text is never persisted in the audit log.</div>'
        + '<h3>Inactivity Auto-Exit</h3>'
        + '<p>If no user message is received for the duration configured in <code>SESSION_IDLE_TIMEOUT_SEC</code> (default: <strong>24 hours</strong>), the active session is automatically exited. '
        + 'All pending confirmations, tool approvals, and MCP auth bypass tokens are cleared. '
        + 'The bot posts a notification: <em>&ldquo;No user message for N hour(s). Session exited automatically.&rdquo;</em></p>'
        + '<div class="docs-tip"><strong>Tip:</strong> You can lower this value in Settings &gt; Environment (e.g. <code>1800</code> for 30 minutes) to auto-exit idle sessions sooner.</div>'
        + '<h3>Challenge Codes</h3>'
        + '<p>Write mode and working directory changes require a 4-character alphanumeric confirmation code. '
        + 'The code expires after <strong>30 seconds</strong>. This prevents accidental or unintended actions.</p>'
        + '<h3>OS Keychain Integration</h3>'
        + '<p>HuskyGate can store sensitive environment variables (API keys, tokens) in the OS keychain instead of the <code>.env</code> file:</p>'
        + '<ul>'
        + '<li><strong>macOS</strong>: Uses the <code>security</code> CLI (Keychain Access).</li>'
        + '<li><strong>Linux</strong>: Uses <code>secret-tool</code> (GNOME Keyring / KDE Wallet).</li>'
        + '<li><strong>Windows</strong>: Uses Windows Credential Manager via PowerShell P/Invoke (<code>cmdkey</code> + CredRead/CredWrite).</li>'
        + '</ul>'
        + '<p>Managed secrets are stored in DB + keychain when secure storage is available.</p>'
        + '<p>You can set storage location per key in Dashboard &gt; Settings.</p>'
        + '<p>Check keychain availability with <code>huskygate keychain status</code> and list stored keys with <code>huskygate keychain list</code>.</p>'
        + '<h3>User Restrictions</h3>'
        + '<ul>'
        + '<li><code>ALLOWED_USER_IDS</code> &mdash; Comma-separated list of Slack User IDs. Only listed users can interact with the bot.</li>'
        + '<li><code>ALLOWED_TEAM_ID</code> &mdash; Optional workspace restriction to a specific Slack team.</li>'
        + '</ul>',

      'troubleshooting':
        '<h2>Troubleshooting</h2>'
        + '<h3>Bot Does Not Respond in Slack</h3>'
        + '<ul>'
        + '<li>Ensure the server is running: check Dashboard Overview or run <code>huskygate start</code>.</li>'
        + '<li>Verify <code>SLACK_BOT_TOKEN</code> and <code>SLACK_APP_TOKEN</code> are correct in Settings.</li>'
        + '<li>Make sure the bot is invited to the channel (type <code>/invite @YourBot</code>).</li>'
        + '<li>Check that your Slack User ID is in <code>ALLOWED_USER_IDS</code>.</li>'
        + '<li>Review the Logs tab for connection errors.</li>'
        + '</ul>'
        + '<h3>CLI Tool Not Found</h3>'
        + '<ul>'
        + '<li>Make sure the CLI is installed and in your <code>PATH</code>: run <code>which claude</code>, <code>which codex</code>, or <code>which gemini</code>.</li>'
        + '<li>Set the full path in Settings (e.g., <code>CLAUDE_COMMAND=/usr/local/bin/claude</code>).</li>'
        + '</ul>'
        + '<h3>Jobs Stuck or Timing Out</h3>'
        + '<ul>'
        + '<li><strong>Max runtime</strong>: <code>MAX_RUNTIME_SEC</code> (default: 900s / 15 min). Increase for long-running tasks.</li>'
        + '<li><strong>No-output timeout</strong>: <code>NO_OUTPUT_TIMEOUT_SEC</code> (default: 90s). If the CLI produces no output for this duration, '
        + 'HuskyGate retries up to 3 times (total ~360s) before killing the process.</li>'
        + '<li>Use <code>!stop</code> to manually stop a stuck job.</li>'
        + '<li>Use <code>!status</code> to inspect the job queue and check for pending jobs.</li>'
        + '</ul>'
        + '<h3>Permission Denied / Cannot Write</h3>'
        + '<ul>'
        + '<li>If your session is read-only, request write mode via <code>!mode=write</code> then <code>!confirm XXXX</code>.</li>'
        + '<li>All tools default to write mode. Per-tool defaults: <code>CLAUDE_DEFAULT_MODE</code>, <code>CODEX_DEFAULT_SANDBOX_MODE</code>, <code>GEMINI_DEFAULT_MODE</code>.</li>'
        + '<li>The confirmation code is valid for only 30 seconds.</li>'
        + '</ul>'
        + '<h3>MCP Auth Errors</h3>'
        + '<ul>'
        + '<li>If an MCP server requires OAuth, HuskyGate will prompt with approve/reject buttons.</li>'
        + '<li>Ensure <code>CLAUDE_MCP_AUTH_SERVER</code> (or the equivalent for your tool) is set correctly in Settings.</li>'
        + '<li>For Dashboard-managed Claude MCP, verify the server entry in the MCP tab and inspect the generated config under <code>&lt;workdir&gt;/.huskygate/</code> when needed.</li>'
        + '<li>For file-based tools, check <code>GEMINI_MCP_CONFIG_PATH</code> or <code>CODEX_MCP_CONFIG_PATH</code>. <code>CLAUDE_MCP_CONFIG_PATH</code> is mainly for manual/operator compatibility.</li>'
        + '<li>If tokens keep expiring, try &ldquo;Re-authenticate &amp; retry&rdquo; from the approval prompt.</li>'
        + '</ul>'
        + '<h3>File Attachment Errors</h3>'
        + '<ul>'
        + '<li>Check that the file type is supported (images, text, code, PDF, JSON, Office formats).</li>'
        + '<li>Single file limit: 50 MB. Total per message: 100 MB.</li>'
        + '<li>HEIC conversion requires the <code>sharp</code> library. If missing, the original file is sent with a warning.</li>'
        + '</ul>'
        + '<h3>Model Not Recognized</h3>'
        + '<ul>'
        + '<li>Model names are passed directly to the CLI. Ensure the name is valid for the tool you\\u2019re using.</li>'
        + '<li>Use <code>!model</code> to check the current model setting.</li>'
        + '<li>Set to <code>default</code> to clear the override and use the CLI\\u2019s built-in default.</li>'
        + '</ul>'
        + '<h3>Dashboard Not Loading</h3>'
        + '<ul>'
        + '<li>The dashboard UI runs on Dashboard port (default: <code>3737</code>), not <code>SERVER_API_PORT</code>.</li>'
        + '<li>The internal Server API runs on <code>SERVER_API_PORT</code> (default: <code>3738</code>); Dashboard depends on it for chat/actions.</li>'
        + '<li>By default, the dashboard binds to <code>127.0.0.1</code>. Use a reverse proxy for remote access.</li>'
        + '</ul>',

      'faq':
        '<h2>Frequently Asked Questions</h2>'
        + '<h3>Can I use multiple tools in the same thread?</h3>'
        + '<p>Yes. Each thread can have sessions for different tools. However, only one session can be active at a time. '
        + 'Use <code>!exit</code> to leave the current session before switching to another tool.</p>'
        + '<h3>Do sessions persist after a restart?</h3>'
        + '<p>Session metadata is stored in a local SQLite database and survives server restarts. '
        + 'CLI-side conversation context depends on the tool: Claude supports session resume via <code>--session-id</code>; '
        + 'Gemini tracks session indices; Codex does not persist CLI state.</p>'
        + '<h3>How do I restrict who can use the bot?</h3>'
        + '<p>Set <code>ALLOWED_USER_IDS</code> to a comma-separated list of Slack User IDs. Only these users can interact with the bot. '
        + 'Optionally, set <code>ALLOWED_TEAM_ID</code> to restrict to a specific workspace.</p>'
        + '<h3>How many jobs can run at once?</h3>'
        + '<p>Controlled by <code>MAX_CONCURRENCY</code> (default: 2). Each session also has its own per-session queue, '
        + 'so only one job runs per session at a time. Excess jobs wait until a slot opens.</p>'
        + '<h3>Can I run HuskyGate on a remote server?</h3>'
        + '<p>Yes. HuskyGate uses Slack Socket Mode, so it does not need a public URL &mdash; it connects outbound to Slack\\u2019s servers. '
        + 'The Dashboard binds to <code>127.0.0.1</code> by default. Use a reverse proxy (e.g., nginx) with authentication for remote access.</p>'
        + '<h3>How do I update the CLI tools?</h3>'
        + '<p>HuskyGate shells out to the CLI binaries directly. Update them via their own package managers '
        + '(e.g., <code>npm update -g @anthropic-ai/claude-code</code>). No HuskyGate restart is needed.</p>'
        + '<h3>What is the confirm code?</h3>'
        + '<p>A random 4-character alphanumeric code generated for write mode and workdir changes. '
        + 'It expires after 30 seconds. Type <code>!confirm XXXX</code> (replacing XXXX with the actual code) to confirm.</p>'
        + '<h3>What are Skills?</h3>'
        + '<p>Skills are reusable Markdown-based workflows stored per tool. Each skill is a directory with a <code>SKILL.md</code> file '
        + '(containing YAML frontmatter and instructions) plus optional supporting files. Manage them from the Dashboard Skills tab.</p>'
        + '<h3>How is my prompt data handled?</h3>'
        + '<p>Prompts are hashed with SHA-256 before being stored in the audit log. The raw prompt text is never persisted. '
        + 'API keys and tokens in CLI output are automatically masked with <code>[REDACTED]</code>.</p>'
        + '<h3>What happens when a job produces no output?</h3>'
        + '<p>If the CLI produces no stdout for <code>NO_OUTPUT_TIMEOUT_SEC</code> (default: 90s), HuskyGate retries up to 3 times '
        + '(giving a total window of ~6 minutes) before killing the process.</p>'
        + '<h3>How do scheduled tasks work?</h3>'
        + '<p>Create tasks in the Tasks tab. One-time tasks run at a specific date/time; recurring tasks use cron expressions. '
        + 'Each run creates a temporary session, executes the prompt, and optionally notifies a Slack channel. '
        + 'Disable scheduling entirely with <code>SCHEDULE_ENABLED=false</code>.</p>'
        + '<h3>How do I store API keys securely?</h3>'
        + '<p>Managed sensitive keys are stored in the OS keychain when available. '
        + 'You can set storage location per key in Dashboard &gt; Settings. '
        + 'Keys in the keychain are loaded at startup and never written to disk.</p>'
        + '<h3>What are Agents?</h3>'
        + '<p>Agents are reusable AI personas that bundle a tool, system instructions, skills, and MCP server selection into a named profile. '
        + 'You can assign agents to orchestrator task nodes and triggered tasks instead of manually configuring each one. '
        + 'Manage them from the Dashboard Agents tab.</p>'
        + '<h3>What are Event Triggers?</h3>'
        + '<p>Event Triggers let you fire tasks automatically in response to external events. '
        + 'Configure webhook endpoints (with presets for GitHub, Slack, and Jira), create event subscriptions that link endpoints to triggered tasks or orchestrators, '
        + 'and HuskyGate routes incoming deliveries to the right executor.</p>'
        + '<h3>How do Default Instructions (Prompts) work?</h3>'
        + '<p>In Settings &gt; Prompts, you can set per-tool default instructions for Claude, Codex, and Gemini. '
        + 'When enabled, these instructions are injected into every session for that tool. '
        + 'The enable/disable toggle controls whether the instruction replaces or appends to the code-managed instruction file.</p>'
        + '<h3>Can I see operational metrics?</h3>'
        + '<p>Yes. The Metrics tab shows 9+ charts covering job activity, error analysis, task runs, orchestrator runs, and duration trends. '
        + 'Use the range selector (24h / 7d / 30d) and auto-refresh for live monitoring. It also displays queue depth, database size, and error-by-tool breakdown.</p>'
        + '<h3>What is the Cloudflare Tunnel option?</h3>'
        + '<p>If <code>CLOUDFLARE_TUNNEL_ENABLED=true</code> and a <code>CLOUDFLARE_TUNNEL_TOKEN</code> is set, HuskyGate can expose webhook endpoints via a Cloudflare Tunnel. '
        + 'This gives you a public URL without port forwarding. The tunnel status is shown in the Event Triggers tab.</p>',

      'agents':
        '<h2>Agents</h2>'
        + '<p>Agents are reusable AI persona profiles that bundle tool selection, system instructions, skills, and MCP server configuration into a single named entity. '
        + 'Instead of configuring each orchestrator node or triggered task from scratch, you assign an agent and its full preset is applied.</p>'
        + '<h3>Agent Fields</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Field</th><th>Details</th></tr></thead><tbody>'
        + '<tr><td>Name</td><td>Required. Display name for the agent.</td></tr>'
        + '<tr><td>Description</td><td>Optional long-form description of the agent\\u2019s purpose.</td></tr>'
        + '<tr><td>Tool</td><td>Which CLI to use: <code>claude</code>, <code>codex</code>, or <code>gemini</code>.</td></tr>'
        + '<tr><td>System Instruction</td><td>Optional custom system prompt injected into every execution.</td></tr>'
        + '<tr><td>Enabled Skills</td><td>Array of skill references available to this agent.</td></tr>'
        + '<tr><td>MCP Server IDs</td><td>Specific MCP servers to enable for this agent.</td></tr>'
        + '<tr><td>Allow MCP</td><td>Global toggle &mdash; if off, no MCP tools are available regardless of server selection.</td></tr>'
        + '</tbody></table>'
        + '<h3>Creating an Agent</h3>'
        + '<ol>'
        + '<li>Navigate to the <strong>Agents</strong> tab in the Dashboard.</li>'
        + '<li>Click <strong>+ New Agent</strong>.</li>'
        + '<li>Fill in the name, select a tool, and optionally add a system instruction.</li>'
        + '<li>Choose which skills and MCP servers should be available.</li>'
        + '<li>Click <strong>Save</strong>.</li>'
        + '</ol>'
        + '<h3>Using Agents in Orchestrators</h3>'
        + '<p>In the orchestrator editor, each <strong>Task</strong> node can reference an agent by ID. '
        + 'When the node executes, it inherits the agent\\u2019s tool, system instruction, skills, and MCP configuration. '
        + 'This avoids duplicating settings across multiple nodes.</p>'
        + '<h3>Using Agents in Triggered Tasks</h3>'
        + '<p>Triggered tasks can also reference an agent. When an event fires, the triggered task executor uses the agent\\u2019s configuration for the run.</p>'
        + '<h3>Agent Cards</h3>'
        + '<p>The Agents tab displays each agent as a card showing the name, description, tool badge, skill count, and MCP server count. '
        + 'Click a card to edit or delete the agent.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> Agents are stored in the <code>ai_agents</code> SQLite table. '
        + 'The API is available at <code>/api/agents</code> (GET list, POST create, PATCH update, DELETE remove).</div>',

      'event-triggers':
        '<h2>Event Triggers</h2>'
        + '<p>Event Triggers allow HuskyGate to react to external events via webhooks. '
        + 'The system has three layers: <strong>Webhook Endpoints</strong> (receive HTTP requests), '
        + '<strong>Event Subscriptions</strong> (route deliveries to targets), and <strong>Triggered Tasks / Orchestrators</strong> (execute work).</p>'
        + '<h3>Webhook Endpoints</h3>'
        + '<p>A webhook endpoint is a unique URL that accepts incoming HTTP POST requests.</p>'
        + '<h4>Presets</h4>'
        + '<table class="docs-cmd-table"><thead><tr><th>Preset</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td>Generic</td><td>Accept any JSON payload.</td></tr>'
        + '<tr><td>GitHub</td><td>Preconfigured for GitHub webhook events (push, PR, issues, etc.).</td></tr>'
        + '<tr><td>Slack</td><td>Preconfigured for Slack outgoing webhooks and slash commands.</td></tr>'
        + '<tr><td>Jira</td><td>Preconfigured for Jira webhook events.</td></tr>'
        + '</tbody></table>'
        + '<h4>Verification</h4>'
        + '<p>Each endpoint can be configured with a verification method to validate incoming requests:</p>'
        + '<ul>'
        + '<li><code>none</code> &mdash; No verification (suitable for testing).</li>'
        + '<li><code>hmac-sha256</code> &mdash; Validates an HMAC-SHA256 signature header against a shared secret.</li>'
        + '<li><code>slack-v0</code> &mdash; Validates Slack\\u2019s <code>v0</code> request signing (timestamp + body hash).</li>'
        + '</ul>'
        + '<h4>Endpoint URL</h4>'
        + '<p>Endpoints are served at <code>{base}/api/webhooks/{endpointId}</code>. '
        + 'The base URL is either <code>WEBHOOK_PUBLIC_BASE_URL</code>, the Cloudflare Tunnel URL (if active), or <code>localhost:{SERVER_API_PORT}</code>.</p>'
        + '<h3>Event Subscriptions</h3>'
        + '<p>Subscriptions link a webhook endpoint to a target executor:</p>'
        + '<ul>'
        + '<li><strong>Triggered Task</strong> &mdash; Execute a specific triggered task.</li>'
        + '<li><strong>Orchestrator</strong> &mdash; Start an orchestrator run.</li>'
        + '<li><strong>Triggered Node</strong> &mdash; Resume a waiting triggered node inside an active orchestrator run.</li>'
        + '</ul>'
        + '<p>Each subscription filters deliveries from its source endpoint and dispatches matching events to the target.</p>'
        + '<h3>Delivery Tracking</h3>'
        + '<p>Every incoming webhook request is tracked as a <strong>delivery</strong> in the <code>webhook_deliveries</code> table. '
        + 'The system records the endpoint, payload, matched subscriptions, and dispatch results. '
        + 'Deliveries have a TTL and are deduplicated to prevent double-firing.</p>'
        + '<h3>Cloudflare Tunnel</h3>'
        + '<p>For environments without a public IP, HuskyGate supports Cloudflare Tunnel integration:</p>'
        + '<ol>'
        + '<li>Set <code>CLOUDFLARE_TUNNEL_ENABLED=true</code> in Settings &gt; Environment &gt; Network.</li>'
        + '<li>Provide a <code>CLOUDFLARE_TUNNEL_TOKEN</code> (stored in Keychain).</li>'
        + '<li>The Event Triggers tab shows the tunnel status badge (Connected / Inactive).</li>'
        + '<li>When connected, webhook endpoint URLs automatically use the tunnel\\u2019s public URL.</li>'
        + '</ol>'
        + '<h3>GitHub IP Allowlist</h3>'
        + '<p>When <code>GITHUB_WEBHOOK_IP_ALLOWLIST=true</code> (default), incoming GitHub webhook requests are validated against GitHub\\u2019s published IP ranges. '
        + 'This adds an extra layer of security on top of HMAC verification.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> Use the Event Triggers tab in the Dashboard to create endpoints and subscriptions visually. '
        + 'The webhook URL is displayed with a copy button for easy pasting into GitHub/Slack/Jira settings.</div>',

      'config-ref':
        '<h2>Configuration Reference</h2>'
        + '<p>HuskyGate uses ~54 configuration keys organized into categories. All settings are managed via Dashboard &gt; Settings. '
        + 'Sensitive values are stored in the OS Keychain; other values in the SQLite config table.</p>'
        + '<h3>Mode</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>TOOL_AUTO_APPROVE_MODE</code></td><td><code>false</code></td><td>When enabled, tool executions are auto-approved without user confirmation. Affects orchestrator nodes too.</td></tr>'
        + '</tbody></table>'
        + '<h3>Messaging (Slack)</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Storage</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>SLACK_BOT_TOKEN</code></td><td>Keychain</td><td>Bot User OAuth Token (<code>xoxb-...</code>).</td></tr>'
        + '<tr><td><code>SLACK_APP_TOKEN</code></td><td>Keychain</td><td>App-Level Token (<code>xapp-...</code>) for Socket Mode.</td></tr>'
        + '<tr><td><code>ALLOWED_USER_IDS</code></td><td>Config DB</td><td>Comma-separated Slack User IDs allowed to interact.</td></tr>'
        + '<tr><td><code>ALLOWED_TEAM_ID</code></td><td>Config DB</td><td>Optional: restrict to a specific Slack workspace.</td></tr>'
        + '</tbody></table>'
        + '<h3>Apps &mdash; General</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>DEFAULT_TOOL</code></td><td><code>claude</code></td><td>Default tool when none is specified.</td></tr>'
        + '</tbody></table>'
        + '<h3>Apps &mdash; Claude</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Storage</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>ANTHROPIC_API_KEY</code></td><td>Keychain</td><td>Anthropic API key.</td></tr>'
        + '<tr><td><code>CLAUDE_COMMAND</code></td><td>Config DB</td><td>CLI binary path (auto-detected if omitted).</td></tr>'
        + '<tr><td><code>CLAUDE_MODEL</code></td><td>Config DB</td><td>Model override (e.g. <code>opus</code>, <code>claude-sonnet-4-6</code>).</td></tr>'
        + '<tr><td><code>CLAUDE_DEFAULT_MODE</code></td><td>Config DB</td><td>Default session mode: <code>write</code> or <code>readonly</code>.</td></tr>'
        + '<tr><td><code>CLAUDE_READONLY_PERMISSION_MODE</code></td><td>Config DB</td><td><code>default</code> or <code>plan</code>. Controls readonly CLI behavior.</td></tr>'
        + '<tr><td><code>CLAUDE_MCP_AUTH_SERVER</code></td><td>Config DB</td><td>MCP server name requiring OAuth pre-auth.</td></tr>'
        + '<tr><td><code>CLAUDE_MCP_CONFIG_PATH</code></td><td>Config DB</td><td>Path to manual MCP config file (operator override).</td></tr>'
        + '</tbody></table>'
        + '<h3>Apps &mdash; Gemini</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Storage</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>GEMINI_API_KEY</code></td><td>Keychain</td><td>Gemini API key.</td></tr>'
        + '<tr><td><code>GOOGLE_API_KEY</code></td><td>Keychain</td><td>Fallback Google API key.</td></tr>'
        + '<tr><td><code>GEMINI_COMMAND</code></td><td>Config DB</td><td>CLI binary path.</td></tr>'
        + '<tr><td><code>GEMINI_MODEL</code></td><td>Config DB</td><td>Model override (e.g. <code>gemini-2.5-pro</code>).</td></tr>'
        + '<tr><td><code>GEMINI_DEFAULT_MODE</code></td><td>Config DB</td><td>Default mode: <code>write</code> or <code>readonly</code>.</td></tr>'
        + '<tr><td><code>GEMINI_READONLY_APPROVAL_MODE</code></td><td>Config DB</td><td><code>default</code> or <code>plan</code>.</td></tr>'
        + '<tr><td><code>GEMINI_MCP_AUTH_SERVER</code></td><td>Config DB</td><td>MCP server name for OAuth.</td></tr>'
        + '<tr><td><code>GEMINI_MCP_CONFIG_PATH</code></td><td>Config DB</td><td>MCP config file path.</td></tr>'
        + '</tbody></table>'
        + '<h3>Apps &mdash; Codex</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Storage</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>OPENAI_API_KEY</code></td><td>Keychain</td><td>OpenAI API key.</td></tr>'
        + '<tr><td><code>CODEX_COMMAND</code></td><td>Config DB</td><td>CLI binary path.</td></tr>'
        + '<tr><td><code>CODEX_MODEL</code></td><td>Config DB</td><td>Model override (e.g. <code>o3</code>, <code>o3-pro</code>).</td></tr>'
        + '<tr><td><code>CODEX_DEFAULT_SANDBOX_MODE</code></td><td>Config DB</td><td>Default mode: <code>write</code> or <code>readonly</code>.</td></tr>'
        + '<tr><td><code>CODEX_MCP_AUTH_SERVER</code></td><td>Config DB</td><td>MCP server for OAuth.</td></tr>'
        + '<tr><td><code>CODEX_MCP_CONFIG_PATH</code></td><td>Config DB</td><td>MCP config file path.</td></tr>'
        + '</tbody></table>'
        + '<div class="docs-tip"><strong>Note:</strong> Codex also uses <code>CODEX_ASK_FOR_APPROVAL</code> (passed to the CLI). '
        + 'Values: <code>on-request</code> (default), <code>on-failure</code>, <code>untrusted</code>, <code>never</code>. This is set per-session via tool state, not in the Settings UI.</div>'
        + '<h3>Environment &mdash; Runtime</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>MAX_CONCURRENCY</code></td><td><code>2</code></td><td>Maximum number of concurrent jobs globally.</td></tr>'
        + '<tr><td><code>MAX_RUNTIME_SEC</code></td><td><code>900</code></td><td>Maximum job runtime in seconds (15 min).</td></tr>'
        + '<tr><td><code>NO_OUTPUT_TIMEOUT_SEC</code></td><td><code>90</code></td><td>No-output stall detection threshold.</td></tr>'
        + '<tr><td><code>WORKDIR_ROOT</code></td><td><code>./workdir</code></td><td>Base directory for session working directories.</td></tr>'
        + '<tr><td><code>ALLOWED_WORKDIR_ROOTS</code></td><td>&mdash;</td><td>Comma-separated paths allowed for <code>!workdir=</code>.</td></tr>'
        + '<tr><td><code>LOG_LEVEL</code></td><td><code>info</code></td><td>Log verbosity: <code>debug</code>, <code>info</code>, <code>warn</code>, <code>error</code>.</td></tr>'
        + '<tr><td><code>SERVER_API_PORT</code></td><td><code>3738</code></td><td>Internal server API port.</td></tr>'
        + '<tr><td><code>SERVER_API_HOST</code></td><td><code>127.0.0.1</code></td><td>Server API bind address.</td></tr>'
        + '<tr><td><code>HUSKYGATE_LOG_STACKS</code></td><td><code>false</code></td><td>Include stack traces in log output.</td></tr>'
        + '</tbody></table>'
        + '<h3>Environment &mdash; Network</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>WEBHOOK_PUBLIC_BASE_URL</code></td><td>&mdash;</td><td>Public base URL for webhook endpoints.</td></tr>'
        + '<tr><td><code>CLOUDFLARE_TUNNEL_ENABLED</code></td><td><code>false</code></td><td>Enable Cloudflare Tunnel for webhooks.</td></tr>'
        + '<tr><td><code>CLOUDFLARE_TUNNEL_TOKEN</code></td><td>&mdash;</td><td>Cloudflare Tunnel token (Keychain).</td></tr>'
        + '<tr><td><code>GITHUB_WEBHOOK_IP_ALLOWLIST</code></td><td><code>true</code></td><td>Validate GitHub webhook source IPs.</td></tr>'
        + '<tr><td><code>HUSKYGATE_DASHBOARD_COOKIE_SECURE</code></td><td><code>false</code></td><td>Set <code>Secure</code> flag on auth cookie. Enable when behind TLS proxy.</td></tr>'
        + '<tr><td><code>HUSKYGATE_OAUTH_TRUSTED_HOSTS</code></td><td>&mdash;</td><td>Trusted OAuth callback hostnames.</td></tr>'
        + '</tbody></table>'
        + '<h3>Environment &mdash; Session &amp; Schedule</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>SESSION_IDLE_TIMEOUT_SEC</code></td><td><code>86400</code></td><td>Inactivity timeout before auto-exit (24 hours).</td></tr>'
        + '<tr><td><code>SESSION_CLEANUP_ENABLED</code></td><td><code>true</code></td><td>Enable automatic session cleanup.</td></tr>'
        + '<tr><td><code>SCHEDULE_ENABLED</code></td><td><code>true</code></td><td>Enable the schedule task system.</td></tr>'
        + '<tr><td><code>SCHEDULE_POLL_INTERVAL_SEC</code></td><td><code>30</code></td><td>How often the scheduler polls for due tasks.</td></tr>'
        + '<tr><td><code>SCHEDULE_MAX_CONCURRENT</code></td><td><code>1</code></td><td>Max concurrent scheduled task runs.</td></tr>'
        + '<tr><td><code>SCHEDULE_DEFAULT_NOTIFY_CHANNEL</code></td><td>&mdash;</td><td>Default Slack channel for schedule notifications.</td></tr>'
        + '</tbody></table>'
        + '<h3>Environment &mdash; Skills</h3>'
        + '<table class="docs-cmd-table"><thead><tr><th>Key</th><th>Storage</th><th>Description</th></tr></thead><tbody>'
        + '<tr><td><code>PERPLEXITY_API_KEY</code></td><td>Keychain</td><td>API key for Perplexity Research skill.</td></tr>'
        + '<tr><td><code>AWS_ACCESS_KEY_ID</code></td><td>Keychain</td><td>AWS access key for AWS CLI skill.</td></tr>'
        + '<tr><td><code>AWS_SECRET_ACCESS_KEY</code></td><td>Keychain</td><td>AWS secret key.</td></tr>'
        + '<tr><td><code>AWS_DEFAULT_REGION</code></td><td>Config DB</td><td>AWS region.</td></tr>'
        + '<tr><td><code>AZURE_CLIENT_ID</code></td><td>Keychain</td><td>Azure app client ID.</td></tr>'
        + '<tr><td><code>AZURE_CLIENT_SECRET</code></td><td>Keychain</td><td>Azure client secret.</td></tr>'
        + '<tr><td><code>AZURE_TENANT_ID</code></td><td>Config DB</td><td>Azure AD tenant.</td></tr>'
        + '<tr><td><code>AZURE_SUBSCRIPTION_ID</code></td><td>Config DB</td><td>Azure subscription.</td></tr>'
        + '<tr><td><code>GOOGLE_APPLICATION_CREDENTIALS</code></td><td>Keychain</td><td>GCP service account credentials path.</td></tr>'
        + '<tr><td><code>CLOUDSDK_CORE_PROJECT</code></td><td>Config DB</td><td>GCP project ID.</td></tr>'
        + '</tbody></table>'
        + '<h3>Persistence &amp; Hot Reload</h3>'
        + '<p>Configuration values are stored in two locations:</p>'
        + '<ul>'
        + '<li><strong>Config DB</strong> &mdash; SQLite <code>config</code> table. Non-sensitive settings.</li>'
        + '<li><strong>Keychain</strong> &mdash; OS-level encrypted storage (macOS Keychain / Linux Secret Service / Windows Credential Manager). Sensitive keys (tokens, secrets, API keys).</li>'
        + '</ul>'
        + '<p>Some keys are <strong>hot-reloadable</strong> &mdash; changes take effect immediately without a daemon restart. '
        + 'The Settings UI indicates which keys require a restart. Hot-reloadable keys are synced to <code>process.env</code> at runtime.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> Internal/auto-generated keys (<code>SERVER_API_SECRET</code>, <code>DASHBOARD_SECRET</code>, <code>HUSKYGATE_API_BASE</code>, <code>HUSKYGATE_API_SECRET</code>) '
        + 'are managed automatically and not editable in the UI.</div>',

      'metrics':
        '<h2>Metrics</h2>'
        + '<p>The Metrics tab provides real-time operational monitoring of your HuskyGate instance.</p>'
        + '<h3>Range Selector</h3>'
        + '<p>Toggle between three time windows using the range buttons:</p>'
        + '<ul>'
        + '<li><strong>24h</strong> &mdash; Last 24 hours of activity.</li>'
        + '<li><strong>7d</strong> &mdash; Last 7 days (default view).</li>'
        + '<li><strong>30d</strong> &mdash; Last 30 days for trend analysis.</li>'
        + '</ul>'
        + '<p>Auto-refresh can be toggled to keep charts updated in real time.</p>'
        + '<h3>Charts</h3>'
        + '<p>The dashboard renders 9 interactive Chart.js visualizations:</p>'
        + '<table class="docs-cmd-table"><thead><tr><th>Chart</th><th>What it shows</th></tr></thead><tbody>'
        + '<tr><td>Job Activity</td><td>Job count over time (completed vs. failed).</td></tr>'
        + '<tr><td>Job Source</td><td>Distribution by source (Slack, Dashboard, Schedule, Orchestrator, Trigger).</td></tr>'
        + '<tr><td>Jobs &amp; Errors</td><td>Error rate overlaid on total job volume.</td></tr>'
        + '<tr><td>Duration</td><td>Average and P95 job duration over time.</td></tr>'
        + '<tr><td>Task Runs</td><td>On-demand and scheduled task run trends.</td></tr>'
        + '<tr><td>Orchestrator Runs</td><td>Orchestration execution volume and success rate.</td></tr>'
        + '<tr><td>Orchestrator Duration</td><td>Average orchestration runtime.</td></tr>'
        + '<tr><td>Error Distribution</td><td>Breakdown of error types (timeout, crash, stall, etc.).</td></tr>'
        + '<tr><td>Error Trend</td><td>Error rate over time for regression detection.</td></tr>'
        + '</tbody></table>'
        + '<h3>Summary Tables</h3>'
        + '<ul>'
        + '<li><strong>Task Summary</strong> &mdash; Run counts and success rates per task.</li>'
        + '<li><strong>Error by Tool</strong> &mdash; Error breakdown per CLI tool (Claude / Codex / Gemini).</li>'
        + '<li><strong>Recent Errors</strong> &mdash; Most recent error entries with details.</li>'
        + '</ul>'
        + '<h3>Gauges</h3>'
        + '<ul>'
        + '<li><strong>Queue Depth</strong> &mdash; Current number of pending jobs in the queue.</li>'
        + '<li><strong>Database Size</strong> &mdash; Current SQLite database file size.</li>'
        + '</ul>'
        + '<h3>Theme Support</h3>'
        + '<p>All charts automatically adapt to light/dark mode. Colors, grid lines, and point borders update when you switch the dashboard theme.</p>'
        + '<div class="docs-tip"><strong>Tip:</strong> The Metrics API endpoint is <code>GET /api/metrics?range=24h|7d|30d</code>. '
        + 'The Overview tab also shows a compact metrics grid (sessions, 24h jobs, success rate, errors) for a quick status check.</div>'
    };

    function docsGetSection(id) {
      for (var i = 0; i < DOCS_SECTIONS.length; i++) {
        if (DOCS_SECTIONS[i].id === id) return DOCS_SECTIONS[i];
      }
      return null;
    }

    function renderDocsNav() {
      var searchVal = '';
      var searchEl = document.getElementById('docs-search');
      if (searchEl) searchVal = searchEl.value.toLowerCase().trim();

      var html = '<div class="docs-search-wrap">';
      html += '<svg class="docs-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      html += '<input class="docs-search-input" id="docs-search" type="text" placeholder="Search docs..." oninput="renderDocsNav()" value="' + (searchVal ? searchVal.replace(/"/g, '&quot;') : '') + '">';
      html += '</div>';
      html += '<div class="docs-nav-scroll">';

      var anyVisible = false;
      for (var c = 0; c < DOCS_CATEGORIES.length; c++) {
        var cat = DOCS_CATEGORIES[c];
        var catItems = '';
        var catHasVisible = false;
        for (var j = 0; j < cat.items.length; j++) {
          var sec = docsGetSection(cat.items[j]);
          if (!sec) continue;
          var sub = DOCS_SUBTITLES[sec.id] || '';
          var hidden = searchVal && sec.label.toLowerCase().indexOf(searchVal) === -1 && sub.toLowerCase().indexOf(searchVal) === -1;
          if (!hidden) { catHasVisible = true; anyVisible = true; }
          var active = docsActiveSection === sec.id;
          catItems += '<div class="docs-nav-item' + (active ? ' active' : '') + (hidden ? ' docs-hidden' : '') + '" onclick="selectDocsSection(\\'' + sec.id + '\\')">';
          catItems += '<span class="docs-nav-icon">' + sec.icon + '</span>';
          catItems += '<span>' + sec.label + '</span>';
          catItems += '</div>';
        }
        if (!searchVal || catHasVisible) {
          html += '<div class="docs-cat-header' + (searchVal && !catHasVisible ? ' docs-hidden' : '') + '">' + cat.title + '</div>';
        }
        html += catItems;
      }
      if (!anyVisible) {
        html += '<div class="docs-no-results">No matching sections</div>';
      }
      html += '</div>';
      document.getElementById('docs-nav').innerHTML = html;

      var newSearch = document.getElementById('docs-search');
      if (newSearch && searchVal) {
        newSearch.focus();
        newSearch.setSelectionRange(searchVal.length, searchVal.length);
      }
    }

    function selectDocsSection(sectionId) {
      docsActiveSection = sectionId;
      renderDocsNav();
      renderDocsContent();
    }

    function renderDocsContent() {
      var raw = DOCS_CONTENT[docsActiveSection] || '<p>Section not found.</p>';
      var section = docsGetSection(docsActiveSection);

      var titleMatch = raw.match(/<h2>([\\s\\S]*?)<\\/h2>/);
      var title = titleMatch ? titleMatch[1] : (section ? section.label : '');
      var body = titleMatch ? raw.replace(/<h2>[\\s\\S]*?<\\/h2>/, '') : raw;

      var heroIcon = section ? section.icon.replace(/width="15"/g, 'width="22"').replace(/height="15"/g, 'height="22"') : '';
      var sub = DOCS_SUBTITLES[docsActiveSection] || '';

      var html = '<div class="docs-progress" id="docs-progress"></div>';
      html += '<div class="docs-hero"><div class="docs-hero-icon">' + heroIcon + '</div>';
      html += '<div class="docs-hero-text"><h2>' + title + '</h2>';
      if (sub) html += '<div class="docs-hero-sub">' + sub + '</div>';
      html += '</div></div>';

      var h3Matches = [];
      var h3Re = /<h3>([\\s\\S]*?)<\\/h3>/g;
      var m;
      while ((m = h3Re.exec(body)) !== null) h3Matches.push(m[1].replace(/<[^>]*>/g, ''));

      html += '<div class="docs-body">';
      if (h3Matches.length > 2) {
        html += '<div class="docs-mini-toc"><div class="docs-mini-toc-title">On this page</div>';
        for (var i = 0; i < h3Matches.length; i++) {
          html += '<a class="docs-mini-toc-item" onclick="docsScrollToH3(\\'docs-h3-' + i + '\\')">' + h3Matches[i] + '</a>';
        }
        html += '</div>';
      }
      html += body + '</div>';

      var panel = document.getElementById('docs-content');
      panel.innerHTML = html;
      panel.scrollTop = 0;

      docsEnhanceContent();
      docsInitProgress();
    }

    function docsEnhanceContent() {
      var panel = document.getElementById('docs-content');
      if (!panel) return;
      var body = panel.querySelector('.docs-body');
      if (!body) return;

      var pres = body.querySelectorAll('pre');
      for (var i = 0; i < pres.length; i++) {
        var pre = pres[i];
        if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains('docs-code-wrap')) continue;
        var wrap = document.createElement('div');
        wrap.className = 'docs-code-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        var btn = document.createElement('button');
        btn.className = 'docs-copy-btn';
        btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
        btn.setAttribute('onclick', 'docsCopyCode(this)');
        wrap.appendChild(btn);
      }

      var h3s = body.querySelectorAll('h3');
      for (var i = 0; i < h3s.length; i++) {
        var h3 = h3s[i];
        h3.id = 'docs-h3-' + i;
        var dot = document.createElement('span');
        dot.className = 'docs-h3-dot';
        h3.insertBefore(dot, h3.firstChild);
        var chev = document.createElement('span');
        chev.className = 'docs-chevron';
        chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
        h3.appendChild(chev);
        h3.setAttribute('onclick', 'toggleDocsH3(this)');
        var wrapper = document.createElement('div');
        wrapper.className = 'docs-h3-content';
        var next = h3.nextElementSibling;
        while (next && next.tagName !== 'H3' && next.tagName !== 'H2') {
          var toMove = next;
          next = next.nextElementSibling;
          wrapper.appendChild(toMove);
        }
        if (wrapper.childNodes.length > 0) {
          h3.parentNode.insertBefore(wrapper, h3.nextSibling);
        }
      }
    }

    function toggleDocsH3(el) {
      el.classList.toggle('docs-collapsed');
    }

    function docsCopyCode(btn) {
      var wrap = btn.parentNode;
      var pre = wrap.querySelector('pre');
      if (!pre) return;
      var text = pre.textContent || '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function() {
          btn.classList.add('docs-copied');
          btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied';
          setTimeout(function() {
            btn.classList.remove('docs-copied');
            btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy';
          }, 1500);
        });
      }
    }

    function docsScrollToH3(id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.classList.contains('docs-collapsed')) el.classList.remove('docs-collapsed');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function docsScrollTop() {
      var panel = document.getElementById('docs-content');
      if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function docsInitProgress() {
      var panel = document.getElementById('docs-content');
      var backTop = document.getElementById('docs-back-top');
      if (!panel) return;
      panel.onscroll = function() {
        var scrollTop = panel.scrollTop;
        var scrollHeight = panel.scrollHeight - panel.clientHeight;
        var progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        var bar = document.getElementById('docs-progress');
        if (bar) bar.style.width = progress + '%';
        if (backTop) {
          if (scrollTop > 200) backTop.classList.add('visible');
          else backTop.classList.remove('visible');
        }
      };
    }

    function renderDocs() {
      renderDocsNav();
      renderDocsContent();
    }
`;
