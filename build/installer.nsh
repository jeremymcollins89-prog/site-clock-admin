; Runs before the installer (and uninstaller) touch any files. If a copy of
; the app is still running -- the installed version, a leftover process from
; a crash, or a second window someone forgot to close -- Windows keeps its
; files locked, which is exactly what causes the "Failed to uninstall old
; application files. Please try running the installer again.: 2" error.
;
; History on this file, because it's been iterated on a lot:
;   - taskkill alone fixed the manual-install case, but not silent auto-update.
;   - Sleep 1500 -> 3000 -> 6000: real-world logs show first-attempt installs
;     STILL fail intermittently even at 6 seconds, at roughly the same rate
;     as at 3 seconds. That means the wait length was never the actual
;     bottleneck -- something else (most likely Windows Defender's real-time
;     scan of the freshly-downloaded/extracted files, possibly combined with
;     the OS not releasing the old exe's file handle instantly even after the
;     process is gone) was holding the lock for a variable amount of time no
;     fixed number reliably covers.
;   - A first attempt at polling instead of sleeping (checking Get-Process by
;     name) had a real bug in how it read nsExec::ExecToStack's return value,
;     so it got reverted rather than trusted without being able to compile-
;     test it here.
;
; This version polls the ACTUAL resource in contention instead of guessing at
; a delay or checking a proxy signal (whether the old process still exists):
; it repeatedly tries to open the currently-installed .exe for the same kind
; of exclusive access the installer needs, and only proceeds once that
; succeeds (or after a 10-second cap, so a stuck machine doesn't hang
; forever). The logic lives in a small standalone .ps1 file written out at
; install time -- one thing per line -- specifically so there's no repeat of
; the nested-quoting/stack-order mistakes a one-line inline command invites.
;
; This still can't be compile-tested outside a real Windows machine, so it's
; a best-effort improvement, not a guaranteed fix. If it still doesn't fully
; solve it: the auto-updater keeps the download in place and retries on the
; next check or button click either way, so a failed attempt just means
; trying again shortly after, not getting permanently stuck.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'

  FileOpen $9 "$PLUGINSDIR\wait-for-unlock.ps1" w
  FileWrite $9 '$$exePath = "$INSTDIR\Coll Timeclock Admin.exe"$\r$\n'
  FileWrite $9 'for ($$i = 0; $$i -lt 20; $$i++) {$\r$\n'
  FileWrite $9 '  if (-not (Test-Path $$exePath)) { exit 0 }$\r$\n'
  FileWrite $9 '  try {$\r$\n'
  FileWrite $9 '    $$fs = [System.IO.File]::Open($$exePath, "Open", "ReadWrite", "None")$\r$\n'
  FileWrite $9 '    $$fs.Close()$\r$\n'
  FileWrite $9 '    exit 0$\r$\n'
  FileWrite $9 '  } catch {$\r$\n'
  FileWrite $9 '    Start-Sleep -Milliseconds 500$\r$\n'
  FileWrite $9 '  }$\r$\n'
  FileWrite $9 '}$\r$\n'
  FileWrite $9 'exit 1$\r$\n'
  FileClose $9
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\wait-for-unlock.ps1"'
  Pop $8
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Coll Timeclock Admin.exe" /T'

  FileOpen $9 "$PLUGINSDIR\wait-for-unlock.ps1" w
  FileWrite $9 '$$exePath = "$INSTDIR\Coll Timeclock Admin.exe"$\r$\n'
  FileWrite $9 'for ($$i = 0; $$i -lt 20; $$i++) {$\r$\n'
  FileWrite $9 '  if (-not (Test-Path $$exePath)) { exit 0 }$\r$\n'
  FileWrite $9 '  try {$\r$\n'
  FileWrite $9 '    $$fs = [System.IO.File]::Open($$exePath, "Open", "ReadWrite", "None")$\r$\n'
  FileWrite $9 '    $$fs.Close()$\r$\n'
  FileWrite $9 '    exit 0$\r$\n'
  FileWrite $9 '  } catch {$\r$\n'
  FileWrite $9 '    Start-Sleep -Milliseconds 500$\r$\n'
  FileWrite $9 '  }$\r$\n'
  FileWrite $9 '}$\r$\n'
  FileWrite $9 'exit 1$\r$\n'
  FileClose $9
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\wait-for-unlock.ps1"'
  Pop $8
!macroend
