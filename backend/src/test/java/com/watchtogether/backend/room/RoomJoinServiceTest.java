package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomJoinService.JoinResponse;
import com.watchtogether.backend.room.RoomJoinStore.JoinResult;

import org.junit.jupiter.api.Test;

class RoomJoinServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-09T09:00:00Z");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION_1 = "A".repeat(43);
    private static final String SESSION_2 = "B".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID_1 =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");
    private static final UUID GUEST_ID_2 =
            UUID.fromString("5715dd90-4f3c-4d16-ab8f-d4d4056f81a5");

    @Test
    void joinsGuestWithNewIdentityAndSessionCredential() {
        FakeRoomJoinStore store = new FakeRoomJoinStore(roomWithHost());
        RoomJoinService service = service(store);

        JoinResponse result = service.join(ROOM_ID, " Guest ", null);

        assertThat(result.response().participant().participantId()).isEqualTo(GUEST_ID_1);
        assertThat(result.response().participant().displayName()).isEqualTo("Guest");
        assertThat(result.response().participant().role()).isEqualTo(ParticipantRole.GUEST);
        assertThat(result.response().room().participants()).hasSize(2);
        assertThat(result.response().room().roomVersion()).isEqualTo(1);
        assertThat(result.response().room().updatedAt()).isEqualTo(NOW);
        assertThat(result.sessionCredential()).isEqualTo(SESSION_1);
        assertThat(result.cookieMaxAge()).isEqualTo(Duration.ofHours(3));
        assertThat(store.room().participants().getLast().sessionCredentialHash())
                .isEqualTo(SecureHash.sha256(SESSION_1))
                .isNotEqualTo(SESSION_1);
    }

    @Test
    void replaysExistingParticipantWithoutCreatingDuplicate() {
        FakeRoomJoinStore store = new FakeRoomJoinStore(roomWithHost());
        RoomJoinService service = service(store);
        JoinResponse first = service.join(ROOM_ID, "Guest", null);

        JoinResponse replay = service.join(ROOM_ID, "Changed name", SESSION_1);

        assertThat(replay.response().participant().participantId())
                .isEqualTo(first.response().participant().participantId());
        assertThat(replay.response().participant().displayName()).isEqualTo("Guest");
        assertThat(replay.response().room().participants()).hasSize(2);
        assertThat(replay.response().room().roomVersion()).isEqualTo(1);
        assertThat(replay.sessionCredential()).isEqualTo(SESSION_1);
    }

    @Test
    void rejectsNewParticipantWhenRoomIsFull() {
        List<StoredParticipant> participants = new ArrayList<>(roomWithHost().participants());
        for (int index = 0; index < 3; index++) {
            participants.add(new StoredParticipant(
                    UUID.randomUUID(),
                    "Guest " + index,
                    ParticipantRole.GUEST,
                    true,
                    NOW.minusSeconds(60),
                    SecureHash.sha256("X".repeat(42) + index)));
        }
        StoredRoom fullRoom = copyRoom(roomWithHost(), participants, 3, NOW.minusSeconds(60));
        RoomJoinService service = service(new FakeRoomJoinStore(fullRoom));

        assertThatThrownBy(() -> service.join(ROOM_ID, "Late guest", null))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(409);
                    assertThat(exception.code()).isEqualTo("ROOM_FULL");
                });
    }

    @Test
    void returnsSameUnavailableErrorForInvalidAndMissingRoom() {
        RoomJoinService invalidRoomService = service(new FakeRoomJoinStore(roomWithHost()));
        RoomJoinService missingRoomService = service(new FakeRoomJoinStore(null));

        assertRoomUnavailable(() -> invalidRoomService.join("invalid", "Guest", null));
        assertRoomUnavailable(() -> missingRoomService.join(ROOM_ID, "Guest", null));
    }

    private void assertRoomUnavailable(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, exception -> {
            assertThat(exception.status().value()).isEqualTo(404);
            assertThat(exception.code()).isEqualTo("ROOM_UNAVAILABLE");
        });
    }

    private RoomJoinService service(FakeRoomJoinStore store) {
        return new RoomJoinService(
                store,
                new StubSecureValueGenerator(),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static StoredRoom roomWithHost() {
        Instant createdAt = NOW.minus(Duration.ofHours(1));
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                true,
                createdAt,
                SecureHash.sha256("H".repeat(43)));
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.CREATED,
                HOST_ID,
                List.of(host),
                0,
                NOW.plus(Duration.ofHours(3)),
                createdAt,
                SecureHash.sha256("S".repeat(43)));
    }

    private static StoredRoom copyRoom(
            StoredRoom room,
            List<StoredParticipant> participants,
            long roomVersion,
            Instant updatedAt) {
        return new StoredRoom(
                room.roomId(),
                room.status(),
                room.hostParticipantId(),
                participants,
                roomVersion,
                room.expiresAt(),
                updatedAt,
                room.hostSecretHash());
    }

    private static final class FakeRoomJoinStore implements RoomJoinStore {

        private StoredRoom room;

        private FakeRoomJoinStore(StoredRoom room) {
            this.room = room;
        }

        @Override
        public JoinResult join(
                String roomId,
                String sessionCredentialHash,
                StoredParticipant candidate,
                Instant updatedAt,
                int maxParticipants) {
            if (room == null || !room.roomId().equals(roomId)) {
                return JoinResult.roomUnavailable();
            }
            if (!sessionCredentialHash.isEmpty()) {
                StoredParticipant existing = room.participants().stream()
                        .filter(participant ->
                                participant.sessionCredentialHash().equals(sessionCredentialHash))
                        .findFirst()
                        .orElse(null);
                if (existing != null) {
                    return JoinResult.replayed(room, existing.participantId());
                }
            }
            if (room.participants().size() >= maxParticipants) {
                return JoinResult.roomFull();
            }

            List<StoredParticipant> participants = new ArrayList<>(room.participants());
            participants.add(candidate);
            room = copyRoom(room, participants, room.roomVersion() + 1, updatedAt);
            return JoinResult.joined(room, candidate.participantId());
        }

        StoredRoom room() {
            return room;
        }
    }

    private static final class StubSecureValueGenerator implements SecureValueGenerator {

        private int callIndex;

        @Override
        public String roomId() {
            throw new UnsupportedOperationException();
        }

        @Override
        public String credential() {
            return callIndex++ == 0 ? SESSION_1 : SESSION_2;
        }

        @Override
        public UUID participantId() {
            return callIndex == 1 ? GUEST_ID_1 : GUEST_ID_2;
        }
    }
}
