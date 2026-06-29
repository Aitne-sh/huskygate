/** @module job-queue — FIFO job queue with per-session serialization and global concurrency control. */
import type { Config } from '../config.js';
import { RETRY_LIMITS } from '../shared/constants.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import type { QueueStore } from './queue-store.js';
import type { Job } from './types.js';

type JobExecutor = (job: Job) => Promise<void>;

/**
 * FIFO job queue that serializes jobs within a session while allowing concurrent execution across sessions up to a global limit.
 */
const MAX_MARK_RUNNING_RETRIES = RETRY_LIMITS.markRunning;

export class JobQueue {
  private pending: Job[] = [];
  private readonly running = new Map<string, Job>();
  private executor: JobExecutor | null = null;
  private accepting = true;
  private readonly markRunningFailures = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly store: QueueStore | null = null,
  ) {}

  setExecutor(executor: JobExecutor): void {
    this.executor = executor;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  get runningCount(): number {
    return this.running.size;
  }

  get queueDepth(): number {
    return this.pending.length;
  }

  getRunningJob(sessionKey: string): Job | undefined {
    return this.running.get(sessionKey);
  }

  getAllRunningJobs(): Job[] {
    return [...this.running.values()];
  }

  restoreQueuedJobs(jobs: Job[]): void {
    if (jobs.length === 0) return;
    this.pending.push(...jobs);
    logger.info('job_queue_restored', { count: jobs.length });
    this.drainGlobal();
  }

  enqueue(job: Job): { position: number } | { error: string } {
    if (!this.accepting) {
      return { error: 'Queue is not accepting new jobs (shutting down).' };
    }

    const shouldQueue =
      this.running.has(job.sessionKey) || this.running.size >= this.config.maxConcurrency;

    try {
      if (shouldQueue) {
        const position = this.store ? this.store.save(job, 'queued') : this.pending.length + 1;
        this.pending.push(job);
        logger.info('job_queued', { job_id: job.id, session_key: job.sessionKey, position });
        return { position };
      }

      if (this.store) {
        this.store.save(job, 'running');
      }
    } catch (err) {
      const message = errorMessage(err);
      logger.error('job_queue_persist_failed', {
        job_id: job.id,
        session_key: job.sessionKey,
        error: message,
      });
      return { error: `Queue persistence failed: ${message}` };
    }

    this.startJob(job, { fromPending: false });
    return { position: 0 };
  }

  private startJob(job: Job, options: { fromPending: boolean }): void {
    const { fromPending } = options;

    if (!this.executor) {
      logger.error('no_executor_set');
      if (!fromPending && this.store) {
        this.removePersistedJob(job.id);
      }
      return;
    }

    if (fromPending && this.store) {
      try {
        this.store.markRunning(job.id);
        this.markRunningFailures.delete(job.id);
      } catch (err) {
        const count = (this.markRunningFailures.get(job.id) ?? 0) + 1;
        this.markRunningFailures.set(job.id, count);
        logger.error('job_queue_mark_running_failed', {
          job_id: job.id,
          error: errorMessage(err),
          attempt: count,
        });
        if (count >= MAX_MARK_RUNNING_RETRIES) {
          // Permanently discard to avoid infinite retry loop
          this.markRunningFailures.delete(job.id);
          this.removePersistedJob(job.id);
          logger.error('job_queue_mark_running_abandoned', {
            job_id: job.id,
            session_key: job.sessionKey,
          });
        } else {
          // Re-insert at the front so the job is retried on the next drain cycle
          this.pending.unshift(job);
        }
        return;
      }
    }

    this.running.set(job.sessionKey, job);
    logger.info('job_started', { job_id: job.id, session_key: job.sessionKey, tool: job.tool });

    this.executor(job)
      .catch((err) => {
        logger.error('job_executor_error', {
          job_id: job.id,
          error: errorMessage(err),
        });
      })
      .finally(() => {
        this.running.delete(job.sessionKey);
        if (this.store) {
          this.removePersistedJob(job.id);
        }
        this.drainGlobal();
      });
  }

  private removePersistedJob(jobId: string): void {
    try {
      this.store?.remove(jobId);
    } catch (err) {
      logger.error('job_queue_remove_failed', {
        job_id: jobId,
        error: errorMessage(err),
      });
    }
  }

  private drainGlobal(): void {
    if (!this.accepting) return;
    if (this.running.size >= this.config.maxConcurrency) return;

    // FIFO scan: skip jobs whose session is already in-flight, start the
    // earliest runnable job that fits within global concurrency.
    for (let i = 0; i < this.pending.length; ) {
      if (this.running.size >= this.config.maxConcurrency) break;

      const next = this.pending[i] as Job;
      if (this.running.has(next.sessionKey)) {
        i++;
        continue;
      }

      this.pending.splice(i, 1);
      this.startJob(next, { fromPending: true });
    }
  }

  cancelSession(sessionKey: string): boolean {
    const before = this.pending.length;
    this.pending = this.pending.filter((job) => {
      if (job.sessionKey === sessionKey) {
        this.markRunningFailures.delete(job.id);
        return false;
      }
      return true;
    });
    const removed = before - this.pending.length;

    if (this.store) {
      try {
        this.store.removeQueuedBySession(sessionKey);
      } catch (err) {
        logger.error('job_queue_cancel_persist_failed', {
          session_key: sessionKey,
          error: errorMessage(err),
        });
      }
    }

    if (removed > 0) {
      logger.info('pending_jobs_cancelled', {
        session_key: sessionKey,
        count: removed,
      });
    }
    return this.running.has(sessionKey);
  }

  getStatus(): { running: number; pending: number; sessions: string[] } {
    return {
      running: this.running.size,
      pending: this.queueDepth,
      sessions: [...this.running.keys()],
    };
  }
}
