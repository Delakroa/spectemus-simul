import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InternetLinkPage } from "./InternetLinkPage";

const bindingId = "11111111-1111-4111-8111-111111111111";
const accountProfile = {
  accountId: "22222222-2222-4222-8222-222222222222",
  displayName: "Host",
  createdAt: "2026-11-10T10:00:00Z",
};

function renderLink(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/internet/link" element={<InternetLinkPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function jsonResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body ?? {},
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InternetLinkPage", () => {
  it("при выключенном feature не ходит в API", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderLink(`/internet/link#binding=${bindingId}`);
    expect(screen.getByText(/Подтверждение desktop-привязки сейчас закрыто/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("подтверждает привязку для существующего account и поддерживает отмену", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.endsWith(`/api/v2/auth/device-bindings/${bindingId}/approve`)) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ userCode: "ABCD-EFGH" }));
        expect(url.includes("ABCD-EFGH")).toBe(false);
        return jsonResponse(204);
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLink(`/internet/link#binding=${bindingId}`);
    expect(await screen.findByLabelText("Код из приложения")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Код из приложения"), "ABCD-EFGH");
    await user.click(screen.getByRole("button", { name: "Подтвердить привязку" }));
    expect(
      await screen.findByText(/Привязка подтверждена. Вернитесь в desktop-приложение/),
    ).toBeInTheDocument();

    cleanup();
    renderLink(`/internet/link#binding=${bindingId}`);
    expect(await screen.findByLabelText("Код из приложения")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(await screen.findByText(/Подтверждение отменено/)).toBeInTheDocument();
  });

  it("показывает ошибку недоступной привязки без raw detail", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v2/account")) {
        return jsonResponse(200, accountProfile);
      }
      if (url.includes("/approve")) {
        return jsonResponse(404, {
          code: "DEVICE_BINDING_UNAVAILABLE",
          status: 404,
          title: "Unavailable",
          detail: "expired jdbc secret",
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLink(`/internet/link#binding=${bindingId}`);
    await user.type(await screen.findByLabelText("Код из приложения"), "ABCD-EFGH");
    await user.click(screen.getByRole("button", { name: "Подтвердить привязку" }));
    expect(
      await screen.findByText("Привязка недействительна или больше не доступна."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/jdbc|expired/i);
  });

  it("unmount отменяет активный запрос", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    vi.stubEnv("VITE_INTERNET_APP_ORIGIN", "https://app.example.test");
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const view = renderLink(`/internet/link#binding=${bindingId}`);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    view.unmount();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
