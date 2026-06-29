#Requires -Version 5.1
<#
.SYNOPSIS
  Azure CLI wrapper script for the azure-cli skill (Windows).
  Accepts JSON via stdin, authenticates via service principal,
  executes the Azure CLI command, and returns structured JSON results to stdout.

.USAGE
  ConvertTo-Json @{command="az group list --output json"} | Set-Content "$env:TEMP\az_payload.json"
  powershell -NoProfile -File run_azure_cli.ps1 < "$env:TEMP\az_payload.json"
  powershell -NoProfile -File run_azure_cli.ps1 --check
  powershell -NoProfile -File run_azure_cli.ps1 --version

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

  # Check Azure CLI
  $azVersion = 'not found'
  if (Get-Command az -ErrorAction SilentlyContinue) {
    try {
      $azVersion = (& az version --output tsv 2>$null | Select-Object -First 1) ?? 'unknown'
    } catch { $azVersion = 'unknown' }
  } else {
    $errors += 'Azure CLI is not installed. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli'
  }

  $hasClientId     = [bool]$env:AZURE_CLIENT_ID
  $hasClientSecret = [bool]$env:AZURE_CLIENT_SECRET
  $hasTenantId     = [bool]$env:AZURE_TENANT_ID
  $hasSubscription = [bool]$env:AZURE_SUBSCRIPTION_ID

  if (-not $hasClientId)     { $errors += 'AZURE_CLIENT_ID is not set.' }
  if (-not $hasClientSecret) { $errors += 'AZURE_CLIENT_SECRET is not set.' }
  if (-not $hasTenantId)     { $errors += 'AZURE_TENANT_ID is not set.' }
  if (-not $hasSubscription) { $errors += 'AZURE_SUBSCRIPTION_ID is not set.' }

  $result = @{
    success            = ($errors.Count -eq 0)
    version            = $VERSION
    azure_cli_version  = $azVersion
    has_client_id      = $hasClientId
    has_client_secret  = $hasClientSecret
    has_tenant_id      = $hasTenantId
    has_subscription   = $hasSubscription
  }
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

if (-not $command.StartsWith('az ')) {
  Write-JsonError 'Command must start with "az "' 'VALIDATION_ERROR'
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

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Write-JsonError 'Azure CLI is not installed. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli' 'CLI_NOT_FOUND'
  exit 0
}

if (-not $env:AZURE_CLIENT_ID -or -not $env:AZURE_CLIENT_SECRET -or -not $env:AZURE_TENANT_ID) {
  Write-JsonError 'Azure credentials are not configured. Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID in the dashboard Skills settings.' 'AUTH_ERROR'
  exit 0
}

# Authenticate via service principal
try {
  $authOutput = & az login --service-principal `
    --username $env:AZURE_CLIENT_ID `
    --password $env:AZURE_CLIENT_SECRET `
    --tenant $env:AZURE_TENANT_ID `
    --output none 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-JsonError "Azure authentication failed: $authOutput" 'AUTH_ERROR'
    exit 0
  }
} catch {
  Write-JsonError "Azure authentication failed: $_" 'AUTH_ERROR'
  exit 0
}

# Set subscription if provided
if ($env:AZURE_SUBSCRIPTION_ID) {
  try {
    & az account set --subscription $env:AZURE_SUBSCRIPTION_ID 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-JsonError "Failed to set subscription" 'AUTH_ERROR'
      exit 0
    }
  } catch {
    Write-JsonError "Failed to set subscription: $_" 'AUTH_ERROR'
    exit 0
  }
}

# Execute the command with timeout
$startMs = Get-NowMs

$cmdParts = $command -split ' ', 2
$cmdExe = $cmdParts[0]
$cmdArgs = if ($cmdParts.Count -gt 1) { $cmdParts[1] } else { '' }

$tmpOut = Join-Path $env:TEMP "az_run_$(Get-Random).tmp"
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
