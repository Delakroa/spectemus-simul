package com.spectemus.simul.backend.ratelimit;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Per-endpoint rate-limit budgets (WT-606). Disabled buckets fall back to conservative defaults;
 * limits are keyed per client IP over a fixed window. {@code enabled} lets a deployment turn the
 * whole feature off (defaults on so the beta is protected out of the box).
 */
@ConfigurationProperties("spectemus-simul.rate-limit")
public record RateLimitProperties(
        Boolean enabled,
        Limit createRoom,
        Limit joinRoom,
        Limit livekitToken,
        Limit feedback,
        Limit telemetry,
        Limit emailChallenge,
        Limit emailChallengeVerify,
        Limit publicRoom,
        Limit publicInvite,
        Limit inviteRedemption) {

    private static final Limit DEFAULT_CREATE_ROOM = new Limit(10, Duration.ofMinutes(1));
    private static final Limit DEFAULT_JOIN_ROOM = new Limit(20, Duration.ofMinutes(1));
    private static final Limit DEFAULT_LIVEKIT_TOKEN = new Limit(30, Duration.ofMinutes(1));
    private static final Limit DEFAULT_FEEDBACK = new Limit(10, Duration.ofMinutes(1));
    private static final Limit DEFAULT_TELEMETRY = new Limit(60, Duration.ofMinutes(1));
    private static final Limit DEFAULT_EMAIL_CHALLENGE = new Limit(5, Duration.ofMinutes(15));
    private static final Limit DEFAULT_EMAIL_CHALLENGE_VERIFY = new Limit(10, Duration.ofMinutes(15));
    private static final Limit DEFAULT_PUBLIC_ROOM = new Limit(10, Duration.ofHours(1));
    private static final Limit DEFAULT_PUBLIC_INVITE = new Limit(20, Duration.ofHours(1));
    private static final Limit DEFAULT_INVITE_REDEMPTION = new Limit(20, Duration.ofMinutes(15));

    public RateLimitProperties {
        enabled = enabled == null ? Boolean.TRUE : enabled;
        createRoom = createRoom == null ? DEFAULT_CREATE_ROOM : createRoom;
        joinRoom = joinRoom == null ? DEFAULT_JOIN_ROOM : joinRoom;
        livekitToken = livekitToken == null ? DEFAULT_LIVEKIT_TOKEN : livekitToken;
        feedback = feedback == null ? DEFAULT_FEEDBACK : feedback;
        telemetry = telemetry == null ? DEFAULT_TELEMETRY : telemetry;
        emailChallenge = emailChallenge == null ? DEFAULT_EMAIL_CHALLENGE : emailChallenge;
        emailChallengeVerify = emailChallengeVerify == null
                ? DEFAULT_EMAIL_CHALLENGE_VERIFY
                : emailChallengeVerify;
        publicRoom = publicRoom == null ? DEFAULT_PUBLIC_ROOM : publicRoom;
        publicInvite = publicInvite == null ? DEFAULT_PUBLIC_INVITE : publicInvite;
        inviteRedemption = inviteRedemption == null ? DEFAULT_INVITE_REDEMPTION : inviteRedemption;
    }

    public boolean isEnabled() {
        return Boolean.TRUE.equals(enabled);
    }

    public record Limit(int requests, Duration window) {
        public Limit {
            if (requests <= 0) {
                throw new IllegalArgumentException(
                        "spectemus-simul.rate-limit requests must be positive");
            }
            if (window == null || window.isZero() || window.isNegative()) {
                throw new IllegalArgumentException(
                        "spectemus-simul.rate-limit window must be positive");
            }
        }
    }
}
