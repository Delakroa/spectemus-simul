package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomJoinStore.JoinOutcome;
import com.watchtogether.backend.room.RoomJoinStore.JoinResult;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
        properties = {
            "management.health.redis.enabled=false",
            "watch-together.websocket.container-limits-enabled=false"
        })
class RedisRoomJoinStoreTest {

    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Autowired
    private RedisRoomJoinStore store;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private StringRedisTemplate redis;

    @Test
    void readsJoinedResultReturnedByAtomicRedisScript() throws Exception {
        StoredRoom room = room();
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("JOINED:" + GUEST_ID + ":" + objectMapper.writeValueAsString(room));

        JoinResult result = join();

        assertThat(result.outcome()).isEqualTo(JoinOutcome.JOINED);
        assertThat(result.participantId()).isEqualTo(GUEST_ID);
        assertThat(result.room()).isEqualTo(room);
    }

    @Test
    void readsReplayResultReturnedByAtomicRedisScript() throws Exception {
        StoredRoom room = room();
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("REPLAYED:" + GUEST_ID + ":" + objectMapper.writeValueAsString(room));

        JoinResult result = join();

        assertThat(result.outcome()).isEqualTo(JoinOutcome.REPLAYED);
        assertThat(result.participantId()).isEqualTo(GUEST_ID);
        assertThat(result.room()).isEqualTo(room);
    }

    @Test
    void reportsRoomFullAndUnavailableResults() {
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("ROOM_FULL")
                .thenReturn("ROOM_UNAVAILABLE");

        assertThat(join().outcome()).isEqualTo(JoinOutcome.ROOM_FULL);
        assertThat(join().outcome()).isEqualTo(JoinOutcome.ROOM_UNAVAILABLE);
    }

    private JoinResult join() {
        return store.join(
                "AbCdEfGhIjKlMnOpQrStUv",
                "",
                guest(),
                Instant.parse("2026-07-09T09:00:00Z"),
                4);
    }

    private StoredRoom room() {
        Instant now = Instant.parse("2026-07-09T09:00:00Z");
        StoredParticipant host = new StoredParticipant(
                UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678"),
                "Host",
                ParticipantRole.HOST,
                true,
                now.minusSeconds(60),
                "host-session-hash");
        return new StoredRoom(
                "AbCdEfGhIjKlMnOpQrStUv",
                RoomStatus.CREATED,
                host.participantId(),
                List.of(host, guest()),
                1,
                now.plusSeconds(3600),
                now,
                "host-secret-hash");
    }

    private StoredParticipant guest() {
        return new StoredParticipant(
                GUEST_ID,
                "Guest",
                ParticipantRole.GUEST,
                true,
                Instant.parse("2026-07-09T09:00:00Z"),
                "guest-session-hash");
    }
}
