#Requires -Version 5.1
<#
.SYNOPSIS
  Gmail Composer wrapper script (Windows).
  Reads JSON from stdin, delegates to compose_email.py, and outputs
  structured JSON with a base64url-encoded RFC 2822 email.

.USAGE
  echo '{"to":"a@b.com","subject":"Test","body":"Hello"}' | powershell -NoProfile -File compose_email.ps1
  powershell -NoProfile -File compose_email.ps1 --check
  powershell -NoProfile -File compose_email.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  Only the --check flag uses exit 1 for health-check compatibility.
#>

$ErrorActionPreference = 'Stop'

$VERSION = '1.0.0'
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$COMPOSE_PY = Join-Path $SCRIPT_DIR 'compose_email.py'

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-JsonError {
  param([string]$Message, [string]$Code)
  @{ success = $false; error = $Code; message = $Message } | ConvertTo-Json -Compress -Depth 5
}

# ── Flags ────────────────────────────────────────────────────────────────

if ($args.Count -gt 0 -and $args[0] -eq '--version') {
  @{ version = $VERSION } | ConvertTo-Json -Compress
  exit 0
}

if ($args.Count -gt 0 -and $args[0] -eq '--check') {
  # Check python3 availability
  $pythonCmd = $null
  foreach ($cmd in @('python3', 'python')) {
    try {
      $null = & $cmd --version 2>&1
      $pythonCmd = $cmd
      break
    } catch {}
  }

  if (-not $pythonCmd) {
    @{
      success = $false
      version = $VERSION
      error   = 'python3 not found in PATH'
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  if (-not (Test-Path $COMPOSE_PY)) {
    @{
      success = $false
      version = $VERSION
      error   = 'compose_email.py not found'
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  # Smoke test
  try {
    $result = '{"to":"test@example.com","subject":"check","body":"ok"}' | & $pythonCmd $COMPOSE_PY 2>&1
    $parsed = $result | ConvertFrom-Json
    if ($parsed.success -ne $true) {
      @{
        success = $false
        version = $VERSION
        error   = 'compose_email.py smoke test returned failure'
      } | ConvertTo-Json -Compress -Depth 5
      exit 1
    }
  } catch {
    @{
      success = $false
      version = $VERSION
      error   = "compose_email.py smoke test failed: $_"
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  @{
    success = $true
    version = $VERSION
    python3 = $true
  } | ConvertTo-Json -Compress -Depth 5
  exit 0
}

# ── Main: delegate to compose_email.py ───────────────────────────────────

if (-not (Test-Path $COMPOSE_PY)) {
  Write-JsonError "compose_email.py not found at $COMPOSE_PY" 'SCRIPT_NOT_FOUND'
  exit 0
}

# Resolve python command
$pythonCmd = $null
foreach ($cmd in @('python3', 'python')) {
  try {
    $null = & $cmd --version 2>&1
    $pythonCmd = $cmd
    break
  } catch {}
}

if (-not $pythonCmd) {
  Write-JsonError 'python3 not found in PATH' 'PYTHON_NOT_FOUND'
  exit 0
}

# Pass stdin through to compose_email.py
$input = [Console]::In.ReadToEnd()
$input | & $pythonCmd $COMPOSE_PY
