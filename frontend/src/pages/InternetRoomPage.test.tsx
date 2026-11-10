import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectLiveKitRoom = vi.fn();
const publishFileToLiveKit = vi.fn();
const stopFilePublication = vi.fn();
const diagnoseMediaSource = vi.fn();

vi.mock("../features/rooms/livekit-connection", () => ({
  connectLiveKitRoom: (...args: unknown[]) => connectLiveKitRoom(...args),
}));

vi.mock("../features/rooms/file-publication", () => ({
  FilePublicationFailure: class FilePublicationFailure extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "FilePublicationFailure";
    }
  },
  publishFileToLiveKit: (...args: unknown[]) => publishFileToLiveKit(...args),
  stopFilePublication: (...args: unknown[]) => stopFilePublication(...args),
}));

vi.mock("../features/rooms/file-diagnostics", async () => {
  const actual = await vi.importActual<typeof import("../features/rooms/file-diagnostics")>(
    "../features/rooms/file-diagnostics",
  );
  return {
    ...actual,
    diagnoseMediaSource: (...args: unknown[]) => diagnoseMediaSource(...args),
  };
});

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

function createMockLiveKitRoom(
  publications: Array<{
    track: {
      attach: ReturnType<typeof vi.fn>;
      detach: ReturnType<typeof vi.fn>;
      kind: string;
      name: string;
    };
    trackName: string;
    source?: string;
  }> = [],
) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const participant = {
    identity: "host-participant",
    trackPublications: new Map(
      publications.map((publication) => [publication.trackName, publication]),
    ),
  };
  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
    localParticipant: { publishTrack: vi.fn() },
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, new Set([...(handlers.get(event) ?? []), handler]));
    }),
    remoteParticipants: new Map([[participant.identity, participant]]),
  };
}

let mockLiveKitRoom = createMockLiveKitRoom();

