/** @module webhook-endpoint — CRUD for inbound webhook receiver endpoints. */
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CreateWebhookEndpoint, WebhookEndpoint } from '../event/types.js';
import { BOOL_TRANSFORM, StaleUpdateError, boolToDb, buildDynamicUpdate } from './store-utils.js';

interface WebhookEndpointRow {
  id: string;
  token: string;
  publisher_preset: string;
  verification_type: string;
  signature_header: string | null;
  signature_prefix: string | null;
  delivery_id_header: string | null;
  event_name_header: string | null;
  secret_ref: string | null;
  max_body_bytes: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function mapEndpoint(row: WebhookEndpointRow): WebhookEndpoint {
  return {
    id: row.id,
    token: row.token,
    publisherPreset: row.publisher_preset as WebhookEndpoint['publisherPreset'],
    verificationType: row.verification_type as WebhookEndpoint['verificationType'],
    signatureHeader: row.signature_header,
    signaturePrefix: row.signature_prefix,
    deliveryIdHeader: row.delivery_id_header,
    eventNameHeader: row.event_name_header,
    secretRef: row.secret_ref,
    maxBodyBytes: row.max_body_bytes,
    enabled: row.enabled !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateToken(): string {
  return crypto.randomBytes(18).toString('hex');
}

/** Webhook endpoint CRUD with token-based lookup and cascade deletion of subscriptions. */
export class WebhookEndpointStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateWebhookEndpoint): WebhookEndpoint {
    const id = input.id ?? crypto.randomUUID();
    const token = input.token?.trim() || generateToken();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO webhook_endpoints (
          id, token, publisher_preset, verification_type,
          signature_header, signature_prefix, delivery_id_header, event_name_header,
          secret_ref, max_body_bytes, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        token,
        input.publisherPreset ?? 'generic',
        input.verificationType ?? 'none',
        input.signatureHeader ?? null,
        input.signaturePrefix ?? null,
        input.deliveryIdHeader ?? null,
        input.eventNameHeader ?? null,
        input.secretRef ?? null,
        input.maxBodyBytes ?? 262144,
        boolToDb(input.enabled ?? true),
        now,
        now,
      );
    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to load created webhook endpoint: ${id}`);
    }
    return created;
  }

  getById(id: string): WebhookEndpoint | null {
    const row = this.db.prepare('SELECT * FROM webhook_endpoints WHERE id = ?').get(id) as
      | WebhookEndpointRow
      | undefined;
    return row ? mapEndpoint(row) : null;
  }

  findByToken(token: string): WebhookEndpoint | null {
    const row = this.db.prepare('SELECT * FROM webhook_endpoints WHERE token = ?').get(token) as
      | WebhookEndpointRow
      | undefined;
    return row ? mapEndpoint(row) : null;
  }

  list(): WebhookEndpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM webhook_endpoints ORDER BY created_at DESC')
      .all() as WebhookEndpointRow[];
    return rows.map(mapEndpoint);
  }

  update(id: string, patch: Partial<WebhookEndpoint>, expectedUpdatedAt?: string): void {
    const result = buildDynamicUpdate(patch as Record<string, unknown>, {
      fieldMap: {
        token: 'token',
        publisherPreset: 'publisher_preset',
        verificationType: 'verification_type',
        signatureHeader: 'signature_header',
        signaturePrefix: 'signature_prefix',
        deliveryIdHeader: 'delivery_id_header',
        eventNameHeader: 'event_name_header',
        secretRef: 'secret_ref',
        maxBodyBytes: 'max_body_bytes',
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
      .prepare(`UPDATE webhook_endpoints SET ${result.sets.join(', ')} ${whereClause}`)
      .run(...result.params);
    if (expectedUpdatedAt && info.changes === 0) {
      throw new StaleUpdateError('Webhook endpoint', id);
    }
  }

  delete(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM event_subscriptions WHERE endpoint_id = ?').run(id);
      this.db.prepare('DELETE FROM webhook_endpoints WHERE id = ?').run(id);
    })();
  }
}
