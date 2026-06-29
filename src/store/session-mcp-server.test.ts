import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionMcpServerStore } from './session-mcp-server.js';

function createStore() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE session_mcp_servers (
      session_key TEXT NOT NULL,
      server_id   TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (session_key, server_id)
    );
  `);
  return {
    db,
    store: new SessionMcpServerStore(db),
  };
}

let currentDb: Database.Database | null = null;

afterEach(() => {
  currentDb?.close();
  currentDb = null;
});

describe('SessionMcpServerStore', () => {
  it('keeps implicit all-enabled state until the first disable', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-a', true, ['srv-a', 'srv-b']);
    expect(store.listBySession('sess-1')).toEqual([]);

    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);
    expect(store.listBySession('sess-1')).toEqual([
      { sessionKey: 'sess-1', serverId: 'srv-a', enabled: true },
      { sessionKey: 'sess-1', serverId: 'srv-b', enabled: false },
    ]);
  });

  it('returns to implicit all-enabled state when every server is enabled again', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);
    store.setEnabled('sess-1', 'srv-b', true, ['srv-a', 'srv-b']);

    expect(store.listBySession('sess-1')).toEqual([]);
  });

  it('deletes rows by session and by server', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);
    store.setEnabled('sess-2', 'srv-a', false, ['srv-a', 'srv-b']);

    expect(store.deleteServer('srv-a')).toBe(2);
    expect(store.listBySession('sess-1')).toEqual([
      { sessionKey: 'sess-1', serverId: 'srv-b', enabled: false },
    ]);

    expect(store.deleteSession('sess-1')).toBe(1);
    expect(store.listBySession('sess-1')).toEqual([]);
  });

  it('rejects unknown server ids', () => {
    const { db, store } = createStore();
    currentDb = db;

    expect(() => store.setEnabled('sess-1', 'srv-missing', false, ['srv-a'])).toThrow(
      'Unknown MCP server for session override: srv-missing',
    );
  });

  it('reset() clears all overrides for a session', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);
    expect(store.listBySession('sess-1').length).toBe(2);

    store.reset('sess-1');
    expect(store.listBySession('sess-1')).toEqual([]);
  });

  it('reset() does not affect other sessions', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-a', false, ['srv-a', 'srv-b']);
    store.setEnabled('sess-2', 'srv-a', false, ['srv-a', 'srv-b']);

    store.reset('sess-1');

    expect(store.listBySession('sess-1')).toEqual([]);
    expect(store.listBySession('sess-2').length).toBe(2);
  });

  it('listBySession returns empty array when no overrides exist', () => {
    const { db, store } = createStore();
    currentDb = db;

    expect(store.listBySession('non-existent')).toEqual([]);
  });

  it('deduplicates server ids in allServerIds', () => {
    const { db, store } = createStore();
    currentDb = db;

    store.setEnabled('sess-1', 'srv-a', false, ['srv-a', 'srv-b', 'srv-a']);
    const rows = store.listBySession('sess-1');
    expect(rows).toEqual([
      { sessionKey: 'sess-1', serverId: 'srv-a', enabled: false },
      { sessionKey: 'sess-1', serverId: 'srv-b', enabled: true },
    ]);
  });

  it('filters non-string entries from allServerIds', () => {
    const { db, store } = createStore();
    currentDb = db;

    // Pass non-string values that should be filtered out
    store.setEnabled('sess-1', 'srv-a', false, [
      'srv-a',
      'srv-b',
      null as unknown as string,
      undefined as unknown as string,
      42 as unknown as string,
    ]);
    const rows = store.listBySession('sess-1');
    expect(rows).toHaveLength(2);
  });

  it('treats existingCount as 0 when countBySession returns undefined', () => {
    const { db, store } = createStore();
    currentDb = db;

    // biome-ignore lint/suspicious/noExplicitAny: test-only private field access
    const stmts = (store as any).stmts;
    const originalGet = stmts.countBySession.get.bind(stmts.countBySession);

    // Make countBySession.get() return undefined once to hit the ?? 0 fallback (line 97)
    stmts.countBySession.get = () => undefined;

    // With existingCount falling back to 0, disabling a server should pre-populate all servers
    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);

    // Restore original so listBySession works normally
    stmts.countBySession.get = originalGet;

    const rows = store.listBySession('sess-1');
    expect(rows).toEqual([
      { sessionKey: 'sess-1', serverId: 'srv-a', enabled: true },
      { sessionKey: 'sess-1', serverId: 'srv-b', enabled: false },
    ]);
  });

  it('treats enabledCount as 0 when countEnabledBySession returns undefined', () => {
    const { db, store } = createStore();
    currentDb = db;

    // First, populate the override set so existingCount > 0
    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b']);
    expect(store.listBySession('sess-1').length).toBe(2);

    // biome-ignore lint/suspicious/noExplicitAny: test-only private field access
    const stmts = (store as any).stmts;
    const originalGet = stmts.countEnabledBySession.get.bind(stmts.countEnabledBySession);

    // Make countEnabledBySession.get() return undefined to hit the ?? 0 fallback (line 118)
    stmts.countEnabledBySession.get = () => undefined;

    // Re-enable srv-b; enabledCount will fall back to 0, which != allServerIds.length,
    // so the cleanup branch will NOT delete the override set
    store.setEnabled('sess-1', 'srv-b', true, ['srv-a', 'srv-b']);

    // Restore original
    stmts.countEnabledBySession.get = originalGet;

    // Override rows should still exist because enabledCount (0) != 2
    const rows = store.listBySession('sess-1');
    expect(rows.length).toBe(2);
  });

  it('cleanup removes overrides when re-enabling the last disabled server (3 servers)', () => {
    const { db, store } = createStore();
    currentDb = db;

    // Disable two servers
    store.setEnabled('sess-1', 'srv-a', false, ['srv-a', 'srv-b', 'srv-c']);
    store.setEnabled('sess-1', 'srv-b', false, ['srv-a', 'srv-b', 'srv-c']);

    // Rows exist for the session
    expect(store.listBySession('sess-1').length).toBeGreaterThan(0);

    // Re-enable both — once all are enabled, overrides are cleaned up
    store.setEnabled('sess-1', 'srv-a', true, ['srv-a', 'srv-b', 'srv-c']);
    store.setEnabled('sess-1', 'srv-b', true, ['srv-a', 'srv-b', 'srv-c']);

    expect(store.listBySession('sess-1')).toEqual([]);
  });
});
