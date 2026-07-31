package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.util.UUID;

record EmailChallengeAcceptedResponse(UUID challengeId, Instant expiresAt) {}

record AccountProfileResponse(UUID accountId, String displayName, Instant createdAt) {}

record PublicRoomResponse(
        UUID publicRoomId,
        PublicRoomStatus status,
        int memberLimit,
        Instant createdAt,
        Instant expiresAt) {}

record PublicRoomMembershipResponse(PublicMembershipRole role, Instant joinedAt) {}

record PublicRoomAccessResponse(
        PublicRoomResponse room, PublicRoomMembershipResponse membership) {}

record PublicInviteCreatedResponse(
        UUID inviteId, String invitePath, Instant expiresAt, int maxRedemptions) {}
