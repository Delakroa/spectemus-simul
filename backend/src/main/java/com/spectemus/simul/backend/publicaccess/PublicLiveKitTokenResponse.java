package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.util.UUID;

import com.spectemus.simul.backend.room.ParticipantRole;

/** Internet LiveKit token DTO. Separated from LAN LiveKitTokenResponse so roomName stays opaque. */
public record PublicLiveKitTokenResponse(
        String token,
        String liveKitUrl,
        String roomName,
        UUID participantId,
        String participantIdentity,
        ParticipantRole role,
        boolean canPublish,
        boolean canPublishData,
        Instant expiresAt) {}
