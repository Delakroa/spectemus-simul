import { applyRoomServerEvent, parseRoomServerEvent } from "./room-events";
import type { RoomSnapshot } from "./room-api";

const hostId = "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678";
const guestId = "8e7d79a8-a49f-48cc-a409-f07890dd3218";
const roomId = "AbCdEfGhIjKlMnOpQrStUv";

function createRoomSnapshot(): RoomSnapshot {
  return {
    roomId,
    status: "READY",
    hostParticipantId: hostId,
    participants: [
      {
        participantId: hostId,
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
}

describe("room events", () => {
  it("применяет participant.joined, presence и participant.left", () => {
    const room = createRoomSnapshot();

    const joinedEvent = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "37adbb9e-2ee2-4590-864d-84f8a9b23b3d",
      type: "participant.joined",
      roomId,
      participantId: guestId,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:30:05Z",
      payload: {
        participantId: guestId,
        displayName: "Guest",
        role: "GUEST",
        online: true,
        joinedAt: "2026-07-09T07:30:05Z",
      },
    });

    if ("known" in joinedEvent) {
      throw new Error("participant.joined должен быть известным событием");
    }

    const afterJoin = applyRoomServerEvent(room, joinedEvent);
    expect(afterJoin?.participants).toHaveLength(2);
    expect(afterJoin?.participants[1]?.displayName).toBe("Guest");
    expect(afterJoin?.roomVersion).toBe(2);

    const offlineEvent = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "6a699250-6345-4fd8-9b88-e7773c823bc8",
      type: "participant.offline",
      roomId,
      participantId: guestId,
      roomVersion: 3,
      occurredAt: "2026-07-09T07:30:35Z",
      payload: {
        participantId: guestId,
        online: false,
        updatedAt: "2026-07-09T07:30:35Z",
      },
    });

    if ("known" in offlineEvent) {
      throw new Error("participant.offline должен быть известным событием");
    }

    const afterOffline = applyRoomServerEvent(afterJoin, offlineEvent);
    expect(
      afterOffline?.participants.find((participant) => participant.participantId === guestId)
        ?.online,
    ).toBe(false);

    const leftEvent = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "4e0fa361-4f7c-4d48-b61a-4a11f3277d93",
      type: "participant.left",
      roomId,
      participantId: guestId,
      roomVersion: 4,
      occurredAt: "2026-07-09T07:31:30Z",
      payload: {
        participantId: guestId,
        reason: "LEFT",
      },
    });

    if ("known" in leftEvent) {
      throw new Error("participant.left должен быть известным событием");
    }

    const afterLeave = applyRoomServerEvent(afterOffline, leftEvent);
    expect(afterLeave?.participants.map((participant) => participant.participantId)).toEqual([
      hostId,
    ]);
  });

  it("закрывает комнату по room.closed", () => {
    const closedEvent = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "a4394a01-d223-4849-8e87-73017750d0c8",
      type: "room.closed",
      roomId,
      participantId: null,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:31:00Z",
      payload: {
        reason: "HOST_CLOSED",
        closedAt: "2026-07-09T07:31:00Z",
      },
    });

    if ("known" in closedEvent) {
      throw new Error("room.closed должен быть известным событием");
    }

    const room = applyRoomServerEvent(createRoomSnapshot(), closedEvent);
    expect(room?.status).toBe("CLOSED");
    expect(room?.participants.every((participant) => !participant.online)).toBe(true);
  });

  it("игнорирует неизвестные события с валидным envelope", () => {
    const event = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "fe9ce912-f0a2-4a0d-90a5-e1ba8b51d14f",
      type: "media.future.event",
      roomId,
      participantId: null,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:31:00Z",
      payload: {},
    });

    expect("known" in event).toBe(true);
  });

  it("разбирает chat.message и не меняет authoritative состояние комнаты", () => {
    const event = parseRoomServerEvent({
      schemaVersion: 1,
      eventId: "c2b2e3d4-5e6f-4b7c-9d8e-0f1a2b3c4d5e",
      type: "chat.message",
      roomId,
      participantId: guestId,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:32:10Z",
      payload: {
        messageId: "5d9f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
        participantId: guestId,
        displayName: "Guest",
        text: "Погнали смотреть",
        sentAt: "2026-07-09T07:32:10Z",
      },
    });

    if ("known" in event) {
      throw new Error("chat.message должен быть известным событием");
    }
    if (event.type !== "chat.message") {
      throw new Error("ожидался chat.message");
    }

    expect(event.payload.text).toBe("Погнали смотреть");
    expect(event.payload.displayName).toBe("Guest");

    const room = createRoomSnapshot();
    expect(applyRoomServerEvent(room, event)).toBe(room);
  });

  it("отклоняет chat.message с текстом длиннее 1000 символов", () => {
    expect(() =>
      parseRoomServerEvent({
        schemaVersion: 1,
        eventId: "c2b2e3d4-5e6f-4b7c-9d8e-0f1a2b3c4d5e",
        type: "chat.message",
        roomId,
        participantId: guestId,
        roomVersion: 2,
        occurredAt: "2026-07-09T07:32:10Z",
        payload: {
          messageId: "5d9f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
          participantId: guestId,
          displayName: "Guest",
          text: "a".repeat(1001),
          sentAt: "2026-07-09T07:32:10Z",
        },
      }),
    ).toThrow();
  });
});
