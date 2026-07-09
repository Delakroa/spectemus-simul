import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import WebSocket from "ws";

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

function connectRoomEvents(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        Cookie: cookie,
        Origin: appUrl,
      },
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket snapshot timed out"));
    }, 5_000);

    socket.once("message", (data, isBinary) => {
      clearTimeout(timeout);
      if (isBinary) {
        socket.terminate();
        reject(new Error("room WebSocket returned binary snapshot"));
        return;
      }

      try {
        resolve({ socket, event: JSON.parse(data.toString("utf8")) });
      } catch (error) {
        socket.terminate();
        reject(error);
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForWebSocketClose(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket close timed out"));
    }, 5_000);

    socket.once("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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

const joinUrl = `${appUrl}/api/v1/rooms/${roomId}/join`;
const joinedGuest = await postJson(joinUrl, {
  displayName: "Infra Smoke Guest",
});

if (joinedGuest.status !== 200) {
  throw new Error(`join room returned HTTP ${joinedGuest.status}`);
}

const guestSessionCookie = joinedGuest.headers.get("set-cookie") ?? "";
const guestCookie = guestSessionCookie.split(";", 1)[0];
const guestParticipantId = joinedGuest.body.participant?.participantId;

if (
  !guestSessionCookie.includes("HttpOnly") ||
  !guestSessionCookie.includes("SameSite=Strict") ||
  !/^wt_session=[A-Za-z0-9_-]{43}$/.test(guestCookie)
) {
  throw new Error("join room returned unsafe session cookie");
}
if (
  joinedGuest.body.participant?.role !== "GUEST" ||
  joinedGuest.body.room?.participants?.length !== 2 ||
  joinedGuest.body.room?.roomVersion !== 1
) {
  throw new Error("join room returned invalid participant or room state");
}

const replayedGuest = await postJson(
  joinUrl,
  { displayName: "Infra Smoke Guest" },
  { Cookie: guestCookie },
);

if (replayedGuest.status !== 200) {
  throw new Error(`repeated join returned HTTP ${replayedGuest.status}`);
}
if (
  replayedGuest.body.participant?.participantId !== guestParticipantId ||
  replayedGuest.body.room?.participants?.length !== 2 ||
  replayedGuest.body.room?.roomVersion !== 1
) {
  throw new Error("repeated join created a duplicate participant");
}

for (const displayName of ["Infra Smoke Guest 2", "Infra Smoke Guest 3"]) {
  const response = await postJson(joinUrl, { displayName });
  if (response.status !== 200) {
    throw new Error(
      `join room while filling capacity returned HTTP ${response.status}`,
    );
  }
}

const fullRoomResponse = await postJson(joinUrl, {
  displayName: "Infra Smoke Guest 4",
});
if (
  fullRoomResponse.status !== 409 ||
  fullRoomResponse.body.code !== "ROOM_FULL"
) {
  throw new Error("full room did not return 409 ROOM_FULL");
}

const unavailableRoomResponse = await postJson(
  `${appUrl}/api/v1/rooms/0000000000000000000000/join`,
  { displayName: "Infra Smoke Guest" },
);
if (
  unavailableRoomResponse.status !== 404 ||
  unavailableRoomResponse.body.code !== "ROOM_UNAVAILABLE"
) {
  throw new Error("missing room did not return 404 ROOM_UNAVAILABLE");
}

console.log("[ok] guest join through proxy: joined");
console.log("[ok] guest join session replay: restored");
console.log("[ok] room capacity: enforced");
console.log("[ok] unavailable room: hidden");

const eventsUrl = new URL(`/api/v1/rooms/${roomId}/events`, appUrl);
eventsUrl.protocol = eventsUrl.protocol === "https:" ? "wss:" : "ws:";

const firstEventsConnection = await connectRoomEvents(eventsUrl, guestCookie);
const firstSnapshot = firstEventsConnection.event;

if (
  firstSnapshot.schemaVersion !== 1 ||
  !/^[0-9a-f-]{36}$/.test(firstSnapshot.eventId) ||
  firstSnapshot.type !== "room.snapshot" ||
  firstSnapshot.roomId !== roomId ||
  firstSnapshot.participantId !== null ||
  firstSnapshot.roomVersion !== 3 ||
  firstSnapshot.payload?.roomId !== roomId ||
  firstSnapshot.payload?.participants?.length !== 4 ||
  firstSnapshot.payload?.roomVersion !== 3
) {
  firstEventsConnection.socket.terminate();
  throw new Error("room WebSocket returned invalid initial snapshot");
}
firstEventsConnection.socket.close(1000, "smoke reconnect");

const reconnect = await connectRoomEvents(eventsUrl, guestCookie);
if (
  reconnect.event.type !== "room.snapshot" ||
  reconnect.event.eventId === firstSnapshot.eventId ||
  reconnect.event.roomVersion !== firstSnapshot.roomVersion
) {
  reconnect.socket.terminate();
  throw new Error("room WebSocket reconnect returned invalid snapshot");
}
reconnect.socket.close(1000, "smoke complete");

const unknownCommandConnection = await connectRoomEvents(
  eventsUrl,
  guestCookie,
);
const unknownCommandClose = waitForWebSocketClose(
  unknownCommandConnection.socket,
);
unknownCommandConnection.socket.send(
  JSON.stringify({
    schemaVersion: 1,
    eventId: randomUUID(),
    type: "participant.future.command",
  }),
);
if ((await unknownCommandClose) !== 1007) {
  throw new Error("unknown WebSocket client command was not rejected");
}

console.log("[ok] room WebSocket snapshot: received");
console.log("[ok] room WebSocket reconnect: refreshed");
console.log("[ok] unknown WebSocket client command: rejected");

const livekit = await get(livekitUrl);
assertIncludes(livekit.body.toLowerCase(), "ok", "livekit");
console.log(`[ok] LiveKit HTTP/WebSocket endpoint: ${livekitUrl}`);
