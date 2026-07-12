package com.watchtogether.backend.telemetry;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import org.springframework.stereotype.Component;

/**
 * Privacy-safe Micrometer counters for client telemetry (WT-604). Records only aggregate
 * counts and a low-cardinality quality status tag — never roomId, participantId, user agent
 * or any free text. Exposed through the same actuator metrics / prometheus surface as the
 * WT-506 room metrics so a beta dashboard can compute the Successful Watch Session Rate.
 */
@Component
class TelemetryMetrics {

    private final MeterRegistry registry;
    private final Counter firstFrame;
    private final Counter publishStart;
    private final Counter publishFailure;
    private final Counter playbackError;

    TelemetryMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.firstFrame = Counter.builder("wt.telemetry.first_frame")
                .description("Guests that received the first video frame")
                .register(registry);
        this.publishStart = Counter.builder("wt.telemetry.publish_start")
                .description("Host publications that started successfully")
                .register(registry);
        this.publishFailure = Counter.builder("wt.telemetry.publish_failure")
                .description("Host publications that failed")
                .register(registry);
        this.playbackError = Counter.builder("wt.telemetry.playback_error")
                .description("Guest playback errors")
                .register(registry);
    }

    void record(TelemetryEventType type, TelemetryQualityStatus qualityStatus) {
        switch (type) {
            case FIRST_FRAME -> firstFrame.increment();
            case PUBLISH_START -> publishStart.increment();
            case PUBLISH_FAILURE -> publishFailure.increment();
            case PLAYBACK_ERROR -> playbackError.increment();
            case QUALITY_SUMMARY -> quality(qualityStatus);
        }
    }

    private void quality(TelemetryQualityStatus qualityStatus) {
        TelemetryQualityStatus status =
                qualityStatus == null ? TelemetryQualityStatus.UNKNOWN : qualityStatus;
        Counter.builder("wt.telemetry.quality")
                .description("Client quality samples, tagged by coarse status")
                .tag("status", status.name())
                .register(registry)
                .increment();
    }
}
