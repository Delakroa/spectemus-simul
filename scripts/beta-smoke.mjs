import { randomUUID } from "node:crypto";

import WebSocket from "ws";

const baseUrl = normalizeBaseUrl(
  process.env.WT_BETA_BASE_URL ??
    process.env.WT_APP_URL ??
    "http://127.0.0.1:8088",
);
const expectedLiveKitUrl = process.env.WT_BETA_LIVEKIT_URL;
const requireHsts =
  process.env.WT_BETA_REQUIRE_HSTS === "true" ||
  (baseUrl.protocol === "https:" &&
    process.env.WT_BETA_REQUIRE_HSTS !== "false");
const allowRemoteHttp = process.env.WT_BETA_ALLOW_REMOTE_HTTP === "true";

if (
  baseUrl.protocol !== "https:" &&
  !isLocalhost(baseUrl) &&
  !allowRemoteHttp
) {
  throw new Error(
    "Remote beta smoke requires HTTPS. Set WT_BETA_ALLOW_REMOTE_HTTP=true only for a temporary internal test.",
  );
}

const roomIdPattern = /^[A-Za-z0-9_-]{22}$/;
const credentialPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f-]{36}$/;

const page = await getText("/");
assertIncludes(page.contentType, "text/html", "frontend content-type");
assertIncludes(page.body, '<div id="root"></div>', "frontend shell");
assertSecurityHeaders(page.headers);
console.log(`[ok] frontend shell: ${baseUrl.href}`);

const gateway = await getText("/gateway-health");
assertIncludes(gateway.body, "ok", "gateway health");
console.log("[ok] gateway health: ok");

const health = await getJson("/api/v1/health");
if (health.body.status !== "UP") {
  throw new Error(`backend health is not UP: ${JSON.stringify(health.body)}`);
}
console.log("[ok] backend health: UP");

const version = await getJson("/api/v1/version");
if (version.body.apiVersion !== "v1") {
  throw new Error(
    `backend API version is not v1: ${JSON.stringify(version.body)}`,
  );
}
console.log(
  `[ok] backend version: ${version.body.applicationVersion ?? "unknown"}`,
);

const idempotencyKey = `beta-smoke-${randomUUID()}`;
const createRoomRequest = { hostDisplayName: "Beta Smoke Host" };
const createdRoom = await postJson("/api/v1/rooms", createRoomRequest, {
  "Idempotency-Key": idempotencyKey,
});
if (createdRoom.status !== 201) {
  throw new Error(`create room returned HTTP ${createdRoom.status}`);
}

const replayedRoom = await postJson("/api/v1/rooms", createRoomRequest, {
  "Idempotency-Key": idempotencyKey,
});
if (
  replayedRoom.status !== 201 ||
  JSON.stringify(createdRoom.body) !== JSON.stringify(replayedRoom.body)
) {
  throw new Error(
    "idempotent create room did not replay the original response",
  );
}

const roomId = createdRoom.body.room?.roomId;
const hostParticipantId = createdRoom.body.room?.hostParticipantId;
const hostSecret = createdRoom.body.hostSecret;
const invitePath = createdRoom.body.invitePath;
const hostCookieHeader = createdRoom.headers.get("set-cookie") ?? "";
const hostCookie = sessionCookie(hostCookieHeader, "host create room");

if (!roomIdPattern.test(roomId)) {
  throw new Error("create room returned invalid roomId");
}
if (!uuidPattern.test(hostParticipantId)) {
  throw new Error("create room returned invalid host participant id");
}
if (!credentialPattern.test(hostSecret)) {
  throw new Error("create room returned invalid hostSecret");
}
if (invitePath !== `/rooms/${roomId}` || invitePath.includes(hostSecret)) {
  throw new Error("create room returned unsafe invitePath");
}
assertSessionCookie(hostCookieHeader, "host session cookie");
console.log("[ok] create room: created and idempotent");

const acceptedFeedback = await postJson("/api/v1/feedback", {
  outcome: "WORKED",
  reason: "SUCCESS",
  message: "beta smoke",
  roomId,
  participantRole: "HOST",
  metadata: {
    userAgent: "beta-smoke",
    language: "en",
    roomStatus: createdRoom.body.room?.status,
    roomConnectionStatus: "smoke",
    liveKitStatus: "smoke",
    participantCount: createdRoom.body.room?.participants?.length,
  },
});
if (
  acceptedFeedback.status !== 202 ||
  !uuidPattern.test(acceptedFeedback.body.feedbackId) ||
  !uuidPattern.test(acceptedFeedback.body.correlationId)
) {
  throw new Error("feedback endpoint returned invalid receipt");
}
console.log("[ok] feedback endpoint: accepted");

