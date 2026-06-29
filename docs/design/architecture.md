# Architecture - File Tree / Tech Stack / Pattern

> Detailed expansion of DESIGN.md Section 2. Describes file structure, tech stack, and architecture patterns.

---

## File Tree

```text
.
├── DESIGN.md                           # Design index (each domain → docs/design/)
├── README.md                           # Operations documentation
├── CLAUDE.md                           # Developer coding conventions
├── TODO.md                             # Improvement issue list
├── docs/design/                        # Domain-specific design documents
├── instructions/                       # Tool-specific instruction file templates
│   ├── CLAUDE.md                       #   For Claude (includes mcp_tool_policy)
│   ├── AGENTS.md                       #   For Codex (includes mcp_tool_policy)
│   └── GEMINI.md                       #   For Gemini (includes mcp_tool_policy)
├── skills/                             # Skill templates (seeded to workdir)
│   ├── playwright-runner/              #   Playwright browser automation skill
│   ├── perplexity-research/            #   Perplexity AI research skill
│   ├── research-freshness/             #   Research freshness/accuracy improvement skill (prompt only)
│   ├── aws-cli/                        #   AWS CLI skill
│   ├── azure-cli/                      #   Azure CLI skill
│   ├── gcp-cli/                        #   GCP CLI skill
│   ├── schedule-manager/               #   Schedule management skill
│   └── gmail-composer/                 #   Gmail composition support skill
├── scripts/
│   └── biome.mjs                       # Biome CLI wrapper
├── tsup.config.ts                      # tsup build config (multi-entry + shebang)
├── src/
│   ├── cli.ts                          # CLI entry point (commander.js: dev/server/dashboard subcommands)
│   ├── index.ts                        # Server startup/shutdown sequence (main() export)
│   ├── config.ts                       # Environment variable loading, validation, and ENV_REGISTRY
│   ├── context/                        # Application context (transport-agnostic)
│   │   ├── app-context.ts              #   AppContext interface (aggregation point for all services and stores)
│   │   ├── context-slices.ts           #   Additive slice interfaces for narrowing AppContext dependencies
│   │   └── app-types.ts               #   PendingConfirmation, PendingToolApproval, ActiveRunner, etc.
│   ├── event/                          # Event trigger system
│   │   ├── types.ts                    #   WebhookEndpoint, EventSubscription, TriggeredTask types
│   │   ├── event-router.ts            #   Webhook reception → filter → subscription → execution dispatch
│   │   ├── webhook-filter.ts          #   Event filtering (path/eq/in/exists/prefix)
│   │   ├── webhook-secret-store.ts    #   Webhook secret management
│   │   ├── publisher-presets.ts       #   Publisher presets (generic, github)
│   │   ├── trigger-context.ts         #   Trigger context construction
│   │   └── triggered-task-executor.ts #   Triggered task execution engine
│   ├── instructions/                   # Instruction file generation
│   │   ├── builder.ts                 #   buildInstruction() — instruction file assembly per source
│   │   └── sections.ts               #   Section templates (tool identification, MCP policy, etc.)
│   ├── server/
│   │   ├── api.ts                      # Server Internal API entry (auth, dispatcher, health)
│   │   ├── state.ts                    # Server API shared in-memory state (chat job stream buffer)
│   │   ├── daemon.ts                   # PID file management + daemon start/stop/status
│   │   ├── notification-service.ts     # Notification contract (abstract interface)
│   │   ├── slack-notification-service.ts # Slack-backed notification implementation
│   │   └── routes/                     # Server Internal API route handlers
│   │       ├── artifact-api.ts         #   /api/chat/:id/artifacts*
│   │       ├── chat-api.ts             #   /api/chat/*, /api/jobs/*
│   │       ├── ondemand-api.ts         #   /api/ondemand-tasks/*
│   │       ├── orchestrator-api.ts     #   /api/orchestrators/*
│   │       ├── schedule-api.ts         #   /api/schedules/*
│   │       ├── session-api.ts          #   /api/sessions/*
│   │       ├── settings-api.ts         #   /api/settings/*
│   │       ├── task-api-shared.ts      #   Common helper for schedule/ondemand/triggered
│   │       └── webhook-api.ts          #   /api/webhook-endpoints*, /api/event-subscriptions*, /api/triggered-tasks*, /webhooks/*
│   ├── dashboard/
│   │   ├── assets/                     # Tool icons and logo PNGs
│   │   ├── icons.ts                    # Base64 data URI exports
│   │   ├── app.ts                      # renderApp() SPA template
│   │   ├── db.ts                       # DashboardDb class
│   │   ├── env.ts                      # .env read/write + secret masking + keychain integration
│   │   ├── auth.ts                     # Cookie authentication (hg_session)
│   │   ├── http.ts                     # HTTP utilities
│   │   ├── proxy.ts                    # Server API proxy (JSON + SSE)
│   │   ├── route-context.ts            # Common context type for route handlers
│   │   ├── mcp-config.ts              # MCP secret masking helpers shared by dashboard MCP routes
│   │   ├── skills.ts                   # Unified skill discovery, manifest helpers, and custom CRUD
│   │   ├── toml.ts                     # Minimal TOML parser/serializer
│   │   ├── yaml.ts                     # YAML frontmatter parser/serializer
│   │   ├── settings-service.ts         # Settings patch validation, keychain integration, hot-reload
│   │   ├── routes/                     # Route handlers
│   │   │   ├── status.ts              #   /api/status, /api/daemon/*
│   │   │   ├── sessions.ts            #   /api/sessions/*, /api/logs
│   │   │   ├── session-mcp.ts         #   /api/sessions/:id/mcp-servers/*
│   │   │   ├── settings.ts            #   /api/settings/*
│   │   │   ├── chat.ts                #   /api/chat/*, /api/jobs/*
│   │   │   ├── dev-aliases.ts         #   /api/dev-aliases/*
│   │   │   ├── mcp.ts                 #   /api/mcp/*
│   │   │   ├── ondemand-tasks.ts      #   /api/ondemand-tasks/*
│   │   │   ├── skills.ts              #   /api/skills/*
│   │   │   ├── schedule-tasks.ts      #   /api/schedule-tasks/*, /api/slack/targets, /api/notify
│   │   │   ├── orchestrator.ts        #   /api/orchestrators/*
│   │   │   ├── event-triggers.ts      #   /api/webhook-endpoints/*, /api/event-subscriptions/*, /api/triggered-tasks/*
│   │   │   └── filesystem.ts          #   /api/filesystem/pick-directory
│   │   ├── templates/
│   │   │   └── layout.ts              # SPA HTML layout
│   │   ├── styles/
│   │   │   ├── base.ts                # CSS reset, color scheme
│   │   │   ├── components.ts          # Tables, badges, settings UI
│   │   │   ├── chat.ts                # Chat UI, docs, toast
│   │   │   ├── orchestrator.ts        # Orchestrator editor
│   │   │   ├── pages.ts              # Page-specific layouts
│   │   │   └── tokens.ts             # Design tokens, reset
│   │   ├── scripts/                    # Client-side JS
│   │   │   ├── helpers.ts             #   Common utilities
│   │   │   ├── overview.ts            #   Overview tab + Chart.js
│   │   │   ├── chat.ts                #   Chat tab
│   │   │   ├── logs.ts                #   Logs tab
│   │   │   ├── settings.ts            #   Settings tab
│   │   │   ├── docs.ts                #   Docs tab
│   │   │   ├── dev.ts                 #   Developer tab
│   │   │   ├── mcp.ts                 #   MCP tab
│   │   │   ├── ondemand-tasks.ts      #   Tasks > On-Demand tab
│   │   │   ├── skills.ts              #   Skills tab
│   │   │   ├── schedule-tasks.ts      #   Schedule Tasks tab
│   │   │   ├── orchestrator.ts        #   Orchestrator tab
│   │   │   ├── orchestrator-editor.ts #   Orchestrator visual editor
│   │   │   ├── orchestrator-node-panel.ts  # Node configuration panel
│   │   │   ├── orchestrator-edge-modal.ts  # Edge configuration modal
│   │   │   ├── orchestrator-settings.ts    # Orchestrator settings
│   │   │   ├── orchestrator-execution.ts   # Execution control and progress display
│   │   │   ├── orchestrator-runs.ts        # Execution history list
│   │   │   ├── orchestrator-guide.ts       # Guide/help
│   │   │   ├── event-triggers.ts      #   Event Triggers tab
│   │   │   ├── triggered-tasks.ts     #   Triggered Tasks management
│   │   │   ├── trace.ts               #   Trace modal
│   │   │   └── utilities.ts           #   Restart banner
│   │   └── server.ts                   # node:http dashboard REST API server
│   ├── orchestrator/
│   │   ├── types.ts                    # Orchestrator, Node, Edge, Run type definitions
│   │   ├── types-db.ts               # DB column types (for row → domain mapper)
│   │   ├── types-patch.ts            # Partial update types for PATCH requests
│   │   ├── dag.ts                     # DAG validation (cycle detection, reachability, gate rules)
│   │   ├── engine.ts                  # OrchestratorEngine (run management, node dispatch)
│   │   ├── engine-executor.ts        # Node execution (job generation, workdir preparation, session management)
│   │   ├── engine-notify.ts          # Slack notifications (start/complete/fail/cancel)
│   │   ├── engine-summary.ts         # Execution summary generation (AI summary or template)
│   ├── store/
│   │   ├── mcp-server.ts             # Claude MCP server store (SQLite-backed)
│   ├── workdir/
│   │   ├── mcp-writer.ts             # Generated Claude MCP config writer for workdirs
│   │   ├── engine-utils.ts           # Utilities (status determination, timeout)
│   │   └── return-value.ts           # Inter-node data passing (return value extraction)
│   ├── slack/
│   │   ├── assistant.ts                # Slack Agents API (Assistant) integration
│   │   ├── app.ts                      # Facade: App creation, handler wiring
│   │   ├── app-helpers.ts             # Constants, pure functions, context-dependent helpers
│   │   ├── app-types.ts              # Slack-specific type definitions (SlackContext, etc.)
│   │   ├── handler-context.ts         # Message handler context type
│   │   ├── tool-plugin.ts             # ToolPlugin interface + registry
│   │   ├── mcp-preflight.ts           # Unified MCP auth preflight
│   │   ├── mcp-preflight-claude.ts    # Claude MCP auth preflight implementation
│   │   ├── mcp-preflight-codex.ts     # Codex MCP auth preflight implementation
│   │   ├── mcp-preflight-gemini.ts    # Gemini MCP auth preflight implementation
│   │   ├── mcp-preflight-utils.ts     # MCP preflight utilities
│   │   ├── job-executor.ts            # Job execution coordinator
│   │   ├── job-runtime-types.ts       # Job runtime shared types, NullMessenger
│   │   ├── job-runtime.ts             # Runner execution, event state machine
│   │   ├── job-post-run.ts            # Post-execution processing (artifact, notification)
│   │   ├── job-finishers.ts           # Source-specific post-run dispatcher
│   │   ├── task-run-completion.ts     # Task-type common retry, notification, cleanup
│   │   ├── message-handler.ts         # Slack message events
│   │   ├── commands/                  # Per-command handlers (Phase 2 split)
│   │   │   ├── dispatch.ts           # Command dispatcher + re-exports
│   │   │   ├── session.ts            # Session management commands
│   │   │   ├── execution.ts          # Execution control commands
│   │   │   ├── tool-mode.ts          # Tool/mode switching commands
│   │   │   ├── workdir.ts            # Workdir management commands
│   │   │   ├── mcp.ts               # MCP operation commands
│   │   │   ├── dev.ts               # Dev session commands
│   │   │   ├── prompt.ts            # Prompt/autorun commands
│   │   │   ├── task.ts              # Task/orchestrator commands
│   │   │   └── menu.ts              # Menu/help commands
│   │   ├── actions/                   # Block Kit interaction handlers (Phase 3 split)
│   │   │   ├── register.ts           # Action registration facade
│   │   │   ├── helpers.ts            # Shared utilities
│   │   │   ├── approval.ts           # Tool/MCP approval actions
│   │   │   ├── session.ts            # Session resume/mode/tool select
│   │   │   ├── dashboard-menu.ts     # Dashboard menu actions
│   │   │   └── dev-selection.ts      # Dev alias selection
│   │   ├── block-kit.ts              # Block Kit block builder
│   │   ├── approval-handler.ts        # Approval handler
│   │   ├── parser.ts                   # Command parsing
│   │   ├── messenger.ts               # Slack output streaming
│   │   ├── auth.ts                     # Authorization checks
│   │   ├── mcp-auth.ts               # MCP auth error detection logic
│   │   ├── mcp-selection.ts           # MCP server selection for Slack
│   │   ├── auto-approve.ts            # Auto-approve logic (resolveAutoApprove)
│   │   └── tools/
│   │       ├── tool-state-utils.ts    # Tool state read/mutate helpers
│   │       ├── claude.ts              # Claude MCP preflight
│   │       ├── claude-plugin.ts       # Claude ToolPlugin implementation
│   │       ├── codex.ts               # Codex MCP auth
│   │       ├── codex-plugin.ts        # Codex ToolPlugin implementation
│   │       ├── codex.test.ts          # Codex tests
│   │       ├── gemini.ts              # Gemini MCP auth
│   │       └── gemini-plugin.ts       # Gemini ToolPlugin implementation
│   ├── runner/
│   │   ├── runner.ts                  # Process spawning, stdio parsing, timeout management
│   │   ├── driver-claude.ts           # Claude CLI argument construction
│   │   ├── driver-codex.ts            # Codex CLI argument construction
│   │   ├── driver-gemini.ts           # Gemini CLI argument construction
│   │   ├── driver-factory.ts          # Driver factory (runtime driver selection)
│   │   ├── driver-utils.ts            # Cross-driver helpers (env, text extraction, command resolution)
│   │   ├── types.ts                   # Driver interface, DriverEvent
│   │   ├── claude-mcp-token-refresh.ts # Claude OAuth token refresh
│   │   ├── gemini-runtime-home.ts     # Gemini runtime home preparation
│   │   └── codex-runtime-home.ts      # Codex runtime home preparation
│   ├── session/
│   │   ├── manager.ts                 # Session CRUD, state persistence
│   │   └── types.ts                   # Session, Mode type definitions
│   ├── queue/
│   │   ├── job-queue.ts               # Per-session + global concurrency control
│   │   └── types.ts                   # Job interface and TaskExecutionPolicy
│   ├── shared/                         # Shared utilities across Dashboard/Server/Slack
│   │   ├── http.ts                    #   json(), readBody(), readBodyBuffer(), parseUrl()
│   │   ├── queries.ts                 #   Common SQL queries
│   │   ├── route-matchers.ts          #   URL pattern matchers
│   │   ├── security.ts               #   timingSafeEqualString()
│   │   ├── sse.ts                     #   writeSseHeaders()
│   │   ├── tool-state.ts              #   tool_state JSON parsing
│   │   ├── approval.ts               #   Approval utilities (sanitize, format, resolve)
│   │   ├── codex-tool-approval.ts    #   Codex tool approval (argument normalization, list management)
│   │   ├── sticky-tool-state.ts      #   Sticky state key definitions and clear processing
│   │   ├── mcp-server-selection.ts   #   MCP server selection logic (session + node intersection)
│   │   ├── text-utils.ts             #   Text splitting/chunking utilities
│   │   ├── file-attachment.ts        #   File attachment, archiving, MIME detection, image normalization
│   │   ├── tool-approval.ts          #   Tool approval gate, policy denial detection, voluntary-stop detection
│   │   └── mappers/                   #   DB row → domain object mappers
│   │       ├── helpers.ts             #     str(), num(), parseJson() common helpers
│   │       ├── orchestrator.ts       #     mapOrchestrator(), mapNode(), mapEdge()
│   │       ├── orchestrator-run.ts   #     mapRun(), mapNodeRun()
│   │       ├── scheduled-task.ts     #     mapScheduledTask(), mapScheduledTaskRun()
│   │       └── ondemand-task.ts      #     mapOndemandTask(), mapOndemandTaskRun()
│   ├── schedule/
│   │   ├── scheduler.ts               # Schedule task engine (polling + execution)
│   │   └── cron-utils.ts              # Cron expression validation and next-run calculation
│   ├── test-helpers/
│   │   └── app-context-builder.ts     # Shared AppContext/config builder for tests
│   ├── store/
│   │   ├── database.ts                # SQLite initialization, schema definition
│   │   ├── audit.ts                   # Audit log for job/mode changes
│   │   ├── config-store.ts            # ConfigStore: persistent settings CRUD
│   │   ├── conversation.ts            # ConversationStore: conversation message persistence
│   │   ├── dev-alias.ts              # DevAliasStore: Dev alias CRUD
│   │   ├── mcp-server.ts             # MCP server store (SQLite-backed, all tools)
│   │   ├── session-mcp-server.ts     # Session-scoped MCP server allowlist management
│   │   ├── ondemand-task.ts          # OndemandTaskStore: on-demand task CRUD/execution history
│   │   ├── schedule.ts               # ScheduleStore: schedule task CRUD
│   │   ├── dedupe.ts                  # Event deduplication (24h TTL)
│   │   ├── housekeeping.ts           # Retention, backup, log rotation
│   │   ├── orchestrator.ts           # OrchestratorStore: Orchestrator/Node/Edge CRUD
│   │   ├── orchestrator-graph.ts     # Graph operations (node/edge add/remove)
│   │   ├── orchestrator-run.ts       # OrchestrationRun CRUD + NodeRun management
│   │   ├── orchestrator-snapshot.ts  # Validated snapshot save/restore
│   │   ├── orchestrator-archive.ts   # Orchestrator output archive + prune
│   │   ├── default-instruction.ts    # DefaultInstructionStore: default instruction file management
│   │   ├── event-subscription.ts     # EventSubscriptionStore: event subscription CRUD
│   │   ├── triggered-task.ts         # TriggeredTaskStore: triggered task CRUD
│   │   ├── webhook-delivery.ts       # WebhookDeliveryStore: webhook delivery log
│   │   └── webhook-endpoint.ts       # WebhookEndpointStore: webhook endpoint CRUD
│   ├── workdir/
│   │   └── manager.ts                 # Workdir verification, cleanup, instruction file placement
│   └── utils/
│       ├── expiring-map.ts            # Map with TTL
│       ├── logger.ts                  # Structured JSON logging
│       ├── metrics.ts                 # Execution metrics measurement
│       ├── platform.ts               # Cross-platform abstraction (process kill, port/command/python/PowerShell resolution, browser launch)
│       ├── rate-limiter.ts            # Rate limiting utility
│       ├── keychain.ts               # OS Keychain integration
│       ├── sanitize.ts               # ANSI removal, token masking
│       ├── fs-security.ts            # Filesystem permission utilities (0700/0600)
│       ├── timezone.ts               # Timezone detection and validation
│       ├── workdir.ts                # Workdir cleanup utility
│       ├── db.ts                      # Minimal SQLite boolean conversion
│       └── error.ts                   # Custom error types
├── biome.json
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── .env.example
```

