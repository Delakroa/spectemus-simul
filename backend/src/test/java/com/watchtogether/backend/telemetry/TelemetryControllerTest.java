package com.watchtogether.backend.telemetry;

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

@WebMvcTest(TelemetryController.class)
@Import({SecurityConfig.class, ApiExceptionHandler.class, CorrelationIdFilter.class})
class TelemetryControllerTest {

    private static final UUID TELEMETRY_ID =
            UUID.fromString("a1b2c3d4-1111-4222-8333-444455556666");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TelemetryService telemetryService;

    @Test
    void acceptsTelemetryBatchAccordingToContract() throws Exception {
        when(telemetryService.record(any(), anyString()))
                .thenReturn(new TelemetryResponse(
                        TELEMETRY_ID,
                        "22222222-2222-4222-8222-222222222222",
                        Instant.parse("2026-07-12T12:00:00Z"),
                        3));

        mockMvc.perform(post("/api/v1/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "events": [
                                    {
                                      "type": "FIRST_FRAME",
                                      "roomId": "AbCdEfGhIjKlMnOpQrStUv",
                                      "role": "GUEST"
                                    },
                                    {
                                      "type": "QUALITY_SUMMARY",
                                      "role": "GUEST",
                                      "qualityStatus": "WARNING"
                                    },
                                    {
                                      "type": "RECOVERY_STARTED",
                                      "role": "HOST"
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isAccepted())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(header().exists(CorrelationIdFilter.HEADER))
                .andExpect(jsonPath("$.telemetryId").value(TELEMETRY_ID.toString()))
                .andExpect(jsonPath("$.correlationId").value(
                        "22222222-2222-4222-8222-222222222222"))
                .andExpect(jsonPath("$.receivedAt").value("2026-07-12T12:00:00Z"))
                .andExpect(jsonPath("$.accepted").value(3));

        ArgumentCaptor<TelemetryRequest> requestCaptor =
                ArgumentCaptor.forClass(TelemetryRequest.class);
        verify(telemetryService).record(requestCaptor.capture(), anyString());
        TelemetryRequest request = requestCaptor.getValue();
        org.assertj.core.api.Assertions.assertThat(request.events()).hasSize(3);
        org.assertj.core.api.Assertions.assertThat(request.events().get(0).type())
                .isEqualTo(TelemetryEventType.FIRST_FRAME);
        org.assertj.core.api.Assertions.assertThat(request.events().get(0).roomId())
                .isEqualTo(ROOM_ID);
        org.assertj.core.api.Assertions.assertThat(request.events().get(1).qualityStatus())
                .isEqualTo(TelemetryQualityStatus.WARNING);
        org.assertj.core.api.Assertions.assertThat(request.events().get(2).type())
                .isEqualTo(TelemetryEventType.RECOVERY_STARTED);
    }

    @Test
    void rejectsEmptyTelemetryBatch() throws Exception {
        mockMvc.perform(post("/api/v1/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "events": []
                                }
                                """))
                .andExpect(status().isUnprocessableContent())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.correlationId").exists())
                .andExpect(jsonPath("$.violations[0].field").value("events"));
    }

    @Test
    void rejectsEventWithMissingType() throws Exception {
        mockMvc.perform(post("/api/v1/telemetry")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "events": [
                                    { "role": "GUEST" }
                                  ]
                                }
                                """))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
}
