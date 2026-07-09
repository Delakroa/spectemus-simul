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

class RoomLeaveServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-09T12:00:00Z");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Test
    void leavesRoomAndPublishesParticipantLeftEvent() {
        StoredRoom room = roomAfterLeave();
        FakeLifecycleStore store =
                new FakeLifecycleStore(LeaveResult.left(room, GUEST_ID));
        RecordingPublisher publisher = new RecordingPublisher();
        RoomLeaveService service = service(store, publisher);

        service.leave(ROOM_ID, SESSION);

        assertThat(store.roomId()).isEqualTo(ROOM_ID);
        assertThat(store.sessionCredentialHash()).isEqualTo(SecureHash.sha256(SESSION));
        assertThat(store.leftAt()).isEqualTo(NOW);
        assertThat(publisher.leftRoom()).isEqualTo(room);
        assertThat(publisher.leftParticipantId()).isEqualTo(GUEST_ID);
        assertThat(publisher.leftReason()).isEqualTo(ParticipantLeftReason.LEFT);
        assertThat(publisher.leftAt()).isEqualTo(NOW);
    }

    @Test
    void mapsInvalidSessionAndRoomToProblemStatuses() {
        RoomLeaveService service =
                service(new FakeLifecycleStore(LeaveResult.left(roomAfterLeave(), GUEST_ID)),
                        new RecordingPublisher());

        assertApiException(() -> service.leave(ROOM_ID, null), 401, "AUTHENTICATION_REQUIRED");
        assertApiException(() -> service.leave(ROOM_ID, "bad"), 401, "AUTHENTICATION_REQUIRED");
        assertApiException(() -> service.leave("invalid", SESSION), 404, "ROOM_UNAVAILABLE");
    }

    @Test
    void mapsStoreRejectionsToProblemStatuses() {
        assertApiException(
                () -> service(
                                new FakeLifecycleStore(LeaveResult.authenticationRequired()),
                                new RecordingPublisher())
                        .leave(ROOM_ID, SESSION),
                401,
                "AUTHENTICATION_REQUIRED");
        assertApiException(
                () -> service(
                                new FakeLifecycleStore(LeaveResult.hostCannotLeave()),
                                new RecordingPublisher())
                        .leave(ROOM_ID, SESSION),
                403,
                "ACCESS_DENIED");
        assertApiException(
                () -> service(
                                new FakeLifecycleStore(LeaveResult.roomUnavailable()),
                                new RecordingPublisher())
                        .leave(ROOM_ID, SESSION),
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

    private RoomLeaveService service(FakeLifecycleStore store, RecordingPublisher publisher) {
        return new RoomLeaveService(store, publisher, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private StoredRoom roomAfterLeave() {
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                true,
                NOW.minus(Duration.ofHours(1)),
                SecureHash.sha256("H".repeat(43)));
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.CREATED,
                HOST_ID,
                List.of(host),
                4,
                NOW.plus(Duration.ofHours(3)),
                NOW,
                SecureHash.sha256("S".repeat(43)));
    }

    private static final class FakeLifecycleStore implements RoomLifecycleStore {

        private final LeaveResult result;
        private String roomId;
        private String sessionCredentialHash;
        private Instant leftAt;

        private FakeLifecycleStore(LeaveResult result) {
            this.result = result;
        }

        @Override
        public LifecycleResult closeByHost(
                String roomId,
                String sessionCredentialHash,
                String hostSecretHash,
                Instant closedAt) {
            throw new UnsupportedOperationException();
        }

        @Override
        public LifecycleResult expire(String roomId, Instant expiredAt) {
            throw new UnsupportedOperationException();
        }

        @Override
        public LeaveResult leave(String roomId, String sessionCredentialHash, Instant leftAt) {
            this.roomId = roomId;
            this.sessionCredentialHash = sessionCredentialHash;
            this.leftAt = leftAt;
            return result;
        }

        String roomId() {
            return roomId;
        }

        String sessionCredentialHash() {
            return sessionCredentialHash;
        }

        Instant leftAt() {
            return leftAt;
        }
    }

    private static final class RecordingPublisher implements RoomEventPublisher {

        private StoredRoom leftRoom;
        private UUID leftParticipantId;
        private ParticipantLeftReason leftReason;
        private Instant leftAt;

        @Override
        public void publishParticipantJoined(StoredRoom room, UUID participantId, Instant joinedAt)
                throws IOException {
            throw new UnsupportedOperationException();
        }

        @Override
        public void publishRoomClosed(StoredRoom room, RoomClosedReason reason, Instant closedAt)
                throws IOException {
            throw new UnsupportedOperationException();
        }

        @Override
        public void publishParticipantLeft(
                StoredRoom room, UUID participantId, ParticipantLeftReason reason, Instant leftAt)
                throws IOException {
            this.leftRoom = room;
            this.leftParticipantId = participantId;
            this.leftReason = reason;
            this.leftAt = leftAt;
        }

        StoredRoom leftRoom() {
            return leftRoom;
        }

        UUID leftParticipantId() {
            return leftParticipantId;
        }

        ParticipantLeftReason leftReason() {
            return leftReason;
        }

        Instant leftAt() {
            return leftAt;
        }
    }
}
