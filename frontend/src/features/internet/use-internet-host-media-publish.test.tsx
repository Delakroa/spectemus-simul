import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publishFileToLiveKit = vi.fn();
const stopFilePublication = vi.fn();
const diagnoseMediaSource = vi.fn();

vi.mock("../rooms/file-publication", () => ({
  FilePublicationFailure: class FilePublicationFailure extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "FilePublicationFailure";
    }
  },
  publishFileToLiveKit: (...args: unknown[]) => publishFileToLiveKit(...args),
  stopFilePublication: (...args: unknown[]) => stopFilePublication(...args),
}));

vi.mock("../rooms/file-diagnostics", async () => {
  const actual = await vi.importActual<typeof import("../rooms/file-diagnostics")>(
    "../rooms/file-diagnostics",
  );
  return {
    ...actual,
    diagnoseMediaSource: (...args: unknown[]) => diagnoseMediaSource(...args),
  };
});

import { useInternetHostMediaPublish } from "./use-internet-host-media-publish";

const selection = {
  displayName: "film.mkv",
  id: "media-1",
  isNormalized: false,
  playbackName: "film.mkv",
};

const fileResult = {
  compatibility: "native" as const,
  displayName: "film.mkv",
  durationMs: 1_000,
  format: "mp4" as const,
  formatLabel: "MP4",
  hasAudio: true,
  hasVideo: true,
  height: 720,
  mimeType: "video/mp4",
  normalization: "direct" as const,
  objectUrl: "/_desktop/media/media-1",
  verdict: "CAN_STREAM" as const,
  verdictLabel: "ok",
  width: 1280,
};

function mockRoom() {
  return { localParticipant: { publishTrack: vi.fn() } };
}

beforeEach(() => {
  publishFileToLiveKit.mockReset();
  stopFilePublication.mockReset();
  diagnoseMediaSource.mockReset();
  diagnoseMediaSource.mockResolvedValue(fileResult);
  publishFileToLiveKit.mockResolvedValue({
    audioTrack: {},
    stream: { getTracks: () => [] },
    tracks: [{}, {}],
    videoElement: document.createElement("video"),
    videoTrack: {},
  });
});

afterEach(() => {
  cleanup();
  delete window.spectemusDesktop;
  vi.restoreAllMocks();
});

describe("useInternetHostMediaPublish", () => {
  it("гость/без desktop API не выбирает файл", async () => {
    const { result } = renderHook(() =>
      useInternetHostMediaPublish({
        enabled: false,
        liveKitStatus: "connected",
        room: mockRoom() as never,
      }),
    );
    expect(result.current.canUseDesktopMedia).toBe(false);
    await act(async () => {
      await result.current.selectAndPrepare();
    });
    expect(result.current.status).toBe("idle");
  });

  it("host выбирает, готовит и публикует movie tracks, затем останавливает с cleanup", async () => {
    const pickMediaFile = vi.fn().mockResolvedValue(selection);
    const releaseMedia = vi.fn().mockResolvedValue(undefined);
    const normalizeMedia = vi.fn();
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      pickMediaFile,
      releaseMedia,
      normalizeMedia,
    };
    const room = mockRoom();

    const { result } = renderHook(() =>
      useInternetHostMediaPublish({
        enabled: true,
        liveKitStatus: "connected",
        room: room as never,
      }),
    );

    await act(async () => {
      await result.current.selectAndPrepare();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(diagnoseMediaSource).toHaveBeenCalled();
    expect(normalizeMedia).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.publish();
    });
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(publishFileToLiveKit).toHaveBeenCalledWith(room, expect.objectContaining(fileResult));
    expect(result.current.trackCount).toBe(2);

    act(() => {
      result.current.stop();
    });
    expect(stopFilePublication).toHaveBeenCalled();
    expect(result.current.status).toBe("ready");
    expect(result.current.trackCount).toBe(0);

    act(() => {
      result.current.clearAll();
    });
    expect(releaseMedia).toHaveBeenCalledWith("media-1");
    expect(result.current.status).toBe("idle");
  });

  it("нормализует experimental файл перед публикацией", async () => {
    diagnoseMediaSource
      .mockResolvedValueOnce({ ...fileResult, compatibility: "experimental" })
      .mockResolvedValueOnce({ ...fileResult, displayName: "film.mp4", normalization: "local" });
    const normalizeMedia = vi.fn().mockResolvedValue({
      displayName: "film.mp4",
      id: "media-1",
      isNormalized: true,
      playbackName: "film.mp4",
    });
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      pickMediaFile: vi.fn().mockResolvedValue(selection),
      releaseMedia: vi.fn(),
      normalizeMedia,
    };

    const { result } = renderHook(() =>
      useInternetHostMediaPublish({
        enabled: true,
        liveKitStatus: "connected",
        room: mockRoom() as never,
      }),
    );

    await act(async () => {
      await result.current.selectAndPrepare();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(normalizeMedia).toHaveBeenCalledWith("media-1");
    expect(result.current.displayName).toBe("film.mp4");
  });

  it("при ошибке публикации показывает сообщение и не оставляет live tracks", async () => {
    publishFileToLiveKit.mockRejectedValue(new Error("publish boom"));
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      pickMediaFile: vi.fn().mockResolvedValue(selection),
      releaseMedia: vi.fn(),
    };

    const { result } = renderHook(() =>
      useInternetHostMediaPublish({
        enabled: true,
        liveKitStatus: "connected",
        room: mockRoom() as never,
      }),
    );

    await act(async () => {
      await result.current.selectAndPrepare();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {
      await result.current.publish();
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/Не удалось опубликовать файл/);
    expect(result.current.trackCount).toBe(0);
  });

  it("при потере LiveKit соединения снимает публикацию", async () => {
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      pickMediaFile: vi.fn().mockResolvedValue(selection),
      releaseMedia: vi.fn(),
    };
    const room = mockRoom();
    const { result, rerender } = renderHook(
      ({ liveKitStatus }) =>
        useInternetHostMediaPublish({
          enabled: true,
          liveKitStatus,
          room: room as never,
        }),
      { initialProps: { liveKitStatus: "connected" } },
    );

    await act(async () => {
      await result.current.selectAndPrepare();
    });
    await act(async () => {
      await result.current.publish();
    });
    await waitFor(() => expect(result.current.status).toBe("live"));

    rerender({ liveKitStatus: "disconnected" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(stopFilePublication).toHaveBeenCalled();
  });
});
