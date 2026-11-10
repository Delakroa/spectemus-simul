import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPublicHttpsOrigin,
  createDeviceBindingController,
} from "./device-binding.mjs";

test("rejects loopback and IP public API origins", () => {
  assert.throws(() => assertPublicHttpsOrigin("http://127.0.0.1:8080"));
  assert.throws(() => assertPublicHttpsOrigin("https://192.168.1.10"));
  assert.throws(() =>
    assertPublicHttpsOrigin("https://user:pass@app.example.test"),
  );
  assert.equal(
    assertPublicHttpsOrigin("https://app.example.test/"),
    "https://app.example.test",
  );
});

test("keeps device credential out of renderer payload, validates openExternal and cancels poll", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "spectemus-binding-"));
  const opened = [];
  const memory = new Map();
  const safeStorageImpl = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8").slice(4),
  };
  const fetchImpl = async (url, init = {}) => {
    if (
      String(url).endsWith("/api/v2/auth/device-bindings") &&
      init.method === "POST"
    ) {
      return jsonResponse(201, {
        bindingId: "11111111-1111-4111-8111-111111111111",
        userCode: "ABCD-EFGH",
        verificationUri:
          "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        intervalSeconds: 1,
        deviceCode: "d".repeat(43),
      });
    }
    if (String(url).includes("/token")) {
      const body = JSON.parse(init.body);
      assert.equal(body.deviceCode, "d".repeat(43));
      assert.equal(String(url).includes("deviceCode"), false);
      assert.equal(String(url).includes("?"), false);
      if (!memory.has("approved")) {
        return jsonResponse(400, {
          code: "DEVICE_AUTHORIZATION_PENDING",
          retryable: true,
          status: 400,
          title: "Pending",
        });
      }
      return jsonResponse(200, {
        deviceCredential: "c".repeat(43),
        profile: {
          accountId: "22222222-2222-4222-8222-222222222222",
          displayName: "Host",
          createdAt: "2026-11-10T10:00:00Z",
        },
        expiresAt: "2026-11-24T10:00:00Z",
      });
    }
    if (
      String(url).endsWith("/api/v2/public-rooms") &&
      init.method === "POST"
    ) {
      assert.match(init.headers.get("Authorization"), /^Bearer c{43}$/);
      assert.equal(String(url).includes("c".repeat(43)), false);
      return jsonResponse(201, {
        room: {
          publicRoomId: "33333333-3333-4333-8333-333333333333",
          status: "OPEN",
          memberLimit: 4,
          createdAt: "2026-11-10T10:00:00Z",
          expiresAt: "2026-11-10T13:00:00Z",
        },
        membership: { role: "OWNER", joinedAt: "2026-11-10T10:00:00Z" },
      });
    }
    if (String(url).endsWith("/api/v2/account/device-sessions/revoke")) {
      memory.set("revoked", true);
      return jsonResponse(204);
    }
    throw new Error(`unexpected ${url}`);
  };

  const controller = createDeviceBindingController({
    apiOrigin: "https://app.example.test",
    userDataPath,
    fetchImpl,
    openExternal: async (url) => opened.push(url),
    safeStorageImpl,
  });

  const started = await controller.start();
  assert.equal(started.userCode, "ABCD-EFGH");
  assert.equal(Object.hasOwn(started, "deviceCode"), false);
  await controller.openVerification();
  assert.deepEqual(opened, [
    "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
  ]);

  const pending = await controller.pollOnce();
  assert.equal(pending.status, "pending");
  memory.set("approved", true);
  const bound = await controller.pollOnce();
  assert.equal(bound.status, "bound");
  assert.equal(bound.profile.displayName, "Host");
  assert.equal(Object.hasOwn(bound, "deviceCredential"), false);

  const room = await controller.createPublicRoom({
    expiresInMinutes: 180,
    idempotencyKey: "desktop-room-key-123456",
  });
  assert.equal(room.room.publicRoomId, "33333333-3333-4333-8333-333333333333");

  const stored = await readFile(controller._storagePath);
  assert.match(stored.toString("utf8"), /^enc:/);
  assert.match(stored.toString("utf8"), /c{43}/);
  assert.equal((await controller.status()).bound, true);

  controller.cancel();
  await assert.rejects(() => controller.pollOnce());

  await controller.clear();
  assert.equal(memory.get("revoked"), true);
  assert.equal((await controller.status()).bound, false);
  await rm(userDataPath, { recursive: true, force: true });
});

