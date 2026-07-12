package com.watchtogether.backend.telemetry;

import java.time.Instant;
import java.util.UUID;

public record TelemetryResponse(
        UUID telemetryId, String correlationId, Instant receivedAt, int accepted) {}
