package com.watchtogether.backend.feedback;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

public record FeedbackClientMetadata(
        @Size(max = 512) String userAgent,
        @Size(max = 32) String language,
        @Size(max = 64) String platform,
        @Min(0) @Max(10000) Integer viewportWidth,
        @Min(0) @Max(10000) Integer viewportHeight,
        @Min(0) @Max(10) Double devicePixelRatio,
        @Size(max = 32) String networkEffectiveType,
        @Min(0) @Max(10000) Double networkDownlinkMbps,
        @Min(0) @Max(60000) Integer networkRttMs,
        Boolean networkSaveData,
        @Size(max = 32) String roomStatus,
        @Size(max = 32) String roomConnectionStatus,
        @Size(max = 32) String liveKitStatus,
        @Size(max = 32) String qualityStatus,
        @Min(0) @Max(4) Integer participantCount) {}
