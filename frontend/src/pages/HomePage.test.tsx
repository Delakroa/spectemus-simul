import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { createAppQueryClient } from "../app/query-client";
import { PLAYBACK_STATE_TOPIC } from "../features/rooms/playback-state";
import { HomePage } from "./HomePage";

const liveKitMock = vi.hoisted(() => {
  const localAudioTrack = {
    mute: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    unmute: vi.fn().mockResolvedValue(undefined),
  };

  class MockLiveKitRoom {
    handlers = new Map<string, Array<(...values: unknown[]) => void>>();
    localParticipant = {
      publishData: vi.fn().mockResolvedValue(undefined),
      publishTrack: vi.fn().mockResolvedValue({}),
      trackPublications: new Map(),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    };
    remoteParticipants = new Map();
    token: string | null = null;
    url: string | null = null;

    on(event: string, handler: (...values: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }

    off(event: string, handler: (...values: unknown[]) => void) {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((item) => item !== handler),
      );
      return this;
    }

    async connect(url: string, token: string) {
      this.url = url;
      this.token = token;
      this.emit("connectionStateChanged", "connected");
    }

    disconnect = vi.fn(() => {
      this.emit("disconnected");
    });

    emit(event: string, ...values: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...values);
      }
    }
  }

  const rooms: MockLiveKitRoom[] = [];

  return { MockLiveKitRoom, localAudioTrack, rooms };
});

