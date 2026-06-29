/** @module dashboard/app — Server-side renderer for the single-page dashboard HTML shell. */
import { ICON_LOGO } from './icons.js';
import { agentsScript } from './scripts/agents.js';
import { chatScript } from './scripts/chat.js';
import { devScript } from './scripts/dev.js';
import { docsScript } from './scripts/docs.js';
import { eventTriggersScript } from './scripts/event-triggers.js';
import { helpersScript } from './scripts/helpers.js';
import { logsScript } from './scripts/logs.js';
import { mcpScript } from './scripts/mcp.js';
import { metricsTabScript } from './scripts/metrics-tab.js';
import { ondemandTasksScript } from './scripts/ondemand-tasks.js';
import { orchestratorEdgeModalScript } from './scripts/orchestrator-edge-modal.js';
import { orchestratorEditorScript } from './scripts/orchestrator-editor.js';
import { orchestratorExecutionScript } from './scripts/orchestrator-execution.js';
import { orchestratorGuideScript } from './scripts/orchestrator-guide.js';
import { orchestratorNodePanelScript } from './scripts/orchestrator-node-panel.js';
import { orchestratorReturnModalScript } from './scripts/orchestrator-return-modal.js';
import { orchestratorRunsScript } from './scripts/orchestrator-runs.js';
import { orchestratorSettingsScript } from './scripts/orchestrator-settings.js';
import { orchestratorScript } from './scripts/orchestrator.js';
import { overviewScript } from './scripts/overview.js';
import { scheduleTasksScript } from './scripts/schedule-tasks.js';
import { settingsScript } from './scripts/settings.js';
import { skillsScript } from './scripts/skills.js';
import { traceScript } from './scripts/trace.js';
import { triggeredTasksScript } from './scripts/triggered-tasks.js';
import { utilitiesScript } from './scripts/utilities.js';
import { agentStyles } from './styles/agents.js';
import { baseStyles } from './styles/base.js';
import { chatStyles } from './styles/chat.js';
import { componentStyles } from './styles/components.js';
import { metricsStyles } from './styles/metrics.js';
import { orchestratorStyles } from './styles/orchestrator.js';
import { pageStyles } from './styles/pages.js';
import { tokenStyles } from './styles/tokens.js';
import { layoutHtml } from './templates/layout.js';

export function renderApp(config: { version: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HuskyGate Dashboard</title>
  <link rel="icon" type="image/png" href="${ICON_LOGO}">
  <link rel="apple-touch-icon" href="${ICON_LOGO}">
  <style>${tokenStyles}${baseStyles}${componentStyles}${pageStyles}${orchestratorStyles}${chatStyles}${agentStyles}${metricsStyles}  </style>
  <script>(function(){var t=localStorage.getItem('huskygate-theme');if(t){document.documentElement.setAttribute('data-theme',t)}else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches){document.documentElement.setAttribute('data-theme','dark')}})()</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js" integrity="sha384-vsrfeLOOY6KuIYKDlmVH5UiBmgIdB1oEf7p01YgWHuqmOHfZr374+odEv96n9tNC" crossorigin="anonymous"></script>${layoutHtml(config, escapeHtml)}
  <script>(function(){var h=location.hash.replace('#','')||'overview';if(h.indexOf('chat/')===0)h='chat';var p=document.getElementById('tab-'+h);if(!p){h='overview';p=document.getElementById('tab-overview');}if(p)p.classList.add('active');var n=h;if(h==='ondemand-tasks'||h==='schedule-tasks'||h==='triggered-tasks'||h==='orchestrators')n='tasks';var l=document.querySelector('[data-tab="'+n+'"]');if(l)l.classList.add('active');var T={overview:'Overview',metrics:'Metrics',sessions:'Sessions',tasks:'Tasks','ondemand-tasks':'On-Demand Tasks','schedule-tasks':'Schedule Tasks','triggered-tasks':'Triggered Tasks',orchestrators:'Orchestrators',agents:'Agents',webhooks:'Webhooks',logs:'Logs',settings:'Settings',docs:'Docs',dev:'Developer',mcp:'MCP Servers',skills:'Skills',chat:'Chat'};var t=document.getElementById('page-title');if(t)t.textContent=T[h]||h;})()</script>
  <script>${helpersScript}${agentsScript}${overviewScript}${metricsTabScript}${logsScript}${settingsScript()}${docsScript}${devScript}${ondemandTasksScript}${scheduleTasksScript}${triggeredTasksScript}${eventTriggersScript}${orchestratorScript}${orchestratorEditorScript}${orchestratorReturnModalScript}${orchestratorGuideScript}${orchestratorSettingsScript}${orchestratorNodePanelScript}${orchestratorExecutionScript}${orchestratorEdgeModalScript}${orchestratorRunsScript}${chatScript()}${utilitiesScript}${mcpScript}${skillsScript()}${traceScript()}  </script>
</body>
</html>`;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
