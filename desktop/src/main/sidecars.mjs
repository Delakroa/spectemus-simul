import { spawn, spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { closeSync, openSync, statSync, truncateSync } from "node:fs";
import { access, constants, mkdir } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startGateway } from "./gateway.mjs";
import {
  clearOwnedSidecars,
  recoverOwnedSidecars,
  writeOwnedSidecars,
} from "./owned-processes.mjs";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const DEFAULT_PORTS = {
  backend: 8080,
  gateway: 8088,
  livekitHttp: 7880,
  livekitTcp: 7881,
  livekitUdpStart: 50000,
  livekitUdpEnd: 50100,
};

export function resolveSidecarPaths({
  environment = process.env,
  packaged,
  resourcesPath,
  platform,
}) {
  const livekitName =
    platform === "win32" ? "livekit-server.exe" : "livekit-server";
  const packagedRoot = resolve(resourcesPath, "sidecars");
  const developmentRoot = resolve(PROJECT_ROOT, "desktop", ".sidecars");
  const mediaDirectory = packaged
    ? resolve(packagedRoot, "media", "bin")
    : resolve(developmentRoot, "media", "bin");
  return {
    backendJar:
      environment.SPECTEMUS_BACKEND_JAR ??
      (packaged
        ? resolve(packagedRoot, "backend", "spectemus-simul-backend.jar")
        : resolve(
            PROJECT_ROOT,
            "backend",
            "build",
            "libs",
            "spectemus-simul-backend.jar",
          )),
    frontendDirectory:
      environment.SPECTEMUS_FRONTEND_DIST ??
      (packaged
        ? resolve(resourcesPath, "frontend")
        : resolve(PROJECT_ROOT, "frontend", "dist")),
    javaCommand:
      environment.SPECTEMUS_JAVA_COMMAND ??
      (packaged
        ? resolve(
            packagedRoot,
            "runtime",
            "bin",
            platform === "win32" ? "java.exe" : "java",
          )
        : "java"),
    livekitServer:
      environment.SPECTEMUS_LIVEKIT_SERVER ??
      (packaged
        ? resolve(packagedRoot, "livekit", livekitName)
        : resolve(developmentRoot, "livekit", livekitName)),
    ffmpeg:
      environment.SPECTEMUS_FFMPEG ??
      (packaged
        ? resolve(
            mediaDirectory,
            platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
          )
        : "ffmpeg"),
    ffprobe:
      environment.SPECTEMUS_FFPROBE ??
      (packaged
        ? resolve(
            mediaDirectory,
            platform === "win32" ? "ffprobe.exe" : "ffprobe",
          )
        : "ffprobe"),
  };
}

export async function assertDesktopResources(
  paths,
  { requireMediaTools = false } = {},
) {
  await assertReadable(paths.frontendDirectory, "Собранный React UI");
  await assertReadable(paths.backendJar, "Spring Boot backend jar");
  if (paths.javaCommand.includes("/") || paths.javaCommand.includes("\\")) {
    await assertExecutable(paths.javaCommand, "Java runtime");
  }
  assertJavaVersion(paths.javaCommand);
  if (paths.livekitServer.includes("/") || paths.livekitServer.includes("\\")) {
    await assertExecutable(
      paths.livekitServer,
      "LiveKit Server (для macOS developer proof укажите SPECTEMUS_LIVEKIT_SERVER после brew install livekit)",
    );
  }
  if (requireMediaTools) {
    await assertExecutable(paths.ffmpeg, "FFmpeg normalizer");
    await assertExecutable(paths.ffprobe, "FFprobe normalizer");
  }
}

