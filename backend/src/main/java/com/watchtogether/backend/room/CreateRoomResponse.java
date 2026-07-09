package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CreateRoomResponse(RoomSnapshot room, String hostSecret, String invitePath) {

    public record RoomSnapshot(
            String roomId,
            RoomStatus status,
            UUID hostParticipantId,
            List<Participant> participants,
            MediaState media,
            long roomVersion,
            Instant expiresAt,
            Instant updatedAt) {}

    public record Participant(
            UUID participantId,
            String displayName,
            ParticipantRole role,
            boolean online,
            Instant joinedAt) {}

    public record MediaState(
            String displayName, long durationMs, long positionMs, boolean paused) {}
}
