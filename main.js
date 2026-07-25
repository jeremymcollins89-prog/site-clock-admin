const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
new Store(); // registers electron-store's internal IPC handlers in the main process

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
    // isSilent=true, isForceRunAfter=true: apply the update with no visible
    // installer window, then relaunch automatically.
    autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.on("check-for-updates", () => {
    autoUpdater.checkForUpdates();
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
