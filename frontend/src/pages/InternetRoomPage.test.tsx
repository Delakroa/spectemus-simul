import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={[`/internet/rooms/${publicRoomId}`]}>
      <Routes>
        <Route path="/internet/rooms/:publicRoomId" element={<InternetRoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InternetRoomPage", () => {
  it("проверяет membership и не обещает подключённое media", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    let resolveRoom: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRoom = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(screen.getByRole("heading", { name: "Проверяем доступ" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Доступ получен" })).not.toBeInTheDocument();

    resolveRoom?.({
      ok: true,
      status: 200,
      json: async () => roomAccess,
    });

    expect(await screen.findByRole("heading", { name: "Доступ получен" })).toBeInTheDocument();
    expect(screen.getByText(/подключение просмотра готовится/)).toBeInTheDocument();
    expect(screen.getByText(/Видео и LiveKit в этом шаге ещё не подключаются/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Опубликовать" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Перемотка" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v2/public-rooms/${publicRoomId}`,
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });
  });

  it("при выключенном feature не ходит в API и не показывает успех", () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(screen.getByRole("heading", { name: "Комната недоступна" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Доступ получен" })).not.toBeInTheDocument();
    expect(screen.getByText(/Просмотр из другого города пока закрыт/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("при 401 не показывает заголовок успеха", async () => {
    vi.stubEnv("VITE_INTERNET_ROOM_RUNTIME_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ code: "ACCOUNT_REQUIRED", status: 401 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRoom();

    expect(
      await screen.findByText("Войдите по приглашению, чтобы открыть эту комнату."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Комната недоступна" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Доступ получен" })).not.toBeInTheDocument();
  });
});
