package com.watchtogether.backend.room;

import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomRealtimeStore {

    AuthenticationResult authenticateAndLoad(String roomId, String sessionCredentialHash);

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
}
