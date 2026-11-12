import { describe, expect, it } from "vitest";

import {
  formatConnectionDiagnostics,
  initialConnectionDiagnostics,
  withConnectionQuality,
  withConnectionStatus,
} from "./connection-diagnostics";

describe("Internet connection diagnostics", () => {
  it("counts each reconnect attempt once and clears stale quality", () => {
    const connected = withConnectionStatus(initialConnectionDiagnostics, "connected");
    const good = withConnectionQuality(connected, "good");
    const reconnecting = withConnectionStatus(good, "reconnecting");

    expect(reconnecting).toEqual({ status: "reconnecting", quality: "unknown", reconnectCount: 1 });
    expect(withConnectionStatus(reconnecting, "reconnecting")).toBe(reconnecting);
    expect(withConnectionQuality(reconnecting, "excellent")).toBe(reconnecting);
    expect(withConnectionStatus(reconnecting, "connected")).toEqual({
      status: "connected",
      quality: "unknown",
      reconnectCount: 1,
    });
  });

  it("exports only allowlisted, human-readable fields", () => {
    const report = formatConnectionDiagnostics({
      status: "disconnected",
      quality: "unknown",
      reconnectCount: 2,
    });

    expect(report).toBe(
      "Spectemus Simul — Internet-комната\nСоединение: Соединение прервано\nКачество связи: Пока неизвестно\nПопыток автовосстановления: 2",
    );
    expect(report).not.toMatch(/token|https?:\/\/|wss?:\/\/|\.mp4|\.mkv/i);
  });
});
