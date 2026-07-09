package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.List;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveResult;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleResult;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Repository
class RedisRoomLifecycleStore implements RoomLifecycleStore {

    private static final String CLOSED_PREFIX = "CLOSED:";
    private static final String EXPIRED_PREFIX = "EXPIRED:";
    private static final String ALREADY_CLOSED_PREFIX = "ALREADY_CLOSED:";
    private static final String ALREADY_EXPIRED = "ALREADY_EXPIRED";
    private static final String NOT_EXPIRED = "NOT_EXPIRED";
    private static final String ACCESS_DENIED = "ACCESS_DENIED";
    private static final String AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED";
    private static final String HOST_CANNOT_LEAVE = "HOST_CANNOT_LEAVE";
    private static final String LEFT_PREFIX = "LEFT:";
    private static final String ROOM_UNAVAILABLE = "ROOM_UNAVAILABLE";
    private static final int PARTICIPANT_ID_LENGTH = 36;

    private static final DefaultRedisScript<String> CLOSE_BY_HOST_SCRIPT =
            new DefaultRedisScript<>(
                    """
                    local roomJson = redis.call('GET', KEYS[1])
                    if not roomJson then
                      return 'ROOM_UNAVAILABLE'
                    end

                    local room = cjson.decode(roomJson)
                    local host = nil
                    for _, participant in ipairs(room.participants) do
                      if participant.participantId == room.hostParticipantId then
                        host = participant
                        break
                      end
                    end
                    if not host
                        or host.sessionCredentialHash ~= ARGV[1]
                        or room.hostSecretHash ~= ARGV[2] then
                      return 'ACCESS_DENIED'
                    end

                    if room.status == 'CLOSED' then
                      return 'ALREADY_CLOSED:' .. roomJson
                    end
                    if room.status == 'EXPIRED' or room.expiresAt <= ARGV[3] then
                      return 'ROOM_UNAVAILABLE'
                    end

                    local closeableStatuses = {
                      CREATED = true,
                      WAITING_FOR_HOST = true,
                      READY = true,
                      PLAYING = true,
                      PAUSED = true,
                      HOST_DISCONNECTED = true
                    }
                    if not closeableStatuses[room.status] then
                      return 'ROOM_UNAVAILABLE'
                    end

                    room.status = 'CLOSED'
                    room.roomVersion = room.roomVersion + 1
                    room.updatedAt = ARGV[3]
                    for _, participant in ipairs(room.participants) do
                      participant.online = false
                      redis.call('DEL', ARGV[4] .. participant.participantId)
                    end

                    local updatedRoomJson = cjson.encode(room)
                    redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
                    return 'CLOSED:' .. updatedRoomJson
                    """,
                    String.class);

    private static final DefaultRedisScript<String> EXPIRE_SCRIPT = new DefaultRedisScript<>(
            """
            local roomJson = redis.call('GET', KEYS[1])
            if not roomJson then
              return 'ROOM_UNAVAILABLE'
            end

            local room = cjson.decode(roomJson)
            if room.status == 'CLOSED' then
              return 'ALREADY_CLOSED:' .. roomJson
            end
            if room.status == 'EXPIRED' then
              return 'ALREADY_EXPIRED'
            end
            if room.expiresAt > ARGV[1] then
              return 'NOT_EXPIRED'
            end

            local expirableStatuses = {
              CREATED = true,
              WAITING_FOR_HOST = true,
              READY = true,
              PLAYING = true,
              PAUSED = true,
              HOST_DISCONNECTED = true
            }
            if not expirableStatuses[room.status] then
              return 'ROOM_UNAVAILABLE'
            end

            room.status = 'EXPIRED'
            room.roomVersion = room.roomVersion + 1
            room.updatedAt = ARGV[1]
            for _, participant in ipairs(room.participants) do
              participant.online = false
              redis.call('DEL', ARGV[2] .. participant.participantId)
            end

            local updatedRoomJson = cjson.encode(room)
            redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
            return 'EXPIRED:' .. updatedRoomJson
            """,
            String.class);

