package com.spectemus.simul.backend.room;

import java.util.List;

import com.spectemus.simul.backend.room.CreateRoomResponse.Participant;
import com.spectemus.simul.backend.room.CreateRoomResponse.RoomSnapshot;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredParticipant;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredRoom;

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
