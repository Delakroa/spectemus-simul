package com.watchtogether.backend.ratelimit;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.ratelimit.RateLimitProperties.Limit;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Enforces one endpoint's rate-limit budget per client (WT-606). Only mutating POSTs are counted;
 * the client is identified by the first {@code X-Forwarded-For} hop (the gateway sets it) falling
 * back to the socket address. Over-budget requests get {@code 429 RATE_LIMITED} with a
 * {@code Retry-After} header and a privacy-safe rejection metric (tagged by bucket, no client id).
 */
class RateLimitInterceptor implements HandlerInterceptor {

    private final RateLimiter rateLimiter;
    private final String bucket;
    private final Limit limit;
    private final MeterRegistry meterRegistry;

    RateLimitInterceptor(RateLimiter rateLimiter, String bucket, Limit limit, MeterRegistry meterRegistry) {
        this.rateLimiter = rateLimiter;
        this.bucket = bucket;
        this.limit = limit;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!"POST".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        RateLimitDecision decision =
                rateLimiter.tryAcquire(bucket, clientKey(request), limit.requests(), limit.window());
        if (decision.allowed()) {
            return true;
        }

        long retryAfterSeconds = Math.max(1L, (decision.retryAfterMillis() + 999L) / 1000L);
        response.setHeader("Retry-After", Long.toString(retryAfterSeconds));
        Counter.builder("wt.ratelimit.rejected")
                .description("Requests rejected by the rate limiter, tagged by bucket")
                .tag("bucket", bucket)
                .register(meterRegistry)
                .increment();

        throw ApiException.rateLimited("Слишком много запросов. Повторите позже.");
    }

    static String clientKey(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            int comma = forwardedFor.indexOf(',');
            String first = comma > 0 ? forwardedFor.substring(0, comma) : forwardedFor;
            return first.trim();
        }

        String remoteAddr = request.getRemoteAddr();
        return remoteAddr == null || remoteAddr.isBlank() ? "unknown" : remoteAddr;
    }
}
