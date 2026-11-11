import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLAYBACK_STATE_TOPIC,
  encodePlaybackStateMessage,
  idlePlaybackState,
  type PlaybackStateMessage,
} from "../rooms/playback-state";
import { useInternetGuestPlaybackSync } from "./use-internet-guest-playback-sync";

function createRoom() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, new Set([...(handlers.get(event) ?? []), handler]));
    }),
  };
}

function createMessage(overrides: Partial<PlaybackStateMessage> = {}): PlaybackStateMessage {
  return {
    schemaVersion: 1,
    revision: 1,
    event: "heartbeat",
    status: "playing",
    currentTime: 12,
    duration: 60,
    sentAt: "2026-11-10T12:00:00.000Z",
    fileName: "movie.mp4",
    publisherSessionId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useInternetGuestPlaybackSync", () => {
  it("без identity хозяина не слушает data и остаётся idle", () => {
    const room = createRoom();
    const { result } = renderHook(() =>
      useInternetGuestPlaybackSync({
        enabled: true,
        expectedHostIdentity: null,
        room: room as never,
      }),
    );

    expect(result.current).toEqual(idlePlaybackState);
    expect(room.on).not.toHaveBeenCalled();
  });

  it("поздний вход: принимает актуальный heartbeat подтверждённого хозяина", async () => {
    const room = createRoom();
    const { result } = renderHook(() =>
      useInternetGuestPlaybackSync({
        enabled: true,
        expectedHostIdentity: "host-participant",
        room: room as never,
      }),
    );

    await waitFor(() => expect(room.on).toHaveBeenCalledWith("dataReceived", expect.any(Function)));

    act(() => {
      room.emit(
        "dataReceived",
        encodePlaybackStateMessage(
          createMessage({
            currentTime: 95,
            event: "heartbeat",
            revision: 17,
            status: "paused",
          }),
        ),
        { identity: "host-participant" },
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });

    await waitFor(() => expect(result.current.revision).toBe(17));
    expect(result.current).toEqual(
      expect.objectContaining({
        currentTime: 95,
        participantIdentity: "host-participant",
        status: "paused",
      }),
    );
  });

  it("отклоняет сообщения не-хозяина даже на правильном topic", async () => {
    const room = createRoom();
    const { result } = renderHook(() =>
      useInternetGuestPlaybackSync({
        enabled: true,
        expectedHostIdentity: "host-participant",
        room: room as never,
      }),
    );

    await waitFor(() => expect(room.on).toHaveBeenCalled());

    act(() => {
      room.emit(
        "dataReceived",
        encodePlaybackStateMessage(createMessage({ revision: 3, status: "playing" })),
        { identity: "guest-spoof" },
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });

    expect(result.current).toEqual(idlePlaybackState);
  });

  it("игнорирует устаревшие и out-of-order revision", async () => {
    const room = createRoom();
    const { result } = renderHook(() =>
      useInternetGuestPlaybackSync({
        enabled: true,
        expectedHostIdentity: "host-participant",
        room: room as never,
      }),
    );

    await waitFor(() => expect(room.on).toHaveBeenCalled());

    act(() => {
      room.emit(
        "dataReceived",
        encodePlaybackStateMessage(
          createMessage({ currentTime: 40, revision: 5, status: "playing" }),
        ),
        { identity: "host-participant" },
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });
    await waitFor(() => expect(result.current.revision).toBe(5));

    act(() => {
      room.emit(
        "dataReceived",
        encodePlaybackStateMessage(
          createMessage({ currentTime: 10, revision: 4, status: "paused" }),
        ),
        { identity: "host-participant" },
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        currentTime: 40,
        revision: 5,
        status: "playing",
      }),
    );
  });

  it("после переподключения снова принимает состояние хозяина", async () => {
    const firstRoom = createRoom();
    const { result, rerender } = renderHook(
      ({ enabled, room }) =>
        useInternetGuestPlaybackSync({
          enabled,
          expectedHostIdentity: "host-participant",
          room: room as never,
        }),
      { initialProps: { enabled: true, room: firstRoom } },
    );

    await waitFor(() => expect(firstRoom.on).toHaveBeenCalled());
    act(() => {
      roomEmit(firstRoom, createMessage({ revision: 2, status: "playing", currentTime: 20 }));
    });
    await waitFor(() => expect(result.current.revision).toBe(2));

    rerender({ enabled: false, room: firstRoom });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(firstRoom.off).toHaveBeenCalledWith("dataReceived", expect.any(Function));

    const secondRoom = createRoom();
    rerender({ enabled: true, room: secondRoom });
    await waitFor(() => expect(secondRoom.on).toHaveBeenCalled());

    act(() => {
      roomEmit(
        secondRoom,
        createMessage({
          currentTime: 55,
          event: "reconnect",
          revision: 1,
          publisherSessionId: "22222222-2222-4222-8222-222222222222",
          status: "paused",
        }),
      );
    });

    await waitFor(() => expect(result.current.revision).toBe(1));
    expect(result.current).toEqual(
      expect.objectContaining({
        currentTime: 55,
        status: "paused",
      }),
    );
  });

  it("смена identity хозяина пересоздаёт receiver; stop очищает handlers", async () => {
    const room = createRoom();
    const { result, rerender, unmount } = renderHook(
      ({ expectedHostIdentity }) =>
        useInternetGuestPlaybackSync({
          enabled: true,
          expectedHostIdentity,
          room: room as never,
        }),
      { initialProps: { expectedHostIdentity: "host-a" } },
    );

    await waitFor(() => expect(room.on).toHaveBeenCalledTimes(1));
    act(() => {
      roomEmit(room, createMessage({ revision: 1 }), "host-a");
    });
    await waitFor(() => expect(result.current.revision).toBe(1));

    rerender({ expectedHostIdentity: "host-b" });
    await waitFor(() => expect(room.on).toHaveBeenCalledTimes(2));
    expect(room.off).toHaveBeenCalled();

    act(() => {
      roomEmit(room, createMessage({ revision: 9, currentTime: 3, status: "playing" }), "host-a");
    });
    expect(result.current.revision).not.toBe(9);

    act(() => {
      roomEmit(room, createMessage({ revision: 1, currentTime: 7, status: "paused" }), "host-b");
    });
    await waitFor(() => expect(result.current.currentTime).toBe(7));

    unmount();
    expect(room.off).toHaveBeenCalled();
  });
});

function roomEmit(
  room: ReturnType<typeof createRoom>,
  message: PlaybackStateMessage,
  identity = "host-participant",
) {
  room.emit(
    "dataReceived",
    encodePlaybackStateMessage(message),
    { identity },
    undefined,
    PLAYBACK_STATE_TOPIC,
  );
}
