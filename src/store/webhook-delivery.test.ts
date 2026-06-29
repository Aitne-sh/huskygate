import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { WebhookDeliveryStore } from './webhook-delivery.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE webhook_deliveries (
      endpoint_id          TEXT NOT NULL,
      delivery_id          TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'dispatching',
      successful_sub_ids   TEXT,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,
      PRIMARY KEY (endpoint_id, delivery_id)
    );
  `);
  return db;
}

describe('WebhookDeliveryStore', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('tryClaimDelivery works for new, duplicate, and retry states', () => {
    db = createDb();
    const store = new WebhookDeliveryStore(db);

    // Initial claim
    const c1 = store.tryClaimDelivery('ep1', 'del1');
    expect(c1.result).toBe('claimed');
    expect(c1.successfulSubIds).toEqual([]);

    // Duplicate claim while dispatching
    const c2 = store.tryClaimDelivery('ep1', 'del1');
    expect(c2.result).toBe('duplicate');
    expect(c2.successfulSubIds).toEqual([]);

    // Mark completed
    store.markCompleted('ep1', 'del1', ['sub1']);

    // Duplicate claim after completed
    const c3 = store.tryClaimDelivery('ep1', 'del1');
    expect(c3.result).toBe('duplicate');
    expect(c3.successfulSubIds).toEqual(['sub1']);

    // Mark partial
    store.tryClaimDelivery('ep1', 'del2');
    store.markPartial('ep1', 'del2', ['subA']);

    const c4 = store.tryClaimDelivery('ep1', 'del2');
    expect(c4.result).toBe('retry');
    expect(c4.successfulSubIds).toEqual(['subA']);

    db.exec(
      "INSERT INTO webhook_deliveries (endpoint_id, delivery_id, status, created_at, updated_at) VALUES ('ep2', 'del-null-subids', 'dispatching', 'now', 'now')",
    );
    const c5 = store.tryClaimDelivery('ep2', 'del-null-subids');
    expect(c5.result).toBe('duplicate');
    expect(c5.successfulSubIds).toEqual([]);

    db.exec(
      "UPDATE webhook_deliveries SET status = 'partial' WHERE endpoint_id = 'ep2' AND delivery_id = 'del-null-subids'",
    );
    const c6 = store.tryClaimDelivery('ep2', 'del-null-subids');
    expect(c6.result).toBe('retry');
    expect(c6.successfulSubIds).toEqual([]);
  });

  it('deletes older deliveries', () => {
    db = createDb();
    const store = new WebhookDeliveryStore(db);

    db.exec(
      "INSERT INTO webhook_deliveries (endpoint_id, delivery_id, status, created_at, updated_at) VALUES ('ep1', 'del1', 'completed', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')",
    );
    db.exec(
      "INSERT INTO webhook_deliveries (endpoint_id, delivery_id, status, created_at, updated_at) VALUES ('ep1', 'del2', 'completed', '2020-01-03T00:00:00Z', '2020-01-03T00:00:00Z')",
    );

    const deleted = store.deleteOlderThan('2020-01-02T00:00:00Z');
    expect(deleted).toBe(1);
  });
});
