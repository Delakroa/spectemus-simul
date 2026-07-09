package com.watchtogether.backend.room;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomRealtimeStore {

    AuthenticationResult authenticateAndLoad(String roomId, String sessionCredentialHash);

    PresenceResult connect(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant connectedAt,
            Duration presenceTtl);

    PresenceResult heartbeat(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant heartbeatAt,
            Duration presenceTtl);

    PresenceResult disconnect(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant disconnectedAt);

    enum AuthenticationOutcome {
        AUTHENTICATED,
        AUTHENTICATION_REQUIRED,
        ROOM_UNAVAILABLE
    }

    record AuthenticationResult(
            AuthenticationOutcome outcome, StoredRoom room, UUID participantId) {

        static AuthenticationResult authenticated(StoredRoom room, UUID participantId) {
            return new AuthenticationResult(
                    AuthenticationOutcome.AUTHENTICATED, room, participantId);
        }

        static AuthenticationResult authenticationRequired() {
            return new AuthenticationResult(
                    AuthenticationOutcome.AUTHENTICATION_REQUIRED, null, null);
        }

        static AuthenticationResult roomUnavailable() {
            return new AuthenticationResult(AuthenticationOutcome.ROOM_UNAVAILABLE, null, null);
        }
    }

    enum PresenceOutcome {
        ONLINE,
        OFFLINE,
        UNCHANGED,
        AUTHENTICATION_REQUIRED,
        ROOM_UNAVAILABLE,
        STALE_CONNECTION
    }

    record PresenceResult(PresenceOutcome outcome, StoredRoom room, UUID participantId) {

        static PresenceResult online(StoredRoom room, UUID participantId) {
            return new PresenceResult(PresenceOutcome.ONLINE, room, participantId);
        }

        static PresenceResult offline(StoredRoom room, UUID participantId) {
            return new PresenceResult(PresenceOutcome.OFFLINE, room, participantId);
        }

        static PresenceResult unchanged(StoredRoom room, UUID participantId) {
            return new PresenceResult(PresenceOutcome.UNCHANGED, room, participantId);
        }

        static PresenceResult authenticationRequired() {
            return new PresenceResult(PresenceOutcome.AUTHENTICATION_REQUIRED, null, null);
        }

        static PresenceResult roomUnavailable() {
            return new PresenceResult(PresenceOutcome.ROOM_UNAVAILABLE, null, null);
        }

        static PresenceResult staleConnection() {
            return new PresenceResult(PresenceOutcome.STALE_CONNECTION, null, null);
        }

        boolean changed() {
            return outcome == PresenceOutcome.ONLINE || outcome == PresenceOutcome.OFFLINE;
        }

        boolean online() {
            return outcome == PresenceOutcome.ONLINE;
        }
    }
}
