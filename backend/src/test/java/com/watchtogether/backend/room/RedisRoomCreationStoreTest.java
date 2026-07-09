package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.SaveOutcome;
import com.watchtogether.backend.room.RoomCreationStore.SaveResult;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoomCreation;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import tools.jackson.databind.ObjectMapper;

@SpringBootTest(properties = "management.health.redis.enabled=false")
class RedisRoomCreationStoreTest {

    @Autowired
    private RedisRoomCreationStore store;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private StringRedisTemplate redis;

    @Test
    void readsCreatedResultReturnedByAtomicRedisScript() throws Exception {
        StoredRoomCreation candidate = candidate();
        String serialized = objectMapper.writeValueAsString(candidate);
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("CREATED:" + serialized);

        SaveResult result =
                store.saveOrGet("idempotency-hash", candidate, Duration.ofHours(4));

        assertThat(result.outcome()).isEqualTo(SaveOutcome.CREATED);
        assertThat(result.creation()).isEqualTo(candidate);
    }

    @Test
    void readsReplayResultReturnedByAtomicRedisScript() throws Exception {
        StoredRoomCreation candidate = candidate();
        String serialized = objectMapper.writeValueAsString(candidate);
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("REPLAYED:" + serialized);

        SaveResult result =
                store.saveOrGet("idempotency-hash", candidate, Duration.ofHours(4));

        assertThat(result.outcome()).isEqualTo(SaveOutcome.REPLAYED);
        assertThat(result.creation()).isEqualTo(candidate);
    }

    @Test
    void reportsRoomIdCollisionReturnedByAtomicRedisScript() {
        StoredRoomCreation candidate = candidate();
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("ROOM_ID_COLLISION");

        SaveResult result =
                store.saveOrGet("idempotency-hash", candidate, Duration.ofHours(4));

        assertThat(result.outcome()).isEqualTo(SaveOutcome.ROOM_ID_COLLISION);
    }

    private StoredRoomCreation candidate() {
        Instant now = Instant.parse("2026-07-09T08:00:00Z");
        UUID participantId = UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
        StoredParticipant participant = new StoredParticipant(
                participantId,
                "Host",
                ParticipantRole.HOST,
                true,
                now,
                "session-hash");
        StoredRoom room = new StoredRoom(
                "AbCdEfGhIjKlMnOpQrStUv",
                RoomStatus.CREATED,
                participantId,
                List.of(participant),
                0,
                now.plus(Duration.ofHours(4)),
                now,
                "host-secret-hash");
        return new StoredRoomCreation(
                "request-fingerprint", room, "A".repeat(43), "B".repeat(43));
    }
}
