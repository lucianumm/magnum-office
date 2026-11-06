!macro customInstall
  ; Keep the installer for an independent manual reinstall. Never delete user data on uninstall.
  CreateDirectory "$APPDATA\AdvocaciaGestao\installers"
  CopyFiles /SILENT "$EXEPATH" "$APPDATA\AdvocaciaGestao\installers\${VERSION}.exe"
!macroend
