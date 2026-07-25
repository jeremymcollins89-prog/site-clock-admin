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
; every file handle that process held is actually released. Fixed delays
; here (tried 1.5s, then 3s) were unreliable -- one update would go through,
; the next would silently fail the same way, because the real wait time
; varies by machine. Instead of guessing a number, this actively polls until
; Windows confirms the process is actually gone, then proceeds immediately
; -- no more waiting than necessary, and no risk of not waiting enough.
;
; The check uses PowerShell's Get-Process rather than parsing tasklist's
; text output, because tasklist's "no tasks found" message is localized
; (different wording on non-English Windows) and would silently break this
; check on any machine not set to English. Get-Process + exit code sidesteps
; that entirely -- it's just a number, not a sentence to parse.
!macro WaitForAppToFullyExit
  StrCpy $8 0
  wait_for_exit_loop:
    nsExec::ExecToStack "powershell -NoProfile -Command $\"if (Get-Process -Name 'Coll Timeclock Admin' -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }$\""
    Pop $7
    StrCmp $7 "0" wait_for_exit_done
    IntOp $8 $8 + 1
    ; Cap it at 10 tries (~3 seconds of polling) so a genuinely stuck
    ; process can never hang the installer forever -- if it's still not
    ; gone by then, proceed anyway rather than freeze the update.
    IntCmp $8 10 wait_for_exit_done
    Sleep 300
    Goto wait_for_exit_loop
  wait_for_exit_done:
  ; Small buffer even after confirmed exit -- Windows can take an instant
  ; longer to fully release file handles after the process itself is gone.
  Sleep 300
!macroend

!macro customInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  !insertmacro WaitForAppToFullyExit
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  !insertmacro WaitForAppToFullyExit
!macroend
