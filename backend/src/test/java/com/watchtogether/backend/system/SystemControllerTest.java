package com.watchtogether.backend.system;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.watchtogether.backend.config.SecurityConfig;
import com.watchtogether.backend.config.TimeConfig;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SystemController.class)
@Import({SecurityConfig.class, TimeConfig.class})
@TestPropertySource(properties = "spring.application.name=watch-together-backend")
class SystemControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void healthEndpointReturnsUp() throws Exception {
        mockMvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.checkedAt").exists());
    }

    @Test
    void versionEndpointReturnsApplicationVersion() throws Exception {
        mockMvc.perform(get("/api/v1/version"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("watch-together-backend"))
                .andExpect(jsonPath("$.version").exists())
                .andExpect(jsonPath("$.apiVersion").value("v1"));
    }

    @Test
    void unknownEndpointIsNotPublic() throws Exception {
        mockMvc.perform(get("/api/v1/private"))
                .andExpect(status().isForbidden());
    }
}