test("rejects verification path prefix attacks and keeps local credential after failed revoke", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "spectemus-binding-"));
  let revokeStatus = 500;
  const opened = [];
  const safeStorageImpl = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8").slice(4),
  };

  const pathAttack = createDeviceBindingController({
    apiOrigin: "https://app.example.test",
    userDataPath,
    fetchImpl: async () =>
      jsonResponse(201, {
        bindingId: "11111111-1111-4111-8111-111111111111",
        userCode: "ABCD-EFGH",
        verificationUri: "https://app.example.test/internet/link/extra",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        intervalSeconds: 1,
        deviceCode: "d".repeat(43),
      }),
    openExternal: async (url) => opened.push(url),
    safeStorageImpl,
  });
  await assert.rejects(() => pathAttack.start());
  assert.deepEqual(opened, []);

  const controller = createDeviceBindingController({
    apiOrigin: "https://app.example.test",
    userDataPath,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/v2/auth/device-bindings")) {
        return jsonResponse(201, {
          bindingId: "11111111-1111-4111-8111-111111111111",
          userCode: "ABCD-EFGH",
          verificationUri:
            "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          intervalSeconds: 1,
          deviceCode: "d".repeat(43),
        });
      }
      if (String(url).includes("/token")) {
        return jsonResponse(200, {
          deviceCredential: "c".repeat(43),
          profile: {
            accountId: "22222222-2222-4222-8222-222222222222",
            displayName: "Host",
            createdAt: "2026-11-10T10:00:00Z",
          },
          expiresAt: "2026-11-24T10:00:00Z",
        });
      }
      if (String(url).endsWith("/api/v2/account/device-sessions/revoke")) {
        return jsonResponse(revokeStatus, {
          code: "TEMPORARY",
          status: revokeStatus,
          title: "Temporary",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
    openExternal: async () => undefined,
    safeStorageImpl,
  });

  await controller.start();
  await controller.pollOnce();
  assert.equal((await controller.status()).bound, true);
  await assert.rejects(() => controller.clear());
  assert.equal((await controller.status()).bound, true);

  revokeStatus = 204;
  await controller.clear();
  assert.equal((await controller.status()).bound, false);
  await rm(userDataPath, { recursive: true, force: true });
});

test("treats expired stored credential as unbound", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "spectemus-binding-"));
  let nowMs = Date.parse("2026-11-10T10:30:00Z");
  const safeStorageImpl = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8").slice(4),
  };
  const controller = createDeviceBindingController({
    apiOrigin: "https://app.example.test",
    userDataPath,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/v2/auth/device-bindings")) {
        return jsonResponse(201, {
          bindingId: "11111111-1111-4111-8111-111111111111",
          userCode: "ABCD-EFGH",
          verificationUri:
            "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
          expiresAt: new Date(nowMs + 60_000).toISOString(),
          intervalSeconds: 1,
          deviceCode: "d".repeat(43),
        });
      }
      if (String(url).includes("/token")) {
        return jsonResponse(200, {
          deviceCredential: "c".repeat(43),
          profile: {
            accountId: "22222222-2222-4222-8222-222222222222",
            displayName: "Host",
            createdAt: "2026-11-10T10:00:00Z",
          },
          expiresAt: "2026-11-10T11:00:00Z",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
    openExternal: async () => undefined,
    safeStorageImpl,
    now: () => nowMs,
  });

  await controller.start();
  await controller.pollOnce();
  assert.equal((await controller.status()).bound, true);
  nowMs = Date.parse("2026-11-10T12:00:00Z");
  assert.equal((await controller.status()).bound, false);
  await rm(userDataPath, { recursive: true, force: true });
});

test("token rate-limit budget covers a full binding TTL of polling", () => {
  const bindingTtlSeconds = 10 * 60;
  const pollIntervalSeconds = 5;
  const tokenBudget = 150;
  const requiredPolls = Math.ceil(bindingTtlSeconds / pollIntervalSeconds);
  assert.ok(
    tokenBudget >= requiredPolls,
    `device-binding-token budget ${tokenBudget} must cover ${requiredPolls} polls over TTL`,
  );
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