const joinPath = `/api/v1/rooms/${roomId}/join`;
const joinedGuest = await postJson(joinPath, {
  displayName: "Beta Smoke Guest",
});
if (joinedGuest.status !== 200) {
  throw new Error(`join room returned HTTP ${joinedGuest.status}`);
}

const guestCookieHeader = joinedGuest.headers.get("set-cookie") ?? "";
const guestCookie = sessionCookie(guestCookieHeader, "guest join room");
const guestParticipantId = joinedGuest.body.participant?.participantId;

assertSessionCookie(guestCookieHeader, "guest session cookie");
if (
  joinedGuest.body.participant?.role !== "GUEST" ||
  !uuidPattern.test(guestParticipantId) ||
  joinedGuest.body.room?.participants?.length !== 2
) {
  throw new Error("join room returned invalid guest state");
}
console.log("[ok] guest join: joined");

const restoredHost = await getJson(`/api/v1/rooms/${roomId}`, {
  Cookie: hostCookie,
});
if (
  restoredHost.status !== 200 ||
  restoredHost.body.participant?.role !== "HOST" ||
  restoredHost.body.room?.roomId !== roomId
) {
  throw new Error("host restore returned invalid room state");
}

const restoredGuest = await getJson(`/api/v1/rooms/${roomId}`, {
  Cookie: guestCookie,
});
if (
  restoredGuest.status !== 200 ||
  restoredGuest.body.participant?.participantId !== guestParticipantId ||
  restoredGuest.body.participant?.role !== "GUEST"
) {
  throw new Error("guest restore returned invalid room state");
}
console.log("[ok] room restore: host and guest restored");

const hostToken = await postJson(
  `/api/v1/rooms/${roomId}/livekit-token`,
  undefined,
  { Cookie: hostCookie },
);
assertLiveKitToken(hostToken, {
  role: "HOST",
  participantId: hostParticipantId,
  canPublish: true,
  canPublishData: true,
});

const guestToken = await postJson(
  `/api/v1/rooms/${roomId}/livekit-token`,
  undefined,
  { Cookie: guestCookie },
);
assertLiveKitToken(guestToken, {
  role: "GUEST",
  participantId: guestParticipantId,
  canPublish: true,
  canPublishData: false,
});
console.log("[ok] LiveKit tokens: host and guest grants valid");

const eventsUrl = new URL(`/api/v1/rooms/${roomId}/events`, baseUrl);
eventsUrl.protocol = eventsUrl.protocol === "https:" ? "wss:" : "ws:";
const eventsConnection = await connectRoomEvents(eventsUrl, hostCookie);
if (
  eventsConnection.event.type !== "room.snapshot" ||
  eventsConnection.event.roomId !== roomId ||
  eventsConnection.event.payload?.roomId !== roomId ||
  eventsConnection.event.payload?.participants?.length !== 2
) {
  eventsConnection.socket.terminate();
  throw new Error("room WebSocket returned invalid snapshot");
}
eventsConnection.socket.close(1000, "beta smoke complete");
console.log("[ok] room WebSocket: snapshot received");

const closedRoom = await postEmpty(`/api/v1/rooms/${roomId}/close`, {
  Cookie: hostCookie,
  "X-Host-Secret": hostSecret,
});
if (closedRoom.status !== 204 || closedRoom.body !== "") {
  throw new Error(`close room returned HTTP ${closedRoom.status}`);
}

