const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
new Store(); // registers electron-store's internal IPC handlers in the main process

// ---------- Installer job-object breakaway ----------
// Long story, distilled: NSIS marker instrumentation (see build/installer.nsh
// and checkInstallMarker below) proved the installer reliably STARTS but
// non-deterministically dies partway through copying files -- roughly half
// the time -- with no antivirus block logged anywhere and no change from a
// Defender folder exclusion. That ruled out antivirus.
//
// The actual mechanism: electron-updater spawns the installer with
// `detached: true` (see node_modules/electron-updater/out/BaseUpdater.js),
// but on Windows, Node/libuv's "detached" mode does NOT pass
// CREATE_BREAKAWAY_FROM_JOB when creating the child process. Every Windows
// process is automatically added to any Job Object its parent belongs to
// unless breakaway is explicitly requested -- and plenty of ordinary
// launchers, terminal hosts, and monitoring/EDR tools put the processes they
// start into a Job Object with "kill on job close" behavior. If this
// Electron process happens to be in one of those, the freshly-spawned
// installer inherits that same job membership. quitAndInstall calls
// app.quit() on the very next tick after spawning -- so when this process's
// handle on the job closes, Windows can tear down the *entire* job,
// including the installer, mid-copy. This matches multiple long-standing,
// still-open electron-builder GitHub issues (e.g. #7807, #7294) describing
// installers dying right after quitAndInstall with no clear cause.
//
// Fix: launch the installer via WMI's Win32_Process.Create instead of a
// direct child process spawn. WMI creates the new process inside the
// WmiPrvSE.exe service host, so it's rooted in a completely different
// process tree -- never a member of whatever job this Electron process is
// in, so it can't be cascade-killed when this process quits.
function launchInstallerEscapingJobObject(installerPath, args, callback) {
  try {
    const scriptPath = path.join(os.tmpdir(), "coll-timeclock-launch-installer.ps1");
    const resultPath = path.join(app.getPath("userData"), "wmi-launch-result.txt").replace(/\\/g, "\\\\");
    const commandLine = `"${installerPath}" ${args.join(" ")}`.replace(/'/g, "''");
    // Separate from the NSIS install marker on purpose -- customInit
    // overwrites that file the instant the installer starts, so anything
    // written here beforehand would just get erased. This file records
    // whether WMI itself accepted the process-creation request (a nonzero
    // ReturnValue means WMI refused/failed, in which case the installer
    // never ran at all -- a completely different failure mode than the
    // job-object cascade-kill this whole mechanism exists to avoid).
    const psScript =
      `$cl = '${commandLine}'\r\n` +
      `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$cl}\r\n` +
      `"ReturnValue=$($result.ReturnValue) ProcessId=$($result.ProcessId)" | Out-File -FilePath "${resultPath}" -Encoding utf8\r\n`;
    fs.writeFileSync(scriptPath, psScript, "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    let settled = false;
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      callback(err);
    });
    // IMPORTANT: wait for this powershell.exe process to actually EXIT before
    // telling the caller it's safe to call app.quit() -- a prior version of
    // this function used a flat 800ms setTimeout instead, which raced ahead
    // of Invoke-CimMethod's real-world latency (WMI/CIM cold-start can easily
    // take longer than that). If app.quit() fires before the CIM call has
    // actually run, this powershell.exe process is itself still just a normal
    // child of the Electron process -- still potentially a member of
    // whatever Job Object Electron belongs to -- and can get cascade-killed
    // the instant Electron quits, before it ever hands the installer off to
    // WMI. That produced exactly this symptom in the field: "no install
    // marker found" (installer never started at all) even with this
    // breakaway mechanism in place, and no wmi-launch-result.txt ever got
    // written -- proof the script was cut short, not that WMI refused it.
    // Waiting for the real exit event closes that race: by the time it
    // fires, the CIM call has already resolved one way or another, and if it
    // succeeded the installer is already running under WmiPrvSE.exe,
    // independent of this process and its job membership.
    child.on("exit", () => {
      if (settled) return;
      settled = true;
      callback(null);
    });
    child.unref();
    // Safety net only -- covers the pathological case where powershell.exe
    // never exits on its own (hung WMI call, etc.) so the app doesn't sit
    // there forever waiting to quit. Generous on purpose since a slow but
    // eventually-successful WMI call is far better than quitting too early.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(null);
    }, 10000);
  } catch (err) {
    callback(err);
  }
}

