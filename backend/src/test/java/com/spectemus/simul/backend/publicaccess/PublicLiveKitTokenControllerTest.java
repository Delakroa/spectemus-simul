package com.spectemus.simul.backend.publicaccess;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.spectemus.simul.backend.api.ApiException;
import com.spectemus.simul.backend.api.ApiExceptionHandler;
import com.spectemus.simul.backend.api.CorrelationIdFilter;
import com.spectemus.simul.backend.config.SecurityConfig;
import com.spectemus.simul.backend.room.ParticipantRole;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = PublicLiveKitTokenController.class)
@TestPropertySource(
        properties = {
            "spectemus-simul.public-access.enabled=true",
            "spectemus-simul.public-livekit.enabled=true"
        })
@Import({
    SecurityConfig.class,
    ApiExceptionHandler.class,
    CorrelationIdFilter.class,
    PublicLiveKitTokenControllerTest.TestProperties.class
})
class PublicLiveKitTokenControllerTest {

    private static final UUID ROOM_ID = UUID.fromString("9de974f2-d79c-4bbf-b5ff-6fc83d608164");
    private static final UUID PARTICIPANT_ID = UUID.fromString("78142113-1566-4234-b3a4-9c4f9f631742");
    private static final String ACCOUNT_SESSION = "A".repeat(43);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PublicLiveKitTokenService service;

    @Test
    void returnsNoStoreTokenResponse() throws Exception {
        when(service.mint(ROOM_ID, ACCOUNT_SESSION))
                .thenReturn(new PublicLiveKitTokenResponse(
                        "header.payload.signature-value",
                        "wss://rtc.example.test",
                        "B".repeat(43),
                        PARTICIPANT_ID,
                        "C".repeat(43),
                        ParticipantRole.HOST,
                        true,
                        true,
                        Instant.parse("2026-11-06T12:05:00Z")));

        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/livekit-token", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", ACCOUNT_SESSION)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.token").value("header.payload.signature-value"))
                .andExpect(jsonPath("$.liveKitUrl").value("wss://rtc.example.test"))
                .andExpect(jsonPath("$.roomName").value("B".repeat(43)))
                .andExpect(jsonPath("$.role").value("HOST"));
    }

    @Test
    void mapsAccountRequiredToUnauthorized() throws Exception {
        when(service.mint(ROOM_ID, null))
                .thenThrow(ApiException.unauthorized(
                        "ACCOUNT_REQUIRED",
                        "Нужен вход",
                        "Войдите через подтверждённый email и повторите действие."));

        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/livekit-token", ROOM_ID))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("ACCOUNT_REQUIRED"));
    }

    @Test
    void mapsMembershipRequiredToNotFound() throws Exception {
        when(service.mint(ROOM_ID, ACCOUNT_SESSION))
                .thenThrow(new ApiException(
                        HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_REQUIRED",
                        "Комната недоступна",
                        "Эта комната недоступна для текущего account.",
                        false,
                        java.util.List.of()));

        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/livekit-token", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", ACCOUNT_SESSION)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("MEMBERSHIP_REQUIRED"));
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
                            "smtp.example.test", 587, "user", "password", "login@example.test", true));
        }

        @Bean
        PublicLiveKitProperties publicLiveKitProperties() {
            return new PublicLiveKitProperties(
                    true,
                    "wss://rtc.example.test",
                    "https://rtc-api.example.test",
                    "public-key",
                    "public-secret-value",
                    Duration.ofMinutes(5),
                    Duration.ofMinutes(1),
                    Duration.ofSeconds(3));
        }
    }
}
