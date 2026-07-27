import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import test from "node:test";

import {
  DEFAULT_PORTS,
  DesktopSupervisor,
  resolveSidecarPaths,
  startGatewayWithFallback,
  waitForLiveKitTcpReady,
} from "./sidecars.mjs";

test("desktop sidecars используют loopback backend и LAN LiveKit без Redis", () => {
  const invocations = [];
  const supervisor = new DesktopSupervisor({
    spawnProcess: (...argumentsList) => {
      invocations.push(argumentsList);
      const child = new EventEmitter();
      child.exitCode = null;
      child.kill = () => true;
      return child;
    },
  });
  const paths = {
    backendJar: "/tmp/backend.jar",
    javaCommand: "/tmp/java",
    livekitServer: "/tmp/livekit-server",
  };
  const secrets = { livekitApiKey: "key", livekitApiSecret: "secret" };

  supervisor.spawnBackend({
    lanAddress: "192.168.1.42",
    paths,
    ports: DEFAULT_PORTS,
    secrets,
  });
  supervisor.spawnLiveKit({
    lanAddress: "192.168.1.42",
    paths,
    ports: DEFAULT_PORTS,
    runtimeDirectory: "/tmp/runtime",
    secrets,
  });

  const [backend, livekit] = invocations;
  assert.deepEqual(backend[1].slice(0, 3), [
    "-jar",
    "/tmp/backend.jar",
    "--spring.profiles.active=desktop",
  ]);
  assert.equal(backend[2].env.LIVEKIT_URL, "ws://192.168.1.42:7880");
  assert.equal(backend[2].env.SPRING_PROFILES_ACTIVE, "desktop");
  assert.equal(backend[2].env.REDIS_HOST, undefined);
  assert.deepEqual(livekit[1].slice(-4), [
    "--bind",
    "0.0.0.0",
    "--node-ip",
    "192.168.1.42",
  ]);
  assert.equal(livekit[2].env.LIVEKIT_KEYS, "key: secret");
});

test("разрешает developer override и ожидает packaged sidecars в resources", () => {
  const development = resolveSidecarPaths({
    environment: { SPECTEMUS_LIVEKIT_SERVER: "livekit-server" },
    packaged: false,
    platform: "darwin",
    resourcesPath: "/unused",
  });
  assert.equal(development.livekitServer, "livekit-server");
  assert.match(
    development.backendJar,
    /backend\/build\/libs\/spectemus-simul-backend\.jar$/,
  );

  const packaged = resolveSidecarPaths({
    environment: {},
    packaged: true,
    platform: "win32",
    resourcesPath: "C:\\Spectemus\\resources",
  });
  assert.match(packaged.livekitServer, /livekit-server\.exe$/);
  assert.match(packaged.javaCommand, /java\.exe$/);
});

