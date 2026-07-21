import { spawn, spawnSync } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startGateway } from "./gateway.mjs";

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
  return {
    backendJar:
      environment.SPECTEMUS_BACKEND_JAR ??
      (packaged
        ? resolve(packagedRoot, "backend", "watch-together-backend.jar")
        : resolve(
            PROJECT_ROOT,
            "backend",
            "build",
            "libs",
            "backend-0.1.0-SNAPSHOT.jar",
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
  };
}

export async function assertDesktopResources(paths) {
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
}

export class DesktopSupervisor {
  constructor({
    gatewayFactory = startGateway,
    spawnProcess = spawn,
    waitForHealthy = waitForHealthyHttp,
  } = {}) {
    this.gatewayFactory = gatewayFactory;
    this.spawnProcess = spawnProcess;
    this.waitForHealthy = waitForHealthy;
    this.status = { state: "stopped", detail: "Host не запущен." };
    this.listeners = new Set();
    this.children = [];
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

    try {
      this.setStatus("starting-backend", "Запускаем локальный backend.");
      const backend = this.spawnBackend({ lanAddress, paths, ports, secrets });
      this.trackChild(backend, "Backend");
      await waitForChildReadiness(backend, "Backend", () =>
        this.waitForHealthy(
          `http://127.0.0.1:${ports.backend}/actuator/health`,
        ),
      );

      this.setStatus("starting-livekit", "Запускаем локальный media server.");
      const livekit = this.spawnLiveKit({
        lanAddress,
        paths,
        ports,
        runtimeDirectory,
        secrets,
      });
      this.trackChild(livekit, "LiveKit");
      await waitForChildReadiness(livekit, "LiveKit", () =>
        this.waitForHealthy(`http://127.0.0.1:${ports.livekitHttp}/`),
      );

      this.setStatus("starting-gateway", "Открываем LAN gateway.");
      this.gateway = await this.gatewayFactory({
        backend: { host: "127.0.0.1", port: ports.backend },
        frontendDirectory: paths.frontendDirectory,
        port: ports.gateway,
      });

      const url = `http://${lanAddress}:${ports.gateway}`;
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
    if (this.status.state === "stopped") {
      return;
    }
    this.setStatus("stopping", "Останавливаем локальные сервисы.");
    if (this.gateway) {
      await this.gateway.close();
      this.gateway = undefined;
    }
    await Promise.all(this.children.splice(0).reverse().map(stopChild));
    this.setStatus("stopped", "Host остановлен.");
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
      this.setStatus("error", `${name} не удалось запустить: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      if (this.status.state !== "stopping" && this.status.state !== "stopped") {
        this.setStatus(
          "error",
          `${name} завершился неожиданно (${signal ?? `код ${code ?? "unknown"}`}).`,
        );
      }
    });
  }

  setStatus(state, detail, additional = {}) {
    this.status = { state, detail, ...additional };
    for (const listener of this.listeners) {
      listener(this.status);
    }
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

function stopChild(child) {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
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
