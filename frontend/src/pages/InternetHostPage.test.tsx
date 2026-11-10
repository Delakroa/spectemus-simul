import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternetHostPage } from "./InternetHostPage";
import { createAppQueryClient } from "../app/query-client";

const publicRoomId = "22222222-2222-4222-8222-222222222222";
const challengeId = "33333333-3333-4333-8333-333333333333";
const inviteToken = "d".repeat(43);

const accountProfile = {
  accountId: "11111111-1111-4111-8111-111111111111",
  displayName: "Хозяин",
  createdAt: "2026-11-10T08:00:00Z",
};

const roomAccess = {
  room: {
    publicRoomId,
    status: "OPEN",
    memberLimit: 4,
    createdAt: "2026-11-10T08:00:00Z",
    expiresAt: "2026-11-10T11:00:00Z",
  },
  membership: {
    role: "OWNER",
    joinedAt: "2026-11-10T08:00:00Z",
  },
};

const invite = {
  inviteId: "44444444-4444-4444-8444-444444444444",
  invitePath: `/join#invite=${inviteToken}`,
  expiresAt: "2026-11-10T11:00:00Z",
  maxRedemptions: 3,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => body,
  };
}

function renderPage() {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InternetHostPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.spectemusDesktop;
  globalThis.localStorage?.clear?.();
  globalThis.sessionStorage?.clear?.();
});

