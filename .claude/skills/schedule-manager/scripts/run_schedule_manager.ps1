#Requires -Version 5.1
<#
.SYNOPSIS
  Schedule Manager wrapper script for the schedule-manager skill (Windows).
  Calls HuskyGate's Server Internal API to manage scheduled tasks.
  Returns structured JSON results to stdout.

.USAGE
  powershell -NoProfile -File run_schedule_manager.ps1 create < "$env:TEMP\sched_payload.json"
  powershell -NoProfile -File run_schedule_manager.ps1 list
  powershell -NoProfile -File run_schedule_manager.ps1 get <task_id>
  powershell -NoProfile -File run_schedule_manager.ps1 --check
  powershell -NoProfile -File run_schedule_manager.ps1 --version

.EXIT CODE CONVENTION
  All error paths that produce valid JSON to stdout exit with 0, not 1.
  Only the --check flag uses exit 1 for health-check compatibility.
#>

$ErrorActionPreference = 'Stop'

$VERSION = '1.0.0'
$API_BASE = if ($env:HUSKYGATE_API_BASE) { $env:HUSKYGATE_API_BASE } else { 'http://127.0.0.1:3738' }
$API_SECRET = $env:HUSKYGATE_API_SECRET

# ── Helpers ──────────────────────────────────────────────────────────────

function Write-JsonSuccess {
  param($Data)
  @{ success = $true; data = $Data } | ConvertTo-Json -Compress -Depth 10
}

function Write-JsonError {
  param([string]$Message, [string]$Code)
  @{ success = $false; error = $Message; code = $Code } | ConvertTo-Json -Compress -Depth 5
}

function Get-AuthHeaders {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($API_SECRET) { $headers['Authorization'] = "Bearer $API_SECRET" }
  return $headers
}

# Perform an HTTP request and handle errors uniformly.
function Invoke-ApiCall {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body = ''
  )

  $url = "$API_BASE$Path"
  $headers = Get-AuthHeaders
  $params = @{
    Uri             = $url
    Method          = $Method
    Headers         = $headers
    UseBasicParsing = $true
    ErrorAction     = 'Stop'
  }
  if ($Body) {
    $params['Body'] = $Body
    $params['ContentType'] = 'application/json'
  }

  try {
    $response = Invoke-WebRequest @params
    return $response.Content
  } catch {
    $statusCode = 0
    $errorBody = ''
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        $reader.Close()
      } catch {}
    }

    if ($statusCode -ge 400) {
      $errorMsg = "HTTP $statusCode"
      try {
        $parsed = $errorBody | ConvertFrom-Json
        if ($parsed.error) { $errorMsg = $parsed.error }
      } catch {
        if ($errorBody) { $errorMsg = "HTTP ${statusCode}: $($errorBody.Substring(0, [Math]::Min(200, $errorBody.Length)))" }
      }
      Write-JsonError $errorMsg "API_ERROR_$statusCode"
    } else {
      Write-JsonError "Failed to connect to HuskyGate API at ${API_BASE}: $_" 'CONNECTION_ERROR'
    }
    return $null
  }
}

# ── Flags ────────────────────────────────────────────────────────────────

if ($args.Count -gt 0 -and $args[0] -eq '--version') {
  @{ version = $VERSION } | ConvertTo-Json -Compress
  exit 0
}

