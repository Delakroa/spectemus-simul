import { z } from "zod";
import type { RemoteParticipant, Room as LiveKitRoom } from "livekit-client";

export const PLAYBACK_STATE_TOPIC = "wt.playback-state.v1";

const PLAYBACK_STATE_HEARTBEAT_MS = 1000;

const playbackStatusSchema = z.enum(["idle", "ready", "playing", "paused", "ended"]);
const playbackEventSchema = z.enum([
  "metadata",
  "play",
  "pause",
  "seek",
  "ended",
  "heartbeat",
  "publish",
  "stop",
  "reconnect",
]);

const playbackStateMessageSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  event: playbackEventSchema,
  status: playbackStatusSchema,
  currentTime: z.number().nonnegative(),
  duration: z.union([z.number().nonnegative(), z.null()]),
  sentAt: z.iso.datetime(),
  fileName: z.union([z.string().min(1).max(256), z.null()]),
});

export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;
export type PlaybackEvent = z.infer<typeof playbackEventSchema>;
export type PlaybackStateMessage = z.infer<typeof playbackStateMessageSchema>;

export type PlaybackStateView = PlaybackStateMessage & {
  error: string | null;
  participantIdentity: string | null;
  receivedAt: string | null;
};

export type HostPlaybackStatePublisher = {
  disconnect: (event?: PlaybackEvent) => void;
  send: (event: PlaybackEvent) => void;
};

export type GuestPlaybackStateReceiver = {
  disconnect: () => void;
  setVideoElement: (videoElement: HTMLVideoElement | null) => void;
};

export type GuestPlaybackStateHandlers = {
  onStateChange: (state: PlaybackStateView) => void;
};

export const idlePlaybackState: PlaybackStateView = {
  schemaVersion: 1,
  revision: 0,
  event: "stop",
  status: "idle",
  currentTime: 0,
  duration: null,
  sentAt: new Date(0).toISOString(),
  fileName: null,
  error: null,
  participantIdentity: null,
  receivedAt: null,
};

export function encodePlaybackStateMessage(message: PlaybackStateMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(playbackStateMessageSchema.parse(message)));
}

export function decodePlaybackStateMessage(payload: Uint8Array): PlaybackStateMessage {
  const text = new TextDecoder().decode(payload);
  return playbackStateMessageSchema.parse(JSON.parse(text));
}

export function createHostPlaybackStatePublisher(
  room: LiveKitRoom,
  videoElement: HTMLVideoElement,
  fileName: string,
): HostPlaybackStatePublisher {
  let disconnected = false;
  let revision = 0;
  let heartbeatTimer: number | null = null;

  const send = (event: PlaybackEvent) => {
    if (disconnected) {
      return;
    }

    revision += 1;
    void room.localParticipant.publishData(
      encodePlaybackStateMessage(
        createPlaybackStateMessage(videoElement, fileName, revision, event),
      ),
      {
        reliable: true,
        topic: PLAYBACK_STATE_TOPIC,
      },
    );
  };

  const handleLoadedMetadata = () => send("metadata");
  const handlePlay = () => send("play");
  const handlePause = () => {
    if (videoElement.ended) {
      send("ended");
      return;
    }

    send("pause");
  };
  const handleSeeked = () => send("seek");
  const handleEnded = () => send("ended");

  videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
  videoElement.addEventListener("play", handlePlay);
  videoElement.addEventListener("pause", handlePause);
  videoElement.addEventListener("seeked", handleSeeked);
  videoElement.addEventListener("ended", handleEnded);

  heartbeatTimer = window.setInterval(() => send("heartbeat"), PLAYBACK_STATE_HEARTBEAT_MS);
  send("publish");

  return {
    disconnect: (event = "stop") => {
      if (disconnected) {
        return;
      }

      send(event);
      disconnected = true;

      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }

      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
      videoElement.removeEventListener("seeked", handleSeeked);
      videoElement.removeEventListener("ended", handleEnded);
    },
    send,
  };
}

export function createGuestPlaybackStateReceiver(
  room: LiveKitRoom,
  expectedHostIdentity: string | null,
  handlers: GuestPlaybackStateHandlers,
): GuestPlaybackStateReceiver {
  let disconnected = false;
  let latestRevision = 0;
  let latestState: PlaybackStateView = idlePlaybackState;
  let videoElement: HTMLVideoElement | null = null;

  const emitState = (state: PlaybackStateView) => {
    if (!disconnected) {
      latestState = state;
      handlers.onStateChange(state);
    }
  };

  const applyPlaybackState = (state: PlaybackStateView) => {
    if (!videoElement) {
      return;
    }

    if (state.status === "playing") {
      void videoElement.play().catch((error: unknown) => {
        emitState({
          ...state,
          error:
            error instanceof Error ? error.message : "Не удалось применить воспроизведение host-а.",
        });
      });
      return;
    }

    if (state.status === "paused" || state.status === "ended" || state.status === "idle") {
      videoElement.pause();
    }
  };

  const handleDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (topic !== PLAYBACK_STATE_TOPIC || !participant) {
      return;
    }

    if (expectedHostIdentity && participant.identity !== expectedHostIdentity) {
      return;
    }

    try {
      const message = decodePlaybackStateMessage(payload);
      if (message.revision <= latestRevision) {
        return;
      }

      latestRevision = message.revision;
      const nextState: PlaybackStateView = {
        ...message,
        error: null,
        participantIdentity: participant.identity,
        receivedAt: new Date().toISOString(),
      };
      applyPlaybackState(nextState);
      emitState(nextState);
    } catch {
      emitState({
        ...latestState,
        error: "Получено некорректное состояние playback.",
      });
    }
  };

  room.on("dataReceived", handleDataReceived);
  handlers.onStateChange(idlePlaybackState);

  return {
    disconnect: () => {
      disconnected = true;
      room.off("dataReceived", handleDataReceived);
      handlers.onStateChange(idlePlaybackState);
    },
    setVideoElement: (nextVideoElement) => {
      videoElement = nextVideoElement;
      if (latestState.revision > 0) {
        applyPlaybackState(latestState);
      }
    },
  };
}

function createPlaybackStateMessage(
  videoElement: HTMLVideoElement,
  fileName: string,
  revision: number,
  event: PlaybackEvent,
): PlaybackStateMessage {
  const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : null;

  return {
    schemaVersion: 1,
    revision,
    event,
    status: getPlaybackStatus(videoElement, event),
    currentTime: Number.isFinite(videoElement.currentTime)
      ? Math.max(0, videoElement.currentTime)
      : 0,
    duration: duration === null ? null : Math.max(0, duration),
    sentAt: new Date().toISOString(),
    fileName,
  };
}

function getPlaybackStatus(videoElement: HTMLVideoElement, event: PlaybackEvent): PlaybackStatus {
  if (event === "stop") {
    return "idle";
  }

  if (videoElement.ended) {
    return "ended";
  }

  if (videoElement.paused) {
    return videoElement.readyState >= 1 ? "paused" : "idle";
  }

  return videoElement.readyState >= 1 ? "playing" : "ready";
}