const joinClosedRoom = await postJson(joinPath, { displayName: "Late Guest" });
if (
  joinClosedRoom.status !== 404 ||
  joinClosedRoom.body.code !== "ROOM_UNAVAILABLE"
) {
  throw new Error("closed room did not reject join with ROOM_UNAVAILABLE");
}
console.log("[ok] close room: closed and unavailable");
console.log("[ok] beta smoke passed");

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function isLocalhost(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function resolvePath(path) {
  return new URL(path, baseUrl).toString();
}

async function getText(path) {
  const response = await fetch(resolvePath(path), {
    headers: { Accept: "application/json, text/plain, text/html" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  return {
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
    headers: response.headers,
  };
}

async function getJson(path, headers = {}) {
  const response = await fetch(resolvePath(path), {
    headers: {
      Accept: "application/json",
      ...headers,
    },
    signal: AbortSignal.timeout(10_000),
  });

  return {
    body: await readJsonResponse(response, `GET ${path}`),
    headers: response.headers,
    status: response.status,
  };
}

async function postJson(path, body, headers = {}) {
  const response = await fetch(resolvePath(path), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  return {
    body: await readJsonResponse(response, `POST ${path}`),
    headers: response.headers,
    status: response.status,
  };
}

async function postEmpty(path, headers = {}) {
  const response = await fetch(resolvePath(path), {
    headers: {
      Accept: "application/json",
      ...headers,
    },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });

  return {
    body: await response.text(),
    headers: response.headers,
    status: response.status,
  };
}

async function readJsonResponse(response, label) {
  const body = await response.text();
  if (!body) {
    throw new Error(
      `${label} returned empty response body (HTTP ${response.status})`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `${label} returned non-JSON response body (HTTP ${response.status}): ${body.slice(0, 240)}`,
      { cause: error },
    );
  }
}

function assertSecurityHeaders(headers) {
  const required = {
    "content-security-policy": "default-src",
    "permissions-policy": "microphone",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };

  for (const [header, expected] of Object.entries(required)) {
    const value = headers.get(header) ?? "";
    if (!value.includes(expected)) {
      throw new Error(
        `${header} header is missing ${JSON.stringify(expected)}`,
      );
    }
  }

  if (requireHsts) {
    const hsts = headers.get("strict-transport-security") ?? "";
    if (!hsts.toLowerCase().includes("max-age=")) {
      throw new Error(
        "strict-transport-security header is required for HTTPS beta",
      );
    }
  }
}

function assertSessionCookie(setCookie, label) {
  if (
    !setCookie.includes("HttpOnly") ||
    !setCookie.includes("SameSite=Strict") ||
    !credentialPattern.test(
      sessionCookie(setCookie, label).replace("wt_session=", ""),
    )
  ) {
    throw new Error(`${label} is missing secure session attributes`);
  }

  if (baseUrl.protocol === "https:" && !setCookie.includes("Secure")) {
    throw new Error(`${label} must include Secure on HTTPS beta`);
  }
}

function sessionCookie(setCookie, label) {
  const cookie = setCookie.split(";", 1)[0];
  if (!/^wt_session=[A-Za-z0-9_-]{43}$/.test(cookie)) {
    throw new Error(`${label} returned invalid wt_session cookie`);
  }
  return cookie;
}

function assertLiveKitToken(response, expected) {
  if (response.status !== 200) {
    throw new Error(
      `${expected.role} LiveKit token returned HTTP ${response.status}`,
    );
  }

  const body = response.body;
  if (
    body.roomName !== roomId ||
    body.participantId !== expected.participantId ||
    body.participantIdentity !== expected.participantId ||
    body.role !== expected.role ||
    body.canPublish !== expected.canPublish ||
    body.canPublishData !== expected.canPublishData
  ) {
    throw new Error(
      `${expected.role} LiveKit token response returned invalid grants`,
    );
  }

  if (expectedLiveKitUrl && body.liveKitUrl !== expectedLiveKitUrl) {
    throw new Error(
      `${expected.role} LiveKit URL mismatch: expected ${expectedLiveKitUrl}, got ${body.liveKitUrl}`,
    );
  }

  const liveKitUrl = new URL(body.liveKitUrl);
  if (!["ws:", "wss:"].includes(liveKitUrl.protocol)) {
    throw new Error(`${expected.role} LiveKit URL must be ws:// or wss://`);
  }
  if (baseUrl.protocol === "https:" && liveKitUrl.protocol !== "wss:") {
    throw new Error(
      `${expected.role} LiveKit URL must use wss:// for HTTPS beta`,
    );
  }

  const tokenPayload = decodeJwtPayload(body.token);
  if (
    tokenPayload.sub !== expected.participantId ||
    tokenPayload.video?.room !== roomId ||
    tokenPayload.video?.roomJoin !== true ||
    tokenPayload.video?.canSubscribe !== true ||
    tokenPayload.video?.canPublish !== expected.canPublish ||
    tokenPayload.video?.canPublishData !== expected.canPublishData
  ) {
    throw new Error(
      `${expected.role} LiveKit token JWT returned invalid claims`,
    );
  }
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("LiveKit token is not a JWT");
  }

  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function connectRoomEvents(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        Cookie: cookie,
        Origin: baseUrl.origin,
      },
    });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket snapshot timed out"));
    }, 10_000);

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

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} does not include ${JSON.stringify(expected)}`);
  }
}