// Diagnostic only -- see the matching comments in build/installer.nsh. The
// installer writes "install started" at the very beginning (customInit,
// before any files are touched) and appends "install section completed" at
// the very end of the main file-copy Section (customInstall). The installer
// process itself is otherwise a total black box once quitAndInstall hands
// off to it, so this is the only way to tell how far a silent update actually
// got. Checked and cleared on every launch so each entry in the update log
// reflects only what happened since the last time the app opened.
function checkInstallMarker() {
  const markerPath = path.join(app.getPath("userData"), "last-install-marker.txt");
  try {
    if (!fs.existsSync(markerPath)) {
      log.info("No install marker found since last launch -- the installer never got far enough to run any of our own code (never started, or killed in the first instant).");
      return;
    }
    const contents = fs.readFileSync(markerPath, "utf8");
    const startedFound = contents.includes("install started");
    const completedFound = contents.includes("install section completed");
    if (startedFound && completedFound) {
      log.info(`Install marker: both lines found -- the installer ran start to finish since last launch: ${JSON.stringify(contents.trim())}`);
    } else if (startedFound && !completedFound) {
      log.info(`Install marker: only "install started" found -- the installer started but died partway through the file-copy step since last launch: ${JSON.stringify(contents.trim())}`);
    } else {
      log.info(`Install marker found but unexpected contents: ${JSON.stringify(contents.trim())}`);
    }
    fs.unlinkSync(markerPath);
  } catch (err) {
    log.error("Failed to check install marker:", err);
  }
}

// Companion to launchInstallerEscapingJobObject -- reports whether the WMI
// process-creation call itself succeeded (ReturnValue 0) the last time an
// update was installed. Only written right before a WMI-based install
// attempt, so its absence on a normal launch is expected and not logged.
function checkWmiLaunchResult() {
  const resultPath = path.join(app.getPath("userData"), "wmi-launch-result.txt");
  try {
    if (!fs.existsSync(resultPath)) return;
    const contents = fs.readFileSync(resultPath, "utf8").trim();
    log.info(`WMI installer launch result from last attempt: ${contents}`);
    fs.unlinkSync(resultPath);
  } catch (err) {
    log.error("Failed to check WMI launch result:", err);
  }
}

// electron-updater's own internal steps (download URLs, signature/hash
// checks, install attempts) all get written here. The click-to-install flow
// can fail for reasons that never reach our own event handlers below (e.g.
// Windows blocking the silent installer) -- this file is the only place
// that failure actually shows up. Fixed filename/location so it's easy to
// point someone at without them having to go hunting for it.
log.transports.file.resolvePathFn = () => path.join(app.getPath("userData"), "update-log.txt");
log.transports.file.level = "info";
autoUpdater.logger = log;

