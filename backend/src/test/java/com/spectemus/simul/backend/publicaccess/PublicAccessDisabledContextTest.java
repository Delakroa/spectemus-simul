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
class PublicAccessDisabledContextTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void doesNotCreatePublicAccessRuntimeOrPermitV2WhenDisabled() throws Exception {
        assertThat(context.getBeansOfType(PublicAccessService.class)).isEmpty();
        assertThat(context.getBeansOfType(PublicAccessStore.class)).isEmpty();
        mockMvc.perform(post("/api/v2/auth/email-challenges")
                        .contentType("application/json")
                        .content("{\"email\":\"person@example.test\"}"))
                .andExpect(status().isForbidden());
    }
}
