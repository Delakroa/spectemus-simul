import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishFileToLiveKit } from "./file-publication";
import { useRoomSession } from "./use-room-session";

const { liveKitHandlers, mockVideoElement, mockRoomSnapshot } = vi.hoisted(() => {
  const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
  const HOST_ID = "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678";
  const liveKitHandlers: Array<{ onStatusChange: (status: string) => void }> = [];

  const mockRoomSnapshot = {
    roomId: ROOM_ID,
    status: "READY" as const,
    hostParticipantId: HOST_ID,
    participants: [
      {
        participantId: HOST_ID,
        displayName: "Host",
        role: "HOST" as const,
        online: true,
        joinedAt: "2026-07-10T10:00:00Z",
      },
    ],
    media: null,
    roomVersion: 1,
    expiresAt: "2026-07-10T14:00:00Z",
    updatedAt: "2026-07-10T10:00:00Z",
  };
  const listeners = new Map<string, Set<EventListener>>();

  const mockVideoElement = {
    currentTime: 0,
    duration: 120,
    ended: false,
    paused: true,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, new Set([...(listeners.get(type) ?? []), listener]));
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    },
    reset() {
      listeners.clear();
      this.currentTime = 0;
      this.duration = 120;
      this.ended = false;
      this.paused = true;
      this.play.mockResolvedValue(undefined);
    },
  };

  return { liveKitHandlers, mockVideoElement, mockRoomSnapshot };
});

vi.mock("./room-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./room-api")>();
  return {
    ...actual,
    createRoom: vi.fn().mockResolvedValue({
      room: mockRoomSnapshot,
      hostSecret: "a".repeat(43),
      invitePath: `/rooms/${mockRoomSnapshot.roomId}`,
    }),
    mintLiveKitToken: vi.fn().mockResolvedValue({
      token: "header.payload.sig",
      liveKitUrl: "ws://127.0.0.1:7880",
    }),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    closeRoom: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./livekit-connection", () => ({
  connectLiveKitRoom: vi
    .fn()
    .mockImplementation(
      async (_token: unknown, handlers: { onStatusChange: (status: string) => void }) => {
        liveKitHandlers.push(handlers);
        const { onStatusChange } = handlers;
        onStatusChange("connected");
        return {
          disconnect: vi.fn(),
          room: {
            localParticipant: { publishData: vi.fn() },
            on: vi.fn().mockReturnThis(),
            off: vi.fn(),
            remoteParticipants: new Map(),
          },
        };
      },
    ),
}));

vi.mock("./file-diagnostics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./file-diagnostics")>();
  return {
    ...actual,
    diagnoseFile: vi.fn().mockResolvedValue({
      displayName: "movie.mp4",
      durationMs: 120000,
      hasAudio: true,
      hasVideo: true,
      mimeType: "video/mp4",
      objectUrl: "blob:movie-url",
    }),
  };
});

vi.mock("./file-publication", () => ({
  FilePublicationFailure: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "FilePublicationFailure";
    }
  },
  publishFileToLiveKit: vi.fn().mockImplementation(() =>
    Promise.resolve({
      audioTrack: null,
      stream: { getTracks: () => [] },
      tracks: [{ kind: "video", stop: vi.fn() }],
      videoElement: mockVideoElement,
      videoTrack: { kind: "video", stop: vi.fn() },
    }),
  ),
  stopFilePublication: vi.fn(),
}));

vi.mock("./playback-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./playback-state")>();
  return {
    ...actual,
    createHostPlaybackStatePublisher: vi.fn().mockReturnValue({
      disconnect: vi.fn(),
      send: vi.fn(),
    }),
    createGuestPlaybackStateReceiver: vi.fn().mockReturnValue({
      disconnect: vi.fn(),
      setVideoElement: vi.fn(),
    }),
  };
});

vi.mock("./remote-playback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./remote-playback")>();
  return {
    ...actual,
    createRemotePlaybackController: vi.fn().mockReturnValue({
      disconnect: vi.fn(),
      setElements: vi.fn(),
    }),
  };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly CLOSED = 3;
  readonly CLOSING = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;

  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  extensions = "";
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  protocol = "";
  readyState = this.CONNECTING;
  url: string;

  close = vi.fn(() => {
    this.readyState = this.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  });
  send = vi.fn();

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  addEventListener() {}
  dispatchEvent() {
    return true;
  }
  removeEventListener() {}
}

