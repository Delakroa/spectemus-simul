package com.watchtogether.backend.feedback;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.api.ApiExceptionHandler;
import com.watchtogether.backend.api.CorrelationIdFilter;
import com.watchtogether.backend.config.SecurityConfig;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(FeedbackController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CorrelationIdFilter.class})
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
}
