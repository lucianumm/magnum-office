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
