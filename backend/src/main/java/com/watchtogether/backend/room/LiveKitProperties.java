package com.watchtogether.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.livekit")
public record LiveKitProperties(String url, String apiKey, String apiSecret, Duration tokenTtl) {

    public LiveKitProperties {
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("watch-together.livekit.url must not be blank");
        }
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalArgumentException("watch-together.livekit.api-key must not be blank");
        }
        if (apiSecret == null || apiSecret.isBlank()) {
            throw new IllegalArgumentException("watch-together.livekit.api-secret must not be blank");
        }
        if (tokenTtl == null || tokenTtl.isZero() || tokenTtl.isNegative()) {
            throw new IllegalArgumentException("watch-together.livekit.token-ttl must be positive");
        }
    }
}