---

## Tech Stack

- **Runtime**: Node.js 22+ — ESM native
- **Language**: TypeScript 5.7 — strict mode, ESM output
- **Slack SDK**: `@slack/bolt` ^4.2.0 — Socket Mode
- **DB**: SQLite via `better-sqlite3` ^11.8.0 — Synchronous API, WAL mode
- **Image**: `sharp` ^0.34.5 — HEIC-to-JPEG conversion, EXIF rotation correction
- **Build**: `tsup` ^8.4.0 — multi-entry, ESM output, shebang injection
- **Dev**: `tsx` ^4.19.0 — Direct TypeScript execution
- **Test**: `vitest` ^3.0.0 — Node environment, coverage support
- **Lint/Format**: `biome` ^1.9.0 — Integrated ESLint + Prettier alternative

### AI CLI Tools (Runner Targets)

- **Claude**: `claude` CLI — Anthropic Claude Code CLI
- **Codex**: `codex` CLI — OpenAI Codex CLI
- **Gemini**: `gemini` CLI — Google Gemini CLI

---

## Pattern: Event-Driven + Clean Architecture

Starting from Slack events, responsibilities are separated by layer. Execution-related state (session/job/approval) is managed centrally by the Server side, while the Dashboard uses a combination of direct DB access and Server API proxy.

