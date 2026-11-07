param([Parameter(Mandatory=$true)][string]$Target, [Parameter(Mandatory=$true)][string]$Arguments, [Parameter(Mandatory=$true)][string]$Shortcut)
$ErrorActionPreference = 'Stop'
$shellObject = New-Object -ComObject WScript.Shell
$shortcutObject = $shellObject.CreateShortcut($Shortcut)
$shortcutObject.TargetPath = $Target
$shortcutObject.Arguments = $Arguments
$shortcutObject.WorkingDirectory = [IO.Path]::GetDirectoryName($Target)
$shortcutObject.Description = 'Restaurar o programa e os dados anteriores à atualização'
$shortcutObject.Save()
