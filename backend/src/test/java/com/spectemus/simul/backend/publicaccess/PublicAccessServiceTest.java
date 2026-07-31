package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.spectemus.simul.backend.api.ApiException;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.ChallengeAttempt;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.InviteRedemption;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.PublicRoom;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.PublicRoomAccess;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.PublicRoomMembership;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.StoredAccount;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.StoredAccountSession;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.StoredChallenge;
import com.spectemus.simul.backend.publicaccess.PublicAccessStore.StoredPublicInvite;

import org.junit.jupiter.api.Test;

class PublicAccessServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-01T12:00:00Z");
    private static final UUID CORRELATION_ID = UUID.fromString("a5ef626d-97cb-4e9a-8238-63fc4b0ecf9b");

    @Test
    void verifiesOneTimeCodeWithoutPersistingRawEmailOrCode() {
        Fixture fixture = new Fixture();

        EmailChallengeAcceptedResponse challenge =
                fixture.service.requestEmailChallenge("  Person@example.test ");
        StoredChallenge storedChallenge = fixture.store.challenges.get(challenge.challengeId());
        PublicAccessService.AccountSessionResult verified = fixture.service.verifyEmailChallenge(
                challenge.challengeId(), fixture.delivery.code, " Мария ");

        assertThat(verified.profile().displayName()).isEqualTo("Мария");
        assertThat(verified.sessionCredential()).matches("[A-Za-z0-9_-]{43}");
        assertThat(storedChallenge.emailFingerprint()).doesNotContain("person@example.test");
        assertThat(storedChallenge.codeFingerprint()).doesNotContain(fixture.delivery.code);
        assertThat(fixture.service.currentAccount(verified.sessionCredential()))
                .isEqualTo(verified.profile());

        assertThatThrownBy(() -> fixture.service.verifyEmailChallenge(
                        challenge.challengeId(), fixture.delivery.code, "Мария"))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("CHALLENGE_REJECTED");
    }

    @Test
    void acceptsRequestWithoutAccountEnumerationWhenMailDeliveryFails() {
        Fixture fixture = new Fixture();
        fixture.delivery.fail = true;

        EmailChallengeAcceptedResponse accepted = fixture.service.requestEmailChallenge("person@example.test");

        assertThat(accepted.challengeId()).isNotNull();
        assertThat(fixture.store.challenges).doesNotContainKey(accepted.challengeId());
        assertThatThrownBy(() -> fixture.service.verifyEmailChallenge(
                        accepted.challengeId(), "ABCDEFGHJK", "Мария"))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("CHALLENGE_REJECTED");
    }

    @Test
    void admitsInviteMemberThenBlocksAccessAfterOwnerRevokesMember() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.service.createRoom(
                owner.sessionCredential(), "owner-create-key-0001", new CreatePublicRoomRequest(60), CORRELATION_ID);
        PublicInviteCreatedResponse invite = fixture.service.createInvite(
                room.room().publicRoomId(),
                owner.sessionCredential(),
                "owner-invite-key-0001",
                new CreatePublicInviteRequest(60, 1),
                CORRELATION_ID);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");

        PublicRoomAccessResponse redeemed = fixture.service.redeemInvite(
                guest.sessionCredential(),
                "guest-redeem-key-0001",
                new RedeemPublicInviteRequest(invite.invitePath().substring("/join#invite=".length())),
                CORRELATION_ID);

        assertThat(redeemed.membership().role()).isEqualTo(PublicMembershipRole.GUEST);
        assertThat(invite.invitePath()).startsWith("/join#invite=").doesNotContain("?");
        assertThat(fixture.store.invites.values())
                .extracting(record -> record.tokenFingerprint)
                .noneMatch(value -> invite.invitePath().contains(value));

        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThatThrownBy(() -> fixture.service.roomAccess(
                        room.room().publicRoomId(), guest.sessionCredential()))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("MEMBERSHIP_REQUIRED");
    }

    @Test
    void rejectsInvalidIdempotencyKeyBeforeCreatingPublicState() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");

        assertThatThrownBy(() -> fixture.service.createRoom(
                        owner.sessionCredential(), "short", new CreatePublicRoomRequest(60), CORRELATION_ID))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("VALIDATION_FAILED");
        assertThat(fixture.store.rooms).isEmpty();
    }

    @Test
    void replaysPublicRoomForTheSameIdempotencyKeyWithoutCreatingAnotherRoom() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");

        PublicRoomAccessResponse initial = fixture.service.createRoom(
                owner.sessionCredential(), "owner-create-key-0002", new CreatePublicRoomRequest(60), CORRELATION_ID);
        PublicRoomAccessResponse replay = fixture.service.createRoom(
                owner.sessionCredential(), "owner-create-key-0002", new CreatePublicRoomRequest(60), CORRELATION_ID);

        assertThat(replay.room().publicRoomId()).isEqualTo(initial.room().publicRoomId());
        assertThat(fixture.store.rooms).hasSize(1);
    }

    private static final class Fixture {

        private final InMemoryPublicAccessStore store = new InMemoryPublicAccessStore();
        private final CapturingDelivery delivery = new CapturingDelivery();
        private final PublicAccessService service = new PublicAccessService(
                store,
                delivery,
                new PublicAccessSecrets("test-identity-pepper-at-least-32-characters"),
                properties(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        private PublicAccessService.AccountSessionResult login(String email, String displayName) {
            EmailChallengeAcceptedResponse challenge = service.requestEmailChallenge(email);
            return service.verifyEmailChallenge(challenge.challengeId(), delivery.code, displayName);
        }

        private static PublicAccessProperties properties() {
            return new PublicAccessProperties(
                    true,
                    "jdbc:postgresql://db.example.test:5432/spectemus",
                    "spectemus",
                    "not-a-real-password",
                    "test-identity-pepper-at-least-32-characters",
                    null,
                    true,
                    new PublicAccessProperties.EmailProperties(
                            "smtp.example.test", 587, "user", "password", "login@example.test", true));
        }
    }

    private static final class CapturingDelivery implements EmailChallengeDelivery {

        private String code;
        private boolean fail;

        @Override
        public void deliver(String email, String code, Instant expiresAt) {
            if (fail) {
                throw new IllegalStateException("SMTP unavailable");
            }
            this.code = code;
        }
    }

    private static final class InMemoryPublicAccessStore implements PublicAccessStore {

        private final Map<UUID, StoredChallenge> challenges = new HashMap<>();
        private final Map<String, StoredAccount> accountsByEmail = new HashMap<>();
        private final Map<UUID, StoredAccount> accountsById = new HashMap<>();
        private final Map<String, StoredAccountSession> sessions = new HashMap<>();
        private final Map<UUID, RoomRecord> rooms = new HashMap<>();
        private final Map<UUID, InviteRecord> invites = new HashMap<>();
        private final Map<String, IdempotencyRecord> idempotency = new HashMap<>();

        @Override
        public void saveChallenge(StoredChallenge challenge) {
            challenges.put(challenge.challengeId(), challenge);
        }

        @Override
        public ChallengeAttempt consumeChallenge(
                UUID challengeId, String codeFingerprint, Instant now, int maxAttempts) {
            StoredChallenge challenge = challenges.get(challengeId);
            if (challenge == null || !challenge.expiresAt().isAfter(now)) {
                return ChallengeAttempt.rejected();
            }
            if (!challenge.codeFingerprint().equals(codeFingerprint)) {
                return ChallengeAttempt.rejected();
            }
            challenges.remove(challengeId);
            return ChallengeAttempt.verified(challenge.emailFingerprint());
        }

        @Override
        public void discardChallenge(UUID challengeId) {
            challenges.remove(challengeId);
        }

        @Override
        public StoredAccount findOrCreateAccount(
                String emailFingerprint, String displayName, Instant createdAt) {
            return accountsByEmail.computeIfAbsent(emailFingerprint, ignored -> {
                StoredAccount account = new StoredAccount(UUID.randomUUID(), displayName, createdAt);
                accountsById.put(account.accountId(), account);
                return account;
            });
        }

        @Override
        public void saveSession(StoredAccountSession session) {
            sessions.put(session.sessionFingerprint(), session);
        }

        @Override
        public Optional<StoredAccount> findAccountBySession(String sessionFingerprint, Instant now) {
            StoredAccountSession session = sessions.get(sessionFingerprint);
            if (session == null || !session.expiresAt().isAfter(now)) {
                return Optional.empty();
            }
            return Optional.ofNullable(accountsById.get(session.accountId()));
        }

        @Override
        public RoomCommandResult createRoom(
                UUID accountId, int expiresInMinutes, IdempotencyCommand command, Instant now) {
            IdempotencyRecord replay = replay(accountId, command);
            if (replay != null) {
                if (!replay.requestFingerprint.equals(command.requestFingerprint())) {
                    return new RoomCommandResult(IdempotencyOutcome.CONFLICT, null);
                }
                RoomRecord existing = rooms.get(replay.resultId);
                return new RoomCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        access(existing.room, existing.members.get(accountId)));
            }
            UUID roomId = UUID.randomUUID();
            RoomRecord record = new RoomRecord(
                    new PublicRoom(roomId, PublicRoomStatus.OPEN, 4, now, now.plusSeconds(expiresInMinutes * 60L)));
            record.members.put(accountId, new PublicRoomMembership(PublicMembershipRole.OWNER, now));
            rooms.put(roomId, record);
            remember(accountId, command, roomId);
            return new RoomCommandResult(
                    IdempotencyOutcome.CREATED, access(record.room, record.members.get(accountId)));
        }

        @Override
        public Optional<PublicRoomAccess> findRoomAccess(UUID publicRoomId, UUID accountId, Instant now) {
            RoomRecord record = rooms.get(publicRoomId);
            if (record == null || !record.room.expiresAt().isAfter(now) || record.revokedMembers.contains(accountId)) {
                return Optional.empty();
            }
            PublicRoomMembership membership = record.members.get(accountId);
            return membership == null ? Optional.empty() : Optional.of(access(record.room, membership));
        }

        @Override
        public InviteCommandResult createInvite(
                UUID publicRoomId,
                UUID accountId,
                String tokenFingerprint,
                int expiresInMinutes,
                int maxRedemptions,
                IdempotencyCommand command,
                Instant now) {
            RoomRecord room = rooms.get(publicRoomId);
            if (room == null || room.revokedMembers.contains(accountId)) {
                return new InviteCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            PublicRoomMembership membership = room.members.get(accountId);
            if (membership == null || membership.role() != PublicMembershipRole.OWNER) {
                return new InviteCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            IdempotencyRecord replay = replay(accountId, command);
            if (replay != null) {
                if (!replay.requestFingerprint.equals(command.requestFingerprint())) {
                    return new InviteCommandResult(IdempotencyOutcome.CONFLICT, null);
                }
                return new InviteCommandResult(IdempotencyOutcome.REPLAYED, invites.get(replay.resultId).invite);
            }
            StoredPublicInvite invite = new StoredPublicInvite(
                    UUID.randomUUID(), now.plusSeconds(expiresInMinutes * 60L), maxRedemptions, 0);
            invites.put(invite.inviteId(), new InviteRecord(publicRoomId, tokenFingerprint, invite));
            remember(accountId, command, invite.inviteId());
            return new InviteCommandResult(IdempotencyOutcome.CREATED, invite);
        }

        @Override
        public RedemptionCommandResult redeemInvite(
                String tokenFingerprint, UUID accountId, IdempotencyCommand command, Instant now) {
            InviteRecord invite = invites.values().stream()
                    .filter(value -> value.tokenFingerprint.equals(tokenFingerprint))
                    .findFirst()
                    .orElse(null);
            if (invite == null || invite.revoked || !invite.invite.expiresAt().isAfter(now)) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.unavailable());
            }
            RoomRecord room = rooms.get(invite.roomId);
            if (room == null || !room.room.expiresAt().isAfter(now)) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.unavailable());
            }
            IdempotencyRecord replay = replay(accountId, command);
            if (replay != null) {
                if (!replay.requestFingerprint.equals(command.requestFingerprint())) {
                    return new RedemptionCommandResult(IdempotencyOutcome.CONFLICT, null);
                }
                PublicRoomMembership replayMembership = room.members.get(accountId);
                return new RedemptionCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        replayMembership == null
                                ? InviteRedemption.unavailable()
                                : InviteRedemption.redeemed(access(room.room, replayMembership)));
            }
            PublicRoomMembership existing = room.members.get(accountId);
            if (existing != null && !room.revokedMembers.contains(accountId)) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.redeemed(access(room.room, existing)));
            }
            if (invite.invite.redemptionCount() >= invite.invite.maxRedemptions()) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.unavailable());
            }
            if (room.members.size() - room.revokedMembers.size() >= room.room.memberLimit()) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.roomFull());
            }
            invite.invite = new StoredPublicInvite(
                    invite.invite.inviteId(),
                    invite.invite.expiresAt(),
                    invite.invite.maxRedemptions(),
                    invite.invite.redemptionCount() + 1);
            room.members.put(accountId, new PublicRoomMembership(PublicMembershipRole.GUEST, now));
            room.revokedMembers.remove(accountId);
            remember(accountId, command, room.room.publicRoomId());
            return new RedemptionCommandResult(
                    IdempotencyOutcome.CREATED,
                    InviteRedemption.redeemed(access(room.room, room.members.get(accountId))));
        }

        @Override
        public boolean revokeInvite(UUID publicRoomId, UUID inviteId, UUID accountId, Instant now) {
            if (!isOwner(publicRoomId, accountId)) {
                return false;
            }
            InviteRecord invite = invites.get(inviteId);
            if (invite != null && invite.roomId.equals(publicRoomId)) {
                invite.revoked = true;
            }
            return true;
        }

        @Override
        public boolean revokeMember(UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now) {
            if (!isOwner(publicRoomId, actorAccountId) || memberAccountId.equals(actorAccountId)) {
                return false;
            }
            RoomRecord room = rooms.get(publicRoomId);
            if (room.members.containsKey(memberAccountId)) {
                room.revokedMembers.add(memberAccountId);
            }
            return true;
        }

        @Override
        public void recordAudit(
                UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt) {
            // Behaviour tests only need to prove that access decisions happen before audit writes.
        }

        private boolean isOwner(UUID publicRoomId, UUID accountId) {
            RoomRecord room = rooms.get(publicRoomId);
            return room != null
                    && !room.revokedMembers.contains(accountId)
                    && room.members.containsKey(accountId)
                    && room.members.get(accountId).role() == PublicMembershipRole.OWNER;
        }

        private PublicRoomAccess access(PublicRoom room, PublicRoomMembership membership) {
            return new PublicRoomAccess(room, membership);
        }

        private IdempotencyRecord replay(UUID accountId, IdempotencyCommand command) {
            return idempotency.get(idempotencyKey(accountId, command));
        }

        private void remember(UUID accountId, IdempotencyCommand command, UUID resultId) {
            idempotency.put(
                    idempotencyKey(accountId, command),
                    new IdempotencyRecord(command.requestFingerprint(), resultId));
        }

        private String idempotencyKey(UUID accountId, IdempotencyCommand command) {
            return accountId + "\u0000" + command.operation() + "\u0000" + command.keyFingerprint();
        }

        private static final class RoomRecord {

            private final PublicRoom room;
            private final Map<UUID, PublicRoomMembership> members = new HashMap<>();
            private final java.util.Set<UUID> revokedMembers = new java.util.HashSet<>();

            private RoomRecord(PublicRoom room) {
                this.room = room;
            }
        }

        private static final class InviteRecord {

            private final UUID roomId;
            private final String tokenFingerprint;
            private StoredPublicInvite invite;
            private boolean revoked;

            private InviteRecord(UUID roomId, String tokenFingerprint, StoredPublicInvite invite) {
                this.roomId = roomId;
                this.tokenFingerprint = tokenFingerprint;
                this.invite = invite;
            }
        }

        private record IdempotencyRecord(String requestFingerprint, UUID resultId) {}
    }
}