/**
 * Проверяет media-сайдкары и ВОЗВРАЩАЕТ ПРИЧИНУ отказа. Раньше любой сбой сводился к
 * `false`, и интерфейс говорил «в этой сборке нет средства подготовки видео» — хотя
 * бинарник лежит на месте и просто не стартует (карантин Gatekeeper, отсутствующая
 * библиотека, слишком высокий deployment target). Из-за этого дефект уезжал не в ту
 * подсистему.
 *
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function probeMediaTools(paths) {
  for (const [label, binary] of [
    ["ffmpeg", paths.ffmpeg],
    ["ffprobe", paths.ffprobe],
  ]) {
    if (binary.includes("/") || binary.includes("\\")) {
      try {
        await access(binary, constants.X_OK);
      } catch (error) {
        return {
          available: false,
          reason: `${label} недоступен для запуска: ${binary} (${error?.code ?? "нет доступа"})`,
        };
      }
    }

    const probe = spawnSync(binary, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (probe.error) {
      return {
        available: false,
        reason: `${label} не запускается: ${probe.error.code ?? probe.error.message} (${binary})`,
      };
    }
    if (probe.signal) {
      return {
        available: false,
        // На macOS неподписанный или карантинный бинарник убивается сигналом.
        reason: `${label} остановлен системой по сигналу ${probe.signal}: возможен карантин или отсутствие подписи (${binary})`,
      };
    }
    if (probe.status !== 0) {
      const firstLine = String(probe.stderr ?? "")
        .split("\n")
        .find((line) => line.trim().length > 0);
      return {
        available: false,
        reason: `${label} завершился с кодом ${probe.status}${firstLine ? `: ${firstLine.trim()}` : ""}`,
      };
    }
  }

  return { available: true };
}

export async function hasMediaTools(paths) {
  return (await probeMediaTools(paths)).available;
}

const MAX_SIDECAR_LOG_BYTES = 8 * 1024 * 1024;

/**
 * Открывает файл лога сайдкара на дозапись. Раньше backend и LiveKit спавнились с
 * `stdio: "ignore"`, поэтому упавший прогон нельзя было превратить в тикет: на экране
 * оставалась единственная строка вида «LiveKit завершился неожиданно (код 1)».
 * Возвращает `null`, если каталог недоступен — отсутствие лога не должно мешать старту.
 */
export async function openSidecarLog(logDirectory, name) {
  try {
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });
    const logPath = join(logDirectory, `${name}.log`);
    try {
      if (statSync(logPath).size > MAX_SIDECAR_LOG_BYTES) {
        truncateSync(logPath, 0);
      }
    } catch {
      // Файла ещё нет — откроем его ниже.
    }
    return { fd: openSync(logPath, "a"), path: logPath };
  } catch {
    return null;
  }
}

function sidecarStdio(outputFd) {
  return outputFd === undefined || outputFd === null
    ? "ignore"
    : ["ignore", outputFd, outputFd];
}

