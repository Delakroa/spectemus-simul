import type {
  LiveKitConnectionQuality,
  LiveKitConnectionStatus,
} from "../rooms/livekit-connection";

export const publicConnectionEventTypes = [
  "CONNECTED",
  "RECONNECTING",
  "RECONNECTED",
  "DISCONNECTED",
  "QUALITY_POOR",
  "QUALITY_LOST",
] as const;

export type PublicConnectionEventType = (typeof publicConnectionEventTypes)[number];

export function createConnectionTelemetryTracker(emit: (event: PublicConnectionEventType) => void) {
  let enabled = false;
  let status: LiveKitConnectionStatus = "idle";
  let quality: LiveKitConnectionQuality = "unknown";

  return {
    setEnabled(next: boolean) {
      if (enabled === next) {
        return;
      }
      enabled = next;
      if (enabled && status === "connected") {
        emit("CONNECTED");
        if (quality === "poor") {
          emit("QUALITY_POOR");
        } else if (quality === "lost") {
          emit("QUALITY_LOST");
        }
      }
    },
    onStatus(next: LiveKitConnectionStatus) {
      if (status === next) {
        return;
      }
      const previous = status;
      status = next;
      quality = "unknown";
      if (!enabled) {
        return;
      }
      if (next === "connected") {
        emit(previous === "reconnecting" ? "RECONNECTED" : "CONNECTED");
      } else if (next === "reconnecting" && previous === "connected") {
        emit("RECONNECTING");
      } else if (
        next === "disconnected" &&
        (previous === "connected" || previous === "reconnecting")
      ) {
        emit("DISCONNECTED");
      }
    },
    onQuality(next: LiveKitConnectionQuality) {
      if (status !== "connected" || quality === next) {
        return;
      }
      quality = next;
      if (!enabled) {
        return;
      }
      if (next === "poor") {
        emit("QUALITY_POOR");
      } else if (next === "lost") {
        emit("QUALITY_LOST");
      }
    },
  };
}
