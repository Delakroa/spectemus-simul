import type { QualityIndicatorsState } from "../rooms/quality-indicators";
import { idleQualityIndicatorsState } from "../rooms/quality-indicators";
import type { RemotePlaybackState } from "../rooms/remote-playback";
import { createRoomTelemetryTracker } from "./telemetry";
import type { TelemetryEvent } from "./telemetry-api";

const ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

function playback(overrides: Partial<RemotePlaybackState>): RemotePlaybackState {
  return {
    audioTrackName: null,
    error: null,
    participantIdentity: null,
    status: "waiting",
    trackCount: 0,
    videoTrackName: null,
    ...overrides,
  };
}

function quality(status: QualityIndicatorsState["status"]): QualityIndicatorsState {
  return { ...idleQualityIndicatorsState, status };
}

function setup(role: "HOST" | "GUEST" = "GUEST") {
  const events: TelemetryEvent[] = [];
  const tracker = createRoomTelemetryTracker({
    emit: (event) => events.push(event),
    getRoomId: () => ROOM_ID,
    getRole: () => role,
  });
  return { events, tracker };
}

describe("room telemetry tracker", () => {
  it("emits FIRST_FRAME once when a video track appears", () => {
    const { events, tracker } = setup("GUEST");

    tracker.onRemotePlayback(playback({ status: "waiting" }));
    tracker.onRemotePlayback(
      playback({ status: "receiving", trackCount: 1, videoTrackName: "movie" }),
    );
    tracker.onRemotePlayback(
      playback({ status: "receiving", trackCount: 1, videoTrackName: "movie" }),
    );

    const firstFrames = events.filter((event) => event.type === "FIRST_FRAME");
    expect(firstFrames).toHaveLength(1);
    expect(firstFrames[0]).toMatchObject({ roomId: ROOM_ID, role: "GUEST" });
  });

  it("emits PLAYBACK_ERROR only on transition into error", () => {
    const { events, tracker } = setup();

    tracker.onRemotePlayback(playback({ status: "receiving", videoTrackName: "movie" }));
    tracker.onRemotePlayback(playback({ status: "error", error: "play() failed" }));
    tracker.onRemotePlayback(playback({ status: "error", error: "play() failed" }));

    const errors = events.filter((event) => event.type === "PLAYBACK_ERROR");
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toBe("play() failed");
  });

  it("emits QUALITY_SUMMARY only on status change and skips idle/checking", () => {
    const { events, tracker } = setup();

    tracker.onQuality(quality("idle"));
    tracker.onQuality(quality("checking"));
    tracker.onQuality(quality("good"));
    tracker.onQuality(quality("good"));
    tracker.onQuality(quality("warning"));

    const samples = events.filter((event) => event.type === "QUALITY_SUMMARY");
    expect(samples.map((event) => event.qualityStatus)).toEqual(["GOOD", "WARNING"]);
  });

  it("emits PUBLISH_START once and PUBLISH_FAILURE per call", () => {
    const { events, tracker } = setup("HOST");

    tracker.onPublishStart();
    tracker.onPublishStart();
    tracker.onPublishFailure("boom");
    tracker.onPublishFailure();

    expect(events.filter((event) => event.type === "PUBLISH_START")).toHaveLength(1);
    const failures = events.filter((event) => event.type === "PUBLISH_FAILURE");
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ role: "HOST", detail: "boom" });
    expect(failures[1].detail).toBeUndefined();
  });

  it("reset clears dedupe so a new session re-emits one-shot events", () => {
    const { events, tracker } = setup();

    tracker.onRemotePlayback(playback({ videoTrackName: "movie" }));
    tracker.reset();
    tracker.onRemotePlayback(playback({ videoTrackName: "movie" }));

    expect(events.filter((event) => event.type === "FIRST_FRAME")).toHaveLength(2);
  });

  it("omits roomId and role when unavailable", () => {
    const events: TelemetryEvent[] = [];
    const tracker = createRoomTelemetryTracker({
      emit: (event) => events.push(event),
      getRoomId: () => null,
      getRole: () => null,
    });

    tracker.onPublishStart();

    expect(events[0]).toEqual({ type: "PUBLISH_START" });
  });
});
