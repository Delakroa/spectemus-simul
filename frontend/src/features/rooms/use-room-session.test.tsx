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

function makeDeferredVideoStub(pendingMetadata: Map<string, () => void>) {
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
        (stub.onloadedmetadata as (() => void) | null)?.();
      });
    },
  });

  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
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
});
