package com.watchtogether.backend.room;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
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
    private static final String ONLINE_PREFIX = "ONLINE:";
    private static final String OFFLINE_PREFIX = "OFFLINE:";
    private static final String UNCHANGED_PREFIX = "UNCHANGED:";
    private static final String AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED";
    private static final String ROOM_UNAVAILABLE = "ROOM_UNAVAILABLE";
    private static final String STALE_CONNECTION = "STALE_CONNECTION";

    private static final DefaultRedisScript<String> MARK_ONLINE_SCRIPT = new DefaultRedisScript<>(
            """
            local roomJson = redis.call('GET', KEYS[1])
            if not roomJson then
              return 'ROOM_UNAVAILABLE'
            end

            local room = cjson.decode(roomJson)
            if room.expiresAt <= ARGV[4] then
              return 'ROOM_UNAVAILABLE'
            end

            local availableStatuses = {
              CREATED = true,
              WAITING_FOR_HOST = true,
              READY = true,
              PLAYING = true,
              PAUSED = true,
              HOST_DISCONNECTED = true
            }
            if not availableStatuses[room.status] then
              return 'ROOM_UNAVAILABLE'
            end

            local participant = nil
            for _, item in ipairs(room.participants) do
              if item.participantId == ARGV[2] then
                participant = item
                break
              end
            end
            if not participant or participant.sessionCredentialHash ~= ARGV[1] then
              return 'AUTHENTICATION_REQUIRED'
            end

            if ARGV[6] == 'heartbeat' then
              local activeConnection = redis.call('GET', KEYS[2])
              if activeConnection and activeConnection ~= ARGV[3] then
                return 'STALE_CONNECTION'
              end
            end

            redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[5])

            if participant.online ~= true then
              participant.online = true
              room.roomVersion = room.roomVersion + 1
              room.updatedAt = ARGV[4]
              local updatedRoomJson = cjson.encode(room)
              redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
              return 'ONLINE:' .. updatedRoomJson
            end

            return 'UNCHANGED:' .. roomJson
            """,
            String.class);

    private static final DefaultRedisScript<String> MARK_OFFLINE_SCRIPT = new DefaultRedisScript<>(
            """
            local activeConnection = redis.call('GET', KEYS[2])
            if activeConnection and activeConnection ~= ARGV[3] then
              return 'STALE_CONNECTION'
            end

            local roomJson = redis.call('GET', KEYS[1])
            if not roomJson then
              return 'ROOM_UNAVAILABLE'
            end

            local room = cjson.decode(roomJson)
            local participant = nil
            for _, item in ipairs(room.participants) do
              if item.participantId == ARGV[2] then
                participant = item
                break
              end
            end
            if not participant or participant.sessionCredentialHash ~= ARGV[1] then
              return 'AUTHENTICATION_REQUIRED'
            end

            if activeConnection == ARGV[3] then
              redis.call('DEL', KEYS[2])
            end

            if participant.online == true then
              participant.online = false
              room.roomVersion = room.roomVersion + 1
              room.updatedAt = ARGV[4]
              local updatedRoomJson = cjson.encode(room)
              redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
              return 'OFFLINE:' .. updatedRoomJson
            end

            return 'UNCHANGED:' .. roomJson
            """,
            String.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    RedisRoomRealtimeStore(StringRedisTemplate redis, ObjectMapper objectMapper, Clock clock) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.clock = clock;
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
            if (!AVAILABLE_STATUSES.contains(room.status())
                    || !room.expiresAt().isAfter(Instant.now(clock))) {
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

    @Override
    public PresenceResult connect(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant connectedAt,
            Duration presenceTtl) {
        return markOnline(
                roomId,
                sessionCredentialHash,
                participantId,
                connectionId,
                connectedAt,
                presenceTtl,
                "connect");
    }

    @Override
    public PresenceResult heartbeat(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant heartbeatAt,
            Duration presenceTtl) {
        return markOnline(
                roomId,
                sessionCredentialHash,
                participantId,
                connectionId,
                heartbeatAt,
                presenceTtl,
                "heartbeat");
    }

    @Override
    public PresenceResult disconnect(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant disconnectedAt) {
        String result = redis.execute(
                MARK_OFFLINE_SCRIPT,
                List.of(roomRedisKey(roomId), presenceRedisKey(roomId, participantId)),
                sessionCredentialHash,
                participantId.toString(),
                connectionId.toString(),
                disconnectedAt.toString());
        return readPresenceResult(result, participantId, false);
    }

    private PresenceResult markOnline(
            String roomId,
            String sessionCredentialHash,
            UUID participantId,
            UUID connectionId,
            Instant changedAt,
            Duration presenceTtl,
            String mode) {
        String result = redis.execute(
                MARK_ONLINE_SCRIPT,
                List.of(roomRedisKey(roomId), presenceRedisKey(roomId, participantId)),
                sessionCredentialHash,
                participantId.toString(),
                connectionId.toString(),
                changedAt.toString(),
                Long.toString(presenceTtl.toMillis()),
                mode);
        return readPresenceResult(result, participantId, true);
    }

    private PresenceResult readPresenceResult(
            String result, UUID participantId, boolean onlineOperation) {
        if (result == null) {
            throw new IllegalStateException("Redis room presence script returned null");
        }
        if (AUTHENTICATION_REQUIRED.equals(result)) {
            return PresenceResult.authenticationRequired();
        }
        if (ROOM_UNAVAILABLE.equals(result)) {
            return PresenceResult.roomUnavailable();
        }
        if (STALE_CONNECTION.equals(result)) {
            return PresenceResult.staleConnection();
        }

        try {
            if (result.startsWith(UNCHANGED_PREFIX)) {
                return PresenceResult.unchanged(
                        readRoom(result.substring(UNCHANGED_PREFIX.length())),
                        participantId);
            }
            if (onlineOperation && result.startsWith(ONLINE_PREFIX)) {
                return PresenceResult.online(
                        readRoom(result.substring(ONLINE_PREFIX.length())),
                        participantId);
            }
            if (!onlineOperation && result.startsWith(OFFLINE_PREFIX)) {
                return PresenceResult.offline(
                        readRoom(result.substring(OFFLINE_PREFIX.length())),
                        participantId);
            }
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to read realtime room presence state", exception);
        }

        throw new IllegalStateException("Redis room presence script returned unknown result");
    }

    private StoredRoom readRoom(String json) throws JacksonException {
        return objectMapper.readValue(json, StoredRoom.class);
    }

    private boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

    private String roomRedisKey(String roomId) {
        return "watch-together:v1:room:" + roomId;
    }

    private String presenceRedisKey(String roomId, UUID participantId) {
        return "watch-together:v1:room-presence:" + roomId + ":" + participantId;
    }
}
