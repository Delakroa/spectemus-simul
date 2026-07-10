package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.UUID;

public record LiveKitTokenResponse(
        String token,
        String liveKitUrl,
        String roomName,
        UUID participantId,
        String participantIdentity,
        ParticipantRole role,
        boolean canPublish,
        boolean canPublishData,
        Instant expiresAt) {}
