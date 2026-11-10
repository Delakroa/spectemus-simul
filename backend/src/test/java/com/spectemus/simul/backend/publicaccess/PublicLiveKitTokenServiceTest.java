package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

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
import com.spectemus.simul.backend.room.LiveKitTokenSigner;
import com.spectemus.simul.backend.room.ParticipantRole;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class PublicLiveKitTokenServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-06T12:00:00Z");
    private static final UUID CORRELATION_ID = UUID.fromString("a5ef626d-97cb-4e9a-8238-63fc4b0ecf9b");
    private static final String PUBLIC_API_KEY = "public-test-key";
    private static final String PUBLIC_API_SECRET = "public-test-secret-public-test-secret";
    private static final String PUBLIC_URL = "wss://rtc.example.test";
    private static final String PEPPER = "test-identity-pepper-at-least-32-characters";

    @Test
    void ownerReceivesHostGrantsWithoutSourceRestriction() throws Exception {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);

        PublicLiveKitTokenResponse response =
                fixture.tokenService.mint(room.room().publicRoomId(), owner.sessionCredential());
        String payload = payload(response.token());

        assertThat(response.role()).isEqualTo(ParticipantRole.HOST);
        assertThat(response.canPublish()).isTrue();
        assertThat(response.canPublishData()).isTrue();
        assertThat(response.liveKitUrl()).isEqualTo(PUBLIC_URL);
        assertThat(response.roomName()).matches("^[A-Za-z0-9_-]{43}$");
        assertThat(response.roomName()).isNotEqualTo(room.room().publicRoomId().toString());
        assertThat(response.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(5)));
        assertThat(payload)
                .contains("\"iss\":\"" + PUBLIC_API_KEY + "\"")
                .contains("\"iat\":" + NOW.getEpochSecond())
                .contains("\"nbf\":" + NOW.getEpochSecond())
                .contains("\"exp\":" + NOW.plus(Duration.ofMinutes(5)).getEpochSecond())
                .contains("\"roomJoin\":true")
                .contains("\"canSubscribe\":true")
                .contains("\"canPublish\":true")
                .contains("\"canPublishData\":true")
                .doesNotContain("canPublishSources")
                .doesNotContain("owner@example.test")
                .doesNotContain(owner.sessionCredential());
        assertValidSignature(response.token());
    }

    @Test
    void guestReceivesOnlyMicrophonePublicationGrant() throws Exception {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        PublicLiveKitTokenResponse response =
                fixture.tokenService.mint(room.room().publicRoomId(), guest.sessionCredential());
        String payload = payload(response.token());

        assertThat(response.role()).isEqualTo(ParticipantRole.GUEST);
        assertThat(payload)
                .contains("\"canPublishSources\":[\"microphone\"]")
                .doesNotContain("guest@example.test")
                .doesNotContain(guest.sessionCredential());
        assertValidSignature(response.token());
    }

    @Test
    void identityIsStableInOneRoomAndDifferentAcrossRooms() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse first = fixture.createRoom(owner);
        PublicRoomAccessResponse second = fixture.service.createRoom(
                owner.sessionCredential(),
                "owner-create-key-0002",
                new CreatePublicRoomRequest(60),
                CORRELATION_ID);

        PublicLiveKitTokenResponse firstToken =
                fixture.tokenService.mint(first.room().publicRoomId(), owner.sessionCredential());
        PublicLiveKitTokenResponse firstAgain =
                fixture.tokenService.mint(first.room().publicRoomId(), owner.sessionCredential());
        PublicLiveKitTokenResponse secondToken =
                fixture.tokenService.mint(second.room().publicRoomId(), owner.sessionCredential());

        assertThat(firstToken.participantIdentity()).isEqualTo(firstAgain.participantIdentity());
        assertThat(firstToken.participantId()).isEqualTo(firstAgain.participantId());
        assertThat(firstToken.roomName()).isEqualTo(firstAgain.roomName());
        assertThat(firstToken.participantIdentity()).isNotEqualTo(secondToken.participantIdentity());
        assertThat(firstToken.participantId()).isNotEqualTo(secondToken.participantId());
        assertThat(firstToken.roomName()).isNotEqualTo(secondToken.roomName());
        assertThat(firstToken.participantIdentity())
                .isNotEqualTo(owner.profile().accountId().toString());
    }

    @Test
    void capsTokenExpiryToRemainingRoomLifetime() throws Exception {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        Instant roomExpiresAt = NOW.plusSeconds(30);
        fixture.store.rooms.get(room.room().publicRoomId()).room = new PublicRoom(
                room.room().publicRoomId(),
                PublicRoomStatus.OPEN,
                room.room().memberLimit(),
                room.room().createdAt(),
                roomExpiresAt);

        PublicLiveKitTokenResponse response =
                fixture.tokenService.mint(room.room().publicRoomId(), owner.sessionCredential());
        String payload = payload(response.token());

        assertThat(response.expiresAt()).isEqualTo(roomExpiresAt);
        assertThat(payload).contains("\"exp\":" + roomExpiresAt.getEpochSecond());
        assertValidSignature(response.token());
    }

    @Test
    void rejectsMissingInvalidExpiredSessionAsAccountRequired() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);

        assertAccountRequired(() -> fixture.tokenService.mint(room.room().publicRoomId(), null));
        assertAccountRequired(() -> fixture.tokenService.mint(room.room().publicRoomId(), "short"));
        assertAccountRequired(
                () -> fixture.tokenService.mint(room.room().publicRoomId(), "B".repeat(43)));
    }

    @Test
    void collapsesMembershipFailuresToSameNotFound() {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult stranger = fixture.login("stranger@example.test", "Other");
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);
        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertMembershipRequired(
                () -> fixture.tokenService.mint(room.room().publicRoomId(), stranger.sessionCredential()));
        assertMembershipRequired(
                () -> fixture.tokenService.mint(room.room().publicRoomId(), guest.sessionCredential()));
        assertMembershipRequired(
                () -> fixture.tokenService.mint(UUID.randomUUID(), owner.sessionCredential()));

        fixture.store.rooms.get(room.room().publicRoomId()).room = new PublicRoom(
                room.room().publicRoomId(),
                PublicRoomStatus.CLOSED,
                room.room().memberLimit(),
                room.room().createdAt(),
                room.room().expiresAt());
        assertMembershipRequired(
                () -> fixture.tokenService.mint(room.room().publicRoomId(), owner.sessionCredential()));

        PublicRoomAccessResponse expiring = fixture.service.createRoom(
                owner.sessionCredential(),
                "owner-create-key-0003",
                new CreatePublicRoomRequest(60),
                CORRELATION_ID);
        fixture.store.rooms.get(expiring.room().publicRoomId()).room = new PublicRoom(
                expiring.room().publicRoomId(),
                PublicRoomStatus.OPEN,
                expiring.room().memberLimit(),
                expiring.room().createdAt(),
                NOW.minusSeconds(1));
        assertMembershipRequired(
                () -> fixture.tokenService.mint(expiring.room().publicRoomId(), owner.sessionCredential()));
    }

    @Test
    void doesNotEmbedInviteTokenInJwt() throws Exception {
        Fixture fixture = new Fixture();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicInviteCreatedResponse invite = fixture.service.createInvite(
                room.room().publicRoomId(),
                owner.sessionCredential(),
                "owner-invite-key-0001",
                new CreatePublicInviteRequest(60, 1),
                CORRELATION_ID);
        String rawInvite = invite.invitePath().substring("/join#invite=".length());

        PublicLiveKitTokenResponse response =
                fixture.tokenService.mint(room.room().publicRoomId(), owner.sessionCredential());

        assertThat(payload(response.token())).doesNotContain(rawInvite);
        assertThat(response.token()).doesNotContain(rawInvite);
    }

    private static void assertAccountRequired(Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
                    assertThat(apiException.code()).isEqualTo("ACCOUNT_REQUIRED");
                });
    }

    private static void assertMembershipRequired(Runnable action) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(apiException.code()).isEqualTo("MEMBERSHIP_REQUIRED");
                });
    }

    private static String payload(String token) {
        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        return new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
    }

    private static void assertValidSignature(String token) throws Exception {
        String[] parts = token.split("\\.");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(PUBLIC_API_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expected = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal((parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8)));
        assertThat(parts[2]).isEqualTo(expected);
    }

    private static final class Fixture {

        private final InMemoryPublicAccessStore store = new InMemoryPublicAccessStore();
        private final CapturingDelivery delivery = new CapturingDelivery();
        private final PublicAccessSecrets secrets = new PublicAccessSecrets(PEPPER);
        private final PublicAccessService service = new PublicAccessService(
                store,
                delivery,
                secrets,
                publicAccessProperties(),
                Clock.fixed(NOW, ZoneOffset.UTC));
        private final PublicLiveKitTokenService tokenService = new PublicLiveKitTokenService(
                service,
                secrets,
                new PublicLiveKitProperties(
                        true,
                        PUBLIC_URL,
                        "https://rtc-api.example.test",
                        PUBLIC_API_KEY,
                        PUBLIC_API_SECRET,
                        Duration.ofMinutes(5),
                        Duration.ofMinutes(1),
                        Duration.ofSeconds(3)),
                new LiveKitTokenSigner(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        private PublicAccessService.AccountSessionResult login(String email, String displayName) {
            EmailChallengeAcceptedResponse challenge = service.requestEmailChallenge(email);
            return service.verifyEmailChallenge(challenge.challengeId(), delivery.code, displayName);
        }

        private PublicRoomAccessResponse createRoom(PublicAccessService.AccountSessionResult owner) {
            return service.createRoom(
                    owner.sessionCredential(),
                    "owner-create-key-0001",
                    new CreatePublicRoomRequest(60),
                    CORRELATION_ID);
        }

        private void admitGuest(
                UUID publicRoomId,
                PublicAccessService.AccountSessionResult owner,
                PublicAccessService.AccountSessionResult guest) {
            PublicInviteCreatedResponse invite = service.createInvite(
                    publicRoomId,
                    owner.sessionCredential(),
                    "owner-invite-key-guest",
                    new CreatePublicInviteRequest(60, 1),
                    CORRELATION_ID);
            service.redeemInvite(
                    guest.sessionCredential(),
                    "guest-redeem-key-0001",
                    new RedeemPublicInviteRequest(invite.invitePath().substring("/join#invite=".length())),
                    CORRELATION_ID);
        }

        private static PublicAccessProperties publicAccessProperties() {
            return new PublicAccessProperties(
                    true,
                    "jdbc:postgresql://db.example.test:5432/spectemus",
                    "spectemus",
                    "not-a-real-password",
                    PEPPER,
                    null,
                    true,
                    new PublicAccessProperties.EmailProperties(
                            "smtp.example.test", 587, "user", "password", "login@example.test", true), null, null, null, null, null);
        }
    }

    private static final class CapturingDelivery implements EmailChallengeDelivery {

        private String code;

        @Override
        public void deliver(String email, String code, Instant expiresAt) {
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
            IdempotencyRecord replay = idempotency.get(idempotencyKey(accountId, command));
            if (replay != null) {
                if (!replay.requestFingerprint.equals(command.requestFingerprint())) {
                    return new RoomCommandResult(IdempotencyOutcome.CONFLICT, null);
                }
                RoomRecord existing = rooms.get(replay.resultId);
                return new RoomCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        new PublicRoomAccess(existing.room, existing.members.get(accountId)));
            }
            UUID roomId = UUID.randomUUID();
            RoomRecord record = new RoomRecord(
                    new PublicRoom(roomId, PublicRoomStatus.OPEN, 4, now, now.plusSeconds(expiresInMinutes * 60L)));
            record.members.put(accountId, new PublicRoomMembership(PublicMembershipRole.OWNER, now));
            rooms.put(roomId, record);
            idempotency.put(
                    idempotencyKey(accountId, command),
                    new IdempotencyRecord(command.requestFingerprint(), roomId));
            return new RoomCommandResult(
                    IdempotencyOutcome.CREATED,
                    new PublicRoomAccess(record.room, record.members.get(accountId)));
        }

        @Override
        public Optional<PublicRoomAccess> findRoomAccess(UUID publicRoomId, UUID accountId, Instant now) {
            RoomRecord record = rooms.get(publicRoomId);
            if (record == null
                    || record.room.status() != PublicRoomStatus.OPEN
                    || !record.room.expiresAt().isAfter(now)
                    || record.revokedMembers.contains(accountId)) {
                return Optional.empty();
            }
            PublicRoomMembership membership = record.members.get(accountId);
            return membership == null
                    ? Optional.empty()
                    : Optional.of(new PublicRoomAccess(record.room, membership));
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
            PublicRoomMembership membership = room.members.get(accountId);
            StoredPublicInvite invite = new StoredPublicInvite(
                    UUID.randomUUID(), now.plusSeconds(expiresInMinutes * 60L), maxRedemptions, 0);
            invites.put(invite.inviteId(), new InviteRecord(publicRoomId, tokenFingerprint, invite));
            return new InviteCommandResult(IdempotencyOutcome.CREATED, invite);
        }

        @Override
        public RedemptionCommandResult redeemInvite(
                String tokenFingerprint, UUID accountId, IdempotencyCommand command, Instant now) {
            InviteRecord invite = invites.values().stream()
                    .filter(value -> value.tokenFingerprint.equals(tokenFingerprint))
                    .findFirst()
                    .orElseThrow();
            RoomRecord room = rooms.get(invite.roomId);
            room.members.put(accountId, new PublicRoomMembership(PublicMembershipRole.GUEST, now));
            return new RedemptionCommandResult(
                    IdempotencyOutcome.CREATED,
                    InviteRedemption.redeemed(
                            new PublicRoomAccess(room.room, room.members.get(accountId))));
        }

        @Override
        public boolean revokeInvite(UUID publicRoomId, UUID inviteId, UUID accountId, Instant now) {
            return true;
        }

        @Override
        public boolean revokeMember(UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now) {
            rooms.get(publicRoomId).revokedMembers.add(memberAccountId);
            return true;
        }

        @Override
        public void recordAudit(
                UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt) {}

        private String idempotencyKey(UUID accountId, IdempotencyCommand command) {
            return accountId + "\u0000" + command.operation() + "\u0000" + command.keyFingerprint();
        }

        private static final class RoomRecord {
            private PublicRoom room;
            private final Map<UUID, PublicRoomMembership> members = new HashMap<>();
            private final java.util.Set<UUID> revokedMembers = new java.util.HashSet<>();

            private RoomRecord(PublicRoom room) {
                this.room = room;
            }
        }

        private static final class InviteRecord {
            private final UUID roomId;
            private final String tokenFingerprint;
            private final StoredPublicInvite invite;

            private InviteRecord(UUID roomId, String tokenFingerprint, StoredPublicInvite invite) {
                this.roomId = roomId;
                this.tokenFingerprint = tokenFingerprint;
                this.invite = invite;
            }
        }

        private record IdempotencyRecord(String requestFingerprint, UUID resultId) {}
    }
}
