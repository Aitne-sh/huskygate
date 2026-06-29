/** @module default-instruction — Per-tool default custom instruction persistence. */
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';

export interface DefaultInstructionResult {
  content: string;
  enabled: boolean;
}

/**
 * Store for per-tool default custom instructions.
 * When enabled, the content fully replaces the generated base prompt.
 */
export class DefaultInstructionStore {
  constructor(private readonly db: Database.Database) {}

  /** Get content + enabled flag for a specific tool. */
  getWithEnabled(tool: ToolName): DefaultInstructionResult {
    const row = this.db
      .prepare('SELECT content, enabled FROM default_instructions WHERE tool = ?')
      .get(tool) as { content: string; enabled: number } | undefined;
    return {
      content: row?.content ?? '',
      enabled: row?.enabled === 1,
    };
  }

  /** Set default instruction content for a tool. Empty string clears it. */
  set(tool: ToolName, content: string): void {
    this.db
      .prepare(
        `INSERT INTO default_instructions (tool, content) VALUES (?, ?)
         ON CONFLICT(tool) DO UPDATE SET content = excluded.content`,
      )
      .run(tool, content);
  }

  /** Enable or disable full-replace mode for a tool. */
  setEnabled(tool: ToolName, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO default_instructions (tool, enabled) VALUES (?, ?)
         ON CONFLICT(tool) DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(tool, enabled ? 1 : 0);
  }
}