### Layer Diagram

```
Slack Layer (auth/parse/messenger)          Dashboard (DB read/write + proxy)
    | command dispatch                          | HTTP proxy (runtime mutations)
Business Logic (session/queue/approval)     Server Internal API (api.ts + routes/*.ts)
    | job execution                             | enqueue / cleanup
Runner Layer (driver abstraction + child_process)
    | persistence
Data Layer (SQLite: sessions/audit/orchestrators/tasks/events)
    | event routing
Event Layer (webhook -> filter -> subscription -> triggered task/orchestrator)
```

### Layer Descriptions

- **Slack Layer**
  - Responsibility: Slack event reception, authorization checks, command parsing, output streaming
  - Key modules: `slack/app.ts`, `slack/auth.ts`, `slack/parser.ts`, `slack/messenger.ts`

- **Context Layer**
  - Responsibility: Transport-agnostic application context. Aggregation point for all services and stores
  - Key modules: `context/app-context.ts`, `context/app-types.ts`

- **Business Logic**
  - Responsibility: Session management, job queue, approval flow, instruction file generation
  - Key modules: `session/manager.ts`, `queue/job-queue.ts`, `shared/approval.ts`, `instructions/builder.ts`

- **Server Internal API**
  - Responsibility: REST API entry, route splitting, authentication, in-memory state
  - Key modules: `server/api.ts`, `server/state.ts`, `server/routes/*.ts`

