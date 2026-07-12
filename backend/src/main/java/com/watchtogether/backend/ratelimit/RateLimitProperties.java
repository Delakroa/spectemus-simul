package com.watchtogether.backend.ratelimit;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Per-endpoint rate-limit budgets (WT-606). Disabled buckets fall back to conservative defaults;
 * limits are keyed per client IP over a fixed window. {@code enabled} lets a deployment turn the
 * whole feature off (defaults on so the beta is protected out of the box).
 */
@ConfigurationProperties("watch-together.rate-limit")
public record RateLimitProperties(
        Boolean enabled,
        Limit createRoom,
        Limit joinRoom,
        Limit livekitToken,
        Limit feedback,
        Limit telemetry) {

    private static final Limit DEFAULT_CREATE_ROOM = new Limit(10, Duration.ofMinutes(1));
    private static final Limit DEFAULT_JOIN_ROOM = new Limit(20, Duration.ofMinutes(1));
    private static final Limit DEFAULT_LIVEKIT_TOKEN = new Limit(30, Duration.ofMinutes(1));
    private static final Limit DEFAULT_FEEDBACK = new Limit(10, Duration.ofMinutes(1));
    private static final Limit DEFAULT_TELEMETRY = new Limit(60, Duration.ofMinutes(1));

    public RateLimitProperties {
        enabled = enabled == null ? Boolean.TRUE : enabled;
        createRoom = createRoom == null ? DEFAULT_CREATE_ROOM : createRoom;
        joinRoom = joinRoom == null ? DEFAULT_JOIN_ROOM : joinRoom;
        livekitToken = livekitToken == null ? DEFAULT_LIVEKIT_TOKEN : livekitToken;
        feedback = feedback == null ? DEFAULT_FEEDBACK : feedback;
        telemetry = telemetry == null ? DEFAULT_TELEMETRY : telemetry;
    }

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    public record Limit(int requests, Duration window) {
        public Limit {
            if (requests <= 0) {
                throw new IllegalArgumentException(
                        "watch-together.rate-limit requests must be positive");
            }
            if (window == null || window.isZero() || window.isNegative()) {
                throw new IllegalArgumentException(
                        "watch-together.rate-limit window must be positive");
            }
        }
    }
}