export class DesktopSupervisor {
  constructor({
    gatewayFactory = startGateway,
    spawnProcess = spawn,
    waitForHealthy = waitForHealthyHttp,
    waitForLiveKitReady = waitForLiveKitTcpReady,
    assertPortsAvailable = assertDesktopPortsAvailable,
    recoverOwnedSidecars: recoverOwnedSidecarsFn = recoverOwnedSidecars,
    openSidecarLog: openSidecarLogFn = openSidecarLog,
    mediaResolver,
  } = {}) {
    this.gatewayFactory = gatewayFactory;
    this.spawnProcess = spawnProcess;
    this.waitForHealthy = waitForHealthy;
    this.waitForLiveKitReady = waitForLiveKitReady;
    this.assertPortsAvailable = assertPortsAvailable;
    this.recoverOwnedSidecars = recoverOwnedSidecarsFn;
    this.openSidecarLog = openSidecarLogFn;
    this.mediaResolver = mediaResolver;
    this.status = { state: "stopped", detail: "Host не запущен." };
    this.listeners = new Set();
    this.children = [];
    this.stopPromise = undefined;
    this.failureDetail = undefined;
    this.runtimeDirectory = undefined;
    this.ownedSidecars = [];
    this.startInterrupted = false;
    this.logDirectory = undefined;
    this.sidecarLogs = [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    this.notifyListener(listener);
    return () => this.listeners.delete(listener);
  }

  async start({
    feedbackStoragePath,
    lanAddress,
    logDirectory,
    paths,
    ports = DEFAULT_PORTS,
    runtimeDirectory,
    secrets,
  }) {
    if (this.status.state !== "stopped" && this.status.state !== "error") {
      throw new Error("Desktop host уже запускается или работает.");
    }

    this.failureDetail = undefined;
    this.startInterrupted = false;
    this.setStatus(
      "recovering",
      "Проверяем процессы от предыдущего запуска desktop host.",
    );
    try {
      this.runtimeDirectory = runtimeDirectory;
      this.logDirectory = logDirectory ?? join(runtimeDirectory, "logs");
      await this.recoverOwnedSidecars({ runtimeDirectory });
      this.assertStartupIsActive();
      this.setStatus(
        "checking-ports",
        "Проверяем, что порты desktop host свободны.",
      );
      await this.assertPortsAvailable(ports);
      this.assertStartupIsActive();
      this.setStatus("starting-backend", "Запускаем локальный backend.");
      const backendLog = await this.openSidecarLog(
        this.logDirectory,
        "backend",
      );
      this.sidecarLogs.push(backendLog);
      const backend = this.spawnBackend({
        feedbackStoragePath,
        lanAddress,
        outputFd: backendLog?.fd,
        paths,
        ports,
        secrets,
      });
      this.trackChild(backend, "Backend");
      await this.rememberOwnedSidecar({
        child: backend,
        commandIncludes: [paths.backendJar, `--server.port=${ports.backend}`],
        name: "Backend",
      });
      await waitForChildReadiness(backend, "Backend", () =>
        this.waitForHealthy(
          `http://127.0.0.1:${ports.backend}/actuator/health`,
        ),
      );
      this.assertStartupIsActive();

      this.setStatus("starting-livekit", "Запускаем локальный media server.");
      const livekitLog = await this.openSidecarLog(
        this.logDirectory,
        "livekit",
      );
      this.sidecarLogs.push(livekitLog);
      const livekit = this.spawnLiveKit({
        outputFd: livekitLog?.fd,
        lanAddress,
        paths,
        ports,
        runtimeDirectory,
        secrets,
      });
      this.trackChild(livekit, "LiveKit");
      await this.rememberOwnedSidecar({
        child: livekit,
        commandIncludes: [
          paths.livekitServer,
          join(runtimeDirectory, "livekit.yaml"),
        ],
        name: "LiveKit",
      });
      await waitForChildReadiness(livekit, "LiveKit", () =>
        this.waitForLiveKitReady({
          host: "127.0.0.1",
          port: ports.livekitHttp,
        }),
      );
      this.assertStartupIsActive();

      this.setStatus("starting-gateway", "Открываем LAN gateway.");
      const gateway = await startGatewayWithFallback(this.gatewayFactory, {
        backend: { host: "127.0.0.1", port: ports.backend },
        frontendDirectory: paths.frontendDirectory,
        mediaResolver: this.mediaResolver,
        port: ports.gateway,
      });
      try {
        this.assertStartupIsActive();
      } catch (error) {
        await gateway.instance.close().catch(() => {});
        throw error;
      }
      this.gateway = gateway.instance;

      const url = `http://${lanAddress}:${gateway.port}`;
      this.setStatus("running", `Host готов: ${url}`, { lanAddress, url });
      return { url };
    } catch (error) {
      const wasInterrupted = this.startInterrupted;
      if (wasInterrupted) {
        await this.stopPromise;
        if (this.failureDetail) {
          this.setStatus("error", this.failureDetail);
        }
      } else {
        await this.stop();
        this.setStatus(
          "error",
          error instanceof Error
            ? error.message
            : "Desktop host не запустился.",
        );
      }
      throw error;
    }
  }

  async stop() {
    this.startInterrupted = true;
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (this.status.state === "stopped") {
      return;
    }

    this.stopPromise = this.stopServices();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  spawnBackend({
    feedbackStoragePath,
    lanAddress,
    outputFd,
    paths,
    ports,
    secrets,
  }) {
    return this.spawnProcess(
      paths.javaCommand,
      [
        "-jar",
        paths.backendJar,
        "--spring.profiles.active=desktop",
        `--server.address=127.0.0.1`,
        `--server.port=${ports.backend}`,
      ],
      {
        env: {
          ...process.env,
          // Без токена operator-эндпоинты отвечают 403, и собранные за прогон отзывы
          // нечем прочитать; без пути они не переживают выход из приложения.
          FEEDBACK_ADMIN_TOKEN: secrets.feedbackAdminToken ?? "",
          FEEDBACK_STORAGE_PATH: feedbackStoragePath ?? "",
          LIVEKIT_API_KEY: secrets.livekitApiKey,
          LIVEKIT_API_SECRET: secrets.livekitApiSecret,
          LIVEKIT_URL: `ws://${lanAddress}:${ports.livekitHttp}`,
          LIVEKIT_URL_FROM_REQUEST: "true",
          SESSION_COOKIE_SECURE: "false",
          SPRING_PROFILES_ACTIVE: "desktop",
        },
        stdio: sidecarStdio(outputFd),
        windowsHide: true,
      },
    );
  }

  spawnLiveKit({
    lanAddress,
    outputFd,
    paths,
    ports,
    runtimeDirectory,
    secrets,
  }) {
    return this.spawnProcess(
      paths.livekitServer,
      [
        "--config",
        resolve(runtimeDirectory, "livekit.yaml"),
        "--bind",
        "0.0.0.0",
        "--node-ip",
        lanAddress,
      ],
      {
        env: {
          ...process.env,
          LIVEKIT_KEYS: `${secrets.livekitApiKey}: ${secrets.livekitApiSecret}`,
        },
        stdio: sidecarStdio(outputFd),
        windowsHide: true,
      },
    );
  }

  trackChild(child, name) {
    this.children.push(child);
    child.once("error", (error) => {
      this.handleUnexpectedFailure(
        `${name} не удалось запустить: ${error.message}`,
      );
    });
    child.once("exit", (code, signal) => {
      if (this.status.state !== "stopping" && this.status.state !== "stopped") {
        this.handleUnexpectedFailure(
          `${name} завершился неожиданно (${signal ?? `код ${code ?? "unknown"}`}).`,
        );
      }
    });
  }

  async rememberOwnedSidecar({ child, commandIncludes, name }) {
    if (
      !Number.isInteger(child.pid) ||
      child.pid <= 0 ||
      !this.runtimeDirectory
    )
      return;
    this.ownedSidecars.push({ pid: child.pid, name, commandIncludes });
    await writeOwnedSidecars({
      runtimeDirectory: this.runtimeDirectory,
      processes: this.ownedSidecars,
    });
  }

  setStatus(state, detail, additional = {}) {
    this.status = { state, detail, ...additional };
    for (const listener of this.listeners) {
      this.notifyListener(listener);
    }
  }

  notifyListener(listener) {
    try {
      listener(this.status);
    } catch {
      // A renderer subscriber must not interrupt sidecar lifecycle handling.
    }
  }

  assertStartupIsActive() {
    if (this.status.state === "stopping" || this.status.state === "stopped") {
      throw new Error(
        this.failureDetail ?? "Запуск desktop host был остановлен.",
      );
    }
    if (this.status.state === "error") {
      throw new Error(this.status.detail);
    }
  }

  handleUnexpectedFailure(detail) {
    if (
      this.status.state === "stopping" ||
      this.status.state === "stopped" ||
      this.status.state === "error"
    ) {
      return;
    }
    this.failureDetail = detail;
    this.setStatus("error", detail);
    void this.stop().then(() => {
      if (this.failureDetail === detail) {
        this.setStatus("error", detail);
      }
    });
  }

  async stopServices() {
    this.setStatus("stopping", "Останавливаем локальные сервисы.");
    const gateway = this.gateway;
    this.gateway = undefined;
    const children = this.children.splice(0).reverse();
    const results = await Promise.allSettled([
      ...(gateway ? [gateway.close()] : []),
      ...children.map(stopChild),
    ]);
    const cleanupFailed = results.some(
      (result) => result.status === "rejected",
    );
    if (!cleanupFailed && this.runtimeDirectory) {
      await clearOwnedSidecars(this.runtimeDirectory);
      this.ownedSidecars = [];
    }
    // Дескрипторы логов закрываем только после остановки детей: пока процесс жив, он
    // продолжает писать в них.
    for (const log of this.sidecarLogs.splice(0)) {
      if (typeof log?.fd !== "number") {
        continue;
      }
      try {
        closeSync(log.fd);
      } catch {
        // Дескриптор мог закрыться вместе с процессом.
      }
    }
    this.setStatus(
      "stopped",
      cleanupFailed
        ? "Host остановлен, но часть локальных сервисов потребовала принудительного завершения."
        : "Host остановлен.",
    );
  }
}

export async function assertDesktopPortsAvailable(ports) {
  await assertTcpPortAvailable("Backend", "127.0.0.1", ports.backend);
  await assertTcpPortAvailable(
    "LiveKit signalling",
    "0.0.0.0",
    ports.livekitHttp,
  );
  await assertTcpPortAvailable(
    "LiveKit TCP fallback",
    "0.0.0.0",
    ports.livekitTcp,
  );
  for (
    let port = ports.livekitUdpStart;
    port <= ports.livekitUdpEnd;
    port += 1
  ) {
    await assertUdpPortAvailable(port);
  }
}

async function assertTcpPortAvailable(service, host, port) {
  const server = createServer();
  let listening = false;
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(port, host, () => {
        server.off("error", rejectListen);
        listening = true;
        resolveListen();
      });
    });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        `${service}: порт ${port} уже занят. Остановите другую копию Spectemus Simul или локальный Docker/dev stack и запустите host снова.`,
      );
    }
    throw error;
  } finally {
    if (listening) {
      await closeProbe(server);
    }
  }
}

