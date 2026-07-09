package com.watchtogether.backend.room;

import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomEventPublisher {

    void publishRoomClosed(StoredRoom room, RoomClosedReason reason, Instant closedAt)
            throws IOException;

    void publishParticipantLeft(
            StoredRoom room, UUID participantId, ParticipantLeftReason reason, Instant leftAt)
            throws IOException;
}
