package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.CreateRoomResponse.Participant;
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

    static RoomServerEvent participantJoined(
            String roomId,
            Participant participant,
            long roomVersion,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "participant.joined",
                roomId,
                participant.participantId(),
                roomVersion,
                occurredAt,
                participant);
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

    static RoomServerEvent participantLeft(
            String roomId,
            UUID participantId,
            long roomVersion,
            ParticipantLeftReason reason,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "participant.left",
                roomId,
                participantId,
                roomVersion,
                occurredAt,
                new ParticipantLeftPayload(participantId, reason));
    }

    static RoomServerEvent chatMessage(
            String roomId,
            UUID participantId,
            String displayName,
            long roomVersion,
            UUID messageId,
            String text,
            Instant sentAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "chat.message",
                roomId,
                participantId,
                roomVersion,
                sentAt,
                new ChatMessagePayload(messageId, participantId, displayName, text, sentAt));
    }

    static RoomServerEvent error(
            String roomId,
            UUID participantId,
            long roomVersion,
            ProblemDetails problem,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "error",
                roomId,
                participantId,
                roomVersion,
                occurredAt,
                problem);
    }

    static RoomServerEvent hostDisconnected(
            String roomId,
            UUID hostParticipantId,
            long roomVersion,
            Instant reconnectDeadline,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "host.disconnected",
                roomId,
                hostParticipantId,
                roomVersion,
                occurredAt,
                new HostDisconnectedPayload(reconnectDeadline));
    }

    static RoomServerEvent hostReconnected(
            String roomId,
            UUID hostParticipantId,
            long roomVersion,
            RoomStatus status,
            Instant updatedAt,
            Instant occurredAt) {
        return new RoomServerEvent(
                CURRENT_SCHEMA_VERSION,
                UUID.randomUUID(),
                "host.reconnected",
                roomId,
                hostParticipantId,
                roomVersion,
                occurredAt,
                new HostReconnectedPayload(hostParticipantId, status, updatedAt));
    }

    record ParticipantPresencePayload(UUID participantId, boolean online, Instant updatedAt) {}

    record RoomClosedPayload(RoomClosedReason reason, Instant closedAt) {}

    record ParticipantLeftPayload(UUID participantId, ParticipantLeftReason reason) {}

    record ChatMessagePayload(
            UUID messageId, UUID participantId, String displayName, String text, Instant sentAt) {}

    record HostDisconnectedPayload(Instant reconnectDeadline) {}

    record HostReconnectedPayload(UUID participantId, RoomStatus status, Instant updatedAt) {}

    record ProblemDetails(
            String type,
            String title,
            int status,
            String code,
            String detail,
            String instance,
            UUID correlationId,
            boolean retryable) {}
}
