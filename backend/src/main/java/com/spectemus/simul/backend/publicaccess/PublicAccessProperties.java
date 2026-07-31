package com.spectemus.simul.backend.publicaccess;

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
        EmailProperties email) {

    private static final Duration DEFAULT_SESSION_TTL = Duration.ofDays(14);

    public PublicAccessProperties {
        enabled = enabled == null ? Boolean.FALSE : enabled;
        sessionTtl = sessionTtl == null ? DEFAULT_SESSION_TTL : sessionTtl;
        cookieSecure = cookieSecure == null ? Boolean.TRUE : cookieSecure;
        email = email == null ? new EmailProperties(null, null, null, null, null, null) : email;

        if (sessionTtl.isZero() || sessionTtl.isNegative()) {
            throw new IllegalArgumentException("spectemus-simul.public-access.session-ttl must be positive");
        }
        if (isEnabled()) {
            requireText(jdbcUrl, "jdbc-url");
            requireText(jdbcUsername, "jdbc-username");
            requireText(jdbcPassword, "jdbc-password");
            requireText(identityPepper, "identity-pepper");
            if (!Boolean.TRUE.equals(cookieSecure)) {
                throw new IllegalArgumentException(
                        "public access requires a Secure wt_account cookie");
            }
            email.requireConfigured();
        }
    }

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    private static void requireText(String value, String property) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                    "spectemus-simul.public-access." + property + " is required when enabled");
        }
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
