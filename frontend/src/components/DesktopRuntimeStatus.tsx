import { MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";

import type { DesktopRuntimeStatus } from "../features/rooms/desktop-media";

export function DesktopRuntimeStatusIndicator() {
  const [status, setStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const desktop = window.spectemusDesktop;
    if (!desktop) {
      return undefined;
    }
    void desktop.getRuntimeStatus().then(setStatus);
    return desktop.onRuntimeStatus(setStatus);
  }, []);

  if (!status) {
    return null;
  }

  const statusClass =
    status.state === "running" ? "ready" : status.state === "error" ? "error" : "pending";
  const canRestart = status.state === "error" && !restarting;

  const restart = () => {
    const desktop = window.spectemusDesktop;
    if (!desktop || restarting) {
      return;
    }
    setRestarting(true);
    void desktop.restartRuntime().finally(() => setRestarting(false));
  };

  return (
    <div
      className={`desktop-runtime-status desktop-runtime-status--${statusClass}`}
      role="status"
      title={status.detail}
    >
      <MonitorPlay size={15} aria-hidden="true" />
      <span>Desktop host: {status.state === "running" ? "готов" : status.detail}</span>
      {status.state === "error" ? (
        <button
          className="desktop-runtime-status__restart"
          type="button"
          disabled={!canRestart}
          onClick={restart}
        >
          {restarting ? "Запускаем…" : "Перезапустить"}
        </button>
      ) : null}
    </div>
  );
}
