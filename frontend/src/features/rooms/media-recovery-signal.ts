import { z } from "zod";
import type { RemoteParticipant, Room as LiveKitRoom } from "livekit-client";

export const MEDIA_RECOVERY_SIGNAL_TOPIC = "wt.media-recovery.v1";

const MEDIA_RECOVERY_REQUEST_COOLDOWN_MS = 10_000;
const mediaRecoveryRequestSchema = z.object({
  requestId: z.uuid().optional(),
  requestedAt: z.iso.datetime(),
  schemaVersion: z.literal(1),
  type: z.literal("media.recovery.request"),
});
const mediaRecoveryStatusSchema = z.object({
  occurredAt: z.iso.datetime(),
  requestId: z.uuid().optional(),
  schemaVersion: z.literal(1),
  status: z.enum(["started", "succeeded", "failed"]),
  type: z.literal("media.recovery.status"),
});
const mediaRecoveryPayloadSchema = z.discriminatedUnion("type", [
  mediaRecoveryRequestSchema,
  mediaRecoveryStatusSchema,
]);

export type MediaRecoveryRequest = {
  participantIdentity: string;
  requestId?: string;
  requestedAt: string;
};

export type MediaRecoveryStatus = z.infer<typeof mediaRecoveryStatusSchema>["status"];
export type MediaRecoveryStatusUpdate = {
  occurredAt: string;
  requestId?: string;
  status: MediaRecoveryStatus;
};
type MediaRecoverySignalPayload = z.infer<typeof mediaRecoveryPayloadSchema>;

export type MediaRecoverySignalController = {
  disconnect: () => void;
  requestRecovery: () => Promise<string>;
  sendRecoveryStatus: (
    recipientIdentity: string,
    status: MediaRecoveryStatus,
    requestId?: string,
  ) => Promise<void>;
};

export function createMediaRecoverySignalController(
  room: LiveKitRoom,
  options: {
    expectedHostIdentity?: string;
    isHost: boolean;
    onRecoveryRequested?: (request: MediaRecoveryRequest) => void;
    onRecoveryStatus?: (update: MediaRecoveryStatusUpdate) => void;
  },
): MediaRecoverySignalController {
  let disconnected = false;
  let lastRequestSentAt = 0;
  let latestRequestId: string | undefined;
  const recentlyReceivedFrom = new Map<string, number>();

  const handleDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (topic !== MEDIA_RECOVERY_SIGNAL_TOPIC || !participant) {
      return;
    }

    try {
      const message = decodeMediaRecoverySignal(payload);
      if (
        !options.isHost &&
        message.type === "media.recovery.status" &&
        participant.identity === options.expectedHostIdentity &&
        (!message.requestId || message.requestId === latestRequestId)
      ) {
        options.onRecoveryStatus?.({
          occurredAt: message.occurredAt,
          requestId: message.requestId,
          status: message.status,
        });
        return;
      }

      if (!options.isHost || message.type !== "media.recovery.request") {
        return;
      }

      const now = Date.now();
      const previousReceivedAt = recentlyReceivedFrom.get(participant.identity) ?? 0;
      if (now - previousReceivedAt < MEDIA_RECOVERY_REQUEST_COOLDOWN_MS) {
        return;
      }

      recentlyReceivedFrom.set(participant.identity, now);
      options.onRecoveryRequested?.({
        participantIdentity: participant.identity,
        requestId: message.requestId,
        requestedAt: message.requestedAt,
      });
    } catch {
      // Invalid LiveKit data must never become an action for the host.
    }
  };

  room.on("dataReceived", handleDataReceived);

  return {
    disconnect: () => {
      disconnected = true;
      room.off("dataReceived", handleDataReceived);
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

      const requestId = createRecoveryRequestId();
      const previousRequestId = latestRequestId;
      latestRequestId = requestId;
      try {
        await room.localParticipant.publishData(
          encodeMediaRecoverySignal({
            requestId,
            requestedAt: new Date(now).toISOString(),
            schemaVersion: 1,
            type: "media.recovery.request",
          }),
          {
            reliable: true,
            topic: MEDIA_RECOVERY_SIGNAL_TOPIC,
          },
        );
      } catch (error) {
        if (latestRequestId === requestId) {
          latestRequestId = previousRequestId;
        }
        throw error;
      }
      lastRequestSentAt = now;
      return requestId;
    },
    sendRecoveryStatus: async (recipientIdentity, status, requestId) => {
      if (disconnected) {
        throw new Error("LiveKit не подключён.");
      }
      if (!options.isHost) {
        throw new Error("Статус восстановления может отправить только host.");
      }

      await room.localParticipant.publishData(
        encodeMediaRecoverySignal({
          occurredAt: new Date().toISOString(),
          requestId,
          schemaVersion: 1,
          status,
          type: "media.recovery.status",
        }),
        {
          destinationIdentities: [recipientIdentity],
          reliable: true,
          topic: MEDIA_RECOVERY_SIGNAL_TOPIC,
        },
      );
    },
  };
}

export function encodeMediaRecoverySignal(payload: MediaRecoverySignalPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(mediaRecoveryPayloadSchema.parse(payload)));
}

export function decodeMediaRecoverySignal(payload: Uint8Array) {
  return mediaRecoveryPayloadSchema.parse(JSON.parse(new TextDecoder().decode(payload)));
}

export function createRecoveryRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Браузер не поддерживает генерацию recovery request ID.");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
