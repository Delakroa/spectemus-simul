import { describe, expect, it, vi } from "vitest";

const liveKitMock = vi.hoisted(() => {
  class MockRoom {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    disconnect = vi.fn();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    async connect() {
      this.emit("connectionStateChanged", "connected");
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  const rooms: MockRoom[] = [];
  return { MockRoom, rooms };
});

vi.mock("livekit-client", () => ({
  Room: class extends liveKitMock.MockRoom {
    constructor() {
      super();
      liveKitMock.rooms.push(this);
    }
  },
  RoomEvent: {
    ConnectionQualityChanged: "connectionQualityChanged",
    ConnectionStateChanged: "connectionStateChanged",
    Disconnected: "disconnected",
    Reconnected: "reconnected",
    Reconnecting: "reconnecting",
  },
}));

import { connectLiveKitRoom } from "./livekit-connection";

describe("connectLiveKitRoom", () => {
  it("показывает signal reconnect как переподключение, а не ожидание", async () => {
    const onStatusChange = vi.fn();
    await connectLiveKitRoom(
      {
        canPublish: true,
        canPublishData: true,
        expiresAt: "2026-08-01T12:00:00.000Z",
        liveKitUrl: "ws://127.0.0.1:7880",
        participantId: "11111111-1111-4111-8111-111111111111",
        participantIdentity: "host-identity",
        role: "HOST",
        roomName: "AbCdEfGhIjKlMnOpQrStUv",
        token: "header.payload.signature",
      },
      { onError: vi.fn(), onStatusChange },
    );

    liveKitMock.rooms[0]?.emit("connectionStateChanged", "signalReconnecting");

    expect(onStatusChange).toHaveBeenLastCalledWith("reconnecting");
  });
});
