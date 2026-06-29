/** @module queue-store — Durable queue persistence abstraction used by JobQueue. */
import type { Job } from './types.js';

export type PersistedJobState = 'queued' | 'running';

export interface PersistedQueueJob {
  order: number;
  state: PersistedJobState;
  leasedAt: string | null;
  job: Job;
}

/** Persistence boundary for active queue state. */
export interface QueueStore {
  /**
   * Persist a new active job.
   * Returns the 1-based queue position for `queued` jobs, or `0` for `running`.
   */
  save(job: Job, state: PersistedJobState): number;
  /** Transition an existing persisted row from `queued` to `running`. */
  markRunning(jobId: string): void;
  /** Replace an existing persisted row while preserving FIFO order. */
  replace(jobId: string, job: Job, state: PersistedJobState): void;
  /** Remove an active job after completion or explicit interruption handling. */
  remove(jobId: string): void;
  /** Remove queued jobs for a session without affecting a running lease. */
  removeQueuedBySession(sessionKey: string): number;
  /** List active queue rows in stable FIFO order. */
  listActive(): PersistedQueueJob[];
}
