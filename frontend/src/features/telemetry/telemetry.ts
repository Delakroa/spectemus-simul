import type { QualityIndicatorStatus, QualityIndicatorsState } from "../rooms/quality-indicators";
import type { RemotePlaybackState } from "../rooms/remote-playback";
import type { TelemetryEvent, TelemetryQualityStatus, TelemetryRole } from "./telemetry-api";

/**
 * Session-scoped telemetry tracker (WT-604). Turns the room lifecycle signals the session
 * hook already receives into privacy-safe telemetry events, deduplicating one-shot events
 * (first frame, publish start) and only emitting a quality sample when the coarse status
 * actually changes. It never reads media bytes, identity or free-form user input — only the
 * derived states. Emission is delegated to `emit` so this stays a pure, testable unit.
 */
export type RoomTelemetryTracker = {
  onRemotePlayback: (state: RemotePlaybackState) => void;
  onQuality: (state: QualityIndicatorsState) => void;
  onPublishStart: () => void;
  onPublishFailure: (detail?: string) => void;
  reset: () => void;
};

export type RoomTelemetryTrackerParams = {
  emit: (event: TelemetryEvent) => void;
  getRoomId: () => string | null;
  getRole: () => TelemetryRole | null;
};

export function createRoomTelemetryTracker(
  params: RoomTelemetryTrackerParams,
): RoomTelemetryTracker {
  let firstFrameSent = false;
  let publishStartSent = false;
  let lastPlaybackStatus: RemotePlaybackState["status"] | null = null;
  let lastQualityStatus: TelemetryQualityStatus | null = null;

  const buildEvent = (
    type: TelemetryEvent["type"],
    extra?: { qualityStatus?: TelemetryQualityStatus; detail?: string },
  ): TelemetryEvent => {
    const roomId = params.getRoomId();
    const role = params.getRole();
    const event: TelemetryEvent = { type };
    if (roomId) {
      event.roomId = roomId;
    }
    if (role) {
      event.role = role;
    }
    if (extra?.qualityStatus) {
      event.qualityStatus = extra.qualityStatus;
    }
    if (extra?.detail) {
      event.detail = extra.detail.slice(0, 200);
    }
    return event;
  };

  return {
    onRemotePlayback: (state) => {
      if (!firstFrameSent && state.videoTrackName !== null) {
        firstFrameSent = true;
        params.emit(buildEvent("FIRST_FRAME"));
      }

      if (state.status === "error" && lastPlaybackStatus !== "error") {
        params.emit(buildEvent("PLAYBACK_ERROR", { detail: state.error ?? undefined }));
      }

      lastPlaybackStatus = state.status;
    },
    onQuality: (state) => {
      const status = toQualityStatus(state.status);
      if (status && status !== lastQualityStatus) {
        lastQualityStatus = status;
        params.emit(buildEvent("QUALITY_SUMMARY", { qualityStatus: status }));
      }
    },
    onPublishStart: () => {
      if (publishStartSent) {
        return;
      }
      publishStartSent = true;
      params.emit(buildEvent("PUBLISH_START"));
    },
    onPublishFailure: (detail) => {
      params.emit(buildEvent("PUBLISH_FAILURE", { detail: detail ?? undefined }));
    },
    reset: () => {
      firstFrameSent = false;
      publishStartSent = false;
      lastPlaybackStatus = null;
      lastQualityStatus = null;
    },
  };
}

function toQualityStatus(status: QualityIndicatorStatus): TelemetryQualityStatus | null {
  switch (status) {
    case "good":
      return "GOOD";
    case "warning":
      return "WARNING";
    case "poor":
      return "POOR";
    case "lost":
      return "LOST";
    default:
      return null;
  }
}
