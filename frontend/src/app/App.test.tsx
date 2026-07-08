import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";
import { createAppQueryClient } from "./query-client";

describe("App", () => {
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
});
