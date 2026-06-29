#Requires -Version 5.1
<#
.SYNOPSIS
  Playwright (undetected-chromedriver) runner wrapper script (Windows).
  Reads JSON from stdin, delegates to run_playwright.py via the skill venv,
  and outputs structured JSON results to stdout.

.USAGE
  ConvertTo-Json @{actions=@(@{action="navigate";url="https://example.com"})} |
    Set-Content "$env:TEMP\pw_payload.json"
  powershell -NoProfile -File run_playwright.ps1 < "$env:TEMP\pw_payload.json"
  powershell -NoProfile -File run_playwright.ps1 --check
  powershell -NoProfile -File run_playwright.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  LLM tool runners treat non-zero exit codes as tool execution failures.
  Only the --check flag uses exit 1 for health-check compatibility.
#>

$ErrorActionPreference = 'Stop'

$VERSION = '1.0.0'
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SKILL_DIR = Split-Path -Parent $SCRIPT_DIR
$RUNNER_PY = Join-Path $SCRIPT_DIR 'run_playwright.py'
$VENV_DIR = Join-Path $SKILL_DIR '.venv'
$VENV_PYTHON = Join-Path $VENV_DIR 'Scripts\python.exe'
$REQUIREMENTS = Join-Path $SKILL_DIR 'requirements.txt'

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-JsonError {
  param([string]$Message, [string]$Code)
  @{ success = $false; error = $Message; code = $Code } | ConvertTo-Json -Compress -Depth 5
}

function Resolve-SystemPython {
  foreach ($cmd in @('py', 'python3', 'python')) {
    try {
      if ($cmd -eq 'py') {
        $null = & py -3 --version 2>&1
        return @{ Command = 'py'; Args = @('-3') }
      } else {
        $null = & $cmd --version 2>&1
        return @{ Command = $cmd; Args = @() }
      }
    } catch {}
  }
  return $null
}

function Ensure-Venv {
  if (Test-Path $VENV_PYTHON) { return $true }

  $sysPy = Resolve-SystemPython
  if (-not $sysPy) { return $false }

  try {
    & $sysPy.Command @($sysPy.Args + @('-m', 'venv', $VENV_DIR)) 2>&1 | Out-Null
    if (Test-Path $REQUIREMENTS) {
      & $VENV_PYTHON -m pip install -q -r $REQUIREMENTS 2>&1 | Out-Null
    }
    return (Test-Path $VENV_PYTHON)
  } catch {
    return $false
  }
}

# ── Flags ────────────────────────────────────────────────────────────────

if ($args.Count -gt 0 -and $args[0] -eq '--version') {
  @{ version = $VERSION } | ConvertTo-Json -Compress
  exit 0
}

if ($args.Count -gt 0 -and $args[0] -eq '--check') {
  $errors = @()

  # Check system Python
  $sysPy = Resolve-SystemPython
  if (-not $sysPy) {
    $errors += 'Python 3 not found. Install Python 3.10+ from https://www.python.org/downloads/'
  }

  # Check runner script
  if (-not (Test-Path $RUNNER_PY)) {
    $errors += "run_playwright.py not found at $RUNNER_PY"
  }

  # Check / create venv
  $hasVenv = Test-Path $VENV_PYTHON
  if (-not $hasVenv) {
    $hasVenv = Ensure-Venv
    if (-not $hasVenv) {
      $errors += "Failed to create venv at $VENV_DIR"
    }
  }

  # Delegate to Python --check if venv is available
  $pyCheck = $null
  if ($hasVenv -and (Test-Path $RUNNER_PY)) {
    try {
      $pyCheck = & $VENV_PYTHON $RUNNER_PY --check 2>&1 | Out-String
    } catch {
      $errors += "Python --check failed: $_"
    }
  }

  $result = @{
    success     = ($errors.Count -eq 0)
    version     = $VERSION
    has_venv    = $hasVenv
    venv_python = $VENV_PYTHON
  }
  if ($sysPy) { $result.system_python = "$($sysPy.Command) $($sysPy.Args -join ' ')".Trim() }
  if ($pyCheck) { $result.python_check = $pyCheck.Trim() }
  if ($errors.Count -gt 0) { $result.errors = $errors }

  $result | ConvertTo-Json -Compress -Depth 5
  if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
}

# ── Main: delegate to run_playwright.py ──────────────────────────────────

if (-not (Test-Path $RUNNER_PY)) {
  Write-JsonError "run_playwright.py not found at $RUNNER_PY" 'SCRIPT_NOT_FOUND'
  exit 0
}

# Ensure venv exists
if (-not (Test-Path $VENV_PYTHON)) {
  $created = Ensure-Venv
  if (-not $created) {
    Write-JsonError "Python venv not found and could not be created at $VENV_DIR. Run setup first." 'VENV_NOT_FOUND'
    exit 0
  }
}

# Read stdin and write to temp file, then invoke via file redirection
$tmpPayload = Join-Path $env:TEMP "pw_payload_$(Get-Random).json"
try {
  $stdinData = [Console]::In.ReadToEnd()
  if (-not $stdinData -or $stdinData.Trim().Length -eq 0) {
    Write-JsonError 'No JSON input provided on stdin' 'VALIDATION_ERROR'
    exit 0
  }

  [System.IO.File]::WriteAllText($tmpPayload, $stdinData, [System.Text.Encoding]::UTF8)

  # Invoke the Python script with file redirection
  $proc = Start-Process -FilePath $VENV_PYTHON -ArgumentList "`"$RUNNER_PY`"" `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardInput $tmpPayload `
    -RedirectStandardOutput "$tmpPayload.out" `
    -RedirectStandardError "$tmpPayload.err"

  $output = ''
  if (Test-Path "$tmpPayload.out") {
    $output = Get-Content "$tmpPayload.out" -Raw -ErrorAction SilentlyContinue
  }
  $errOutput = ''
  if (Test-Path "$tmpPayload.err") {
    $errOutput = Get-Content "$tmpPayload.err" -Raw -ErrorAction SilentlyContinue
  }

  if ($output) {
    Write-Output $output
  } elseif ($errOutput) {
    Write-JsonError "Python script error: $errOutput" 'EXECUTION_ERROR'
  } else {
    Write-JsonError 'Python script produced no output' 'EXECUTION_ERROR'
  }

  exit $proc.ExitCode
} finally {
  Remove-Item $tmpPayload -ErrorAction SilentlyContinue
  Remove-Item "$tmpPayload.out" -ErrorAction SilentlyContinue
  Remove-Item "$tmpPayload.err" -ErrorAction SilentlyContinue
}
