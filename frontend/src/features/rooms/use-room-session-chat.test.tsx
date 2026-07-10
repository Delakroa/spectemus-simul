import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRoomSession } from "./use-room-session";

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
const HOST_ID = "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678";
const GUEST_ID = "8e7d79a8-a49f-48cc-a409-f07890dd3218";

const { mockRoomSnapshot } = vi.hoisted(() => ({
  mockRoomSnapshot: {
    roomId: "AbCdEfGhIjKlMnOpQrStUv",
    status: "READY" as const,
    hostParticipantId: "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
    participants: [
      {
        participantId: "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678",
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
}));

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
            on: vi.fn().mockReturnThis(),
            off: vi.fn(),
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

function ChatHarness() {
  const session = useRoomSession();

  return (
    <>
      <button type="button" onClick={() => void session.create("Host")}>
        Создать
      </button>
      <button type="button" onClick={() => session.sendChatMessage("  Привет из теста  ")}>
        Отправить
      </button>
      <button type="button" onClick={() => session.sendChatMessage("   ")}>
        Отправить пусто
      </button>
      <button type="button" onClick={() => session.sendChatMessage("a".repeat(1001))}>
        Отправить длинное
      </button>

      <span data-testid="conn">{session.connectionStatus}</span>
      <span data-testid="chat-count">{session.chatMessages.length}</span>
      <span data-testid="chat-error">{session.chatError ?? ""}</span>
      <ul>
        {session.chatMessages.map((message) => (
          <li key={message.id} data-testid={`chat-${message.kind}`}>
            {message.text}
          </li>
        ))}
      </ul>
    </>
  );
}

function sentPayloads(socket: MockWebSocket) {
  return socket.send.mock.calls.map(
    ([raw]) => JSON.parse(raw as string) as Record<string, unknown>,
  );
}

function deliver(socket: MockWebSocket, event: Record<string, unknown>) {
  act(() => {
    socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  });
}

function serverChat(text: string, participantId = GUEST_ID, displayName = "Guest") {
  return {
    schemaVersion: 1,
    eventId: "11111111-1111-4111-8111-111111111111",
    type: "chat.message",
    roomId: ROOM_ID,
    participantId,
    roomVersion: 1,
    occurredAt: "2026-07-10T10:01:00Z",
    payload: {
      messageId: "22222222-2222-4222-8222-222222222222",
      participantId,
      displayName,
      text,
      sentAt: "2026-07-10T10:01:00Z",
    },
  };
}

async function openSession(user: ReturnType<typeof userEvent.setup>) {
  render(<ChatHarness />);
  vi.stubGlobal("WebSocket", MockWebSocket);

  await user.click(screen.getByRole("button", { name: "Создать" }));
  await waitFor(() => expect(MockWebSocket.instances[0]).toBeDefined());

  act(() => {
    const socket = MockWebSocket.instances[0]!;
    socket.readyState = socket.OPEN;
    socket.onopen?.(new Event("open"));
  });
  await waitFor(() => expect(screen.getByTestId("conn")).toHaveTextContent("open"));

  return MockWebSocket.instances[0]!;
}

afterEach(() => {
  MockWebSocket.instances = [];
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("useRoomSession text chat", () => {
  it("отправляет chat.message с обрезанным текстом по открытому сокету", async () => {
    const user = userEvent.setup();
    const socket = await openSession(user);

    await user.click(screen.getByRole("button", { name: "Отправить" }));

    const chat = sentPayloads(socket).find((payload) => payload.type === "chat.message");
    expect(chat).toBeDefined();
    expect((chat?.payload as { text: string }).text).toBe("Привет из теста");
    expect((chat?.payload as { clientMessageId?: string }).clientMessageId).toBeTypeOf("string");
    expect(chat?.expectedRoomVersion).toBe(1);
  });

  it("добавляет входящее chat.message в ленту чата", async () => {
    const user = userEvent.setup();
    const socket = await openSession(user);

    deliver(socket, serverChat("Погнали смотреть"));

    await waitFor(() => expect(screen.getByTestId("chat-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("chat-user")).toHaveTextContent("Погнали смотреть");
  });

  it("создаёт системное сообщение из participant.joined", async () => {
    const user = userEvent.setup();
    const socket = await openSession(user);

    deliver(socket, {
      schemaVersion: 1,
      eventId: "33333333-3333-4333-8333-333333333333",
      type: "participant.joined",
      roomId: ROOM_ID,
      participantId: GUEST_ID,
      roomVersion: 2,
      occurredAt: "2026-07-10T10:02:00Z",
      payload: {
        participantId: GUEST_ID,
        displayName: "Гость",
        role: "GUEST",
        online: true,
        joinedAt: "2026-07-10T10:02:00Z",
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("chat-system")).toHaveTextContent("Гость присоединился к комнате"),
    );
  });

  it("показывает chatError при получении error с кодом RATE_LIMITED", async () => {
    const user = userEvent.setup();
    const socket = await openSession(user);

    deliver(socket, {
      schemaVersion: 1,
      eventId: "44444444-4444-4444-8444-444444444444",
      type: "error",
      roomId: ROOM_ID,
      participantId: HOST_ID,
      roomVersion: 1,
      occurredAt: "2026-07-10T10:03:00Z",
      payload: {
        type: "https://watch-together.local/problems/chat-rate-limited",
        title: "Слишком много сообщений",
        status: 429,
        code: "RATE_LIMITED",
        detail: "Подождите несколько секунд перед следующим сообщением.",
        instance: `/api/v1/rooms/${ROOM_ID}/events`,
        correlationId: "55555555-5555-4555-8555-555555555555",
        retryable: true,
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("chat-error")).toHaveTextContent(
        "Подождите несколько секунд перед следующим сообщением.",
      ),
    );
  });

  it("не отправляет пустое сообщение и показывает ошибку для слишком длинного", async () => {
    const user = userEvent.setup();
    const socket = await openSession(user);

    await user.click(screen.getByRole("button", { name: "Отправить пусто" }));
    expect(sentPayloads(socket).some((payload) => payload.type === "chat.message")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Отправить длинное" }));
    expect(screen.getByTestId("chat-error")).toHaveTextContent("длиннее 1000");
    expect(sentPayloads(socket).some((payload) => payload.type === "chat.message")).toBe(false);
  });
});
