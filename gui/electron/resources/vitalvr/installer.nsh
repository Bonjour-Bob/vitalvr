; VitalVR installer: extra steps

!macro customInit
  ; A running VitalVR server keeps its files locked
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process java,javaw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*\VitalVR\*' } | Stop-Process -Force"`
  Pop $0
!macroend

!macro customInstall
  ; SteamVR app entry, so VitalVR can start with SteamVR
  DetailPrint "VitalVR -> SteamVR..."
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\steamvr-autostart.ps1" -Exe "$INSTDIR\VitalVR.exe" -ManifestDir "$INSTDIR"`
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\steamvr-autostart.ps1" -ManifestDir "$INSTDIR" -Remove`
  Pop $0
!macroend
