package com.watchtogether.backend.ratelimit;

import com.watchtogether.backend.ratelimit.RateLimitProperties.Limit;

import io.micrometer.core.instrument.MeterRegistry;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Registers one {@link RateLimitInterceptor} per protected endpoint (WT-606). When the feature is
 * disabled no interceptor is added, so there is zero request-path overhead. Paths mirror the
 * mutating REST surface exposed to the public internet during the invite-only beta.
 *
 * <p>Collaborators are injected as {@link ObjectProvider}s so this {@code WebMvcConfigurer} still
 * constructs inside a {@code @WebMvcTest} slice (where the Redis limiter and properties are not
 * loaded) — it simply registers nothing there.
 */
@Configuration
class RateLimitConfiguration implements WebMvcConfigurer {

    private final ObjectProvider<RateLimiter> rateLimiter;
    private final ObjectProvider<RateLimitProperties> properties;
    private final ObjectProvider<MeterRegistry> meterRegistry;

    RateLimitConfiguration(
            ObjectProvider<RateLimiter> rateLimiter,
            ObjectProvider<RateLimitProperties> properties,
            ObjectProvider<MeterRegistry> meterRegistry) {
        this.rateLimiter = rateLimiter;
        this.properties = properties;
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        RateLimiter limiter = rateLimiter.getIfAvailable();
        RateLimitProperties config = properties.getIfAvailable();
        MeterRegistry meters = meterRegistry.getIfAvailable();
        if (limiter == null || config == null || meters == null || !config.isEnabled()) {
            return;
        }

        register(registry, limiter, meters, "create-room", config.createRoom(), "/api/v1/rooms");
        register(registry, limiter, meters, "join-room", config.joinRoom(), "/api/v1/rooms/*/join");
        register(
                registry,
                limiter,
                meters,
                "livekit-token",
                config.livekitToken(),
                "/api/v1/rooms/*/livekit-token");
        register(registry, limiter, meters, "feedback", config.feedback(), "/api/v1/feedback");
        register(registry, limiter, meters, "telemetry", config.telemetry(), "/api/v1/telemetry");
    }

    private void register(
            InterceptorRegistry registry,
            RateLimiter limiter,
            MeterRegistry meters,
            String bucket,
            Limit limit,
            String pattern) {
        registry.addInterceptor(new RateLimitInterceptor(limiter, bucket, limit, meters))
                .addPathPatterns(pattern);
    }
}
