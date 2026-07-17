package com.watchtogether.backend.telemetry;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.Test;

class TelemetryServiceTest {

    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final TelemetryService service = new TelemetryService(
            Clock.fixed(Instant.parse("2026-07-12T12:00:00Z"), ZoneOffset.UTC),
            new TelemetryMetrics(registry));

    @Test
    void incrementsCountersPerEventTypeAndTagsQualityStatus() {
        TelemetryResponse response = service.record(
                new TelemetryRequest(List.of(
                        new TelemetryEvent(
                                TelemetryEventType.PUBLISH_START,
                                "AbCdEfGhIjKlMnOpQrStUv",
                                null,
                                null,
                                null),
                        new TelemetryEvent(
                                TelemetryEventType.FIRST_FRAME, null, null, null, null),
                        new TelemetryEvent(
                                TelemetryEventType.PLAYBACK_ERROR,
                                null,
                                null,
                                null,
                                "play() rejected"),
                        new TelemetryEvent(
                                TelemetryEventType.QUALITY_SUMMARY,
                                null,
                                null,
                                TelemetryQualityStatus.WARNING,
                                null),
                        new TelemetryEvent(
                                TelemetryEventType.RECOVERY_REQUESTED,
                                null,
                                null,
                                null,
                                null),
                        new TelemetryEvent(
                                TelemetryEventType.RECOVERY_STARTED, null, null, null, null),
                        new TelemetryEvent(
                                TelemetryEventType.RECOVERY_SUCCEEDED, null, null, null, null),
                        new TelemetryEvent(
                                TelemetryEventType.RECOVERY_FAILURE,
                                null,
                                null,
                                null,
                                "captureStream failed"))),
                "corr-1");

        assertThat(response.accepted()).isEqualTo(8);
        assertThat(response.receivedAt()).isEqualTo(Instant.parse("2026-07-12T12:00:00Z"));
        assertThat(registry.get("wt.telemetry.publish_start").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.first_frame").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.playback_error").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.quality").tag("status", "WARNING").counter().count())
                .isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.recovery_requested").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.recovery_started").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.recovery_succeeded").counter().count()).isEqualTo(1.0);
        assertThat(registry.get("wt.telemetry.recovery_failure").counter().count()).isEqualTo(1.0);
    }

    @Test
    void defaultsQualityStatusTagToUnknownWhenAbsent() {
        service.record(
                new TelemetryRequest(List.of(new TelemetryEvent(
                        TelemetryEventType.QUALITY_SUMMARY, null, null, null, null))),
                "corr-2");

        assertThat(registry.get("wt.telemetry.quality").tag("status", "UNKNOWN").counter().count())
                .isEqualTo(1.0);
    }
}
