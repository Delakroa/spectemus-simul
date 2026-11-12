package com.spectemus.simul.backend.publicaccess;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.util.UUID;

import com.spectemus.simul.backend.api.ApiException;
import com.spectemus.simul.backend.api.ApiExceptionHandler;
import com.spectemus.simul.backend.api.CorrelationIdFilter;
import com.spectemus.simul.backend.config.SecurityConfig;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = PublicConnectionTelemetryController.class)
@TestPropertySource(properties = {
    "spectemus-simul.public-access.enabled=true",
    "spectemus-simul.public-livekit.enabled=true"
})
@Import({
    SecurityConfig.class,
    ApiExceptionHandler.class,
    CorrelationIdFilter.class,
    PublicConnectionTelemetryControllerTest.TestProperties.class
})
class PublicConnectionTelemetryControllerTest {

    private static final UUID ROOM_ID = UUID.fromString("9de974f2-d79c-4bbf-b5ff-6fc83d608164");
    private static final String COOKIE = "A".repeat(43);
    private static final String BEARER = "B".repeat(43);

    @Autowired private MockMvc mockMvc;
    @MockitoBean private PublicConnectionTelemetryService service;

    @Test
    void acceptsCookieAndReturnsNoStoreWithoutReceipt() throws Exception {
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", COOKIE))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"RECONNECTING\"}"))
                .andExpect(status().isAccepted())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().string(""));
        verify(service).record(ROOM_ID, COOKIE, PublicConnectionEventType.RECONNECTING);
    }

    @Test
    void acceptsDesktopBearer() throws Exception {
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .header("Authorization", "Bearer " + BEARER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"CONNECTED\"}"))
                .andExpect(status().isAccepted());
        verify(service).record(ROOM_ID, BEARER, PublicConnectionEventType.CONNECTED);
    }

    @Test
    void cookieWinsOverBearer() throws Exception {
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", COOKIE))
                        .header("Authorization", "Bearer " + BEARER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"CONNECTED\"}"))
                .andExpect(status().isAccepted());
        verify(service).record(ROOM_ID, COOKIE, PublicConnectionEventType.CONNECTED);
    }

    @Test
    void rejectsMissingAndUnknownEventBeforeCounting() throws Exception {
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().is(422));
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"ARBITRARY\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"CONNECTED\",\"detail\":\"must not be accepted\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test
    void mapsMissingAccountAndRevokedMembership() throws Exception {
        doThrow(ApiException.unauthorized("ACCOUNT_REQUIRED", "Нужен вход", "Войдите снова"))
                .when(service).record(ROOM_ID, null, PublicConnectionEventType.CONNECTED);
        doThrow(ApiException.notFound("MEMBERSHIP_REQUIRED", "Комната недоступна", "Нет доступа"))
                .when(service).record(ROOM_ID, COOKIE, PublicConnectionEventType.CONNECTED);

        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"CONNECTED\"}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/connection-telemetry", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", COOKIE))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"CONNECTED\"}"))
                .andExpect(status().isNotFound());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestProperties {
        @Bean
        PublicAccessProperties publicAccessProperties() {
            return new PublicAccessProperties(
                    true,
                    "jdbc:postgresql://db.example.test:5432/spectemus",
                    "spectemus",
                    "not-a-real-password",
                    "test-identity-pepper-at-least-32-characters",
                    Duration.ofDays(14),
                    true,
                    new PublicAccessProperties.EmailProperties(
                            "smtp.example.test", 587, "user", "password", "login@example.test", true),
                    null, null, null, null, null);
        }
    }
}
