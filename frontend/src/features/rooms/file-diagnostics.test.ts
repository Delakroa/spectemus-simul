import { describe, it, expect, vi, afterEach } from "vitest";

import { diagnoseFile, FileDiagnosticsFailure } from "./file-diagnostics";

function makeVideoStub(overrides: {
  canPlayTypeResult?: string;
  captureStream?: unknown;
  videoWidth?: number;
  duration?: number;
  triggerError?: boolean;
} = {}) {
  const {
    canPlayTypeResult = "probably",
    videoWidth = 1920,
    duration = 7200,
    triggerError = false,
  } = overrides;

  // Explicit "in" check so that captureStream: undefined is preserved (destructuring default replaces undefined)
  const captureStream = "captureStream" in overrides ? overrides.captureStream : vi.fn();

  const stub: Record<string, unknown> = {
    duration,
    videoWidth,
    preload: "",
    onloadedmetadata: null,
    onerror: null,
    canPlayType: vi.fn().mockReturnValue(canPlayTypeResult),
    captureStream,
  };

  Object.defineProperty(stub, "src", {
    set(_: string) {
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
    expect(result.displayName).toBe("movie.mp4");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationMs).toBe(7200000);
    expect(result.hasVideo).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("угадывает MIME-тип по расширению когда file.type пустой", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub();
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "video.mp4", { type: "" });
    const result = await diagnoseFile(file);

    expect(result.mimeType).toBe("video/mp4");
    expect(stub.canPlayType).toHaveBeenCalledWith("video/mp4");
  });

  it("выбрасывает UNSUPPORTED_FORMAT когда canPlayType возвращает пустую строку", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const stub = makeVideoStub({ canPlayTypeResult: "" });
    vi.spyOn(document, "createElement").mockReturnValue(stub as unknown as HTMLElement);

    const file = new File([""], "video.mkv", { type: "video/x-matroska" });

    await expect(diagnoseFile(file)).rejects.toSatisfy(
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
      (e) =>
        e instanceof FileDiagnosticsFailure && e.code === "CAPTURE_STREAM_UNAVAILABLE",
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