test("готовность LiveKit проверяется подключением к signal-порту", async () => {
  const server = createServer();
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  try {
    const address = server.address();
    await waitForLiveKitTcpReady(
      { host: "127.0.0.1", port: address.port },
      { timeoutMs: 50, intervalMs: 5 },
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test("gateway сохраняет 8088, а при занятом порте выбирает свободный", async () => {
  const attempts = [];
  const gatewayFactory = async ({ port }) => {
    attempts.push(port);
    if (attempts.length === 1) {
      const error = new Error("address already in use");
      error.code = "EADDRINUSE";
      throw error;
    }
    return { close: async () => {}, port: 41_217 };
  };

  const gateway = await startGatewayWithFallback(gatewayFactory, {
    backend: { host: "127.0.0.1", port: 8080 },
    frontendDirectory: "/tmp/frontend",
    port: 8088,
  });

  assert.deepEqual(attempts, [8088, 0]);
  assert.equal(gateway.port, 41_217);
});

test("gateway не скрывает ошибки, кроме занятого порта", async () => {
  const unavailable = new Error("frontend не найден");
  await assert.rejects(
    () =>
      startGatewayWithFallback(
        async () => {
          throw unavailable;
        },
        {
          backend: { host: "127.0.0.1", port: 8080 },
          frontendDirectory: "/tmp/frontend",
          port: 8088,
        },
      ),
    unavailable,
  );
});

test("не запускает sidecars, если их фиксированный порт занят", async () => {
  let spawned = 0;
  const supervisor = new DesktopSupervisor({
    assertPortsAvailable: async () => {
      throw new Error(
        "Backend: порт 8080 уже занят. Остановите другую копию Spectemus Simul или локальный Docker/dev stack и запустите host снова.",
      );
    },
    spawnProcess: () => {
      spawned += 1;
      throw new Error("sidecar не должен запускаться");
    },
  });

  await assert.rejects(
    () =>
      supervisor.start({
        lanAddress: "192.168.1.42",
        paths: {},
        runtimeDirectory: "/tmp/runtime",
        secrets: { livekitApiKey: "key", livekitApiSecret: "secret" },
      }),
    /Backend: порт 8080 уже занят/,
  );
  assert.equal(spawned, 0);
  assert.match(supervisor.status.detail, /Backend: порт 8080 уже занят/);
});

test("аварийный выход sidecar останавливает gateway и оставшиеся процессы", async () => {
  const children = [];
  let closedGateway = 0;
  const supervisor = new DesktopSupervisor({
    assertPortsAvailable: async () => {},
    gatewayFactory: async () => ({
      close: async () => {
        closedGateway += 1;
      },
      port: 8088,
    }),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.exitCode = 0;
        queueMicrotask(() => child.emit("exit", 0, "SIGTERM"));
        return true;
      };
      children.push(child);
      return child;
    },
    waitForHealthy: async () => {},
    waitForLiveKitReady: async () => {},
  });

  await supervisor.start({
    lanAddress: "192.168.1.42",
    paths: {
      backendJar: "/tmp/backend.jar",
      frontendDirectory: "/tmp/frontend",
      javaCommand: "/tmp/java",
      livekitServer: "/tmp/livekit-server",
    },
    runtimeDirectory: "/tmp/runtime",
    secrets: { livekitApiKey: "key", livekitApiSecret: "secret" },
  });

  const [backend, livekit] = children;
  livekit.exitCode = 1;
  livekit.emit("exit", 1, null);

  await waitFor(() => supervisor.status.state === "error");
  assert.match(supervisor.status.detail, /LiveKit завершился неожиданно/);
  assert.equal(closedGateway, 1);
  assert.equal(backend.killed, true);
});

test("stop не оставляет sidecars, если gateway вернул ошибку при закрытии", async () => {
  const children = [];
  const supervisor = new DesktopSupervisor({
    assertPortsAvailable: async () => {},
    gatewayFactory: async () => ({
      close: async () => {
        throw new Error("gateway close failed");
      },
      port: 8088,
    }),
    spawnProcess: () => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.killed = false;
      child.kill = () => {
        child.killed = true;
        child.exitCode = 0;
        queueMicrotask(() => child.emit("exit", 0, "SIGTERM"));
        return true;
      };
      children.push(child);
      return child;
    },
    waitForHealthy: async () => {},
    waitForLiveKitReady: async () => {},
  });

  await supervisor.start({
    lanAddress: "192.168.1.42",
    paths: {
      backendJar: "/tmp/backend.jar",
      frontendDirectory: "/tmp/frontend",
      javaCommand: "/tmp/java",
      livekitServer: "/tmp/livekit-server",
    },
    runtimeDirectory: "/tmp/runtime",
    secrets: { livekitApiKey: "key", livekitApiSecret: "secret" },
  });
  await supervisor.stop();

  assert.equal(supervisor.status.state, "stopped");
  assert.match(supervisor.status.detail, /часть локальных сервисов/);
  assert.deepEqual(
    children.map((child) => child.killed),
    [true, true],
  );
});

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Ожидаемое состояние supervisor не наступило.");
}