- **Dashboard**
  - Responsibility: Web UI (SPA), direct DB access, Server API proxy
  - Key modules: `dashboard/server.ts`, `dashboard/routes/*.ts`

- **Runner Layer**
  - Responsibility: CLI process spawning, stdout parsing, timeout management
  - Key modules: `runner/runner.ts`, `runner/driver-*.ts`

- **Data Layer**
  - Responsibility: SQLite CRUD, schema management, audit logging
  - Key modules: `store/database.ts`, `store/*.ts`

- **Event Layer**
  - Responsibility: Webhook reception, filtering, subscription resolution, task launching
  - Key modules: `event/event-router.ts`, `event/webhook-filter.ts`, `event/triggered-task-executor.ts`

- **Shared**
  - Responsibility: Cross-cutting utilities (HTTP, mappers, approval, file attachment, tool approval)
  - Key modules: `shared/*.ts`, `shared/mappers/*.ts`

### Job Execution Layer Breakdown

Job execution is decomposed into the following 6 layers. Each layer has a single responsibility, with upper layers calling lower layers:

```
job-executor.ts          # 1. Coordinator: MCP preflight → enqueue → runtime invocation
    ↓
job-runtime-types.ts     # 2. Shared type definitions: RuntimeContext, NullMessenger, source determination
    ↓
job-runtime.ts           # 3. Runner execution: child_process spawn → DriverEvent state machine
    ↓                       (approval gate, voluntary-stop detection, tool_state updates)
job-post-run.ts          # 4. Post-execution processing: artifact collection, sticky state clearing, notification preparation
    ↓
job-finishers.ts         # 5. Source-specific dispatcher: slack/schedule/ondemand/orchestrator/triggered
    ↓                       → calls each source's post-run handler
task-run-completion.ts   # 6. Task-type common: retry determination, failure notification, status updates, cleanup
```

