/**
 * Research OS desktop shell (Electron main process).
 *
 * Responsibilities:
 * 1. Start the bundled backend sidecar (PyInstaller exe of the FastAPI app)
 *    on a free port, wait for /api/health, then load the exported frontend.
 * 2. Serve the static export over the custom `app://` protocol with SPA
 *    fallback: any deep link's numeric segments map to the exported
 *    placeholder pages (e.g. app://projects/1/experiments ->
 *    out/projects/app/experiments.html).
 * 3. Inject the resolved API base into the renderer via config.js so the
 *    frontend (window.__RESEARCH_OS_API_BASE__) always talks to the sidecar.
 * 4. Auto-update via electron-updater against this project's GitHub Releases.
 *    Publishing a release (CI or `electron-builder --publish always`) is all
 *    it takes for installed clients to update themselves.
 *
 * Prerequisites: see desktop/README.md.
 */

const { app, BrowserWindow, protocol, net, Menu } = require("electron");
const { createServer } = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");

const isDev = !app.isPackaged;
const ROOT = path.join(__dirname, "..");
const FRONTEND_DIST = path.join(__dirname, "web"); // exported frontend copied here by the build script
const BACKEND_EXE = path.join(process.resourcesPath ?? __dirname, "sidecar", process.platform === "win32" ? "research-os-backend.exe" : "research-os-backend");

const SCHEME = "app";
const APP_VERSION = app.getVersion();

/** @type {import('electron-updater').AutoUpdater | null} */
let autoUpdater = null;
let backendProcess = null;
let backendPort = 8000;
let mainWindow = null;

// ---------------------------------------------------------------- backend

function findFreePort(startFrom) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const socket = createServer();
      socket.once("error", () => resolve(tryPort(port + 1)));
      socket.once("listening", () => socket.close(() => resolve(port)));
      socket.listen(port, "127.0.0.1");
    };
    tryPort(startFrom);
  });
}

function startBackendSidecar(port) {
  if (!fs.existsSync(BACKEND_EXE)) {
    // Dev mode: assume a backend is already running on :8000 (uvicorn).
    console.warn("[research-os] sidecar not found; expecting dev backend on :8000");
    return null;
  }
  const child = spawn(BACKEND_EXE, ["--port", String(port)], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => console.log(`[sidecar] ${d}`));
  child.stderr.on("data", (d) => console.error(`[sidecar] ${d}`));
  return child;
}

function waitForBackend(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const probe = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    return false;
  };
  return (async () => {
    while (Date.now() < deadline) {
      if (await probe()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  })();
}

// ---------------------------------------------------------------- protocol

function registerAppProtocol() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function resolveExportFile(urlPath) {
  // 1) exact file (assets, index.html, real static pages)
  // 2) numeric segments -> "app" placeholder pages (SPA deep links)
  // 3) fallback to index.html
  const clean = decodeURIComponent(new URL(urlPath, `${SCHEME}://r/`).pathname).replace(/^\/+/, "");
  const candidates = [];
  if (clean) {
    candidates.push(clean);
    candidates.push(`${clean}.html`);
    const segments = clean.split("/").map((s) => (/^\d+$/.test(s) ? "app" : s));
    candidates.push(`${segments.join("/")}.html`);
  }
  candidates.push("index.html");
  for (const candidate of candidates) {
    const full = path.join(FRONTEND_DIST, candidate);
    if (full.startsWith(FRONTEND_DIST) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      return full;
    }
  }
  return path.join(FRONTEND_DIST, "index.html");
}

// ---------------------------------------------------------------- updater

async function initAutoUpdater(win) {
  if (isDev) return; // updates only apply to packaged builds
  try {
    const { autoUpdater: updater } = require("electron-updater");
    autoUpdater = updater;
    updater.autoDownload = true;
    updater.on("update-downloaded", (info) => {
      win?.webContents.send("desktop:update-downloaded", info.version);
    });
    updater.on("error", (err) => console.error("[updater]", err));
    updater.checkForUpdatesAndNotify().catch(() => {});
    setInterval(() => updater.checkForUpdates().catch(() => {}), 60 * 60 * 1000); // hourly
  } catch (err) {
    console.warn("[research-os] electron-updater not installed; auto-update disabled");
  }
}

// ---------------------------------------------------------------- window

async function createWindow() {
  backendPort = await findFreePort(8000);
  backendProcess = startBackendSidecar(backendPort);
  const backendReady = await waitForBackend(backendPort);
  console.log(`[research-os] backend ${backendReady ? "ready" : "NOT ready"} on :${backendPort}`);

  // Runtime API base injection (see frontend resolveApiBase()).
  const configJs = `window.__RESEARCH_OS_API_BASE__ = "http://127.0.0.1:${backendPort}";`;
  const configPath = path.join(FRONTEND_DIST, "config.js");
  try {
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, configJs);
  } catch (err) {
    console.error("[research-os] cannot write config.js", err);
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f7f8fa",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.webContents.on("render-process-gone", () => app.quit());

  await win.loadURL(`${SCHEME}://research-os.local/index.html`);
  await initAutoUpdater(win);
  return win;
}

// ---------------------------------------------------------------- lifecycle

registerAppProtocol();

app.whenReady.then(() => {
  protocol.handle(SCHEME, (request) => {
    const file = resolveExportFile(new URL(request.url).pathname);
    return net.fetch(`file://${file.replaceAll("\\", "/")}`);
  });
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
