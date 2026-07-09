package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.UUID;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationService.CreationResult;
import com.watchtogether.backend.room.RoomCreationStore.SaveResult;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoomCreation;

import org.junit.jupiter.api.Test;

class RoomCreationServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-09T08:00:00Z");
    private static final Duration TTL = Duration.ofHours(4);
    private static final String ROOM_ID_1 = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String ROOM_ID_2 = "WxYz0123456789abcdefgh";
    private static final String HOST_SECRET_1 = "A".repeat(43);
    private static final String SESSION_1 = "B".repeat(43);
    private static final String HOST_SECRET_2 = "C".repeat(43);
    private static final String SESSION_2 = "D".repeat(43);
    private static final UUID PARTICIPANT_1 =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID PARTICIPANT_2 =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Test
    void createsRoomWithSeparateCredentialsAndTtl() {
        FakeRoomCreationStore store = new FakeRoomCreationStore();
        RoomCreationService service = service(store);

        CreationResult result = service.create("create-room-key-0001", " Host ");

        assertThat(result.response().room().roomId()).isEqualTo(ROOM_ID_1);
        assertThat(result.response().room().status()).isEqualTo(RoomStatus.CREATED);
        assertThat(result.response().room().expiresAt()).isEqualTo(NOW.plus(TTL));
        assertThat(result.response().room().participants()).singleElement().satisfies(host -> {
            assertThat(host.participantId()).isEqualTo(PARTICIPANT_1);
            assertThat(host.displayName()).isEqualTo("Host");
            assertThat(host.role()).isEqualTo(ParticipantRole.HOST);
            assertThat(host.online()).isTrue();
        });
        assertThat(result.response().hostSecret()).isEqualTo(HOST_SECRET_1);
        assertThat(result.response().invitePath()).isEqualTo("/rooms/" + ROOM_ID_1);
        assertThat(result.response().invitePath()).doesNotContain(HOST_SECRET_1);
        assertThat(result.sessionCredential()).isEqualTo(SESSION_1);
        assertThat(result.cookieMaxAge()).isEqualTo(TTL);

        StoredRoomCreation stored = store.onlyCreation();
        assertThat(stored.room().hostSecretHash()).isNotEqualTo(HOST_SECRET_1);
        assertThat(stored.room().participants().getFirst().sessionCredentialHash())
                .isNotEqualTo(SESSION_1);
    }

    @Test
    void replaysOriginalResultForTheSameIdempotencyKey() {
        FakeRoomCreationStore store = new FakeRoomCreationStore();
        RoomCreationService service = service(store);

        CreationResult first = service.create("create-room-key-0002", "Host");
        CreationResult replay = service.create("create-room-key-0002", "Host");

        assertThat(replay).isEqualTo(first);
        assertThat(store.roomCount()).isEqualTo(1);
    }

    @Test
    void rejectsTheSameIdempotencyKeyWithDifferentPayload() {
        FakeRoomCreationStore store = new FakeRoomCreationStore();
        RoomCreationService service = service(store);
        service.create("create-room-key-0003", "Host");

        assertThatThrownBy(() -> service.create("create-room-key-0003", "Another host"))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(409);
                    assertThat(exception.code()).isEqualTo("IDEMPOTENCY_CONFLICT");
                });
    }

    @Test
    void retriesWhenGeneratedRoomIdAlreadyExists() {
        FakeRoomCreationStore store = new FakeRoomCreationStore();
        store.occupy(ROOM_ID_1);
        RoomCreationService service = service(store);

        CreationResult result = service.create("create-room-key-0004", "Host");

        assertThat(result.response().room().roomId()).isEqualTo(ROOM_ID_2);
        assertThat(store.roomCount()).isEqualTo(2);
    }

    @Test
    void rejectsInvalidIdempotencyKey() {
        RoomCreationService service = service(new FakeRoomCreationStore());

        assertThatThrownBy(() -> service.create("short", "Host"))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(422);
                    assertThat(exception.code()).isEqualTo("VALIDATION_FAILED");
                });
    }

    private RoomCreationService service(FakeRoomCreationStore store) {
        return new RoomCreationService(
                store,
                new StubSecureValueGenerator(),
                new RoomProperties(TTL, false, Duration.ofMinutes(5)),
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static final class StubSecureValueGenerator implements SecureValueGenerator {

        private final Queue<String> roomIds = new ArrayDeque<>();
        private final Queue<String> credentials = new ArrayDeque<>();
        private final Queue<UUID> participantIds = new ArrayDeque<>();

        private StubSecureValueGenerator() {
            roomIds.add(ROOM_ID_1);
            roomIds.add(ROOM_ID_2);
            roomIds.add("ijklmnopqrstuvwxyz0123");
            credentials.add(HOST_SECRET_1);
            credentials.add(SESSION_1);
            credentials.add(HOST_SECRET_2);
            credentials.add(SESSION_2);
            credentials.add("E".repeat(43));
            credentials.add("F".repeat(43));
            participantIds.add(PARTICIPANT_1);
            participantIds.add(PARTICIPANT_2);
            participantIds.add(UUID.fromString("5715dd90-4f3c-4d16-ab8f-d4d4056f81a5"));
        }

        @Override
        public String roomId() {
            return roomIds.remove();
        }

        @Override
        public String credential() {
            return credentials.remove();
        }

        @Override
        public UUID participantId() {
            return participantIds.remove();
        }
    }

    private static final class FakeRoomCreationStore implements RoomCreationStore {

        private final Map<String, StoredRoomCreation> idempotency = new HashMap<>();
        private final Set<String> roomIds = new HashSet<>();

        @Override
        public SaveResult saveOrGet(
                String idempotencyKeyHash,
                StoredRoomCreation candidate,
                Duration roomStorageTtl,
                Duration idempotencyTtl) {
            StoredRoomCreation existing = idempotency.get(idempotencyKeyHash);
            if (existing != null) {
                return SaveResult.replayed(existing);
            }
            if (!roomIds.add(candidate.room().roomId())) {
                return SaveResult.roomIdCollision();
            }

            idempotency.put(idempotencyKeyHash, candidate);
            return SaveResult.created(candidate);
        }

        void occupy(String roomId) {
            roomIds.add(roomId);
        }

        int roomCount() {
            return roomIds.size();
        }

        StoredRoomCreation onlyCreation() {
            return idempotency.values().iterator().next();
        }
    }
}
