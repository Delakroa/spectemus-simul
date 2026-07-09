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
        RoomSnapshot payload) {

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
}
