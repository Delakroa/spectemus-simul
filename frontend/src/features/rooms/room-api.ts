import { z } from "zod";

export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const participantIdSchema = z.uuid();
const displayNameSchema = z.string().min(1).max(64);
const dateTimeSchema = z.iso.datetime();

const participantRoleSchema = z.enum(["HOST", "GUEST"]);
export const roomStatusSchema = z.enum([
  "CREATED",
  "WAITING_FOR_HOST",
  "READY",
  "PLAYING",
  "PAUSED",
  "HOST_DISCONNECTED",
  "CLOSED",
  "EXPIRED",
]);

const mediaStateSchema = z.object({
  displayName: z.string().min(1).max(128),
  durationMs: z.number().int().nonnegative(),
  positionMs: z.number().int().nonnegative(),
  paused: z.boolean(),
});

export const participantSchema = z.object({
  participantId: participantIdSchema,
  displayName: displayNameSchema,
  role: participantRoleSchema,
  online: z.boolean(),
  joinedAt: dateTimeSchema,
});

export const roomSnapshotSchema = z.object({
  roomId: roomIdSchema,
  status: roomStatusSchema,
  hostParticipantId: z.union([participantIdSchema, z.null()]),
  participants: z.array(participantSchema).max(4),
  media: z.union([mediaStateSchema, z.null()]),
  roomVersion: z.number().int().nonnegative(),
  expiresAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

const createRoomResponseSchema = z.object({
  room: roomSnapshotSchema,
  hostSecret: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  invitePath: z.string().regex(/^\/rooms\/[A-Za-z0-9_-]{22}$/),
});

const joinRoomResponseSchema = z.object({
  participant: participantSchema,
  room: roomSnapshotSchema,
});

const getRoomResponseSchema = z.object({
  participant: participantSchema,
  room: roomSnapshotSchema,
});

const liveKitTokenResponseSchema = z.object({
  token: z.string().min(20),
  liveKitUrl: z.string().regex(/^wss?:\/\//),
  roomName: roomIdSchema,
  participantId: participantIdSchema,
  participantIdentity: z.string().min(1).max(128),
  role: participantRoleSchema,
  canPublish: z.boolean(),
  canPublishData: z.boolean(),
  expiresAt: dateTimeSchema,
});

type RequestOptions = {
  body?: unknown;
  headers?: HeadersInit;
  method?: "GET" | "POST";
  signal?: AbortSignal;
};

export type Participant = z.infer<typeof participantSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;
export type JoinRoomResponse = z.infer<typeof joinRoomResponseSchema>;
export type GetRoomResponse = z.infer<typeof getRoomResponseSchema>;
export type LiveKitTokenResponse = z.infer<typeof liveKitTokenResponseSchema>;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }

  return schema.parse(await response.json());
}

async function command(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    credentials: "include",
    signal: options.signal,
  });

  if (!response.ok) {
    throw await createResponseError(response);
  }
}

async function createResponseError(response: Response) {
  let message = `Backend вернул HTTP ${response.status}`;

  try {
    const body = (await response.json()) as { detail?: unknown; title?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    const title = typeof body.title === "string" ? body.title : undefined;
    message = detail ?? title ?? message;
  } catch {
    // Plain HTTP status is enough when backend returns an empty body.
  }

  return new Error(message);
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `create-room-${globalThis.crypto.randomUUID()}`;
  }

  return `create-room-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createRoom(hostDisplayName: string, signal?: AbortSignal) {
  return request("/api/v1/rooms", createRoomResponseSchema, {
    method: "POST",
    body: { hostDisplayName },
    headers: {
      "Idempotency-Key": createIdempotencyKey(),
    },
    signal,
  });
}

export function joinRoom(roomId: string, displayName: string, signal?: AbortSignal) {
  return request(`/api/v1/rooms/${encodeURIComponent(roomId)}/join`, joinRoomResponseSchema, {
    method: "POST",
    body: { displayName },
    signal,
  });
}

export function getRoom(roomId: string, signal?: AbortSignal) {
  return request(`/api/v1/rooms/${encodeURIComponent(roomId)}`, getRoomResponseSchema, {
    signal,
  });
}

export function mintLiveKitToken(roomId: string, signal?: AbortSignal) {
  return request(
    `/api/v1/rooms/${encodeURIComponent(roomId)}/livekit-token`,
    liveKitTokenResponseSchema,
    {
      method: "POST",
      signal,
    },
  );
}

export function leaveRoom(roomId: string, signal?: AbortSignal) {
  return command(`/api/v1/rooms/${encodeURIComponent(roomId)}/leave`, { signal });
}

export function closeRoom(roomId: string, hostSecret: string, signal?: AbortSignal) {
  return command(`/api/v1/rooms/${encodeURIComponent(roomId)}/close`, {
    headers: {
      "X-Host-Secret": hostSecret,
    },
    signal,
  });
}

export function resolveRoomEventsUrl(roomId: string) {
  const path = `/api/v1/rooms/${encodeURIComponent(roomId)}/events`;
  const base = apiBaseUrl
    ? new URL(apiBaseUrl, window.location.origin)
    : new URL(window.location.origin);
  const url = new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
