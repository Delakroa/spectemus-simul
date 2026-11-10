import { z } from "zod";

import { ApiProblemError, createResponseError } from "../rooms/room-api";

const dateTimeSchema = z.iso.datetime();
const displayNameSchema = z.string().min(1).max(64);

export const accountProfileSchema = z
  .object({
    accountId: z.uuid(),
    displayName: displayNameSchema,
    createdAt: dateTimeSchema,
  })
  .strict();

export const emailChallengeAcceptedSchema = z
  .object({
    challengeId: z.uuid(),
    expiresAt: dateTimeSchema,
  })
  .strict();

const publicRoomSchema = z
  .object({
    publicRoomId: z.uuid(),
    status: z.enum(["OPEN", "CLOSED", "EXPIRED"]),
    memberLimit: z.literal(4),
    createdAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
  })
  .strict();

const publicRoomMembershipSchema = z
  .object({
    role: z.enum(["OWNER", "GUEST"]),
    joinedAt: dateTimeSchema,
  })
  .strict();

export const publicRoomAccessSchema = z
  .object({
    room: publicRoomSchema,
    membership: publicRoomMembershipSchema,
  })
  .strict();

export const publicInviteCreatedSchema = z
  .object({
    inviteId: z.uuid(),
    invitePath: z.string().regex(/^\/join#invite=[A-Za-z0-9_-]{43}$/),
    expiresAt: dateTimeSchema,
    maxRedemptions: z.number().int().min(1).max(3),
  })
  .strict();

/** Separate from LAN LiveKitTokenResponse: opaque roomName, wss-only URL. */
export const publicLiveKitTokenResponseSchema = z
  .object({
    token: z.string().min(20),
    liveKitUrl: z.string().regex(/^wss:\/\//),
    roomName: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    participantId: z.uuid(),
    participantIdentity: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    role: z.enum(["HOST", "GUEST"]),
    canPublish: z.boolean(),
    canPublishData: z.boolean(),
    expiresAt: dateTimeSchema,
  })
  .strict();

export type AccountProfile = z.infer<typeof accountProfileSchema>;
export type EmailChallengeAccepted = z.infer<typeof emailChallengeAcceptedSchema>;
export type PublicRoomAccess = z.infer<typeof publicRoomAccessSchema>;
export type PublicInviteCreated = z.infer<typeof publicInviteCreatedSchema>;
export type PublicLiveKitTokenResponse = z.infer<typeof publicLiveKitTokenResponseSchema>;

type RequestOptions = {
  body?: unknown;
  headers?: HeadersInit;
  method?: "GET" | "POST";
  signal?: AbortSignal;
};

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

export function getAccount(signal?: AbortSignal) {
  return request("/api/v2/account", accountProfileSchema, { signal });
}

export function requestEmailChallenge(email: string, signal?: AbortSignal) {
  return request("/api/v2/auth/email-challenges", emailChallengeAcceptedSchema, {
    method: "POST",
    body: { email },
    signal,
  });
}

export function verifyEmailChallenge(
  challengeId: string,
  payload: { code: string; displayName?: string },
  signal?: AbortSignal,
) {
  return request(
    `/api/v2/auth/email-challenges/${encodeURIComponent(challengeId)}/verify`,
    accountProfileSchema,
    {
      method: "POST",
      body: payload,
      signal,
    },
  );
}

export function redeemPublicInvite(
  inviteToken: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request("/api/v2/invite-redemptions", publicRoomAccessSchema, {
    method: "POST",
    body: { inviteToken },
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    signal,
  });
}

export function getPublicRoom(publicRoomId: string, signal?: AbortSignal) {
  return request(
    `/api/v2/public-rooms/${encodeURIComponent(publicRoomId)}`,
    publicRoomAccessSchema,
    { signal },
  );
}

export function mintPublicLiveKitToken(publicRoomId: string, signal?: AbortSignal) {
  return request(
    `/api/v2/public-rooms/${encodeURIComponent(publicRoomId)}/livekit-token`,
    publicLiveKitTokenResponseSchema,
    { method: "POST", signal },
  );
}

export function createPublicRoom(
  expiresInMinutes: number,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request("/api/v2/public-rooms", publicRoomAccessSchema, {
    method: "POST",
    body: { expiresInMinutes },
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    signal,
  });
}

export function createPublicRoomInvite(
  publicRoomId: string,
  payload: { expiresInMinutes: number; maxRedemptions: number },
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return request(
    `/api/v2/public-rooms/${encodeURIComponent(publicRoomId)}/invites`,
    publicInviteCreatedSchema,
    {
      method: "POST",
      body: payload,
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      signal,
    },
  );
}

export async function approveDeviceBinding(
  bindingId: string,
  userCode: string,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${apiBaseUrl}/api/v2/auth/device-bindings/${encodeURIComponent(bindingId)}/approve`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userCode }),
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) {
    throw await createResponseError(response);
  }
}

export function isDeviceBindingUnavailableError(error: unknown) {
  return error instanceof ApiProblemError && error.problem.code === "DEVICE_BINDING_UNAVAILABLE";
}

export function createInviteRedemptionIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `invite-redeem-${globalThis.crypto.randomUUID()}`;
  }

  return `invite-redeem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createPublicRoomIdempotencyKey() {
  return createInternetIdempotencyKey("public-room");
}

export function createPublicInviteIdempotencyKey() {
  return createInternetIdempotencyKey("public-invite");
}

function createInternetIdempotencyKey(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Electron IPC rejects with a plain problem object; Error custom fields do not survive. */
export type DesktopIpcProblem = {
  code?: string;
  detail?: string;
  name?: string;
  retryable?: boolean;
  status: number;
  title?: string;
};

export function isDesktopIpcProblem(value: unknown): value is DesktopIpcProblem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as DesktopIpcProblem;
  return (
    typeof candidate.status === "number" &&
    (candidate.name === "ApiProblemError" || typeof candidate.code === "string")
  );
}

export function toApiProblemError(error: unknown): ApiProblemError | null {
  if (error instanceof ApiProblemError) {
    return error;
  }
  if (!isDesktopIpcProblem(error)) {
    return null;
  }
  return new ApiProblemError({
    code: error.code,
    detail: error.detail,
    retryable: error.retryable,
    status: error.status,
    title: error.title,
  });
}

export function isAccountRequiredError(error: unknown) {
  const problem = toApiProblemError(error);
  return problem?.problem.code === "ACCOUNT_REQUIRED";
}

export function isChallengeRejectedError(error: unknown) {
  return (
    error instanceof ApiProblemError &&
    (error.problem.code === "CHALLENGE_REJECTED" ||
      error.problem.code === "AUTH_CHALLENGE_REJECTED")
  );
}

export function isInviteUnavailableError(error: unknown) {
  return error instanceof ApiProblemError && error.problem.code === "INVITE_UNAVAILABLE";
}

export function isAccountLimitReachedError(error: unknown) {
  return error instanceof ApiProblemError && error.problem.code === "ACCOUNT_LIMIT_REACHED";
}

export function isIdempotencyReplayUnavailableError(error: unknown) {
  return (
    error instanceof ApiProblemError && error.problem.code === "IDEMPOTENCY_REPLAY_UNAVAILABLE"
  );
}

export { ApiProblemError };
