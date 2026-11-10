import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInternetGuestRemotePlayback } from "./use-internet-guest-remote-playback";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useInternetGuestRemotePlayback", () => {
  it("ждёт фильм, пока хозяин не опубликовал дорожки", () => {
    const room = createRoom();
    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );

    expect(result.current.status).toBe("waiting");
    expect(result.current.trackCount).toBe(0);
  });

  it("подхватывает movie tracks, опубликованные до входа гостя", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const audioTrack = createTrack("audio", "movie-audio-track");
    const participant = createParticipant([
      createPublication(videoTrack, "movie-video"),
      createPublication(audioTrack, "movie-audio"),
    ]);
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    const audioElement = document.createElement("audio");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );

    act(() => {
      result.current.setElements({ audioElement, videoElement });
    });

    await waitFor(() => expect(result.current.status).toBe("receiving"));
    expect(result.current.videoTrackName).toBe("movie-video");
    expect(result.current.audioTrackName).toBe("movie-audio");
    expect(videoTrack.attach).toHaveBeenCalledWith(videoElement);
    expect(audioTrack.attach).toHaveBeenCalledWith(audioElement);
  });

  it("принимает movie-video без звука и позже добавляет movie-audio", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const audioTrack = createTrack("audio", "movie-audio-track");
    const participant = createParticipant();
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    const audioElement = document.createElement("audio");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );
    act(() => {
      result.current.setElements({ audioElement, videoElement });
    });

    act(() => {
      room.emit(
        "trackSubscribed",
        videoTrack,
        createPublication(videoTrack, "movie-video"),
        participant,
      );
    });
    await waitFor(() => expect(result.current.status).toBe("receiving"));
    expect(result.current.videoTrackName).toBe("movie-video");
    expect(result.current.audioTrackName).toBeNull();
    expect(result.current.trackCount).toBe(1);

    act(() => {
      room.emit(
        "trackSubscribed",
        audioTrack,
        createPublication(audioTrack, "movie-audio"),
        participant,
      );
    });
    await waitFor(() => expect(result.current.audioTrackName).toBe("movie-audio"));
    expect(result.current.trackCount).toBe(2);
  });

  it("принимает movie-audio раньше movie-video", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const audioTrack = createTrack("audio", "movie-audio-track");
    const participant = createParticipant();
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    const audioElement = document.createElement("audio");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );
    act(() => {
      result.current.setElements({ audioElement, videoElement });
    });

    act(() => {
      room.emit(
        "trackSubscribed",
        audioTrack,
        createPublication(audioTrack, "movie-audio"),
        participant,
      );
    });
    await waitFor(() => expect(result.current.audioTrackName).toBe("movie-audio"));
    expect(result.current.videoTrackName).toBeNull();

    act(() => {
      room.emit(
        "trackSubscribed",
        videoTrack,
        createPublication(videoTrack, "movie-video"),
        participant,
      );
    });
    await waitFor(() => expect(result.current.videoTrackName).toBe("movie-video"));
    expect(result.current.trackCount).toBe(2);
  });

  it("игнорирует микрофон и не смешивает его с фильмом", async () => {
    const voiceTrack = createTrack("audio", "voice-track");
    const participant = createParticipant();
    const room = createRoom(participant);
    const audioElement = document.createElement("audio");
    vi.spyOn(audioElement, "play").mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );
    act(() => {
      result.current.setElements({ audioElement, videoElement: null });
    });

    act(() => {
      room.emit(
        "trackSubscribed",
        voiceTrack,
        createPublication(voiceTrack, "voice-microphone", "microphone"),
        participant,
      );
    });

    expect(voiceTrack.attach).not.toHaveBeenCalled();
    expect(result.current.status).toBe("waiting");
  });

  it("переходит в lost после остановки публикации хозяином", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const participant = createParticipant();
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );
    act(() => {
      result.current.setElements({ audioElement: null, videoElement });
    });

    const publication = createPublication(videoTrack, "movie-video");
    act(() => {
      room.emit("trackSubscribed", videoTrack, publication, participant);
    });
    await waitFor(() => expect(result.current.status).toBe("receiving"));

    act(() => {
      room.emit("trackUnsubscribed", videoTrack, publication, participant);
    });
    await waitFor(() => expect(result.current.status).toBe("lost"));
    expect(videoTrack.detach).toHaveBeenCalledWith(videoElement);
  });

  it("показывает ошибку autoplay и позволяет запустить просмотр вручную", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const participant = createParticipant();
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    vi.spyOn(videoElement, "play")
      .mockRejectedValueOnce(
        Object.assign(new Error("Autoplay blocked"), { name: "NotAllowedError" }),
      )
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useInternetGuestRemotePlayback({
        enabled: true,
        room: room as never,
      }),
    );
    act(() => {
      result.current.setElements({ audioElement: null, videoElement });
    });

    act(() => {
      room.emit(
        "trackSubscribed",
        videoTrack,
        createPublication(videoTrack, "movie-video"),
        participant,
      );
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/явного действия|Autoplay|NotAllowed/i);

    await act(async () => {
      await result.current.resumePlayback();
    });
    await waitFor(() => expect(result.current.status).toBe("receiving"));
  });

  it("на disable и unmount снимает listeners и detach-ит дорожки", async () => {
    const videoTrack = createTrack("video", "movie-video-track");
    const participant = createParticipant([createPublication(videoTrack, "movie-video")]);
    const room = createRoom(participant);
    const videoElement = document.createElement("video");
    vi.spyOn(videoElement, "play").mockResolvedValue(undefined);

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) =>
        useInternetGuestRemotePlayback({
          enabled,
          room: room as never,
        }),
      { initialProps: { enabled: true } },
    );
    act(() => {
      result.current.setElements({ audioElement: null, videoElement });
    });
    await waitFor(() => expect(result.current.status).toBe("receiving"));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(room.off).toHaveBeenCalledWith("trackSubscribed", expect.any(Function));
    expect(videoTrack.detach).toHaveBeenCalledWith(videoElement);

    rerender({ enabled: true });
    act(() => {
      result.current.setElements({ audioElement: null, videoElement });
    });
    await waitFor(() => expect(result.current.status).toBe("receiving"));

    unmount();
    expect(room.off).toHaveBeenCalledWith("trackSubscribed", expect.any(Function));
  });
});
