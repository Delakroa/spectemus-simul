import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const USER_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const DEVICE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFICATION_PATH = "/internet/link";
const PUBLIC_ROOM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_CONNECTION_EVENTS = new Set([
  "CONNECTED",
  "RECONNECTING",
  "RECONNECTED",
  "DISCONNECTED",
  "QUALITY_POOR",
  "QUALITY_LOST",
]);

export function assertPublicHttpsOrigin(rawOrigin) {
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) {
    throw new Error("SPECTEMUS_PUBLIC_API_ORIGIN is required");
  }
  let url;
  try {
    url = new URL(rawOrigin.trim());
  } catch {
    throw new Error("SPECTEMUS_PUBLIC_API_ORIGIN must be a valid URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isPublicHostname(url.hostname) ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "SPECTEMUS_PUBLIC_API_ORIGIN must be a public https:// origin without credentials, path, query or fragment",
    );
  }
  return url.origin;
}

function isPublicHostname(rawHostname) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname.includes(":")
  ) {
    return false;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet))) {
    return false;
  }
  return true;
}

function assertVerificationUri(verificationUri, expectedOrigin) {
  const url = new URL(verificationUri);
  assertPublicHttpsOrigin(url.origin);
  if (
    url.origin !== expectedOrigin ||
    url.pathname !== VERIFICATION_PATH ||
    url.username ||
    url.password ||
    url.search
  ) {
    throw new Error(
      "verification URI is outside the configured public origin allowlist",
    );
  }
  return url.toString();
}

