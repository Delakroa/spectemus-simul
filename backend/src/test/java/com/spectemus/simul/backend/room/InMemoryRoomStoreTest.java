package com.spectemus.simul.backend.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.spectemus.simul.backend.room.RoomCreationStore.SaveOutcome;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredParticipant;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredRoom;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredRoomCreation;
import com.spectemus.simul.backend.room.RoomRealtimeStore.PresenceOutcome;

import org.junit.jupiter.api.Test;

class InMemoryRoomStoreTest {

    private static final Instant NOW = Instant.parse("2026-07-21T10:00:00Z");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String HOST_SESSION = "host-session";
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");

    private final InMemoryRoomStore store =
            new InMemoryRoomStore(Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void preservesCreateIdempotencyAndRoomIdCollision() {
        StoredRoomCreation creation = creation();

        assertThat(store.saveOrGet("request-a", creation, Duration.ofHours(4), Duration.ofHours(1))
                .outcome()).isEqualTo(SaveOutcome.CREATED);
        assertThat(store.saveOrGet("request-a", creation, Duration.ofHours(4), Duration.ofHours(1))
                .outcome()).isEqualTo(SaveOutcome.REPLAYED);
        assertThat(store.saveOrGet("request-b", creation, Duration.ofHours(4), Duration.ofHours(1))
                .outcome()).isEqualTo(SaveOutcome.ROOM_ID_COLLISION);
    }

    @Test
    void releasesRoomIdAfterTheConfiguredStorageTtl() {
        store.saveOrGet("request-a", creation(), Duration.ofMinutes(10), Duration.ofHours(1));

        assertThat(store.saveOrGet(
                        "request-b", creationAt(NOW.plus(Duration.ofMinutes(10))),
                        Duration.ofMinutes(10), Duration.ofHours(1))
                .outcome()).isEqualTo(SaveOutcome.CREATED);
    }

    @Test
    void joinsOnceAndRejectsStalePresenceConnection() {
        create();
        UUID guestId = UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");
        String guestSession = "guest-session";
        StoredParticipant guest = new StoredParticipant(
                guestId, "Guest", ParticipantRole.GUEST, false, NOW, guestSession);

        assertThat(store.join(ROOM_ID, guestSession, guest, NOW.plusSeconds(1), 4).outcome())
                .isEqualTo(RoomJoinStore.JoinOutcome.JOINED);
        assertThat(store.join(ROOM_ID, guestSession, guest, NOW.plusSeconds(2), 4).outcome())
                .isEqualTo(RoomJoinStore.JoinOutcome.REPLAYED);

        UUID activeConnection = UUID.randomUUID();
        assertThat(store.connect(
                        ROOM_ID, guestSession, guestId, activeConnection, NOW, Duration.ofSeconds(30))
                .outcome()).isEqualTo(PresenceOutcome.ONLINE);
        assertThat(store.heartbeat(
                        ROOM_ID, guestSession, guestId, UUID.randomUUID(), NOW.plusSeconds(1),
                        Duration.ofSeconds(30))
                .outcome()).isEqualTo(PresenceOutcome.STALE_CONNECTION);
        assertThat(store.disconnect(
                        ROOM_ID, guestSession, guestId, activeConnection, NOW.plusSeconds(2))
                .outcome()).isEqualTo(PresenceOutcome.OFFLINE);
    }

    @Test
    void closesAndRecoversHostStateWithoutRedis() {
        create();
        assertThat(store.markHostDisconnected(ROOM_ID, NOW.plusSeconds(1)).changed()).isTrue();
        assertThat(store.recoverHost(ROOM_ID, NOW.plusSeconds(2)).changed()).isTrue();

        assertThat(store.closeByHost(
                        ROOM_ID, HOST_SESSION, "host-secret-hash", NOW.plusSeconds(3))
                .outcome()).isEqualTo(RoomLifecycleStore.LifecycleOutcome.CLOSED);
        assertThat(store.authenticateAndLoad(ROOM_ID, HOST_SESSION).outcome())
                .isEqualTo(RoomRealtimeStore.AuthenticationOutcome.ROOM_UNAVAILABLE);
    }

    @Test
    void preservesPlayingStatusWhenGuestsJoinOrLeaveDuringHostReconnectGracePeriod() {
        create(RoomStatus.PLAYING);
        UUID guestId = UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");
        String guestSession = "guest-session";
        StoredParticipant guest = new StoredParticipant(
                guestId, "Guest", ParticipantRole.GUEST, false, NOW, guestSession);

        assertThat(store.markHostDisconnected(ROOM_ID, NOW.plusSeconds(1)).changed()).isTrue();
        assertThat(store.join(ROOM_ID, guestSession, guest, NOW.plusSeconds(2), 4).outcome())
                .isEqualTo(RoomJoinStore.JoinOutcome.JOINED);
        assertThat(store.leave(ROOM_ID, guestSession, NOW.plusSeconds(3)).outcome())
                .isEqualTo(RoomLifecycleStore.LeaveOutcome.LEFT);

        var recovery = store.recoverHost(ROOM_ID, NOW.plusSeconds(4));

        assertThat(recovery.changed()).isTrue();
        assertThat(recovery.room().status()).isEqualTo(RoomStatus.PLAYING);
    }

    private void create() {
        create(RoomStatus.CREATED);
    }

    private void create(RoomStatus status) {
        store.saveOrGet("request", creation(status), Duration.ofHours(4), Duration.ofHours(1));
    }

    private StoredRoomCreation creation() {
        return creation(RoomStatus.CREATED);
    }

    private StoredRoomCreation creation(RoomStatus status) {
        return creationAt(NOW, status);
    }

    private StoredRoomCreation creationAt(Instant createdAt) {
        return creationAt(createdAt, RoomStatus.CREATED);
    }

    private StoredRoomCreation creationAt(Instant createdAt, RoomStatus status) {
        StoredParticipant host = new StoredParticipant(
                HOST_ID, "Host", ParticipantRole.HOST, false, createdAt, HOST_SESSION);
        StoredRoom room = new StoredRoom(
                ROOM_ID, status, HOST_ID, List.of(host), 0,
                createdAt.plus(Duration.ofHours(4)), createdAt, "host-secret-hash");
        return new StoredRoomCreation("fingerprint", room, "secret", HOST_SESSION);
    }
}
