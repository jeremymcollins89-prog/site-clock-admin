const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
new Store(); // registers electron-store's internal IPC handlers in the main process

// Checks GitHub Releases for a newer version, downloads it in the
// background, and installs it automatically the next time the app is
// closed and reopened -- no action needed from whoever's using it. Only
// affects copies installed via the direct .exe download; copies installed
// through the Microsoft Store update automatically through the Store itself.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("error", (err) => {
  console.error("Auto-update check failed:", err.message);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile("index.html");

  // Address links (Google Maps directions), phone numbers, and email
  // addresses all hand off to the system's default handler (browser,
  // phone app, mail client) instead of a blocked/blank in-app popup.
  win.webContents.setWindowOpenHandler(({ url }) => {
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
  autoUpdater.checkForUpdatesAndNotify();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
