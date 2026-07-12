package com.watchtogether.backend.telemetry;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.watchtogether.backend.room.ParticipantRole;

/**
 * One privacy-safe client telemetry event (WT-604). {@code roomId}, {@code role} and
 * {@code detail} are carried for log correlation only and are never used as metric tags;
 * {@code qualityStatus} is the single low-cardinality tag applied to quality samples.
 */
public record TelemetryEvent(
        @NotNull TelemetryEventType type,
        @Pattern(regexp = "^[A-Za-z0-9_-]{22}$") String roomId,
        ParticipantRole role,
        TelemetryQualityStatus qualityStatus,
        @Size(max = 200) String detail) {}
