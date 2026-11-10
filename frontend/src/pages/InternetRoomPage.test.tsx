import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectLiveKitRoom = vi.fn();

vi.mock("../features/rooms/livekit-connection", () => ({
  connectLiveKitRoom: (...args: unknown[]) => connectLiveKitRoom(...args),
}));

import { InternetRoomPage } from "./InternetRoomPage";

const publicRoomId = "22222222-2222-4222-8222-222222222222";

const roomAccess = {
  room: {
    publicRoomId,
    status: "OPEN",
    memberLimit: 4,
    createdAt: "2026-11-07T18:00:00Z",
    expiresAt: "2026-11-07T20:00:00Z",
  },
  membership: {
    role: "GUEST",
    joinedAt: "2026-11-07T18:05:00Z",
  },
};

const publicToken = {
  token: "header.payload.signature-value",
  liveKitUrl: "wss://rtc.example.test",
  roomName: "r".repeat(43),
  participantId: "33333333-3333-4333-8333-333333333333",
  participantIdentity: "p".repeat(43),
  role: "GUEST" as const,
  canPublish: true,
  canPublishData: true,
  expiresAt: "2026-11-07T18:10:00Z",
};

function renderRoom(roomId = publicRoomId) {
  return render(
    <MemoryRouter initialEntries={[`/internet/rooms/${roomId}`]}>
      <Routes>
        <Route path="/internet/rooms/:publicRoomId" element={<InternetRoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function problem(status: number, code: string) {
  return {
    ok: false,
    status,
    statusText: "Error",
    json: async () => ({ code, status }),
  };
}

beforeEach(() => {
  connectLiveKitRoom.mockReset();
  connectLiveKitRoom.mockImplementation(
    async (_token: unknown, handlers: { onStatusChange: (status: string) => void }) => {
      handlers.onStatusChange("connected");
      return {
        disconnect: vi.fn(),
        room: {},
      };
    },
  );
});

afterEach(() => {
  cleanup();
  delete window.spectemusDesktop;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InternetRoomPage", () => {
  it("browser guest получает token по cookie API и подключается к public LiveKit", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(await screen.findByRole("heading", { name: "Подключено" })).toBeInTheDocument();
    expect(screen.getByText(/Роль: гость/)).toBeInTheDocument();
    expect(screen.getByText(/Передача фильма появится отдельным шагом/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/public-rooms/${publicRoomId}`,
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/public-rooms/${publicRoomId}/livekit-token`,
        expect.objectContaining({ method: "POST", credentials: "include" }),
      );
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/rooms/"))).toBe(
      false,
    );
    expect(connectLiveKitRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        token: publicToken.token,
        liveKitUrl: "wss://rtc.example.test",
      }),
      expect.any(Object),
    );
    expect(connectLiveKitRoom.mock.calls[0]?.[0]).not.toHaveProperty("deviceCredential");
    expect(connectLiveKitRoom.mock.calls[0]?.[0]).not.toHaveProperty("apiOrigin");
  });

  it("desktop owner mintит token через IPC и не ходит в cookie GET membership", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const mintPublicLiveKitToken = vi.fn().mockResolvedValue({
      ...publicToken,
      role: "HOST",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      mintPublicLiveKitToken,
    };

    renderRoom();

    expect(await screen.findByRole("heading", { name: "Подключено" })).toBeInTheDocument();
    expect(screen.getByText(/Роль: хозяин/)).toBeInTheDocument();
    expect(mintPublicLiveKitToken).toHaveBeenCalledWith(publicRoomId);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectLiveKitRoom).toHaveBeenCalledWith(
      expect.objectContaining({ liveKitUrl: "wss://rtc.example.test", role: "HOST" }),
      expect.any(Object),
    );
  });

  it("при выключенном feature не ходит в API и не подключает LiveKit", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(screen.getByRole("heading", { name: "Комната недоступна" })).toBeInTheDocument();
    expect(screen.getByText(/Просмотр из другого города пока закрыт/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectLiveKitRoom).not.toHaveBeenCalled();
  });

  it("при 401 на membership показывает понятный текст без успеха", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue(problem(401, "ACCOUNT_REQUIRED"));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(
      await screen.findByText("Войдите по приглашению, чтобы открыть эту комнату."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Комната недоступна" })).toBeInTheDocument();
    expect(connectLiveKitRoom).not.toHaveBeenCalled();
  });

  it("revoked membership (404) не получает LiveKit token", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue(problem(404, "MEMBERSHIP_REQUIRED"));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(await screen.findByText("Комната недоступна для этого аккаунта.")).toBeInTheDocument();
    expect(connectLiveKitRoom).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("livekit-token"))).toBe(false);
  });

  it("показывает понятные тексты для 401/404/429 на mint token", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");

    const cases = [
      {
        problem: problem(401, "ACCOUNT_REQUIRED"),
        text: "Сессия входа закончилась. Войдите снова и подключитесь.",
        canRetry: false,
      },
      {
        problem: problem(404, "MEMBERSHIP_REQUIRED"),
        text: "Комната недоступна для этого аккаунта.",
        canRetry: false,
      },
      {
        problem: problem(429, "RATE_LIMITED"),
        text: "Слишком много попыток подключения. Подождите немного и попробуйте снова.",
        canRetry: true,
      },
    ] as const;

    for (const item of cases) {
      cleanup();
      delete window.spectemusDesktop;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(okJson(roomAccess))
        .mockResolvedValueOnce(item.problem);
      vi.stubGlobal("fetch", fetchMock);
      renderRoom();
      expect(await screen.findByText(item.text)).toBeInTheDocument();
      expect(connectLiveKitRoom).not.toHaveBeenCalled();
      if (item.canRetry) {
        expect(screen.getByRole("button", { name: "Подключить снова" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "Подключить снова" })).not.toBeInTheDocument();
      }
      connectLiveKitRoom.mockClear();
    }
  });

  it("desktop IPC 401/404/429 показывает те же тексты без бесполезного retry на 401/404", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const cases = [
      {
        ipcProblem: {
          name: "ApiProblemError",
          code: "ACCOUNT_REQUIRED",
          status: 401,
          title: "Нужен вход",
          retryable: false,
        },
        text: "Сессия входа закончилась. Войдите снова и подключитесь.",
        canRetry: false,
      },
      {
        ipcProblem: {
          name: "ApiProblemError",
          code: "MEMBERSHIP_REQUIRED",
          status: 404,
          title: "Комната недоступна",
          retryable: false,
        },
        text: "Комната недоступна для этого аккаунта.",
        canRetry: false,
      },
      {
        ipcProblem: {
          name: "ApiProblemError",
          code: "RATE_LIMITED",
          status: 429,
          title: "Слишком много попыток",
          retryable: true,
        },
        text: "Слишком много попыток подключения. Подождите немного и попробуйте снова.",
        canRetry: true,
      },
    ] as const;

    for (const item of cases) {
      cleanup();
      const mintPublicLiveKitToken = vi.fn().mockRejectedValue(item.ipcProblem);
      vi.stubGlobal("fetch", vi.fn());
      window.spectemusDesktop = {
        getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
        onRuntimeStatus: () => () => undefined,
        restartRuntime: async () => ({ detail: "ok", state: "ready" }),
        mintPublicLiveKitToken,
      };
      renderRoom();
      expect(await screen.findByText(item.text)).toBeInTheDocument();
      expect(connectLiveKitRoom).not.toHaveBeenCalled();
      if (item.canRetry) {
        expect(screen.getByRole("button", { name: "Подключить снова" })).toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "Подключить снова" })).not.toBeInTheDocument();
      }
      connectLiveKitRoom.mockClear();
    }
  });

  it("после временной ошибки повторное подключение работает", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(problem(503, "PUBLIC_LIVEKIT_UNAVAILABLE"))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(await screen.findByText(/Public LiveKit временно недоступен/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Подключить снова" }));
    expect(await screen.findByRole("heading", { name: "Подключено" })).toBeInTheDocument();
    expect(connectLiveKitRoom).toHaveBeenCalledTimes(1);
  });

  it("при unmount вызывает disconnect", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const disconnect = vi.fn();
    connectLiveKitRoom.mockImplementation(
      async (_token: unknown, handlers: { onStatusChange: (status: string) => void }) => {
        handlers.onStatusChange("connected");
        return { disconnect, room: {} };
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);

    const view = renderRoom();
    expect(await screen.findByRole("heading", { name: "Подключено" })).toBeInTheDocument();
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("отклоняет битый publicRoomId без API и LiveKit", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderRoom("not-a-room-id");

    expect(screen.getByText(/Ссылка на комнату повреждена/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(connectLiveKitRoom).not.toHaveBeenCalled();
  });
});
