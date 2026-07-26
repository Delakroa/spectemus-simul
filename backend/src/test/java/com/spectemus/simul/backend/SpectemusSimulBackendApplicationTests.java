package com.spectemus.simul.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = "spectemus-simul.websocket.container-limits-enabled=false")
class SpectemusSimulBackendApplicationTests {

    @Test
    void contextLoads() {}
}
