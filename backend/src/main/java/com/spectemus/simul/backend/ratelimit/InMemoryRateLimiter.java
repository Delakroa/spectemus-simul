package com.spectemus.simul.backend.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Process-local fixed-window limiter for the single-process desktop profile.
 * Docker/staging keeps the Redis implementation so limits remain shared there.
 */
@Component
@Profile("desktop")
class InMemoryRateLimiter implements RateLimiter {

    private final Clock clock;
    private final Map<String, Window> windows = new HashMap<>();

    InMemoryRateLimiter(Clock clock) {
        this.clock = clock;
    }

    @Override
    public synchronized RateLimitDecision tryAcquire(
            String bucket, String clientKey, int limit, Duration duration) {
        Instant now = Instant.now(clock);
        String key = bucket + "\u0000" + clientKey;
        Window window = windows.get(key);
        if (window == null || !window.expiresAt().isAfter(now)) {
            window = new Window(0, now.plus(duration));
        }

        Window updated = new Window(window.count() + 1, window.expiresAt());
        windows.put(key, updated);
        if (updated.count() <= limit) {
            return RateLimitDecision.allow();
        }

        return RateLimitDecision.limited(Duration.between(now, updated.expiresAt()).toMillis());
    }

    private record Window(int count, Instant expiresAt) {}
}
