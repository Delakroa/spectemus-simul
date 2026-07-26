package com.spectemus.simul.backend.room;

import static org.assertj.core.api.Assertions.assertThat;

import com.spectemus.simul.backend.ratelimit.RateLimiter;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(properties = "spectemus-simul.websocket.container-limits-enabled=false")
@ActiveProfiles("desktop")
class DesktopProfileContextTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private RoomCreationStore roomCreationStore;

    @Autowired
    private RateLimiter rateLimiter;

    @Test
    void loadsDesktopStoresWithoutRedisBeans() {
        assertThat(roomCreationStore).isInstanceOf(InMemoryRoomStore.class);
        assertThat(rateLimiter.getClass().getSimpleName()).isEqualTo("InMemoryRateLimiter");
        assertThat(context.containsBean("redisRoomCreationStore")).isFalse();
        assertThat(context.containsBean("redisRateLimiter")).isFalse();
        assertThat(context.containsBean("inMemoryFeedbackStore")).isTrue();
    }
}
