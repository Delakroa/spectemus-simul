package com.watchtogether.backend.ratelimit;

import java.time.Duration;

/**
 * Fixed-window rate limiter keyed by {@code (bucket, clientKey)}. Implementations must be safe
 * across backend instances so a horizontally scaled beta shares one budget per client.
 */
public interface RateLimiter {

    RateLimitDecision tryAcquire(String bucket, String clientKey, int limit, Duration window);
}
