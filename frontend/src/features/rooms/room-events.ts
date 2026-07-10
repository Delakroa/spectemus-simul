import { z } from "zod";

import {
  participantSchema,
  roomIdSchema,
  roomSnapshotSchema,
  type Participant,
  type RoomSnapshot,
} from "./room-api";

const eventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.uuid(),
  type: z.string().min(1),
  roomId: roomIdSchema,
  participantId: z.union([z.uuid(), z.null()]),
  roomVersion: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
});

const participantLeftPayloadSchema = z.object({
  participantId: z.uuid(),
  reason: z.enum(["LEFT", "TIMEOUT", "REMOVED", "ROOM_CLOSED"]),
});

const participantPresencePayloadSchema = z.object({
  participantId: z.uuid(),
  online: z.boolean(),
  updatedAt: z.iso.datetime(),
});

const roomClosedPayloadSchema = z.object({
  reason: z.enum(["HOST_CLOSED", "EXPIRED", "INTERNAL"]),
  closedAt: z.iso.datetime(),
});

const chatMessagePayloadSchema = z.object({
  messageId: z.uuid(),
  participantId: z.uuid(),
  displayName: z.string().min(1).max(64),
  text: z.string().min(1).max(1000),
  sentAt: z.iso.datetime(),
});

type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export type RoomSnapshotEvent = EventEnvelope & {
  type: "room.snapshot";
  payload: RoomSnapshot;
};

export type ParticipantJoinedEvent = EventEnvelope & {
  type: "participant.joined";
  payload: Participant;
};

export type ParticipantLeftEvent = EventEnvelope & {
  type: "participant.left";
  payload: z.infer<typeof participantLeftPayloadSchema>;
};

export type ParticipantPresenceEvent = EventEnvelope & {
  type: "participant.online" | "participant.offline";
  payload: z.infer<typeof participantPresencePayloadSchema>;
};

export type RoomClosedEvent = EventEnvelope & {
  type: "room.closed";
  payload: z.infer<typeof roomClosedPayloadSchema>;
};

export type ChatMessageEvent = EventEnvelope & {
  type: "chat.message";
  payload: z.infer<typeof chatMessagePayloadSchema>;
};

export type UnknownRoomServerEvent = EventEnvelope & {
  known: false;
};

export type KnownRoomServerEvent =
  | RoomSnapshotEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | ParticipantPresenceEvent
  | RoomClosedEvent
  | ChatMessageEvent;

export type RoomServerEvent = KnownRoomServerEvent | UnknownRoomServerEvent;

export function parseRoomServerEvent(value: unknown): RoomServerEvent {
  const envelope = eventEnvelopeSchema.parse(value);

  switch (envelope.type) {
    case "room.snapshot":
      return {
        ...envelope,
        type: "room.snapshot",
        payload: roomSnapshotSchema.parse(envelope.payload),
      };
    case "participant.joined":
      return {
        ...envelope,
        type: "participant.joined",
        payload: participantSchema.parse(envelope.payload),
      };
    case "participant.left":
      return {
        ...envelope,
        type: "participant.left",
        payload: participantLeftPayloadSchema.parse(envelope.payload),
      };
    case "participant.online":
    case "participant.offline":
      return {
        ...envelope,
        type: envelope.type,
        payload: participantPresencePayloadSchema.parse(envelope.payload),
      };
    case "room.closed":
      return {
        ...envelope,
        type: "room.closed",
        payload: roomClosedPayloadSchema.parse(envelope.payload),
      };
    case "chat.message":
      return {
        ...envelope,
        type: "chat.message",
        payload: chatMessagePayloadSchema.parse(envelope.payload),
      };
    default:
      return {
        ...envelope,
        known: false,
      };
  }
}

export function applyRoomServerEvent(
  room: RoomSnapshot | null,
  event: KnownRoomServerEvent,
): RoomSnapshot | null {
  if (event.type === "room.snapshot") {
    return event.payload;
  }

  if (!room || room.roomId !== event.roomId || event.roomVersion < room.roomVersion) {
    return room;
  }

  switch (event.type) {
    case "participant.joined":
      return {
        ...room,
        participants: upsertParticipant(room.participants, event.payload),
        roomVersion: event.roomVersion,
        updatedAt: event.payload.joinedAt,
      };
    case "participant.left":
      return {
        ...room,
        participants: room.participants.filter(
          (participant) => participant.participantId !== event.payload.participantId,
        ),
        roomVersion: event.roomVersion,
        updatedAt: event.occurredAt,
      };
    case "participant.online":
    case "participant.offline":
      return {
        ...room,
        participants: room.participants.map((participant) =>
          participant.participantId === event.payload.participantId
            ? { ...participant, online: event.payload.online }
            : participant,
        ),
        roomVersion: event.roomVersion,
        updatedAt: event.payload.updatedAt,
      };
    case "room.closed":
      return {
        ...room,
        status: event.payload.reason === "EXPIRED" ? "EXPIRED" : "CLOSED",
        participants: room.participants.map((participant) => ({
          ...participant,
          online: false,
        })),
        roomVersion: event.roomVersion,
        updatedAt: event.payload.closedAt,
      };
    case "chat.message":
      // Chat messages are transient and never mutate authoritative room state.
      return room;
  }
}

export function isKnownRoomServerEvent(event: RoomServerEvent): event is KnownRoomServerEvent {
  return !("known" in event);
}

export function describeRoomServerEvent(event: RoomServerEvent) {
  if (!isKnownRoomServerEvent(event)) {
    return `Неизвестное событие ${event.type}`;
  }

  switch (event.type) {
    case "room.snapshot":
      return "Получен snapshot комнаты";
    case "participant.joined":
      return `${event.payload.displayName} вошёл в комнату`;
    case "participant.left":
      return "Участник покинул комнату";
    case "participant.online":
      return "Участник снова онлайн";
    case "participant.offline":
      return "Участник офлайн";
    case "room.closed":
      return event.payload.reason === "EXPIRED" ? "Комната истекла" : "Комната закрыта";
    case "chat.message":
      return `${event.payload.displayName}: ${event.payload.text}`;
  }
}

function upsertParticipant(participants: Participant[], nextParticipant: Participant) {
  const existingIndex = participants.findIndex(
    (participant) => participant.participantId === nextParticipant.participantId,
  );

  if (existingIndex === -1) {
    return [...participants, nextParticipant].sort((left, right) =>
      left.joinedAt.localeCompare(right.joinedAt),
    );
  }

  return participants.map((participant, index) =>
    index === existingIndex ? nextParticipant : participant,
  );
}
