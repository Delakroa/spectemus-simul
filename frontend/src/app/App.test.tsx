import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { createAppQueryClient } from "./query-client";

describe("App", () => {
  afterEach(() => {
    cleanup();
    globalThis.localStorage?.removeItem?.("watchTogether.operatorToken");
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
