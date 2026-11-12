; The guardian of versions up to 1.9.1 runs "/S --updated" without naming a folder. When the registry
; lists both a per-user and a per-machine installation, or the folder in use is not the registered one,
; NSIS installs somewhere else, reports success, and the program in use is never replaced. The folder
; in use is in pending-update.json (previousExe), written by the program right before updating.
; Newer guardians pass /D= and the install mode themselves, so this only acts without /D=.
!macro customInit
  ${if} ${Silent}
    ${GetParameters} $R0
    ${GetOptions} $R0 "--updated" $R1
    ${IfNot} ${Errors}
      ${GetOptions} $R0 "/D=" $R1
      ${If} ${Errors}
        nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "$$p = Join-Path $$env:APPDATA 'AdvocaciaGestao\pending-update.json'; if (Test-Path -LiteralPath $$p) { [Console]::Write([IO.Path]::GetDirectoryName((Get-Content -Raw -LiteralPath $$p | ConvertFrom-Json).previousExe)) }"`
        Pop $R3
        Pop $R4
        ${if} $R3 == 0
        ${andIf} $R4 != ""
        ${andIf} ${FileExists} "$R4\${APP_EXECUTABLE_FILENAME}"
          ${if} $R4 == $perMachineInstallationFolder
            StrCpy $hasPerMachineInstallation "1"
            StrCpy $hasPerUserInstallation "0"
            !insertmacro setInstallModePerAllUsers
          ${else}
            StrCpy $hasPerMachineInstallation "0"
            StrCpy $hasPerUserInstallation "1"
            !insertmacro setInstallModePerUser
          ${endIf}
          StrCpy $INSTDIR $R4
        ${endIf}
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend

!macro customInstall
  ; Keep the installer for an independent manual reinstall. Never delete user data on uninstall.
  CreateDirectory "$APPDATA\AdvocaciaGestao\installers"
  CopyFiles /SILENT "$EXEPATH" "$APPDATA\AdvocaciaGestao\installers\${VERSION}.exe"
  ; Silent installs come from the updater. See relaunchWatch in desktop/main.cjs.
  ${if} ${Silent}
    Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --relaunch-after-update'
  ${endIf}
!macroend

; Stock electron-builder closes the program by image name when PowerShell is unavailable. That would also
; kill the update guardian, which runs under the same name from the preserved copy. Only close processes
; running from the installation folder.
!macro customCheckAppRunning
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "if (Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase')}) { exit 0 } else { exit 1 }"`
  Pop $R0
  ${if} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
    Quit
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Path -and $$_.Path.StartsWith('$INSTDIR\', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force }; Start-Sleep -Milliseconds 800"`
    Pop $R0
  ${endIf}
!macroend
