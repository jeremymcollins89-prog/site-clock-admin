; Runs before the installer (and uninstaller) touch any files. If a copy of
; the app is still running -- the installed version, a leftover process from
; a crash, or a second window someone forgot to close -- Windows keeps its
; files locked, which is exactly what causes the "Failed to uninstall old
; application files. Please try running the installer again.: 2" error.
; Force-closing the process first means the installer never hits that lock,
; whether it's running silently in the background (auto-update) or someone
; double-clicked the downloaded .exe by hand.
;
; taskkill returns as soon as it's told Windows to end the process, not once
; every file handle that process held is actually released. A follow-up
; attempt at actively polling for the process to disappear (via PowerShell's
; Get-Process) turned out to have its own bug -- nsExec::ExecToStack pushes
; two values onto the stack (exit code, then output text) and that script
; only popped one, so it wasn't reliably reading what it thought it was.
; That version failed twice in a row in real testing. Reverting to the
; simple fixed delay, which is less elegant but has actually proven itself:
; 3 seconds worked cleanly on its first real-world attempt.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  Sleep 3000
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  Sleep 3000
!macroend
