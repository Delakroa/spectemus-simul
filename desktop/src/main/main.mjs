import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireDesktopInstanceLock } from "./instance-lock.mjs";
import { DesktopMediaLibrary } from "./media-library.mjs";
import {
  DesktopMediaNormalizer,
  clearNormalizedMediaDirectory,
} from "./media-normalizer.mjs";
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
  probeMediaTools,
  resolveSidecarPaths,
} from "./sidecars.mjs";
import { createShutdownCoordinator } from "./shutdown.mjs";

let mainWindow;
let localGatewayOrigin;
let publicGatewayOrigin;
let startupPromise;
let normalizedMediaDirectory;
const mediaLibrary = new DesktopMediaLibrary();
const supervisor = new DesktopSupervisor({
  mediaResolver: (id) => mediaLibrary.resolveForPlayback(id),
});
const MAIN_DIRECTORY = join(fileURLToPath(new URL(".", import.meta.url)));

supervisor.subscribe((status) => {
  sendToMainWindow("spectemus:runtime-status", status);
});

const shutdownCoordinator = createShutdownCoordinator({
  clearMedia: () => mediaLibrary.clear(),
  quit: () => app.quit(),
  stopSupervisor: () => supervisor.stop(),
});

const isPrimaryInstance = acquireDesktopInstanceLock(app, focusMainWindow);

if (isPrimaryInstance) {
  app.whenReady().then(async () => {
    normalizedMediaDirectory = join(
      app.getPath("temp"),
      "spectemus-simul",
      "normalized-media",
    );
    // Подметаем ровно один раз за запуск приложения и до старта host.
    //
    // Раньше свип жил внутри startDesktopHost, и это давало два дефекта сразу.
    // Он выполнялся при каждом рестарте рантайма, включая кнопку «Перезапустить»,
    // и удалял копию, которую текущая сессия прямо сейчас отдаёт гостю — а
    // подготовка MKV занимает десятки минут. И он был недостижим, если раньше
    // падал выбор LAN-адреса или проверка сайдкаров, поэтому копия, оставшаяся
    // после аварийного завершения, могла пережить сколько угодно запусков.
    try {
      await clearNormalizedMediaDirectory(normalizedMediaDirectory);
    } catch (error) {
      console.error(
        `[media] не удалось подмести временные копии: ${error?.message ?? error}`,
      );
    }

    ipcMain.handle("spectemus:runtime-status", () => supervisor.status);
    ipcMain.handle("spectemus:pick-media-file", async () => {
      const options = {
        filters: [
          {
            extensions: [
              "mp4",
              "m4v",
              "webm",
              "mkv",
              "mov",
              "avi",
              "mpeg",
              "mpg",
              "ts",
              "m2ts",
              "wmv",
              "flv",
            ],
            name: "Видео",
          },
        ],
        properties: ["openFile"],
        title: "Выберите фильм для комнаты",
      };
      const window = activeMainWindow();
      const selection = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      if (selection.canceled || !selection.filePaths[0]) {
        return null;
      }
      return mediaLibrary.registerSource(selection.filePaths[0]);
    });
    ipcMain.handle("spectemus:normalize-media", async (_event, id) => {
      assertMediaId(id);
      return mediaLibrary.normalize(id, (progress) => {
        sendToMainWindow("spectemus:media-normalization-progress", {
          id,
          progress,
        });
      });
    });
    ipcMain.handle("spectemus:cancel-media-normalization", (_event, id) => {
      assertMediaId(id);
      mediaLibrary.cancel(id);
    });
    ipcMain.handle("spectemus:release-media", async (_event, id) => {
      assertMediaId(id);
      await mediaLibrary.release(id);
    });
    ipcMain.handle(
      "spectemus:public-invite-origin",
      () => publicGatewayOrigin ?? null,
    );
    ipcMain.handle("spectemus:restart-runtime", async () => {
      await waitForStartupToSettle();
      await supervisor.stop();
      await startDesktopHost(process.env.SPECTEMUS_LAN_IP);
      return supervisor.status;
    });
    ipcMain.handle("spectemus:select-lan-address", async (_event, address) => {
      if (typeof address !== "string") {
        throw new Error(
          "Для desktop host выберите private IPv4 домашней сети.",
        );
      }
      await waitForStartupToSettle();
      await supervisor.stop();
      await startDesktopHost(address);
      return supervisor.status;
    });
    mainWindow = createWindow();
    await startDesktopHost(process.env.SPECTEMUS_LAN_IP);
  });
}

