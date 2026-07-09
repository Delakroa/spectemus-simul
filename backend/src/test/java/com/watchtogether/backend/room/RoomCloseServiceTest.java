package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveResult;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleResult;

import org.junit.jupiter.api.Test;

class RoomCloseServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-09T12:00:00Z");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final String HOST_SECRET = "B".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");

    @Test
    void closesRoomAndPublishesRoomClosedEvent() {
        FakeLifecycleStore store = new FakeLifecycleStore(LifecycleResult.closed(room()));
        RecordingPublisher publisher = new RecordingPublisher();
        RoomCloseService service = service(store, publisher);

        service.close(ROOM_ID, SESSION, HOST_SECRET);

        assertThat(store.sessionCredentialHash()).isEqualTo(SecureHash.sha256(SESSION));
        assertThat(store.hostSecretHash()).isEqualTo(SecureHash.sha256(HOST_SECRET));
        assertThat(publisher.room()).isEqualTo(room());
        assertThat(publisher.reason()).isEqualTo(RoomClosedReason.HOST_CLOSED);
        assertThat(publisher.closedAt()).isEqualTo(NOW);
    }

    @Test
    void treatsAlreadyClosedAsIdempotentWithoutPublishingAgain() {
        RecordingPublisher publisher = new RecordingPublisher();
        RoomCloseService service =
                service(new FakeLifecycleStore(LifecycleResult.alreadyClosed(room())), publisher);

        service.close(ROOM_ID, SESSION, HOST_SECRET);

        assertThat(publisher.room()).isNull();
    }

    @Test
    void mapsInvalidSessionAccessDeniedAndUnavailableToProblemStatuses() {
        RoomCloseService service = service(
                new FakeLifecycleStore(LifecycleResult.accessDenied()),
                new RecordingPublisher());

        assertApiException(
                () -> service.close(ROOM_ID, null, HOST_SECRET),
                401,
                "AUTHENTICATION_REQUIRED");
        assertApiException(
                () -> service.close(ROOM_ID, SESSION, "bad"),
                403,
                "ACCESS_DENIED");
        assertApiException(
                () -> service.close("invalid", SESSION, HOST_SECRET),
                404,
                "ROOM_UNAVAILABLE");
        assertApiException(
                () -> service.close(ROOM_ID, SESSION, HOST_SECRET),
                403,
                "ACCESS_DENIED");
    }

    @Test
    void mapsStoreUnavailableToNotFound() {
        RoomCloseService service = service(
                new FakeLifecycleStore(LifecycleResult.roomUnavailable()),
                new RecordingPublisher());

        assertApiException(
                () -> service.close(ROOM_ID, SESSION, HOST_SECRET),
                404,
                "ROOM_UNAVAILABLE");
    }

    private void assertApiException(
            org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
            int status,
            String code) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, exception -> {
            assertThat(exception.status().value()).isEqualTo(status);
            assertThat(exception.code()).isEqualTo(code);
        });
    }

    private RoomCloseService service(FakeLifecycleStore store, RecordingPublisher publisher) {
        return new RoomCloseService(
                store,
                publisher,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private StoredRoom room() {
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                false,
                NOW.minus(Duration.ofHours(1)),
                SecureHash.sha256(SESSION));
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.CLOSED,
                HOST_ID,
                List.of(host),
                3,
                NOW.plus(Duration.ofHours(3)),
                NOW,
                SecureHash.sha256(HOST_SECRET));
    }

    private static final class FakeLifecycleStore implements RoomLifecycleStore {

        private final LifecycleResult result;
        private String sessionCredentialHash;
        private String hostSecretHash;

        private FakeLifecycleStore(LifecycleResult result) {
            this.result = result;
        }

        @Override
        public LifecycleResult closeByHost(
                String roomId,
                String sessionCredentialHash,
                String hostSecretHash,
                Instant closedAt) {
            this.sessionCredentialHash = sessionCredentialHash;
            this.hostSecretHash = hostSecretHash;
            return result;
        }

        @Override
        public LifecycleResult expire(String roomId, Instant expiredAt) {
            throw new UnsupportedOperationException();
        }

        @Override
        public LeaveResult leave(String roomId, String sessionCredentialHash, Instant leftAt) {
            throw new UnsupportedOperationException();
        }

        String sessionCredentialHash() {
            return sessionCredentialHash;
        }

        String hostSecretHash() {
            return hostSecretHash;
        }
    }

    private static final class RecordingPublisher implements RoomEventPublisher {

        private StoredRoom room;
        private RoomClosedReason reason;
        private Instant closedAt;

        @Override
        public void publishRoomClosed(StoredRoom room, RoomClosedReason reason, Instant closedAt)
                throws IOException {
            this.room = room;
            this.reason = reason;
            this.closedAt = closedAt;
        }

        @Override
        public void publishParticipantLeft(
                StoredRoom room, UUID participantId, ParticipantLeftReason reason, Instant leftAt)
                throws IOException {
            throw new UnsupportedOperationException();
        }

        StoredRoom room() {
            return room;
        }

        RoomClosedReason reason() {
            return reason;
        }

        Instant closedAt() {
            return closedAt;
        }
    }
}
