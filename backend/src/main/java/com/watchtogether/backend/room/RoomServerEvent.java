package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.CreateRoomResponse.RoomSnapshot;

record RoomServerEvent(
        int schemaVersion,
        UUID eventId,
        String type,
        String roomId,
        UUID participantId,
        long roomVersion,
        Instant occurredAt,
        Object payload) {

    private static final int CURRENT_SCHEMA_VERSION = 1;

    static RoomServerEvent snapshot(RoomSnapshot room, Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "room.snapshot",
                room.roomId(),
                null,
                room.roomVersion(),
                occurredAt,
                room);
    }

    static RoomServerEvent participantPresence(
            String roomId,
            UUID participantId,
            long roomVersion,
            boolean online,
            Instant updatedAt,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                online ? "participant.online" : "participant.offline",
                roomId,
                participantId,
                roomVersion,
                occurredAt,
                new ParticipantPresencePayload(participantId, online, updatedAt));
    }

    static RoomServerEvent roomClosed(
            String roomId,
            long roomVersion,
            RoomClosedReason reason,
            Instant closedAt,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "room.closed",
                roomId,
                null,
                roomVersion,
                occurredAt,
                new RoomClosedPayload(reason, closedAt));
    }

    record ParticipantPresencePayload(UUID participantId, boolean online, Instant updatedAt) {}

    record RoomClosedPayload(RoomClosedReason reason, Instant closedAt) {}
}
