param(
    [switch]$Install,
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$DashboardDir = Join-Path $Root "frontend"
$PythonExe = Join-Path $Root ".venv\Scripts\python.exe"

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-PythonCommand {
    if (Test-Path $PythonExe) {
        return $PythonExe
    }

    if (Test-Command "python") {
        return "python"
    }

    if (Test-Command "py") {
        return "py"
    }

    throw "Python was not found. Install Python or create .venv, then run this script again."
}

function Start-ServiceWindow {
    param(
        [string]$Title,
        [string]$Command
    )

    $fullCommand = @'
$Host.UI.RawUI.WindowTitle = '__TITLE__'
Set-Location '__ROOT__'
__COMMAND__
Write-Host ''
Write-Host '__TITLE__ stopped. Press Enter to close this window.'
Read-Host
'@
    $fullCommand = $fullCommand.Replace('__TITLE__', $Title).Replace('__ROOT__', $Root).Replace('__COMMAND__', $Command)

    Start-Process powershell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-NoExit",
        "-Command",
        $fullCommand
    )
}

if (-not (Test-Command "npm")) {
    throw "npm was not found. Install Node.js, then run this script again."
}

$python = Get-PythonCommand
function New-UvicornCommand {
    param(
        [string]$App,
        [int]$Port,
        [string]$ReloadDir
    )

    $reloadArg = ""
    if (-not $NoReload) {
        $reloadArg = " --reload --reload-dir `"$ReloadDir`""
    }

    $command = "& '$python' -m uvicorn $App --host 127.0.0.1 --port $Port$reloadArg"
    if ($NoReload) {
        return $command
    }

    return @"
while (`$true) {
    $command
    Write-Host ''
    Write-Host 'Uvicorn exited. Restarting in 2 seconds...'
    Start-Sleep -Seconds 2
}
"@
}

Push-Location $Root
try {
    if ($Install) {
        Write-Host "Installing backend dependencies..."
        & $python -m pip install -r requirements.txt

        Write-Host "Installing frontend dependencies..."
        Push-Location $DashboardDir
        try {
            npm install
        } finally {
            Pop-Location
        }
    } elseif (-not (Test-Path (Join-Path $DashboardDir "node_modules"))) {
        Write-Host "Frontend dependencies are missing. Installing them..."
        Push-Location $DashboardDir
        try {
            npm install
        } finally {
            Pop-Location
        }
    }

    $envLines = @(
        '$env:PYTHONPATH = "' + $Root + '"',
        '$env:USER_SERVICE_URL = "http://127.0.0.1:8030"',
        '$env:BILIBILI_SERVICE_URL = "http://127.0.0.1:8010"',
        '$env:GATEWAY_INTERNAL_EVENTS_URL = "http://127.0.0.1:8000/api/internal/bilibili/events"',
        '$env:PUBLISHER_SERVICE_URL = "http://127.0.0.1:8040"',
        '$env:KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"',
        '$env:DISABLE_KAFKA = "1"'
    ) -join "`n"

    Start-ServiceWindow "DATN User Service :8030" "$envLines`n$(New-UvicornCommand 'backend.user_service.app.main:app' 8030 (Join-Path $Root 'backend/user_service'))"
    Start-ServiceWindow "DATN Bilibili Service :8010" "$envLines`n$(New-UvicornCommand 'backend.bilibili_service.app.main:app' 8010 (Join-Path $Root 'backend/bilibili_service'))"
    Start-ServiceWindow "DATN VNExpress Service :8020" "$envLines`n$(New-UvicornCommand 'backend.vnexpress_service.app.main:app' 8020 (Join-Path $Root 'backend/vnexpress_service'))"
    Start-ServiceWindow "DATN Publisher Service :8040" "$envLines`n$(New-UvicornCommand 'backend.publisher_service.app.main:app' 8040 (Join-Path $Root 'backend/publisher_service'))"
    Start-ServiceWindow "DATN Gateway :8000" "$envLines`n$(New-UvicornCommand 'backend.gateway.app.main:app' 8000 (Join-Path $Root 'backend/gateway'))"

    $frontendCommand = @"
`$env:VITE_API_BASE_URL = "http://localhost:8000/api"
`$env:VITE_BACKEND_ORIGIN = "http://localhost:8000"
Set-Location '$DashboardDir'
npm run dev -- --host 0.0.0.0
"@
    Start-ServiceWindow "DATN Dashboard :5173" $frontendCommand

    Write-Host ""
    Write-Host "Started local services in separate terminal windows."
    Write-Host "Gateway:   http://localhost:8000"
    Write-Host "Frontend:  http://localhost:5173"
    Write-Host ""
    Write-Host "Use .\start-all.cmd -Install to install/update dependencies before starting."
} finally {
    Pop-Location
}
