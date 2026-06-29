/** @module store/skill-enablement — Per-skill per-driver global enablement persistence. */
import type Database from 'better-sqlite3';
import type { ToolName } from '../config.js';
import type { SkillRef } from '../skills/catalog.js';
import { boolFromDb, boolToDb } from '../utils/db.js';

interface SkillEnablementRow {
  skill_ref: SkillRef;
  tool: ToolName;
  enabled: number;
  updated_at: string;
}

export interface SkillEnablementRecord {
  skillRef: SkillRef;
  tool: ToolName;
  enabled: boolean;
  updatedAt: string;
}

export class SkillEnablementStore {
  constructor(private readonly db: Database.Database) {}

  listAll(): SkillEnablementRecord[] {
    const rows = this.db
      .prepare(
        `SELECT skill_ref, tool, enabled, updated_at
         FROM skill_enablement
         ORDER BY skill_ref, tool`,
      )
      .all() as SkillEnablementRow[];
    return rows.map(mapRow);
  }

  listBySkillRef(skillRef: SkillRef): SkillEnablementRecord[] {
    const rows = this.db
      .prepare(
        `SELECT skill_ref, tool, enabled, updated_at
         FROM skill_enablement
         WHERE skill_ref = ?
         ORDER BY tool`,
      )
      .all(skillRef) as SkillEnablementRow[];
    return rows.map(mapRow);
  }

  get(skillRef: SkillRef, tool: ToolName): SkillEnablementRecord | null {
    const row = this.db
      .prepare(
        `SELECT skill_ref, tool, enabled, updated_at
         FROM skill_enablement
         WHERE skill_ref = ? AND tool = ?`,
      )
      .get(skillRef, tool) as SkillEnablementRow | undefined;
    return row ? mapRow(row) : null;
  }

  getEnabled(skillRef: SkillRef, tool: ToolName): boolean | null {
    return this.get(skillRef, tool)?.enabled ?? null;
  }

  set(skillRef: SkillRef, tool: ToolName, enabled: boolean): void {
    this.db
      .prepare(
        `INSERT INTO skill_enablement (skill_ref, tool, enabled, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(skill_ref, tool) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(skillRef, tool, boolToDb(enabled));
  }

  delete(skillRef: SkillRef, tool: ToolName): number {
    const result = this.db
      .prepare(
        `DELETE FROM skill_enablement
         WHERE skill_ref = ? AND tool = ?`,
      )
      .run(skillRef, tool);
    return result.changes;
  }

  deleteBySkillRef(skillRef: SkillRef): number {
    const result = this.db
      .prepare(
        `DELETE FROM skill_enablement
         WHERE skill_ref = ?`,
      )
      .run(skillRef);
    return result.changes;
  }
}

function mapRow(row: SkillEnablementRow): SkillEnablementRecord {
  return {
    skillRef: row.skill_ref,
    tool: row.tool,
    enabled: boolFromDb(row.enabled),
    updatedAt: row.updated_at,
  };
}