    private static final DefaultRedisScript<String> LEAVE_SCRIPT = new DefaultRedisScript<>(
            """
            local roomJson = redis.call('GET', KEYS[1])
            if not roomJson then
              return 'ROOM_UNAVAILABLE'
            end

            local room = cjson.decode(roomJson)
            if room.status == 'CLOSED' or room.status == 'EXPIRED' or room.expiresAt <= ARGV[2] then
              return 'ROOM_UNAVAILABLE'
            end

            local leaveableStatuses = {
              CREATED = true,
              WAITING_FOR_HOST = true,
              READY = true,
              PLAYING = true,
              PAUSED = true,
              HOST_DISCONNECTED = true
            }
            if not leaveableStatuses[room.status] then
              return 'ROOM_UNAVAILABLE'
            end

            local participantIndex = nil
            local participant = nil
            for index, item in ipairs(room.participants) do
              if item.sessionCredentialHash == ARGV[1] then
                participantIndex = index
                participant = item
                break
              end
            end
            if not participant then
              return 'AUTHENTICATION_REQUIRED'
            end
            if participant.participantId == room.hostParticipantId then
              return 'HOST_CANNOT_LEAVE'
            end

            table.remove(room.participants, participantIndex)
            room.roomVersion = room.roomVersion + 1
            room.updatedAt = ARGV[2]
            redis.call('DEL', ARGV[3] .. participant.participantId)

            local updatedRoomJson = cjson.encode(room)
            redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
            return 'LEFT:' .. participant.participantId .. ':' .. updatedRoomJson
            """,
            String.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    RedisRoomLifecycleStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public LifecycleResult closeByHost(
            String roomId, String sessionCredentialHash, String hostSecretHash, Instant closedAt) {
        String result = redis.execute(
                CLOSE_BY_HOST_SCRIPT,
                List.of(roomRedisKey(roomId)),
                sessionCredentialHash,
                hostSecretHash,
                closedAt.toString(),
                presenceRedisKeyPrefix(roomId));
        return readLifecycleResult(result);
    }

    @Override
    public LifecycleResult expire(String roomId, Instant expiredAt) {
        String result = redis.execute(
                EXPIRE_SCRIPT,
                List.of(roomRedisKey(roomId)),
                expiredAt.toString(),
                presenceRedisKeyPrefix(roomId));
        return readLifecycleResult(result);
    }

    @Override
    public LeaveResult leave(String roomId, String sessionCredentialHash, Instant leftAt) {
        String result = redis.execute(
                LEAVE_SCRIPT,
                List.of(roomRedisKey(roomId)),
                sessionCredentialHash,
                leftAt.toString(),
                presenceRedisKeyPrefix(roomId));
        return readLeaveResult(result);
    }

    private LifecycleResult readLifecycleResult(String result) {
        if (result == null) {
            throw new IllegalStateException("Redis room lifecycle script returned null");
        }
        if (ACCESS_DENIED.equals(result)) {
            return LifecycleResult.accessDenied();
        }
        if (ROOM_UNAVAILABLE.equals(result)) {
            return LifecycleResult.roomUnavailable();
        }
        if (ALREADY_EXPIRED.equals(result)) {
            return LifecycleResult.alreadyExpired();
        }
        if (NOT_EXPIRED.equals(result)) {
            return LifecycleResult.notExpired();
        }

        try {
            if (result.startsWith(CLOSED_PREFIX)) {
                return LifecycleResult.closed(readRoom(result.substring(CLOSED_PREFIX.length())));
            }
            if (result.startsWith(EXPIRED_PREFIX)) {
                return LifecycleResult.expired(readRoom(result.substring(EXPIRED_PREFIX.length())));
            }
            if (result.startsWith(ALREADY_CLOSED_PREFIX)) {
                return LifecycleResult.alreadyClosed(
                        readRoom(result.substring(ALREADY_CLOSED_PREFIX.length())));
            }
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to read room lifecycle state", exception);
        }

        throw new IllegalStateException("Redis room lifecycle script returned unknown result");
    }

    private LeaveResult readLeaveResult(String result) {
        if (result == null) {
            throw new IllegalStateException("Redis room leave script returned null");
        }
        if (AUTHENTICATION_REQUIRED.equals(result)) {
            return LeaveResult.authenticationRequired();
        }
        if (HOST_CANNOT_LEAVE.equals(result)) {
            return LeaveResult.hostCannotLeave();
        }
        if (ROOM_UNAVAILABLE.equals(result)) {
            return LeaveResult.roomUnavailable();
        }

        try {
            if (result.startsWith(LEFT_PREFIX)) {
                int participantIdStart = LEFT_PREFIX.length();
                int roomJsonStart = participantIdStart + PARTICIPANT_ID_LENGTH + 1;
                if (result.length() <= roomJsonStart
                        || result.charAt(roomJsonStart - 1) != ':') {
                    throw new IllegalStateException("Redis room leave script returned malformed result");
                }

                var participantId = java.util.UUID.fromString(
                        result.substring(participantIdStart, roomJsonStart - 1));
                StoredRoom room = readRoom(result.substring(roomJsonStart));
                return LeaveResult.left(room, participantId);
            }
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to read room leave state", exception);
        }

        throw new IllegalStateException("Redis room leave script returned unknown result");
    }

    private StoredRoom readRoom(String json) throws JacksonException {
        return objectMapper.readValue(json, StoredRoom.class);
    }

    private String roomRedisKey(String roomId) {
        return "watch-together:v1:room:" + roomId;
    }

    private String presenceRedisKeyPrefix(String roomId) {
        return "watch-together:v1:room-presence:" + roomId + ":";
    }
}
