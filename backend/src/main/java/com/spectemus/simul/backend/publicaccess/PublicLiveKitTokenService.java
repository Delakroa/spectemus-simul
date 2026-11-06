package com.spectemus.simul.backend.publicaccess;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.spectemus.simul.backend.room.LiveKitTokenSigner;
import com.spectemus.simul.backend.room.ParticipantRole;

/**
 * Mints short-lived Internet LiveKit JWTs after account membership checks. Uses the shared
 * {@link LiveKitTokenSigner} and never falls back to LAN LiveKit credentials.
 */
final class PublicLiveKitTokenService {

    private final PublicAccessService accessService;
    private final PublicAccessSecrets secrets;
    private final PublicLiveKitProperties properties;
    private final LiveKitTokenSigner signer;
    private final Clock clock;

    PublicLiveKitTokenService(
            PublicAccessService accessService,
            PublicAccessSecrets secrets,
            PublicLiveKitProperties properties,
            LiveKitTokenSigner signer,
            Clock clock) {
        this.accessService = accessService;
        this.secrets = secrets;
        this.properties = properties;
        this.signer = signer;
        this.clock = clock;
    }

    PublicLiveKitTokenResponse mint(UUID publicRoomId, String sessionCredential) {
        PublicAccessService.ActiveMembership membership =
                accessService.requireActiveMembership(publicRoomId, sessionCredential);

        boolean host = membership.access().membership().role() == PublicMembershipRole.OWNER;
        ParticipantRole mediaRole = host ? ParticipantRole.HOST : ParticipantRole.GUEST;
        boolean canPublish = true;
        List<String> canPublishSources = host ? List.of() : List.of("microphone");
        boolean canPublishData = true;

        UUID accountId = membership.account().accountId();
        String roomName = secrets.livekitRoomName(publicRoomId);
        String participantIdentity = secrets.livekitParticipantIdentity(publicRoomId, accountId);
        UUID participantId = secrets.livekitParticipantId(publicRoomId, accountId);
        Instant issuedAt = Instant.now(clock);
        Instant expiresAt = issuedAt.plus(properties.tokenTtl());

        String token = signer.sign(
                properties.apiKey(),
                properties.apiSecret(),
                roomName,
                participantIdentity,
                membership.account().displayName(),
                canPublish,
                canPublishData,
                canPublishSources,
                issuedAt,
                expiresAt);

        return new PublicLiveKitTokenResponse(
                token,
                properties.url().strip(),
                roomName,
                participantId,
                participantIdentity,
                mediaRole,
                canPublish,
                canPublishData,
                expiresAt);
    }
}
