package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.spectemus.simul.backend.SpectemusSimulBackendApplication;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        classes = SpectemusSimulBackendApplication.class,
        properties = "spectemus-simul.websocket.container-limits-enabled=false")
@AutoConfigureMockMvc
@ActiveProfiles("desktop")
class PublicLiveKitDisabledContextTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void doesNotExposePublicLiveKitTokenEndpointWhenConfigurationIsOff() throws Exception {
        assertThat(context.getBeansOfType(PublicLiveKitTokenService.class)).isEmpty();
        assertThat(context.getBeansOfType(PublicLiveKitTokenController.class)).isEmpty();
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/livekit-token",
                        "9de974f2-d79c-4bbf-b5ff-6fc83d608164"))
                .andExpect(status().isForbidden());
    }
}
