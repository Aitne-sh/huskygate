import { describe, expect, it } from 'vitest';
import { parseCommand } from './parser.js';

describe('parseCommand', () => {
  it('returns null for empty input', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  describe('run control commands', () => {
    it('parses !stop', () => {
      expect(parseCommand('!stop')).toEqual({ kind: 'stop' });
    });

    it('parses !status', () => {
      expect(parseCommand('!status')).toEqual({ kind: 'status' });
    });

    it('parses !reset', () => {
      expect(parseCommand('!reset')).toEqual({ kind: 'reset' });
    });

    it('treats bare stop/status/reset as prompts', () => {
      expect(parseCommand('stop')).toEqual({ kind: 'prompt', prompt: 'stop' });
      expect(parseCommand('status')).toEqual({ kind: 'prompt', prompt: 'status' });
      expect(parseCommand('reset')).toEqual({ kind: 'prompt', prompt: 'reset' });
    });
  });

  describe('bang command controls', () => {
    it('parses session commands', () => {
      expect(parseCommand('!exit')).toEqual({ kind: 'exit' });
      expect(parseCommand('!session')).toEqual({ kind: 'sessions' });
      expect(parseCommand('!s')).toEqual({ kind: 'sessions' });
      expect(parseCommand('!session-list')).toEqual({
        kind: 'unknown_bang',
        input: '!session-list',
      });
      expect(parseCommand('!session-clear all')).toEqual({ kind: 'session_clear_all' });
      expect(parseCommand('!session-clear 14d22348')).toEqual({
        kind: 'session_clear',
        sessionId: '14d22348',
      });
      expect(parseCommand('!session-clear "14d22348"')).toEqual({
        kind: 'session_clear',
        sessionId: '14d22348',
      });
      expect(parseCommand('!current')).toEqual({ kind: 'current_session' });
      expect(parseCommand('!session ab12cd34')).toEqual({
        kind: 'start_session',
        sessionId: 'ab12cd34',
      });
      expect(parseCommand('!new gemini')).toEqual({ kind: 'new_session', tool: 'gemini' });
    });

    it('parses help command', () => {
      expect(parseCommand('!help')).toEqual({ kind: 'list_commands' });
    });

    it('parses !menu command', () => {
      expect(parseCommand('!menu')).toEqual({ kind: 'menu' });
      expect(parseCommand('!Menu')).toEqual({ kind: 'menu' });
      expect(parseCommand('!MENU')).toEqual({ kind: 'menu' });
      expect(parseCommand('！menu')).toEqual({ kind: 'menu' });
    });

    it('returns unknown_bang for unmatched bang commands', () => {
      expect(parseCommand('!whatever')).toEqual({ kind: 'unknown_bang', input: '!whatever' });
      expect(parseCommand('!tool=claude')).toEqual({
        kind: 'unknown_bang',
        input: '!tool=claude',
      });
    });

    it('normalizes full-width bang prefix', () => {
      expect(parseCommand('！help')).toEqual({ kind: 'list_commands' });
      expect(parseCommand('！s')).toEqual({ kind: 'sessions' });
    });
  });

  describe('tool invocation', () => {
    it('parses prompt without tool prefix as default', () => {
      expect(parseCommand('hello world')).toEqual({ kind: 'prompt', prompt: 'hello world' });
    });

    it('parses bang tool switch without prompt', () => {
      expect(parseCommand('!claude')).toEqual({ kind: 'tool_switch', tool: 'claude' });
    });

    it('parses bang tool invocation with prompt', () => {
      expect(parseCommand('!gemini summarize this')).toEqual({
        kind: 'prompt',
        tool: 'gemini',
        prompt: 'summarize this',
      });
    });

    it('treats legacy tool= and /slash as prompts', () => {
      expect(parseCommand('tool=claude explain this')).toEqual({
        kind: 'prompt',
        prompt: 'tool=claude explain this',
      });
      expect(parseCommand('/gemini')).toEqual({ kind: 'prompt', prompt: '/gemini' });
    });

    it('does not treat reserved approval bang commands as prompts', () => {
      expect(parseCommand('!yes')).toBeNull();
      expect(parseCommand('!y')).toBeNull();
      expect(parseCommand('!no')).toBeNull();
      expect(parseCommand('!n')).toBeNull();
    });
  });

  describe('mode commands', () => {
    it('parses !mode=readonly', () => {
      expect(parseCommand('!mode=readonly')).toEqual({ kind: 'mode_change', mode: 'readonly' });
    });

    it('parses !mode=write', () => {
      expect(parseCommand('!mode=write')).toEqual({ kind: 'mode_change', mode: 'write' });
    });

    it('parses !mode=net as disabled command (Phase 1)', () => {
      expect(parseCommand('!mode=net')).toEqual({ kind: 'mode_net_disabled' });
    });

    it('parses !confirm code', () => {
      expect(parseCommand('!confirm A7K2')).toEqual({ kind: 'confirm', code: 'A7K2' });
    });

    it('parses !confirm code case-insensitive', () => {
      expect(parseCommand('!confirm a7k2')).toEqual({ kind: 'confirm', code: 'A7K2' });
    });

    it('treats bare mode=/confirm as prompts', () => {
      expect(parseCommand('mode=readonly')).toEqual({ kind: 'prompt', prompt: 'mode=readonly' });
      expect(parseCommand('confirm A7K2')).toEqual({ kind: 'prompt', prompt: 'confirm A7K2' });
    });
  });

  describe('autorun commands', () => {
    it('parses !autorun on/off and bare !autorun', () => {
      expect(parseCommand('!autorun on')).toEqual({ kind: 'autorun', enabled: true });
      expect(parseCommand('!autorun off')).toEqual({ kind: 'autorun', enabled: false });
      expect(parseCommand('!autorun')).toEqual({ kind: 'autorun' });
    });
  });

  describe('model commands', () => {
    it('parses !model as model_query', () => {
      expect(parseCommand('!model')).toEqual({ kind: 'model_query' });
    });

    it('parses !m as model_query', () => {
      expect(parseCommand('!m')).toEqual({ kind: 'model_query' });
    });

    it('parses !model with value as model_change', () => {
      expect(parseCommand('!model opus')).toEqual({ kind: 'model_change', model: 'opus' });
    });

    it('parses !m with value as model_change', () => {
      expect(parseCommand('!m claude-opus-4-6')).toEqual({
        kind: 'model_change',
        model: 'claude-opus-4-6',
      });
    });

    it('parses !model=value as model_change', () => {
      expect(parseCommand('!model=gpt-5')).toEqual({ kind: 'model_change', model: 'gpt-5' });
    });

    it('parses !m=value as model_change', () => {
      expect(parseCommand('!m=gemini-2.5-pro')).toEqual({
        kind: 'model_change',
        model: 'gemini-2.5-pro',
      });
    });

    it('parses !model default as model_change with default', () => {
      expect(parseCommand('!model default')).toEqual({ kind: 'model_change', model: 'default' });
    });

    it('does not conflict with !mode=write', () => {
      expect(parseCommand('!mode=write')).toEqual({ kind: 'mode_change', mode: 'write' });
      expect(parseCommand('!mode=readonly')).toEqual({ kind: 'mode_change', mode: 'readonly' });
    });

    it('normalizes full-width bang for model commands', () => {
      expect(parseCommand('！model')).toEqual({ kind: 'model_query' });
      expect(parseCommand('！m opus')).toEqual({ kind: 'model_change', model: 'opus' });
    });
  });

  describe('dev commands', () => {
    it('parses !dev as dev_list', () => {
      expect(parseCommand('!dev')).toEqual({ kind: 'dev_list' });
    });

    it('parses !dev <alias>', () => {
      expect(parseCommand('!dev my-project')).toEqual({ kind: 'dev', alias: 'my-project' });
    });

    it('parses !dev with alphanumeric/dash/underscore alias', () => {
      expect(parseCommand('!dev my_project-123')).toEqual({ kind: 'dev', alias: 'my_project-123' });
    });

    it('parses !new-dev <alias>', () => {
      expect(parseCommand('!new-dev my-project')).toEqual({ kind: 'dev_new', alias: 'my-project' });
    });

    it('rejects !dev with invalid alias chars', () => {
      expect(parseCommand('!dev my project')).toEqual({
        kind: 'unknown_bang',
        input: '!dev my project',
      });
    });
  });

  describe('workdir commands', () => {
    it('parses !workdir query', () => {
      expect(parseCommand('!workdir')).toEqual({ kind: 'workdir_query' });
    });

    it('parses !workdir=reset', () => {
      expect(parseCommand('!workdir=reset')).toEqual({ kind: 'workdir_reset' });
    });

    it('parses !workdir change', () => {
      expect(parseCommand('!workdir=/Users/test/project')).toEqual({
        kind: 'workdir_change',
        path: '/Users/test/project',
      });
    });

    it('treats bare workdir as prompt', () => {
      expect(parseCommand('workdir')).toEqual({ kind: 'prompt', prompt: 'workdir' });
    });
  });

  describe('mcp commands', () => {
    it('parses !mcp list/reset/toggle commands', () => {
      expect(parseCommand('!mcp')).toEqual({ kind: 'mcp' });
      expect(parseCommand('!mcp reset')).toEqual({ kind: 'mcp_reset' });
      expect(parseCommand('!mcp + aws-api')).toEqual({
        kind: 'mcp_toggle',
        enabled: true,
        serverName: 'aws-api',
      });
      expect(parseCommand('!mcp - internal_db')).toEqual({
        kind: 'mcp_toggle',
        enabled: false,
        serverName: 'internal_db',
      });
    });

    it('rejects malformed !mcp commands', () => {
      expect(parseCommand('!mcp +')).toEqual({ kind: 'unknown_bang', input: '!mcp +' });
      expect(parseCommand('!mcp enable aws-api')).toEqual({
        kind: 'unknown_bang',
        input: '!mcp enable aws-api',
      });
    });
  });

  describe('on-demand task commands', () => {
    it('parses !task with name', () => {
      expect(parseCommand('!task deploy')).toEqual({ kind: 'task', nameOrAlias: 'deploy' });
    });

    it('parses !t as alias for !task', () => {
      expect(parseCommand('!t deploy')).toEqual({ kind: 'task', nameOrAlias: 'deploy' });
    });

    it('supports quoted names with spaces', () => {
      expect(parseCommand('!task "daily report"')).toEqual({
        kind: 'task',
        nameOrAlias: 'daily report',
      });
      expect(parseCommand("!t 'build staging'")).toEqual({
        kind: 'task',
        nameOrAlias: 'build staging',
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('!TASK Deploy')).toEqual({ kind: 'task', nameOrAlias: 'Deploy' });
      expect(parseCommand('!T deploy')).toEqual({ kind: 'task', nameOrAlias: 'deploy' });
    });

    it('returns unknown_bang for bare !task without name', () => {
      expect(parseCommand('!task')).toEqual({ kind: 'unknown_bang', input: '!task' });
      expect(parseCommand('!t')).toEqual({ kind: 'unknown_bang', input: '!t' });
    });
  });

  describe('orchestrator commands', () => {
    it('parses !orch with alias', () => {
      expect(parseCommand('!orch deploy')).toEqual({ kind: 'orch', nameOrAlias: 'deploy' });
    });

    it('parses !o as alias for !orch', () => {
      expect(parseCommand('!o deploy')).toEqual({ kind: 'orch', nameOrAlias: 'deploy' });
    });

    it('supports quoted names with spaces', () => {
      expect(parseCommand('!orch "my pipeline"')).toEqual({
        kind: 'orch',
        nameOrAlias: 'my pipeline',
      });
      expect(parseCommand("!orch 'deploy staging'")).toEqual({
        kind: 'orch',
        nameOrAlias: 'deploy staging',
      });
      expect(parseCommand('!o "my pipeline"')).toEqual({
        kind: 'orch',
        nameOrAlias: 'my pipeline',
      });
    });

    it('parses !orch list', () => {
      expect(parseCommand('!orch list')).toEqual({ kind: 'orch_list' });
      expect(parseCommand('!ORCH LIST')).toEqual({ kind: 'orch_list' });
      expect(parseCommand('!o list')).toEqual({ kind: 'orch_list' });
    });

    it('parses !orch status', () => {
      expect(parseCommand('!orch status deploy')).toEqual({
        kind: 'orch_status',
        target: 'deploy',
      });
      expect(parseCommand('!orch status "my pipeline"')).toEqual({
        kind: 'orch_status',
        target: 'my pipeline',
      });
      expect(parseCommand('!o status deploy')).toEqual({
        kind: 'orch_status',
        target: 'deploy',
      });
    });

    it('parses !orch cancel', () => {
      expect(parseCommand('!orch cancel abc12345')).toEqual({
        kind: 'orch_cancel',
        runId: 'abc12345',
      });
      expect(parseCommand('!o cancel abc12345')).toEqual({
        kind: 'orch_cancel',
        runId: 'abc12345',
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('!ORCH Deploy')).toEqual({ kind: 'orch', nameOrAlias: 'Deploy' });
      expect(parseCommand('!O Deploy')).toEqual({ kind: 'orch', nameOrAlias: 'Deploy' });
    });

    it('returns unknown_bang for bare !orch and !o', () => {
      expect(parseCommand('!orch')).toEqual({ kind: 'unknown_bang', input: '!orch' });
      expect(parseCommand('!o')).toEqual({ kind: 'unknown_bang', input: '!o' });
    });
  });
});