export function createDeviceBindingController({
  apiOrigin,
  resolveApiOrigin,
  userDataPath,
  fetchImpl = globalThis.fetch,
  openExternal,
  safeStorageImpl,
  now = () => Date.now(),
}) {
  let activePoll = null;
  const storagePath = join(userDataPath, "device-binding.bin");

  function requireOrigin() {
    const configured =
      typeof resolveApiOrigin === "function" ? resolveApiOrigin() : apiOrigin;
    return assertPublicHttpsOrigin(configured);
  }

  function requireSafeStorage() {
    if (!safeStorageImpl?.isEncryptionAvailable?.()) {
      throw new Error("safeStorage is unavailable");
    }
    return safeStorageImpl;
  }

  async function readStoredSession() {
    try {
      const encrypted = await readFile(storagePath);
      const raw = requireSafeStorage().decryptString(encrypted);
      return JSON.parse(raw);
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.errno === -2)) {
        return null;
      }
      throw error;
    }
  }

  async function writeStoredSession(session) {
    const storage = requireSafeStorage();
    await mkdir(userDataPath, { recursive: true, mode: 0o700 });
    const payload = Buffer.from(JSON.stringify(session), "utf8");
    const encrypted = storage.encryptString(payload.toString("utf8"));
    await writeFile(storagePath, encrypted, { mode: 0o600 });
  }

  async function clearStoredSession() {
    await rm(storagePath, { force: true });
  }

  async function status() {
    const stored = await readStoredSession();
    if (!stored?.deviceCredential || !stored?.profile) {
      return { bound: false };
    }
    if (
      typeof stored.expiresAt === "string" &&
      Number.isFinite(Date.parse(stored.expiresAt)) &&
      Date.parse(stored.expiresAt) <= now()
    ) {
      await clearStoredSession();
      return { bound: false };
    }
    return {
      bound: true,
      profile: {
        accountId: stored.profile.accountId,
        displayName: stored.profile.displayName,
      },
      expiresAt: stored.expiresAt,
    };
  }

  async function start({ signal } = {}) {
    const origin = requireOrigin();
    cancel();
    const response = await fetchImpl(`${origin}/api/v2/auth/device-bindings`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw await toProblem(response);
    }
    const body = await response.json();
    if (
      !body?.bindingId ||
      !USER_CODE_PATTERN.test(body.userCode ?? "") ||
      !DEVICE_SECRET_PATTERN.test(body.deviceCode ?? "") ||
      typeof body.verificationUri !== "string"
    ) {
      throw new Error("Malformed device binding start response");
    }
    const verificationUri = assertVerificationUri(body.verificationUri, origin);
    activePoll = {
      origin,
      bindingId: body.bindingId,
      deviceCode: body.deviceCode,
      verificationUri,
      intervalMs: Math.max(1000, Number(body.intervalSeconds || 5) * 1000),
      expiresAtMs: Date.parse(body.expiresAt),
      controller: new AbortController(),
    };
    return {
      bindingId: body.bindingId,
      userCode: body.userCode,
      verificationUri,
      expiresAt: body.expiresAt,
      intervalSeconds: body.intervalSeconds,
    };
  }

  async function openVerification() {
    if (!activePoll?.verificationUri) {
      throw new Error("Device binding is not active");
    }
    assertVerificationUri(activePoll.verificationUri, activePoll.origin);
    await openExternal(activePoll.verificationUri);
  }

  async function pollOnce() {
    if (!activePoll) {
      throw new Error("Device binding is not active");
    }
    if (now() >= activePoll.expiresAtMs) {
      cancel();
      const error = new Error("Device binding expired");
      error.code = "DEVICE_BINDING_UNAVAILABLE";
      throw error;
    }
    const response = await fetchImpl(
      `${activePoll.origin}/api/v2/auth/device-bindings/${activePoll.bindingId}/token`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceCode: activePoll.deviceCode }),
        signal: activePoll.controller.signal,
      },
    );
    if (response.status === 400) {
      const problem = await safeProblem(response);
      if (problem?.code === "DEVICE_AUTHORIZATION_PENDING") {
        return {
          status: "pending",
          intervalSeconds: activePoll.intervalMs / 1000,
        };
      }
    }
    if (!response.ok) {
      throw await toProblem(response);
    }
    const body = await response.json();
    if (!DEVICE_SECRET_PATTERN.test(body.deviceCredential ?? "")) {
      throw new Error("Malformed device binding session response");
    }
    const session = {
      deviceCredential: body.deviceCredential,
      profile: body.profile,
      expiresAt: body.expiresAt,
      apiOrigin: activePoll.origin,
    };
    await writeStoredSession(session);
    cancel();
    return {
      status: "bound",
      profile: {
        accountId: body.profile.accountId,
        displayName: body.profile.displayName,
      },
      expiresAt: body.expiresAt,
    };
  }

  function cancel() {
    activePoll?.controller.abort();
    activePoll = null;
  }

  async function clear({ revokeRemote = true } = {}) {
    const stored = await readStoredSession();
    cancel();
    if (!stored?.deviceCredential) {
      await clearStoredSession();
      return { bound: false };
    }
    if (revokeRemote) {
      if (!stored.apiOrigin) {
        const error = new Error("Stored device session is missing apiOrigin");
        error.code = "DEVICE_SESSION_REVOKE_FAILED";
        error.retryable = true;
        throw error;
      }
      let response;
      try {
        response = await fetchImpl(
          `${stored.apiOrigin}/api/v2/account/device-sessions/revoke`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ deviceCredential: stored.deviceCredential }),
          },
        );
      } catch (cause) {
        const error = new Error("Device session revoke failed");
        error.code = "DEVICE_SESSION_REVOKE_FAILED";
        error.retryable = true;
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        const problem = await toProblem(response);
        problem.code = problem.code || "DEVICE_SESSION_REVOKE_FAILED";
        problem.retryable = true;
        throw problem;
      }
    }
    await clearStoredSession();
    return { bound: false };
  }

  async function authorizedFetch(path, init = {}) {
    const stored = await readStoredSession();
    if (!stored?.deviceCredential || !stored?.apiOrigin) {
      // Plain problem object; mint IPC wraps it in a resolved {ok:false} envelope.
      throw accountRequiredProblem("Desktop account is not bound");
    }
    if (
      typeof stored.expiresAt === "string" &&
      Number.isFinite(Date.parse(stored.expiresAt)) &&
      Date.parse(stored.expiresAt) <= now()
    ) {
      await clearStoredSession();
      throw accountRequiredProblem("Desktop account session expired");
    }
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `Bearer ${stored.deviceCredential}`);
    headers.set("Accept", "application/json");
    return fetchImpl(`${stored.apiOrigin}${path}`, { ...init, headers });
  }

  async function createPublicRoom({
    expiresInMinutes,
    idempotencyKey,
    signal,
  } = {}) {
    const response = await authorizedFetch("/api/v2/public-rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ expiresInMinutes }),
      signal,
    });
    if (!response.ok) {
      throw await toProblem(response);
    }
    return response.json();
  }

  async function createPublicInvite({
    publicRoomId,
    expiresInMinutes,
    maxRedemptions,
    idempotencyKey,
    signal,
  } = {}) {
    const response = await authorizedFetch(
      `/api/v2/public-rooms/${encodeURIComponent(publicRoomId)}/invites`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ expiresInMinutes, maxRedemptions }),
        signal,
      },
    );
    if (!response.ok) {
      throw await toProblem(response);
    }
    return response.json();
  }

  async function mintPublicLiveKitToken(publicRoomId, { signal } = {}) {
    if (
      typeof publicRoomId !== "string" ||
      !PUBLIC_ROOM_ID_PATTERN.test(publicRoomId)
    ) {
      throw new Error("publicRoomId must be a UUID");
    }
    const response = await authorizedFetch(
      `/api/v2/public-rooms/${encodeURIComponent(publicRoomId)}/livekit-token`,
      {
        method: "POST",
        signal,
      },
    );
    if (!response.ok) {
      throw await toProblem(response);
    }
    const body = await response.json();
    if (
      typeof body?.token !== "string" ||
      body.token.length < 20 ||
      typeof body?.liveKitUrl !== "string" ||
      !body.liveKitUrl.startsWith("wss://")
    ) {
      throw new Error("Malformed public LiveKit token response");
    }
    // Renderer-safe surface only: never include deviceCredential or apiOrigin.
    return {
      token: body.token,
      liveKitUrl: body.liveKitUrl,
      roomName: body.roomName,
      participantId: body.participantId,
      participantIdentity: body.participantIdentity,
      role: body.role,
      canPublish: body.canPublish,
      canPublishData: body.canPublishData,
      expiresAt: body.expiresAt,
    };
  }

  async function submitPublicConnectionEvent(payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      Object.keys(payload).sort().join(",") !== "publicRoomId,type" ||
      typeof payload.publicRoomId !== "string" ||
      !PUBLIC_ROOM_ID_PATTERN.test(payload.publicRoomId) ||
      !PUBLIC_CONNECTION_EVENTS.has(payload.type)
    ) {
      throw new Error("Invalid public connection event");
    }
    const response = await authorizedFetch(
      `/api/v2/public-rooms/${encodeURIComponent(payload.publicRoomId)}/connection-telemetry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: payload.type }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      throw await toProblem(response);
    }
    if (response.status !== 202) {
      throw new Error("Unexpected Internet telemetry response");
    }
    return { accepted: true };
  }

  return {
    status,
    start,
    openVerification,
    pollOnce,
    cancel,
    clear,
    authorizedFetch,
    createPublicRoom,
    createPublicInvite,
    mintPublicLiveKitToken,
    submitPublicConnectionEvent,
    _storagePath: storagePath,
  };
}

/**
 * Structured API problem. Mint LiveKit IPC must wrap these in a resolved
 * `{ ok: false, problem }` envelope — rejected handle() promises lose fields.
 */
async function toProblem(response) {
  const problem = await safeProblem(response);
  return {
    name: "ApiProblemError",
    code: typeof problem?.code === "string" ? problem.code : undefined,
    status: response.status,
    title:
      typeof problem?.title === "string"
        ? problem.title
        : `HTTP ${response.status}`,
    detail: typeof problem?.detail === "string" ? problem.detail : undefined,
    retryable:
      typeof problem?.retryable === "boolean"
        ? problem.retryable
        : response.status === 429 || response.status >= 500,
  };
}

function accountRequiredProblem(title) {
  return {
    name: "ApiProblemError",
    code: "ACCOUNT_REQUIRED",
    status: 401,
    title,
    retryable: false,
  };
}

async function safeProblem(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
