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
    throw new Error(`unexpected ${url}`);
  };

  const controller = createDeviceBindingController({
    userDataPath,
    fetchImpl,
    openExternal: async (url) => opened.push(url),
    safeStorageImpl,
  });

  const started = await controller.start({
    apiOrigin: "https://app.example.test",
  });
  assert.equal(started.userCode, "ABCD-EFGH");
  assert.equal(Object.hasOwn(started, "deviceCode"), false);
  await controller.openVerification(started.verificationUri);
  assert.deepEqual(opened, [
    "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
  ]);
  await assert.rejects(() =>
    controller.openVerification("https://evil.example.test/internet/link"),
  );

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

  await controller.clear({ revokeRemote: false });
  assert.equal((await controller.status()).bound, false);
  await rm(userDataPath, { recursive: true, force: true });
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
