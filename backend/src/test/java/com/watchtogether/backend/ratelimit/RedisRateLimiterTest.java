package com.watchtogether.backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

class RedisRateLimiterTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final RedisRateLimiter rateLimiter = new RedisRateLimiter(redis);

    @Test
    void allowsWhenScriptReturnsNegative() {
        when(redis.execute(any(), anyList(), any(Object[].class))).thenReturn(-1L);

        RateLimitDecision decision =
                rateLimiter.tryAcquire("create-room", "1.2.3.4", 10, Duration.ofMinutes(1));

        assertThat(decision.allowed()).isTrue();
        assertThat(decision.retryAfterMillis()).isZero();
    }

    @Test
    void limitsWhenScriptReturnsRemainingTtl() {
        when(redis.execute(any(), anyList(), any(Object[].class))).thenReturn(4200L);

        RateLimitDecision decision =
                rateLimiter.tryAcquire("create-room", "1.2.3.4", 10, Duration.ofMinutes(1));

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.retryAfterMillis()).isEqualTo(4200L);
    }

    @Test
    void allowsWhenScriptReturnsNull() {
        when(redis.execute(any(), anyList(), any(Object[].class))).thenReturn(null);

        assertThat(rateLimiter
                        .tryAcquire("feedback", "1.2.3.4", 5, Duration.ofSeconds(30))
                        .allowed())
                .isTrue();
    }
}