vi.mock("livekit-client", () => ({
  createLocalAudioTrack: vi.fn().mockResolvedValue(liveKitMock.localAudioTrack),
  Room: class extends liveKitMock.MockLiveKitRoom {
    constructor() {
      super();
      liveKitMock.rooms.push(this);
    }
  },
  RoomEvent: {
    ConnectionStateChanged: "connectionStateChanged",
    Disconnected: "disconnected",
    LocalTrackPublished: "localTrackPublished",
    DataReceived: "dataReceived",
    ParticipantDisconnected: "participantDisconnected",
    Reconnected: "reconnected",
    Reconnecting: "reconnecting",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
  },
  Track: {
    Source: {
      Camera: "camera",
      Microphone: "microphone",
      ScreenShareAudio: "screen_share_audio",
    },
  },
}));

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
    liveKitMock.rooms.length = 0;
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

  it("отправляет beta feedback с техническим контекстом", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-12T12:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-12T12:00:00Z",
              apiVersion: "v1",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith("/api/v1/feedback") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              feedbackId: "f4b1dc2a-28e1-4490-88cf-3a6f5aefef43",
              correlationId: "22222222-2222-4222-8222-222222222222",
              receivedAt: "2026-07-12T12:01:00Z",
            }),
            { status: 202 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.selectOptions(screen.getByLabelText("Итог сессии"), "BLOCKED");
    await user.selectOptions(screen.getByLabelText("Причина отзыва"), "CONNECTION");
    await user.type(screen.getByLabelText("Комментарий к beta"), "Связь пропала у гостя.");
    await user.click(screen.getByRole("button", { name: "Отправить отзыв" }));

    expect(await screen.findByText(/Отзыв отправлен/)).toBeInTheDocument();
    const feedbackCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/feedback"),
    );
    const payload = JSON.parse(feedbackCall?.[1]?.body as string);
    expect(payload).toMatchObject({
      outcome: "BLOCKED",
      reason: "CONNECTION",
      message: "Связь пропала у гостя.",
      metadata: expect.objectContaining({
        liveKitStatus: "idle",
        roomConnectionStatus: "idle",
      }),
    });
  });

  it("показывает problem details и recovery-действие для ошибки создания комнаты", async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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
              title: "Backend перегружен",
              status: 503,
              code: "BACKEND_UNAVAILABLE",
              detail: "Попробуйте создать комнату ещё раз.",
              correlationId: "11111111-1111-4111-8111-111111111111",
              retryable: true,
            }),
            { status: 503 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByText("Backend перегружен")).toBeInTheDocument();
    expect(screen.getByText("Попробуйте создать комнату ещё раз.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "HTTP 503 · Код BACKEND_UNAVAILABLE · ID 11111111-1111-4111-8111-111111111111",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-09T07:30:00Z",
            }),
            { status: 200 },
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
    expect(await screen.findByText("LiveKit: подключён")).toBeInTheDocument();
    expect(liveKitMock.rooms[0]?.url).toBe("ws://127.0.0.1:7880");
    expect(liveKitMock.rooms[0]?.token).toBe("header.payload.signature");

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

  it("позволяет повторить LiveKit после ошибки media-plane", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();
    let tokenCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        tokenCalls += 1;
        if (tokenCalls === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                title: "LiveKit token недоступен",
                status: 503,
                code: "LIVEKIT_TOKEN_UNAVAILABLE",
                detail: "Media server временно недоступен.",
                retryable: true,
              }),
              { status: 503 },
            ),
          );
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByText("LiveKit не подключён")).toBeInTheDocument();
    expect(screen.getByText("Media server временно недоступен.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Повторить LiveKit" }));

    expect(await screen.findByText("LiveKit: подключён")).toBeInTheDocument();
    expect(tokenCalls).toBe(2);
  });

  it("после закрытия комнаты снова показывает формы для новой комнаты", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-08T16:30:00Z" }), {
            status: 200,
          }),
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-09T07:30:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    expect(await screen.findByText("Состояние комнаты")).toBeInTheDocument();
    // Пока комната активна, формы создания/входа скрыты.
    expect(screen.queryByLabelText("Invite-ссылка или ID комнаты")).not.toBeInTheDocument();

    MockWebSocket.instances[0]?.open();
    MockWebSocket.instances[0]?.message({
      schemaVersion: 1,
      eventId: "a4394a01-d223-4849-8e87-73017750d0c8",
      type: "room.closed",
      roomId,
      participantId: null,
      roomVersion: 2,
      occurredAt: "2026-07-09T07:31:00Z",
      payload: { reason: "HOST_CLOSED", closedAt: "2026-07-09T07:31:00Z" },
    });

    // После закрытия формы снова доступны, и можно создать новую комнату.
    expect(await screen.findByLabelText("Invite-ссылка или ID комнаты")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать" })).toBeEnabled();
  });

  it("восстанавливает комнату при открытии invite route с активной session", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);

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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-09T07:30:00Z",
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
    expect(await screen.findByText("LiveKit: подключён")).toBeInTheDocument();
  });

  it("host видит file picker после создания комнаты, guest — нет", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
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

    expect(await screen.findByText("Видеофайл")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выбрать файл" })).toBeInTheDocument();
  });

  it("guest не видит file picker после входа в комнату", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
              apiVersion: "v1",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith(`/api/v1/rooms/${roomId}/join`) && init?.method === "POST") {
        const guestSnapshot = {
          ...createRoomSnapshot(),
          participants: [
            createRoomSnapshot().participants[0],
            {
              participantId: guestId,
              displayName: "Guest",
              role: "GUEST",
              online: true,
              joinedAt: "2026-07-10T10:01:00Z",
            },
          ],
        };

        return Promise.resolve(
          new Response(
            JSON.stringify({
              room: guestSnapshot,
              participant: {
                participantId: guestId,
                displayName: "Guest",
                role: "GUEST",
                online: true,
                joinedAt: "2026-07-10T10:01:00Z",
              },
            }),
            { status: 201 },
          ),
        );
      }

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: guestId,
              participantIdentity: guestId,
              role: "GUEST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.type(screen.getByLabelText("Invite-ссылка или ID комнаты"), roomId);
    await user.type(screen.getByLabelText("Имя гостя"), "GuestUser");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("Состояние комнаты")).toBeInTheDocument();
    expect(screen.queryByText("Видеофайл")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать файл" })).not.toBeInTheDocument();
  });

  it("guest воспроизводит remote tracks из LiveKit", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();
    const mediaPlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const mediaPause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
      // jsdom does not implement media playback.
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
              apiVersion: "v1",
            }),
            { status: 200 },
          ),
        );
      }

      if (url.endsWith(`/api/v1/rooms/${roomId}/join`) && init?.method === "POST") {
        const guestSnapshot = {
          ...createRoomSnapshot(),
          participants: [
            createRoomSnapshot().participants[0],
            {
              participantId: guestId,
              displayName: "Guest",
              role: "GUEST",
              online: true,
              joinedAt: "2026-07-10T10:01:00Z",
            },
          ],
        };

        return Promise.resolve(
          new Response(
            JSON.stringify({
              room: guestSnapshot,
              participant: {
                participantId: guestId,
                displayName: "Guest",
                role: "GUEST",
                online: true,
                joinedAt: "2026-07-10T10:01:00Z",
              },
            }),
            { status: 201 },
          ),
        );
      }

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: guestId,
              participantIdentity: guestId,
              role: "GUEST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    renderPage();

    await screen.findByText("Сервис готов");
    await user.type(screen.getByLabelText("Invite-ссылка или ID комнаты"), roomId);
    await user.type(screen.getByLabelText("Имя гостя"), "GuestUser");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText("Просмотр")).toBeInTheDocument();
    expect(await screen.findByText("Качество")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Ждём host").length).toBeGreaterThan(0);
    });
    await act(async () => {
      liveKitMock.rooms[0]?.emit("connectionQualityChanged", "poor", { identity: guestId });
    });
    expect(await screen.findByText("Плохая связь")).toBeInTheDocument();
    expect(screen.getByText("LiveKit сообщает о плохом качестве соединения.")).toBeInTheDocument();
    const player = document.querySelector(".remote-player") as HTMLDivElement;
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(player, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    await user.click(screen.getByRole("button", { name: "Развернуть видео на весь экран" }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const videoTrack = createRemoteTrack("video");
    const audioTrack = createRemoteTrack("audio");
    const participant = { identity: hostId, trackPublications: new Map() };
    const videoPublication = { trackName: "movie-video" };
    const audioPublication = { trackName: "movie-audio" };

    await act(async () => {
      liveKitMock.rooms[0]?.emit("trackSubscribed", videoTrack, videoPublication, participant);
      liveKitMock.rooms[0]?.emit("trackSubscribed", audioTrack, audioPublication, participant);
    });

    expect(await screen.findByText("Получаем видео")).toBeInTheDocument();
    expect(screen.getByText("2 дорожки")).toBeInTheDocument();
    expect(screen.getByText("movie-video")).toBeInTheDocument();
    expect(screen.getByText("movie-audio")).toBeInTheDocument();
    expect(videoTrack.attach).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
    expect(audioTrack.attach).toHaveBeenCalledWith(expect.any(HTMLAudioElement));

    await act(async () => {
      liveKitMock.rooms[0]?.emit(
        "dataReceived",
        createPlaybackPayload({ event: "play", revision: 1, status: "playing" }),
        participant,
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });

    expect(await screen.findByText("Host playback")).toBeInTheDocument();
    expect(screen.getByText("Воспроизведение")).toBeInTheDocument();
    expect(screen.getByText("0:12 / 1:00")).toBeInTheDocument();
    expect(screen.getByText("rev 1")).toBeInTheDocument();
    expect(screen.getByText("movie.mp4")).toBeInTheDocument();
    expect(mediaPlay).toHaveBeenCalled();

    await act(async () => {
      liveKitMock.rooms[0]?.emit(
        "dataReceived",
        createPlaybackPayload({ event: "pause", revision: 2, status: "paused" }),
        participant,
        undefined,
        PLAYBACK_STATE_TOPIC,
      );
    });

    expect(await screen.findByText("Пауза")).toBeInTheDocument();
    expect(screen.getByText("rev 2")).toBeInTheDocument();
    expect(mediaPause).toHaveBeenCalled();

    await act(async () => {
      liveKitMock.rooms[0]?.emit("trackUnsubscribed", videoTrack, videoPublication, participant);
      liveKitMock.rooms[0]?.emit("trackUnsubscribed", audioTrack, audioPublication, participant);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Поток потерян").length).toBeGreaterThan(0);
    });
    expect(videoTrack.detach).toHaveBeenCalledWith(expect.any(HTMLVideoElement));
    expect(audioTrack.detach).toHaveBeenCalledWith(expect.any(HTMLAudioElement));
  });

  it("успешный выбор файла показывает имя файла и длительность", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:movie-url");
    vi.spyOn(URL, "revokeObjectURL");

    const diagnosticVideoTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const diagnosticAudioTrack = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const diagnosticStream = {
      getAudioTracks: () => [diagnosticAudioTrack],
      getTracks: () => [diagnosticVideoTrack, diagnosticAudioTrack],
      getVideoTracks: () => [diagnosticVideoTrack],
    } as unknown as MediaStream;
    const videoStub: Record<string, unknown> = {
      duration: 5400,
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
      captureStream: vi.fn(() => diagnosticStream),
      removeAttribute: vi.fn(),
    };
    Object.defineProperty(videoStub, "src", {
      set(_src: string) {
        void _src;
        Promise.resolve().then(() => {
          (videoStub.onloadedmetadata as (() => void) | null)?.();
        });
      },
    });

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video" ? (videoStub as unknown as HTMLElement) : realCreateElement(tagName),
    );

    renderPage();

    await screen.findByText("Сервис готов");
    await user.clear(screen.getByLabelText("Имя host"));
    await user.type(screen.getByLabelText("Имя host"), "Dima");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await screen.findByText("Видеофайл");

    expect(document.querySelector(".home--room")).toBeInTheDocument();
    expect(document.querySelector(".room-card--chat")).toBeInTheDocument();
    expect(document.querySelector(".room-card--participants")).toBeInTheDocument();
    expect(document.querySelector(".workspace-diagnostics")).not.toHaveAttribute("open");

    const file = new File([""], "movie.mp4", { type: "video/mp4" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const dropzone = document.querySelector(".file-picker--dropzone") as HTMLDivElement;
    expect(input.accept).toBe(".mp4,.m4v,.webm,video/mp4,video/x-m4v,video/webm");
    expect(
      screen.getByText("Поддерживаются MP4/M4V (H.264/AAC) и WebM (VP8/VP9/Opus)."),
    ).toBeInTheDocument();
    fireEvent.dragOver(dropzone, { dataTransfer: { dropEffect: "none", files: [file] } });
    expect(dropzone).toHaveClass("file-picker--dropzone-active");
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("movie.mp4")).toBeInTheDocument();
    });
    expect(screen.getByText(/MP4 · 1920×1080 · 1:30:00/)).toBeInTheDocument();
    expect(
      screen.getByText("Проверено: Можно транслировать с этого устройства"),
    ).toBeInTheDocument();
  });

  it("host публикует выбранный файл в LiveKit и останавливает публикацию", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:movie-url");
    vi.spyOn(URL, "revokeObjectURL");

    const videoTrack = createTrack("video");
    const audioTrack = createTrack("audio");
    const publishStream = createStream([videoTrack], [audioTrack]);
    const realCreateElement = document.createElement.bind(document);
    const videoStubs = [
      createVideoStub(undefined, realCreateElement),
      createVideoStub(publishStream, realCreateElement),
    ];
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video"
        ? (videoStubs.shift() ?? createVideoStub(publishStream, realCreateElement))
        : realCreateElement(tagName),
    );

    renderPage();

    await screen.findByText("Сервис готов");
    await user.clear(screen.getByLabelText("Имя host"));
    await user.type(screen.getByLabelText("Имя host"), "Dima");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await screen.findByText("LiveKit: подключён");
    await screen.findByText("Видеофайл");

    const file = new File([""], "movie.mp4", { type: "video/mp4" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await screen.findByText("movie.mp4");
    await user.click(screen.getByRole("button", { name: "Опубликовать" }));

    expect(await screen.findByText("Live · 2 дорожки")).toBeInTheDocument();
    expect(await screen.findByText("Совместный просмотр")).toBeInTheDocument();
    const hostPreview = document.querySelector(".remote-player__video") as HTMLVideoElement;
    expect(hostPreview.srcObject).toBe(publishStream);
    expect(hostPreview.muted).toBe(false);
    expect(liveKitMock.rooms[0]?.localParticipant.publishTrack).toHaveBeenCalledWith(
      videoTrack,
      expect.objectContaining({ name: "movie-video", source: "camera" }),
    );
    expect(liveKitMock.rooms[0]?.localParticipant.publishTrack).toHaveBeenCalledWith(
      audioTrack,
      expect.objectContaining({ name: "movie-audio", source: "screen_share_audio" }),
    );

    await user.click(screen.getByRole("button", { name: "Остановить" }));

    await waitFor(() => {
      expect(liveKitMock.rooms[0]?.localParticipant.unpublishTrack).toHaveBeenCalledWith(
        videoTrack,
        true,
      );
    });
    expect(liveKitMock.rooms[0]?.localParticipant.unpublishTrack).toHaveBeenCalledWith(
      audioTrack,
      true,
    );
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
  });

  it("ошибка диагностики файла отображается в file picker", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "UP", checkedAt: "2026-07-10T10:00:00Z" }), {
            status: 200,
          }),
        );
      }

      if (url.endsWith("/version")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: "watch-together-backend",
              version: "0.1.0",
              buildTime: "2026-07-10T10:00:00Z",
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

      if (url.endsWith(`/api/v1/rooms/${roomId}/livekit-token`) && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              token: "header.payload.signature",
              liveKitUrl: "ws://127.0.0.1:7880",
              roomName: roomId,
              participantId: hostId,
              participantIdentity: hostId,
              role: "HOST",
              canPublish: true,
              canPublishData: true,
              expiresAt: "2026-07-10T11:00:00Z",
            }),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:movie-url");
    vi.spyOn(URL, "revokeObjectURL");

    const videoStub: Record<string, unknown> = {
      duration: 0,
      videoWidth: 0,
      preload: "",
      onloadedmetadata: null,
      onerror: null,
      canPlayType: vi.fn().mockReturnValue(""),
      captureStream: vi.fn(),
    };
    Object.defineProperty(videoStub, "src", {
      set(_src: string) {
        void _src;
        Promise.resolve().then(() => {
          (videoStub.onloadedmetadata as (() => void) | null)?.();
        });
      },
    });

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) =>
      tagName === "video" ? (videoStub as unknown as HTMLElement) : realCreateElement(tagName),
    );

    renderPage();

    await screen.findByText("Сервис готов");
    await user.clear(screen.getByLabelText("Имя host"));
    await user.type(screen.getByLabelText("Имя host"), "Dima");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await screen.findByText("Видеофайл");

    const file = new File([""], "video.mkv", { type: "video/x-matroska" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Этот контейнер пока не поддерживается в браузерной версии. Поддерживаются MP4/M4V (H.264/AAC) и WebM (VP8/VP9/Opus).",
        ),
      ).toBeInTheDocument();
    });
  });
});

