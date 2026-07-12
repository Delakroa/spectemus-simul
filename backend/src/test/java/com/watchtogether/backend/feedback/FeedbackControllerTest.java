package com.watchtogether.backend.feedback;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.api.ApiExceptionHandler;
import com.watchtogether.backend.api.CorrelationIdFilter;
import com.watchtogether.backend.config.SecurityConfig;
import com.watchtogether.backend.room.ParticipantRole;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(FeedbackController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CorrelationIdFilter.class})
@EnableConfigurationProperties(FeedbackOperationsProperties.class)
@TestPropertySource(properties = {
        "watch-together.feedback.admin-token=test-token",
        "watch-together.feedback.export-limit=3",
        "watch-together.feedback.retention=30d"
})
class FeedbackControllerTest {

    private static final UUID FEEDBACK_ID =
            UUID.fromString("f4b1dc2a-28e1-4490-88cf-3a6f5aefef43");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final UUID RELATED_CORRELATION_ID =
            UUID.fromString("11111111-1111-4111-8111-111111111111");

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FeedbackService feedbackService;

    @Test
    void acceptsFeedbackAccordingToContract() throws Exception {
        when(feedbackService.record(any(), anyString()))
                .thenReturn(new FeedbackResponse(
                        FEEDBACK_ID,
                        "22222222-2222-4222-8222-222222222222",
                        Instant.parse("2026-07-12T12:00:00Z")));

        mockMvc.perform(post("/api/v1/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "outcome": "ISSUE",
                                  "reason": "CONNECTION",
                                  "message": "Гость потерял звук после reconnect.",
                                  "roomId": "AbCdEfGhIjKlMnOpQrStUv",
                                  "participantRole": "HOST",
                                  "relatedCorrelationId": "11111111-1111-4111-8111-111111111111",
                                  "metadata": {
                                    "userAgent": "Chrome beta",
                                    "language": "ru-RU",
                                    "viewportWidth": 1440,
                                    "viewportHeight": 900,
                                    "networkEffectiveType": "4g",
                                    "roomConnectionStatus": "open",
                                    "liveKitStatus": "connected",
                                    "qualityStatus": "warning",
                                    "participantCount": 2
                                  }
                                }
                                """))
                .andExpect(status().isAccepted())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(jsonPath("$.feedbackId").value(FEEDBACK_ID.toString()))
                .andExpect(jsonPath("$.correlationId").value(
                        "22222222-2222-4222-8222-222222222222"))
                .andExpect(jsonPath("$.receivedAt").value("2026-07-12T12:00:00Z"));

        ArgumentCaptor<FeedbackRequest> requestCaptor =
                ArgumentCaptor.forClass(FeedbackRequest.class);
        verify(feedbackService).record(requestCaptor.capture(), anyString());
        FeedbackRequest request = requestCaptor.getValue();
        org.assertj.core.api.Assertions.assertThat(request.outcome())
                .isEqualTo(FeedbackOutcome.ISSUE);
        org.assertj.core.api.Assertions.assertThat(request.reason())
                .isEqualTo(FeedbackReason.CONNECTION);
        org.assertj.core.api.Assertions.assertThat(request.roomId()).isEqualTo(ROOM_ID);
        org.assertj.core.api.Assertions.assertThat(request.participantRole().name())
                .isEqualTo("HOST");
        org.assertj.core.api.Assertions.assertThat(request.relatedCorrelationId())
                .isEqualTo(RELATED_CORRELATION_ID);
        org.assertj.core.api.Assertions.assertThat(request.metadata().networkEffectiveType())
                .isEqualTo("4g");
    }

    @Test
    void rejectsInvalidFeedbackPayload() throws Exception {
        mockMvc.perform(post("/api/v1/feedback")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "outcome": "ISSUE",
                                  "message": "No reason"
                                }
                                """))
                .andExpect(status().isUnprocessableContent())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.correlationId").exists())
                .andExpect(jsonPath("$.violations[0].field").value("reason"));
    }

    @Test
    void rejectsFeedbackOperationsWithoutAdminToken() throws Exception {
        mockMvc.perform(get("/api/v1/feedback/reports"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("FEEDBACK_ADMIN_FORBIDDEN"))
                .andExpect(jsonPath("$.correlationId").exists());
    }

    @Test
    void listsFeedbackReportsForOperator() throws Exception {
        when(feedbackService.listReports(2))
                .thenReturn(new FeedbackReportListResponse(
                        Instant.parse("2026-07-12T12:05:00Z"),
                        1,
                        List.of(new FeedbackReportSummary(
                                FEEDBACK_ID,
                                "22222222-2222-4222-8222-222222222222",
                                Instant.parse("2026-07-12T12:00:00Z"),
                                FeedbackOutcome.ISSUE,
                                FeedbackReason.CONNECTION,
                                ROOM_ID,
                                ParticipantRole.HOST,
                                RELATED_CORRELATION_ID,
                                FeedbackTriageStatus.NEW,
                                FeedbackSeverity.UNSET,
                                null,
                                "Гость потерял звук"))));

        mockMvc.perform(get("/api/v1/feedback/reports")
                        .param("limit", "2")
                        .header("X-Feedback-Admin-Token", "test-token"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.listedAt").value("2026-07-12T12:05:00Z"))
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.reports[0].feedbackId").value(FEEDBACK_ID.toString()))
                .andExpect(jsonPath("$.reports[0].triageStatus").value("NEW"))
                .andExpect(jsonPath("$.reports[0].messagePreview").value("Гость потерял звук"));

        verify(feedbackService).listReports(2);
    }

    @Test
    void exportsFeedbackReportsForOperator() throws Exception {
        when(feedbackService.exportReports(3))
                .thenReturn(new FeedbackReportExportResponse(
                        Instant.parse("2026-07-12T12:06:00Z"),
                        1,
                        List.of(feedbackReport(FeedbackTriageStatus.NEW, FeedbackSeverity.UNSET))));

        mockMvc.perform(get("/api/v1/feedback/reports/export")
                        .header("X-Feedback-Admin-Token", "test-token"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.exportedAt").value("2026-07-12T12:06:00Z"))
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.reports[0].feedbackId").value(FEEDBACK_ID.toString()))
                .andExpect(jsonPath("$.reports[0].metadata.language").value("ru-RU"));

        verify(feedbackService).exportReports(3);
    }

    @Test
    void triagesFeedbackReportForOperator() throws Exception {
        when(feedbackService.triage(eq(FEEDBACK_ID), any()))
                .thenReturn(feedbackReport(FeedbackTriageStatus.REVIEWING, FeedbackSeverity.HIGH));

        mockMvc.perform(patch("/api/v1/feedback/reports/{feedbackId}", FEEDBACK_ID)
                        .header("X-Feedback-Admin-Token", "test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "status": "REVIEWING",
                                  "severity": "HIGH",
                                  "assignee": "beta-ops",
                                  "note": "Проверить reconnect path"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(jsonPath("$.feedbackId").value(FEEDBACK_ID.toString()))
                .andExpect(jsonPath("$.triageStatus").value("REVIEWING"))
                .andExpect(jsonPath("$.severity").value("HIGH"))
                .andExpect(jsonPath("$.assignee").value("beta-ops"));

        ArgumentCaptor<FeedbackTriageRequest> requestCaptor =
                ArgumentCaptor.forClass(FeedbackTriageRequest.class);
        verify(feedbackService).triage(eq(FEEDBACK_ID), requestCaptor.capture());
        org.assertj.core.api.Assertions.assertThat(requestCaptor.getValue().status())
                .isEqualTo(FeedbackTriageStatus.REVIEWING);
    }

    private FeedbackReport feedbackReport(
            FeedbackTriageStatus status, FeedbackSeverity severity) {
        return new FeedbackReport(
                FEEDBACK_ID,
                "22222222-2222-4222-8222-222222222222",
                Instant.parse("2026-07-12T12:00:00Z"),
                FeedbackOutcome.ISSUE,
                FeedbackReason.CONNECTION,
                "Гость потерял звук после reconnect.",
                ROOM_ID,
                ParticipantRole.HOST,
                RELATED_CORRELATION_ID,
                new FeedbackClientMetadata(
                        "Chrome beta",
                        "ru-RU",
                        null,
                        1440,
                        900,
                        null,
                        "4g",
                        null,
                        null,
                        null,
                        null,
                        "open",
                        "connected",
                        "warning",
                        2),
                status,
                severity,
                status == FeedbackTriageStatus.NEW ? null : "beta-ops",
                status == FeedbackTriageStatus.NEW ? null : "Проверить reconnect path",
                status == FeedbackTriageStatus.NEW
                        ? null
                        : Instant.parse("2026-07-12T12:10:00Z"));
    }
}
