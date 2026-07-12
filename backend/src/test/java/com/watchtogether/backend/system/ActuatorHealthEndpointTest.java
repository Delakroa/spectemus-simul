package com.watchtogether.backend.system;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(
        properties = {
            "management.health.redis.enabled=false",
            "watch-together.websocket.container-limits-enabled=false"
        })
class ActuatorHealthEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void actuatorHealthIsPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void actuatorMetricsIsNotPublic() throws Exception {
        int metricsStatus = mockMvc.perform(get("/actuator/metrics"))
                .andReturn()
                .getResponse()
                .getStatus();
        assertThat(metricsStatus).isIn(401, 403);
    }

    @Test
    void actuatorPrometheusIsNotPublic() throws Exception {
        int prometheusStatus = mockMvc.perform(get("/actuator/prometheus"))
                .andReturn()
                .getResponse()
                .getStatus();
        assertThat(prometheusStatus).isIn(401, 403);
    }
}
