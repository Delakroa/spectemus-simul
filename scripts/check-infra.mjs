import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const composeFile = "infra/compose.yaml";
const appUrl = process.env.WT_APP_URL ?? "http://127.0.0.1:8088";
const livekitUrl = process.env.WT_LIVEKIT_HTTP_URL ?? "http://127.0.0.1:7880";

function runCompose(args) {
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `docker compose ${args.join(" ")} failed`,
    );
  }

  return result.stdout.trim();
}

async function get(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain, text/html" },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(
      `${label} response does not include ${JSON.stringify(expected)}`,
    );
  }
}

const services = ["postgres", "redis", "livekit", "backend", "gateway"];

for (const service of services) {
  const containerId = runCompose(["ps", "-q", service]);

  if (!containerId) {
    throw new Error(`${service} container is not running`);
  }

  const health = spawnSync(
    "docker",
    [
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
      containerId,
    ],
    { encoding: "utf8" },
  );

  if (health.status !== 0 || health.stdout.trim() !== "healthy") {
    throw new Error(
      `${service} is not healthy: ${health.stdout.trim() || health.stderr.trim()}`,
    );
  }

  console.log(`[ok] ${service}: healthy`);
}

const page = await get(appUrl);
assertIncludes(page.contentType, "text/html", "frontend");
assertIncludes(page.body, '<div id="root"></div>', "frontend");
console.log(`[ok] frontend: ${appUrl}`);

const gateway = await get(`${appUrl}/gateway-health`);
assertIncludes(gateway.body, "ok", "gateway");
console.log("[ok] reverse proxy: ok");

const backend = await get(`${appUrl}/api/v1/health`);
assertIncludes(backend.body, '"status":"UP"', "backend");
console.log("[ok] backend through proxy: UP");

const version = await get(`${appUrl}/api/v1/version`);
assertIncludes(version.body, '"apiVersion":"v1"', "version");
console.log("[ok] backend version through proxy: v1");

const idempotencyKey = `infra-smoke-${randomUUID()}`;
const createRoomRequest = { hostDisplayName: "Infra Smoke Host" };
const createdRoom = await postJson(
  `${appUrl}/api/v1/rooms`,
  createRoomRequest,
  {
    "Idempotency-Key": idempotencyKey,
  },
);

if (createdRoom.status !== 201) {
  throw new Error(`create room returned HTTP ${createdRoom.status}`);
}

const replayedRoom = await postJson(
  `${appUrl}/api/v1/rooms`,
  createRoomRequest,
  {
    "Idempotency-Key": idempotencyKey,
  },
);

if (replayedRoom.status !== 201) {
  throw new Error(
    `idempotent create room returned HTTP ${replayedRoom.status}`,
  );
}

const roomId = createdRoom.body.room?.roomId;
const hostSecret = createdRoom.body.hostSecret;
const invitePath = createdRoom.body.invitePath;
const sessionCookie = createdRoom.headers.get("set-cookie") ?? "";

if (!/^[A-Za-z0-9_-]{22}$/.test(roomId)) {
  throw new Error("create room returned invalid roomId");
}
if (!/^[A-Za-z0-9_-]{43}$/.test(hostSecret)) {
  throw new Error("create room returned invalid hostSecret");
}
if (invitePath !== `/rooms/${roomId}` || invitePath.includes(hostSecret)) {
  throw new Error("create room returned unsafe invitePath");
}
if (
  !sessionCookie.includes("HttpOnly") ||
  !sessionCookie.includes("SameSite=Strict")
) {
  throw new Error("create room returned unsafe session cookie");
}
if (JSON.stringify(createdRoom.body) !== JSON.stringify(replayedRoom.body)) {
  throw new Error("idempotent create room returned a different response");
}

console.log("[ok] create room through proxy: created");
console.log("[ok] create room idempotency: replayed");

const livekit = await get(livekitUrl);
assertIncludes(livekit.body.toLowerCase(), "ok", "livekit");
console.log(`[ok] LiveKit HTTP/WebSocket endpoint: ${livekitUrl}`);
