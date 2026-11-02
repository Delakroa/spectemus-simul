import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { createAppQueryClient } from "./query-client";

describe("App", () => {
  afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem?.("spectemusSimul.operatorToken");
  });

  it("показывает страницу 404 для неизвестного маршрута", () => {
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <MemoryRouter initialEntries={["/missing"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Такой страницы нет" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "На главную" })).toHaveAttribute("href", "/");
  });

  it("открывает приглашение Internet-комнаты без формы host-а", () => {
    const inviteToken = "c".repeat(43);

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <MemoryRouter initialEntries={[`/join#invite=${inviteToken}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Просмотр из другого города пока закрыт" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Такой страницы нет" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Имя host")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(inviteToken);
  });

  it("открывает operator dashboard route", () => {
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <MemoryRouter initialEntries={["/operator"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Операторская панель" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Оператор" })).toHaveAttribute("href", "/operator");
  });
});
