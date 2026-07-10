import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { createAppQueryClient } from "../app/query-client";
import { HomePage } from "./HomePage";

const roomId = "AbCdEfGhIjKlMnOpQrStUv";
const hostId = "d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678";
const guestId = "8e7d79a8-a49f-48cc-a409-f07890dd3218";

function renderPage(initialEntries = ["/"]) {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rooms/:roomId" element={<HomePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
  afterEach(() => {
    MockWebSocket.instances = [];
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("показывает готовность backend и версию API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "UP",
              checkedAt: "2026-07-08T16:30:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: "watch-together-backend",
            version: "0.1.0",
            buildTime: "2026-07-08T16:00:00Z",
            apiVersion: "v1",
          }),
          { status: 200 },
        ),
      );
    });

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Смотрите вместе, даже когда вы далеко" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Сервис готов")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
  });

  it("показывает понятную ошибку соединения", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    renderPage();

    expect(await screen.findByText("Нет соединения")).toBeInTheDocument();
    expect(screen.getByText("Сервис временно недоступен")).toBeInTheDocument();
  });

  it("создаёт комнату и применяет participant.joined из WebSocket", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "UP",
              checkedAt: "2026-07-08T16:30:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-08T16:00:00Z",
              apiVersion: "v1",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/v1/rooms") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              room: createRoomSnapshot(),
              hostSecret: "a".repeat(43),
              invitePath: `/rooms/${roomId}`,
            }),
            { status: 201 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.clear(screen.getByLabelText("Имя host"));
    await user.type(screen.getByLabelText("Имя host"), "Dima");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByText("Состояние комнаты")).toBeInTheDocument();
    expect(screen.getByText("Dima")).toBeInTheDocument();
    expect(screen.getByText(roomId)).toBeInTheDocument();
    expect(screen.getByText(`http://localhost:3000/rooms/${roomId}`)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite-ссылка или ID комнаты")).not.toBeInTheDocument();
    expect(MockWebSocket.instances[0]?.url).toBe(
      `ws://localhost:3000/api/v1/rooms/${roomId}/events`,
    );

    MockWebSocket.instances[0]?.open();
    expect(await screen.findByText("live")).toBeInTheDocument();

    MockWebSocket.instances[0]?.message({
      schemaVersion: 1,
      eventId: "37adbb9e-2ee2-4590-864d-84f8a9b23b3d",
      type: "participant.joined",
      roomId,
      participantId: guestId,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:30:05Z",
      payload: {
        participantId: guestId,
        displayName: "Guest",
        role: "GUEST",
        online: true,
        joinedAt: "2026-07-09T07:30:05Z",
      },
    });

    expect(await screen.findByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Guest вошёл в комнату")).toBeInTheDocument();
  });

  it("восстанавливает комнату при открытии invite route с активной session", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "UP",
              checkedAt: "2026-07-08T16:30:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-08T16:00:00Z",
              apiVersion: "v1",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith(`/api/v1/rooms/${roomId}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              participant: createRoomSnapshot().participants[0],
              room: createRoomSnapshot(),
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage([`/rooms/${roomId}`]);

    expect(await screen.findByText("Комната восстановлена")).toBeInTheDocument();
    expect(screen.getByText(roomId)).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite-ссылка или ID комнаты")).not.toBeInTheDocument();
    expect(MockWebSocket.instances[0]?.url).toBe(
      `ws://localhost:3000/api/v1/rooms/${roomId}/events`,
    );

    MockWebSocket.instances[0]?.open();
    expect(await screen.findByText("live")).toBeInTheDocument();
  });
});

function createRoomSnapshot() {
  return {
    roomId,
    status: "READY",
    hostParticipantId: hostId,
    participants: [
      {
        participantId: hostId,
        displayName: "Dima",
        role: "HOST",
        online: true,
        joinedAt: "2026-07-09T07:20:00Z",
      },
    ],
    media: null,
    roomVersion: 1,
    expiresAt: "2026-07-09T11:20:00Z",
    updatedAt: "2026-07-09T07:20:00Z",
  };
}

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

  open() {
    this.readyState = this.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(value: unknown) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(value),
      }),
    );
  }
}
