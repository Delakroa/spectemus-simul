package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomJoinStore {

    JoinResult join(
            String roomId,
            String sessionCredentialHash,
            StoredParticipant candidate,
            Instant updatedAt,
            int maxParticipants);

    enum JoinOutcome {
        JOINED,
        REPLAYED,
        ROOM_FULL,
        ROOM_UNAVAILABLE
    }

    record JoinResult(JoinOutcome outcome, StoredRoom room, UUID participantId) {

        static JoinResult joined(StoredRoom room, UUID participantId) {
            return new JoinResult(JoinOutcome.JOINED, room, participantId);
        }

        static JoinResult replayed(StoredRoom room, UUID participantId) {
            return new JoinResult(JoinOutcome.REPLAYED, room, participantId);
        }

        static JoinResult roomFull() {
            return new JoinResult(JoinOutcome.ROOM_FULL, null, null);
        }

        static JoinResult roomUnavailable() {
            return new JoinResult(JoinOutcome.ROOM_UNAVAILABLE, null, null);
        }
    }
}
