package com.spectemus.simul.backend.room;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("spectemus-simul.livekit")
public record LiveKitProperties(
        String url,
        boolean urlFromRequest,
        String apiKey,
        String apiSecret,
        Duration tokenTtl) {

    public LiveKitProperties {
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("spectemus-simul.livekit.url must not be blank");
        }
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalArgumentException("spectemus-simul.livekit.api-key must not be blank");
        }
        if (apiSecret == null || apiSecret.isBlank()) {
            throw new IllegalArgumentException("spectemus-simul.livekit.api-secret must not be blank");
        }
        if (tokenTtl == null || tokenTtl.isZero() || tokenTtl.isNegative()) {
            throw new IllegalArgumentException("spectemus-simul.livekit.token-ttl must be positive");
        }
    }
}
