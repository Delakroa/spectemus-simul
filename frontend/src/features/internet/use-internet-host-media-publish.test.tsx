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

function installDesktop(overrides: Partial<NonNullable<typeof window.spectemusDesktop>> = {}) {
  const desktop = {
    getRuntimeStatus: async () => ({ detail: "ok", state: "ready" as const }),
    onRuntimeStatus: () => () => undefined,
    restartRuntime: async () => ({ detail: "ok", state: "ready" as const }),
    pickMediaFile: vi.fn().mockResolvedValue(selection),
    releaseMedia: vi.fn().mockResolvedValue(undefined),
    normalizeMedia: vi.fn(),
    ...overrides,
  };
  window.spectemusDesktop = desktop;
  return desktop;
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
    const desktop = installDesktop();
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
    expect(desktop.normalizeMedia).not.toHaveBeenCalled();

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
    expect(desktop.releaseMedia).toHaveBeenCalledWith("media-1");
    expect(result.current.status).toBe("idle");
  });

  it("во время live не открывает новый выбор файла", async () => {
    const desktop = installDesktop();
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
    await act(async () => {
      await result.current.publish();
    });
    await waitFor(() => expect(result.current.status).toBe("live"));
    desktop.pickMediaFile.mockClear();

    await act(async () => {
      await result.current.selectAndPrepare();
    });
    expect(desktop.pickMediaFile).not.toHaveBeenCalled();
    expect(result.current.status).toBe("live");
    expect(stopFilePublication).toHaveBeenCalledTimes(0);
  });

  it("поздний выбор после clearAll освобождает media id и не регистрирует файл", async () => {
    let resolvePick: (value: typeof selection) => void = () => undefined;
    const pickMediaFile = vi.fn(
      () =>
        new Promise<typeof selection>((resolve) => {
          resolvePick = resolve;
        }),
    );
    const desktop = installDesktop({ pickMediaFile });
    const { result } = renderHook(() =>
      useInternetHostMediaPublish({
        enabled: true,
        liveKitStatus: "connected",
        room: mockRoom() as never,
      }),
    );

    let selectPromise: Promise<void> = Promise.resolve();
    act(() => {
      selectPromise = result.current.selectAndPrepare();
    });
    expect(pickMediaFile).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.clearAll();
    });

    await act(async () => {
      resolvePick(selection);
      await selectPromise;
    });

    expect(desktop.releaseMedia).toHaveBeenCalledWith("media-1");
    expect(result.current.status).toBe("idle");
    expect(result.current.displayName).toBeNull();
    expect(diagnoseMediaSource).not.toHaveBeenCalled();
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
    installDesktop({ normalizeMedia });

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

  it("при ошибке pickMediaFile показывает сообщение в UI", async () => {
    installDesktop({
      pickMediaFile: vi.fn().mockRejectedValue(new Error("picker failed")),
    });

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
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/picker failed/);
  });

  it("при ошибке публикации показывает сообщение и не оставляет live tracks", async () => {
    publishFileToLiveKit.mockRejectedValue(new Error("publish boom"));
    installDesktop();

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

  it("при потере LiveKit соединения снимает публикацию, отменяет подготовку и releaseMedia", async () => {
    let resolveNormalize: (value: typeof selection) => void = () => undefined;
    diagnoseMediaSource.mockResolvedValueOnce({
      ...fileResult,
      compatibility: "experimental",
    });
    const normalizeMedia = vi.fn(
      () =>
        new Promise<typeof selection>((resolve) => {
          resolveNormalize = resolve;
        }),
    );
    const desktop = installDesktop({
      pickMediaFile: vi.fn().mockResolvedValue(selection),
      normalizeMedia,
    });
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

    let preparePromise: Promise<void> = Promise.resolve();
    act(() => {
      preparePromise = result.current.selectAndPrepare();
    });
    await waitFor(() => expect(normalizeMedia).toHaveBeenCalled());
    expect(result.current.status).toBe("normalizing");

    rerender({ liveKitStatus: "disconnected" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(stopFilePublication).not.toHaveBeenCalled();
    expect(desktop.releaseMedia).toHaveBeenCalledWith("media-1");

    await act(async () => {
      resolveNormalize({
        displayName: "film.mp4",
        id: "media-normalized",
        isNormalized: true,
        playbackName: "film.mp4",
      });
      await preparePromise;
    });

    expect(desktop.releaseMedia).toHaveBeenCalledWith("media-normalized");
    expect(result.current.status).toBe("idle");
    expect(result.current.displayName).toBeNull();
  });

  it("при disconnect после live освобождает media id", async () => {
    const desktop = installDesktop();
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
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(stopFilePublication).toHaveBeenCalled();
    expect(desktop.releaseMedia).toHaveBeenCalledWith("media-1");
  });
});
