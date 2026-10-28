/**
 * Secure bridge exposed to the renderer. The frontend feature-detects
 * `window.desktop` (see Settings -> 关于与更新) and only uses it inside the
 * packaged desktop app; in a plain browser the UI degrades gracefully.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  version: process.env.DESKTOP_APP_VERSION ?? null,
  /** Manually trigger an update check; resolves to the result or null in dev. */
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  /** Subscribe to "update downloaded, restart to apply" notifications. */
  onUpdateDownloaded: (callback) => {
    const listener = (_event, version) => callback(version);
    ipcRenderer.on("desktop:update-downloaded", listener);
    return () => ipcRenderer.removeListener("desktop:update-downloaded", listener);
  },
});
