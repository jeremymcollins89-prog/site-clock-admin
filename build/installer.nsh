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
; Writes the very first line of the diagnostic marker file, before any file
; is touched -- see the customInstall macro below for the rest of the story.
; If a failed update shows NEITHER this line nor the customInstall line, the
; installer process never got far enough to run any of our own code at all
; (blocked from launching, or killed in the first instant). If it shows THIS
; line but not the customInstall one, the installer started running but died
; somewhere during the actual file-copy step -- which is the pattern real-time
; antivirus scanning killing a running, unsigned installer would produce.
!macro customInit
  FileOpen $9 "$APPDATA\coll-timeclock-admin\last-install-marker.txt" w
  FileWrite $9 "install started$\r$\n"
  FileClose $9

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

; Diagnostic only -- doesn't change install behavior at all.
;
; The 2.21.5 -> 2.21.6 real-world log confirmed the theory from the last
; round of instrumentation: on a failed attempt (reopened manually 14 seconds
; after the silent installer launched -- no timing race possible), NO marker
; was written at all. That means the file-copy Section this macro sits in
; simply never finished. Combined with customInit's start-of-install marker
; (see above), a failed attempt now tells us one of two things: if NEITHER
; marker line is present, the installer never got running in the first place;
; if the "install started" line is present but this one isn't, the installer
; started but was killed or errored out partway through the actual file copy
; -- the pattern you'd expect from real-time antivirus scanning treating an
; unsigned installer copying files as suspicious. Either way, this points at
; something outside our own code (Windows Defender/SmartScreen being the
; leading suspect for an unsigned .exe), not at install timing.
!macro customInstall
  FileOpen $9 "$APPDATA\coll-timeclock-admin\last-install-marker.txt" a
  FileWrite $9 "install section completed$\r$\n"
  FileClose $9
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