async function startDesktopHost(preferredLanAddress) {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    localGatewayOrigin = undefined;
    publicGatewayOrigin = undefined;
    await showStartupPage({
      detail: "Проверяем локальный runtime…",
      state: "starting",
    });

    try {
      const lan = resolveLanAddress(undefined, preferredLanAddress);
      const runtimeDirectory = join(app.getPath("userData"), "runtime");
      const sidecarLogDirectory = join(app.getPath("userData"), "logs");
      await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
      const paths = resolveSidecarPaths({
        packaged: app.isPackaged,
        platform: process.platform,
        resourcesPath: process.resourcesPath,
      });
      await assertDesktopResources(paths, {
        requireMediaTools: app.isPackaged,
      });
      const mediaTools = await probeMediaTools(paths);
      mediaLibrary.normalizer = mediaTools.available
        ? new DesktopMediaNormalizer({
            ffmpegPath: paths.ffmpeg,
            ffprobePath: paths.ffprobe,
            logDirectory: sidecarLogDirectory,
            outputDirectory: normalizedMediaDirectory,
          })
        : null;
      // Причина недоступности объясняет разницу между «сборка без ffmpeg» и «ffmpeg на
      // месте, но не стартует»: без неё дефект уходит не в ту подсистему.
      mediaLibrary.normalizerUnavailableReason = mediaTools.reason ?? null;
      if (!mediaTools.available) {
        console.error(`[media] нормализатор недоступен: ${mediaTools.reason}`);
      }
      const secrets = await loadOrCreateInstallationSecrets(
        join(runtimeDirectory, "installation-secrets.json"),
      );
      await writeLiveKitConfig(
        join(runtimeDirectory, "livekit.yaml"),
        DEFAULT_PORTS,
      );
      const { url } = await supervisor.start({
        feedbackStoragePath: join(runtimeDirectory, "feedback-reports.json"),
        lanAddress: lan.address,
        logDirectory: sidecarLogDirectory,
        paths,
        runtimeDirectory,
        secrets,
      });
      const publicUrl = new URL(url);
      publicGatewayOrigin = publicUrl.origin;
      const localUrl = new URL(publicUrl);
      localUrl.hostname = "127.0.0.1";
      localGatewayOrigin = localUrl.origin;
      const window = activeMainWindow();
      if (window) {
        await window.loadURL(localUrl.toString());
      }
    } catch (error) {
      if (
        error instanceof LanAddressSelectionRequired &&
        !preferredLanAddress
      ) {
        await showLanAddressSelection(error.candidates);
        return;
      }
      await showStartupPage({
        detail: startupErrorMessage(error),
        state: "error",
      });
    }
  })();

  try {
    await startupPromise;
  } finally {
    startupPromise = undefined;
  }
}

async function waitForStartupToSettle() {
  const pendingStartup = startupPromise;
  if (pendingStartup) {
    await pendingStartup;
  }
}

if (isPrimaryInstance) {
  app.on("before-quit", (event) => {
    shutdownCoordinator.handleBeforeQuit(event);
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}

function focusMainWindow() {
  const window = activeMainWindow();
  if (!window) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

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
    if (!isLocalGatewayUrl(targetUrl)) {
      event.preventDefault();
    }
  });
  window.once("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  return window;
}

function activeMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return undefined;
  }
  return mainWindow;
}

