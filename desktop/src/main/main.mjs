import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LanAddressSelectionRequired,
  resolveLanAddress,
} from "./lan-address.mjs";
import {
  loadOrCreateInstallationSecrets,
  writeLiveKitConfig,
} from "./runtime.mjs";
import {
  DEFAULT_PORTS,
  DesktopSupervisor,
  assertDesktopResources,
  resolveSidecarPaths,
} from "./sidecars.mjs";

let mainWindow;
let allowQuit = false;
const supervisor = new DesktopSupervisor();
const MAIN_DIRECTORY = join(fileURLToPath(new URL(".", import.meta.url)));

supervisor.subscribe((status) => {
  mainWindow?.webContents.send("spectemus:runtime-status", status);
});

app.whenReady().then(async () => {
  ipcMain.handle("spectemus:runtime-status", () => supervisor.status);
  mainWindow = createWindow();
  await showStartupPage({
    detail: "Проверяем локальный runtime…",
    state: "starting",
  });

  try {
    const lan = resolveLanAddress(undefined, process.env.SPECTEMUS_LAN_IP);
    const runtimeDirectory = join(app.getPath("userData"), "runtime");
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
    const paths = resolveSidecarPaths({
      packaged: app.isPackaged,
      platform: process.platform,
      resourcesPath: process.resourcesPath,
    });
    await assertDesktopResources(paths);
    const secrets = await loadOrCreateInstallationSecrets(
      join(runtimeDirectory, "installation-secrets.json"),
    );
    await writeLiveKitConfig(
      join(runtimeDirectory, "livekit.yaml"),
      DEFAULT_PORTS,
    );
    const { url } = await supervisor.start({
      lanAddress: lan.address,
      paths,
      runtimeDirectory,
      secrets,
    });
    await mainWindow.loadURL(url.replace(lan.address, "127.0.0.1"));
  } catch (error) {
    await showStartupPage({
      detail: startupErrorMessage(error),
      state: "error",
    });
  }
});

app.on("before-quit", (event) => {
  if (allowQuit) {
    return;
  }
  event.preventDefault();
  allowQuit = true;
  void supervisor.stop().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  app.quit();
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: true,
    title: "Spectemus Simul",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(MAIN_DIRECTORY, "preload.cjs"),
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith("http://127.0.0.1:8088/")) {
      event.preventDefault();
    }
  });
  return window;
}

async function showStartupPage({ detail, state }) {
  const color = state === "error" ? "#c43d37" : "#16875d";
  const safeDetail = escapeHtml(detail);
  await mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Spectemus Simul</title><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f7f8;color:#17191c;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><main style="max-width:520px;padding:48px;text-align:center"><div style="width:12px;height:12px;margin:0 auto 20px;border-radius:50%;background:${color};box-shadow:0 0 0 7px ${color}22"></div><h1 style="margin:0 0 12px;font-size:28px">Spectemus Simul</h1><p style="margin:0;color:#60676f;line-height:1.5">${safeDetail}</p></main></body></html>`)}`,
  );
}

function startupErrorMessage(error) {
  if (error instanceof LanAddressSelectionRequired) {
    const choices = error.candidates
      .map((candidate) => `${candidate.interfaceName}: ${candidate.address}`)
      .join(", ");
    return `Найдено несколько домашних сетей (${choices}). Перезапустите с SPECTEMUS_LAN_IP, выбрав одну из них.`;
  }
  return error instanceof Error
    ? error.message
    : "Desktop host не удалось запустить.";
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
