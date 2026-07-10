package com.watchtogether.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.websocket")
public record RoomWebSocketProperties(
        Duration presenceTtl,
        Integer chatRateLimit,
        Duration chatRateWindow,
        Duration hostReconnectGrace) {

    private static final Duration DEFAULT_PRESENCE_TTL = Duration.ofSeconds(30);
    private static final int DEFAULT_CHAT_RATE_LIMIT = 5;
    private static final Duration DEFAULT_CHAT_RATE_WINDOW = Duration.ofSeconds(5);
    private static final Duration DEFAULT_HOST_RECONNECT_GRACE = Duration.ofSeconds(60);

    public RoomWebSocketProperties {
        if (presenceTtl == null) {
            presenceTtl = DEFAULT_PRESENCE_TTL;
        }
        if (presenceTtl.isZero() || presenceTtl.isNegative()) {
            throw new IllegalArgumentException(
                    "watch-together.websocket.presence-ttl must be positive");
        }
        if (chatRateLimit == null) {
            chatRateLimit = DEFAULT_CHAT_RATE_LIMIT;
        }
        if (chatRateLimit < 1) {
            throw new IllegalArgumentException(
                    "watch-together.websocket.chat-rate-limit must be positive");
        }
        if (chatRateWindow == null) {
            chatRateWindow = DEFAULT_CHAT_RATE_WINDOW;
        }
        if (chatRateWindow.isZero() || chatRateWindow.isNegative()) {
            throw new IllegalArgumentException(
                    "watch-together.websocket.chat-rate-window must be positive");
        }
        if (hostReconnectGrace == null) {
            hostReconnectGrace = DEFAULT_HOST_RECONNECT_GRACE;
        }
        if (hostReconnectGrace.isZero() || hostReconnectGrace.isNegative()) {
            throw new IllegalArgumentException(
                    "watch-together.websocket.host-reconnect-grace must be positive");
        }
    }
}