function sendToMainWindow(channel, payload) {
  const window = activeMainWindow();
  if (!window) {
    return;
  }
  try {
    window.webContents.send(channel, payload);
  } catch {
    // Window destruction must not interrupt runtime cleanup.
  }
}

function isLocalGatewayUrl(targetUrl) {
  if (!localGatewayOrigin) {
    return false;
  }
  try {
    return new URL(targetUrl).origin === localGatewayOrigin;
  } catch {
    return false;
  }
}

async function showStartupPage({ detail, state }) {
  const color = state === "error" ? "#c43d37" : "#16875d";
  const safeDetail = escapeHtml(detail);
  const retryAction =
    state === "error"
      ? `<button id="restart" type="button" style="margin-top:24px;border:0;border-radius:8px;padding:11px 16px;background:#17191c;color:#fff;font:inherit;font-weight:700;cursor:pointer">Запустить host заново</button>`
      : "";
  const script =
    state === "error"
      ? `<script>document.getElementById("restart").addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; button.textContent = "Запускаем…"; try { await window.spectemusDesktop.restartRuntime(); } catch { button.disabled = false; button.textContent = "Запустить host заново"; } });</script>`
      : "";
  await loadDesktopPage(
    `<main style="max-width:520px;padding:48px;text-align:center"><div style="width:12px;height:12px;margin:0 auto 20px;border-radius:50%;background:${color};box-shadow:0 0 0 7px ${color}22"></div><h1 style="margin:0 0 12px;font-size:28px">Spectemus Simul</h1><p style="margin:0;color:#60676f;line-height:1.5">${safeDetail}</p>${retryAction}</main>${script}`,
  );
}

async function showLanAddressSelection(candidates) {
  const choices = candidates
    .map(
      (candidate) =>
        `<button type="button" data-lan-address="${escapeHtml(candidate.address)}" style="display:block;width:100%;margin-top:10px;border:1px solid #ccd2d8;border-radius:8px;padding:14px 16px;background:#fff;color:#17191c;text-align:left;font:inherit;cursor:pointer"><strong>${escapeHtml(candidate.interfaceName)}</strong><span style="display:block;margin-top:4px;color:#60676f">${escapeHtml(candidate.address)}</span></button>`,
    )
    .join("");
  const script = `<script>for (const button of document.querySelectorAll("[data-lan-address]")) { button.addEventListener("click", async (event) => { const selected = event.currentTarget; for (const item of document.querySelectorAll("[data-lan-address]")) item.disabled = true; selected.textContent = "Запускаем…"; try { await window.spectemusDesktop.selectLanAddress(selected.dataset.lanAddress); } catch { for (const item of document.querySelectorAll("[data-lan-address]")) item.disabled = false; selected.textContent = selected.dataset.lanAddress; } }); }</script>`;
  await loadDesktopPage(
    `<main style="max-width:520px;padding:48px;text-align:center"><div style="width:12px;height:12px;margin:0 auto 20px;border-radius:50%;background:#16875d;box-shadow:0 0 0 7px #16875d22"></div><h1 style="margin:0 0 12px;font-size:28px">Выберите домашнюю сеть</h1><p style="margin:0;color:#60676f;line-height:1.5">Гости в этой сети будут открывать invite-ссылку. VPN и виртуальные сети уже исключены.</p><div style="margin-top:20px">${choices}</div></main>${script}`,
  );
}

async function loadDesktopPage(content) {
  const window = activeMainWindow();
  if (!window) {
    return;
  }
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Spectemus Simul</title><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f7f8;color:#17191c;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">${content}</body></html>`)}`,
  );
}

function startupErrorMessage(error) {
  if (error instanceof LanAddressSelectionRequired) {
    return "Не удалось выбрать домашнюю сеть для desktop host.";
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

function assertMediaId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Некорректный идентификатор выбранного файла.");
  }
}
