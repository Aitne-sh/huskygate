/** @module dev-alias — Named workspace aliases mapping a name to a path and tool. */
import type Database from 'better-sqlite3';
import { type ToolName, isToolName } from '../config.js';

export interface DevAlias {
  name: string;
  path: string;
  tool: ToolName;
  instructionContent: string | null;
  createdAt: string;
}

interface DevAliasRow {
  name: string;
  path: string;
  tool: string;
  instruction_content: string | null;
  created_at: string;
}

/** CRUD for developer workspace aliases (name, path, tool, optional instruction). */
export class DevAliasStore {
  private readonly stmts: {
    list: Database.Statement;
    get: Database.Statement;
    insert: Database.Statement;
    update: Database.Statement;
    delete: Database.Statement;
  };

  constructor(db: Database.Database) {
    this.stmts = {
      list: db.prepare('SELECT * FROM dev_aliases ORDER BY name'),
      get: db.prepare('SELECT * FROM dev_aliases WHERE name = ?'),
      insert: db.prepare(
        'INSERT INTO dev_aliases (name, path, tool, instruction_content, created_at) VALUES (?, ?, ?, ?, ?)',
      ),
      update: db.prepare(
        'UPDATE dev_aliases SET path = ?, tool = ?, instruction_content = ? WHERE name = ?',
      ),
      delete: db.prepare('DELETE FROM dev_aliases WHERE name = ?'),
    };
  }

  list(): DevAlias[] {
    const rows = this.stmts.list.all() as DevAliasRow[];
    return rows.map((r) => this.toAlias(r));
  }

  get(name: string): DevAlias | null {
    const row = this.stmts.get.get(name) as DevAliasRow | undefined;
    return row ? this.toAlias(row) : null;
  }

  create(name: string, path: string, tool: ToolName, instructionContent?: string | null): DevAlias {
    const now = new Date().toISOString();
    const content = instructionContent ?? null;
    this.stmts.insert.run(name, path, tool, content, now);
    return { name, path, tool, instructionContent: content, createdAt: now };
  }

  update(
    name: string,
    updates: { path?: string; tool?: ToolName; instructionContent?: string | null },
  ): DevAlias | null {
    const existing = this.get(name);
    if (!existing) return null;

    const newPath = updates.path ?? existing.path;
    const newTool = updates.tool ?? existing.tool;
    const newInstructionContent =
      updates.instructionContent !== undefined
        ? updates.instructionContent
        : existing.instructionContent;
    this.stmts.update.run(newPath, newTool, newInstructionContent, name);
    return { ...existing, path: newPath, tool: newTool, instructionContent: newInstructionContent };
  }

  delete(name: string): boolean {
    return this.stmts.delete.run(name).changes > 0;
  }

  private toAlias(row: DevAliasRow): DevAlias {
    return {
      name: row.name,
      path: row.path,
      tool: isToolName(row.tool) ? row.tool : 'claude',
      instructionContent: row.instruction_content ?? null,
      createdAt: row.created_at,
    };
  }
}
