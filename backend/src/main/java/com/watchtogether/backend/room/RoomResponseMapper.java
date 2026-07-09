package com.watchtogether.backend.room;

import java.util.List;

import com.watchtogether.backend.room.CreateRoomResponse.Participant;
import com.watchtogether.backend.room.CreateRoomResponse.RoomSnapshot;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

final class RoomResponseMapper {

    private RoomResponseMapper() {}

    static RoomSnapshot toSnapshot(StoredRoom room) {
        List<Participant> participants =
                room.participants().stream().map(RoomResponseMapper::toParticipant).toList();

        return new RoomSnapshot(
                room.roomId(),
                room.status(),
                room.hostParticipantId(),
                participants,
                null,
                room.roomVersion(),
                room.expiresAt(),
                room.updatedAt());
    }

    static Participant toParticipant(StoredParticipant participant) {
        return new Participant(
                participant.participantId(),
                participant.displayName(),
                participant.role(),
                participant.online(),
                participant.joinedAt());
    }
}