// Only one copy of the app can run at a time. This matters for updates: if
// someone has two copies open (e.g. clicked the desktop icon twice) and an
// update tries to install, Windows can't overwrite files the other running
// copy still has open, which is exactly the "Failed to uninstall old
// application files" error. Refusing a second launch -- and just focusing
// the existing window instead -- removes that failure mode entirely.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Checks GitHub Releases for a newer version and downloads it in the
  // background. Rather than installing silently-but-visibly whenever the
  // app happens to quit (the old behavior), we wait for the person to
  // click "Restart & update" in the banner shown in index.html. That
  // guarantees the app is cleanly shut down through Electron's own quit
  // flow right before the installer runs (instead of racing a window close
  // the OS hasn't fully released file handles for yet), and installs
  // silently -- no NSIS setup wizard popping up and no uninstall-error
  // dialog for non-technical users to puzzle over.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  // Every step of the check/download process gets sent to the renderer so
  // index.html can show real progress (a percent bar while downloading,
  // clear text if something goes wrong) instead of updates happening as an
  // invisible black box that's impossible to tell apart from "not working."
  function sendUpdateEvent(payload) {
    if (mainWindow) mainWindow.webContents.send("update-event", payload);
  }

  // Captured from update-downloaded so the install-update handler below can
  // launch the installer itself (via WMI, see launchInstallerEscapingJobObject)
  // instead of going through autoUpdater.quitAndInstall's internal spawn.
  let pendingInstallerPath = null;

  autoUpdater.on("checking-for-update", () => sendUpdateEvent({ type: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateEvent({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateEvent({ type: "not-available" }));
  autoUpdater.on("download-progress", (p) => sendUpdateEvent({ type: "progress", percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => {
    pendingInstallerPath = info.downloadedFile || null;
    sendUpdateEvent({ type: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    console.error("Auto-update check failed:", err.message);
    sendUpdateEvent({ type: "error", message: err.message });
  });

  ipcMain.on("install-update", () => {
    log.info("Restart & update clicked");
    // isSilent=true, isForceRunAfter=false -- no NSIS window, and the person
    // has to double-click the app back open themselves afterward rather than
    // relying on NSIS's --force-run auto-relaunch (a past theory about
    // --force-run racing the install's own completion was tested and
    // disproven by real logs; kept off since it's simpler either way).
    const installerArgs = ["--updated", "/S"];

    if (pendingInstallerPath) {
      // See the long comment above launchInstallerEscapingJobObject for the
      // full story: this launches the installer through WMI instead of a
      // direct child-process spawn so it can't be cascade-killed by Windows
      // when this Electron process's own quit sequence tears down whatever
      // Job Object it might belong to -- the real, evidence-based cause of
      // the installer dying mid-copy on this machine.
      log.info(`Launching installer via WMI (job-object breakaway): ${pendingInstallerPath}`);
      launchInstallerEscapingJobObject(pendingInstallerPath, installerArgs, (err) => {
        if (err) {
          log.error("WMI installer launch failed, falling back to quitAndInstall:", err);
          try {
            autoUpdater.quitAndInstall(true, false);
          } catch (err2) {
            log.error("Fallback quitAndInstall also threw:", err2);
            sendUpdateEvent({ type: "error", message: err2.message });
          }
          return;
        }
        log.info("Installer launched via WMI -- quitting app now");
        app.quit();
      });
    } else {
      // Shouldn't normally happen (the Restart & update button only appears
      // after update-downloaded has already fired), but fall back to the
      // built-in flow rather than doing nothing if it does.
      log.info("No pending installer path captured -- falling back to quitAndInstall");
      try {
        autoUpdater.quitAndInstall(true, false);
      } catch (err) {
        log.error("quitAndInstall threw:", err);
        sendUpdateEvent({ type: "error", message: err.message });
      }
    }
  });

  ipcMain.on("check-for-updates", () => {
    // The silent auto-download/auto-install flow above (WMI installer launch,
    // NSIS /S args, quitAndInstall) is Windows-specific, and Squirrel.Mac
    // (electron-updater's Mac auto-update mechanism) refuses to run against
    // an unsigned build anyway -- so rather than let this fail confusingly
    // partway through on a Mac, just tell the person to grab the latest
    // version from the download page instead.
    if (process.platform !== "win32") {
      sendUpdateEvent({
        type: "unsupported",
        message: "Automatic updates aren't available on Mac yet. Check the download page for the latest version.",
      });
      return;
    }
    autoUpdater.checkForUpdates();
  });

  // Temporary diagnostic for the quote-notes typing bug -- see preload.js's
  // debugLog and the listeners wired onto quote-notes-input in index.html.
  // Routes into the same update-log.txt Jeremy already knows how to paste.
  ipcMain.on("debug-log", (event, msg) => {
    log.info(`[renderer-debug] ${msg}`);
  });

  // Opens the update log in Notepad (or whatever the system's default .txt
  // viewer is) so a non-technical user can just click a button in Settings
  // instead of having to go find the file themselves.
  ipcMain.on("open-update-log", () => {
    shell.openPath(log.transports.file.getFile().path);
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1300,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    mainWindow.loadFile("index.html");

    // Address links (Google Maps directions), phone numbers, and email
    // addresses all hand off to the system's default handler (browser,
    // phone app, mail client) instead of a blocked/blank in-app popup.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http:") || url.startsWith("https:") || url.startsWith("tel:") || url.startsWith("mailto:")) {
        shell.openExternal(url);
      }
      return { action: "deny" };
    });

    // Blocks this same window from ever navigating away from the packaged
    // index.html. Electron re-injects preload.js (and its window.admin
    // bridge) into whatever page a webContents loads next, so without this,
    // any same-window navigation -- e.g. a raw <a href> with no target that
    // an XSS bug managed to inject -- could hand a remote, attacker-controlled
    // page the same admin API access as the real app. setWindowOpenHandler
    // above only covers new-window/target="_blank" navigations, not this.
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("file://")) {
        event.preventDefault();
      }
    });
  }

  app.whenReady().then(() => {
    log.info(`App ready -- version ${app.getVersion()}, log file: ${log.transports.file.getFile().path}`);
    checkInstallMarker();
    checkWmiLaunchResult();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    // See the check-for-updates handler above for why this is Windows-only.
    if (process.platform === "win32") {
      autoUpdater.checkForUpdates();
      // Also re-check periodically in case the app is left open for a long
      // stretch, or the first check ran before the machine had a network
      // connection.
      setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
