import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { InternetInvitePage } from "./InternetInvitePage";

const token = "b".repeat(43);

function renderInvite(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <InternetInvitePage />
    </MemoryRouter>,
  );
}

describe("InternetInvitePage", () => {
  it("не показывает управление host-а и не раскрывает invite token", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderInvite(`/join#invite=${token}`);

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
    fetchMock.mockRestore();
  });

  it("объясняет неполную ссылку без формы создания комнаты", () => {
    renderInvite("/join");

    expect(screen.getByText(/Откройте полную ссылку/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Имя host")).not.toBeInTheDocument();
  });
});
