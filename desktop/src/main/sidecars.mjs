import { spawn, spawnSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { access, constants } from "node:fs/promises";
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

export async function hasMediaTools(paths) {
  try {
    if (paths.ffmpeg.includes("/") || paths.ffmpeg.includes("\\")) {
      await access(paths.ffmpeg, constants.X_OK);
    }
    if (paths.ffprobe.includes("/") || paths.ffprobe.includes("\\")) {
      await access(paths.ffprobe, constants.X_OK);
    }
    const ffmpeg = spawnSync(paths.ffmpeg, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const ffprobe = spawnSync(paths.ffprobe, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return (
      !ffmpeg.error &&
      ffmpeg.status === 0 &&
      !ffprobe.error &&
      ffprobe.status === 0
    );
  } catch {
    return false;
  }
}

export class DesktopSupervisor {
  constructor({
    gatewayFactory = startGateway,
    spawnProcess = spawn,
    waitForHealthy = waitForHealthyHttp,
    waitForLiveKitReady = waitForLiveKitTcpReady,
    assertPortsAvailable = assertDesktopPortsAvailable,
    mediaResolver,
  } = {}) {
    this.gatewayFactory = gatewayFactory;
    this.spawnProcess = spawnProcess;
    this.waitForHealthy = waitForHealthy;
    this.waitForLiveKitReady = waitForLiveKitReady;
    this.assertPortsAvailable = assertPortsAvailable;
    this.mediaResolver = mediaResolver;
    this.status = { state: "stopped", detail: "Host не запущен." };
    this.listeners = new Set();
    this.children = [];
    this.stopPromise = undefined;
    this.failureDetail = undefined;
    this.runtimeDirectory = undefined;
    this.ownedSidecars = [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  async start({
    lanAddress,
    paths,
    ports = DEFAULT_PORTS,
    runtimeDirectory,
    secrets,
  }) {
    if (this.status.state !== "stopped" && this.status.state !== "error") {
      throw new Error("Desktop host уже запускается или работает.");
    }

    this.failureDetail = undefined;
    try {
      this.runtimeDirectory = runtimeDirectory;
      await recoverOwnedSidecars({ runtimeDirectory });
      this.setStatus(
        "checking-ports",
        "Проверяем, что порты desktop host свободны.",
      );
      await this.assertPortsAvailable(ports);
      this.setStatus("starting-backend", "Запускаем локальный backend.");
      const backend = this.spawnBackend({ lanAddress, paths, ports, secrets });
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
      const livekit = this.spawnLiveKit({
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
      this.gateway = gateway.instance;
      this.assertStartupIsActive();

      const url = `http://${lanAddress}:${gateway.port}`;
      this.setStatus("running", `Host готов: ${url}`, { lanAddress, url });
      return { url };
    } catch (error) {
      await this.stop();
      this.setStatus(
        "error",
        error instanceof Error ? error.message : "Desktop host не запустился.",
      );
      throw error;
    }
  }

  async stop() {
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

  spawnBackend({ lanAddress, paths, ports, secrets }) {
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
          LIVEKIT_API_KEY: secrets.livekitApiKey,
          LIVEKIT_API_SECRET: secrets.livekitApiSecret,
          LIVEKIT_URL: `ws://${lanAddress}:${ports.livekitHttp}`,
          LIVEKIT_URL_FROM_REQUEST: "true",
          SESSION_COOKIE_SECURE: "false",
          SPRING_PROFILES_ACTIVE: "desktop",
        },
        stdio: "ignore",
        windowsHide: true,
      },
    );
  }

  spawnLiveKit({ lanAddress, paths, ports, runtimeDirectory, secrets }) {
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
        stdio: "ignore",
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
      listener(this.status);
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
  if (child.exitCode !== null) {
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
        if (!killed && child.exitCode === null) {
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
      if (!killed && child.exitCode === null) {
        finish(() =>
          rejectStop(new Error("Не удалось остановить локальный сервис.")),
        );
      }
    } catch (error) {
      finish(() => rejectStop(error));
    }
  });
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
