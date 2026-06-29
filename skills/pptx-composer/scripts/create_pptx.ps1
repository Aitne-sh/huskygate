#Requires -Version 5.1
<#
.SYNOPSIS
  PPTX Composer wrapper script (Windows).
  Reads JSON from stdin, delegates to create_pptx.py, and outputs
  structured JSON with the generated PPTX file path.

.USAGE
  echo '{"slides":[...]}' | powershell -NoProfile -File create_pptx.ps1
  powershell -NoProfile -File create_pptx.ps1 --check
  powershell -NoProfile -File create_pptx.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  Only the --check flag uses exit 1 for health-check compatibility.
#>

$ErrorActionPreference = 'Stop'

$VERSION = '1.0.0'
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CREATE_PY = Join-Path $SCRIPT_DIR 'create_pptx.py'

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

  if (-not (Test-Path $CREATE_PY)) {
    @{
      success = $false
      version = $VERSION
      error   = 'create_pptx.py not found'
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  # Check python-pptx is importable
  try {
    $null = & $pythonCmd -c 'import pptx' 2>&1
  } catch {
    @{
      success = $false
      version = $VERSION
      error   = 'python-pptx not installed. Run: pip install python-pptx>=1.0.0'
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  # Smoke test
  try {
    $result = '{"slides":[{"layout":"title","title":"Test"}]}' | & $pythonCmd $CREATE_PY 2>&1
    $parsed = $result | ConvertFrom-Json
    if ($parsed.success -ne $true) {
      @{
        success = $false
        version = $VERSION
        error   = 'create_pptx.py smoke test returned failure'
      } | ConvertTo-Json -Compress -Depth 5
      exit 1
    }

    # Clean up smoke test output
    if ($parsed.file -and (Test-Path $parsed.file)) {
      Remove-Item $parsed.file -Force
    }
  } catch {
    @{
      success = $false
      version = $VERSION
      error   = "create_pptx.py smoke test failed: $_"
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }

  @{
    success     = $true
    version     = $VERSION
    python3     = $true
    python_pptx = $true
  } | ConvertTo-Json -Compress -Depth 5
  exit 0
}

# ── Main: delegate to create_pptx.py ───────────────────────────────────

if (-not (Test-Path $CREATE_PY)) {
  Write-JsonError "create_pptx.py not found at $CREATE_PY" 'SCRIPT_NOT_FOUND'
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

# Check python-pptx
try {
  $null = & $pythonCmd -c 'import pptx' 2>&1
} catch {
  Write-JsonError 'python-pptx not installed. Run: pip install python-pptx>=1.0.0' 'IMPORT_ERROR'
  exit 0
}

# Pass stdin through to create_pptx.py
$input = [Console]::In.ReadToEnd()
$input | & $pythonCmd $CREATE_PY
