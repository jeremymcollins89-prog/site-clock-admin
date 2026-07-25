; Runs before the installer (and uninstaller) touch any files. If a copy of
; the app is still running -- the installed version, a leftover process from
; a crash, or a second window someone forgot to close -- Windows keeps its
; files locked, which is exactly what causes the "Failed to uninstall old
; application files. Please try running the installer again.: 2" error.
; Force-closing the process first means the installer never hits that lock,
; whether it's running silently in the background (auto-update) or someone
; double-clicked the downloaded .exe by hand.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
!macroend