beforeEach(() => {
  connectLiveKitRoom.mockReset();
  publishFileToLiveKit.mockReset();
  stopFilePublication.mockReset();
  diagnoseMediaSource.mockReset();
  mockLiveKitRoom = createMockLiveKitRoom();
  diagnoseMediaSource.mockResolvedValue({
    compatibility: "native",
    displayName: "film.mp4",
    durationMs: 1000,
    format: "mp4",
    formatLabel: "MP4",
    hasAudio: true,
    hasVideo: true,
    height: 720,
    mimeType: "video/mp4",
    normalization: "direct",
    objectUrl: "/_desktop/media/media-1",
    verdict: "CAN_STREAM",
    verdictLabel: "ok",
    width: 1280,
  });
  publishFileToLiveKit.mockResolvedValue({
    audioTrack: {},
    stream: { getTracks: () => [] },
    tracks: [{}, {}],
    videoElement: document.createElement("video"),
    videoTrack: {},
  });
  connectLiveKitRoom.mockImplementation(
    async (_token: unknown, handlers: { onStatusChange: (status: string) => void }) => {
      handlers.onStatusChange("connected");
      return {
        disconnect: vi.fn(),
        room: mockLiveKitRoom,
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

    expect(await screen.findByRole("heading", { name: "Ждём фильм" })).toBeInTheDocument();
    expect(screen.getByText(/Роль: гость/)).toBeInTheDocument();
    expect(screen.getByText(/Хозяин ещё не опубликовал фильм/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать файл" })).not.toBeInTheDocument();
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

  it("desktop owner mintит token через IPC envelope и публикует локальный фильм", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const user = userEvent.setup();
    const mintPublicLiveKitToken = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...publicToken,
        role: "HOST",
      },
    });
    const pickMediaFile = vi.fn().mockResolvedValue({
      displayName: "film.mp4",
      id: "media-1",
      isNormalized: false,
      playbackName: "film.mp4",
    });
    const releaseMedia = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      mintPublicLiveKitToken,
      pickMediaFile,
      releaseMedia,
    };

    renderRoom();

    expect(await screen.findByRole("heading", { name: "Подключено" })).toBeInTheDocument();
    expect(screen.getByText(/Роль: хозяин/)).toBeInTheDocument();
    expect(mintPublicLiveKitToken).toHaveBeenCalledWith(publicRoomId);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/когда хозяин начнёт передачу/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Выбрать файл" }));
    expect(await screen.findByText(/Файл готов: film.mp4/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(await screen.findByRole("heading", { name: "Фильм опубликован" })).toBeInTheDocument();
    expect(publishFileToLiveKit).toHaveBeenCalled();
    expect(screen.getByText(/movie-video/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать файл" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Остановить публикацию" }));
    expect(stopFilePublication).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Выбрать файл" })).toBeInTheDocument();
  });

  it("browser guest воспроизводит movie tracks и показывает кнопку при блокировке autoplay", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const videoTrack = {
      attach: vi.fn(),
      detach: vi.fn(),
      kind: "video",
      name: "movie-video-track",
    };
    const audioTrack = {
      attach: vi.fn(),
      detach: vi.fn(),
      kind: "audio",
      name: "movie-audio-track",
    };
    const participant = {
      identity: "host-participant",
      trackPublications: new Map(),
    };

    renderRoom();
    expect(await screen.findByRole("heading", { name: "Ждём фильм" })).toBeInTheDocument();

    const video = document.querySelector("video");
    const audio = document.querySelector("audio");
    expect(video).not.toBeNull();
    expect(audio).not.toBeNull();
    const playVideo = vi.spyOn(video as HTMLVideoElement, "play").mockResolvedValue(undefined);
    vi.spyOn(audio as HTMLAudioElement, "play").mockResolvedValue(undefined);

    await waitFor(() => expect(mockLiveKitRoom.on).toHaveBeenCalled());
    mockLiveKitRoom.emit(
      "trackSubscribed",
      videoTrack,
      { track: videoTrack, trackName: "movie-video" },
      participant,
    );
    mockLiveKitRoom.emit(
      "trackSubscribed",
      audioTrack,
      { track: audioTrack, trackName: "movie-audio" },
      participant,
    );

    expect(await screen.findByRole("heading", { name: "Воспроизводим" })).toBeInTheDocument();
    expect(screen.getByText(/movie-video/)).toBeInTheDocument();
    expect(screen.getByText(/movie-audio/)).toBeInTheDocument();
    expect(videoTrack.attach).toHaveBeenCalled();
    expect(audioTrack.attach).toHaveBeenCalled();

    playVideo.mockRejectedValueOnce(
      Object.assign(new Error("Autoplay blocked"), { name: "NotAllowedError" }),
    );
    mockLiveKitRoom.emit(
      "trackUnsubscribed",
      videoTrack,
      { track: videoTrack, trackName: "movie-video" },
      participant,
    );
    mockLiveKitRoom.emit(
      "trackSubscribed",
      videoTrack,
      { track: videoTrack, trackName: "movie-video" },
      participant,
    );
    expect(await screen.findByRole("button", { name: "Запустить просмотр" })).toBeInTheDocument();
    playVideo.mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Запустить просмотр" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Запустить просмотр" })).not.toBeInTheDocument(),
    );
  });

  it("browser guest показывает поток прервался после остановки хозяина", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);

    const videoTrack = {
      attach: vi.fn(),
      detach: vi.fn(),
      kind: "video",
      name: "movie-video-track",
    };
    const participant = { identity: "host-participant", trackPublications: new Map() };

    renderRoom();
    expect(await screen.findByRole("heading", { name: "Ждём фильм" })).toBeInTheDocument();
    const video = document.querySelector("video");
    vi.spyOn(video as HTMLVideoElement, "play").mockResolvedValue(undefined);

    await waitFor(() => expect(mockLiveKitRoom.on).toHaveBeenCalled());
    const publication = { track: videoTrack, trackName: "movie-video" };
    mockLiveKitRoom.emit("trackSubscribed", videoTrack, publication, participant);
    expect(await screen.findByRole("heading", { name: "Воспроизводим" })).toBeInTheDocument();
    expect(screen.getByText(/без звука/)).toBeInTheDocument();

    mockLiveKitRoom.emit("trackUnsubscribed", videoTrack, publication, participant);
    expect(await screen.findByRole("heading", { name: "Поток прервался" })).toBeInTheDocument();
  });

  it("browser guest не видит управление файлом даже при desktop API в window", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      pickMediaFile: vi.fn(),
      releaseMedia: vi.fn(),
    };

    renderRoom();

    expect(await screen.findByText(/Роль: гость/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать файл" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
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

  it("desktop IPC envelope 401/404/429 показывает те же тексты без бесполезного retry на 401/404", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const cases = [
      {
        envelope: {
          ok: false as const,
          problem: {
            name: "ApiProblemError",
            code: "ACCOUNT_REQUIRED",
            status: 401,
            title: "Нужен вход",
            retryable: false,
          },
        },
        text: "Сессия входа закончилась. Войдите снова и подключитесь.",
        canRetry: false,
      },
      {
        envelope: {
          ok: false as const,
          problem: {
            name: "ApiProblemError",
            code: "MEMBERSHIP_REQUIRED",
            status: 404,
            title: "Комната недоступна",
            retryable: false,
          },
        },
        text: "Комната недоступна для этого аккаунта.",
        canRetry: false,
      },
      {
        envelope: {
          ok: false as const,
          problem: {
            name: "ApiProblemError",
            code: "RATE_LIMITED",
            status: 429,
            title: "Слишком много попыток",
            retryable: true,
          },
        },
        text: "Слишком много попыток подключения. Подождите немного и попробуйте снова.",
        canRetry: true,
      },
    ] as const;

    for (const item of cases) {
      cleanup();
      // Simulate preload returning the resolved IPC envelope (not a rejected promise).
      const mintPublicLiveKitToken = vi.fn().mockResolvedValue(structuredClone(item.envelope));
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
    expect(await screen.findByRole("heading", { name: "Ждём фильм" })).toBeInTheDocument();
    expect(connectLiveKitRoom).toHaveBeenCalledTimes(1);
  });

  it("при unmount вызывает disconnect", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const disconnect = vi.fn();
    connectLiveKitRoom.mockImplementation(
      async (_token: unknown, handlers: { onStatusChange: (status: string) => void }) => {
        handlers.onStatusChange("connected");
        return { disconnect, room: mockLiveKitRoom };
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okJson(roomAccess))
      .mockResolvedValueOnce(okJson(publicToken));
    vi.stubGlobal("fetch", fetchMock);

    const view = renderRoom();
    expect(await screen.findByRole("heading", { name: "Ждём фильм" })).toBeInTheDocument();
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
