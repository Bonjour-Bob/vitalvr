; Vital Algo installer: extra steps

!macro customInit
  ; A running Vital Algo server keeps its files locked
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process java,javaw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*\Vital Algo\*' } | Stop-Process -Force"`
  Pop $0
!macroend

!macro customInstall
  ; SteamVR app entry, so Vital Algo can start with SteamVR
  DetailPrint "Vital Algo -> SteamVR..."
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\steamvr-autostart.ps1" -Exe "$INSTDIR\VitalAlgo.exe" -ManifestDir "$INSTDIR"`
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\steamvr-autostart.ps1" -ManifestDir "$INSTDIR" -Remove`
  Pop $0
!macroend
