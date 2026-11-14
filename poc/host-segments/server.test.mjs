import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { startPoc } from "./server.mjs";

async function session(t) {
  const directory = await mkdtemp(join(tmpdir(), "spectemus-segment-test-"));
  const mediaPath = join(directory, "test.mp4");
  await writeFile(mediaPath, Buffer.alloc(100_000, 7));
  const value = await startPoc({ mediaPath, manifest: { size: 100_000 } });
  t.after(async () => {
    await value.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return value;
}
function token(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("key");
}
async function socket(
  value,
  role,
  key = token(role === "host" ? value.hostUrl : value.guestUrl),
) {
  const peer = new WebSocket(`${value.origin.replace("http:", "ws:")}/signal`, {
    origin: value.origin,
  });
  peer.on("error", () => {});
  await once(peer, "open");
  peer.send(JSON.stringify({ type: "auth", role, key }));
  return peer;
}
test("media is host-only, range bounded and no path is exposed", async (t) => {
  const value = await session(t);
  assert.equal(
    (await fetch(`${value.origin}/media`, { headers: { Range: "bytes=0-9" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await fetch(`${value.origin}/manifest`, {
        headers: { Authorization: `Bearer ${token(value.guestUrl)}` },
      })
    ).status,
    403,
  );
  const headers = {
    Authorization: `Bearer ${token(value.hostUrl)}`,
    Range: "bytes=0-9",
  };
  const response = await fetch(`${value.origin}/media`, { headers });
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  headers.Range = "bytes=0-99999";
  assert.equal((await fetch(`${value.origin}/media`, { headers })).status, 416);
  headers.Range = "bytes=99999-100000";
  assert.equal((await fetch(`${value.origin}/media`, { headers })).status, 416);
});
test("DNS rebinding Host and external websocket Origin are rejected", async (t) => {
  const value = await session(t);
  const status = await new Promise((resolve, reject) => {
    get(value.origin, { headers: { Host: "attacker.invalid" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).once("error", reject);
  });
  assert.equal(status, 403);
  const peer = new WebSocket(`${value.origin.replace("http:", "ws:")}/signal`, {
    origin: "https://attacker.invalid",
  });
  const [error] = await once(peer, "error");
  assert.match(error.message, /403/);
});
test("invalid Unicode capability fails closed without killing local server", async (t) => {
  const value = await session(t);
  const peer = await socket(value, "host", "я".repeat(43));
  const [code] = await once(peer, "close");
  assert.equal(code, 1008);
  assert.equal((await fetch(value.origin)).status, 200);
});
test("null JSON is rejected without an unhandled websocket exception", async (t) => {
  const value = await session(t);
  const peer = new WebSocket(`${value.origin.replace("http:", "ws:")}/signal`, {
    origin: value.origin,
  });
  peer.on("error", () => {});
  await once(peer, "open");
  const closed = once(peer, "close");
  peer.send("null");
  assert.equal((await closed)[0], 1008);
  assert.equal((await fetch(value.origin)).status, 200);
});
test("signaling only carries bounded role-correct SDP; host disconnect terminates guest", async (t) => {
  const value = await session(t);
  const host = await socket(value, "host");
  const hostPaired = once(host, "message");
  const guest = await socket(value, "guest");
  await hostPaired; // Не передаём байты фильма через signaling.
  const offer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("offer timeout")), 2_000);
    guest.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "sdp") {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  host.send(
    JSON.stringify({
      type: "sdp",
      description: { type: "offer", sdp: "fixture-sdp" },
    }),
  );
  assert.equal((await offer).description.sdp, "fixture-sdp");
  const closed = once(guest, "close");
  host.close();
  await closed;
  assert.equal(
    (
      await fetch(`${value.origin}/manifest`, {
        headers: { Authorization: `Bearer ${token(value.hostUrl)}` },
      })
    ).status,
    403,
  );
});
test("a capability cannot turn signaling into an unlimited media relay", async (t) => {
  const value = await session(t);
  const host = await socket(value, "host");
  const paired = once(host, "message");
  await socket(value, "guest");
  await paired;
  const closed = once(host, "close");
  const message = JSON.stringify({
    type: "sdp",
    description: { type: "offer", sdp: "fixture-sdp" },
  });
  host.send(message);
  host.send(message);
  assert.equal((await closed)[0], 1008);
});