function createTrack(kind: MediaStreamTrack["kind"]) {
  return {
    kind,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function createRemoteTrack(kind: "audio" | "video") {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    kind,
  };
}

function createStream(videoTracks: MediaStreamTrack[], audioTracks: MediaStreamTrack[] = []) {
  return {
    getAudioTracks: () => audioTracks,
    getTracks: () => [...videoTracks, ...audioTracks],
    getVideoTracks: () => videoTracks,
  } as unknown as MediaStream;
}

function createVideoStub(
  stream = createStream([createTrack("video")]),
  createElement: typeof document.createElement = document.createElement.bind(document),
) {
  const listeners = new Map<string, Set<() => void>>();
  const stub = createElement("video") as HTMLVideoElement & {
    captureStream: () => MediaStream;
  };

  Object.defineProperties(stub, {
    duration: { configurable: true, value: 5400 },
    ended: { configurable: true, value: false },
    paused: { configurable: true, value: false },
    readyState: { configurable: true, value: 0 },
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
  });

  Object.assign(stub, {
    canPlayType: vi.fn().mockReturnValue("probably"),
    captureStream: vi.fn(() => stream),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    requestVideoFrameCallback: vi.fn((callback: () => void) => {
      void Promise.resolve().then(callback);
      return 1;
    }),
    cancelVideoFrameCallback: vi.fn(),
  });

  const addEventListener = stub.addEventListener.bind(stub);
  const removeEventListener = stub.removeEventListener.bind(stub);
  stub.addEventListener = vi.fn(
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      const callback = listener as () => void;
      listeners.set(type, new Set([...(listeners.get(type) ?? []), callback]));
      addEventListener(type, listener, options);
    },
  );
  stub.removeEventListener = vi.fn(
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      listeners.get(type)?.delete(listener as () => void);
      removeEventListener(type, listener, options);
    },
  );

  Object.defineProperty(stub, "src", {
    set(_src: string) {
      void _src;
      Promise.resolve().then(() => {
        (stub.onloadedmetadata as (() => void) | null)?.();
        for (const listener of listeners.get("loadedmetadata") ?? []) {
          listener();
        }
      });
    },
  });

  return stub;
}

function createPlaybackPayload(
  overrides: Partial<{
    currentTime: number;
    duration: number | null;
    event: string;
    fileName: string | null;
    revision: number;
    status: string;
  }> = {},
) {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      event: "play",
      status: "playing",
      currentTime: 12,
      duration: 60,
      sentAt: "2026-07-10T10:30:00.000Z",
      fileName: "movie.mp4",
      ...overrides,
    }),
  );
}

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
