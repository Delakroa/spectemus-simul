import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopRuntimeStatusIndicator } from "./DesktopRuntimeStatus";

describe("DesktopRuntimeStatusIndicator", () => {
  let notify: ((status: { detail: string; state: string }) => void) | undefined;
  let restartCalls: number;
  let restartRuntime: () => Promise<{ detail: string; state: string }>;

  beforeEach(() => {
    notify = undefined;
    restartCalls = 0;
    restartRuntime = async () => {
      restartCalls += 1;
      return { detail: "Запускаем локальный backend.", state: "starting-backend" };
    };
    window.spectemusDesktop = {
      getRuntimeStatus: vi.fn().mockResolvedValue({
        detail: "Host готов.",
        state: "running",
      }),
      restartRuntime: async () => restartRuntime(),
      onRuntimeStatus: (listener) => {
        notify = listener;
        return () => {
          notify = undefined;
        };
      },
    };
  });

  it("даёт перезапустить desktop host после аварии sidecar", async () => {
    const user = userEvent.setup();
    render(<DesktopRuntimeStatusIndicator />);

    await screen.findByText("Desktop host: готов");
    act(() => {
      notify?.({
        detail: "LiveKit завершился неожиданно (код 1).",
        state: "error",
      });
    });

    await user.click(screen.getByRole("button", { name: "Перезапустить" }));

    expect(restartCalls).toBe(1);
  });
});
