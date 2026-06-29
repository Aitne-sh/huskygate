#Requires -Version 5.1
<#
.SYNOPSIS
  GCP CLI wrapper script for the gcp-cli skill (Windows).
  Accepts JSON via stdin, authenticates via service account key file,
  executes the gcloud/gsutil/bq command, and returns structured JSON results to stdout.

.USAGE
  ConvertTo-Json @{command="gcloud compute instances list --format=json"} | Set-Content "$env:TEMP\gcp_payload.json"
  powershell -NoProfile -File run_gcp_cli.ps1 < "$env:TEMP\gcp_payload.json"
  powershell -NoProfile -File run_gcp_cli.ps1 --check
  powershell -NoProfile -File run_gcp_cli.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  Only the --check flag uses exit 1 for health-check compatibility.
#>

$ErrorActionPreference = 'Stop'

$VERSION = '1.0.0'
$DEFAULT_TIMEOUT = 120
$MAX_TIMEOUT = 600

# ── Helpers ──────────────────────────────────────────────────────────────

function Get-NowMs {
  [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Write-JsonSuccess {
  param([string]$Command, [string]$Output, [int]$ExitCode, [long]$ElapsedMs)
  @{
    success    = $true
    command    = $Command
    output     = $Output
    exit_code  = $ExitCode
    elapsed_ms = $ElapsedMs
  } | ConvertTo-Json -Compress -Depth 5
}

function Write-JsonError {
  param([string]$Message, [string]$Code)
  @{ success = $false; error = $Message; code = $Code } | ConvertTo-Json -Compress -Depth 5
}

# ── Flags ────────────────────────────────────────────────────────────────

if ($args.Count -gt 0 -and $args[0] -eq '--version') {
  @{ version = $VERSION } | ConvertTo-Json -Compress
  exit 0
}

if ($args.Count -gt 0 -and $args[0] -eq '--check') {
  $errors = @()

  # Check gcloud CLI
  $gcloudVersion = 'not found'
  if (Get-Command gcloud -ErrorAction SilentlyContinue) {
    try {
      $gcloudVersion = (& gcloud version --format="value(Google Cloud SDK)" 2>$null) ?? 'unknown'
    } catch { $gcloudVersion = 'unknown' }
  } else {
    $errors += 'Google Cloud SDK is not installed. Install: https://cloud.google.com/sdk/docs/install'
  }

  $hasKeyFile = $false
  $hasProject = [bool]$env:CLOUDSDK_CORE_PROJECT
  $keyFilePreview = ''

  if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
    if (Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS) {
      $hasKeyFile = $true
      $keyFilePreview = Split-Path $env:GOOGLE_APPLICATION_CREDENTIALS -Leaf
    } else {
      $errors += "GOOGLE_APPLICATION_CREDENTIALS points to a non-existent file: $($env:GOOGLE_APPLICATION_CREDENTIALS)"
      $keyFilePreview = 'file not found'
    }
  } else {
    $errors += 'GOOGLE_APPLICATION_CREDENTIALS is not set.'
  }

  if (-not $hasProject) { $errors += 'CLOUDSDK_CORE_PROJECT is not set.' }

  $result = @{
    success        = ($errors.Count -eq 0)
    version        = $VERSION
    gcloud_version = $gcloudVersion
    has_key_file   = $hasKeyFile
    has_project    = $hasProject
  }
  if ($hasKeyFile) { $result.key_file = $keyFilePreview }
  if ($hasProject) { $result.project = $env:CLOUDSDK_CORE_PROJECT }
  if ($errors.Count -gt 0) { $result.errors = $errors }
  $result | ConvertTo-Json -Compress -Depth 5
  if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
}

# ── Main execution ───────────────────────────────────────────────────────

$input = [Console]::In.ReadToEnd()
if (-not $input -or $input.Trim().Length -eq 0) {
  Write-JsonError 'No JSON input provided on stdin' 'VALIDATION_ERROR'
  exit 0
}

try {
  $data = $input | ConvertFrom-Json
} catch {
  Write-JsonError "Invalid JSON input: $_" 'VALIDATION_ERROR'
  exit 0
}

$command = if ($data.command) { $data.command.ToString().Trim() } else { '' }
$timeout = if ($null -ne $data.timeout) { [int]$data.timeout } else { $DEFAULT_TIMEOUT }

if (-not $command) {
  Write-JsonError 'Missing required field: command' 'VALIDATION_ERROR'
  exit 0
}

# Allow gcloud, gsutil, and bq commands
$allowedPrefixes = @('gcloud ', 'gsutil ', 'bq ')
$hasValidPrefix = $false
foreach ($p in $allowedPrefixes) {
  if ($command.StartsWith($p)) { $hasValidPrefix = $true; break }
}
if (-not $hasValidPrefix) {
  Write-JsonError 'Command must start with "gcloud", "gsutil", or "bq"' 'VALIDATION_ERROR'
  exit 0
}

$dangerous = @('|', '&&', '||', ';', '>', '<', '`', '$(', '&>', '2>', '>>')
foreach ($op in $dangerous) {
  if ($command.Contains($op)) {
    Write-JsonError "Shell operator `"$op`" is not allowed in commands" 'VALIDATION_ERROR'
    exit 0
  }
}

if ($timeout -lt 1 -or $timeout -gt $MAX_TIMEOUT) {
  Write-JsonError "timeout must be an integer between 1 and $MAX_TIMEOUT" 'VALIDATION_ERROR'
  exit 0
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-JsonError 'Google Cloud SDK is not installed. Install: https://cloud.google.com/sdk/docs/install' 'CLI_NOT_FOUND'
  exit 0
}

if (-not $env:GOOGLE_APPLICATION_CREDENTIALS) {
  Write-JsonError 'GOOGLE_APPLICATION_CREDENTIALS is not set. Configure it in the dashboard Skills settings.' 'AUTH_ERROR'
  exit 0
}
if (-not (Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS)) {
  Write-JsonError "Service account key file not found: $($env:GOOGLE_APPLICATION_CREDENTIALS)" 'AUTH_ERROR'
  exit 0
}
if (-not $env:CLOUDSDK_CORE_PROJECT) {
  Write-JsonError 'CLOUDSDK_CORE_PROJECT is not set. Configure it in the dashboard Skills settings.' 'AUTH_ERROR'
  exit 0
}

# Authenticate via service account key file
try {
  $authOutput = & gcloud auth activate-service-account `
    --key-file="$($env:GOOGLE_APPLICATION_CREDENTIALS)" `
    --project="$($env:CLOUDSDK_CORE_PROJECT)" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-JsonError "GCP authentication failed: $authOutput" 'AUTH_ERROR'
    exit 0
  }
} catch {
  Write-JsonError "GCP authentication failed: $_" 'AUTH_ERROR'
  exit 0
}

# Set project explicitly
try {
  & gcloud config set project $env:CLOUDSDK_CORE_PROJECT --quiet 2>$null | Out-Null
} catch {}

# Execute the command with timeout
$startMs = Get-NowMs

$cmdParts = $command -split ' ', 2
$cmdExe = $cmdParts[0]
$cmdArgs = if ($cmdParts.Count -gt 1) { $cmdParts[1] } else { '' }

$tmpOut = Join-Path $env:TEMP "gcp_run_$(Get-Random).tmp"
try {
  $proc = Start-Process -FilePath $cmdExe -ArgumentList $cmdArgs `
    -NoNewWindow -Wait:$false -PassThru `
    -RedirectStandardOutput $tmpOut -RedirectStandardError "$tmpOut.err"

  $exited = $proc.WaitForExit($timeout * 1000)
  $endMs = Get-NowMs
  $elapsed = $endMs - $startMs

  if (-not $exited) {
    try { $proc.Kill() } catch {}
    Write-JsonError "Command timed out after $timeout seconds" 'TIMEOUT_ERROR'
    exit 0
  }

  $exitCode = $proc.ExitCode
  $output = ''
  if (Test-Path $tmpOut) { $output = Get-Content $tmpOut -Raw -ErrorAction SilentlyContinue }
  $errOutput = ''
  if (Test-Path "$tmpOut.err") { $errOutput = Get-Content "$tmpOut.err" -Raw -ErrorAction SilentlyContinue }
  if ($errOutput) { $output = if ($output) { "$output`n$errOutput" } else { $errOutput } }

  if ($exitCode -ne 0) {
    @{
      success    = $false
      command    = $command
      error      = $output
      exit_code  = $exitCode
      code       = 'EXECUTION_ERROR'
      elapsed_ms = $elapsed
    } | ConvertTo-Json -Compress -Depth 5
    exit 0
  }

  Write-JsonSuccess -Command $command -Output $output -ExitCode $exitCode -ElapsedMs $elapsed
} finally {
  Remove-Item $tmpOut -ErrorAction SilentlyContinue
  Remove-Item "$tmpOut.err" -ErrorAction SilentlyContinue
}
