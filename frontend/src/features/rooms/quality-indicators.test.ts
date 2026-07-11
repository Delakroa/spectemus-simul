import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createQualityIndicatorController,
  type QualityIndicatorsState,
} from "./quality-indicators";

type Handler = (...values: unknown[]) => void;

function createTrackWithStats(stats: Array<Record<string, unknown>>) {
  let index = 0;
  return {
    getReceiverStats: vi.fn(async () => stats[Math.min(index++, stats.length - 1)]),
    getSenderStats: vi.fn(async () => stats[Math.min(index++, stats.length - 1)]),
  };
}

function createRoom({
  receiverStats = [],
  senderStats = [],
}: {
  receiverStats?: Array<Record<string, unknown>>;
  senderStats?: Array<Record<string, unknown>>;
}) {
  const handlers = new Map<string, Set<Handler>>();
  const senderTrack = createTrackWithStats(senderStats);
  const receiverTrack = createTrackWithStats(receiverStats);
  const room = {
    localParticipant: {
      connectionQuality: "excellent",
      identity: "local",
      trackPublications: new Map([["sender", { track: senderTrack }]]),
    },
    off: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
      return room;
    }),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, new Set([...(handlers.get(event) ?? []), handler]));
      return room;
    }),
    remoteParticipants: new Map([
      [
        "remote",
        {
          connectionQuality: "good",
          identity: "remote",
          trackPublications: new Map([["receiver", { track: receiverTrack }]]),
        },
      ],
    ]),
  };

  return {
    emit: (event: string, ...values: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...values);
      }
    },
    room,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createQualityIndicatorController", () => {
  it("агрегирует privacy-safe upload/download stats", async () => {
    const states: QualityIndicatorsState[] = [];
    const { room } = createRoom({
      receiverStats: [
        {
          bytesReceived: 1_000,
          frameHeight: 720,
          frameWidth: 1280,
          jitter: 0.01,
          packetsLost: 0,
          packetsReceived: 100,
          streamId: "down",
          timestamp: 1_000,
        },
        {
          bytesReceived: 201_000,
          frameHeight: 720,
          frameWidth: 1280,
          jitter: 0.015,
          packetsLost: 1,
          packetsReceived: 199,
          streamId: "down",
          timestamp: 3_000,
        },
      ],
      senderStats: [
        {
          bytesSent: 2_000,
          frameHeight: 720,
          frameWidth: 1280,
          framesPerSecond: 30,
          jitter: 0.02,
          packetsLost: 0,
          packetsSent: 100,
          roundTripTime: 0.08,
          streamId: "up",
          timestamp: 1_000,
        },
        {
          bytesSent: 302_000,
          frameHeight: 720,
          frameWidth: 1280,
          framesPerSecond: 30,
          jitter: 0.025,
          packetsLost: 0,
          packetsSent: 200,
          roundTripTime: 0.09,
          streamId: "up",
          timestamp: 3_000,
        },
      ],
    });

    const controller = createQualityIndicatorController(room as never, {
      onStateChange: (state) => states.push(state),
    });
    await vi.advanceTimersByTimeAsync(2_000);

    expect(states.at(-1)).toMatchObject({
      connectionQuality: "good",
      download: {
        bitrateKbps: 800,
        frameHeight: 720,
        frameWidth: 1280,
        jitterMs: 15,
        packetLossPercent: 0.5,
      },
      status: "good",
      upload: {
        bitrateKbps: 1200,
        framesPerSecond: 30,
        jitterMs: 25,
        packetLossPercent: 0,
        rttMs: 90,
      },
      warning: null,
    });

    controller.disconnect();
  });

  it("переводит индикатор в poor по LiveKit connection quality", async () => {
    const states: QualityIndicatorsState[] = [];
    const { emit, room } = createRoom({});

    const controller = createQualityIndicatorController(room as never, {
      onStateChange: (state) => states.push(state),
    });
    emit("connectionQualityChanged", "poor", { identity: "remote" });
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toMatchObject({
      connectionQuality: "poor",
      status: "poor",
      warning: "LiveKit сообщает о плохом качестве соединения.",
    });

    controller.disconnect();
  });
});
