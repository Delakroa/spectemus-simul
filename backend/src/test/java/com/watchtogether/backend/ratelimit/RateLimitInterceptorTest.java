package com.watchtogether.backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.ratelimit.RateLimitProperties.Limit;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitInterceptorTest {

    private final RateLimiter rateLimiter = mock(RateLimiter.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final RateLimitInterceptor interceptor = new RateLimitInterceptor(
            rateLimiter, "create-room", new Limit(10, Duration.ofMinutes(1)), registry);

    @Test
    void allowsRequestWithinBudget() {
        when(rateLimiter.tryAcquire(anyString(), anyString(), anyInt(), any()))
                .thenReturn(RateLimitDecision.allow());
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/rooms");
        request.addHeader("X-Forwarded-For", "1.2.3.4, 10.0.0.1");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
                .isTrue();
    }

    @Test
    void skipsNonPostRequests() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/rooms");

        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
                .isTrue();
        verifyNoInteractions(rateLimiter);
    }

    @Test
    void rejectsOverBudgetWith429AndRetryAfter() {
        when(rateLimiter.tryAcquire("create-room", "1.2.3.4", 10, Duration.ofMinutes(1)))
                .thenReturn(RateLimitDecision.limited(4200L));
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/rooms");
        request.addHeader("X-Forwarded-For", "1.2.3.4, 10.0.0.1");
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> interceptor.preHandle(request, response, new Object()))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
                    assertThat(exception.code()).isEqualTo("RATE_LIMITED");
                    assertThat(exception.retryable()).isTrue();
                });
        assertThat(response.getHeader("Retry-After")).isEqualTo("5");
        assertThat(registry.get("wt.ratelimit.rejected")
                        .tag("bucket", "create-room")
                        .counter()
                        .count())
                .isEqualTo(1.0);
    }

    @Test
    void extractsFirstForwardedForHop() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/rooms");
        request.addHeader("X-Forwarded-For", "  9.9.9.9 , 10.0.0.1 ");

        assertThat(RateLimitInterceptor.clientKey(request)).isEqualTo("9.9.9.9");
    }

    @Test
    void fallsBackToRemoteAddrWithoutForwardedFor() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/rooms");
        request.setRemoteAddr("5.6.7.8");

        assertThat(RateLimitInterceptor.clientKey(request)).isEqualTo("5.6.7.8");
    }
}
