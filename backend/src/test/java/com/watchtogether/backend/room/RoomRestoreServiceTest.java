package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class RoomRestoreServiceTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Test
    void restoresAuthenticatedParticipantAndRoomSnapshot() {
        FakeRealtimeStore store =
                new FakeRealtimeStore(AuthenticationResult.authenticated(room(), GUEST_ID));
        RoomRestoreService service = new RoomRestoreService(store);

        GetRoomResponse response = service.restore(ROOM_ID, SESSION);

        assertThat(store.sessionCredentialHash).isEqualTo(SecureHash.sha256(SESSION));
        assertThat(response.participant().participantId()).isEqualTo(GUEST_ID);
        assertThat(response.participant().role()).isEqualTo(ParticipantRole.GUEST);
        assertThat(response.room().roomId()).isEqualTo(ROOM_ID);
        assertThat(response.room().participants()).hasSize(2);
    }

    @Test
    void rejectsMissingOrInvalidSession() {
        RoomRestoreService service =
                new RoomRestoreService(new FakeRealtimeStore(AuthenticationResult.authenticated(room(), GUEST_ID)));

        assertApiException(
                () -> service.restore(ROOM_ID, null),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
        assertApiException(
                () -> service.restore(ROOM_ID, "bad-session"),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
    }

    @Test
    void hidesInvalidOrUnavailableRoom() {
        RoomRestoreService invalidRoomService =
                new RoomRestoreService(new FakeRealtimeStore(AuthenticationResult.authenticated(room(), GUEST_ID)));
        RoomRestoreService unavailableRoomService =
                new RoomRestoreService(new FakeRealtimeStore(AuthenticationResult.roomUnavailable()));

        assertApiException(
                () -> invalidRoomService.restore("invalid", SESSION),
                HttpStatus.NOT_FOUND,
                "ROOM_UNAVAILABLE");
        assertApiException(
                () -> unavailableRoomService.restore(ROOM_ID, SESSION),
                HttpStatus.NOT_FOUND,
                "ROOM_UNAVAILABLE");
    }

    @Test
    void rejectsSessionThatDoesNotBelongToRoom() {
        RoomRestoreService service =
                new RoomRestoreService(new FakeRealtimeStore(AuthenticationResult.authenticationRequired()));

        assertApiException(
                () -> service.restore(ROOM_ID, SESSION),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
    }

    private void assertApiException(
            org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
            HttpStatus status,
            String code) {
        assertThatThrownBy(call)
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException exception = (ApiException) error;
                    assertThat(exception.status()).isEqualTo(status);
                    assertThat(exception.code()).isEqualTo(code);
                });
    }

    private StoredRoom room() {
        Instant now = Instant.parse("2026-07-09T10:00:00Z");
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.READY,
                HOST_ID,
                List.of(
                        new StoredParticipant(
                                HOST_ID,
                                "Host",
                                ParticipantRole.HOST,
                                true,
                                now.minusSeconds(60),
                                "host-session-hash"),
                        new StoredParticipant(
                                GUEST_ID,
                                "Guest",
                                ParticipantRole.GUEST,
                                true,
                                now,
                                SecureHash.sha256(SESSION))),
                3,
                now.plus(Duration.ofHours(4)),
                now,
                "host-secret-hash");
    }

    private static final class FakeRealtimeStore implements RoomRealtimeStore {

        private final AuthenticationResult result;
        private String sessionCredentialHash;

        private FakeRealtimeStore(AuthenticationResult result) {
            this.result = result;
        }

        @Override
        public AuthenticationResult authenticateAndLoad(String roomId, String sessionCredentialHash) {
            this.sessionCredentialHash = sessionCredentialHash;
            return result;
        }

        @Override
        public PresenceResult connect(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant connectedAt,
                Duration presenceTtl) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PresenceResult heartbeat(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant heartbeatAt,
                Duration presenceTtl) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PresenceResult disconnect(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant disconnectedAt) {
            throw new UnsupportedOperationException();
        }
    }
}
