import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useRoomSession } from "./use-room-session";

function RoomSessionHarness() {
  const session = useRoomSession();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          void session.selectFile(new File(["first"], "first.mp4", { type: "video/mp4" }))
        }
      >
        Первый файл
      </button>
      <button
        type="button"
        onClick={() =>
          void session.selectFile(new File(["second"], "second.mp4", { type: "video/mp4" }))
        }
      >
        Второй файл
      </button>
      <span data-testid="file-status">{session.fileStatus}</span>
      {session.fileResult && <span>{session.fileResult.displayName}</span>}
      {session.fileError && <span>{session.fileError}</span>}
    </>
  );
}

function DesktopMediaHarness() {
  const session = useRoomSession();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          void session.selectDesktopMedia({
            displayName: "movie.mkv",
            id: "d77b031d-e42c-452b-8749-b90560e63c42",
            isNormalized: false,
            playbackName: "movie.mkv",
          })
        }
      >
        Desktop файл
      </button>
      <span data-testid="file-status">{session.fileStatus}</span>
      <span data-testid="file-progress">{session.filePreparationProgress ?? "-"}</span>
      {session.fileResult && (
        <>
          <span>{session.fileResult.displayName}</span>
          <span data-testid="file-normalization">{session.fileResult.normalization}</span>
        </>
      )}
    </>
  );
}

function makeDeferredVideoStub(
  pendingMetadata: Map<string, () => void>,
  { fail = false }: { fail?: boolean } = {},
) {
  const videoTrack = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  const audioTrack = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [audioTrack],
    getTracks: () => [videoTrack, audioTrack],
    getVideoTracks: () => [videoTrack],
  } as unknown as MediaStream;
  const stub: Record<string, unknown> = {
    duration: 60,
    load: vi.fn(),
    muted: false,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    playsInline: false,
    videoWidth: 1920,
    videoHeight: 1080,
    preload: "",
    onloadedmetadata: null,
    onerror: null,
    canPlayType: vi.fn().mockReturnValue("probably"),
    captureStream: vi.fn(() => stream),
    removeAttribute: vi.fn(),
  };

  Object.defineProperty(stub, "src", {
    set(src: string) {
      pendingMetadata.set(src, () => {
        if (fail) {
          (stub.onerror as (() => void) | null)?.();
          return;
        }
        (stub.onloadedmetadata as (() => void) | null)?.();
      });
    },
  });

  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.spectemusDesktop;
});

describe("useRoomSession file diagnostics", () => {
  it("не даёт устаревшей проверке файла перезаписать последний выбранный файл", async () => {
    const user = userEvent.setup();
    const pendingMetadata = new Map<string, () => void>();

    vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
      const file = value as File;
      return `blob:${file.name}`;
    });
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video"
        ? (makeDeferredVideoStub(pendingMetadata) as unknown as HTMLElement)
        : realCreateElement(tagName),
    );

    render(<RoomSessionHarness />);

    await user.click(screen.getByRole("button", { name: "Первый файл" }));
    await user.click(screen.getByRole("button", { name: "Второй файл" }));

    expect(screen.getByTestId("file-status")).toHaveTextContent("checking");

    const resolveSecond = pendingMetadata.get("blob:second.mp4");
    expect(resolveSecond).toBeDefined();
    await act(async () => {
      resolveSecond?.();
    });

    expect(await screen.findByText("second.mp4")).toBeInTheDocument();

    const resolveFirst = pendingMetadata.get("blob:first.mp4");
    expect(resolveFirst).toBeDefined();
    await act(async () => {
      resolveFirst?.();
    });

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:first.mp4");
    });
    expect(screen.getByText("second.mp4")).toBeInTheDocument();
    expect(screen.queryByText("first.mp4")).not.toBeInTheDocument();
  });

  it("готовит desktop MKV локально после decode failure и сохраняет только временный MP4 path", async () => {
    const user = userEvent.setup();
    const normalizeMedia = vi.fn().mockResolvedValue({
      displayName: "movie.mkv",
      id: "d77b031d-e42c-452b-8749-b90560e63c42",
      isNormalized: true,
      playbackName: "movie.mp4",
    });
    window.spectemusDesktop = {
      getRuntimeStatus: vi.fn(),
      normalizeMedia,
      onRuntimeStatus: vi.fn(() => () => {}),
      restartRuntime: vi.fn(),
    };

    const realCreateElement = document.createElement.bind(document);
    const failedMetadata = new Map<string, () => void>();
    const preparedMetadata = new Map<string, () => void>();
    const failedVideo = makeDeferredVideoStub(failedMetadata, { fail: true });
    const preparedVideo = makeDeferredVideoStub(preparedMetadata);
    const videos = [failedVideo, preparedVideo];
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video" ? (videos.shift() as unknown as HTMLElement) : realCreateElement(tagName),
    );

    render(<DesktopMediaHarness />);

    await user.click(screen.getByRole("button", { name: "Desktop файл" }));

    await waitFor(() =>
      expect(
        failedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42"),
      ).toBeDefined(),
    );
    await act(async () => {
      failedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42")?.();
    });

    await waitFor(() =>
      expect(normalizeMedia).toHaveBeenCalledWith("d77b031d-e42c-452b-8749-b90560e63c42"),
    );
    await waitFor(() =>
      expect(
        preparedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42"),
      ).toBeDefined(),
    );
    await act(async () => {
      preparedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42")?.();
    });
    expect(await screen.findByText("movie.mkv")).toBeInTheDocument();
    expect(screen.getByTestId("file-status")).toHaveTextContent("ready");
    expect(screen.getByTestId("file-normalization")).toHaveTextContent("local");
  });

  it("готовит experimental desktop container до публикации даже при успешной локальной проверке", async () => {
    const user = userEvent.setup();
    const normalizeMedia = vi.fn().mockResolvedValue({
      displayName: "movie.mkv",
      id: "d77b031d-e42c-452b-8749-b90560e63c42",
      isNormalized: true,
      playbackName: "movie.mp4",
    });
    window.spectemusDesktop = {
      getRuntimeStatus: vi.fn(),
      normalizeMedia,
      onRuntimeStatus: vi.fn(() => () => {}),
      restartRuntime: vi.fn(),
    };

    const realCreateElement = document.createElement.bind(document);
    const sourceMetadata = new Map<string, () => void>();
    const preparedMetadata = new Map<string, () => void>();
    const sourceVideo = makeDeferredVideoStub(sourceMetadata);
    const preparedVideo = makeDeferredVideoStub(preparedMetadata);
    const videos = [sourceVideo, preparedVideo];
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video" ? (videos.shift() as unknown as HTMLElement) : realCreateElement(tagName),
    );

    render(<DesktopMediaHarness />);

    await user.click(screen.getByRole("button", { name: "Desktop файл" }));

    await waitFor(() =>
      expect(
        sourceMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42"),
      ).toBeDefined(),
    );
    await act(async () => {
      sourceMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42")?.();
    });

    await waitFor(() =>
      expect(normalizeMedia).toHaveBeenCalledWith("d77b031d-e42c-452b-8749-b90560e63c42"),
    );
    await waitFor(() =>
      expect(
        preparedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42"),
      ).toBeDefined(),
    );
    await act(async () => {
      preparedMetadata.get("/_desktop/media/d77b031d-e42c-452b-8749-b90560e63c42")?.();
    });

    expect(await screen.findByText("movie.mkv")).toBeInTheDocument();
    expect(screen.getByTestId("file-normalization")).toHaveTextContent("local");
  });
});
