package com.watchtogether.backend.room;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

interface RoomCreationStore {

    SaveResult saveOrGet(
            String idempotencyKeyHash,
            StoredRoomCreation candidate,
            Duration roomStorageTtl,
            Duration idempotencyTtl);

    enum SaveOutcome {
        CREATED,
        REPLAYED,
        ROOM_ID_COLLISION
    }

    record SaveResult(SaveOutcome outcome, StoredRoomCreation creation) {

        static SaveResult created(StoredRoomCreation creation) {
            return new SaveResult(SaveOutcome.CREATED, creation);
        }

        static SaveResult replayed(StoredRoomCreation creation) {
            return new SaveResult(SaveOutcome.REPLAYED, creation);
        }

        static SaveResult roomIdCollision() {
            return new SaveResult(SaveOutcome.ROOM_ID_COLLISION, null);
        }
    }

    record StoredRoomCreation(
            String requestFingerprint,
            StoredRoom room,
            String hostSecret,
            String sessionCredential) {}

    record StoredRoom(
            String roomId,
            RoomStatus status,
            UUID hostParticipantId,
            List<StoredParticipant> participants,
            long roomVersion,
            Instant expiresAt,
            Instant updatedAt,
            String hostSecretHash,
            RoomStatus statusBeforeHostDisconnect) {

        StoredRoom(
                String roomId,
                RoomStatus status,
                UUID hostParticipantId,
                List<StoredParticipant> participants,
                long roomVersion,
                Instant expiresAt,
                Instant updatedAt,
                String hostSecretHash) {
            this(
                    roomId,
                    status,
                    hostParticipantId,
                    participants,
                    roomVersion,
                    expiresAt,
                    updatedAt,
                    hostSecretHash,
                    null);
        }

        public StoredRoom {
            participants = List.copyOf(participants);
        }
    }

    record StoredParticipant(
            UUID participantId,
            String displayName,
            ParticipantRole role,
            boolean online,
            Instant joinedAt,
            String sessionCredentialHash) {}
}
