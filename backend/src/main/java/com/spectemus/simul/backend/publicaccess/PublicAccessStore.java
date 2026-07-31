package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Persistent product state for the disabled-by-default Internet access surface. */
interface PublicAccessStore {

    void saveChallenge(StoredChallenge challenge);

    ChallengeAttempt consumeChallenge(UUID challengeId, String codeFingerprint, Instant now, int maxAttempts);

    void discardChallenge(UUID challengeId);

    StoredAccount findOrCreateAccount(String emailFingerprint, String displayName, Instant createdAt);

    void saveSession(StoredAccountSession session);

    Optional<StoredAccount> findAccountBySession(String sessionFingerprint, Instant now);

    RoomCommandResult createRoom(
            UUID accountId, int expiresInMinutes, IdempotencyCommand command, Instant now);

    Optional<PublicRoomAccess> findRoomAccess(UUID publicRoomId, UUID accountId, Instant now);

    InviteCommandResult createInvite(
            UUID publicRoomId,
            UUID accountId,
            String tokenFingerprint,
            int expiresInMinutes,
            int maxRedemptions,
            IdempotencyCommand command,
            Instant now);

    RedemptionCommandResult redeemInvite(
            String tokenFingerprint, UUID accountId, IdempotencyCommand command, Instant now);

    boolean revokeInvite(UUID publicRoomId, UUID inviteId, UUID accountId, Instant now);

    boolean revokeMember(UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now);

    void recordAudit(UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt);

    record StoredChallenge(
            UUID challengeId,
            String emailFingerprint,
            String codeFingerprint,
            Instant expiresAt,
            Instant createdAt) {}

    record ChallengeAttempt(Outcome outcome, String emailFingerprint) {

        enum Outcome {
            VERIFIED,
            REJECTED
        }

        static ChallengeAttempt verified(String emailFingerprint) {
            return new ChallengeAttempt(Outcome.VERIFIED, emailFingerprint);
        }

        static ChallengeAttempt rejected() {
            return new ChallengeAttempt(Outcome.REJECTED, null);
        }
    }

    record StoredAccount(UUID accountId, String displayName, Instant createdAt) {}

    record StoredAccountSession(
            String sessionFingerprint, UUID accountId, Instant expiresAt, Instant createdAt) {}

    record IdempotencyCommand(String operation, String keyFingerprint, String requestFingerprint) {}

    enum IdempotencyOutcome {
        CREATED,
        REPLAYED,
        CONFLICT
    }

    record PublicRoom(
            UUID publicRoomId,
            PublicRoomStatus status,
            int memberLimit,
            Instant createdAt,
            Instant expiresAt) {}

    record PublicRoomMembership(PublicMembershipRole role, Instant joinedAt) {}

    record PublicRoomAccess(PublicRoom room, PublicRoomMembership membership) {}

    record RoomCommandResult(IdempotencyOutcome outcome, PublicRoomAccess access) {}

    record StoredPublicInvite(
            UUID inviteId, Instant expiresAt, int maxRedemptions, int redemptionCount) {}

    record InviteCommandResult(IdempotencyOutcome outcome, StoredPublicInvite invite) {}

    record InviteRedemption(Outcome outcome, PublicRoomAccess access) {

        enum Outcome {
            REDEEMED,
            UNAVAILABLE,
            ROOM_FULL
        }

        static InviteRedemption redeemed(PublicRoomAccess access) {
            return new InviteRedemption(Outcome.REDEEMED, access);
        }

        static InviteRedemption unavailable() {
            return new InviteRedemption(Outcome.UNAVAILABLE, null);
        }

        static InviteRedemption roomFull() {
            return new InviteRedemption(Outcome.ROOM_FULL, null);
        }
    }

    record RedemptionCommandResult(IdempotencyOutcome outcome, InviteRedemption redemption) {}
}