async function assertUdpPortAvailable(port) {
  const socket = createSocket("udp4");
  let bound = false;
  try {
    await new Promise((resolveBind, rejectBind) => {
      socket.once("error", rejectBind);
      socket.bind(port, "0.0.0.0", () => {
        socket.off("error", rejectBind);
        bound = true;
        resolveBind();
      });
    });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        `LiveKit UDP: порт ${port} уже занят. Остановите другую копию Spectemus Simul или локальный Docker/dev stack и запустите host снова.`,
      );
    }
    throw error;
  } finally {
    if (bound) {
      socket.close();
    }
  }
}

function closeProbe(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

export async function startGatewayWithFallback(gatewayFactory, options) {
  try {
    const gateway = await gatewayFactory(options);
    return { instance: gateway, port: resolveGatewayPort(gateway) };
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }

    const gateway = await gatewayFactory({ ...options, port: 0 });
    return { instance: gateway, port: resolveGatewayPort(gateway) };
  }
}

export async function waitForHealthyHttp(
  url,
  { timeoutMs = 60_000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  }
  throw new Error(
    `Сервис не стал доступен: ${url}${lastError ? ` (${lastError.message})` : ""}`,
  );
}

export async function waitForLiveKitTcpReady(
  { host, port },
  { timeoutMs = 60_000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await connectTcp({ host, port });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  }
  throw new Error(
    `LiveKit signal port не стал доступен: ${host}:${port}${lastError ? ` (${lastError.message})` : ""}`,
  );
}

