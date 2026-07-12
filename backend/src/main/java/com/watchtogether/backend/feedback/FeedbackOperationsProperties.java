package com.watchtogether.backend.feedback;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("watch-together.feedback")
public record FeedbackOperationsProperties(
        String adminToken,
        Duration retention,
        Integer exportLimit) {

    private static final Duration DEFAULT_RETENTION = Duration.ofDays(30);
    private static final int DEFAULT_EXPORT_LIMIT = 200;
    private static final int MAX_EXPORT_LIMIT = 1000;

    public FeedbackOperationsProperties {
        adminToken = adminToken == null ? "" : adminToken.strip();
        retention = normalizeRetention(retention);
        exportLimit = normalizeLimit(exportLimit);
    }

    public boolean adminEnabled() {
        return !adminToken.isBlank();
    }

    private static Duration normalizeRetention(Duration value) {
        if (value == null || value.isZero() || value.isNegative()) {
            return DEFAULT_RETENTION;
        }

        return value;
    }

    private static int normalizeLimit(Integer value) {
        if (value == null || value <= 0) {
            return DEFAULT_EXPORT_LIMIT;
        }

        return Math.min(value, MAX_EXPORT_LIMIT);
    }
}
