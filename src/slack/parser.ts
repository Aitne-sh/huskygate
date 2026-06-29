/** @module parser — Parses Slack message text into typed CommandType discriminated unions for dispatch */
import type { ToolName } from '../config.js';
import type { Mode } from '../session/types.js';

export type CommandType =
  | { kind: 'prompt'; tool?: ToolName; prompt: string }
  | { kind: 'tool_switch'; tool: ToolName }
  | { kind: 'new_session'; tool: ToolName }
  | { kind: 'sessions' }
  | { kind: 'session_clear'; sessionId: string }
  | { kind: 'session_clear_all' }
  | { kind: 'start_session'; sessionId: string }
  | { kind: 'list_commands' }
  | { kind: 'current_session' }
  | { kind: 'exit' }
  | { kind: 'stop' }
  | { kind: 'status' }
  | { kind: 'reset' }
  | { kind: 'mode_change'; mode: Mode }
  | { kind: 'mode_net_disabled' }
  | { kind: 'confirm'; code: string }
  | { kind: 'workdir_query' }
  | { kind: 'workdir_change'; path: string }
  | { kind: 'workdir_reset' }
  | { kind: 'mcp' }
  | { kind: 'mcp_toggle'; enabled: boolean; serverName: string }
  | { kind: 'mcp_reset' }
  | { kind: 'dev'; alias: string }
  | { kind: 'dev_new'; alias: string }
  | { kind: 'dev_list' }
  | { kind: 'model_change'; model: string }
  | { kind: 'model_query' }
  | { kind: 'menu' }
  | { kind: 'autorun'; enabled?: boolean }
  | { kind: 'task'; nameOrAlias: string }
  | { kind: 'orch'; nameOrAlias: string }
  | { kind: 'orch_list' }
  | { kind: 'orch_status'; target: string }
  | { kind: 'orch_cancel'; runId: string }
  | { kind: 'unknown_bang'; input: string };

function normalizeBang(text: string): string {
  return text.startsWith('！') ? `!${text.slice(1)}` : text;
}

