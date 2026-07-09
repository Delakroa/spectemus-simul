package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveOutcome;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveResult;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleOutcome;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleResult;

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
class RedisRoomLifecycleStoreTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @Autowired
    private RedisRoomLifecycleStore store;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private StringRedisTemplate redis;

    @Test
    void readsClosedExpiredAndAlreadyClosedResults() throws Exception {
        StoredRoom closed = room(RoomStatus.CLOSED);
        StoredRoom expired = room(RoomStatus.EXPIRED);
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("CLOSED:" + objectMapper.writeValueAsString(closed))
                .thenReturn("EXPIRED:" + objectMapper.writeValueAsString(expired))
                .thenReturn("ALREADY_CLOSED:" + objectMapper.writeValueAsString(closed));

        LifecycleResult closedResult = store.closeByHost(
                ROOM_ID,
                "session-hash",
                "host-secret-hash",
                Instant.parse("2026-07-09T12:00:00Z"));
        LifecycleResult expiredResult =
                store.expire(ROOM_ID, Instant.parse("2026-07-09T12:00:00Z"));
        LifecycleResult alreadyClosed =
                store.expire(ROOM_ID, Instant.parse("2026-07-09T12:00:00Z"));

        assertThat(closedResult.outcome()).isEqualTo(LifecycleOutcome.CLOSED);
        assertThat(closedResult.room()).isEqualTo(closed);
        assertThat(expiredResult.outcome()).isEqualTo(LifecycleOutcome.EXPIRED);
        assertThat(expiredResult.room()).isEqualTo(expired);
        assertThat(alreadyClosed.outcome()).isEqualTo(LifecycleOutcome.ALREADY_CLOSED);
        assertThat(alreadyClosed.room()).isEqualTo(closed);
    }

    @Test
    void readsLifecycleRejectionResultsWithoutLeakingRoomState() {
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("ACCESS_DENIED")
                .thenReturn("ROOM_UNAVAILABLE")
                .thenReturn("ALREADY_EXPIRED")
                .thenReturn("NOT_EXPIRED");

        LifecycleResult accessDenied = close();
        LifecycleResult roomUnavailable = close();
        LifecycleResult alreadyExpired = close();
        LifecycleResult notExpired = close();

        assertThat(accessDenied.outcome()).isEqualTo(LifecycleOutcome.ACCESS_DENIED);
        assertThat(accessDenied.room()).isNull();
        assertThat(roomUnavailable.outcome()).isEqualTo(LifecycleOutcome.ROOM_UNAVAILABLE);
        assertThat(roomUnavailable.room()).isNull();
        assertThat(alreadyExpired.outcome()).isEqualTo(LifecycleOutcome.ALREADY_EXPIRED);
        assertThat(notExpired.outcome()).isEqualTo(LifecycleOutcome.NOT_EXPIRED);
    }

    @Test
    void readsLeaveResultWithParticipantIdAndUpdatedRoom() throws Exception {
        StoredRoom afterLeave = room(RoomStatus.CREATED);
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("LEFT:" + GUEST_ID + ":" + objectMapper.writeValueAsString(afterLeave));

        LeaveResult result = store.leave(
                ROOM_ID,
                "guest-session-hash",
                Instant.parse("2026-07-09T12:00:00Z"));

        assertThat(result.outcome()).isEqualTo(LeaveOutcome.LEFT);
        assertThat(result.participantId()).isEqualTo(GUEST_ID);
        assertThat(result.room()).isEqualTo(afterLeave);
    }

    @Test
    void readsLeaveRejectionResultsWithoutLeakingRoomState() {
        when(redis.execute(any(), anyList(), any(Object[].class)))
                .thenReturn("AUTHENTICATION_REQUIRED")
                .thenReturn("HOST_CANNOT_LEAVE")
                .thenReturn("ROOM_UNAVAILABLE");

        LeaveResult authenticationRequired = leave();
        LeaveResult hostCannotLeave = leave();
        LeaveResult roomUnavailable = leave();

        assertThat(authenticationRequired.outcome())
                .isEqualTo(LeaveOutcome.AUTHENTICATION_REQUIRED);
        assertThat(authenticationRequired.room()).isNull();
        assertThat(hostCannotLeave.outcome()).isEqualTo(LeaveOutcome.HOST_CANNOT_LEAVE);
        assertThat(hostCannotLeave.room()).isNull();
        assertThat(roomUnavailable.outcome()).isEqualTo(LeaveOutcome.ROOM_UNAVAILABLE);
        assertThat(roomUnavailable.room()).isNull();
    }

    private LifecycleResult close() {
        return store.closeByHost(
                ROOM_ID,
                "session-hash",
                "host-secret-hash",
                Instant.parse("2026-07-09T12:00:00Z"));
    }

    private LeaveResult leave() {
        return store.leave(
                ROOM_ID,
                "guest-session-hash",
                Instant.parse("2026-07-09T12:00:00Z"));
    }

    private StoredRoom room(RoomStatus status) {
        Instant now = Instant.parse("2026-07-09T12:00:00Z");
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                false,
                now.minus(Duration.ofHours(1)),
                "session-hash");
        return new StoredRoom(
                ROOM_ID,
                status,
                HOST_ID,
                List.of(host),
                3,
                now.plus(Duration.ofHours(3)),
                now,
                "host-secret-hash");
    }
}
