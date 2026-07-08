import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "./ErrorBoundary";

function BrokenComponent(): never {
  throw new Error("test error");
}

describe("ErrorBoundary", () => {
  it("показывает резервный экран при ошибке React", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Не удалось открыть Watch Together" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить страницу" })).toBeInTheDocument();
  });
});
