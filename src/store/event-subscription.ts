/** @module event-subscription — Webhook-to-target routing subscriptions. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CreateEventSubscription, EventSubscription } from '../event/types.js';
import { BOOL_TRANSFORM, StaleUpdateError, boolToDb, buildDynamicUpdate } from './store-utils.js';

interface EventSubscriptionRow {
  id: string;
  endpoint_id: string;
  target_type: string;
  orchestrator_id: string | null;
  triggered_task_id: string | null;
  node_id: string | null;
  filter_json: string | null;
  context_mapping_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function mapSubscription(row: EventSubscriptionRow): EventSubscription {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    targetType: row.target_type as EventSubscription['targetType'],
    orchestratorId: row.orchestrator_id,
    triggeredTaskId: row.triggered_task_id,
    nodeId: row.node_id,
    filterJson: row.filter_json,
    contextMappingJson: row.context_mapping_json,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** CRUD for event subscriptions linking webhook endpoints to orchestrators or triggered tasks. */
export class EventSubscriptionStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateEventSubscription): EventSubscription {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO event_subscriptions (
          id, endpoint_id, target_type, orchestrator_id, triggered_task_id, node_id,
          filter_json, context_mapping_json, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.endpointId,
        input.targetType,
        input.orchestratorId ?? null,
        input.triggeredTaskId ?? null,
        input.nodeId ?? null,
        input.filterJson ?? null,
        input.contextMappingJson ?? null,
        boolToDb(input.enabled ?? true),
        now,
        now,
      );
    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to load created event subscription: ${id}`);
    }
    return created;
  }

  getById(id: string): EventSubscription | null {
    const row = this.db.prepare('SELECT * FROM event_subscriptions WHERE id = ?').get(id) as
      | EventSubscriptionRow
      | undefined;
    return row ? mapSubscription(row) : null;
  }

  list(): EventSubscription[] {
    const rows = this.db
      .prepare('SELECT * FROM event_subscriptions ORDER BY created_at DESC')
      .all() as EventSubscriptionRow[];
    return rows.map(mapSubscription);
  }

  listByEndpointId(endpointId: string): EventSubscription[] {
    const rows = this.db
      .prepare('SELECT * FROM event_subscriptions WHERE endpoint_id = ? ORDER BY created_at ASC')
      .all(endpointId) as EventSubscriptionRow[];
    return rows.map(mapSubscription);
  }

  getTriggeredNodeSubscription(nodeId: string): EventSubscription | null {
    const row = this.db
      .prepare(
        `SELECT * FROM event_subscriptions
         WHERE target_type = 'triggered_node' AND node_id = ?
         LIMIT 1`,
      )
      .get(nodeId) as EventSubscriptionRow | undefined;
    return row ? mapSubscription(row) : null;
  }

  update(id: string, patch: Partial<EventSubscription>, expectedUpdatedAt?: string): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        endpointId: 'endpoint_id',
        targetType: 'target_type',
        orchestratorId: 'orchestrator_id',
        triggeredTaskId: 'triggered_task_id',
        nodeId: 'node_id',
        filterJson: 'filter_json',
        contextMappingJson: 'context_mapping_json',
        enabled: 'enabled',
      },
      transforms: {
        enabled: BOOL_TRANSFORM,
      },
      expectedUpdatedAt,
    });
    if (!result) return;
    const whereClause = result.extraWhere ? `WHERE id = ? ${result.extraWhere}` : 'WHERE id = ?';
    result.params.push(id);
    if (result.extraWhereParams) result.params.push(...result.extraWhereParams);
    const info = this.db
      .prepare(`UPDATE event_subscriptions SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    if (expectedUpdatedAt && info.changes === 0) {
      throw new StaleUpdateError('Event subscription', id);
    }
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM event_subscriptions WHERE id = ?').run(id);
  }
}
