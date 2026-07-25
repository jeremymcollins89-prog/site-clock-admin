; Runs before the installer (and uninstaller) touch any files. If a copy of
; the app is still running -- the installed version, a leftover process from
; a crash, or a second window someone forgot to close -- Windows keeps its
; files locked, which is exactly what causes the "Failed to uninstall old
; application files. Please try running the installer again.: 2" error.
; Force-closing the process first means the installer never hits that lock,
; whether it's running silently in the background (auto-update) or someone
; double-clicked the downloaded .exe by hand.
;
; The Sleep after taskkill matters: taskkill returns as soon as it's told
; Windows to end the process, not once every file handle that process held
; is actually released. Under a normal (visible) install there's enough
; incidental delay for that cleanup to finish before files get overwritten.
; Under silent auto-update, NSIS moves on almost instantly -- and if it
; hits a file that's still mid-release, /S mode has no dialog to retry with,
; so it just silently skips that file and continues, leaving the old
; version's files in place even though the installer "succeeds" and
; relaunches the app.
;
; 1.5s (v2.20.7) measurably helped -- one auto-update actually went through
; for the first time -- but wasn't consistently enough; the very next
; version bump failed the same way again. Bumped to 3s for more headroom.
; If this still isn't reliable, the next step is polling for the process to
; actually disappear (tasklist) instead of a blind fixed delay.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  Sleep 3000
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'
  Sleep 3000
!macroend
