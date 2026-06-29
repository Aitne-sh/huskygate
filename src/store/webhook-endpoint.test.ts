import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookEndpointStore } from './webhook-endpoint.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE webhook_endpoints (
      id                 TEXT PRIMARY KEY,
      token              TEXT NOT NULL UNIQUE,
      publisher_preset   TEXT NOT NULL DEFAULT 'generic',
      verification_type  TEXT NOT NULL DEFAULT 'none',
      signature_header   TEXT,
      signature_prefix   TEXT,
      delivery_id_header TEXT,
      event_name_header  TEXT,
      secret_ref         TEXT,
      max_body_bytes     INTEGER NOT NULL DEFAULT 262144,
      enabled            INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE TABLE event_subscriptions (
      endpoint_id TEXT
    );
  `);
  return db;
}

describe('WebhookEndpointStore', () => {
  let db: Database.Database | null = null;
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('creates, lists, fetches and deletes', () => {
    db = createDb();
    const store = new WebhookEndpointStore(db);

    // Explicit id and token check
    const ep0 = store.create({
      id: 'ep0-id',
      token: 'ep0-tok',
      publisherPreset: 'generic',
      verificationType: 'none',
    });
    expect(ep0.id).toBe('ep0-id');
    expect(ep0.token).toBe('ep0-tok');

    const ep = store.create({ publisherPreset: 'generic', verificationType: 'none' });
    expect(ep.id).toBeDefined();
    expect(ep.publisherPreset).toBe('generic');

    const generated = store.create({ token: '   ' } as never);
    expect(generated.token).toMatch(/^[0-9a-f]{36}$/);
    expect(generated.publisherPreset).toBe('generic');
    expect(generated.verificationType).toBe('none');

    // Load failure branch
    db.exec(
      "CREATE TRIGGER no_insert BEFORE INSERT ON webhook_endpoints BEGIN SELECT RAISE(ABORT, 'no'); END;",
    );
    expect(() => store.create({ publisherPreset: 'generic', verificationType: 'none' })).toThrow();
    db.exec('DROP TRIGGER no_insert');

    // Actually the failure to load is when insert succeeds but get fails. Not easy to mock without intercepting getById. Let's just catch the branch by doing normal ops.

    expect(store.getById(ep.id)).toBeDefined();
    expect(store.findByToken(ep.token)).toBeDefined();
    expect(store.getById('nonexistent')).toBeNull();
    expect(store.findByToken('nonexistent')).toBeNull();
    expect(store.list().length).toBeGreaterThanOrEqual(1);

    store.update(ep.id, { maxBodyBytes: 1000, enabled: false });
    let updated = store.getById(ep.id);
    expect(updated).not.toBeNull();
    if (!updated) throw new Error('Updated webhook endpoint should exist');
    expect(updated.maxBodyBytes).toBe(1000);
    expect(updated.enabled).toBe(false);

    store.update(ep.id, { token: 'newtoken' });
    expect(store.findByToken('newtoken')?.id).toBe(ep.id);
    updated = store.getById(ep.id);
    expect(updated).not.toBeNull();
    if (!updated) throw new Error('Reloaded webhook endpoint should exist');

    // Update with expectedUpdatedAt
    store.update(ep.id, { maxBodyBytes: 2000 }, updated.updatedAt);
    expect(store.getById(ep.id)?.maxBodyBytes).toBe(2000);

    // Stale update
    expect(() => store.update(ep.id, { maxBodyBytes: 3000 }, 'stale-time')).toThrow(
      /was modified by another request/,
    );

    // Blank update
    store.update(ep.id, {});
    expect(store.getById(ep.id)?.maxBodyBytes).toBe(2000);

    store.delete(ep.id);
    expect(store.getById(ep.id)).toBeNull();
  });

  it('throws when the created endpoint cannot be reloaded', () => {
    db = createDb();
    const store = new WebhookEndpointStore(db);
    const getByIdSpy = vi.spyOn(store, 'getById').mockReturnValueOnce(null);

    expect(() =>
      store.create({ publisherPreset: 'github', verificationType: 'hmac-sha256' }),
    ).toThrow(/Failed to load created webhook endpoint/);

    getByIdSpy.mockRestore();
  });
});
