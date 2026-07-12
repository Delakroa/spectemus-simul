package com.watchtogether.backend.ratelimit;

import java.time.Duration;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * Redis-backed fixed-window rate limiter (WT-606). One atomic Lua script increments the window
 * counter and sets its TTL on first hit, so the budget is shared across backend instances (unlike
 * the per-instance in-memory chat limiter). Returns the remaining window TTL when the limit is
 * exceeded so the caller can emit an accurate {@code Retry-After}.
 */
@Component
class RedisRateLimiter implements RateLimiter {

    private static final DefaultRedisScript<Long> SCRIPT = new DefaultRedisScript<>(
            """
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('PEXPIRE', KEYS[1], ARGV[2])
            end
            if current > tonumber(ARGV[1]) then
              return redis.call('PTTL', KEYS[1])
            end
            return -1
            """,
            Long.class);

    private final StringRedisTemplate redis;

    RedisRateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public RateLimitDecision tryAcquire(String bucket, String clientKey, int limit, Duration window) {
        Long result = redis.execute(
                SCRIPT,
                List.of(key(bucket, clientKey)),
                Integer.toString(limit),
                Long.toString(window.toMillis()));

        if (result == null || result < 0L) {
            return RateLimitDecision.allow();
        }
        return RateLimitDecision.limited(result);
    }

    private String key(String bucket, String clientKey) {
        return "watch-together:v1:ratelimit:" + bucket + ":" + clientKey;
    }
}
