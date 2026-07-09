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

async function postEmpty(url, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(5_000),
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
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

function waitForJsonMessage(socket, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`${label} timed out`));
    }, 5_000);

    socket.once("message", (data, isBinary) => {
      clearTimeout(timeout);
      if (isBinary) {
        socket.terminate();
        reject(new Error(`${label} returned binary message`));
        return;
      }

      try {
        resolve(JSON.parse(data.toString("utf8")));
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

function waitForJsonMessageMatching(socket, predicate, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error(`${label} timed out`));
    }, 5_000);

    function cleanup() {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    }

    function onMessage(data, isBinary) {
      if (isBinary) {
        cleanup();
        socket.terminate();
        reject(new Error(`${label} returned binary message`));
        return;
      }

      let event;
      try {
        event = JSON.parse(data.toString("utf8"));
      } catch (error) {
        cleanup();
        socket.terminate();
        reject(error);
        return;
      }

      if (predicate(event)) {
        cleanup();
        resolve(event);
      }
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on("message", onMessage);
    socket.once("error", onError);
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

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
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
const hostCookie = sessionCookie.split(";", 1)[0];

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
  !sessionCookie.includes("SameSite=Strict") ||
  !/^wt_session=[A-Za-z0-9_-]{43}$/.test(hostCookie)
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

const hostEventsConnection = await connectRoomEvents(eventsUrl, hostCookie);
if (
  hostEventsConnection.event.type !== "room.snapshot" ||
  hostEventsConnection.event.payload?.roomId !== roomId
) {
  hostEventsConnection.socket.terminate();
  throw new Error("host room WebSocket returned invalid initial snapshot");
}

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
  hostEventsConnection.socket.terminate();
  firstEventsConnection.socket.terminate();
  throw new Error("room WebSocket returned invalid initial snapshot");
}

const reconnect = await connectRoomEvents(eventsUrl, guestCookie);
if (
  reconnect.event.type !== "room.snapshot" ||
  reconnect.event.eventId === firstSnapshot.eventId ||
  reconnect.event.roomVersion !== firstSnapshot.roomVersion
) {
  hostEventsConnection.socket.terminate();
  reconnect.socket.terminate();
  throw new Error("room WebSocket reconnect returned invalid snapshot");
}
reconnect.socket.send(
  JSON.stringify({
    schemaVersion: 1,
    eventId: randomUUID(),
    type: "participant.heartbeat",
    roomId,
    participantId: guestParticipantId,
    expectedRoomVersion: reconnect.event.roomVersion,
    occurredAt: new Date().toISOString(),
    payload: {
      sentAt: new Date().toISOString(),
    },
  }),
);
await delay(250);
if (reconnect.socket.readyState !== WebSocket.OPEN) {
  hostEventsConnection.socket.terminate();
  throw new Error("room WebSocket heartbeat was rejected");
}

reconnect.socket.close(1000, "smoke offline");
const offlineEvent = await waitForJsonMessage(
  hostEventsConnection.socket,
  "participant offline event",
);
if (
  offlineEvent.type !== "participant.offline" ||
  offlineEvent.participantId !== guestParticipantId ||
  offlineEvent.payload?.participantId !== guestParticipantId ||
  offlineEvent.payload?.online !== false
) {
  hostEventsConnection.socket.terminate();
  throw new Error("participant offline event was not broadcast");
}

const onlineReconnect = await connectRoomEvents(eventsUrl, guestCookie);
const onlineEvent = await waitForJsonMessage(
  hostEventsConnection.socket,
  "participant online event",
);
if (
  onlineReconnect.event.type !== "room.snapshot" ||
  onlineReconnect.event.roomVersion <= offlineEvent.roomVersion ||
  onlineEvent.type !== "participant.online" ||
  onlineEvent.participantId !== guestParticipantId ||
  onlineEvent.payload?.participantId !== guestParticipantId ||
  onlineEvent.payload?.online !== true ||
  onlineEvent.roomVersion !== onlineReconnect.event.roomVersion
) {
  hostEventsConnection.socket.terminate();
  onlineReconnect.socket.terminate();
  throw new Error("participant online reconnect event was not broadcast");
}
onlineReconnect.socket.close(1000, "smoke complete");
hostEventsConnection.socket.close(1000, "smoke complete");

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

const leavingGuestConnection = await connectRoomEvents(eventsUrl, guestCookie);
if (leavingGuestConnection.event.type !== "room.snapshot") {
  leavingGuestConnection.socket.terminate();
  throw new Error("guest leave WebSocket returned invalid initial snapshot");
}
const leftHostEventsConnection = await connectRoomEvents(eventsUrl, hostCookie);
if (leftHostEventsConnection.event.type !== "room.snapshot") {
  leftHostEventsConnection.socket.terminate();
  leavingGuestConnection.socket.terminate();
  throw new Error("host leave WebSocket returned invalid initial snapshot");
}
const leftEventPromise = waitForJsonMessageMatching(
  leftHostEventsConnection.socket,
  (event) => event.type === "participant.left",
  "participant left event",
);
const leavingGuestLeftEventPromise = waitForJsonMessageMatching(
  leavingGuestConnection.socket,
  (event) => event.type === "participant.left",
  "participant left self event",
);
const leavingGuestClosePromise = waitForWebSocketClose(
  leavingGuestConnection.socket,
);
const leaveRoom = await postEmpty(`${appUrl}/api/v1/rooms/${roomId}/leave`, {
  Cookie: guestCookie,
});
if (leaveRoom.status !== 204 || leaveRoom.body !== "") {
  leftHostEventsConnection.socket.terminate();
  leavingGuestConnection.socket.terminate();
  throw new Error(`leave room returned HTTP ${leaveRoom.status}`);
}
const leftEvent = await leftEventPromise;
const leavingGuestLeftEvent = await leavingGuestLeftEventPromise;
if (
  leftEvent.type !== "participant.left" ||
  leftEvent.roomId !== roomId ||
  leftEvent.participantId !== guestParticipantId ||
  leftEvent.payload?.participantId !== guestParticipantId ||
  leftEvent.payload?.reason !== "LEFT" ||
  leavingGuestLeftEvent.type !== "participant.left" ||
  leavingGuestLeftEvent.participantId !== guestParticipantId ||
  leavingGuestLeftEvent.payload?.reason !== "LEFT"
) {
  leftHostEventsConnection.socket.terminate();
  leavingGuestConnection.socket.terminate();
  throw new Error("participant left event was not broadcast");
}
if ((await leavingGuestClosePromise) !== 1000) {
  leftHostEventsConnection.socket.terminate();
  throw new Error("participant leave did not close leaving WebSocket normally");
}
if (leftHostEventsConnection.socket.readyState !== WebSocket.OPEN) {
  throw new Error("participant leave closed non-leaving host WebSocket");
}
leftHostEventsConnection.socket.close(1000, "smoke complete");

const replacementGuest = await postJson(joinUrl, {
  displayName: "Infra Smoke Replacement Guest",
});
if (
  replacementGuest.status !== 200 ||
  replacementGuest.body.participant?.role !== "GUEST" ||
  replacementGuest.body.room?.participants?.length !== 4
) {
  throw new Error("explicit leave did not free room capacity");
}

const closeEventsConnection = await connectRoomEvents(eventsUrl, hostCookie);
if (closeEventsConnection.event.type !== "room.snapshot") {
  closeEventsConnection.socket.terminate();
  throw new Error("host close WebSocket returned invalid initial snapshot");
}
const closeEventPromise = waitForJsonMessage(
  closeEventsConnection.socket,
  "room closed event",
);
const closeCodePromise = waitForWebSocketClose(closeEventsConnection.socket);
const closeRoom = await postEmpty(`${appUrl}/api/v1/rooms/${roomId}/close`, {
  Cookie: hostCookie,
  "X-Host-Secret": hostSecret,
});
if (closeRoom.status !== 204 || closeRoom.body !== "") {
  closeEventsConnection.socket.terminate();
  throw new Error(`close room returned HTTP ${closeRoom.status}`);
}
const closedEvent = await closeEventPromise;
if (
  closedEvent.type !== "room.closed" ||
  closedEvent.roomId !== roomId ||
  closedEvent.participantId !== null ||
  closedEvent.payload?.reason !== "HOST_CLOSED" ||
  !closedEvent.payload?.closedAt
) {
  closeEventsConnection.socket.terminate();
  throw new Error("room close event was not broadcast");
}
if ((await closeCodePromise) !== 1000) {
  throw new Error(
    "room close did not close active WebSocket sessions normally",
  );
}

const joinClosedRoom = await postJson(joinUrl, {
  displayName: "Late Guest",
});
if (
  joinClosedRoom.status !== 404 ||
  joinClosedRoom.body.code !== "ROOM_UNAVAILABLE"
) {
  throw new Error("closed room did not reject join with ROOM_UNAVAILABLE");
}

console.log("[ok] room WebSocket snapshot: received");
console.log("[ok] room WebSocket reconnect: refreshed");
console.log("[ok] room WebSocket heartbeat: accepted");
console.log("[ok] room WebSocket presence: broadcast");
console.log("[ok] unknown WebSocket client command: rejected");
console.log("[ok] leave room through proxy: left");
console.log("[ok] room WebSocket participant left: broadcast");
console.log("[ok] room capacity after leave: freed");
console.log("[ok] close room through proxy: closed");
console.log("[ok] room WebSocket close event: broadcast");

const livekit = await get(livekitUrl);
assertIncludes(livekit.body.toLowerCase(), "ok", "livekit");
console.log(`[ok] LiveKit HTTP/WebSocket endpoint: ${livekitUrl}`);
