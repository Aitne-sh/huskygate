/** @module shared/constants — Centralized cross-module constants for timeouts, intervals, size limits, and retry counts */

// ── Timeouts (one-shot durations) ───────────────────────────
export const TIMEOUTS = {
  /** SQLite busy timeout */
  sqliteBusy: 5_000,
  /** OS keychain operation */
  keychainOp: 10_000,
  /** taskkill / process kill on Windows */
  taskkill: 5_000,
  /** findPidOnPort / resolveCommand probing (Unix) */
  platformProbe: 3_000,
  /** findPidOnPort probing (Windows netstat — slower than Unix lsof) */
  platformProbeWindows: 5_000,
  /** Shell login resolve (command -v) */
  shellResolve: 1_000,
  /** Venv creation */
  venvCreate: 30_000,
  /** pip install */
  pipInstall: 120_000,
  /** File download */
  download: 30_000,
  /** Tunnel URL readiness */
  tunnelUrl: 30_000,
  /** GitHub IP allowlist fetch */
  githubIpFetch: 10_000,
  /** MCP token refresh expiry margin */
  mcpTokenExpiryMargin: 60_000,
  /** MCP connection failure grace period */
  mcpConnFailureGrace: 10_000,
  /** Dashboard file picker */
  filePicker: 5 * 60 * 1000,
  /** Slack challenge response */
  slackChallenge: 30_000,
  /** Tool approval wait */
  toolApproval: 120_000,
  /** MCP auth bypass wait */
  mcpAuthBypass: 120_000,
  /** Summary generation (seconds) */
  summaryGenerationSec: 180,
  /** System-sleep detection: timer-callback overshoot tolerance */
  sleepJitterTolerance: 10_000,
  /** Shutdown hard timeout */
  shutdownHard: 15_000,
} as const;

// ── Intervals (recurring durations) ─────────────────────────
export const INTERVALS = {
  /** Main process heartbeat */
  heartbeat: 60_000,
  /** SSE heartbeat (chat, orchestrator) */
  sseHeartbeat: 30_000,
  /** Schedule poll */
  schedulePoll: 30_000,
  /** Buffer cleanup */
  bufferCleanup: 60_000,
  /** GitHub IP allowlist refresh */
  githubIpRefresh: 6 * 60 * 60 * 1000,
  /** Tunnel restart delay */
  tunnelRestart: 5_000,
  /** Metrics report */
  metricsReport: 5 * 60 * 1000,
  /** Log tail poll */
  logTailPoll: 2_000,
  /** Log tail heartbeat */
  logTailHeartbeat: 15_000,
} as const;

// ── TTLs (expiry / retention durations) ─────────────────────
export const TTLS = {
  /** Session idle exit (compile-time fallback; runtime value comes from Config.sessionIdleTimeoutSec) */
  sessionIdle: 24 * 60 * 60 * 1000,
  /** Assistant thread lifetime */
  assistantThread: 24 * 60 * 60 * 1000,
  /** Event delivery lifetime */
  eventDelivery: 24 * 60 * 60 * 1000,
  /** Dashboard cookie max age (seconds) */
  dashboardCookieSec: 8 * 60 * 60,
  /** Slack timestamp max age (seconds) */
  slackTimestampMaxAgeSec: 300,
  /** Buffer retain after done */
  bufferRetainAfterDone: 60_000,
  /** Stale claim timeout (minutes) */
  staleClaimMinutes: 30,
  /** Workdir cleanup max age */
  workdirCleanup: 7 * 24 * 60 * 60 * 1000,
  /** Dashboard bootstrap window */
  bootstrapWindow: 15 * 60 * 1000,
  /** Artifact cache TTL */
  artifactCache: 5_000,
} as const;

// ── Size / memory limits ────────────────────────────────────
export const SIZE_LIMITS = {
  /** Max HTTP request body */
  maxHttpBody: 64 * 1024,
  /** Max text chars (Slack message split threshold) */
  maxTextChars: 4_000,
  /** Max text bytes (Slack message split threshold) */
  maxTextBytes: 12_288,
  /** Max single file upload */
  maxFileSize: 50 * 1024 * 1024,
  /** Max total file uploads */
  maxTotalFileSize: 100 * 1024 * 1024,
  /** Max number of file uploads */
  maxFileUploads: 10,
  /** Max filename length */
  maxFilenameLength: 200,
  /** Max output files */
  maxOutputFiles: 10,
  /** Max output file size */
  maxOutputFileSize: 50 * 1024 * 1024,
  /** Max artifact serve bytes */
  maxArtifactServe: 100 * 1024 * 1024,
  /** Max log bytes (dashboard) */
  maxLogBytes: 10 * 1024 * 1024,
  /** Log tail read chunk */
  logTailReadChunk: 256 * 1024,
  /** Max events per run */
  maxEventsPerRun: 50_000,
  /** Max buffer events (SSE) */
  maxBufferEvents: 10_000,
  /** Min webhook body */
  minWebhookBody: 64 * 1024,
  /** Max webhook body */
  maxWebhookBody: 1024 * 1024,
  /** Max event subscription test body */
  maxEventSubTestBody: 16 * 1024,
  /** Max trigger context */
  maxTriggerContext: 8 * 1024,
  /** Log rotation max bytes */
  logRotationMax: 50 * 1024 * 1024,
  /** Max output per node (summary) */
  maxOutputPerNode: 8_000,
  /** Max run report chars */
  maxRunReportChars: 80_000,
  /** Max chars for Slack log */
  maxCharsForLog: 8_000,
  /** Slack markdown block cumulative char limit per payload */
  markdownBlockMaxChars: 12_000,
  /** Effective markdown body limit (reserve ~500 for header/footer blocks) */
  markdownBodyMaxChars: 11_500,
  /** Threshold to switch from multi-message to file upload */
  markdownFileUploadThreshold: 40_000,
} as const;

// ── Retry / count limits ────────────────────────────────────
export const RETRY_LIMITS = {
  /** Tunnel max restart attempts */
  tunnelRestart: 5,
  /** Mark-running retries */
  markRunning: 3,
  /** MCP connection retries */
  mcpConn: 2,
  /** Slack messenger retries */
  slackMessenger: 2,
  /** No-output retries */
  noOutput: 3,
  /** Max system-sleep timer resets before enforcing timeout */
  sleepResets: 5,
  /** Log max rotations */
  logRotations: 3,
  /** DB backup max generations */
  backupGenerations: 7,
  /** HTTP max redirects */
  httpRedirects: 5,
} as const;
