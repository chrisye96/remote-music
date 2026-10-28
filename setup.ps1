<#
.SYNOPSIS
  Install, check and start Remote Music on this PC.

.DESCRIPTION
  Safe to run again: every step checks first and skips what is already done.
    1. Installs Python, ffmpeg and Tailscale with winget if they are missing.
    2. Checks ffmpeg (libsoxr), the VB-Audio Hi-Fi Cable (present, 44100 Hz on both ends),
       foobar2000 with beefweb, and Tailscale.
    3. Publishes the server on the tailnet with `tailscale serve --https=8090`, unless
       port 8090 is already served. Other ports are never touched.
    4. Only with -Autostart (off by default): registers two logon tasks for the current
       user, foobar2000 hidden in the notification area and server.py without a window
       (log in %LOCALAPPDATA%\remote-music\server.log), and starts them.

.PARAMETER Foobar
  Path to foobar2000.exe. Default: the running foobar2000, else the usual install folders.

.PARAMETER NoInstall
  Only report missing programs; do not install them with winget.

.PARAMETER Autostart
  Turn on starting at logon: register and start the two logon tasks. Off by default.

.PARAMETER Uninstall
  Turn starting at logon off again: remove the logon tasks. Leaves programs, Tailscale
  and the running processes alone.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1
  Install and check everything; start the server yourself with: python server.py

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Autostart
  The same, and start foobar2000 and the server at every logon.
#>
param(
  [string]$Foobar,
  [switch]$NoInstall,
  [switch]$Autostart,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
$Port = 8090
$TaskServer = 'Remote Music server'
$TaskFoobar = 'Remote Music foobar2000'
$LogFile = Join-Path $env:LOCALAPPDATA 'remote-music\server.log'
$script:Problems = New-Object System.Collections.Generic.List[string]

function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "  OK    $text" -ForegroundColor Green }
function Info($text) { Write-Host "        $text" }
function Problem($text, $fix) {
  Write-Host "  FIX   $text" -ForegroundColor Yellow
  if ($fix) { Write-Host "        $fix" }
  $script:Problems.Add($text)
}

function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

# winget installs into PATH for new shells only; pick it up in this one
function Update-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

# Run a console program and return its combined output as one string. ffmpeg prints
# its listings to stderr, which PowerShell 5.1 would otherwise turn into errors.
function Run($exe, [string[]]$arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return ((& $exe @arguments 2>&1) | ForEach-Object { "$_" }) -join "`n" }
  finally { $ErrorActionPreference = $old }
}

function Get-Url($url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 3 } catch { return $null }
}

# ---------- Uninstall ----------

if ($Uninstall) {
  Step 'Removing the logon tasks'
  foreach ($name in $TaskServer, $TaskFoobar) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Ok "removed '$name'"
    } else {
      Info "'$name' was not registered"
    }
  }
  Info 'Running processes are left alone. To stop the server: close pythonw.exe in Task Manager.'
  Info "To stop publishing it on the tailnet: tailscale serve --https=$Port off"
  return
}

# ---------- 1. Programs ----------

Step 'Programs'
$packages = @(
  @{ Command = 'python'; Id = 'Python.Python.3.12'; Name = 'Python' },
  @{ Command = 'ffmpeg'; Id = 'Gyan.FFmpeg'; Name = 'ffmpeg (full build, with libsoxr)' },
  @{ Command = 'tailscale'; Id = 'Tailscale.Tailscale'; Name = 'Tailscale' }
)
foreach ($p in $packages) {
  if (Has $p.Command) { Ok "$($p.Name) found"; continue }
  if ($NoInstall -or -not (Has 'winget')) {
    Problem "$($p.Name) is missing" "Install it: winget install --id $($p.Id) -e"
    continue
  }
  Info "Installing $($p.Name) with winget..."
  winget install --id $p.Id -e --accept-source-agreements --accept-package-agreements
  Update-Path
  if (Has $p.Command) { Ok "$($p.Name) installed" }
  else { Problem "$($p.Name) did not install" "Install it by hand, then run this script again." }
}

# ---------- 2. Checks ----------

Step 'ffmpeg'
if (Has 'ffmpeg') {
  if ((Run 'ffmpeg' @('-hide_banner', '-buildconf')) -match 'enable-libsoxr') { Ok 'built with libsoxr' }
  else { Problem 'this ffmpeg has no libsoxr' 'Install the full build: winget install --id Gyan.FFmpeg -e' }
}

