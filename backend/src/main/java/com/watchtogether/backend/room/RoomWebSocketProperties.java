package com.watchtogether.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.websocket")
public record RoomWebSocketProperties(Duration presenceTtl) {

    private static final Duration DEFAULT_PRESENCE_TTL = Duration.ofSeconds(30);

    public RoomWebSocketProperties {
        if (presenceTtl == null) {
            presenceTtl = DEFAULT_PRESENCE_TTL;
        }
        if (presenceTtl.isZero() || presenceTtl.isNegative()) {
            throw new IllegalArgumentException(
                    "watch-together.websocket.presence-ttl must be positive");
        }
    }
}
