package com.watchtogether.backend.room;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.EnumSet;
import java.util.Set;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Repository
class RedisRoomRealtimeStore implements RoomRealtimeStore {

    private static final Set<RoomStatus> AVAILABLE_STATUSES = EnumSet.of(
            RoomStatus.CREATED,
            RoomStatus.WAITING_FOR_HOST,
            RoomStatus.READY,
            RoomStatus.PLAYING,
            RoomStatus.PAUSED,
            RoomStatus.HOST_DISCONNECTED);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    RedisRoomRealtimeStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public AuthenticationResult authenticateAndLoad(
            String roomId, String sessionCredentialHash) {
        String roomJson = redis.opsForValue().get(roomRedisKey(roomId));
        if (roomJson == null) {
            return AuthenticationResult.roomUnavailable();
        }

        try {
            StoredRoom room = objectMapper.readValue(roomJson, StoredRoom.class);
            if (!AVAILABLE_STATUSES.contains(room.status())) {
                return AuthenticationResult.roomUnavailable();
            }

            return room.participants().stream()
                    .filter(participant -> constantTimeEquals(
                            participant.sessionCredentialHash(), sessionCredentialHash))
                    .findFirst()
                    .map(StoredParticipant::participantId)
                    .map(participantId -> AuthenticationResult.authenticated(room, participantId))
                    .orElseGet(AuthenticationResult::authenticationRequired);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to read realtime room state", exception);
        }
    }

    private boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

    private String roomRedisKey(String roomId) {
        return "watch-together:v1:room:" + roomId;
    }
}
