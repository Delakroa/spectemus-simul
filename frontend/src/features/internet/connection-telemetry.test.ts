import { describe, expect, it, vi } from "vitest";

import { createConnectionTelemetryTracker } from "./connection-telemetry";

describe("Internet connection telemetry tracker", () => {
  it("does not send anything before opt-in", () => {
    const emit = vi.fn();
    const tracker = createConnectionTelemetryTracker(emit);
    tracker.onStatus("connecting");
    tracker.onStatus("connected");
    tracker.onQuality("poor");
    expect(emit).not.toHaveBeenCalled();

    tracker.setEnabled(true);
    expect(emit.mock.calls.map(([event]) => event)).toEqual(["CONNECTED", "QUALITY_POOR"]);
  });

  it("deduplicates reconnect and quality events, and stops after opt-out", () => {
    const emit = vi.fn();
    const tracker = createConnectionTelemetryTracker(emit);
    tracker.setEnabled(true);
    tracker.onStatus("connecting");
    tracker.onStatus("connected");
    tracker.onStatus("connected");
    tracker.onQuality("poor");
    tracker.onQuality("poor");
    tracker.onQuality("good");
    tracker.onQuality("lost");
    tracker.onStatus("reconnecting");
    tracker.onStatus("reconnecting");
    tracker.onQuality("poor");
    tracker.onStatus("connected");
    tracker.onStatus("disconnected");
    tracker.setEnabled(false);
    tracker.onStatus("connecting");
    tracker.onStatus("connected");

    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      "CONNECTED",
      "QUALITY_POOR",
      "QUALITY_LOST",
      "RECONNECTING",
      "RECONNECTED",
      "DISCONNECTED",
    ]);
  });

  it("does not report failed initial connection as a disconnect", () => {
    const emit = vi.fn();
    const tracker = createConnectionTelemetryTracker(emit);
    tracker.setEnabled(true);
    tracker.onStatus("connecting");
    tracker.onStatus("disconnected");
    tracker.onStatus("error");
    expect(emit).not.toHaveBeenCalled();
  });
});
