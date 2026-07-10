import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLAYBACK_STATE_TOPIC,
  createGuestPlaybackStateReceiver,
  createHostPlaybackStatePublisher,
  decodePlaybackStateMessage,
  encodePlaybackStateMessage,
  type PlaybackStateMessage,
} from "./playback-state";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("playback-state", () => {
  it("кодирует и декодирует playback state payload", () => {
    const message = createMessage({ revision: 3, status: "playing" });

    expect(decodePlaybackStateMessage(encodePlaybackStateMessage(message))).toEqual(message);
  });

  it("host publisher отправляет publish, pause и stop messages в LiveKit topic", () => {
    vi.useFakeTimers();
    const room = createRoom();
    const videoElement = document.createElement("video");
    setVideoState(videoElement, {
      currentTime: 12,
      duration: 60,
      paused: false,
      readyState: 4,
    });

    const publisher = createHostPlaybackStatePublisher(room as never, videoElement, "movie.mp4");

    expect(room.localParticipant.publishData).toHaveBeenCalledTimes(1);
    expect(getPublishedMessage(room, 0)).toEqual(
      expect.objectContaining({
        event: "publish",
        fileName: "movie.mp4",
        revision: 1,
        status: "playing",
      }),
    );

    setVideoState(videoElement, { paused: true });
    videoElement.dispatchEvent(new Event("pause"));

    expect(getPublishedMessage(room, 1)).toEqual(
      expect.objectContaining({
        event: "pause",
        revision: 2,
        status: "paused",
      }),
    );

    publisher.disconnect();

    expect(getPublishedMessage(room, 2)).toEqual(
      expect.objectContaining({
        event: "stop",
        revision: 3,
        status: "idle",
      }),
    );
    expect(room.localParticipant.publishData.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        reliable: true,
        topic: PLAYBACK_STATE_TOPIC,
      }),
    );
  });

  it("guest receiver применяет свежие host messages и игнорирует устаревшие revision", () => {
    const room = createRoom();
    const onStateChange = vi.fn();
    const videoElement = document.createElement("video");
    const play = vi.spyOn(videoElement, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(videoElement, "pause").mockImplementation(() => undefined);

    const receiver = createGuestPlaybackStateReceiver(room as never, "host-participant", {
      onStateChange,
    });
    receiver.setVideoElement(videoElement);

    room.emit(
      "dataReceived",
      encodePlaybackStateMessage(createMessage({ revision: 1, status: "playing" })),
      { identity: "host-participant" },
      undefined,
      PLAYBACK_STATE_TOPIC,
    );

    expect(play).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        participantIdentity: "host-participant",
        revision: 1,
        status: "playing",
      }),
    );

    room.emit(
      "dataReceived",
      encodePlaybackStateMessage(createMessage({ revision: 1, status: "paused" })),
      { identity: "host-participant" },
      undefined,
      PLAYBACK_STATE_TOPIC,
    );

    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 1,
        status: "playing",
      }),
    );

    room.emit(
      "dataReceived",
      encodePlaybackStateMessage(createMessage({ revision: 2, status: "paused" })),
      { identity: "host-participant" },
      undefined,
      PLAYBACK_STATE_TOPIC,
    );

    expect(pause).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 2,
        status: "paused",
      }),
    );

    receiver.disconnect();
    expect(room.off).toHaveBeenCalledWith("dataReceived", expect.any(Function));
  });
});

function createRoom() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    localParticipant: {
      publishData: vi.fn().mockResolvedValue(undefined),
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
    event: "play",
    status: "playing",
    currentTime: 12,
    duration: 60,
    sentAt: "2026-07-10T10:30:00.000Z",
    fileName: "movie.mp4",
    ...overrides,
  };
}

function getPublishedMessage(room: ReturnType<typeof createRoom>, callIndex: number) {
  const payload = room.localParticipant.publishData.mock.calls[callIndex]?.[0] as Uint8Array;
  return decodePlaybackStateMessage(payload);
}

function setVideoState(
  videoElement: HTMLVideoElement,
  state: Partial<{
    currentTime: number;
    duration: number;
    ended: boolean;
    paused: boolean;
    readyState: number;
  }>,
) {
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(videoElement, key, {
      configurable: true,
      value,
    });
  }
}
