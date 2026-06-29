/** @module store/agent-store — CRUD for reusable AI Agent persona definitions. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AiAgentRow } from '../orchestrator/types-db.js';
import type { AiAgent, AiAgentPatch, CreateAiAgent } from '../orchestrator/types.js';
import { mapAiAgent } from '../shared/mappers/orchestrator.js';
import {
  BOOL_TRANSFORM,
  JSON_TRANSFORM,
  StaleUpdateError,
  TRIM_OR_NULL_TRANSFORM,
  TRIM_TRANSFORM,
  boolToDb,
  buildDynamicUpdate,
  skillsToDb,
} from './store-utils.js';

export class AgentStore {
  private readonly stmts: {
    list: Database.Statement;
    listByTool: Database.Statement;
    getById: Database.Statement;
    getByName: Database.Statement;
    insert: Database.Statement;
    delete: Database.Statement;
    nullifyOrchestratorNodes: Database.Statement;
    nullifyScheduledTasks: Database.Statement;
    nullifyOndemandTasks: Database.Statement;
    nullifyTriggeredTasks: Database.Statement;
    countNodeUsage: Database.Statement;
    listNodeUsage: Database.Statement;
    countScheduledTaskUsage: Database.Statement;
    countOndemandTaskUsage: Database.Statement;
    countTriggeredTaskUsage: Database.Statement;
  };

  constructor(private readonly db: Database.Database) {
    this.stmts = {
      list: db.prepare('SELECT * FROM ai_agents ORDER BY name'),
      listByTool: db.prepare('SELECT * FROM ai_agents WHERE tool = ? ORDER BY name'),
      getById: db.prepare('SELECT * FROM ai_agents WHERE id = ?'),
      getByName: db.prepare('SELECT * FROM ai_agents WHERE name = ?'),
      insert: db.prepare(
        `INSERT INTO ai_agents (
          id, name, description, tool, model, system_instruction,
          enabled_skills_json, enabled_mcp_server_ids, allow_mcp,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      delete: db.prepare('DELETE FROM ai_agents WHERE id = ?'),
      nullifyOrchestratorNodes: db.prepare(
        'UPDATE orchestrator_nodes SET agent_id = NULL WHERE agent_id = ?',
      ),
      nullifyScheduledTasks: db.prepare(
        'UPDATE scheduled_tasks SET agent_id = NULL WHERE agent_id = ?',
      ),
      nullifyOndemandTasks: db.prepare(
        'UPDATE ondemand_tasks SET agent_id = NULL WHERE agent_id = ?',
      ),
      nullifyTriggeredTasks: db.prepare(
        'UPDATE triggered_tasks SET agent_id = NULL WHERE agent_id = ?',
      ),
      countNodeUsage: db.prepare(
        'SELECT COUNT(*) AS count FROM orchestrator_nodes WHERE agent_id = ?',
      ),
      listNodeUsage: db.prepare(
        `SELECT n.id AS node_id, n.label AS node_label, n.orchestrator_id,
                o.name AS orchestrator_name
         FROM orchestrator_nodes n
         LEFT JOIN orchestrators o ON o.id = n.orchestrator_id
         WHERE n.agent_id = ?`,
      ),
      countScheduledTaskUsage: db.prepare(
        "SELECT COUNT(*) AS count FROM scheduled_tasks WHERE agent_id = ? AND status != 'deleted'",
      ),
      countOndemandTaskUsage: db.prepare(
        "SELECT COUNT(*) AS count FROM ondemand_tasks WHERE agent_id = ? AND status != 'deleted'",
      ),
      countTriggeredTaskUsage: db.prepare(
        'SELECT COUNT(*) AS count FROM triggered_tasks WHERE agent_id = ?',
      ),
    };
  }

  list(): AiAgent[] {
    const rows = this.stmts.list.all() as AiAgentRow[];
    return rows.map(mapAiAgent);
  }

  listByTool(tool: string): AiAgent[] {
    const rows = this.stmts.listByTool.all(tool) as AiAgentRow[];
    return rows.map(mapAiAgent);
  }

  getById(id: string): AiAgent | null {
    const row = this.stmts.getById.get(id) as AiAgentRow | undefined;
    return row ? mapAiAgent(row) : null;
  }

  getByName(name: string): AiAgent | null {
    const row = this.stmts.getByName.get(name) as AiAgentRow | undefined;
    return row ? mapAiAgent(row) : null;
  }

  create(input: CreateAiAgent): AiAgent {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.stmts.insert.run(
      id,
      input.name.trim(),
      input.description?.trim() || null,
      input.tool,
      input.model ?? null,
      input.systemInstruction?.trim() || null,
      skillsToDb(input.enabledSkills),
      input.enabledMcpServerIds ? JSON.stringify(input.enabledMcpServerIds) : null,
      boolToDb(input.allowMcp ?? true),
      now,
      now,
    );
    const created = this.getById(id);
    if (!created) throw new Error(`Failed to create AI agent (id=${id})`);
    return created;
  }

  update(id: string, patch: AiAgentPatch, expectedUpdatedAt?: string): AiAgent | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      expectedUpdatedAt,
      fieldMap: {
        name: 'name',
        description: 'description',
        tool: 'tool',
        model: 'model',
        systemInstruction: 'system_instruction',
        enabledSkills: 'enabled_skills_json',
        enabledMcpServerIds: 'enabled_mcp_server_ids',
        allowMcp: 'allow_mcp',
      },
      transforms: {
        name: TRIM_TRANSFORM,
        description: TRIM_OR_NULL_TRANSFORM,
        model: TRIM_OR_NULL_TRANSFORM,
        systemInstruction: TRIM_OR_NULL_TRANSFORM,
        enabledSkills: JSON_TRANSFORM,
        enabledMcpServerIds: JSON_TRANSFORM,
        allowMcp: BOOL_TRANSFORM,
      },
    });
    if (!result) return existing;

    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(id);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);

    const info = this.db
      .prepare(`UPDATE ai_agents SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);

    if (info.changes === 0 && expectedUpdatedAt) {
      throw new StaleUpdateError('Agent', id);
    }
    return this.getById(id);
  }

  delete(id: string): boolean {
    // PRAGMA foreign_keys is OFF — ON DELETE SET NULL does not fire.
    // Manually nullify references inside a transaction for atomicity.
    return this.db.transaction(() => {
      this.stmts.nullifyOrchestratorNodes.run(id);
      this.stmts.nullifyScheduledTasks.run(id);
      this.stmts.nullifyOndemandTasks.run(id);
      this.stmts.nullifyTriggeredTasks.run(id);
      return this.stmts.delete.run(id).changes > 0;
    })();
  }

  getUsage(id: string): {
    count: number;
    nodes: Array<{
      nodeId: string;
      nodeLabel: string;
      orchestratorId: string;
      orchestratorName: string | null;
    }>;
    tasks: { scheduled: number; ondemand: number; triggered: number };
  } {
    const nodeCountRow = this.stmts.countNodeUsage.get(id) as { count: number } | undefined;
    const nodeCount = nodeCountRow?.count ?? 0;

    const tasks = {
      scheduled:
        (this.stmts.countScheduledTaskUsage.get(id) as { count: number } | undefined)?.count ?? 0,
      ondemand:
        (this.stmts.countOndemandTaskUsage.get(id) as { count: number } | undefined)?.count ?? 0,
      triggered:
        (this.stmts.countTriggeredTaskUsage.get(id) as { count: number } | undefined)?.count ?? 0,
    };
    const totalTaskCount = tasks.scheduled + tasks.ondemand + tasks.triggered;
    const count = nodeCount + totalTaskCount;

    if (nodeCount === 0) return { count, nodes: [], tasks };

    const rows = this.stmts.listNodeUsage.all(id) as Array<{
      node_id: string;
      node_label: string;
      orchestrator_id: string;
      orchestrator_name: string | null;
    }>;
    return {
      count,
      nodes: rows.map((r) => ({
        nodeId: r.node_id,
        nodeLabel: r.node_label,
        orchestratorId: r.orchestrator_id,
        orchestratorName: r.orchestrator_name,
      })),
      tasks,
    };
  }
}
