package com.spectemus.simul.backend.publicaccess;

import java.net.URI;
import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Explicit Internet-mode switch and its required private runtime configuration.
 *
 * <p>The LAN product never reads these values. A half-filled configuration must fail before an
 * external route can become available rather than silently falling back to local credentials.
 */
@ConfigurationProperties("spectemus-simul.public-access")
public record PublicAccessProperties(
        Boolean enabled,
        String jdbcUrl,
        String jdbcUsername,
        String jdbcPassword,
        String identityPepper,
        Duration sessionTtl,
        Boolean cookieSecure,
        EmailProperties email,
        Boolean deviceBindingEnabled,
        String deviceBindingVerificationOrigin,
        Duration deviceBindingTtl,
        Duration deviceSessionTtl,
        Duration devicePollInterval) {

    private static final Duration DEFAULT_SESSION_TTL = Duration.ofDays(14);
    private static final Duration DEFAULT_DEVICE_BINDING_TTL = Duration.ofMinutes(10);
    private static final Duration DEFAULT_DEVICE_SESSION_TTL = Duration.ofDays(14);
    private static final Duration DEFAULT_DEVICE_POLL_INTERVAL = Duration.ofSeconds(5);

    public PublicAccessProperties {
        enabled = enabled == null ? Boolean.FALSE : enabled;
        sessionTtl = sessionTtl == null ? DEFAULT_SESSION_TTL : sessionTtl;
        cookieSecure = cookieSecure == null ? Boolean.TRUE : cookieSecure;
        email = email == null ? new EmailProperties(null, null, null, null, null, null) : email;
        deviceBindingEnabled = deviceBindingEnabled == null ? Boolean.FALSE : deviceBindingEnabled;
        deviceBindingTtl = deviceBindingTtl == null ? DEFAULT_DEVICE_BINDING_TTL : deviceBindingTtl;
        deviceSessionTtl = deviceSessionTtl == null ? DEFAULT_DEVICE_SESSION_TTL : deviceSessionTtl;
        devicePollInterval =
                devicePollInterval == null ? DEFAULT_DEVICE_POLL_INTERVAL : devicePollInterval;

        if (sessionTtl.isZero() || sessionTtl.isNegative()) {
            throw new IllegalArgumentException("spectemus-simul.public-access.session-ttl must be positive");
        }
        if (deviceBindingTtl.isZero() || deviceBindingTtl.isNegative()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access.device-binding-ttl must be positive");
        }
        if (deviceSessionTtl.isZero() || deviceSessionTtl.isNegative()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access.device-session-ttl must be positive");
        }
        if (devicePollInterval.isZero() || devicePollInterval.isNegative()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access.device-poll-interval must be positive");
        }
        // Record fields are assigned after this body. isEnabled() would still see the default.
        if (Boolean.TRUE.equals(enabled)) {
            requireText(jdbcUrl, "jdbc-url");
            requireText(jdbcUsername, "jdbc-username");
            requireText(jdbcPassword, "jdbc-password");
            requireText(identityPepper, "identity-pepper");
            if (!Boolean.TRUE.equals(cookieSecure)) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-access.cookie-secure must be true when public access is enabled");
            }
            email.requireConfigured();
        }
        if (Boolean.TRUE.equals(deviceBindingEnabled)) {
            if (!Boolean.TRUE.equals(enabled)) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-access.device-binding-enabled requires public-access.enabled=true");
            }
            requirePublicHttpsOrigin(deviceBindingVerificationOrigin, "device-binding-verification-origin");
        }
    }

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    public boolean isDeviceBindingEnabled() {
        return Boolean.TRUE.equals(deviceBindingEnabled);
    }

    private static void requireText(String value, String property) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access." + property + " is required when enabled");
        }
    }

    private static void requirePublicHttpsOrigin(String value, String property) {
        requireText(value, property);
        try {
            URI uri = URI.create(value.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || host == null
                    || host.isBlank()
                    || uri.getUserInfo() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                    || uri.getQuery() != null
                    || uri.getFragment() != null
                    || isLoopbackOrIpLiteral(host)) {
                throw new IllegalArgumentException(
                        "spectemus-simul.public-access."
                                + property
                                + " must be a public https:// origin without credentials, path, query or fragment");
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access." + property + " must be a valid https:// origin",
                    exception);
        }
    }

    private static boolean isLoopbackOrIpLiteral(String hostname) {
        String host = hostname.toLowerCase().replace("[", "").replace("]", "");
        if ("localhost".equals(host) || host.endsWith(".localhost") || "::1".equals(host) || host.contains(":")) {
            return true;
        }
        String[] parts = host.split("\\.");
        if (parts.length == 4) {
            boolean allNumeric = true;
            for (String part : parts) {
                try {
                    int octet = Integer.parseInt(part);
                    if (octet < 0 || octet > 255) {
                        allNumeric = false;
                        break;
                    }
                } catch (NumberFormatException ignored) {
                    allNumeric = false;
                    break;
                }
            }
            return allNumeric;
        }
        return false;
    }

    public record EmailProperties(
            String host, Integer port, String username, String password, String from, Boolean starttls) {

        public EmailProperties {
            port = port == null ? 587 : port;
            starttls = starttls == null ? Boolean.TRUE : starttls;
            if (port < 1 || port > 65535) {
                throw new IllegalArgumentException("public-access.email.port must be between 1 and 65535");
            }
        }

        boolean starttlsEnabled() {
            return Boolean.TRUE.equals(starttls);
        }

        void requireConfigured() {
            requireText(host, "email.host");
            requireText(username, "email.username");
            requireText(password, "email.password");
            requireText(from, "email.from");
        }
    }
}