function connectTcp({ host, port }) {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(1_500);
    socket.once("connect", () => {
      socket.end();
      resolveConnect();
    });
    socket.once("timeout", () => {
      socket.destroy();
      rejectConnect(new Error("TCP connection timeout"));
    });
    socket.once("error", rejectConnect);
  });
}

async function assertReadable(filePath, label) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(
      `${label} не найден: ${filePath}. Выполните pnpm desktop:prepare.`,
    );
  }
}

async function assertExecutable(filePath, label) {
  try {
    await access(filePath, constants.X_OK);
  } catch {
    throw new Error(`${label} не найден или не исполняемый: ${filePath}.`);
  }
}

function assertJavaVersion(javaCommand) {
  const probe = spawnSync(javaCommand, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.error) {
    throw new Error(
      `Не удалось запустить Java runtime: ${probe.error.message}`,
    );
  }
  const version = `${probe.stdout}\n${probe.stderr}`.match(
    /version "(\d+)/,
  )?.[1];
  if (!version || Number(version) < 25) {
    throw new Error(
      "Для desktop host нужен Java 25. Укажите SPECTEMUS_JAVA_COMMAND с bundled JRE 25; installer добавит его автоматически.",
    );
  }
}

export function stopChild(
  child,
  { forceKillWaitMs = 1_000, gracefulShutdownWaitMs = 5_000 } = {},
) {
  if (hasChildExited(child)) {
    return Promise.resolve();
  }
  return new Promise((resolveStop, rejectStop) => {
    let forceKillTimeout;
    let gracefulShutdownTimeout;
    let finished = false;

    const cleanup = () => {
      clearTimeout(forceKillTimeout);
      clearTimeout(gracefulShutdownTimeout);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (callback) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      callback();
    };
    const onExit = () => finish(resolveStop);
    const onError = (error) => finish(() => rejectStop(error));
    const forceKill = () => {
      try {
        const killed = child.kill("SIGKILL");
        if (!killed && !hasChildExited(child)) {
          finish(() =>
            rejectStop(
              new Error(
                "Не удалось принудительно остановить локальный сервис.",
              ),
            ),
          );
          return;
        }
      } catch (error) {
        finish(() => rejectStop(error));
        return;
      }

      forceKillTimeout = setTimeout(() => {
        finish(() =>
          rejectStop(
            new Error(
              "Локальный сервис не подтвердил завершение после принудительной остановки.",
            ),
          ),
        );
      }, forceKillWaitMs);
    };

    child.once("exit", onExit);
    child.once("error", onError);
    gracefulShutdownTimeout = setTimeout(forceKill, gracefulShutdownWaitMs);

    try {
      const killed = child.kill("SIGTERM");
      if (!killed && !hasChildExited(child)) {
        finish(() =>
          rejectStop(new Error("Не удалось остановить локальный сервис.")),
        );
      }
    } catch (error) {
      finish(() => rejectStop(error));
    }
  });
}

function hasChildExited(child) {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

function waitForChildReadiness(child, name, waitForHealthy) {
  return new Promise((resolveReady, rejectReady) => {
    const cleanup = () => {
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      rejectReady(new Error(`${name} не удалось запустить: ${error.message}`));
    };
    const onExit = (code, signal) => {
      cleanup();
      rejectReady(
        new Error(
          `${name} завершился (${signal ?? `код ${code ?? "unknown"}`}) до готовности.`,
        ),
      );
    };
    child.once("error", onError);
    child.once("exit", onExit);
    void waitForHealthy().then(
      () => {
        cleanup();
        resolveReady();
      },
      (error) => {
        cleanup();
        rejectReady(error);
      },
    );
  });
}

function isAddressInUse(error) {
  return (
    typeof error === "object" && error !== null && error.code === "EADDRINUSE"
  );
}

function resolveGatewayPort(gateway) {
  if (
    !Number.isInteger(gateway?.port) ||
    gateway.port < 1 ||
    gateway.port > 65_535
  ) {
    throw new Error("Gateway не вернул корректный TCP-порт.");
  }
  return gateway.port;
}
