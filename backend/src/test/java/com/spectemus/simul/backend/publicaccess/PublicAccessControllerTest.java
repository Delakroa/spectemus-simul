package com.spectemus.simul.backend.publicaccess;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.spectemus.simul.backend.api.ApiExceptionHandler;
import com.spectemus.simul.backend.api.CorrelationIdFilter;
import com.spectemus.simul.backend.config.SecurityConfig;
import com.spectemus.simul.backend.publicaccess.PublicAccessService.AccountSessionResult;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@WebMvcTest(PublicAccessController.class)
@TestPropertySource(properties = "spectemus-simul.public-access.enabled=true")
@Import({
    SecurityConfig.class,
    ApiExceptionHandler.class,
    CorrelationIdFilter.class,
    PublicAccessControllerTest.TestProperties.class
})
class PublicAccessControllerTest {

    private static final UUID ACCOUNT_ID = UUID.fromString("78142113-1566-4234-b3a4-9c4f9f631742");
    private static final UUID CHALLENGE_ID = UUID.fromString("71869607-b4d6-4b2e-a6e5-a4f5e9af47ca");
    private static final UUID ROOM_ID = UUID.fromString("9de974f2-d79c-4bbf-b5ff-6fc83d608164");
    private static final UUID INVITE_ID = UUID.fromString("09dc0ef3-cc4f-4745-a3d9-5990171d2bc9");
    private static final String ACCOUNT_SESSION = "A".repeat(43);

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private PublicAccessService service;

    @Test
    void acceptsEmailChallengeWithoutReturningCodeOrEmail() throws Exception {
        when(service.requestEmailChallenge("person@example.test"))
                .thenReturn(new EmailChallengeAcceptedResponse(
                        CHALLENGE_ID, Instant.parse("2026-08-01T12:10:00Z")));

        mockMvc.perform(post("/api/v2/auth/email-challenges")
                        .contentType("application/json")
                        .content("""
                                {"email":"person@example.test"}
                                """))
                .andExpect(status().isAccepted())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(jsonPath("$.challengeId").value(CHALLENGE_ID.toString()))
                .andExpect(jsonPath("$.expiresAt").value("2026-08-01T12:10:00Z"))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("person@example.test"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("code"))));
    }

    @Test
    void verifiesCodeWithSeparateSecureAccountCookie() throws Exception {
        AccountProfileResponse profile = new AccountProfileResponse(
                ACCOUNT_ID, "Мария", Instant.parse("2026-08-01T12:00:00Z"));
        when(service.verifyEmailChallenge(eq(CHALLENGE_ID), eq("ABCDE23456"), eq("Мария")))
                .thenReturn(new AccountSessionResult(profile, ACCOUNT_SESSION, Duration.ofDays(14)));

        mockMvc.perform(post("/api/v2/auth/email-challenges/{challengeId}/verify", CHALLENGE_ID)
                        .contentType("application/json")
                        .content("""
                                {"code":"ABCDE23456","displayName":"Мария"}
                                """))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Set-Cookie", containsString("wt_account=")))
                .andExpect(header().string("Set-Cookie", containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie", containsString("Secure")))
                .andExpect(header().string("Set-Cookie", containsString("SameSite=Strict")))
                .andExpect(cookie().value("wt_account", ACCOUNT_SESSION))
                .andExpect(jsonPath("$.accountId").value(ACCOUNT_ID.toString()))
                .andExpect(jsonPath("$.displayName").value("Мария"))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("ABCDE23456"))));
    }

    @Test
    void createsHashOnlyInvitePath() throws Exception {
        PublicInviteCreatedResponse response = new PublicInviteCreatedResponse(
                INVITE_ID,
                "/join#invite=" + "B".repeat(43),
                Instant.parse("2026-08-01T13:00:00Z"),
                1);
        when(service.createInvite(eq(ROOM_ID), eq(ACCOUNT_SESSION), eq("invite-create-0001"), any(), any()))
                .thenReturn(response);

        mockMvc.perform(post("/api/v2/public-rooms/{publicRoomId}/invites", ROOM_ID)
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", ACCOUNT_SESSION))
                        .header("Idempotency-Key", "invite-create-0001")
                        .contentType("application/json")
                        .content("""
                                {"expiresInMinutes":60,"maxRedemptions":1}
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.inviteId").value(INVITE_ID.toString()))
                .andExpect(jsonPath("$.invitePath").value("/join#invite=" + "B".repeat(43)))
                .andExpect(content().string(org.hamcrest.Matchers.not(containsString("?invite"))));
    }

    @Test
    void rejectsMissingInviteTokenBeforeCallingService() throws Exception {
        mockMvc.perform(post("/api/v2/invite-redemptions")
                        .cookie(new jakarta.servlet.http.Cookie("wt_account", ACCOUNT_SESSION))
                        .header("Idempotency-Key", "invite-redeem-0001")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.violations[0].field").value("inviteToken"))
                .andExpect(jsonPath("$.violations[0].message").value("Приглашение обязательно."));

        verifyNoInteractions(service);
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
    }
}