function HostControlsHarness() {
  const session = useRoomSession();

  return (
    <>
      <button type="button" onClick={() => void session.create("Host")}>
        Создать
      </button>
      <button
        type="button"
        onClick={() => void session.selectFile(new File([""], "movie.mp4", { type: "video/mp4" }))}
      >
        Выбрать
      </button>
      <button type="button" onClick={() => void session.publishFile()}>
        Опубликовать
      </button>
      <button type="button" onClick={() => void session.hostPlay()}>
        Play
      </button>
      <button type="button" onClick={() => session.hostPause()}>
        Pause
      </button>
      <button type="button" onClick={() => session.hostSeek(30)}>
        Seek 30
      </button>
      <button type="button" onClick={() => session.hostSeek(-5)}>
        Seek negative
      </button>

      <span data-testid="pub-status">{session.filePublicationStatus}</span>
      <span data-testid="pb-status">{session.hostPlaybackStatus}</span>
      <span data-testid="pb-time">{session.hostPlaybackCurrentTime}</span>
      <span data-testid="pb-duration">{String(session.hostPlaybackDuration)}</span>
      <span data-testid="pb-error">{session.hostPlaybackError ?? ""}</span>
    </>
  );
}

async function setupLivePublication(user: ReturnType<typeof userEvent.setup>) {
  render(<HostControlsHarness />);

  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:movie-url");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);

  await user.click(screen.getByRole("button", { name: "Создать" }));
  await waitFor(() => expect(screen.getByTestId("pub-status")).toHaveTextContent("idle"));

  MockWebSocket.instances[0]?.onopen?.(new Event("open"));

  await user.click(screen.getByRole("button", { name: "Выбрать" }));
  await waitFor(() => expect(screen.getByTestId("pub-status")).toHaveTextContent("idle"));

  await user.click(screen.getByRole("button", { name: "Опубликовать" }));
  await waitFor(() => expect(screen.getByTestId("pub-status")).toHaveTextContent("live"));
}

beforeEach(() => {
  vi.clearAllMocks();
  liveKitHandlers.length = 0;
  mockVideoElement.reset();
});

afterEach(() => {
  MockWebSocket.instances = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("useRoomSession host playback controls", () => {
  it("DOM события play и pause обновляют hostPlaybackStatus", async () => {
    const user = userEvent.setup();
    await setupLivePublication(user);

    expect(screen.getByTestId("pb-status")).toHaveTextContent("paused");

    act(() => {
      mockVideoElement.emit("play");
    });
    expect(screen.getByTestId("pb-status")).toHaveTextContent("playing");

    act(() => {
      mockVideoElement.emit("pause");
    });
    expect(screen.getByTestId("pb-status")).toHaveTextContent("paused");

    act(() => {
      mockVideoElement.emit("ended");
    });
    expect(screen.getByTestId("pb-status")).toHaveTextContent("ended");
  });

  it("timeupdate и durationchange обновляют currentTime и duration", async () => {
    const user = userEvent.setup();
    await setupLivePublication(user);

    expect(screen.getByTestId("pb-duration")).toHaveTextContent("120");

    act(() => {
      mockVideoElement.currentTime = 45.5;
      mockVideoElement.emit("timeupdate");
    });
    expect(screen.getByTestId("pb-time")).toHaveTextContent("45.5");

    act(() => {
      mockVideoElement.duration = 3600;
      mockVideoElement.emit("durationchange");
    });
    expect(screen.getByTestId("pb-duration")).toHaveTextContent("3600");
  });

  it("hostPlay устанавливает ошибку и статус paused при reject", async () => {
    const user = userEvent.setup();
    await setupLivePublication(user);

    mockVideoElement.play.mockRejectedValueOnce(new Error("Браузер заблокировал воспроизведение."));

    await user.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() =>
      expect(screen.getByTestId("pb-error")).toHaveTextContent(
        "Браузер заблокировал воспроизведение.",
      ),
    );
    expect(screen.getByTestId("pb-status")).toHaveTextContent("paused");
  });

  it("hostSeek устанавливает currentTime, отрицательные значения приводятся к 0", async () => {
    const user = userEvent.setup();
    await setupLivePublication(user);

    await user.click(screen.getByRole("button", { name: "Seek 30" }));
    expect(mockVideoElement.currentTime).toBe(30);

    await user.click(screen.getByRole("button", { name: "Seek negative" }));
    expect(mockVideoElement.currentTime).toBe(0);
  });

  it("автоматически перепубликует выбранный файл после LiveKit reconnect", async () => {
    const user = userEvent.setup();
    await setupLivePublication(user);

    const publishFileToLiveKitMock = vi.mocked(publishFileToLiveKit);
    expect(publishFileToLiveKitMock).toHaveBeenCalledTimes(1);

    act(() => {
      liveKitHandlers[0]?.onStatusChange("disconnected");
    });
    await waitFor(() => expect(screen.getByTestId("pub-status")).toHaveTextContent("idle"));

    act(() => {
      liveKitHandlers[0]?.onStatusChange("connected");
    });

    await waitFor(() => expect(publishFileToLiveKitMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("pub-status")).toHaveTextContent("live");
  });
});
