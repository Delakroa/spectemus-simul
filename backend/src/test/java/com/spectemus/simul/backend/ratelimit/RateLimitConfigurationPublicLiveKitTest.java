package com.spectemus.simul.backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;

import com.spectemus.simul.backend.publicaccess.PublicAccessProperties;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.servlet.config.annotation.InterceptorRegistration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;

class RateLimitConfigurationPublicLiveKitTest {

    @Test
    void registersPublicLiveKitTokenOnSharedLivekitTokenBucket() {
        RateLimiter limiter = mock(RateLimiter.class);
        RateLimitProperties properties = new RateLimitProperties(
                true, null, null, null, null, null, null, null, null, null, null);
        PublicAccessProperties publicAccess = new PublicAccessProperties(
                true,
                "jdbc:postgresql://db.example.test:5432/spectemus",
                "spectemus",
                "not-a-real-password",
                "test-identity-pepper-at-least-32-characters",
                Duration.ofDays(14),
                true,
                new PublicAccessProperties.EmailProperties(
                        "smtp.example.test", 587, "user", "password", "login@example.test", true));

        RateLimitConfiguration configuration = new RateLimitConfiguration(
                provider(limiter),
                provider(properties),
                provider(new SimpleMeterRegistry()),
                provider(publicAccess));

        InterceptorRegistry registry = mock(InterceptorRegistry.class);
        InterceptorRegistration registration = mock(InterceptorRegistration.class);
        when(registry.addInterceptor(any())).thenReturn(registration);
        when(registration.addPathPatterns(any(String.class))).thenReturn(registration);

        configuration.addInterceptors(registry);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(registration, org.mockito.Mockito.atLeastOnce()).addPathPatterns(pathCaptor.capture());

        assertThat(pathCaptor.getAllValues())
                .contains(
                        "/api/v1/rooms/*/livekit-token",
                        "/api/v2/public-rooms/*/livekit-token");
    }

    private static <T> ObjectProvider<T> provider(T value) {
        return new ObjectProvider<>() {
            @Override
            public T getObject() {
                return value;
            }

            @Override
            public T getIfAvailable() {
                return value;
            }

            @Override
            public T getIfUnique() {
                return value;
            }
        };
    }
}
