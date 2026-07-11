import {
  ApiProblemError,
  closeRoom,
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  mintLiveKitToken,
  resolveRoomEventsUrl,
} from "./room-api";

const roomId = "AbCdEfGhIjKlMnOpQrStUv";

const room = {
  roomId,
  status: "READY",
  hostParticipantId: "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
  participants: [
    {
      participantId: "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
      displayName: "Host",
      role: "HOST",
      online: true,
      joinedAt: "2026-07-09T07:20:00Z",
    },
  ],
  media: null,
  roomVersion: 1,
  expiresAt: "2026-07-09T11:20:00Z",
  updatedAt: "2026-07-09T07:20:00Z",
};

describe("room api", () => {
  it("создаёт комнату с Idempotency-Key и валидирует ответ", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          room,
          hostSecret: "a".repeat(43),
          invitePath: `/rooms/${roomId}`,
        }),
        { status: 201 },
      ),
    );

    await expect(createRoom("Host")).resolves.toMatchObject({
      invitePath: `/rooms/${roomId}`,
      room: {
        roomId,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/rooms",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": expect.stringMatching(/^create-room-/),
        }),
      }),
    );
  });

  it("отклоняет некорректный join-ответ", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          participant: {
            participantId: "not-a-uuid",
          },
          room,
        }),
        { status: 200 },
      ),
    );

    await expect(joinRoom(roomId, "Guest")).rejects.toThrow();
  });

  it("сохраняет problem details из HTTP-ошибки", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Комната недоступна",
          status: 404,
          code: "ROOM_NOT_FOUND",
          detail: "Комната не найдена или уже закрыта.",
          instance: `/api/v1/rooms/${roomId}/join`,
          correlationId: "11111111-1111-4111-8111-111111111111",
          retryable: false,
        }),
        { status: 404 },
      ),
    );

    await expect(joinRoom(roomId, "Guest")).rejects.toMatchObject({
      message: "Комната не найдена или уже закрыта.",
      name: "ApiProblemError",
      problem: {
        code: "ROOM_NOT_FOUND",
        correlationId: "11111111-1111-4111-8111-111111111111",
        retryable: false,
        status: 404,
      },
    } satisfies Partial<ApiProblemError>);
  });

  it("восстанавливает комнату по текущей session cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          participant: room.participants[0],
          room,
        }),
        { status: 200 },
      ),
    );

    await expect(getRoom(roomId)).resolves.toMatchObject({
      participant: {
        role: "HOST",
      },
      room: {
        roomId,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/rooms/${roomId}`,
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("запрашивает LiveKit token по текущей session cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "header.payload.signature",
          liveKitUrl: "ws://127.0.0.1:7880",
          roomName: roomId,
          participantId: room.participants[0].participantId,
          participantIdentity: room.participants[0].participantId,
          role: "HOST",
          canPublish: true,
          canPublishData: true,
          expiresAt: "2026-07-09T07:30:00Z",
        }),
        { status: 200 },
      ),
    );

    await expect(mintLiveKitToken(roomId)).resolves.toMatchObject({
      liveKitUrl: "ws://127.0.0.1:7880",
      roomName: roomId,
      role: "HOST",
      canPublish: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/rooms/${roomId}/livekit-token`,
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("отправляет leave как authenticated command без тела", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(leaveRoom(roomId)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/rooms/${roomId}/leave`,
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("отправляет close с host secret только в заголовке", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(closeRoom(roomId, "host-secret")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/rooms/${roomId}/close`,
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "X-Host-Secret": "host-secret",
        }),
        method: "POST",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("строит WebSocket URL от текущего origin", () => {
    expect(resolveRoomEventsUrl(roomId)).toBe(`ws://localhost:3000/api/v1/rooms/${roomId}/events`);
  });
});
