/** @module session-mcp-server — Per-session MCP server enable/disable overrides. */
import type Database from 'better-sqlite3';
import { boolFromDb, boolToDb } from './store-utils.js';

interface SessionMcpServerRow {
  session_key: string;
  server_id: string;
  enabled: number;
}

export interface SessionMcpServerRecord {
  sessionKey: string;
  serverId: string;
  enabled: boolean;
}

function mapRow(row: SessionMcpServerRow): SessionMcpServerRecord {
  return {
    sessionKey: row.session_key,
    serverId: row.server_id,
    enabled: boolFromDb(row.enabled),
  };
}

/** Session-scoped overrides for which MCP servers are enabled. */
export class SessionMcpServerStore {
  private readonly stmts: {
    listBySession: Database.Statement;
    countBySession: Database.Statement;
    countEnabledBySession: Database.Statement;
    upsert: Database.Statement;
    deleteBySession: Database.Statement;
    deleteByServer: Database.Statement;
  };

  constructor(private readonly db: Database.Database) {
    this.stmts = {
      listBySession: db.prepare(
        `SELECT session_key, server_id, enabled
           FROM session_mcp_servers
          WHERE session_key = ?
          ORDER BY server_id`,
      ),
      countBySession: db.prepare(
        'SELECT COUNT(*) AS count FROM session_mcp_servers WHERE session_key = ?',
      ),
      countEnabledBySession: db.prepare(
        'SELECT COUNT(*) AS count FROM session_mcp_servers WHERE session_key = ? AND enabled = 1',
      ),
      upsert: db.prepare(
        `INSERT INTO session_mcp_servers (session_key, server_id, enabled)
         VALUES (?, ?, ?)
         ON CONFLICT(session_key, server_id)
         DO UPDATE SET enabled = excluded.enabled`,
      ),
      deleteBySession: db.prepare('DELETE FROM session_mcp_servers WHERE session_key = ?'),
      deleteByServer: db.prepare('DELETE FROM session_mcp_servers WHERE server_id = ?'),
    };
  }

  listBySession(sessionKey: string): SessionMcpServerRecord[] {
    const rows = this.stmts.listBySession.all(sessionKey) as SessionMcpServerRow[];
    return rows.map(mapRow);
  }

  reset(sessionKey: string): void {
    this.stmts.deleteBySession.run(sessionKey);
  }

  deleteSession(sessionKey: string): number {
    return this.stmts.deleteBySession.run(sessionKey).changes;
  }

  deleteServer(serverId: string): number {
    return this.stmts.deleteByServer.run(serverId).changes;
  }

  setEnabled(
    sessionKey: string,
    serverId: string,
    enabled: boolean,
    allServerIds: ReadonlyArray<string>,
  ): void {
    const normalizedServerIds = [...new Set(allServerIds.filter((id) => typeof id === 'string'))];
    if (!normalizedServerIds.includes(serverId)) {
      throw new Error(`Unknown MCP server for session override: ${serverId}`);
    }

    const updateTxn = this.db.transaction(() => {
      const existingCount =
        (
          this.stmts.countBySession.get(sessionKey) as
            | {
                count: number;
              }
            | undefined
        )?.count ?? 0;

      if (existingCount === 0) {
        if (enabled) {
          return;
        }
        for (const id of normalizedServerIds) {
          this.stmts.upsert.run(sessionKey, id, boolToDb(id !== serverId));
        }
        return;
      }

      this.stmts.upsert.run(sessionKey, serverId, boolToDb(enabled));

      const enabledCount =
        (
          this.stmts.countEnabledBySession.get(sessionKey) as
            | {
                count: number;
              }
            | undefined
        )?.count ?? 0;
      if (enabledCount === normalizedServerIds.length) {
        this.stmts.deleteBySession.run(sessionKey);
      }
    });

    updateTxn();
  }
}
