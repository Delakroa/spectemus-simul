import { describe, expect, it, vi } from "vitest";

import {
  createRemoteVoiceController,
  muteVoicePublication,
  publishVoiceToLiveKit,
  stopVoicePublication,
  unmuteVoicePublication,
  VOICE_TRACK_NAME,
  VoiceChatFailure,
} from "./voice-chat";

const { createLocalAudioTrackMock, localAudioTrack } = vi.hoisted(() => ({
  createLocalAudioTrackMock: vi.fn(),
  localAudioTrack: {
    mute: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    unmute: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("livekit-client", () => ({
  createLocalAudioTrack: createLocalAudioTrackMock,
  Track: {
    Source: {
      Microphone: "microphone",
    },
  },
}));

function createRoom() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    localParticipant: {
      publishTrack: vi.fn().mockResolvedValue({}),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    },
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, new Set([...(handlers.get(event) ?? []), handler]));
    }),
    remoteParticipants: new Map(),
  };
}

function createRemoteTrack() {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    kind: "audio",
  };
}

describe("voice chat", () => {
  it("публикует локальный микрофон отдельной microphone дорожкой и управляет mute", async () => {
    createLocalAudioTrackMock.mockResolvedValueOnce(localAudioTrack);
    const room = createRoom();

    const publication = await publishVoiceToLiveKit(room as never);
    await muteVoicePublication(publication);
    await unmuteVoicePublication(publication);
    stopVoicePublication(room as never, publication);

    expect(createLocalAudioTrackMock).toHaveBeenCalledWith({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(
      localAudioTrack,
      expect.objectContaining({
        name: VOICE_TRACK_NAME,
        source: "microphone",
      }),
    );
    expect(localAudioTrack.mute).toHaveBeenCalled();
    expect(localAudioTrack.unmute).toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(localAudioTrack, true);
  });

  it("нормализует отказ browser permission для микрофона", async () => {
    createLocalAudioTrackMock.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const room = createRoom();

    await expect(publishVoiceToLiveKit(room as never)).rejects.toMatchObject({
      code: "MIC_PERMISSION_DENIED",
      message: "Браузер не дал доступ к микрофону.",
    } satisfies Partial<VoiceChatFailure>);
  });

  it("подписывает только remote microphone tracks для голосового чата", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const room = createRoom();
    const onStateChange = vi.fn();
    const voiceTrack = createRemoteTrack();
    const movieAudioTrack = createRemoteTrack();
    const participant = { identity: "guest-1", trackPublications: new Map() };

    const controller = createRemoteVoiceController(room as never, { onStateChange });

    room.emit(
      "trackSubscribed",
      movieAudioTrack,
      { source: "screen_share_audio", trackName: "movie-audio" },
      participant,
    );
    room.emit(
      "trackSubscribed",
      voiceTrack,
      { source: "microphone", trackName: VOICE_TRACK_NAME },
      participant,
    );

    expect(movieAudioTrack.attach).not.toHaveBeenCalled();
    expect(voiceTrack.attach).toHaveBeenCalledWith(expect.any(HTMLAudioElement));
    expect(play).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        participantIdentities: ["guest-1"],
        trackCount: 1,
      }),
    );

    room.emit("trackUnsubscribed", voiceTrack);
    expect(voiceTrack.detach).toHaveBeenCalledWith(expect.any(HTMLAudioElement));

    controller.disconnect();
  });
});
