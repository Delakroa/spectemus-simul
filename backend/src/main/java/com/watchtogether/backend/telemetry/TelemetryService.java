package com.watchtogether.backend.telemetry;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
class TelemetryService {

    private static final Logger log = LoggerFactory.getLogger(TelemetryService.class);

    private final Clock clock;
    private final TelemetryMetrics metrics;

    TelemetryService(Clock clock, TelemetryMetrics metrics) {
        this.clock = clock;
        this.metrics = metrics;
    }

    TelemetryResponse record(TelemetryRequest request, String correlationId) {
        UUID telemetryId = UUID.randomUUID();
        Instant receivedAt = Instant.now(clock);

        for (TelemetryEvent event : request.events()) {
            metrics.record(event.type(), event.qualityStatus());
            log.info(
                    "beta telemetry telemetryId={} correlationId={} type={} roomId={} role={} qualityStatus={} detail=\"{}\"",
                    telemetryId,
                    correlationId,
                    event.type(),
                    event.roomId(),
                    event.role(),
                    event.qualityStatus(),
                    sanitize(event.detail()));
        }

        return new TelemetryResponse(
                telemetryId, correlationId, receivedAt, request.events().size());
    }

    private String sanitize(String value) {
        if (value == null) {
            return null;
        }

        return value.replaceAll("[\\r\\n\\t]+", " ").strip();
    }
}
