import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiProblemError,
  createInviteRedemptionIdempotencyKey,
  createPublicInviteIdempotencyKey,
  createPublicRoom,
  createPublicRoomIdempotencyKey,
  createPublicRoomInvite,
  getAccount,
  getPublicRoom,
  isAccountRequiredError,
  mintPublicLiveKitToken,
  publicLiveKitTokenResponseSchema,
  publicRoomAccessSchema,
  redeemPublicInvite,
  requestEmailChallenge,
  toApiProblemError,
  unwrapDesktopIpcResult,
  verifyEmailChallenge,
} from "./internet-api";

const accountProfile = {
  accountId: "11111111-1111-4111-8111-111111111111",
  displayName: "Гость",
  createdAt: "2026-11-07T18:00:00Z",
};

const roomAccess = {
  room: {
    publicRoomId: "22222222-2222-4222-8222-222222222222",
    status: "OPEN",
    memberLimit: 4,
    createdAt: "2026-11-07T18:00:00Z",
    expiresAt: "2026-11-07T20:00:00Z",
  },
  membership: {
    role: "GUEST",
    joinedAt: "2026-11-07T18:05:00Z",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("internet-api", () => {
  it("читает account с credentials include", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => accountProfile,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAccount()).resolves.toEqual(accountProfile);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/account",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });

  it("запрашивает email challenge и verify без хранения в path invite token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          challengeId: "33333333-3333-4333-8333-333333333333",
          expiresAt: "2026-11-07T18:10:00Z",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => accountProfile,
      });
    vi.stubGlobal("fetch", fetchMock);

    await requestEmailChallenge("guest@example.test");
    await verifyEmailChallenge("33333333-3333-4333-8333-333333333333", {
      code: "ABC123",
      displayName: "Гость",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v2/auth/email-challenges");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "guest@example.test" }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v2/auth/email-challenges/33333333-3333-4333-8333-333333333333/verify",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("ABC123");
  });

  it("отправляет invite token только в POST body с Idempotency-Key", async () => {
    const inviteToken = "b".repeat(43);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => roomAccess,
    });
    vi.stubGlobal("fetch", fetchMock);

    await redeemPublicInvite(inviteToken, "invite-redeem-stable-key-0001");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v2/invite-redemptions",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Idempotency-Key": "invite-redeem-stable-key-0001",
        }),
        body: JSON.stringify({ inviteToken }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(init?.headers?.["Idempotency-Key"] ?? "")).not.toContain(inviteToken);
  });

  it("читает public room membership", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => roomAccess,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPublicRoom(roomAccess.room.publicRoomId)).resolves.toEqual(roomAccess);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v2/public-rooms/${roomAccess.room.publicRoomId}`,
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("mintит public LiveKit token по cookie API без LAN path", async () => {
    const token = {
      token: "header.payload.signature-value",
      liveKitUrl: "wss://rtc.example.test",
      roomName: "r".repeat(43),
      participantId: "33333333-3333-4333-8333-333333333333",
      participantIdentity: "p".repeat(43),
      role: "GUEST",
      canPublish: true,
      canPublishData: true,
      expiresAt: "2026-11-07T18:10:00Z",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => token,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mintPublicLiveKitToken(roomAccess.room.publicRoomId)).resolves.toEqual(token);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v2/public-rooms/${roomAccess.room.publicRoomId}/livekit-token`,
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/api/v1/");
    expect(() =>
      publicLiveKitTokenResponseSchema.parse({
        ...token,
        liveKitUrl: "ws://lan.example.test",
      }),
    ).toThrow();
  });

  it("создаёт public room и hash-only invite отдельными idempotent-командами", async () => {
    const invite = {
      inviteId: "44444444-4444-4444-8444-444444444444",
      invitePath: `/join#invite=${"d".repeat(43)}`,
      expiresAt: "2026-11-07T20:00:00Z",
      maxRedemptions: 3,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => roomAccess })
      .mockResolvedValueOnce({ ok: true, json: async () => invite });
    vi.stubGlobal("fetch", fetchMock);

    await createPublicRoom(180, "public-room-stable-key-0001");
    await createPublicRoomInvite(
      roomAccess.room.publicRoomId,
      { expiresInMinutes: 180, maxRedemptions: 3 },
      "public-invite-stable-key-0001",
    );

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v2/public-rooms",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expiresInMinutes: 180 }),
        headers: expect.objectContaining({
          "Idempotency-Key": "public-room-stable-key-0001",
        }),
      }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      `/api/v2/public-rooms/${roomAccess.room.publicRoomId}/invites`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expiresInMinutes: 180, maxRedemptions: 3 }),
        headers: expect.objectContaining({
          "Idempotency-Key": "public-invite-stable-key-0001",
        }),
      }),
    ]);
  });

  it("отклоняет malformed PublicRoomAccess через Zod", () => {
    expect(() =>
      publicRoomAccessSchema.parse({
        room: { publicRoomId: "not-a-uuid" },
        membership: { role: "GUEST" },
      }),
    ).toThrow();
  });

  it("создаёт Idempotency-Key без invite token", () => {
    const key = createInviteRedemptionIdempotencyKey();
    expect(key).toMatch(/^invite-redeem-/);
    expect(key).not.toContain("invite=");
    expect(createPublicRoomIdempotencyKey()).toMatch(/^public-room-/);
    expect(createPublicInviteIdempotencyKey()).toMatch(/^public-invite-/);
  });

  it("поднимает desktop IPC envelope problem до ApiProblemError", () => {
    const envelope = {
      ok: false as const,
      problem: {
        name: "ApiProblemError",
        code: "ACCOUNT_REQUIRED",
        status: 401,
        title: "Нужен вход",
        retryable: false,
      },
    };
    expect(() => unwrapDesktopIpcResult(envelope)).toThrow(ApiProblemError);
    try {
      unwrapDesktopIpcResult(envelope);
    } catch (caught) {
      expect(isAccountRequiredError(caught)).toBe(true);
      expect(toApiProblemError(caught)?.problem.status).toBe(401);
    }
    expect(
      unwrapDesktopIpcResult({
        ok: true,
        data: { token: "header.payload.signature-value" },
      }),
    ).toEqual({ token: "header.payload.signature-value" });
    expect(isAccountRequiredError(new Error("ACCOUNT_REQUIRED"))).toBe(false);
  });

  it("пробрасывает problem details без raw body в message для 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({
        code: "INVITE_UNAVAILABLE",
        title: "Invite unavailable",
        detail: "expired at jdbc://secret",
        status: 404,
        retryable: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(redeemPublicInvite("c".repeat(43), "invite-redeem-key")).rejects.toMatchObject({
      name: "ApiProblemError",
      problem: { code: "INVITE_UNAVAILABLE", status: 404 },
    });
    expect(ApiProblemError).toBeDefined();
  });
});
