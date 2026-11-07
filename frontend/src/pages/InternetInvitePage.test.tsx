import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternetInvitePage } from "./InternetInvitePage";
import { InternetRoomPage } from "./InternetRoomPage";

const token = "b".repeat(43);
const publicRoomId = "22222222-2222-4222-8222-222222222222";
const challengeId = "33333333-3333-4333-8333-333333333333";

const accountProfile = {
  accountId: "11111111-1111-4111-8111-111111111111",
  displayName: "Гость",
  createdAt: "2026-11-07T18:00:00Z",
};

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

function LocationProbe() {
  const location = useLocation();
  return (
    <div
      data-testid="location"
      data-pathname={location.pathname}
      data-hash={location.hash}
      data-search={location.search}
    />
  );
}

function renderGuestFlow(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/join" element={<InternetInvitePage />} />
        <Route path="/internet/rooms/:publicRoomId" element={<InternetRoomPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.localStorage?.clear?.();
  globalThis.sessionStorage?.clear?.();
});

describe("InternetInvitePage", () => {
  it("при выключенном feature не делает запросов и скрывает host UI", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderGuestFlow(`/join#invite=${token}`);

    expect(
      screen.getByRole("heading", { name: "Просмотр из другого города пока закрыт" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Приглашение распознано/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя host")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();
    expect(screen.queryByText("Видеофайл")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Выбрать файл" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Перемотка" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("объясняет неполную ссылку без формы создания комнаты", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    renderGuestFlow("/join");

    expect(screen.getByText(/Откройте полную ссылку/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Имя host")).not.toBeInTheDocument();
  });

  it("при включённом feature не отправляет missing/invalid fragment на backend", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderGuestFlow("/join");
    expect(screen.getByText(/Откройте полную ссылку/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    cleanup();
    renderGuestFlow("/join#invite=short");
    expect(screen.getByText(/Ссылка приглашения повреждена/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("существующий account сразу redeem-ит invite и убирает token из URL", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/invite-redemptions")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ inviteToken: token }));
        expect(url).not.toContain(token);
        return jsonResponse(200, roomAccess);
      }
      if (url.endsWith(`/api/v2/public-rooms/${publicRoomId}`)) {
        return jsonResponse(200, roomAccess);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderGuestFlow(`/join#invite=${token}`);

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveAttribute(
        "data-pathname",
        `/internet/rooms/${publicRoomId}`,
      );
    });
    expect(screen.getByTestId("location")).toHaveAttribute("data-hash", "");
    expect(await screen.findByText(/подключение просмотра готовится/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(token);
    expect(JSON.stringify({ ...globalThis.localStorage })).not.toContain(token);
    expect(JSON.stringify({ ...globalThis.sessionStorage })).not.toContain(token);
  });

  it("401 запускает email challenge → verify → redemption с тем же Idempotency-Key", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const user = userEvent.setup();
    let accountCalls = 0;
    const idempotencyKeys: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        accountCalls += 1;
        if (accountCalls === 1) {
          return jsonResponse(401, {
            code: "ACCOUNT_REQUIRED",
            status: 401,
            title: "Unauthorized",
          });
        }
        return jsonResponse(200, accountProfile);
      }
      if (url === "/api/v2/auth/email-challenges") {
        return jsonResponse(202, {
          challengeId,
          expiresAt: "2026-11-07T18:10:00Z",
        });
      }
      if (url.endsWith(`/api/v2/auth/email-challenges/${challengeId}/verify`)) {
        expect(init?.body).toBe(JSON.stringify({ code: "ABC123", displayName: "Гость Тест" }));
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/invite-redemptions")) {
        const headers = init?.headers as Record<string, string>;
        idempotencyKeys.push(headers["Idempotency-Key"]);
        expect(init?.body).toBe(JSON.stringify({ inviteToken: token }));
        if (idempotencyKeys.length === 1) {
          return jsonResponse(503, {
            code: "TEMPORARY",
            status: 503,
            title: "Unavailable",
            retryable: true,
          });
        }
        return jsonResponse(200, roomAccess);
      }
      if (url.endsWith(`/api/v2/public-rooms/${publicRoomId}`)) {
        return jsonResponse(200, roomAccess);
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderGuestFlow(`/join#invite=${token}`);

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя host")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "guest@example.test");
    await user.click(screen.getByRole("button", { name: "Получить код" }));

    expect(
      await screen.findByText(/Если этот адрес подходит, мы отправили одноразовый код/),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Одноразовый код"), "ABC123");
    await user.type(screen.getByLabelText("Ваше имя"), "Гость Тест");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(await screen.findByText(/Не удалось связаться с сервисом/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveAttribute(
        "data-pathname",
        `/internet/rooms/${publicRoomId}`,
      );
    });

    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toMatch(/^invite-redeem-/);
    expect(idempotencyKeys[0]).not.toContain(token);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(token))).toBe(true);
    expect(document.body.textContent).not.toContain(token);
  });

  it("INVITE_UNAVAILABLE не раскрывает expired/revoked/unknown", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith("/api/v2/invite-redemptions")) {
        return jsonResponse(404, {
          code: "INVITE_UNAVAILABLE",
          status: 404,
          title: "Invite unavailable",
          detail: "invite expired or revoked at 2026-01-01",
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderGuestFlow(`/join#invite=${token}`);

    expect(
      await screen.findByText("Приглашение недействительно или больше не доступно"),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/expired|revoked|unknown|jdbc|smtp/i);
    expect(document.body.textContent).not.toContain(token);
  });

  it("unmount отменяет активный запрос", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = renderGuestFlow(`/join#invite=${token}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    view.unmount();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
