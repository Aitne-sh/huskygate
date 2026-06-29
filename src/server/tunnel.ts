/** @module server/tunnel — Cloudflare Tunnel lifecycle management for secure webhook ingress. */

import { type ChildProcess, spawn } from 'node:child_process';
import { INTERVALS, RETRY_LIMITS, TIMEOUTS } from '../shared/constants.js';
import { logger } from '../utils/logger.js';
import { resolveCommand, terminateProcess } from '../utils/platform.js';

/** Regex to extract the public URL from cloudflared quick-tunnel output. */
const QUICK_TUNNEL_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/** Maximum time to wait for the tunnel URL to appear in cloudflared output. */
const URL_TIMEOUT_MS = TIMEOUTS.tunnelUrl;

/** Delay before restarting a crashed cloudflared process. */
const RESTART_DELAY_MS = INTERVALS.tunnelRestart;

/** Maximum consecutive restart attempts before giving up. */
const MAX_RESTART_ATTEMPTS = RETRY_LIMITS.tunnelRestart;

export interface TunnelOptions {
  /** Local port that cloudflared will proxy to. */
  localPort: number;
  /** Local host address (default: 127.0.0.1). */
  localHost?: string;
  /** Named tunnel token. When set, uses `cloudflared tunnel run` with $TUNNEL_TOKEN env. */
  token?: string | null;
}

export class CloudflareTunnel {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private stopped = false;
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: TunnelOptions) {}

  /**
   * Start the cloudflared tunnel process.
   *
   * For quick tunnels (no token), parses stdout for the trycloudflare.com URL.
   * For named tunnels (with token), the URL is managed via the Cloudflare dashboard
   * and must be set manually in WEBHOOK_PUBLIC_BASE_URL.
   *
   * @returns The public URL for quick tunnels, or null for named tunnels.
   */
  async start(): Promise<string | null> {
    const binary = this.resolveBinary();
    const args = this.buildArgs();

    logger.info('tunnel_starting', {
      mode: this.options.token ? 'named' : 'quick',
      target: `${this.options.localHost ?? '127.0.0.1'}:${this.options.localPort}`,
    });

    return this.spawnAndWait(binary, args);
  }

  /** Gracefully stop the tunnel process. */
  stop(): void {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process) {
      logger.info('tunnel_stopping');
      try {
        if (this.process.pid) terminateProcess(this.process.pid);
      } catch {
        // Process may already be gone.
      }
      this.process = null;
    }
  }

  /** Get the current public URL (quick tunnels only). */
  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  private resolveBinary(): string {
    const resolved = resolveCommand('cloudflared');
    if (!resolved) {
      throw new Error(
        'cloudflared binary not found in PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      );
    }
    return resolved;
  }

  private buildArgs(): string[] {
    const host = this.options.localHost ?? '127.0.0.1';
    const target = `http://${host}:${this.options.localPort}`;

    if (this.options.token) {
      // Token is passed via $TUNNEL_TOKEN env (not CLI args) to avoid ps exposure.
      return ['tunnel', 'run'];
    }
    // Quick tunnel: cloudflared tunnel --url <target>
    return ['tunnel', '--url', target];
  }

  private spawnAndWait(binary: string, args: string[]): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      const isQuickTunnel = !this.options.token;
      let resolved = false;
      let urlTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const proc = this.spawnProcess(binary, args);
      this.process = proc;

      // For named tunnels, resolve immediately (URL is known to the user).
      if (!isQuickTunnel) {
        proc.on('exit', (code) => this.handleProcessExit(code, binary, args));
        resolved = true;
        resolve(null);
        return;
      }

      // For quick tunnels, parse the URL from cloudflared output.
      const onData = (chunk: Buffer) => {
        const line = chunk.toString('utf-8');
        const match = QUICK_TUNNEL_URL_RE.exec(line);
        if (match && !resolved) {
          resolved = true;
          this.publicUrl = match[0];
          this.restartAttempts = 0;
          if (urlTimeoutId) clearTimeout(urlTimeoutId);
          logger.info('tunnel_ready', { url: this.publicUrl });
          resolve(this.publicUrl);
        }
      };

      // cloudflared writes tunnel info (including URL) to stderr.
      proc.stderr?.on('data', onData);
      proc.stdout?.on('data', onData);

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          if (urlTimeoutId) clearTimeout(urlTimeoutId);
          reject(new Error(`Failed to start cloudflared: ${err.message}`));
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          if (urlTimeoutId) clearTimeout(urlTimeoutId);
          reject(new Error(`cloudflared exited with code ${code} before URL was ready`));
          return;
        }
        this.handleProcessExit(code, binary, args);
      });

      urlTimeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill('SIGTERM');
          reject(new Error(`Timed out waiting for cloudflared URL (${URL_TIMEOUT_MS}ms)`));
        }
      }, URL_TIMEOUT_MS);
    });
  }

  private spawnProcess(binary: string, args: string[]): ChildProcess {
    // Pass token via env to prevent exposure in `ps` output.
    const env: NodeJS.ProcessEnv = this.options.token
      ? { ...process.env, TUNNEL_TOKEN: this.options.token }
      : { ...process.env };

    return spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env,
    });
  }

  private handleProcessExit(code: number | null, binary: string, args: string[]): void {
    if (this.stopped) return;

    this.restartAttempts++;
    if (this.restartAttempts > MAX_RESTART_ATTEMPTS) {
      logger.error('tunnel_restart_exhausted', {
        attempts: this.restartAttempts,
        lastExitCode: code,
      });
      return;
    }

    logger.warn('tunnel_exited', {
      code,
      attempt: this.restartAttempts,
      restartIn: RESTART_DELAY_MS,
    });

    this.restartTimer = setTimeout(() => {
      if (this.stopped) return;
      this.spawnAndWait(binary, args).catch((err) => {
        logger.error('tunnel_restart_failed', { error: String(err) });
      });
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }
}
