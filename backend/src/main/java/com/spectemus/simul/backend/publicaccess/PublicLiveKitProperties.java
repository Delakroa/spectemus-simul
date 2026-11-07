package com.spectemus.simul.backend.publicaccess;

import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Set;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Fail-closed public LiveKit credentials for Internet-room tokens and RoomService admin calls.
 *
 * <p>LAN {@code spectemus-simul.livekit} defaults ({@code devkey}, loopback {@code ws://}/{@code
 * http://}) must never sign Internet tokens or admin JWTs. Browser URL stays {@code wss://}; Room
 * Service API URL stays {@code https://}.
 */
@ConfigurationProperties("spectemus-simul.public-livekit")
public record PublicLiveKitProperties(
        Boolean enabled,
        String url,
        String apiUrl,
        String apiKey,
        String apiSecret,
        Duration tokenTtl,
        Duration adminTokenTtl,
        Duration adminTimeout) {

    private static final Duration DEFAULT_TOKEN_TTL = Duration.ofMinutes(5);
    private static final Duration MAX_TOKEN_TTL = Duration.ofMinutes(15);
    private static final Duration DEFAULT_ADMIN_TOKEN_TTL = Duration.ofMinutes(1);
    private static final Duration MAX_ADMIN_TOKEN_TTL = Duration.ofMinutes(5);
    private static final Duration DEFAULT_ADMIN_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration MAX_ADMIN_TIMEOUT = Duration.ofSeconds(15);
    private static final Set<String> FORBIDDEN_API_KEYS = Set.of("devkey");
    private static final Set<String> FORBIDDEN_API_SECRETS =
            Set.of("devsecretdevsecretdevsecretdevsecret");

    public PublicLiveKitProperties {
        enabled = enabled == null ? Boolean.FALSE : enabled;
        tokenTtl = tokenTtl == null ? DEFAULT_TOKEN_TTL : tokenTtl;
        adminTokenTtl = adminTokenTtl == null ? DEFAULT_ADMIN_TOKEN_TTL : adminTokenTtl;
        adminTimeout = adminTimeout == null ? DEFAULT_ADMIN_TIMEOUT : adminTimeout;

        if (Boolean.TRUE.equals(enabled)) {
            requireText(url, "url");
            requireText(apiUrl, "api-url");
            requireText(apiKey, "api-key");
            requireText(apiSecret, "api-secret");
            requireBrowserUrl(url);
            requireApiUrl(apiUrl);
            if (FORBIDDEN_API_KEYS.contains(apiKey.strip())) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.api-key must not use the LAN/default LiveKit key");
            }
            if (FORBIDDEN_API_SECRETS.contains(apiSecret.strip())) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-livekit.api-secret must not use the LAN/default LiveKit secret");
            }
            requirePositiveBounded(tokenTtl, "token-ttl", MAX_TOKEN_TTL);
            requirePositiveBounded(adminTokenTtl, "admin-token-ttl", MAX_ADMIN_TOKEN_TTL);
            requirePositiveBounded(adminTimeout, "admin-timeout", MAX_ADMIN_TIMEOUT);
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

    private static void requirePositiveBounded(Duration value, String property, Duration max) {
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property + " must be positive");
        }
        if (value.compareTo(max) > 0) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property + " must be at most " + max);
        }
    }

    private static void requireBrowserUrl(String value) {
        URI uri = parseAbsoluteUri(value, "url", "wss");
        rejectLoopback(uri, "url");
    }

    private static void requireApiUrl(String value) {
        URI uri = parseAbsoluteUri(value, "api-url", "https");
        rejectLoopback(uri, "api-url");
    }

    private static URI parseAbsoluteUri(String value, String property, String requiredScheme) {
        URI uri;
        try {
            uri = URI.create(value.strip());
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property + " must be an absolute "
                            + requiredScheme + ":// URL",
                    exception);
        }
        if (!requiredScheme.equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null
                || uri.getHost().isBlank()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property + " must be an absolute "
                            + requiredScheme + ":// URL");
        }
        return uri;
    }

    private static void rejectLoopback(URI uri, String property) {
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if ("localhost".equals(host)
                || "127.0.0.1".equals(host)
                || "::1".equals(host)
                || "[::1]".equals(host)) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-livekit." + property
                            + " must not use a loopback LiveKit host");
        }
    }
}
