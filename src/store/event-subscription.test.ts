import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventSubscriptionStore } from './event-subscription.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE event_subscriptions (
      id                   TEXT PRIMARY KEY,
      endpoint_id          TEXT NOT NULL,
      target_type          TEXT NOT NULL CHECK (target_type IN ('orchestrator', 'triggered_task', 'triggered_node')),
      orchestrator_id      TEXT,
      triggered_task_id    TEXT,
      node_id              TEXT,
      filter_json          TEXT,
      context_mapping_json TEXT,
      enabled              INTEGER NOT NULL DEFAULT 1,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
  `);
  return db;
}

describe('EventSubscriptionStore', () => {
  let db: Database.Database | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('crud', () => {
    db = createDb();
    const store = new EventSubscriptionStore(db);
    const sub = store.create({ endpointId: 'ep1', targetType: 'triggered_node', nodeId: 'node1' });
    expect(sub.id).toBeDefined();
    expect(sub.endpointId).toBe('ep1');

    const sub2 = store.create({
      endpointId: 'ep1',
      targetType: 'orchestrator',
      orchestratorId: 'orch1',
      enabled: false,
    });

    // Failed load branch needs intercepting, omit or handle differently. Normal path ok.

    expect(store.list().length).toBe(2);
    expect(store.listByEndpointId('ep1').length).toBe(2);
    expect(store.listByEndpointId('ep2').length).toBe(0);

    expect(store.getTriggeredNodeSubscription('node1')?.id).toBe(sub.id);
    expect(store.getTriggeredNodeSubscription('missing')).toBeNull();

    expect(store.getById(sub.id)).toBeDefined();
    expect(store.getById('missing')).toBeNull();

    store.update(sub.id, { filterJson: '{"a":1}' });
    const updated = store.getById(sub.id);
    expect(updated).not.toBeNull();
    if (!updated) throw new Error('Updated subscription should exist');
    expect(updated.filterJson).toBe('{"a":1}');

    store.update(sub.id, { enabled: false }, updated.updatedAt);

    // Blank update
    store.update(sub.id, {});

    // Stale update
    expect(() => store.update(sub.id, { enabled: true }, 'bad-time')).toThrow(
      /was modified by another request/,
    );

    store.delete(sub.id);
    expect(store.list().length).toBe(1);
    store.delete(sub2.id);
  });

  it('throws when the created row cannot be reloaded', () => {
    db = createDb();
    const store = new EventSubscriptionStore(db);
    const getByIdSpy = vi.spyOn(store, 'getById').mockReturnValueOnce(null);

    expect(() =>
      store.create({ endpointId: 'ep1', targetType: 'triggered_task', triggeredTaskId: 'task-1' }),
    ).toThrow(/Failed to load created event subscription/);

    getByIdSpy.mockRestore();
  });
});
