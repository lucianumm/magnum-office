param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
$taskUpdate = Get-Content -LiteralPath $RequestFile -Raw | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($taskUpdate.root)
$logFile = Join-Path $root 'logs\recovery.jsonl'
function Write-RecoveryEvent([string]$eventName) {
  @{ at = [DateTime]::UtcNow.ToString('o'); event = $eventName; version = $taskUpdate.version } | ConvertTo-Json -Compress | Add-Content -LiteralPath $logFile
}
try {
  Wait-Process -Id $taskUpdate.parentPid -Timeout 120 -ErrorAction SilentlyContinue
  if (Get-Process -Id $taskUpdate.parentPid -ErrorAction SilentlyContinue) { throw 'Application did not exit' }
  $installerProcess = Start-Process -FilePath $taskUpdate.installer -ArgumentList '/S' -PassThru -WindowStyle Hidden
  if (-not $installerProcess.WaitForExit(300000) -or $installerProcess.ExitCode -ne 0) { throw 'Installation failed' }
  $newProcess = Start-Process -FilePath $taskUpdate.previousExe -WindowStyle Hidden -PassThru
  $healthy = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    $healthFile = Join-Path $root 'health.json'
    if (Test-Path -LiteralPath $healthFile) {
      try { $health = Get-Content -LiteralPath $healthFile -Raw | ConvertFrom-Json; if ($health.version -eq $taskUpdate.version -and $health.backupId -eq $taskUpdate.backupId) { $healthy = $true; break } } catch {}
    }
  }
  if (-not $healthy) { throw 'New version failed health check' }
  Write-RecoveryEvent 'update.guardian.success'
} catch {
  Write-RecoveryEvent 'update.guardian.rollback'
  if ($newProcess -and (Get-Process -Id $newProcess.Id -ErrorAction SilentlyContinue)) {
    $runningImage = Get-Process -Id $newProcess.Id -ErrorAction SilentlyContinue
    if ($runningImage.Path -eq $taskUpdate.previousExe) { Stop-Process -Id $newProcess.Id -Force; Wait-Process -Id $newProcess.Id -Timeout 30 -ErrorAction SilentlyContinue }
  }
  # The recovery executable is the complete old application, preserved before installing.
  $recoveryArgs = @(('--recover=' + $taskUpdate.backupId), ('--user-data=' + $root), ('--rollback-version=' + $taskUpdate.version))
  $recoveryInfo = New-Object System.Diagnostics.ProcessStartInfo
  $recoveryInfo.FileName = $taskUpdate.recoveryExe
  $recoveryInfo.UseShellExecute = $false
  $recoveryInfo.CreateNoWindow = $true
  $recoveryInfo.Arguments = ($recoveryArgs | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
  [void][System.Diagnostics.Process]::Start($recoveryInfo)
}
