import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  DEFAULT_PORTS,
  DesktopSupervisor,
  resolveSidecarPaths,
  startGatewayWithFallback,
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
    /backend\/build\/libs\/backend-0\.1\.0-SNAPSHOT\.jar$/,
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
