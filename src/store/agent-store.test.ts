import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSkillRef } from '../skills/catalog.js';
import { AgentStore } from './agent-store.js';

/**
 * Minimal in-memory schema containing ai_agents plus the referencing tables
 * (orchestrator_nodes, orchestrators, scheduled_tasks, ondemand_tasks, triggered_tasks)
 * so that delete-nullification and getUsage queries work correctly.
 */
function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_agents (
      id                      TEXT PRIMARY KEY,
      name                    TEXT NOT NULL UNIQUE,
      description             TEXT,
      tool                    TEXT NOT NULL,
      model                   TEXT,
      system_instruction      TEXT,
      enabled_skills_json     TEXT,
      enabled_mcp_server_ids  TEXT,
      allow_mcp               INTEGER NOT NULL DEFAULT 1,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL
    );

    CREATE TABLE orchestrators (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE orchestrator_nodes (
      id              TEXT PRIMARY KEY,
      orchestrator_id TEXT NOT NULL,
      label           TEXT NOT NULL,
      agent_id        TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE scheduled_tasks (
      id        TEXT PRIMARY KEY,
      agent_id  TEXT,
      status    TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE ondemand_tasks (
      id        TEXT PRIMARY KEY,
      agent_id  TEXT,
      status    TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE triggered_tasks (
      id        TEXT PRIMARY KEY,
      agent_id  TEXT
    );
  `);
  return db;
}

describe('AgentStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  // ── list ──────────────────────────────────────────────────────

  it('list returns empty array when no agents exist', () => {
    db = createDb();
    const store = new AgentStore(db);
    expect(store.list()).toEqual([]);
  });

  it('list returns all agents ordered by name', () => {
    db = createDb();
    const store = new AgentStore(db);
    store.create({ name: 'Zulu', tool: 'claude' });
    store.create({ name: 'Alpha', tool: 'gemini' });
    store.create({ name: 'Mike', tool: 'codex' });

    const agents = store.list();
    expect(agents.map((a) => a.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });

  // ── listByTool ────────────────────────────────────────────────

  it('listByTool filters agents by tool', () => {
    db = createDb();
    const store = new AgentStore(db);
    store.create({ name: 'A', tool: 'claude' });
    store.create({ name: 'B', tool: 'gemini' });
    store.create({ name: 'C', tool: 'claude' });

    const claudeAgents = store.listByTool('claude');
    expect(claudeAgents).toHaveLength(2);
    expect(claudeAgents.map((a) => a.name)).toEqual(['A', 'C']);

    const geminiAgents = store.listByTool('gemini');
    expect(geminiAgents).toHaveLength(1);
    expect(geminiAgents[0]?.name).toBe('B');

    expect(store.listByTool('codex')).toHaveLength(0);
  });

  // ── getById ───────────────────────────────────────────────────

  it('getById returns null for missing id', () => {
    db = createDb();
    const store = new AgentStore(db);
    expect(store.getById('nonexistent')).toBeNull();
  });

  it('getById returns the agent when found', () => {
    db = createDb();
    const store = new AgentStore(db);
    const created = store.create({ name: 'bot', tool: 'claude' });
    const fetched = store.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe('bot');
  });

  // ── getByName ─────────────────────────────────────────────────

  it('getByName returns null for unknown name', () => {
    db = createDb();
    const store = new AgentStore(db);
    expect(store.getByName('missing')).toBeNull();
  });

  it('getByName returns the agent when found', () => {
    db = createDb();
    const store = new AgentStore(db);
    const created = store.create({ name: 'finder', tool: 'gemini' });
    const fetched = store.getByName('finder');
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.tool).toBe('gemini');
  });

  // ── create ────────────────────────────────────────────────────

  it('create with minimal input applies defaults', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'minimal', tool: 'claude' });

    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe('minimal');
    expect(agent.tool).toBe('claude');
    expect(agent.description).toBeNull();
    expect(agent.model).toBeNull();
    expect(agent.systemInstruction).toBeNull();
    expect(agent.enabledSkills).toBeNull();
    expect(agent.enabledMcpServerIds).toBeNull();
    expect(agent.allowMcp).toBe(true);
    expect(agent.createdAt).toBeTruthy();
    expect(agent.updatedAt).toBeTruthy();
  });

  it('create with full input stores all fields', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({
      name: '  full agent  ',
      description: '  A full description  ',
      tool: 'codex',
      model: 'o3',
      systemInstruction: '  You are a bot  ',
      enabledSkills: [buildSkillRef('builtin', 'aws-cli')],
      enabledMcpServerIds: ['server-1', 'server-2'],
      allowMcp: false,
    });

    expect(agent.name).toBe('full agent'); // trimmed
    expect(agent.description).toBe('A full description'); // trimmed
    expect(agent.tool).toBe('codex');
    expect(agent.model).toBe('o3');
    expect(agent.systemInstruction).toBe('You are a bot'); // trimmed
    expect(agent.enabledSkills).toEqual([buildSkillRef('builtin', 'aws-cli')]);
    expect(agent.enabledMcpServerIds).toEqual(['server-1', 'server-2']);
    expect(agent.allowMcp).toBe(false);
  });

  it('create with null/undefined optional fields stores null', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({
      name: 'nullish',
      tool: 'claude',
      description: null,
      model: null,
      systemInstruction: null,
      enabledSkills: null,
      enabledMcpServerIds: null,
    });

    expect(agent.description).toBeNull();
    expect(agent.model).toBeNull();
    expect(agent.systemInstruction).toBeNull();
    expect(agent.enabledSkills).toBeNull();
    expect(agent.enabledMcpServerIds).toBeNull();
  });

  it('create with empty-string description/systemInstruction stores null', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({
      name: 'emptystrings',
      tool: 'claude',
      description: '   ',
      systemInstruction: '',
    });

    expect(agent.description).toBeNull();
    expect(agent.systemInstruction).toBeNull();
  });

  it('create throws if getById fails to find created agent', () => {
    db = createDb();
    const store = new AgentStore(db);
    vi.spyOn(store, 'getById').mockReturnValue(null);
    expect(() => store.create({ name: 'phantom', tool: 'claude' })).toThrow(
      /Failed to create AI agent/,
    );
  });

  // ── update ────────────────────────────────────────────────────

  it('update returns null for non-existent id', () => {
    db = createDb();
    const store = new AgentStore(db);
    expect(store.update('nonexistent', { name: 'x' })).toBeNull();
  });

  it('update with empty patch returns existing agent unchanged', () => {
    db = createDb();
    const store = new AgentStore(db);
    const created = store.create({ name: 'stable', tool: 'claude' });
    const before = store.getById(created.id);
    const result = store.update(created.id, {});
    expect(result?.updatedAt).toBe(before?.updatedAt);
  });

  it('update modifies individual fields', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'updatable', tool: 'claude', allowMcp: true });

    // Update name
    store.update(agent.id, { name: '  new name  ' });
    expect(store.getById(agent.id)?.name).toBe('new name');

    // Update description
    store.update(agent.id, { description: '  desc  ' });
    expect(store.getById(agent.id)?.description).toBe('desc');

    // Clear description with whitespace
    store.update(agent.id, { description: '   ' });
    expect(store.getById(agent.id)?.description).toBeNull();

    // Update tool
    store.update(agent.id, { tool: 'gemini' });
    expect(store.getById(agent.id)?.tool).toBe('gemini');

    // Update model
    store.update(agent.id, { model: 'claude-opus-4-6' });
    expect(store.getById(agent.id)?.model).toBe('claude-opus-4-6');

    // Clear model
    store.update(agent.id, { model: '  ' });
    expect(store.getById(agent.id)?.model).toBeNull();

    // Update systemInstruction
    store.update(agent.id, { systemInstruction: ' Be helpful ' });
    expect(store.getById(agent.id)?.systemInstruction).toBe('Be helpful');

    // Clear systemInstruction
    store.update(agent.id, { systemInstruction: '' });
    expect(store.getById(agent.id)?.systemInstruction).toBeNull();

    // Update enabledSkills
    store.update(agent.id, { enabledSkills: [buildSkillRef('builtin', 'gcp-cli')] });
    expect(store.getById(agent.id)?.enabledSkills).toEqual([buildSkillRef('builtin', 'gcp-cli')]);

    // Clear enabledSkills
    store.update(agent.id, { enabledSkills: null });
    expect(store.getById(agent.id)?.enabledSkills).toBeNull();

    // Update enabledMcpServerIds
    store.update(agent.id, { enabledMcpServerIds: ['s1'] });
    expect(store.getById(agent.id)?.enabledMcpServerIds).toEqual(['s1']);

    // Clear enabledMcpServerIds
    store.update(agent.id, { enabledMcpServerIds: null });
    expect(store.getById(agent.id)?.enabledMcpServerIds).toBeNull();

    // Update allowMcp
    store.update(agent.id, { allowMcp: false });
    expect(store.getById(agent.id)?.allowMcp).toBe(false);

    store.update(agent.id, { allowMcp: true });
    expect(store.getById(agent.id)?.allowMcp).toBe(true);
  });

  it('update with expectedUpdatedAt succeeds when matching', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'optimistic', tool: 'claude' });

    const result = store.update(agent.id, { description: 'updated' }, agent.updatedAt);
    expect(result?.description).toBe('updated');
  });

  it('update throws StaleUpdateError on stale expectedUpdatedAt', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'stale-check', tool: 'claude' });

    expect(() => store.update(agent.id, { description: 'conflict' }, 'bad-timestamp')).toThrow(
      /was modified by another request/,
    );
  });

  // ── delete ────────────────────────────────────────────────────

  it('delete removes agent and returns true', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'doomed', tool: 'claude' });

    expect(store.delete(agent.id)).toBe(true);
    expect(store.getById(agent.id)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  it('delete returns false for non-existent id', () => {
    db = createDb();
    const store = new AgentStore(db);
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('delete nullifies agent_id references in related tables', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'referenced', tool: 'claude' });

    // Insert referencing rows
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrators (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('orch-1', 'Orch', now, now);
    db.prepare(
      'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('node-1', 'orch-1', 'Node1', agent.id, now, now);
    db.prepare('INSERT INTO scheduled_tasks (id, agent_id) VALUES (?, ?)').run(
      'sched-1',
      agent.id,
    );
    db.prepare('INSERT INTO ondemand_tasks (id, agent_id) VALUES (?, ?)').run('od-1', agent.id);
    db.prepare('INSERT INTO triggered_tasks (id, agent_id) VALUES (?, ?)').run('tt-1', agent.id);

    expect(store.delete(agent.id)).toBe(true);

    // Verify references nullified
    const node = db.prepare('SELECT agent_id FROM orchestrator_nodes WHERE id = ?').get('node-1') as
      | { agent_id: string | null }
      | undefined;
    expect(node?.agent_id).toBeNull();

    const sched = db.prepare('SELECT agent_id FROM scheduled_tasks WHERE id = ?').get('sched-1') as
      | { agent_id: string | null }
      | undefined;
    expect(sched?.agent_id).toBeNull();

    const od = db.prepare('SELECT agent_id FROM ondemand_tasks WHERE id = ?').get('od-1') as
      | { agent_id: string | null }
      | undefined;
    expect(od?.agent_id).toBeNull();

    const tt = db.prepare('SELECT agent_id FROM triggered_tasks WHERE id = ?').get('tt-1') as
      | { agent_id: string | null }
      | undefined;
    expect(tt?.agent_id).toBeNull();
  });

  // ── getUsage ──────────────────────────────────────────────────

  it('getUsage returns zero counts when agent has no references', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'lonely', tool: 'claude' });

    const usage = store.getUsage(agent.id);
    expect(usage.count).toBe(0);
    expect(usage.nodes).toEqual([]);
    expect(usage.tasks).toEqual({ scheduled: 0, ondemand: 0, triggered: 0 });
  });

  it('getUsage returns zero counts for non-existent agent', () => {
    db = createDb();
    const store = new AgentStore(db);

    const usage = store.getUsage('nonexistent');
    expect(usage.count).toBe(0);
    expect(usage.nodes).toEqual([]);
    expect(usage.tasks).toEqual({ scheduled: 0, ondemand: 0, triggered: 0 });
  });

  it('getUsage counts orchestrator node usage and returns node details', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'used-agent', tool: 'claude' });

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrators (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('orch-1', 'Pipeline', now, now);
    db.prepare(
      'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('node-1', 'orch-1', 'Step 1', agent.id, now, now);
    db.prepare(
      'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('node-2', 'orch-1', 'Step 2', agent.id, now, now);

    const usage = store.getUsage(agent.id);
    expect(usage.count).toBe(2);
    expect(usage.nodes).toHaveLength(2);
    expect(usage.nodes).toEqual(
      expect.arrayContaining([
        {
          nodeId: 'node-1',
          nodeLabel: 'Step 1',
          orchestratorId: 'orch-1',
          orchestratorName: 'Pipeline',
        },
        {
          nodeId: 'node-2',
          nodeLabel: 'Step 2',
          orchestratorId: 'orch-1',
          orchestratorName: 'Pipeline',
        },
      ]),
    );
    expect(usage.tasks).toEqual({ scheduled: 0, ondemand: 0, triggered: 0 });
  });

  it('getUsage counts task usage (scheduled, ondemand, triggered)', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'task-agent', tool: 'claude' });

    // Active scheduled tasks (should count)
    db.prepare("INSERT INTO scheduled_tasks (id, agent_id, status) VALUES (?, ?, 'active')").run(
      'sched-1',
      agent.id,
    );
    db.prepare("INSERT INTO scheduled_tasks (id, agent_id, status) VALUES (?, ?, 'paused')").run(
      'sched-2',
      agent.id,
    );
    // Deleted scheduled task (should NOT count)
    db.prepare("INSERT INTO scheduled_tasks (id, agent_id, status) VALUES (?, ?, 'deleted')").run(
      'sched-3',
      agent.id,
    );

    // Active ondemand tasks (should count)
    db.prepare("INSERT INTO ondemand_tasks (id, agent_id, status) VALUES (?, ?, 'active')").run(
      'od-1',
      agent.id,
    );
    // Deleted ondemand task (should NOT count)
    db.prepare("INSERT INTO ondemand_tasks (id, agent_id, status) VALUES (?, ?, 'deleted')").run(
      'od-2',
      agent.id,
    );

    // Triggered tasks (all count regardless of status)
    db.prepare('INSERT INTO triggered_tasks (id, agent_id) VALUES (?, ?)').run('tt-1', agent.id);
    db.prepare('INSERT INTO triggered_tasks (id, agent_id) VALUES (?, ?)').run('tt-2', agent.id);
    db.prepare('INSERT INTO triggered_tasks (id, agent_id) VALUES (?, ?)').run('tt-3', agent.id);

    const usage = store.getUsage(agent.id);
    expect(usage.tasks).toEqual({ scheduled: 2, ondemand: 1, triggered: 3 });
    // No nodes referenced
    expect(usage.nodes).toEqual([]);
    // Total = 0 nodes + 2 + 1 + 3 = 6
    expect(usage.count).toBe(6);
  });

  it('getUsage combines node and task counts', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'combined', tool: 'claude' });

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrators (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('orch-1', 'Orch', now, now);
    db.prepare(
      'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('node-1', 'orch-1', 'N1', agent.id, now, now);

    db.prepare("INSERT INTO scheduled_tasks (id, agent_id, status) VALUES (?, ?, 'active')").run(
      'sched-1',
      agent.id,
    );

    const usage = store.getUsage(agent.id);
    // 1 node + 1 scheduled = 2
    expect(usage.count).toBe(2);
    expect(usage.nodes).toHaveLength(1);
    expect(usage.tasks.scheduled).toBe(1);
  });

  it('getUsage node detail shows null orchestrator name when orchestrator is missing', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'orphan-node', tool: 'claude' });

    // Node references a non-existent orchestrator via LEFT JOIN
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO orchestrator_nodes (id, orchestrator_id, label, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('node-orphan', 'missing-orch', 'Orphan', agent.id, now, now);

    const usage = store.getUsage(agent.id);
    expect(usage.count).toBe(1);
    expect(usage.nodes).toHaveLength(1);
    expect(usage.nodes[0]).toEqual({
      nodeId: 'node-orphan',
      nodeLabel: 'Orphan',
      orchestratorId: 'missing-orch',
      orchestratorName: null,
    });
  });

  // ── allowMcp default ─────────────────────────────────────────

  it('create defaults allowMcp to true when omitted', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'default-mcp', tool: 'claude' });
    expect(agent.allowMcp).toBe(true);
  });

  it('create allows explicit allowMcp false', () => {
    db = createDb();
    const store = new AgentStore(db);
    const agent = store.create({ name: 'no-mcp', tool: 'claude', allowMcp: false });
    expect(agent.allowMcp).toBe(false);
  });
});