Step 'Virtual audio cable'
# The endpoint format sits in the MMDevices registry keys: an 8 byte header, then
# WAVEFORMATEX(TENSIBLE), whose sample rate is at byte 4 and bits per sample at byte 14.
$fmtKey = '{f19f064d-082c-4e27-bc73-6882a1bb8e4c},0'
$adapterKey = '{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
$ends = @{ Render = 'Hi-Fi Cable Input (Playback tab)'; Capture = 'Hi-Fi Cable Output (Recording tab)' }
foreach ($flow in 'Render', 'Capture') {
  $found = $null
  Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\$flow" -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty "$($_.PSPath)\Properties" -ErrorAction SilentlyContinue
    if ($props -and "$($props.$adapterKey)" -match 'Hi-Fi Cable') {
      $found = @{ State = (Get-ItemProperty $_.PSPath).DeviceState; Format = $props.$fmtKey }
    }
  }
  $label = $ends[$flow]
  if (-not $found) {
    Problem "$label not found" 'Install VB-Audio Hi-Fi Cable: https://vb-audio.com/Cable/'
  } elseif ($found.State -ne 1) {
    Problem "$label is disabled" 'Sound settings > More sound settings: enable it.'
  } elseif ($found.Format -and $found.Format.Length -ge 24) {
    $rate = [BitConverter]::ToUInt32($found.Format, 12)
    $bits = [BitConverter]::ToUInt16($found.Format, 22)
    if ($rate -eq 44100) { Ok "$label at $bits bit / $rate Hz" }
    else {
      Problem "$label runs at $rate Hz" 'Set it to 24 bit, 44100 Hz (Properties > Advanced). Otherwise the stream sounds high pitched and half silent.'
    }
  } else {
    Ok "$label enabled (format not readable; make sure it is 44100 Hz)"
  }
}
if (Has 'ffmpeg') {
  if ((Run 'ffmpeg' @('-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy')) -match 'Hi-Fi Cable Output') {
    Ok 'ffmpeg sees the capture device'
  } else {
    Problem 'ffmpeg does not list Hi-Fi Cable Output' 'Enable it on the Recording tab, then run this script again.'
  }
}

