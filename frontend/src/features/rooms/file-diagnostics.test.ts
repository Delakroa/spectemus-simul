import { describe, it, expect, vi, afterEach } from "vitest";

import { diagnoseFile, FileDiagnosticsFailure } from "./file-diagnostics";

function makeStream({ hasAudio = true, hasVideo = true } = {}) {
  const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  const audioTracks = hasAudio ? [audioTrack] : [];
  const videoTracks = hasVideo ? [videoTrack] : [];

  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
  } as unknown as MediaStream;
}

function makeVideoStub(
  overrides: {
    canPlayTypeResult?: string;
    captureStream?: unknown;
    stream?: MediaStream;
    videoHeight?: number;
    videoWidth?: number;
    duration?: number;
    triggerError?: boolean;
  } = {},
) {
  const {
    canPlayTypeResult = "probably",
    videoHeight = 1080,
    videoWidth = 1920,
    duration = 7200,
    triggerError = false,
  } = overrides;

  // Explicit "in" check so that captureStream: undefined is preserved (destructuring default replaces undefined)
  const captureStream =
    "captureStream" in overrides
      ? overrides.captureStream
      : vi.fn(() => overrides.stream ?? makeStream());

  const stub: Record<string, unknown> = {
    duration,
    load: vi.fn(),
    muted: false,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    playsInline: false,
    videoWidth,
    videoHeight,
    preload: "",
    onloadedmetadata: null,
    onerror: null,
    canPlayType: vi.fn().mockReturnValue(canPlayTypeResult),
    captureStream,
    cancelVideoFrameCallback: vi.fn(),
    removeAttribute: vi.fn(),
    requestVideoFrameCallback: vi.fn((callback: () => void) => {
      void Promise.resolve().then(callback);
      return 1;
    }),
  };

  Object.defineProperty(stub, "src", {
    set(_src: string) {
      void _src;
      Promise.resolve().then(() => {
        if (triggerError) {
          (stub.onerror as (() => void) | null)?.();
        } else {
          (stub.onloadedmetadata as (() => void) | null)?.();
        }
      });
    },
  });

  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnoseFile", () => {
  it("возвращает результат для поддерживаемого MP4 с видеодорожкой", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub();
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "movie.mp4", { type: "video/mp4" });
    const result = await diagnoseFile(file);

    expect(result.objectUrl).toBe("blob:test-url");
    expect(result.compatibility).toBe("native");
    expect(result.displayName).toBe("movie.mp4");
    expect(result.format).toBe("mp4");
    expect(result.formatLabel).toBe("MP4");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationMs).toBe(7200000);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.hasVideo).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(result.verdict).toBe("CAN_STREAM");
    expect(result.verdictLabel).toBe("Можно транслировать с этого устройства");
    expect(stub.play).toHaveBeenCalled();
    expect(stub.pause).toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("проверяет M4V через canonical MP4 MIME, даже если file.type нестандартный", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub();
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "video.m4v", { type: "video/x-m4v" });
    const result = await diagnoseFile(file);

    expect(result.format).toBe("mp4");
    expect(result.formatLabel).toBe("MP4");
    expect(result.mimeType).toBe("video/mp4");
    expect(stub.canPlayType).toHaveBeenCalledWith("video/mp4");
  });

  it("проверяет WebM через browser-native MIME type", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const stub = makeVideoStub({ canPlayTypeResult: "maybe" });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const result = await diagnoseFile(new File([""], "trailer.webm", { type: "video/webm" }));

    expect(result.format).toBe("webm");
    expect(result.formatLabel).toBe("WebM");
    expect(result.mimeType).toBe("video/webm");
    expect(stub.canPlayType).toHaveBeenCalledWith("video/webm");
  });

  it("определяет отсутствие аудиодорожки по capture preview", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const stub = makeVideoStub({ stream: makeStream({ hasAudio: false }) });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const result = await diagnoseFile(new File([""], "silent.webm", { type: "video/webm" }));

    expect(result.hasAudio).toBe(false);
  });

  it("проверяет экспериментальный MKV по фактическому decode/capture без MIME preflight", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ canPlayTypeResult: "" });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "video.mkv", { type: "video/x-matroska" });
    const result = await diagnoseFile(file);

    expect(result.compatibility).toBe("experimental");
    expect(result.format).toBe("experimental");
    expect(result.formatLabel).toBe("MKV");
    expect(result.mimeType).toBe("video/x-matroska");
    expect(result.verdictLabel).toBe("Экспериментально проверено на этом устройстве");
    expect(stub.canPlayType).not.toHaveBeenCalled();
  });

  it("выбрасывает UNSUPPORTED_FORMAT, когда браузер не декодирует допустимый контейнер", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ canPlayTypeResult: "" });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    await expect(
      diagnoseFile(new File([""], "movie.webm", { type: "video/webm" })),
    ).rejects.toSatisfy(
      (e) => e instanceof FileDiagnosticsFailure && e.code === "UNSUPPORTED_FORMAT",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("выбрасывает CAPTURE_STREAM_UNAVAILABLE когда captureStream отсутствует", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ captureStream: undefined });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "movie.mp4", { type: "video/mp4" });

    await expect(diagnoseFile(file)).rejects.toSatisfy(
      (e) => e instanceof FileDiagnosticsFailure && e.code === "CAPTURE_STREAM_UNAVAILABLE",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("выбрасывает CAPTURE_PREVIEW_FAILED когда decode не отдаёт видеодорожку для комнаты", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ stream: makeStream({ hasVideo: false }) });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    await expect(
      diagnoseFile(new File([""], "movie.mp4", { type: "video/mp4" })),
    ).rejects.toSatisfy(
      (e) => e instanceof FileDiagnosticsFailure && e.code === "CAPTURE_PREVIEW_FAILED",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("выбрасывает NO_VIDEO_TRACK когда videoWidth равен нулю", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ videoWidth: 0 });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "audio-only.mp4", { type: "video/mp4" });

    await expect(diagnoseFile(file)).rejects.toSatisfy(
      (e) => e instanceof FileDiagnosticsFailure && e.code === "NO_VIDEO_TRACK",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("выбрасывает METADATA_LOAD_FAILED когда видеоэлемент сигнализирует об ошибке", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ triggerError: true });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "corrupted.mp4", { type: "video/mp4" });

    await expect(diagnoseFile(file)).rejects.toSatisfy(
      (e) => e instanceof FileDiagnosticsFailure && e.code === "METADATA_LOAD_FAILED",
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
