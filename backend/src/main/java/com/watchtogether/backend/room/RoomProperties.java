package com.watchtogether.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.rooms")
public record RoomProperties(Duration ttl, boolean sessionCookieSecure, Duration cleanupGrace) {

    private static final Duration DEFAULT_CLEANUP_GRACE = Duration.ofMinutes(5);

    public RoomProperties {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("watch-together.rooms.ttl must be positive");
        }
        if (cleanupGrace == null) {
            cleanupGrace = DEFAULT_CLEANUP_GRACE;
        }
        if (cleanupGrace.isNegative()) {
            throw new IllegalArgumentException(
                    "watch-together.rooms.cleanup-grace must be zero or positive");
        }
    }

    Duration storageTtl() {
        return ttl.plus(cleanupGrace);
    }
}
