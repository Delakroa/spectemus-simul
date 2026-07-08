import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { createAppQueryClient } from "../app/query-client";
import { HomePage } from "./HomePage";

function renderPage() {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HomePage", () => {
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
});