### Key Architectural Decisions

1. **AppContext Extraction** (`src/context/app-context.ts`): Separated the transport-agnostic context interface from the Slack-specific `app-types.ts`. Shared context carries a narrow `webClient` surface instead of the Bolt `App`, while Slack runtime state remains in `AppRuntime`.
2. **Notification Service Injection** (`src/server/notification-service.ts`): Server API notification endpoints depend on an injected contract rather than a Slack implementation, preserving a clean boundary between HTTP dispatch and transport-specific integrations.

2. **Shared Utility Consolidation** (`src/shared/`): Moved `file-attachment.ts` and `tool-approval.ts` from `src/slack/` to `src/shared/`. This enables reuse from the Dashboard / Server API as well.

3. **Instruction Builder Independence** (`src/instructions/`): Separated instruction file generation logic into a dedicated module. `builder.ts` handles per-source (slack/schedule/ondemand/orchestrator/triggered) section assembly, while `sections.ts` provides template fragments.

4. **Event Trigger System** (`src/event/`): Built the pipeline from webhook reception to task execution as an independent module. `event-router.ts` serves as the entry point, performing filtering → subscription resolution → task/orchestration launching.

5. **Server API Route Splitting** (`src/server/routes/`): Split the route handlers from the previously monolithic `api.ts` into individual modules by domain. Each module exports handlers in the `(req, res, ctx) => Promise<boolean>` format.

6. **DB Row Mapper Standardization** (`src/shared/mappers/`): Consolidated conversions from raw DB row data to domain objects as type-safe mapper functions. `helpers.ts` provides common conversions such as `str()`, `num()`, `parseJson()`.

7. **Store Layer Expansion** (`src/store/`): Added `webhook-endpoint.ts`, `event-subscription.ts`, `triggered-task.ts`, `webhook-delivery.ts` required for the event trigger system, as well as `default-instruction.ts` for instruction file management.