if ($args.Count -gt 0 -and $args[0] -eq '--check') {
  try {
    $headers = Get-AuthHeaders
    $response = Invoke-WebRequest -Uri "$API_BASE/api/schedules" `
      -Method GET -Headers $headers -UseBasicParsing -ErrorAction Stop
    $httpStatus = [int]$response.StatusCode
    $result = @{
      success        = ($httpStatus -ge 200 -and $httpStatus -lt 300)
      version        = $VERSION
      api_base       = $API_BASE
      http_status    = $httpStatus
      has_api_secret = [bool]$API_SECRET
    }
    if (-not $result.success) {
      $result.error = "HuskyGate API returned HTTP $httpStatus"
    }
    $result | ConvertTo-Json -Compress -Depth 5
    if ($result.success) { exit 0 } else { exit 1 }
  } catch {
    @{
      success  = $false
      version  = $VERSION
      api_base = $API_BASE
      error    = "Cannot connect to HuskyGate API: $_"
    } | ConvertTo-Json -Compress -Depth 5
    exit 1
  }
}

# ── Action dispatch ──────────────────────────────────────────────────────

$ACTION = if ($args.Count -gt 0) { $args[0] } else { '' }
$TASK_ID = if ($args.Count -gt 1) { $args[1] } else { '' }

if (-not $ACTION) {
  Write-JsonError 'Missing action. Usage: run_schedule_manager.ps1 <create|list|get|update|pause|resume|delete|history> [task_id]' 'USAGE_ERROR'
  exit 0
}

switch ($ACTION) {
  'create' {
    $input = [Console]::In.ReadToEnd()
    if (-not $input -or $input.Trim().Length -eq 0) {
      Write-JsonError 'No JSON payload provided on stdin' 'VALIDATION_ERROR'
      exit 0
    }

    try {
      $data = $input | ConvertFrom-Json
    } catch {
      Write-JsonError "Invalid JSON input: $_" 'VALIDATION_ERROR'
      exit 0
    }

    $errors = @()
    $name = if ($data.name) { $data.name.ToString().Trim() } else { '' }
    $prompt = if ($data.prompt) { $data.prompt.ToString().Trim() } else { '' }
    $scheduleType = if ($data.schedule_type) { $data.schedule_type.ToString() } else { '' }

    if (-not $name) { $errors += 'name is required' }
    if (-not $prompt) { $errors += 'prompt is required' }
    if ($scheduleType -ne 'once' -and $scheduleType -ne 'recurring') {
      $errors += 'schedule_type must be "once" or "recurring"'
    }
    if ($scheduleType -eq 'once' -and -not $data.run_at) {
      $errors += 'run_at is required for once schedule'
    }
    if ($scheduleType -eq 'recurring' -and -not $data.cron_expr) {
      $errors += 'cron_expr is required for recurring schedule'
    }

    if ($errors.Count -gt 0) {
      Write-JsonError ($errors -join '; ') 'VALIDATION_ERROR'
      exit 0
    }

    $payload = @{
      name          = $name
      tool          = if ($data.tool) { $data.tool.ToString() } else { 'claude' }
      mode          = if ($data.mode) { $data.mode.ToString() } else { 'readonly' }
      prompt        = $prompt
      schedule_type = $scheduleType
    }
    if ($data.run_at)         { $payload.run_at = $data.run_at }
    if ($data.cron_expr)      { $payload.cron_expr = $data.cron_expr }
    if ($data.timezone)       { $payload.timezone = $data.timezone }
    if ($data.notify_channel) { $payload.notify_channel = $data.notify_channel }
    if ($data.notify_thread)  { $payload.notify_thread = $data.notify_thread }
    if ($null -ne $data.max_runs) { $payload.max_runs = $data.max_runs }

    $body = $payload | ConvertTo-Json -Compress -Depth 5
    $result = Invoke-ApiCall -Method POST -Path '/api/schedules' -Body $body
    if ($null -eq $result) { exit 0 }

    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'list' {
    $result = Invoke-ApiCall -Method GET -Path '/api/schedules'
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'get' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 get <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $result = Invoke-ApiCall -Method GET -Path "/api/schedules/$TASK_ID"
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'update' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 update <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $input = [Console]::In.ReadToEnd()
    if (-not $input -or $input.Trim().Length -eq 0) {
      Write-JsonError 'No JSON payload provided on stdin' 'VALIDATION_ERROR'
      exit 0
    }
    try {
      $data = $input | ConvertFrom-Json
    } catch {
      Write-JsonError "Invalid JSON input: $_" 'VALIDATION_ERROR'
      exit 0
    }

    $patch = @{}
    $patchFields = @('name', 'prompt', 'tool', 'mode', 'cron_expr', 'timezone', 'notify_channel', 'max_runs', 'status')
    foreach ($f in $patchFields) {
      if ($null -ne $data.$f) { $patch[$f] = $data.$f }
    }

    $body = $patch | ConvertTo-Json -Compress -Depth 5
    $result = Invoke-ApiCall -Method PATCH -Path "/api/schedules/$TASK_ID" -Body $body
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'pause' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 pause <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $body = '{"status":"paused"}'
    $result = Invoke-ApiCall -Method PATCH -Path "/api/schedules/$TASK_ID" -Body $body
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'resume' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 resume <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $body = '{"status":"active"}'
    $result = Invoke-ApiCall -Method PATCH -Path "/api/schedules/$TASK_ID" -Body $body
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'delete' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 delete <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $result = Invoke-ApiCall -Method DELETE -Path "/api/schedules/$TASK_ID"
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  'history' {
    if (-not $TASK_ID) {
      Write-JsonError 'Missing task_id. Usage: run_schedule_manager.ps1 history <task_id>' 'VALIDATION_ERROR'
      exit 0
    }
    $result = Invoke-ApiCall -Method GET -Path "/api/schedules/$TASK_ID/runs?limit=20"
    if ($null -eq $result) { exit 0 }
    try {
      $parsed = $result | ConvertFrom-Json
      Write-JsonSuccess $parsed
    } catch {
      Write-JsonSuccess $result
    }
  }

  default {
    Write-JsonError "Unknown action: $ACTION. Valid actions: create, list, get, update, pause, resume, delete, history" 'USAGE_ERROR'
    exit 0
  }
}
