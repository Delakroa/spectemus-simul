package com.watchtogether.backend.room;

import java.time.Duration;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Repository
class RedisRoomCreationStore implements RoomCreationStore {

    private static final String CREATED_PREFIX = "CREATED:";
    private static final String REPLAYED_PREFIX = "REPLAYED:";
    private static final String ROOM_ID_COLLISION = "ROOM_ID_COLLISION";

    private static final DefaultRedisScript<String> SAVE_SCRIPT = new DefaultRedisScript<>(
            """
            local existing = redis.call('GET', KEYS[1])
            if existing then
              return 'REPLAYED:' .. existing
            end

            if redis.call('EXISTS', KEYS[2]) == 1 then
              return 'ROOM_ID_COLLISION'
            end

            redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3])
            redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[4])
            return 'CREATED:' .. ARGV[2]
            """,
            String.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    RedisRoomCreationStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public SaveResult saveOrGet(
            String idempotencyKeyHash,
            StoredRoomCreation candidate,
            Duration roomStorageTtl,
            Duration idempotencyTtl) {
        try {
            String roomJson = objectMapper.writeValueAsString(candidate.room());
            String creationJson = objectMapper.writeValueAsString(candidate);
            String result = redis.execute(
                    SAVE_SCRIPT,
                    List.of(idempotencyRedisKey(idempotencyKeyHash), roomRedisKey(candidate.room().roomId())),
                    roomJson,
                    creationJson,
                    Long.toString(roomStorageTtl.toMillis()),
                    Long.toString(idempotencyTtl.toMillis()));

            if (result == null) {
                throw new IllegalStateException("Redis room creation script returned null");
            }
            if (ROOM_ID_COLLISION.equals(result)) {
                return SaveResult.roomIdCollision();
            }
            if (result.startsWith(CREATED_PREFIX)) {
                return SaveResult.created(readCreation(result.substring(CREATED_PREFIX.length())));
            }
            if (result.startsWith(REPLAYED_PREFIX)) {
                return SaveResult.replayed(readCreation(result.substring(REPLAYED_PREFIX.length())));
            }

            throw new IllegalStateException("Redis room creation script returned unknown result");
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize room creation", exception);
        }
    }

    private StoredRoomCreation readCreation(String json) throws JacksonException {
        return objectMapper.readValue(json, StoredRoomCreation.class);
    }

    private String idempotencyRedisKey(String idempotencyKeyHash) {
        return "watch-together:v1:idempotency:create-room:" + idempotencyKeyHash;
    }

    private String roomRedisKey(String roomId) {
        return "watch-together:v1:room:" + roomId;
    }
}
