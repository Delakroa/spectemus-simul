import { createRoom, getRoom, joinRoom, resolveRoomEventsUrl } from "./room-api";

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

  it("строит WebSocket URL от текущего origin", () => {
    expect(resolveRoomEventsUrl(roomId)).toBe(`ws://localhost:3000/api/v1/rooms/${roomId}/events`);
  });
});
