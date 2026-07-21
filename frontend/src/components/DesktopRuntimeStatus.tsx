import { MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";

type DesktopRuntimeStatus = {
  detail: string;
  state: string;
  url?: string;
};

declare global {
  interface Window {
    spectemusDesktop?: {
      getRuntimeStatus: () => Promise<DesktopRuntimeStatus>;
      onRuntimeStatus: (listener: (status: DesktopRuntimeStatus) => void) => () => void;
    };
  }
}

export function DesktopRuntimeStatusIndicator() {
  const [status, setStatus] = useState<DesktopRuntimeStatus | null>(null);

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
  return (
    <span
      className={`desktop-runtime-status desktop-runtime-status--${statusClass}`}
      role="status"
      title={status.detail}
    >
      <MonitorPlay size={15} aria-hidden="true" />
      <span>Desktop host: {status.state === "running" ? "готов" : status.detail}</span>
    </span>
  );
}
