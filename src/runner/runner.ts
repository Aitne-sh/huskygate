/** @module runner — Spawns and manages driver CLI processes with timeout enforcement. */
import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { RETRY_LIMITS, SIZE_LIMITS, TIMEOUTS } from '../shared/constants.js';
import { errorMessage } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { getDetachedSpawnOptions, isMacOS, killProcessTree } from '../utils/platform.js';
import { sanitize } from '../utils/sanitize.js';
import type { Driver, DriverEvent, RunResult } from './types.js';

type EventCallback = (event: DriverEvent) => void;

const MAX_EVENTS = SIZE_LIMITS.maxEventsPerRun;
const SLEEP_JITTER_TOLERANCE_MS = TIMEOUTS.sleepJitterTolerance;
const MAX_SLEEP_RESETS = RETRY_LIMITS.sleepResets;

/** Config subset consumed by Runner. Compatible with full Config. */
export interface RunnerConfig {
  maxRuntimeSec: number;
  noOutputTimeoutSec: number;
  /** When true, spawn caffeinate on macOS to prevent idle sleep during execution. */
  preventSleep?: boolean;
}

/** Executes a single driver CLI process, streaming parsed events and enforcing idle/max-runtime timeouts. */
export class Runner {
  private process: ChildProcess | null = null;
  private killed = false;
  private killReason: string | null = null;
  private sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly config: RunnerConfig) {}

  async run(
    driver: Driver,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    onEvent: EventCallback,
  ): Promise<RunResult> {
    const command = driver.buildCommand();
    const events: DriverEvent[] = [];

    // Log sandbox/approval args but exclude the prompt to avoid leaking user input
    const execIdx = args.indexOf('exec');
    const preExecArgs = execIdx >= 0 ? args.slice(0, execIdx) : [];
    logger.info('runner_spawn', {
      command,
      args_count: args.length,
      cwd,
      pre_exec_args: preExecArgs.length > 0 ? preExecArgs : undefined,
    });

    return new Promise<RunResult>((resolve) => {
      this.killed = false;
      this.killReason = null;
      let eventsDropped = false;

      const proc = spawn(
        command,
        args,
        getDetachedSpawnOptions({
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        }),
      );

      this.process = proc;

      // ── Caffeinate (macOS idle-sleep prevention) ──
      let caffeinateProc: ChildProcess | null = null;
      if (this.config.preventSleep && isMacOS && proc.pid) {
        try {
          caffeinateProc = spawn('caffeinate', ['-i', '-w', String(proc.pid)], {
            stdio: 'ignore',
            detached: true,
          });
          caffeinateProc.unref();
          caffeinateProc.on('error', () => {
            caffeinateProc = null;
          });
          logger.info('caffeinate_started', {
            target_pid: proc.pid,
            caffeinate_pid: caffeinateProc.pid,
          });
        } catch {
          caffeinateProc = null;
        }
      }

      // ── Sleep detection state ──
      let noOutputSleepResets = 0;
      let maxRuntimeSleepResets = 0;

      // ── No-output timeout ──
      let noOutputTimer: ReturnType<typeof setTimeout> | null = null;
      let noOutputRetryCount = 0;
      let noOutputTimerSetAt = Date.now();
      const MAX_NO_OUTPUT_RETRIES = RETRY_LIMITS.noOutput;
      let cleanedUp = false;
      const resetNoOutputTimer = () => {
        if (cleanedUp) return;
        if (noOutputTimer) clearTimeout(noOutputTimer);
        noOutputRetryCount = 0;
        noOutputSleepResets = 0;
        noOutputTimerSetAt = Date.now();
        noOutputTimer = setTimeout(handleNoOutputTimeout, this.config.noOutputTimeoutSec * 1000);
      };
      const handleNoOutputTimeout = () => {
        if (cleanedUp) return;
        // Detect system sleep: on macOS, CLOCK_MONOTONIC includes sleep time,
        // so when the process resumes after sleep all overdue timers fire in
        // the same event-loop tick.  A large overshoot reliably indicates sleep.
        const elapsedMs = Date.now() - noOutputTimerSetAt;
        const expectedMs = this.config.noOutputTimeoutSec * 1000;
        if (
          elapsedMs > expectedMs + SLEEP_JITTER_TOLERANCE_MS &&
          noOutputSleepResets < MAX_SLEEP_RESETS
        ) {
          noOutputSleepResets++;
          logger.info('no_output_timeout_sleep_reset', {
            command,
            elapsed_ms: elapsedMs,
            expected_ms: expectedMs,
            resets: noOutputSleepResets,
          });
          noOutputTimerSetAt = Date.now();
          noOutputTimer = setTimeout(handleNoOutputTimeout, expectedMs);
          return;
        }

        noOutputRetryCount++;
        if (noOutputRetryCount < MAX_NO_OUTPUT_RETRIES && !this.killed && this.process !== null) {
          logger.warn('no_output_timeout_retry', {
            command,
            timeout: this.config.noOutputTimeoutSec,
            attempt: noOutputRetryCount,
            max_retries: MAX_NO_OUTPUT_RETRIES,
          });
          noOutputTimerSetAt = Date.now();
          noOutputTimer = setTimeout(handleNoOutputTimeout, this.config.noOutputTimeoutSec * 1000);
          return;
        }
        logger.warn('no_output_timeout', {
          command,
          timeout: this.config.noOutputTimeoutSec,
          retries_exhausted: noOutputRetryCount,
        });
        this.kill('no_output_timeout');
      };

      // ── Max-runtime timeout ──
      let maxRuntimeTimerSetAt = Date.now();
      let maxRuntimeTimerRef: ReturnType<typeof setTimeout>;
      const scheduleMaxRuntimeTimer = (durationMs: number): ReturnType<typeof setTimeout> => {
        maxRuntimeTimerSetAt = Date.now();
        return setTimeout(() => {
          if (cleanedUp) return;
          const elapsedMs = Date.now() - maxRuntimeTimerSetAt;
          if (
            elapsedMs > durationMs + SLEEP_JITTER_TOLERANCE_MS &&
            maxRuntimeSleepResets < MAX_SLEEP_RESETS
          ) {
            maxRuntimeSleepResets++;
            logger.info('max_runtime_sleep_extended', {
              command,
              elapsed_ms: elapsedMs,
              expected_ms: durationMs,
              resets: maxRuntimeSleepResets,
            });
            maxRuntimeTimerRef = scheduleMaxRuntimeTimer(this.config.maxRuntimeSec * 1000);
            return;
          }
          logger.warn('max_runtime_timeout', { command, timeout: this.config.maxRuntimeSec });
          this.kill('max_runtime_timeout');
        }, durationMs);
      };
      maxRuntimeTimerRef = scheduleMaxRuntimeTimer(this.config.maxRuntimeSec * 1000);

      resetNoOutputTimer();

      // ── Stdout processing ──
      const processLine = (line: string) => {
        resetNoOutputTimer();
        const sanitized = sanitize(line);
        const event = driver.parseEvent(sanitized);
        if (event) {
          if (events.length < MAX_EVENTS) {
            events.push(event);
          } else {
            eventsDropped = true;
          }
          onEvent(event);
        }
      };

      let rl: ReturnType<typeof createInterface> | null = null;
      let rlErr: ReturnType<typeof createInterface> | null = null;

      if (proc.stdout) {
        rl = createInterface({ input: proc.stdout });
        rl.on('line', (line) => {
          try {
            processLine(line);
          } catch (err) {
            logger.error('runner_stdout_handler_error', { command, error: String(err) });
          }
        });
      }

      // ── Stderr processing ──
      if (proc.stderr) {
        rlErr = createInterface({ input: proc.stderr });
        rlErr.on('line', (line) => {
          try {
            const sanitized = sanitize(line);
            if (!sanitized.trim()) return;
            const parsed = driver.parseStderr(sanitized);
            const event: DriverEvent = parsed ?? { type: 'error', content: sanitized };

            // Never reset the no-output timer from stderr: only stdout
            // represents forward progress. Resetting on stderr kept processes
            // alive indefinitely during API retry loops.

            if (event.type === 'error') {
              logger.error('runner_stderr', { command, line: sanitized });
            } else {
              logger.warn('runner_stderr_nonfatal', {
                command,
                line: sanitized,
                mapped_type: event.type,
              });
            }

            if (events.length < MAX_EVENTS) {
              events.push(event);
            } else {
              eventsDropped = true;
            }
            onEvent(event);
          } catch (err) {
            logger.error('runner_stderr_handler_error', { command, error: String(err) });
          }
        });
      }

      // ── Cleanup & resolution ──
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearTimeout(maxRuntimeTimerRef);
        if (noOutputTimer) clearTimeout(noOutputTimer);
        if (this.sigkillTimer) {
          clearTimeout(this.sigkillTimer);
          this.sigkillTimer = null;
        }
        if (caffeinateProc) {
          try {
            caffeinateProc.kill();
          } catch {
            /* already exited */
          }
          caffeinateProc = null;
        }
        rl?.close();
        rlErr?.close();
        this.process = null;
      };

      proc.once('error', (err) => {
        cleanup();
        resolve({
          exitCode: null,
          events,
          errorKind: `spawn_error: ${err.message}`,
          eventsDropped,
        });
      });

      proc.once('close', (code) => {
        cleanup();
        const exitError = code !== 0 ? `exit_${code}` : null;
        const killError = this.killed ? (this.killReason ?? 'killed') : null;
        resolve({
          exitCode: code,
          events,
          errorKind: killError ?? exitError,
          eventsDropped,
        });
      });
    });
  }

  kill(reason?: string): void {
    if (!this.process || this.killed) return;
    this.killed = true;
    this.killReason = reason ?? 'killed';

    const pid = this.process.pid;
    logger.info('runner_kill', { pid, reason: this.killReason });

    try {
      if (pid) killProcessTree(pid, 'SIGINT');
    } catch (err) {
      // ESRCH = process already gone
      if (err instanceof Error && !err.message.includes('ESRCH')) {
        logger.debug('runner_kill_sigint_failed', { pid, error: errorMessage(err) });
      }
    }

    const gracePeriodMs = this.killReason === 'permission_approval_needed' ? 2000 : 5000;
    this.sigkillTimer = setTimeout(() => {
      this.sigkillTimer = null;
      try {
        if (pid) killProcessTree(pid, 'SIGKILL');
      } catch (err) {
        if (err instanceof Error && !err.message.includes('ESRCH')) {
          logger.debug('runner_kill_sigkill_failed', { pid, error: errorMessage(err) });
        }
      }
    }, gracePeriodMs);
  }

  isRunning(): boolean {
    return this.process !== null && !this.killed;
  }
}
