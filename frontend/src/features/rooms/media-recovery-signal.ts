import { z } from "zod";
import type { RemoteParticipant, Room as LiveKitRoom } from "livekit-client";

export const MEDIA_RECOVERY_SIGNAL_TOPIC = "wt.media-recovery.v1";

const MEDIA_RECOVERY_REQUEST_COOLDOWN_MS = 10_000;
const mediaRecoveryPayloadSchema = z.object({
  requestedAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
  type: z.literal("media.recovery.request"),
});

export type MediaRecoveryRequest = {
  participantIdentity: string;
  requestedAt: string;
};

export type MediaRecoverySignalController = {
  disconnect: () => void;
  requestRecovery: () => Promise<void>;
};

export function createMediaRecoverySignalController(
  room: LiveKitRoom,
  options: {
    isHost: boolean;
    onRecoveryRequested: (request: MediaRecoveryRequest) => void;
  },
): MediaRecoverySignalController {
  let disconnected = false;
  let lastRequestSentAt = 0;
  const recentlyReceivedFrom = new Map<string, number>();

  const handleDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (!options.isHost || topic !== MEDIA_RECOVERY_SIGNAL_TOPIC || !participant) {
      return;
    }

    try {
      const message = decodeMediaRecoverySignal(payload);
      const now = Date.now();
      const previousReceivedAt = recentlyReceivedFrom.get(participant.identity) ?? 0;
      if (now - previousReceivedAt < MEDIA_RECOVERY_REQUEST_COOLDOWN_MS) {
        return;
      }

      recentlyReceivedFrom.set(participant.identity, now);
      options.onRecoveryRequested({
        participantIdentity: participant.identity,
        requestedAt: message.requestedAt,
      });
    } catch {
      // Invalid LiveKit data must never become an action for the host.
    }
  };

  if (options.isHost) {
    room.on("dataReceived", handleDataReceived);
  }

  return {
    disconnect: () => {
      disconnected = true;
      if (options.isHost) {
        room.off("dataReceived", handleDataReceived);
      }
      recentlyReceivedFrom.clear();
    },
    requestRecovery: async () => {
      if (disconnected) {
        throw new Error("LiveKit не подключён.");
      }

      const now = Date.now();
      if (now - lastRequestSentAt < MEDIA_RECOVERY_REQUEST_COOLDOWN_MS) {
        throw new Error("Запрос уже отправлен. Попробуйте ещё раз через несколько секунд.");
      }

      await room.localParticipant.publishData(
        encodeMediaRecoverySignal({
          requestedAt: new Date(now).toISOString(),
          schemaVersion: 1,
          type: "media.recovery.request",
        }),
        {
          reliable: true,
          topic: MEDIA_RECOVERY_SIGNAL_TOPIC,
        },
      );
      lastRequestSentAt = now;
    },
  };
}

export function encodeMediaRecoverySignal(payload: {
  requestedAt: string;
  schemaVersion: 1;
  type: "media.recovery.request";
}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(mediaRecoveryPayloadSchema.parse(payload)));
}

export function decodeMediaRecoverySignal(payload: Uint8Array) {
  return mediaRecoveryPayloadSchema.parse(JSON.parse(new TextDecoder().decode(payload)));
}
