/** @module webhook-delivery — Idempotent delivery tracking for inbound webhook dispatches. */
import type Database from 'better-sqlite3';

export type { DeliveryStatus } from '../shared/status.js';

interface DeliveryRow {
  endpoint_id: string;
  delivery_id: string;
  status: string;
  successful_sub_ids: string | null;
  created_at: string;
  updated_at: string;
}

/** Claim/complete/partial lifecycle for webhook delivery deduplication. */
export class WebhookDeliveryStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * Attempt to claim a delivery for dispatching.
   *
   * Returns:
   * - `claimed`    — first time seeing this deliveryId; caller should dispatch.
   * - `duplicate`  — already completed or another process is dispatching.
   * - `retry`      — previous attempt partially failed; caller may retry remaining subscriptions.
   */
  tryClaimDelivery(
    endpointId: string,
    deliveryId: string,
  ): { result: 'claimed' | 'duplicate' | 'retry'; successfulSubIds: string[] } {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        'SELECT status, successful_sub_ids FROM webhook_deliveries WHERE endpoint_id = ? AND delivery_id = ?',
      )
      .get(endpointId, deliveryId) as DeliveryRow | undefined;

    if (existing) {
      if (existing.status === 'completed' || existing.status === 'dispatching') {
        return {
          result: 'duplicate',
          successfulSubIds: existing.successful_sub_ids
            ? (JSON.parse(existing.successful_sub_ids) as string[])
            : [],
        };
      }
      // status === 'partial' — safe to retry
      const subIds = existing.successful_sub_ids
        ? (JSON.parse(existing.successful_sub_ids) as string[])
        : [];
      this.db
        .prepare(
          'UPDATE webhook_deliveries SET status = ?, updated_at = ? WHERE endpoint_id = ? AND delivery_id = ?',
        )
        .run('dispatching', now, endpointId, deliveryId);
      return { result: 'retry', successfulSubIds: subIds };
    }

    this.db
      .prepare(
        'INSERT INTO webhook_deliveries (endpoint_id, delivery_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(endpointId, deliveryId, 'dispatching', now, now);
    return { result: 'claimed', successfulSubIds: [] };
  }

  markCompleted(endpointId: string, deliveryId: string, successfulSubIds: string[]): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE webhook_deliveries SET status = ?, successful_sub_ids = ?, updated_at = ? WHERE endpoint_id = ? AND delivery_id = ?',
      )
      .run('completed', JSON.stringify(successfulSubIds), now, endpointId, deliveryId);
  }

  markPartial(endpointId: string, deliveryId: string, successfulSubIds: string[]): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE webhook_deliveries SET status = ?, successful_sub_ids = ?, updated_at = ? WHERE endpoint_id = ? AND delivery_id = ?',
      )
      .run('partial', JSON.stringify(successfulSubIds), now, endpointId, deliveryId);
  }

  /** Remove records older than cutoff (ISO timestamp). Returns deleted count. */
  deleteOlderThan(cutoffIso: string): number {
    return this.db.prepare('DELETE FROM webhook_deliveries WHERE updated_at < ?').run(cutoffIso)
      .changes;
  }
}