describe("InternetHostPage", () => {
  it("при выключенном feature не делает запросов", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Internet-комната пока закрыта" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("без public HTTPS origin не создаёт локальное приглашение", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "http://127.0.0.1:8088");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(
      screen.getByRole("heading", { name: "Internet-комната не настроена" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/публичный HTTPS-адрес/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("существующий account создаёт комнату и public invite без LAN API", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/public-rooms")) {
        return jsonResponse(201, roomAccess);
      }
      if (url.endsWith(`/api/v2/public-rooms/${publicRoomId}/invites`)) {
        return jsonResponse(201, invite);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    expect(await screen.findByText(/Вход подтверждён: Хозяин/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Создать комнату" }));

    const expectedUrl = `https://app.example.test/join#invite=${inviteToken}`;
    expect(await screen.findByDisplayValue(expectedUrl)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Перейти к комнате" })).toHaveAttribute(
      "href",
      `/internet/rooms/${publicRoomId}`,
    );
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/v1/"))).toBe(true);
    expect(JSON.stringify({ ...globalThis.localStorage })).not.toContain(inviteToken);
    expect(JSON.stringify({ ...globalThis.sessionStorage })).not.toContain(inviteToken);
  });

  it("проводит нового host через email challenge", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(401, { code: "ACCOUNT_REQUIRED", status: 401 });
      }
      if (url.endsWith("/api/v2/auth/email-challenges")) {
        expect(init?.body).toBe(JSON.stringify({ email: "host@example.test" }));
        return jsonResponse(202, {
          challengeId,
          expiresAt: "2026-11-10T08:10:00Z",
        });
      }
      if (url.endsWith(`/api/v2/auth/email-challenges/${challengeId}/verify`)) {
        expect(init?.body).toBe(JSON.stringify({ code: "ABC123", displayName: "Хозяин" }));
        return jsonResponse(200, accountProfile);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();

    await user.type(await screen.findByLabelText("Email"), "host@example.test");
    await user.click(screen.getByRole("button", { name: "Получить код" }));
    await user.type(await screen.findByLabelText("Одноразовый код"), "ABC123");
    await user.type(screen.getByLabelText("Ваше имя"), "Хозяин");
    await user.click(screen.getByRole("button", { name: "Подтвердить" }));

    expect(await screen.findByText(/Вход подтверждён: Хозяин/)).toBeInTheDocument();
  });

  it("после временного сбоя invite повторяет только invite с тем же ключом", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    let roomCalls = 0;
    const inviteKeys: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/public-rooms")) {
        roomCalls += 1;
        return jsonResponse(201, roomAccess);
      }
      if (url.endsWith(`/api/v2/public-rooms/${publicRoomId}/invites`)) {
        const headers = init?.headers as Record<string, string>;
        inviteKeys.push(headers["Idempotency-Key"]);
        return inviteKeys.length === 1
          ? jsonResponse(503, { code: "TEMPORARY", status: 503 })
          : jsonResponse(201, invite);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать комнату" }));
    expect(await screen.findByText(/Не удалось связаться с Internet-сервисом/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(screen.getByDisplayValue(/\/join#invite=/)).toBeInTheDocument());
    expect(roomCalls).toBe(1);
    expect(inviteKeys).toHaveLength(2);
    expect(inviteKeys[1]).toBe(inviteKeys[0]);
  });

  it("в desktop предлагает browser binding без передачи credential в renderer", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const opened: string[] = [];
    let bound = false;
    let releasePoll!: () => void;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    window.spectemusDesktop = {
      getRuntimeStatus: async () => ({ detail: "ok", state: "ready" }),
      onRuntimeStatus: () => () => undefined,
      restartRuntime: async () => ({ detail: "ok", state: "ready" }),
      getDeviceBindingStatus: async () =>
        bound
          ? {
              bound: true,
              profile: {
                accountId: accountProfile.accountId,
                displayName: accountProfile.displayName,
              },
              expiresAt: "2026-11-24T10:00:00Z",
            }
          : { bound: false },
      startDeviceBinding: async () => ({
        bindingId: "11111111-1111-4111-8111-111111111111",
        userCode: "ABCD-EFGH",
        verificationUri:
          "https://app.example.test/internet/link#binding=11111111-1111-4111-8111-111111111111",
        expiresAt: "2026-11-10T10:10:00Z",
        intervalSeconds: 0,
      }),
      openDeviceBinding: async (uri) => {
        opened.push(uri);
      },
      pollDeviceBinding: async () => {
        await pollGate;
        bound = true;
        return {
          status: "bound" as const,
          profile: {
            accountId: accountProfile.accountId,
            displayName: accountProfile.displayName,
          },
          expiresAt: "2026-11-24T10:00:00Z",
        };
      },
      cancelDeviceBinding: async () => ({ cancelled: true }),
      clearDeviceBinding: async () => {
        bound = false;
        return { bound: false };
      },
      createPublicRoomWithDeviceBinding: async () => roomAccess,
      createPublicInviteWithDeviceBinding: async () => invite,
    };

    renderPage();
    expect(
      await screen.findByText(/подтвердите аккаунт в системном браузере/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Подтвердить аккаунт в браузере" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(opened[0]).toContain("/internet/link#binding=");
    expect(opened[0]).not.toMatch(/deviceCode|deviceCredential|@[A-Za-z]/);
    releasePoll();
    expect(await screen.findByText(/Desktop привязан: Хозяин/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Создать комнату" }));
    expect(
      await screen.findByDisplayValue(`https://app.example.test/join#invite=${inviteToken}`),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/deviceCredential|deviceCode/);
  });

  it("после невосстановимого replay invite создаёт новый invite key", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    let roomCalls = 0;
    const inviteKeys: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/public-rooms")) {
        roomCalls += 1;
        return jsonResponse(201, roomAccess);
      }
      if (url.endsWith(`/api/v2/public-rooms/${publicRoomId}/invites`)) {
        const headers = init?.headers as Record<string, string>;
        inviteKeys.push(headers["Idempotency-Key"]);
        return inviteKeys.length === 1
          ? jsonResponse(409, {
              code: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
              status: 409,
            })
          : jsonResponse(201, invite);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await user.click(await screen.findByRole("button", { name: "Создать комнату" }));
    expect(await screen.findByText(/Прежнюю ссылку нельзя восстановить/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => expect(screen.getByDisplayValue(/\/join#invite=/)).toBeInTheDocument());
    expect(roomCalls).toBe(1);
    expect(inviteKeys).toHaveLength(2);
    expect(inviteKeys[1]).not.toBe(inviteKeys[0]);
  });
});
