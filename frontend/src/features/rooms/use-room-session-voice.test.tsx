import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRoomSession } from "./use-room-session";
import {
  muteVoicePublication,
  publishVoiceToLiveKit,
  stopVoicePublication,
  unmuteVoicePublication,
} from "./voice-chat";

const { mockRoomSnapshot, remoteVoiceHandlers, voicePublication } = vi.hoisted(() => {
  const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
  const HOST_ID = "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678";

  return {
    mockRoomSnapshot: {
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
    },
    remoteVoiceHandlers: [] as Array<{
      onStateChange: (state: {
        error: string | null;
        participantIdentities: string[];
        trackCount: number;
      }) => void;
    }>,
    voicePublication: { track: { stop: vi.fn() } },
  };
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
      async (_token: unknown, { onStatusChange }: { onStatusChange: (status: string) => void }) => {
        onStatusChange("connected");
        return {
          disconnect: vi.fn(),
          room: {
            localParticipant: { publishData: vi.fn() },
            off: vi.fn(),
            on: vi.fn().mockReturnThis(),
            remoteParticipants: new Map(),
          },
        };
      },
    ),
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

vi.mock("./voice-chat", () => ({
  VoiceChatFailure: class extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "VoiceChatFailure";
    }
  },
  createRemoteVoiceController: vi.fn((_room: unknown, handlers: unknown) => {
    remoteVoiceHandlers.push(
      handlers as {
        onStateChange: (state: {
          error: string | null;
          participantIdentities: string[];
          trackCount: number;
        }) => void;
      },
    );
    return { disconnect: vi.fn() };
  }),
  muteVoicePublication: vi.fn().mockResolvedValue(undefined),
  publishVoiceToLiveKit: vi.fn().mockResolvedValue(voicePublication),
  stopVoicePublication: vi.fn(),
  unmuteVoicePublication: vi.fn().mockResolvedValue(undefined),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly CLOSED = 3;
  readonly CLOSING = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;

  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
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

function VoiceHarness() {
  const session = useRoomSession();

  return (
    <>
      <button type="button" onClick={() => void session.create("Host")}>
        Создать
      </button>
      <button type="button" onClick={() => void session.startVoiceChat()}>
        Start voice
      </button>
      <button type="button" onClick={() => void session.muteVoiceChat()}>
        Mute voice
      </button>
      <button type="button" onClick={() => void session.unmuteVoiceChat()}>
        Unmute voice
      </button>
      <button type="button" onClick={() => session.stopVoiceChat()}>
        Stop voice
      </button>

      <span data-testid="voice-status">{session.voiceStatus}</span>
      <span data-testid="voice-error">{session.voiceError ?? ""}</span>
      <span data-testid="remote-voice-count">{session.voiceRemoteParticipantCount}</span>
    </>
  );
}

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  render(<VoiceHarness />);
  vi.stubGlobal("WebSocket", MockWebSocket);

  await user.click(screen.getByRole("button", { name: "Создать" }));
  await waitFor(() => expect(MockWebSocket.instances[0]).toBeDefined());

  act(() => {
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = socket.OPEN;
    socket.onopen?.(new Event("open"));
  });
}

beforeEach(() => {
  remoteVoiceHandlers.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  MockWebSocket.instances = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("useRoomSession voice chat", () => {
  it("управляет локальным микрофоном и принимает remote voice state", async () => {
    const user = userEvent.setup();
    await openSession(user);

    await user.click(screen.getByRole("button", { name: "Start voice" }));
    await waitFor(() => expect(screen.getByTestId("voice-status")).toHaveTextContent("live"));
    expect(publishVoiceToLiveKit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Mute voice" }));
    await waitFor(() => expect(screen.getByTestId("voice-status")).toHaveTextContent("muted"));
    expect(muteVoicePublication).toHaveBeenCalledWith(voicePublication);

    await user.click(screen.getByRole("button", { name: "Unmute voice" }));
    await waitFor(() => expect(screen.getByTestId("voice-status")).toHaveTextContent("live"));
    expect(unmuteVoicePublication).toHaveBeenCalledWith(voicePublication);

    act(() => {
      remoteVoiceHandlers[0]?.onStateChange({
        error: null,
        participantIdentities: ["guest-1"],
        trackCount: 1,
      });
    });
    expect(screen.getByTestId("remote-voice-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Stop voice" }));
    expect(stopVoicePublication).toHaveBeenCalledWith(expect.anything(), voicePublication);
    expect(screen.getByTestId("voice-status")).toHaveTextContent("idle");
  });
});
