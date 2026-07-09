package com.watchtogether.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.rooms")
public record RoomProperties(Duration ttl, boolean sessionCookieSecure) {

    public RoomProperties {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("watch-together.rooms.ttl must be positive");
        }
    }
}
