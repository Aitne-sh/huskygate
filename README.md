# HuskyGate

> [!NOTE]
> **Project status — succeeded by Aitne / 後継プロジェクトについて**
>
> The concepts and architecture pioneered in HuskyGate are now being carried forward into **[Aitne](https://github.com/Aitne-sh/Aitne)**, which is currently under active development. HuskyGate remains available as-is, but new work happens in Aitne.
>
> HuskyGate で確立した設計思想・理論は、現在後継プロジェクト **[Aitne](https://github.com/Aitne-sh/Aitne)** に引き継いでおり、Aitne を開発中です。本リポジトリは現状のまま公開を継続します。

**HuskyGate** is a remote orchestrator that runs and manages AI CLIs (Claude / Codex / Gemini) on your local machine via Slack DM, with a full-featured web dashboard.

## Install from source

```bash
git clone https://github.com/Aitne-sh/huskygate.git
cd huskygate
npm install
npm run build
npm link
```

### Prerequisites

- **Node.js 22+**
- **C/C++ build tools** (required by `better-sqlite3` native addon)
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential python3`
  - Windows: `npm install -g windows-build-tools` or install Visual Studio Build Tools
- **AI CLI** (at least one): [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- **Python 3.9+** (optional, for Playwright / Perplexity / Gmail / PPTX skills)

### Advanced Options

| Option | Env Var | Description |
|--------|---------|-------------|
| `--data-dir <path>` | `HUSKYGATE_DATA_DIR` | Data directory for DB, PID files, and logs (default: `./data`) |

### Quick Start

```bash
# 1. Launch the dashboard and configure credentials
huskygate dashboard
# Open http://localhost:3737 → Settings → Messaging → Slack
# Set SLACK_BOT_TOKEN / SLACK_APP_TOKEN / ALLOWED_USER_IDS
# Secrets are stored in OS Keychain (macOS/Linux/Windows)

# 2. Start the server + dashboard
huskygate start

# 3. Send "!menu" or "!claude" / "!codex" / "!gemini" via Slack DM
```

### Key Features

- **Slack-driven AI CLI execution** with session management
- **Web dashboard** for sessions, chat, tasks, MCP, skills, agents, orchestrator, and event triggers
- **DAG orchestrator** with parallel execution and dependency resolution
- **Webhook event triggers** with HMAC signature verification
- **10 built-in skills**: Playwright, Perplexity, AWS/Azure/GCP CLI, Gmail, PPTX, Obsidian, and more
- **Cross-platform**: macOS, Linux, Windows

---

**HuskyGate** は、**Slack DM からローカルPC上の AI CLI（Claude / Codex / Gemini）を実行・管理するリモートオーケストレータ**です。

## クイックスタート（最短）

### ソースからビルド

```bash
git clone https://github.com/Aitne-sh/huskygate.git
cd huskygate
npm install
npm run build
npm link
```

2. ダッシュボードを起動して認証情報を登録

```bash
huskygate dashboard
# http://localhost:3737 を開き、Settings → Messaging → Slack で
# SLACK_BOT_TOKEN / SLACK_APP_TOKEN / ALLOWED_USER_IDS を保存
# → macOS / Linux / Windows では機密値は OS Keychain に自動保存されます
```

3. サーバー + ダッシュボードを起動

```bash
huskygate start
```

4. Slack DM で `!menu` または `!claude` / `!codex` / `!gemini`

## 主なユースケース

- **外出先からローカル環境を操作**: Slack DM で指示し、ローカルPC上でコード編集・実行・調査を実施
- **添付ファイルの解析・加工**: Slack 添付を workdir に保存して、AI に継続処理させる
- **MCP ツール連携の安全運用**: MCP ツール呼び出しを都度承認、または `!autorun` でセッション単位に自動承認
- **ブラウザUIで一元管理**: セッション、チャット、設定、MCP、スキル、エージェント、オーケストレーター、イベントトリガーをダッシュボードで管理
- **DAG オーケストレーション**: 複数ノードの並列実行・依存解決・サマリー生成
- **Webhook イベントトリガー**: 外部イベント受信から自動タスク / オーケストレーション実行

## 機能概要

- **Slack DM 駆動の AI CLI 実行**
  - `!claude` / `!codex` / `!gemini` でツール切替
  - セッション単位で prompt 実行、モデル切替、mode 切替
- **セッション管理（スレッド単位）**
  - 一覧・復帰・削除・全削除
  - Dev Alias（固定パス + ツール）で開発環境を再利用
- **ファイル連携**
  - Slack 添付を `_attachments/<jobId>/` に保存
  - 実行成果物を `_artifacts/<jobId>/` に自動アーカイブ
- **Web ダッシュボード**
  - Overview / Chat / Sessions / Tasks / Developer / MCP / Skills / Agents / Orchestrator / Event Triggers / Logs / Settings / Docs
  - Tasks は On-Demand / Schedule の2系統（通知時は有効な Slack user ID を自動メンション）
- **承認フロー**
  - `mode=write` / `workdir` 変更は `!confirm XXXX` 必須
  - MCP ツール実行は approve/reject フロー対応
- **MCP 認証プリフライト**
  - Claude / Codex / Gemini それぞれで認証確認・再試行・ガイダンス
- **統合スキルシステム**
  - 3ソース対応: `builtin`（組み込み）/ `local`（ユーザー）/ `project`（プロジェクト固有）
  - ダッシュボード Skills タブから有効/無効を管理
  - 組み込み 10 スキル: Playwright / Perplexity / Research Freshness / Schedule Manager / Gmail Composer / PPTX Composer / Obsidian CLI / AWS CLI / Azure CLI / GCP CLI
- **DAG オーケストレーター**
  - 複数ノードの並列実行、条件分岐、依存解決
  - サマリー生成、スケジュール/Webhook トリガー対応
- **Webhook イベントトリガー**
  - エンドポイント管理、HMAC 署名検証、GitHub Webhook IP 許可リスト
  - イベントサブスクリプション → タスク/オーケストレーション自動実行
- **AI エージェント定義**
  - ツール + システム指示 + MCP/スキル設定をプリセットとして保存
  - タスク・オーケストレーターノードから参照

## 技術スタック

| カテゴリ | 技術 |
| --- | --- |
| Runtime | Node.js 22+ |
| Language | TypeScript 5.7+ (strict) |
| Slack | `@slack/bolt` 4.2+ (Socket Mode) |
| DB | `better-sqlite3` 11.8+ (SQLite / WAL) |
| Validation | `zod` 4.3+ |
| Image | `sharp` 0.34+（optional dependency） |
| CLI | `commander` 13.1+ |
| Cron | `cron-parser` 5.5+ |
| Presentation | `pptxgenjs` 4.0+（optional dependency） |
| Test | `vitest` 3.0+ |
| Lint / Format | `@biomejs/biome` 1.9+ |
| Build | `tsup` 8.4+ (ESM) |
| Dashboard UI | Node HTTP + SSR HTML + Vanilla JS（React 非依存） |

## ディレクトリ構成

```text
.
├── src/
│   ├── index.ts                # メイン起動
│   ├── cli.ts                  # huskygate CLI
│   ├── config/                 # 環境変数レジストリ + 設定リゾルバ
│   ├── server/                 # デーモン / 内部 API
│   │   └── routes/             # API ルートハンドラ
│   ├── dashboard/              # Web ダッシュボード + API プロキシ
│   │   ├── routes/             # ダッシュボードルートハンドラ
│   │   ├── scripts/            # クライアントサイド JS 生成
│   │   └── templates/          # HTML レイアウト
│   ├── slack/                  # Slack Bot 本体（コマンド/実行/承認）
│   │   ├── commands/           # コマンドディスパッチ
│   │   └── actions/            # Block Kit アクション
│   ├── runner/                 # CLI 実行ドライバ (Claude/Codex/Gemini)
│   ├── queue/                  # ジョブキュー（永続化 + リカバリ）
│   ├── session/                # セッション管理
│   ├── schedule/               # スケジュールタスクエンジン
│   ├── orchestrator/           # DAG オーケストレーター
│   ├── event/                  # Webhook イベントルーティング
│   ├── skills/                 # 統合スキルカタログ
│   ├── store/                  # SQLite ストア層
│   ├── shared/                 # Dashboard/Server 共有ユーティリティ
│   ├── workdir/                # workdir 管理・スキル配置
│   ├── setup/                  # セットアップウィザード
│   ├── context/                # アプリケーションコンテキスト
│   ├── instructions/           # 指示テンプレート生成 (CLAUDE/AGENTS/GEMINI)
│   ├── cli/                    # CLI バナー・表示ヘルパー
│   └── utils/                  # ログ・メトリクス・サニタイズ・Keychain・プラットフォーム抽象化
├── skills/                     # 組み込みスキル定義
├── data/                       # DB / PID / logs / secret
├── workdir/                    # セッション作業領域
└── dist/                       # ビルド成果物
```

## セットアップ

### 前提条件

1. Node.js 22+
2. Slack App（Socket Mode 有効）
3. 利用する CLI ツール（`claude` / `codex` / `gemini`）

### Slack App 権限

| Scope | 用途 |
| --- | --- |
| `chat:write` | メッセージ送信/更新 |
| `files:read` | 添付ダウンロード |
| `files:write` | 添付アップロード |
| `app_mentions:read` | メンション受信 |
| `channels:read` | 通知先候補チャンネル一覧（任意、未付与時はユーザー候補のみ） |
| `channels:history` | チャンネルメッセージ履歴 |
| `groups:history` | プライベートチャンネル履歴 |
| `im:history` | DM 受信 |
| `mpim:history` | グループDM履歴 |

Scope 変更後は Slack App の再インストールが必要です。

### インストール

```bash
npm install
npm run build
npm link
```

### 起動方法

**方法 A: ダッシュボードから認証情報を登録（推奨）**

```bash
huskygate dashboard          # ダッシュボードのみ起動
# Settings → Messaging → Slack で必須値を保存
# 機密値（トークン・API キー）は OS Keychain に自動保存
huskygate start              # サーバー + ダッシュボード
```

macOS / Linux / Windows では、ダッシュボードから保存した機密値は OS Keychain に暗号化保存されます。`.env` ファイルには非機密設定のみが残ります。

**方法 B: `.env` を手動作成（フォールバック）**

```bash
cp .env.example .env         # .env.example をコピーして編集
npm run dev                  # フォアグラウンド起動
```

## 環境変数

### 認証情報の保存先

HuskyGate は機密情報（トークン・APIキー・シークレット）を安全に管理するため、OS ネイティブの Keychain を優先的に使用します。

| プラットフォーム | 保存先 | 暗号化 |
| --- | --- | --- |
| **macOS** | Keychain Services（`security` CLI） | OS レベル暗号化 |
| **Linux** | freedesktop.org Secret Service（`secret-tool` CLI） | OS レベル暗号化 |
| **Windows** | Windows Credential Manager（`cmdkey` + PowerShell CredRead） | OS レベル暗号化 |

**読み込み優先順位**（起動時）: OS Keychain → `.env` → デフォルト値

ダッシュボード Settings から保存した機密値は、Keychain が利用可能な環境では自動的に Keychain に保存され、`.env` からは削除されます。Keychain が利用できない環境では `.env` にフォールバックします。

```bash
# Keychain の状態確認
huskygate keychain status

# Keychain に保存されているキーを一覧
huskygate keychain list
```

ダッシュボード保存時、**一部キーのみ**サーバー再起動なしで Hot-reload されます（`LOG_LEVEL`, `MAX_CONCURRENCY`, `MAX_RUNTIME_SEC`, `NO_OUTPUT_TIMEOUT_SEC`, `SESSION_IDLE_TIMEOUT_SEC`, `TOOL_AUTO_APPROVE_MODE`, `HUSKYGATE_LOG_STACKS`, スキル関連キー）。それ以外は restart required 表示されます。

### 必須

| 変数名 | 内容 |
| --- | --- |
| `SLACK_BOT_TOKEN` | Bot Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-level Token (`xapp-...`) |
| `ALLOWED_USER_IDS` | 許可する Slack User ID（カンマ区切り） |

### ツール認証（利用ツールに応じて）

| ツール | 環境変数 |
| --- | --- |
| Claude | `ANTHROPIC_API_KEY`（または CLI 側設定） |
| Codex | `OPENAI_API_KEY` |
| Gemini | `GEMINI_API_KEY` または `GOOGLE_API_KEY` |

### 任意（主要）

| 変数名 | デフォルト | 説明 |
| --- | --- | --- |
| `ALLOWED_TEAM_ID` | - | 許可する Slack Team ID |
| `DEFAULT_TOOL` | `claude` | 既定ツール |
| `MAX_CONCURRENCY` | `2` | 同時実行上限 |
| `MAX_RUNTIME_SEC` | `900` | 最大実行時間（秒） |
| `NO_OUTPUT_TIMEOUT_SEC` | `90` | 無出力監視間隔（秒） |
| `WORKDIR_ROOT` | `./workdir` | セッション workdir ルート |
| `ALLOWED_WORKDIR_ROOTS` | `WORKDIR_ROOT` | `!workdir=` 許可ルート |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `SERVER_API_PORT` | `3738` | 内部 API ポート |
| `SERVER_API_HOST` | `127.0.0.1` | 内部 API ホスト |
| `TOOL_AUTO_APPROVE_MODE` | `false` | MCP ツール自動承認（グローバル） |
| `SERVER_API_SECRET` | 自動生成 | `data/.server-api-secret` |
| `DASHBOARD_SECRET` | 自動生成 | `data/.dashboard-secret` |
| `SESSION_IDLE_TIMEOUT_SEC` | `86400` | セッション無操作タイムアウト（秒、デフォルト24時間） |
| `SESSION_CLEANUP_ENABLED` | `true` | アイドルセッション自動クリーンアップ |
| `SCHEDULE_ENABLED` | `true` | スケジューラ有効/無効 |
| `SCHEDULE_POLL_INTERVAL_SEC` | `30` | スケジューラポーリング間隔（秒） |
| `SCHEDULE_MAX_CONCURRENT` | `1` | スケジュール同時実行上限 |
| `SCHEDULE_DEFAULT_NOTIFY_CHANNEL` | - | Schedule の既定通知先（未指定時の fallback） |
| `WEBHOOK_PUBLIC_BASE_URL` | - | Webhook エンドポイントの公開 URL（ダッシュボード表示用） |
| `CLOUDFLARE_TUNNEL_ENABLED` | `false` | Cloudflare Tunnel による Webhook 公開 |
| `CLOUDFLARE_TUNNEL_TOKEN` | - | 名前付きトンネル用トークン（空の場合は quick tunnel） |
| `GITHUB_WEBHOOK_IP_ALLOWLIST` | `true` | GitHub Webhook IP 許可リスト（HMAC に加え防御を多層化） |
| `HUSKYGATE_LOG_STACKS` | `false` | ログにスタックトレースを含める |
| `HUSKYGATE_DASHBOARD_COOKIE_SECURE` | `false` | Dashboard 認証 Cookie に `Secure` 属性を付与（TLS 終端リバースプロキシ配下で `true`） |

### ツール設定

| 変数名 | デフォルト | 説明 |
| --- | --- | --- |
| `CLAUDE_COMMAND` | 自動解決 | Claude CLI パス |
| `CLAUDE_MODEL` | - | Claude モデル |
| `CLAUDE_DEFAULT_MODE` | `write` | 新規 Claude セッション既定モード |
| `CLAUDE_READONLY_PERMISSION_MODE` | `default` | `readonly` 時 permission mode（`plan` 可） |
| `CLAUDE_MCP_AUTH_SERVER` | - | Claude MCP 認証対象サーバー |
| `CLAUDE_MCP_CONFIG_PATH` | `~/.claude.json` | MCP 設定パス |
| `GEMINI_COMMAND` | 自動解決 | Gemini CLI パス |
| `GEMINI_MODEL` | - | Gemini モデル |
| `GEMINI_DEFAULT_MODE` | `write` | 新規 Gemini セッション既定モード |
| `GEMINI_READONLY_APPROVAL_MODE` | - | `readonly` 時 approval mode（`plan` 指定時のみ反映） |
| `GEMINI_MCP_AUTH_SERVER` | - | Gemini MCP 認証対象（空で無効化） |
| `GEMINI_MCP_CONFIG_PATH` | `~/.gemini/settings.json` | MCP 設定パス |
| `CODEX_COMMAND` | 自動解決 | Codex CLI パス |
| `CODEX_MODEL` | - | Codex モデル |
| `CODEX_MCP_AUTH_SERVER` | - | Codex MCP 認証対象 |
| `CODEX_MCP_CONFIG_PATH` | `~/.codex/config.toml` | MCP 設定パス |
| `CODEX_DEFAULT_SANDBOX_MODE` | `write` | 新規 Codex セッション既定（`write` / `readonly`） |

### スキル関連

統合スキルシステムでは、スキルの有効/無効はダッシュボード Skills タブまたは `skill_enablement` テーブルで管理されます。以下はスキルが必要とする認証情報・設定値です。

| 変数名 | 用途 |
| --- | --- |
| `PERPLEXITY_API_KEY` | Perplexity スキル |
| `AWS_ACCESS_KEY_ID` | AWS CLI スキル |
| `AWS_SECRET_ACCESS_KEY` | AWS CLI スキル |
| `AWS_DEFAULT_REGION` | AWS CLI スキル |
| `AZURE_CLIENT_ID` | Azure CLI スキル |
| `AZURE_CLIENT_SECRET` | Azure CLI スキル |
| `AZURE_TENANT_ID` | Azure CLI スキル |
| `AZURE_SUBSCRIPTION_ID` | Azure CLI スキル |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP CLI スキル |
| `CLOUDSDK_CORE_PROJECT` | GCP CLI スキル |
| `HUSKYGATE_OAUTH_TRUSTED_HOSTS` | OAuth を許可する信頼済みホスト（カンマ区切り） |

## CLI

```bash
# 初回セットアップ（Slack App 作成 + トークン設定の対話ウィザード）
huskygate setup
huskygate setup --manifest-only   # Slack App マニフェスト JSON を表示して終了
huskygate setup --status          # セットアップ完了状況を確認
huskygate setup --reset           # セットアップ関連設定を消去（確認あり）

# 一括起動
huskygate start
huskygate start --no-open
huskygate start --port 8080
huskygate start --force

# 一括停止 / 再起動 / 状態確認
huskygate stop
huskygate restart
huskygate status

# サーバー（デーモン）
huskygate server start
huskygate server start --force
huskygate server stop
huskygate server status

# ダッシュボード
huskygate dashboard
huskygate dashboard --port 8080
huskygate dashboard --no-open
huskygate dashboard --force
huskygate dashboard stop
huskygate dashboard status

# Keychain 管理
huskygate keychain status
huskygate keychain list

# 開発実行（フォアグラウンド）
huskygate dev
```

### npm scripts

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | `tsx src/cli.ts dev`（フォアグラウンド） |
| `npm run build` | `dist/` へビルド |
| `npm run start` | `node dist/cli.js dev`（サーバー本体をフォアグラウンド実行） |
| `npm run test` | テスト実行 |
| `npm run test:watch` | テスト監視 |
| `npm run typecheck` | 型チェック |
| `npm run lint` | Biome check |
| `npm run lint:fix` | Biome auto-fix |
| `npm run format` | Biome format |
| `npm run verify` | typecheck + lint + test + build |

### 主要ファイル

| 用途 | パス |
| --- | --- |
| サーバー PID | `data/huskygate.pid` |
| サーバーログ | `data/huskygate.log` |
| ダッシュボード PID | `data/dashboard.pid` |
| ダッシュボードログ | `data/dashboard.log` |
| DB | `data/orchestrator.db` |
| API シークレット | `data/.server-api-secret` |
| Dashboard シークレット | `data/.dashboard-secret` |

## Slack コマンド

`!`（全角 `！` も可）で始まる入力はシステムコマンドとして処理されます。
通常プロンプトはアクティブセッションがある場合のみ実行され、セッション未選択時は `!menu` 相当の UI を返します。

### セッション管理

| コマンド | 動作 |
| --- | --- |
| `!claude` / `!codex` / `!gemini` | ツール切替（最新セッション復帰 or 新規） |
| `!claude <prompt>` など | 指定ツールで即実行 |
| `!new claude` / `!new codex` / `!new gemini` | 新規セッション |
| `!session` / `!s` | スレッド内セッション一覧 |
| `!session <id>` | 指定セッション復帰 |
| `!current` | 現在セッション表示 |
| `!exit` | 現在セッション離脱 |
| `!session-clear <id>` | 指定セッション削除 |
| `!session-clear all` | 全セッション削除 |

### タスク実行

| コマンド | 動作 |
| --- | --- |
| `!task <name|alias>` / `!t <name|alias>` | On-Demand タスクを即時実行 |

### Orchestrator 実行

| コマンド | 動作 |
| --- | --- |
| `!orch <alias|id>` / `!o <alias|id>` | Orchestrator を手動実行 |
| `!orch list` / `!o list` | 有効な Orchestrator 一覧表示 |
| `!orch status <alias|id>` / `!o status <alias|id>` | 直近実行結果を表示 |
| `!orch cancel <runId>` / `!o cancel <runId>` | 実行中 run をキャンセル |

### 実行制御

| コマンド | 動作 |
| --- | --- |
| `!stop` | 実行中ジョブ停止 |
| `!status` | 実行・キュー・モード・モデル・workdir 表示 |
| `!reset` | アクティブセッション削除 |

### モード・モデル・workdir

| コマンド | 動作 |
| --- | --- |
| `!mode=readonly` | readonly へ変更 |
| `!mode=write` | write 要求（`!confirm XXXX` 必須） |
| `!confirm XXXX` | チャレンジコード確定（30秒以内） |
| `!model` / `!m` | 現在モデル表示 |
| `!model <name>` / `!m <name>` / `!m=<name>` | セッションモデル上書き |
| `!model default` | モデル上書き解除 |
| `!workdir` | 現在 workdir 表示 |
| `!workdir=/path` | workdir 変更（`!confirm` 必須） |
| `!workdir=reset` | 既定 workdir へ戻す |
| `!autorun` / `!autorun on` / `!autorun off` | セッション単位で MCP 自動承認切替 |

> `!mode=net`（ネットワーク許可モード）はパーサで認識されますが、現在は無効化されており、実行すると無効メッセージを返します。

### MCP allowlist（セッション単位）

| コマンド | 動作 |
| --- | --- |
| `!mcp` | 現在のセッション MCP サーバー allowlist を表示 |
| `!mcp + <name>` | 指定 MCP サーバーをセッションで有効化 |
| `!mcp - <name>` | 指定 MCP サーバーをセッションで無効化 |
| `!mcp reset` | セッション MCP allowlist を既定に戻す |

### Dev Alias

| コマンド | 動作 |
| --- | --- |
| `!dev` | Alias 一覧 |
| `!dev <alias>` | Alias セッション復帰/作成 |
| `!new-dev <alias>` | Alias セッションを作り直し |

### 承認

| コマンド | 動作 |
| --- | --- |
| `!yes` / `!y` | 承認 |
| `!no` / `!n` | 拒否 |

### UI

| コマンド | 動作 |
| --- | --- |
| `!menu` | Block Kit ダッシュボード表示 |
| `!help` | コマンド一覧 |

## `!menu` インタラクティブダッシュボード

セッション状態に応じて Block Kit UI を出し分けます。

- アクティブセッションあり
  - セッション情報（tool / mode / model / workdir / 実行状態）
  - Quick Actions（Stop / Exit / New Session / Reset）
  - Mode セレクタ
  - Dev Alias 選択
  - セッション一覧・クリアUI
- アクティブセッションなし
  - ツール選択
  - Dev Alias 選択
  - 既存セッション復帰

## Web ダッシュボード

`huskygate dashboard` または `huskygate start` で起動（デフォルト `http://localhost:3737`）。

- Dashboard サーバーは `127.0.0.1` バインド
- `?token=...` で初回認証 Cookie を設定
- `/api/*` は Cookie 認証済みのみアクセス可
- Slack トークン未設定でも Dashboard 単体起動可

### 主な画面

- **Overview**: 起動状態、メトリクス、Chart.js グラフ、エラー分析、ツールカード
- **Chat**: セッション別チャット（SSE配信 + ポーリング復元 + ファイルアップロード + ツール承認）
- **Sessions**: 一覧、個別削除、全削除、監査表示、実行トレース
- **Tasks**: ランディング + 2系統（On-Demand / Schedule）。Schedule は 1回/定期（cron・timezone・Slack通知）、On-Demand は手動実行。通知時は有効な Slack user ID を自動メンション
- **Developer**: Dev Alias CRUD + OS ディレクトリピッカー
- **MCP**: ツール別 MCP 設定編集（stdio/SSE/HTTP トランスポート）
- **Skills**: `builtin` / `local` / `project` 統合カタログ、組み込み read-only、custom マルチドライバー編集、enablement 管理、envVars 管理
- **Agents**: AI エージェント定義（ツール + システム指示 + MCP/スキル設定のプリセット）
- **Orchestrator**: DAG ビジュアルエディタ、ノード/エッジ管理、実行履歴、再実行
- **Event Triggers**: Webhook エンドポイント管理、イベントサブスクリプション、トリガードタスク
- **Logs**: server/dashboard ログ閲覧・絞り込み
- **Settings**: 設定編集 + Hot-reload + restart required 表示 + OS Keychain 連携
- **Docs**: 内蔵ドキュメント

### 主な Dashboard API

| パス | 機能 |
| --- | --- |
| `/api/status` | ステータス・集計 |
| `/api/metrics` | メトリクス取得 |
| `/api/daemon/start`, `/api/daemon/stop` | デーモン起動/停止 |
| `/api/sessions`, `/api/sessions/:id/audit` | セッション/監査 |
| `/api/sessions/:id/mcp-servers` | セッション別 MCP allowlist 管理 |
| `/api/logs`, `/api/logs/stream` | ログ取得（取得 / SSE ストリーム） |
| `/api/settings`, `/api/settings/schema` | 設定取得/保存/スキーマ |
| `/api/settings/keychain-status` | OS Keychain 利用可否 |
| `/api/settings/prompts`, `/api/settings/prompts/defaults` | ツール別デフォルト指示 取得/保存 |
| `/api/filesystem/pick-directory` | OS ディレクトリピッカー |
| `/api/chat/sessions` | チャット対象セッション一覧/作成 |
| `/api/chat/:id/messages`, `/api/chat/:id/send` | チャット履歴/送信（SSE） |
| `/api/chat/:id/stop`, `/api/chat/:id/status` | セッション停止/状態 |
| `/api/chat/:id/upload` | 添付アップロード |
| `/api/chat/:id/tool-approval` | 承認応答 |
| `/api/chat/:id/job-stream/:jobId` | 承認後ジョブのSSE再接続 |
| `/api/chat/:id/artifacts` | アーティファクト一覧/取得 |
| `/api/jobs/:sessionKey/stop` | 実行停止 |
| `/api/dev-aliases` | Dev Alias CRUD |
| `/api/mcp/servers` | MCP 設定 CRUD |
| `/api/skills/*` | 統合スキル管理 |

### 主な Server Internal API

| パス | 機能 |
| --- | --- |
| `/api/schedules`, `/api/schedules/:id`, `/api/schedules/:id/runs` | Schedule タスク CRUD/履歴 |
| `/api/ondemand-tasks`, `/api/ondemand-tasks/:id`, `/api/ondemand-tasks/:id/execute` | On-Demand タスク CRUD/即時実行 |
| `/api/orchestrators`, `/api/orchestrators/:id` | Orchestrator CRUD |
| `/api/orchestrators/:id/nodes`, `/api/orchestrators/:id/edges` | ノード/エッジ管理 |
| `/api/orchestrators/:id/execute`, `/api/orchestrators/:id/runs` | 実行/履歴 |
| `/api/agents`, `/api/agents/:id` | AI エージェント CRUD |
| `/api/webhook-endpoints`, `/api/event-subscriptions` | Webhook エンドポイント/サブスクリプション |
| `/api/triggered-tasks` | トリガードタスク管理 |
| `/webhooks/:token` | **公開** Webhook 受信エンドポイント（外部イベント取り込み） |
| `/api/settings/apply`, `/api/settings/keychain-status` | 設定適用 / Keychain 利用可否 |
| `/api/sessions`, `/api/sessions/:key` | セッション管理 |
| `/api/slack/targets`, `/api/notify` | Slack 通知先候補/通知送信 |
| `/api/tunnel/status`, `/api/tunnel/start`, `/api/tunnel/stop` | Cloudflare Tunnel 管理 |

> 内部 API は `127.0.0.1` バインドかつ Bearer 認証必須です。`/webhooks/:token` のみ公開受信用エンドポイントで、HMAC 署名検証 + GitHub IP 許可リストで保護されます。

### Tasks 仕様（Dashboard 実装）

- On-Demand 入力: `name`, `alias`, `description`, `tool`, `mode`, `prompt`, `max_retries`, `notify_channel`（任意）, `agent_id`
- Schedule 入力: `name`, `description`, `tool`, `mode`, `prompt`, `schedule_type(once|recurring)`, `run_at|cron_expr`, `timezone`, `max_runs`, `max_retries`, `notify_channel`, `agent_id`
- Timezone: Dashboard 側で OS/ブラウザ timezone を自動採用（表示のみ、hidden input 保持）
- 通知先選択: `/api/slack/targets` から user/channel 選択。取得不可時は手入力 fallback
- 通知要件: Schedule は `notify_channel` 必須（未指定時 `SCHEDULE_DEFAULT_NOTIFY_CHANNEL` fallback）、On-Demand は任意

### 通知メンション仕様

- Schedule/On-Demand ともに完了通知（成功/失敗/再試行）を Slack 投稿
- 先頭行メンション: `formatMention(job.userId) || formatMention(task.notifyChannel)`
- `job.userId` が有効 Slack user ID（`U...`/`W...`）なら `<@userId>`
- 無効時は `notifyChannel` が有効 Slack user ID の場合のみ `<@notifyChannel>`
- channel ID（`C...`/`G...`）宛ではメンションなし
- Schedule は `notifyThread` 指定時そのスレッドへ投稿し、長文出力は code block で分割して thread 返信

## セッションモデル

```text
threadKey  = {channel_id}:{thread_ts}
sessionKey = sess_<12hex>
sessionId  = <8hex>
```

### セッション状態

| 項目 | 説明 |
| --- | --- |
| `tool` | 実行ツール |
| `mode` | `readonly` / `write` |
| `toolState` | CLI 継続状態、承認済み情報など |
| `workdir` | 作業ディレクトリ |
| `model` | セッション上書きモデル |
| `runningJobId` | 実行中ジョブID |

### 指示ファイル自動配置

| ツール | 配置ファイル | autorun 時 |
| --- | --- | --- |
| Claude | `CLAUDE.md` | `CLAUDE.autorun.md` |
| Codex | `AGENTS.md` | `AGENTS.autorun.md` |
| Gemini | `GEMINI.md` | `GEMINI.autorun.md` |

補足:
- 既存ファイルが独自内容の場合は基本的に保持
- HuskyGate が配置した標準/autorun テンプレート間の切替時のみ上書き

### スキル配置

| ツール | 配置先 |
| --- | --- |
| Claude | `.claude/skills/<name>/SKILL.md` |
| Gemini | `.gemini/skills/<name>/SKILL.md` |
| Codex | `.agents/skills/<name>/SKILL.md` |

組み込み 10 スキル: `playwright-runner`, `perplexity-research`, `research-freshness`, `schedule-manager`, `gmail-composer`, `pptx-composer`, `obsidian-cli`, `aws-cli`, `azure-cli`, `gcp-cli`

### 統合スキルシステム

- **3ソース**: `builtin`（`skills/` ディレクトリ）、`local`（`~/.huskygate/skills/`）、`project`（`<workdir>/.huskygate/skills/`）
- **マニフェスト**: 各スキルに `skill.json`（`schemaVersion: 1`, `excludeDirs`, `envVars`）
- **ドライバーバリアント**: `SKILL.claude.md` / `SKILL.codex.md` / `SKILL.gemini.md`
- **Enablement**: `skill_enablement` テーブルでスキル×ドライバー単位の有効/無効を永続化
- **ダッシュボード管理**: Skills タブから有効化・無効化・envVars 設定

## ファイル添付

Slack 添付ファイルは job ごとに `workdir/_attachments/<jobId>/` に保存されます。

| 制約 | 値 |
| --- | --- |
| 1ファイル最大 | 50MB |
| 1メッセージ合計 | 100MB |
| ダウンロードタイムアウト | 30秒 |

- 許可 MIME は allowlist 方式（`image/*`, `text/*`, PDF, JSON, XML, YAML, Office など）
- HEIC/HEIF は JPEG に正規化
- Dashboard 側アップロード（`/api/chat/:id/upload`）も同じ検証パイプラインを利用

## 出力ファイルとアーティファクト

CLI が `workdir/_output/` に出力したファイルは、ジョブ完了時に自動アーカイブされます。

1. 実行中: `_output/` にファイル生成
2. 完了時: `_output/` から `_artifacts/<jobId>/` へ **コピーし、元を削除**
3. 配信:
   - Slack: `files.uploadV2`
   - Dashboard: API 経由で一覧/取得

制約:
- `_output/` 走査は最大 10 ファイル
- 1ファイル 50MB 超はアーカイブ対象外
- 配信時の単一ファイル上限 100MB（サーバー配信）

## ジョブキュー

- 同一セッションは同時 1 ジョブ
- グローバル同時実行数は `MAX_CONCURRENCY`
- 超過分は pending キューへ（`Queued (position: N)`）
- Shutdown 開始後は新規受付停止
- 永続化: `job_queue` テーブルに保存、クラッシュ後の自動リカバリ対応

## Runner & タイムアウト

- `spawn(..., { detached: true, stdio: pipe })`
- `MAX_RUNTIME_SEC` 超過で停止
- 無出力監視: `NO_OUTPUT_TIMEOUT_SEC` ごとに再評価し、**3回連続で進捗なしなら停止**
- 停止シグナル: プロセスグループへ `SIGINT`、通常 5秒後 `SIGKILL`
  - 承認待ち停止（`permission_approval_needed`）は 2秒後 `SIGKILL`

## ツール別 Driver

### Claude

- 実行: `claude -p <prompt> --output-format stream-json --verbose`
- セッション継続: `--resume <session_id>`
- 新規セッション: `--session-id <uuid>`
- readonly: `--permission-mode default`（`CLAUDE_READONLY_PERMISSION_MODE=plan` で `plan`）
- 常時 allowlist: Read / Write / Edit / Bash など core tools
- スキル有効時: `Skill` を自動許可
- 自動承認時: `--allowed-tools mcp__*`

### Codex

- readonly: `codex -s read-only -a on-request exec --json -- <prompt>`
- write: `codex -s workspace-write -a on-request exec --json -- <prompt>`
- 自動承認時（write）: `-a never`（readonly では `never` を使わず常に `on-request`）
- workspace-write 時はサンドボックスのネットワークアクセスを許可（`-c sandbox_workspace_write.network_access=true`）
- ヘッドレス実行のため Responses API の WebSocket を無効化（`--disable responses_websockets` / `responses_websockets_v2`）
- セッション継続: `exec resume --json <thread_id> -- <prompt>`
- 1回だけ許可したツール呼び出しを再実行に引き継ぐ
- `--output-last-message` を利用して、ストリーム欠落時の最終応答を補完

### Gemini

- 実行: `gemini -p <prompt> --output-format stream-json`
- コマンド解決失敗時は `npx --yes @google/gemini-cli` をフォールバック使用
- readonly: `--sandbox`（`GEMINI_READONLY_APPROVAL_MODE=plan` なら `--approval-mode plan`）
- write: `--approval-mode yolo`
- セッション継続: `session_index` + `gemini_resume_ready` がある場合 `--resume`
- ジョブごとに `.gemini_runtime_home` を隔離生成

## MCP ツール承認

MCP ツール利用時、Slack / Dashboard の承認フローで制御します。

1. ツール呼び出し要求を検出
2. 実行を中断し承認要求を表示（requestId 付き）
3. approve/reject を受けて再実行または終了

- 承認有効期限: 120秒
- `!autorun` はセッション単位、`TOOL_AUTO_APPROVE_MODE=true` はグローバル既定
- セッションレベル MCP allowlist で Slack / Dashboard / オーケストレーター実行に適用
- オーケストレーターノード MCP オーバーライドはセッション MCP アクセスを縮小のみ可能（拡大不可）

### MCP 認証プリフライト

- Claude: `claude mcp list` / `/mcp auth <server>` ベースで確認
- Codex: `codex mcp login <server>` ベースで確認
- Gemini: `/mcp auth <server>` ベースで確認し、必要時 OAuth URL を提示

## Slack 出力制御

- 更新間隔: 800-1200ms（jitter）
- 分割閾値: 4000 文字 or UTF-8 12KB
- 改行優先で分割
- レート制限時: バックオフ倍率最大 8
- 長文ログは `.log` ファイルとしてアップロード

## セキュリティ

| レイヤー | 制御 |
| --- | --- |
| Slack チャネル | DM のみ許可 |
| ユーザー | `ALLOWED_USER_IDS` allowlist |
| チーム | `ALLOWED_TEAM_ID`（任意） |
| write 変更 | `!confirm XXXX` 必須 |
| workdir 変更 | `!confirm XXXX` 必須 |
| workdir 検証 | `realpath` + 許可ルート照合 |
| 出力サニタイズ | ANSI 除去 + シークレットマスク |
| 認証情報保管 | OS Keychain 暗号化（macOS/Linux/Windows） |
| MCP | per-tool 承認ゲート |
| Dashboard | 認証 Cookie（HttpOnly, SameSite=Strict） |
| 内部 API | Bearer + timing safe compare |
| Webhook | HMAC 署名検証 + GitHub IP 許可リスト |
| イベント重複排除 | `event_id` + TTL 24h |
| レート制限 | 1ユーザーあたり 10秒で5メッセージ |
| Dashboard バインド | `127.0.0.1` |

## データベース

SQLite: `data/orchestrator.db`（WAL）

| テーブル | 用途 |
| --- | --- |
| `sessions` | セッション状態 |
| `session_registry` | `sessionKey` ↔ `sessionId` ↔ `threadKey` |
| `thread_contexts` | スレッドの active 状態 |
| `dedupe` | Slack イベント重複排除 |
| `audit` | ジョブ監査ログ（prompt は SHA-256） |
| `mode_changes` | mode 変更履歴 |
| `dev_aliases` | Dev Alias 定義 |
| `dashboard_messages` | Dashboard チャット履歴 |
| `mcp_servers` | MCP サーバー定義 |
| `session_mcp_servers` | セッション別 MCP サーバー有効/無効 |
| `skill_enablement` | スキル×ドライバー別の有効/無効 |
| `config` | ダッシュボード設定永続化 |
| `metadata` | システムメタデータ |
| `job_queue` | 永続ジョブキュー |
| `scheduled_tasks` | スケジュールタスク定義 |
| `scheduled_task_runs` | スケジュールタスク実行履歴 |
| `ondemand_tasks` | On-Demand タスク定義 |
| `ondemand_task_runs` | On-Demand タスク実行履歴 |
| `ai_agents` | AI エージェント定義 |
| `default_instructions` | ツール別デフォルト指示 |
| `orchestrators` | Orchestrator 定義 |
| `orchestrator_nodes` | Orchestrator ノード |
| `orchestrator_edges` | Orchestrator エッジ（条件分岐含む） |
| `orchestration_runs` | Orchestrator 実行履歴 |
| `orchestration_node_runs` | ノード実行履歴（`output_summary` / `output_full`） |
| `webhook_endpoints` | Webhook エンドポイント |
| `event_subscriptions` | イベントサブスクリプション |
| `triggered_tasks` | トリガードタスク定義 |
| `triggered_task_runs` | トリガードタスク実行履歴 |
| `webhook_deliveries` | Webhook 配信ログ |

### オーケストレーター出力とハウスキーピング

各ノード実行時、LLM 出力は `output_full`（全文）と `output_summary`（先頭 4,000 文字）として DB に保存されます。

- `<return:>` タグ解析は切り詰め前の全文（`output_full`）に対して実行
- 定期クリーンアップ（6時間ごと）: 古い `output_full` をログファイルにアーカイブし、DB カラムを `NULL` 化

**ログファイル出力先**: `data/job-logs/<orchestration_run_id>/<node_run_id>.log`

| 設定 | デフォルト値 | 説明 |
| --- | --- | --- |
| `retentionDays` | 7 | この日数より古い `output_full` をアーカイブ対象にする |
| `maxRows` | 1000 | `output_full IS NOT NULL` の行数がこれを超えた場合、古い順にアーカイブ |
| クリーンアップ間隔 | 6 時間 | `setInterval` で定期実行（`.unref()` 付き） |

## Graceful Shutdown

`SIGINT` / `SIGTERM` で次を順次実行します。

1. 新規ジョブ受付停止
2. 実行中ジョブ停止 + 通知
3. メトリクス停止・定期タイマー停止
4. 内部 API 停止
5. Slack app 停止
6. DB close（`wal_checkpoint(TRUNCATE)`）

## テスト

```bash
npm run test
npm run verify
```

- `npm run test`: vitest 実行
- `npm run verify`: typecheck + lint + test + build

## 運用上の注意

- `DEFAULT_TOOL=claude` のため、Claude CLI 未導入だと初期運用で失敗します
- `ALLOWED_USER_IDS` は Slack のユーザーIDを正確に指定してください
- workdir は `<8hex>`（新形式）と `sess_<12hex>`（旧形式）を併用サポート
- 未参照セッション workdir は起動時に整理され、7日以上未更新のものはクリーンアップ対象です
- `mode=write` は自動TTL失効しません（`!mode=readonly` / `!reset` / `!exit` で解除）
- アクティブセッションは `SESSION_IDLE_TIMEOUT_SEC`（デフォルト24時間）無操作で自動 `!exit`

## トラブルシュート

- **Slack で反応しない**
  - DM 以外で送っていないか
  - `ALLOWED_USER_IDS` に自分のIDが含まれているか
  - Slack App に `im:history` / `chat:write` が付いているか
- **添付が失敗する**
  - `files:read` scope があるか
  - 50MB 超や未許可 MIME ではないか
- **`!mode=write` / `!workdir=` が効かない**
  - 30秒以内に `!confirm XXXX` を返したか
- **MCP ツールで毎回止まる**
  - `!autorun on`（セッション）または `TOOL_AUTO_APPROVE_MODE=true`（グローバル）を検討
  - まず各 CLI の MCP 認証（OAuth）をローカル端末で完了させる
- **Dashboard で設定変更が反映されない**
  - そのキーが Hot-reload 対象外の可能性あり（restart required 表示を確認）
- **Webhook が受信できない**
  - `CLOUDFLARE_TUNNEL_ENABLED=true` でトンネルが有効か
  - `WEBHOOK_PUBLIC_BASE_URL` が正しく設定されているか
  - GitHub の場合は `GITHUB_WEBHOOK_IP_ALLOWLIST=true`（デフォルト有効）で IP が許可されているか
