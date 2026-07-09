package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomJoinStore.JoinResult;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Repository
class RedisRoomJoinStore implements RoomJoinStore {

    private static final String JOINED_PREFIX = "JOINED:";
    private static final String REPLAYED_PREFIX = "REPLAYED:";
    private static final String ROOM_FULL = "ROOM_FULL";
    private static final String ROOM_UNAVAILABLE = "ROOM_UNAVAILABLE";
    private static final int PARTICIPANT_ID_LENGTH = 36;

    private static final DefaultRedisScript<String> JOIN_SCRIPT = new DefaultRedisScript<>(
            """
            local roomJson = redis.call('GET', KEYS[1])
            if not roomJson then
              return 'ROOM_UNAVAILABLE'
            end

            local room = cjson.decode(roomJson)
            local joinableStatuses = {
              CREATED = true,
              WAITING_FOR_HOST = true,
              READY = true,
              PLAYING = true,
              PAUSED = true,
              HOST_DISCONNECTED = true
            }
            if not joinableStatuses[room.status] then
              return 'ROOM_UNAVAILABLE'
            end

            if ARGV[1] ~= '' then
              for _, participant in ipairs(room.participants) do
                if participant.sessionCredentialHash == ARGV[1] then
                  return 'REPLAYED:' .. participant.participantId .. ':' .. roomJson
                end
              end
            end

            if #room.participants >= tonumber(ARGV[4]) then
              return 'ROOM_FULL'
            end

            local participant = cjson.decode(ARGV[2])
            table.insert(room.participants, participant)
            room.roomVersion = room.roomVersion + 1
            room.updatedAt = ARGV[3]

            local updatedRoomJson = cjson.encode(room)
            redis.call('SET', KEYS[1], updatedRoomJson, 'KEEPTTL')
            return 'JOINED:' .. participant.participantId .. ':' .. updatedRoomJson
            """,
            String.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    RedisRoomJoinStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public JoinResult join(
            String roomId,
            String sessionCredentialHash,
            StoredParticipant candidate,
            Instant updatedAt,
            int maxParticipants) {
        try {
            String result = redis.execute(
                    JOIN_SCRIPT,
                    List.of(roomRedisKey(roomId)),
                    sessionCredentialHash,
                    objectMapper.writeValueAsString(candidate),
                    updatedAt.toString(),
                    Integer.toString(maxParticipants));

            if (result == null) {
                throw new IllegalStateException("Redis room join script returned null");
            }
            if (ROOM_FULL.equals(result)) {
                return JoinResult.roomFull();
            }
            if (ROOM_UNAVAILABLE.equals(result)) {
                return JoinResult.roomUnavailable();
            }
            if (result.startsWith(JOINED_PREFIX)) {
                return readRoomResult(result, JOINED_PREFIX, true);
            }
            if (result.startsWith(REPLAYED_PREFIX)) {
                return readRoomResult(result, REPLAYED_PREFIX, false);
            }

            throw new IllegalStateException("Redis room join script returned unknown result");
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize room join", exception);
        }
    }

    private JoinResult readRoomResult(String result, String prefix, boolean joined)
            throws JacksonException {
        int participantIdStart = prefix.length();
        int roomJsonStart = participantIdStart + PARTICIPANT_ID_LENGTH + 1;
        if (result.length() <= roomJsonStart
                || result.charAt(roomJsonStart - 1) != ':') {
            throw new IllegalStateException("Redis room join script returned malformed result");
        }

        UUID participantId = UUID.fromString(result.substring(participantIdStart, roomJsonStart - 1));
        StoredRoom room =
                objectMapper.readValue(result.substring(roomJsonStart), StoredRoom.class);
        return joined
                ? JoinResult.joined(room, participantId)
                : JoinResult.replayed(room, participantId);
    }

    private String roomRedisKey(String roomId) {
        return "watch-together:v1:room:" + roomId;
    }
}