export function parseCommand(text: string): CommandType | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const bangNormalized = normalizeBang(trimmed);
  const isBangCommand = bangNormalized.startsWith('!');

  // Reserved approval commands: handled only when a pending approval exists.
  if (/^[!](yes|y|no|n)[.]?$/i.test(bangNormalized)) {
    return null;
  }

  if (isBangCommand) {
    if (/^!exit$/i.test(bangNormalized)) return { kind: 'exit' };
    // Session list: !s, !session (bare, no args)
    if (/^!(?:s|session)$/i.test(bangNormalized)) return { kind: 'sessions' };
    if (/^!current$/i.test(bangNormalized)) return { kind: 'current_session' };
    if (/^!help$/i.test(bangNormalized)) return { kind: 'list_commands' };
    // Dashboard menu: !menu
    if (/^!menu$/i.test(bangNormalized)) return { kind: 'menu' };

    const clearMatch = bangNormalized.match(/^!session-clear\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))$/i);
    if (clearMatch) {
      const sessionId = (clearMatch[1] ?? clearMatch[2] ?? clearMatch[3]) as string;
      if (sessionId.toLowerCase() === 'all') return { kind: 'session_clear_all' };
      return { kind: 'session_clear', sessionId };
    }

    const sessionSpaceMatch = bangNormalized.match(/^!session\s+([a-z0-9_-]{4,64})$/i);
    if (sessionSpaceMatch) {
      const sessionId = sessionSpaceMatch[1] as string;
      return { kind: 'start_session', sessionId };
    }

    const newMatch = bangNormalized.match(/^!new\s+(claude|codex|gemini)$/i);
    if (newMatch) {
      const tool = newMatch[1] as ToolName;
      return { kind: 'new_session', tool };
    }

    const aliasToolMatch = bangNormalized.match(/^!(claude|codex|gemini)(?:\s+(.+))?$/s);
    if (aliasToolMatch) {
      const toolName = aliasToolMatch[1] as ToolName;
      const prompt = aliasToolMatch[2]?.trim();
      if (prompt) {
        return { kind: 'prompt', tool: toolName, prompt };
      }
      return { kind: 'tool_switch', tool: toolName };
    }

    // Run control
    if (/^!stop$/i.test(bangNormalized)) return { kind: 'stop' };
    if (/^!status$/i.test(bangNormalized)) return { kind: 'status' };
    if (/^!reset$/i.test(bangNormalized)) return { kind: 'reset' };

    // Confirm: "!confirm XXXX"
    const confirmMatch = bangNormalized.match(/^!confirm\s+([A-Z0-9]{4})$/i);
    if (confirmMatch) {
      const code = confirmMatch[1] as string;
      return { kind: 'confirm', code: code.toUpperCase() };
    }

    // Mode change: "!mode=readonly" or "!mode=write"
    const modeMatch = bangNormalized.match(/^!mode=(readonly|write|net)$/);
    if (modeMatch) {
      const mode = modeMatch[1];
      if (mode === 'net') {
        return { kind: 'mode_net_disabled' };
      }
      return { kind: 'mode_change', mode: mode as Mode };
    }

    // Auto-run (auto-approve) toggle: "!autorun", "!autorun on", "!autorun off"
    const autorunMatch = bangNormalized.match(/^!autorun(?:\s+(on|off))?$/i);
    if (autorunMatch) {
      const arg = autorunMatch[1] as string | undefined;
      if (arg) {
        return { kind: 'autorun', enabled: arg.toLowerCase() === 'on' };
      }
      // Bare "!autorun" → toggle (no explicit enabled value)
      return { kind: 'autorun' };
    }

    // Model commands: "!model", "!m", "!model <value>", "!m=<value>"
    const modelEqualsMatch = bangNormalized.match(/^!(?:model|m)=(.+)$/i);
    if (modelEqualsMatch) {
      return { kind: 'model_change', model: (modelEqualsMatch[1] as string).trim() };
    }
    const modelSpaceMatch = bangNormalized.match(/^!(?:model|m)\s+(.+)$/i);
    if (modelSpaceMatch) {
      return { kind: 'model_change', model: (modelSpaceMatch[1] as string).trim() };
    }
    if (/^!(?:model|m)$/i.test(bangNormalized)) return { kind: 'model_query' };

    // Dev commands
    if (/^!dev$/i.test(bangNormalized)) return { kind: 'dev_list' };
    const devMatch = bangNormalized.match(/^!dev\s+([a-zA-Z0-9_-]{1,64})$/i);
    if (devMatch) {
      return { kind: 'dev', alias: devMatch[1] as string };
    }
    const devNewMatch = bangNormalized.match(/^!new-dev\s+([a-zA-Z0-9_-]{1,64})$/i);
    if (devNewMatch) {
      return { kind: 'dev_new', alias: devNewMatch[1] as string };
    }

    // Workdir commands
    if (/^!workdir$/i.test(bangNormalized)) return { kind: 'workdir_query' };
    if (/^!workdir=reset$/i.test(bangNormalized)) return { kind: 'workdir_reset' };
    const workdirMatch = bangNormalized.match(/^!workdir=(.+)$/);
    if (workdirMatch) {
      const requestedPath = workdirMatch[1] as string;
      return { kind: 'workdir_change', path: requestedPath };
    }

    // MCP commands
    if (/^!mcp$/i.test(bangNormalized)) return { kind: 'mcp' };
    if (/^!mcp\s+reset$/i.test(bangNormalized)) return { kind: 'mcp_reset' };
    const mcpToggleMatch = bangNormalized.match(/^!mcp\s+([+-])\s+([a-zA-Z0-9_-]{1,64})$/i);
    if (mcpToggleMatch) {
      return {
        kind: 'mcp_toggle',
        enabled: mcpToggleMatch[1] === '+',
        serverName: mcpToggleMatch[2] as string,
      };
    }

    // On-demand task: !task / !t <name_or_alias> (supports quoted names)
    const taskMatch = bangNormalized.match(/^!(?:task|t)\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/i);
    if (taskMatch) {
      const nameOrAlias = (taskMatch[1] ?? taskMatch[2] ?? taskMatch[3]) as string;
      return { kind: 'task', nameOrAlias };
    }

    // Orchestrator: !orch/!o list, status <target>, cancel <runId>, <alias>
    if (/^!(?:orch|o)\s+list$/i.test(bangNormalized)) return { kind: 'orch_list' };
    const orchStatusMatch = bangNormalized.match(
      /^!(?:orch|o)\s+status\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/i,
    );
    if (orchStatusMatch) {
      const target = (orchStatusMatch[1] ?? orchStatusMatch[2] ?? orchStatusMatch[3]) as string;
      return { kind: 'orch_status', target };
    }
    const orchCancelMatch = bangNormalized.match(/^!(?:orch|o)\s+cancel\s+(\S+)$/i);
    if (orchCancelMatch) return { kind: 'orch_cancel', runId: orchCancelMatch[1] as string };
    const orchMatch = bangNormalized.match(/^!(?:orch|o)\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/i);
    if (orchMatch) {
      const nameOrAlias = (orchMatch[1] ?? orchMatch[2] ?? orchMatch[3]) as string;
      return { kind: 'orch', nameOrAlias };
    }

    return { kind: 'unknown_bang', input: trimmed };
  }

  // Default: treat as prompt
  return { kind: 'prompt', prompt: trimmed };
}
