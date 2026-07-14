import { describe, expect, it, vi, afterEach } from "vitest";

import {
  FilePublicationFailure,
  publishFileToLiveKit,
  stopFilePublication,
} from "./file-publication";

vi.mock("livekit-client", () => ({
  Track: {
    Source: {
      Camera: "camera",
      ScreenShareAudio: "screen_share_audio",
    },
  },
}));

function createTrack(kind: MediaStreamTrack["kind"]) {
  return {
    kind,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createStream(videoTracks: MediaStreamTrack[], audioTracks: MediaStreamTrack[] = []) {
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
  } as unknown as MediaStream;
}

function createVideoStub(stream: MediaStream) {
  const listeners = new Map<string, Set<() => void>>();
  const stub: Record<string, unknown> = {
    duration: 120,
    muted: false,
    onerror: null,
    onloadedmetadata: null,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    playsInline: false,
    preload: "",
    readyState: 0,
    removeAttribute: vi.fn(),
    load: vi.fn(),
    captureStream: vi.fn(() => stream),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const callback = listener as () => void;
      listeners.set(type, new Set([...(listeners.get(type) ?? []), callback]));
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener as () => void);
    }),
  };

  Object.defineProperty(stub, "src", {
    set(_src: string) {
      void _src;
      Promise.resolve().then(() => {
        (stub.onloadedmetadata as (() => void) | null)?.();
        for (const listener of listeners.get("loadedmetadata") ?? []) {
          listener();
        }
      });
    },
  });

  return stub;
}

function createRoom() {
  return {
    localParticipant: {
      publishTrack: vi.fn().mockResolvedValue({}),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publishFileToLiveKit", () => {
  it("публикует video и audio tracks выбранного файла", async () => {
    const videoTrack = createTrack("video");
    const audioTrack = createTrack("audio");
    const stream = createStream([videoTrack], [audioTrack]);
    const videoStub = createVideoStub(stream);
    vi.spyOn(document, "createElement").mockReturnValue(videoStub as unknown as HTMLElement);
    const room = createRoom();

    const publication = await publishFileToLiveKit(room as never, {
      displayName: "movie.mp4",
      durationMs: 120000,
      format: "mp4",
      formatLabel: "MP4",
      hasAudio: true,
      hasVideo: true,
      height: 1080,
      mimeType: "video/mp4",
      objectUrl: "blob:movie",
      verdict: "CAN_STREAM",
      verdictLabel: "Можно транслировать с этого устройства",
      width: 1920,
    });

    expect(publication.tracks).toEqual([videoTrack, audioTrack]);
    expect(videoStub.play).toHaveBeenCalled();
    expect(room.localParticipant.publishTrack).toHaveBeenNthCalledWith(
      1,
      videoTrack,
      expect.objectContaining({
        name: "movie-video",
        simulcast: false,
        source: "camera",
      }),
    );
    expect(room.localParticipant.publishTrack).toHaveBeenNthCalledWith(
      2,
      audioTrack,
      expect.objectContaining({
        name: "movie-audio",
        source: "screen_share_audio",
      }),
    );

    stopFilePublication(room as never, publication);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(videoTrack, true);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(audioTrack, true);
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoStub.pause).toHaveBeenCalled();
  });

  it("возвращает NO_VIDEO_TRACK если captureStream не дал видеодорожку", async () => {
    const audioTrack = createTrack("audio");
    const stream = createStream([], [audioTrack]);
    const videoStub = createVideoStub(stream);
    vi.spyOn(document, "createElement").mockReturnValue(videoStub as unknown as HTMLElement);
    const room = createRoom();

    await expect(
      publishFileToLiveKit(room as never, {
        displayName: "audio.mp4",
        durationMs: 120000,
        format: "mp4",
        formatLabel: "MP4",
        hasAudio: true,
        hasVideo: true,
        height: 1080,
        mimeType: "video/mp4",
        objectUrl: "blob:audio",
        verdict: "CAN_STREAM",
        verdictLabel: "Можно транслировать с этого устройства",
        width: 1920,
      }),
    ).rejects.toSatisfy(
      (error) => error instanceof FilePublicationFailure && error.code === "NO_VIDEO_TRACK",
    );

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
  });
});
