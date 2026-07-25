const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
new Store(); // registers electron-store's internal IPC handlers in the main process

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

  autoUpdater.on("checking-for-update", () => sendUpdateEvent({ type: "checking" }));
  autoUpdater.on("update-available", (info) => sendUpdateEvent({ type: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => sendUpdateEvent({ type: "not-available" }));
  autoUpdater.on("download-progress", (p) => sendUpdateEvent({ type: "progress", percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => sendUpdateEvent({ type: "downloaded", version: info.version }));
  autoUpdater.on("error", (err) => {
    console.error("Auto-update check failed:", err.message);
    sendUpdateEvent({ type: "error", message: err.message });
  });

  ipcMain.on("install-update", () => {
    log.info("Restart & update clicked -- calling quitAndInstall");
    try {
      // isSilent=true, isForceRunAfter=false.
      //
      // This used to pass isForceRunAfter=true (auto-reopen immediately after
      // installing), but real-world logs kept showing the same failure no
      // matter how the pre-install file-lock wait was tuned (1.5s, 3s, 6s,
      // then an active poll for exclusive file access -- none of it changed
      // the odds): the app would relaunch and still report the OLD version
      // number. That's a strong sign the race was never at the START of the
      // install (old files still locked) -- it's at the END: NSIS's
      // "--force-run" appears to relaunch the app essentially the instant the
      // file copy finishes, which can be before Windows has fully settled the
      // new file on disk, so the relaunch sometimes loads a stale image of
      // the exe it just replaced.
      //
      // Turning off the forced auto-relaunch sidesteps that race entirely
      // instead of trying to out-guess its timing: the update still installs
      // completely silently (no NSIS window), but the person has to
      // double-click the app back open themselves afterward. By the time a
      // human notices the app closed and clicks the icon again, the OS has
      // long since finished writing the file -- there's no realistic way to
      // react fast enough to hit the same race.
      autoUpdater.quitAndInstall(true, false);
    } catch (err) {
      // quitAndInstall throwing synchronously is rare, but if it happens the
      // app would otherwise just silently sit there with no explanation --
      // surface it the same way any other update error shows up.
      log.error("quitAndInstall threw:", err);
      sendUpdateEvent({ type: "error", message: err.message });
    }
  });

  ipcMain.on("check-for-updates", () => {
    autoUpdater.checkForUpdates();
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
  }

  app.whenReady().then(() => {
    log.info(`App ready -- version ${app.getVersion()}, log file: ${log.transports.file.getFile().path}`);
    checkInstallMarker();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    autoUpdater.checkForUpdates();
    // Also re-check periodically in case the app is left open for a long
    // stretch, or the first check ran before the machine had a network
    // connection.
    setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
