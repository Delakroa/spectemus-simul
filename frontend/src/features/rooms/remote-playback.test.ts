import { describe, expect, it, vi } from "vitest";

import { createRemotePlaybackController } from "./remote-playback";

function createTrack(kind: "audio" | "video", name: string) {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    kind,
    name,
  };
}

function createPublication(
  track: ReturnType<typeof createTrack>,
  trackName: string,
  source?: string,
) {
  return {
    source,
    track,
    trackName,
  };
}

function createParticipant(publications: Array<ReturnType<typeof createPublication>> = []) {
  return {
    identity: "host-participant",
    trackPublications: new Map(
      publications.map((publication) => [publication.trackName, publication]),
    ),
  };
}

function createRoom(participant = createParticipant()) {
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
    remoteParticipants: new Map([[participant.identity, participant]]),
  };
}

describe("createRemotePlaybackController", () => {
  it("attach-ит существующие remote video/audio tracks к переданным media elements", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const audioTrack = createTrack("audio", "movie-audio-track");
    const videoPublication = createPublication(videoTrack, "movie-video");
    const audioPublication = createPublication(audioTrack, "movie-audio");
    const participant = createParticipant([videoPublication, audioPublication]);
    const room = createRoom(participant);
    const onStateChange = vi.fn();
    const videoElement = document.createElement("video");
    const audioElement = document.createElement("audio");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const controller = createRemotePlaybackController(room as never, { onStateChange });
    controller.setElements({ audioElement, videoElement });

    expect(videoTrack.attach).toHaveBeenCalledWith(videoElement);
    expect(audioTrack.attach).toHaveBeenCalledWith(audioElement);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        audioTrackName: "movie-audio",
        participantIdentity: "host-participant",
        status: "receiving",
        trackCount: 2,
        videoTrackName: "movie-video",
      }),
    );

    controller.disconnect();

    expect(videoTrack.detach).toHaveBeenCalledWith(videoElement);
    expect(audioTrack.detach).toHaveBeenCalledWith(audioElement);
    expect(room.off).toHaveBeenCalledWith("trackSubscribed", expect.any(Function));
    expect(room.off).toHaveBeenCalledWith("trackUnsubscribed", expect.any(Function));
  });

  it("переходит в lost когда remote track отписан", () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const videoPublication = createPublication(videoTrack, "movie-video");
    const participant = createParticipant();
    const room = createRoom(participant);
    const onStateChange = vi.fn();
    const videoElement = document.createElement("video");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);

    const controller = createRemotePlaybackController(room as never, { onStateChange });
    controller.setElements({ audioElement: null, videoElement });

    room.emit("trackSubscribed", videoTrack, videoPublication, participant);
    room.emit("trackUnsubscribed", videoTrack, videoPublication, participant);

    expect(videoTrack.detach).toHaveBeenCalledWith(videoElement);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "lost",
        trackCount: 0,
      }),
    );

    controller.disconnect();
  });

  it("показывает error state когда browser отклоняет autoplay remote video", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const videoPublication = createPublication(videoTrack, "movie-video");
    const participant = createParticipant();
    const room = createRoom(participant);
    const onStateChange = vi.fn();
    const videoElement = document.createElement("video");
    vi.spyOn(videoElement, "play").mockRejectedValue(new Error("Autoplay blocked"));

    const controller = createRemotePlaybackController(room as never, { onStateChange });
    controller.setElements({ audioElement: null, videoElement });

    room.emit("trackSubscribed", videoTrack, videoPublication, participant);

    expect(videoTrack.attach).toHaveBeenCalledWith(videoElement);
    await vi.waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          error: "Autoplay blocked",
          status: "error",
          videoTrackName: "movie-video",
        }),
      ),
    );

    controller.disconnect();
  });

  it("повторяет воспроизведение аудио по явному действию пользователя", async () => {
    const audioTrack = createTrack("audio", "movie-audio-track");
    const audioPublication = createPublication(audioTrack, "movie-audio");
    const participant = createParticipant();
    const room = createRoom(participant);
    const onStateChange = vi.fn();
    const audioElement = document.createElement("audio");
    vi.spyOn(audioElement, "play")
      .mockRejectedValueOnce(new Error("Autoplay blocked"))
      .mockResolvedValueOnce(undefined);

    const controller = createRemotePlaybackController(room as never, { onStateChange });
    controller.setElements({ audioElement, videoElement: null });

    room.emit("trackSubscribed", audioTrack, audioPublication, participant);
    await vi.waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          error: "Autoplay blocked",
          status: "error",
        }),
      ),
    );

    await controller.resumeAudio();

    expect(audioElement.play).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: null,
        status: "receiving",
      }),
    );

    controller.disconnect();
  });

  it("игнорирует microphone audio tracks, чтобы не смешивать голос с фильмом", () => {
    const voiceTrack = createTrack("audio", "voice-track");
    const voicePublication = createPublication(voiceTrack, "voice-microphone", "microphone");
    const participant = createParticipant();
    const room = createRoom(participant);
    const onStateChange = vi.fn();
    const audioElement = document.createElement("audio");
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const controller = createRemotePlaybackController(room as never, { onStateChange });
    controller.setElements({ audioElement, videoElement: null });

    room.emit("trackSubscribed", voiceTrack, voicePublication, participant);

    expect(voiceTrack.attach).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "waiting",
        trackCount: 0,
      }),
    );

    controller.disconnect();
  });
});
