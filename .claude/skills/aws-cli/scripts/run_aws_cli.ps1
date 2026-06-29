#Requires -Version 5.1
<#
.SYNOPSIS
  AWS CLI wrapper script for the aws-cli skill (Windows).
  Accepts JSON via stdin, validates credentials, executes the AWS CLI command,
  and returns structured JSON results to stdout.

.USAGE
  ConvertTo-Json @{command="aws s3 ls"} | Set-Content "$env:TEMP\aws_payload.json"
  powershell -NoProfile -File run_aws_cli.ps1 < "$env:TEMP\aws_payload.json"
  powershell -NoProfile -File run_aws_cli.ps1 --check
  powershell -NoProfile -File run_aws_cli.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  LLM tool runners treat non-zero exit codes as tool execution failures.
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
  $obj = @{
    success    = $true
    command    = $Command
    output     = $Output
    exit_code  = $ExitCode
    elapsed_ms = $ElapsedMs
  }
  $obj | ConvertTo-Json -Compress -Depth 5
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

  # Check AWS CLI
  $awsVersion = 'not found'
  try {
    $awsVersion = (& aws --version 2>&1) -join ' '
  } catch {
    $errors += 'AWS CLI is not installed. Install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'
  }
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    $errors += 'AWS CLI is not installed.'
    $awsVersion = 'not found'
  }

  # Check credentials
  $hasKeyId = [bool]$env:AWS_ACCESS_KEY_ID
  $hasSecretKey = [bool]$env:AWS_SECRET_ACCESS_KEY
  $hasRegion = [bool]$env:AWS_DEFAULT_REGION

  $keyPreview = ''
  if ($hasKeyId) {
    $k = $env:AWS_ACCESS_KEY_ID
    if ($k.Length -gt 8) { $keyPreview = $k.Substring(0, 4) + '...' + $k.Substring($k.Length - 4) }
    else { $keyPreview = '***' }
  } else { $errors += 'AWS_ACCESS_KEY_ID is not set.' }

  if (-not $hasSecretKey) { $errors += 'AWS_SECRET_ACCESS_KEY is not set.' }
  if (-not $hasRegion) { $errors += 'AWS_DEFAULT_REGION is not set.' }

  $result = @{
    success          = ($errors.Count -eq 0)
    version          = $VERSION
    aws_cli_version  = $awsVersion
    has_key_id       = $hasKeyId
    has_secret_key   = $hasSecretKey
    has_region       = $hasRegion
  }
  if ($hasKeyId) { $result.key_preview = $keyPreview }
  if ($hasRegion) { $result.region = $env:AWS_DEFAULT_REGION }
  if ($errors.Count -gt 0) { $result.errors = $errors }
  $result | ConvertTo-Json -Compress -Depth 5
  if ($errors.Count -gt 0) { exit 1 } else { exit 0 }
}

# ── Main execution ───────────────────────────────────────────────────────

# Read JSON from stdin
$input = [Console]::In.ReadToEnd()
if (-not $input -or $input.Trim().Length -eq 0) {
  Write-JsonError 'No JSON input provided on stdin' 'VALIDATION_ERROR'
  exit 0
}

# Parse JSON
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

if (-not $command.StartsWith('aws ')) {
  Write-JsonError 'Command must start with "aws "' 'VALIDATION_ERROR'
  exit 0
}

# Reject shell operators to prevent injection
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

# Check AWS CLI is installed
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  Write-JsonError 'AWS CLI is not installed. Install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html' 'CLI_NOT_FOUND'
  exit 0
}

# Check credentials
if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
  Write-JsonError 'AWS credentials are not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in the dashboard Skills settings.' 'AUTH_ERROR'
  exit 0
}
if (-not $env:AWS_DEFAULT_REGION) {
  Write-JsonError 'AWS_DEFAULT_REGION is not set. Configure it in the dashboard Skills settings.' 'AUTH_ERROR'
  exit 0
}

# Execute the command with timeout
$startMs = Get-NowMs

# Split the command for Start-Process
$cmdParts = $command -split ' ', 2
$cmdExe = $cmdParts[0]
$cmdArgs = if ($cmdParts.Count -gt 1) { $cmdParts[1] } else { '' }

$tmpOut = Join-Path $env:TEMP "aws_run_$(Get-Random).tmp"
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
