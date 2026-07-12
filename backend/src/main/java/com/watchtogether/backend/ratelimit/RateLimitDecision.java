package com.watchtogether.backend.ratelimit;

/** Outcome of a rate-limit check: whether the request is allowed and, if not, how long to wait. */
public record RateLimitDecision(boolean allowed, long retryAfterMillis) {

    public static RateLimitDecision allow() {
        return new RateLimitDecision(true, 0L);
    }

    public static RateLimitDecision limited(long retryAfterMillis) {
        return new RateLimitDecision(false, Math.max(0L, retryAfterMillis));
    }
}
