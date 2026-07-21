import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  DEFAULT_PORTS,
  DesktopSupervisor,
  resolveSidecarPaths,
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
