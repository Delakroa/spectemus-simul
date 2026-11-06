package com.spectemus.simul.backend.publicaccess;

import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Fail-closed public LiveKit credentials for Internet-room tokens.
 *
 * <p>LAN {@code spectemus-simul.livekit} defaults ({@code devkey}, loopback {@code ws://}) must never
 * sign Internet tokens. The switch stays off unless an explicit {@code wss://} URL and non-default
 * API credentials are provided.
 */
@ConfigurationProperties("spectemus-simul.public-livekit")
public record PublicLiveKitProperties(
        Boolean enabled, String url, String apiKey, String apiSecret, Duration tokenTtl) {

    private static final Duration DEFAULT_TOKEN_TTL = Duration.ofMinutes(5);
    private static final Duration MAX_TOKEN_TTL = Duration.ofMinutes(15);
    private static final Set<String> FORBIDDEN_API_KEYS = Set.of("devkey");
    private static final Set<String> FORBIDDEN_API_SECRETS =
            Set.of("devsecretdevsecretdevsecretdevsecret");

    public PublicLiveKitProperties {
        enabled = enabled == null ? Boolean.FALSE : enabled;
        tokenTtl = tokenTtl == null ? DEFAULT_TOKEN_TTL : tokenTtl;

        if (Boolean.TRUE.equals(enabled)) {
            requireText(url, "url");
            requireText(apiKey, "api-key");
            requireText(apiSecret, "api-secret");
            requirePublicUrl(url);
            if (FORBIDDEN_API_KEYS.contains(apiKey.strip())) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.api-key must not use the LAN/default LiveKit key");
            }
            if (FORBIDDEN_API_SECRETS.contains(apiSecret.strip())) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.api-secret must not use the LAN/default LiveKit secret");
            }
            if (tokenTtl.isZero() || tokenTtl.isNegative()) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.token-ttl must be positive");
            }
            if (tokenTtl.compareTo(MAX_TOKEN_TTL) > 0) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.token-ttl must be at most 15m");
            }
        }
    }

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    private static void requireText(String value, String property) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property + " is required when enabled");
        }
    }

    private static void requirePublicUrl(String value) {
        URI uri;
        try {
            uri = URI.create(value.strip());
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit.url must be an absolute wss:// URL", exception);
        }
        if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit.url must be an absolute wss:// URL");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if ("localhost".equals(host)
                || "127.0.0.1".equals(host)
                || "::1".equals(host)
                || "[::1]".equals(host)) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit.url must not use a loopback LiveKit host");
        }
    }
}
