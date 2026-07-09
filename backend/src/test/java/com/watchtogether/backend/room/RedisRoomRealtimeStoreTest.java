package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
        properties = {
            "management.health.redis.enabled=false",
            "watch-together.websocket.container-limits-enabled=false"
        })
class RedisRoomRealtimeStoreTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");

    @Autowired
    private RedisRoomRealtimeStore store;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private StringRedisTemplate redis;

    private ValueOperations<String, String> values;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    void authenticatesParticipantAndReturnsRoom() throws Exception {
        StoredRoom room = room(RoomStatus.CREATED);
        when(values.get("watch-together:v1:room:" + ROOM_ID))
                .thenReturn(objectMapper.writeValueAsString(room));

        AuthenticationResult result =
                store.authenticateAndLoad(ROOM_ID, SecureHash.sha256(SESSION));

        assertThat(result.outcome()).isEqualTo(AuthenticationOutcome.AUTHENTICATED);
        assertThat(result.participantId()).isEqualTo(HOST_ID);
        assertThat(result.room()).isEqualTo(room);
    }

    @Test
    void rejectsUnknownSessionWithoutLeakingRoomState() throws Exception {
        when(values.get("watch-together:v1:room:" + ROOM_ID))
                .thenReturn(objectMapper.writeValueAsString(room(RoomStatus.CREATED)));

        AuthenticationResult result =
                store.authenticateAndLoad(ROOM_ID, SecureHash.sha256("B".repeat(43)));

        assertThat(result.outcome()).isEqualTo(AuthenticationOutcome.AUTHENTICATION_REQUIRED);
        assertThat(result.room()).isNull();
        assertThat(result.participantId()).isNull();
    }

    @Test
    void reportsMissingAndClosedRoomAsUnavailable() throws Exception {
        when(values.get("watch-together:v1:room:" + ROOM_ID))
                .thenReturn(null)
                .thenReturn(objectMapper.writeValueAsString(room(RoomStatus.CLOSED)));

        assertThat(store.authenticateAndLoad(ROOM_ID, SecureHash.sha256(SESSION)).outcome())
                .isEqualTo(AuthenticationOutcome.ROOM_UNAVAILABLE);
        assertThat(store.authenticateAndLoad(ROOM_ID, SecureHash.sha256(SESSION)).outcome())
                .isEqualTo(AuthenticationOutcome.ROOM_UNAVAILABLE);
    }

    @Test
    void readsOnlineOfflineAndUnchangedPresenceResults() throws Exception {
        StoredRoom room = room(RoomStatus.CREATED);
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("ONLINE:" + objectMapper.writeValueAsString(room))
                .thenReturn("UNCHANGED:" + objectMapper.writeValueAsString(room))
                .thenReturn("OFFLINE:" + objectMapper.writeValueAsString(room));

        PresenceResult connected = store.connect(
                ROOM_ID,
                SecureHash.sha256(SESSION),
                HOST_ID,
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                Instant.parse("2026-07-09T10:01:00Z"),
                Duration.ofSeconds(30));
        PresenceResult heartbeat = store.heartbeat(
                ROOM_ID,
                SecureHash.sha256(SESSION),
                HOST_ID,
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                Instant.parse("2026-07-09T10:01:10Z"),
                Duration.ofSeconds(30));
        PresenceResult disconnected = store.disconnect(
                ROOM_ID,
                SecureHash.sha256(SESSION),
                HOST_ID,
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                Instant.parse("2026-07-09T10:01:20Z"));

        assertThat(connected.outcome()).isEqualTo(PresenceOutcome.ONLINE);
        assertThat(connected.room()).isEqualTo(room);
        assertThat(connected.participantId()).isEqualTo(HOST_ID);
        assertThat(heartbeat.outcome()).isEqualTo(PresenceOutcome.UNCHANGED);
        assertThat(disconnected.outcome()).isEqualTo(PresenceOutcome.OFFLINE);
    }

    @Test
    void readsPresenceRejectionResultsWithoutLeakingRoomState() {
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("AUTHENTICATION_REQUIRED")
                .thenReturn("ROOM_UNAVAILABLE")
                .thenReturn("STALE_CONNECTION");

        PresenceResult authenticationRequired = connect();
        assertThat(authenticationRequired.outcome())
                .isEqualTo(PresenceOutcome.AUTHENTICATION_REQUIRED);
        assertThat(authenticationRequired.room()).isNull();
        assertThat(connect().outcome()).isEqualTo(PresenceOutcome.ROOM_UNAVAILABLE);
        assertThat(connect().outcome()).isEqualTo(PresenceOutcome.STALE_CONNECTION);
    }

    private PresenceResult connect() {
        return store.connect(
                ROOM_ID,
                SecureHash.sha256(SESSION),
                HOST_ID,
                UUID.fromString("11111111-1111-4111-8111-111111111111"),
                Instant.parse("2026-07-09T10:01:00Z"),
                Duration.ofSeconds(30));
    }

    private StoredRoom room(RoomStatus status) {
        Instant now = Instant.parse("2026-07-09T10:00:00Z");
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                true,
                now,
                SecureHash.sha256(SESSION));
        return new StoredRoom(
                ROOM_ID,
                status,
                HOST_ID,
                List.of(host),
                2,
                now.plus(Duration.ofHours(4)),
                now,
                SecureHash.sha256("H".repeat(43)));
    }
}
