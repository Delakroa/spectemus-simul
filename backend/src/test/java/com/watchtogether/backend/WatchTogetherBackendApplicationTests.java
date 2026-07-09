package com.watchtogether.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "watch-together.websocket.container-limits-enabled=false")
class WatchTogetherBackendApplicationTests {

    @Test
    void contextLoads() {}
}