Step 'foobar2000 and beefweb'
if (-not $Foobar -and (Has 'python')) {
  # server.py already knows how to find the running foobar2000, even when it runs elevated
  Push-Location $Repo
  # No quotes in the code: Windows PowerShell 5.1 drops them when passing arguments
  try { $dir = (Run 'python' @('-c', 'import server; print(server.foobar_dir() or str())')).Trim() }
  finally { Pop-Location }
  if ($dir -and (Test-Path -LiteralPath $dir)) { $Foobar = Join-Path $dir 'foobar2000.exe' }
}
if (-not $Foobar) {
  $Foobar = @("$env:ProgramFiles\foobar2000\foobar2000.exe", "${env:ProgramFiles(x86)}\foobar2000\foobar2000.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($Foobar -and (Test-Path $Foobar)) { Ok "foobar2000: $Foobar" }
else {
  $Foobar = $null
  Problem 'foobar2000 not found' 'Start foobar2000 and run this script again, or pass -Foobar "C:\path\to\foobar2000.exe".'
}
$player = Get-Url 'http://127.0.0.1:8880/api/player'
if ($player) { Ok "beefweb $($player.player.info.pluginVersion) answers on port 8880" }
elseif (Get-Process foobar2000 -ErrorAction SilentlyContinue) {
  Problem 'foobar2000 runs but beefweb does not answer' 'Install beefweb 0.10 or later: https://github.com/hyperblast/beefweb/releases'
} else {
  Info 'foobar2000 is not running, so beefweb could not be checked. Run this script again with foobar2000 open.'
}

Step 'Tailscale'
$tailnetUrl = $null
if (Has 'tailscale') {
  $status = $null
  try { $status = (Run 'tailscale' @('status', '--json')) | ConvertFrom-Json } catch { }
  if (-not $status -or $status.BackendState -ne 'Running') {
    Problem 'Tailscale is not running or not signed in' 'Open Tailscale and sign in, then run this script again.'
  } else {
    $hostName = $status.Self.DNSName.TrimEnd('.')
    Ok "connected as $hostName"
    $serve = $null
    try { $serve = (Run 'tailscale' @('serve', 'status', '--json')) | ConvertFrom-Json } catch { }
    $web = $null
    if ($serve -and $serve.Web) { $web = $serve.Web.PSObject.Properties | Where-Object { $_.Name -eq "${hostName}:$Port" } }
    $target = "http://127.0.0.1:$Port"
    if ($web) {
      $proxy = $web.Value.Handlers.'/'.Proxy
      if ($proxy -eq $target) { Ok "https://${hostName}:$Port already points to the server" }
      else { Problem "port $Port is already served for something else ($proxy)" "Left alone. Free it with: tailscale serve --https=$Port off" }
    } else {
      Info "Publishing https://${hostName}:$Port on the tailnet..."
      $out = Run 'tailscale' @('serve', '--bg', "--https=$Port", $target)
      if ($LASTEXITCODE -eq 0) { Ok "published https://${hostName}:$Port" }
      else {
        Problem 'tailscale serve failed' 'Enable MagicDNS and HTTPS certificates in the Tailscale admin console, then run this script again.'
        Info $out
      }
    }
    $tailnetUrl = "https://${hostName}:$Port"
  }
}

# ---------- 3. Logon tasks (opt-in) ----------

if (-not $Autostart) {
  Step 'Start at logon'
  if (Get-ScheduledTask -TaskName $TaskServer -ErrorAction SilentlyContinue) { Ok 'on (turn it off with -Uninstall)' }
  else { Info 'off. Start the server with: python server.py   (to start it at every logon: -Autostart)' }
} else {
  Step 'Start at logon'
  $pythonw = $null
  if (Has 'python') {
    $pythonw = Join-Path (Split-Path (Get-Command python).Source) 'pythonw.exe'
    if (-not (Test-Path $pythonw)) { $pythonw = $null }
  }
  if (-not $pythonw) {
    Problem 'pythonw.exe not found next to python.exe' 'Install Python from python.org or winget (the Microsoft Store build has no pythonw), then run this script again.'
  } else {
    $user = "$env:USERDOMAIN\$env:USERNAME"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    # No time limit (the default stops a task after 3 days); restart the server if it dies
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
      -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

    $serverAction = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$Repo\server.py`"" -WorkingDirectory $Repo
    Register-ScheduledTask -TaskName $TaskServer -Action $serverAction -Trigger $trigger -Principal $principal `
      -Settings $settings -Description 'Remote Music: stream and remote control for foobar2000' -Force | Out-Null
    Ok "registered '$TaskServer'"

    if ($Foobar) {
      $foobarAction = New-ScheduledTaskAction -Execute $Foobar -Argument '/hide' -WorkingDirectory (Split-Path $Foobar)
      Register-ScheduledTask -TaskName $TaskFoobar -Action $foobarAction -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'Remote Music: foobar2000 hidden in the notification area' -Force | Out-Null
      Ok "registered '$TaskFoobar'"
    }

    # Start now instead of waiting for the next logon
    if (-not (Get-Process foobar2000 -ErrorAction SilentlyContinue) -and $Foobar) { Start-ScheduledTask -TaskName $TaskFoobar }
    $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -LocalAddress 127.0.0.1 -ErrorAction SilentlyContinue
    if ($busy) {
      Info "A server is already running on port $Port (PID $($busy.OwningProcess)), so the task was not started now."
      Info 'It takes over at the next logon. To switch now: stop that server, then run: Start-ScheduledTask -TaskName ''Remote Music server'''
    } else {
      Start-ScheduledTask -TaskName $TaskServer
      $up = $false
      for ($i = 0; $i -lt 15 -and -not $up; $i++) {
        Start-Sleep -Seconds 1
        try { $up = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { }
      }
      if ($up) { Ok "server is running (log: $LogFile)" }
      else { Problem 'the server task did not come up' "See $LogFile" }
    }
  }
}

# ---------- Summary ----------

Write-Host ''
if ($script:Problems.Count -eq 0) {
  Write-Host 'All set.' -ForegroundColor Green
  if ($tailnetUrl) { Write-Host "Open $tailnetUrl on the iPad or phone (Tailscale on), then Add to Home Screen." }
  Write-Host "On this PC: http://localhost:$Port"
} else {
  Write-Host "$($script:Problems.Count) thing(s) to fix:" -ForegroundColor Yellow
  foreach ($p in $script:Problems) { Write-Host "  - $p" }
  Write-Host 'Fix them and run this script again; finished steps are skipped.'
}
