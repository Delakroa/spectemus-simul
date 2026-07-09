package com.watchtogether.backend.room;

import java.io.IOException;
import java.time.Instant;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomEventPublisher {

    void publishRoomClosed(StoredRoom room, RoomClosedReason reason, Instant closedAt)
            throws IOException;
}
