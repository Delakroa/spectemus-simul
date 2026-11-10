package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

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
import com.spectemus.simul.backend.publicaccess.PublicLiveKitRoomAdminClient.JsonPoster;
import com.spectemus.simul.backend.room.LiveKitTokenSigner;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class PublicLiveKitRevokeDisconnectTest {

    private static final Instant NOW = Instant.parse("2026-11-06T18:00:00Z");
    private static final UUID CORRELATION_ID = UUID.fromString("a5ef626d-97cb-4e9a-8238-63fc4b0ecf9b");
    private static final String PEPPER = "test-identity-pepper-at-least-32-characters";
    private static final String PUBLIC_API_KEY = "public-test-key";
    private static final String PUBLIC_API_SECRET = "public-test-secret-public-test-secret";
    private static final ObjectMapper OBJECT_MAPPER =
            JsonMapper.builder().findAndAddModules().build();

    @Test
    void successfulRevokeCallsRemoveParticipantWithOpaqueRoomAndIdentity() {
        RecordingPoster poster = new RecordingPoster(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThat(poster.calls).hasSize(1);
        RecordingPoster.Call call = poster.calls.getFirst();
        String expectedRoom = fixture.secrets.livekitRoomName(room.room().publicRoomId());
        String expectedIdentity = fixture.secrets.livekitParticipantIdentity(
                room.room().publicRoomId(), guest.profile().accountId());

        assertThat(call.uri().toString())
                .isEqualTo("https://rtc-api.example.test/twirp/livekit.RoomService/RemoveParticipant");
        assertThat(call.jsonBody())
                .isEqualTo("{\"room\":\"" + expectedRoom + "\",\"identity\":\"" + expectedIdentity + "\"}")
                .doesNotContain(room.room().publicRoomId().toString())
                .doesNotContain(guest.profile().accountId().toString())
                .doesNotContain("guest@example.test")
                .doesNotContain(PUBLIC_API_SECRET)
                .doesNotContain(owner.sessionCredential());
        String payload = jwtPayload(call.bearerToken());
        assertThat(payload)
                .contains("\"roomAdmin\":true")
                .contains("\"room\":\"" + expectedRoom + "\"")
                .contains("\"sub\":\"public-room-admin\"")
                .doesNotContain("roomJoin")
                .doesNotContain(guest.profile().accountId().toString())
                .doesNotContain("guest@example.test");
        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    @Test
    void missingParticipantIsTreatedAsSuccess() {
        RecordingPoster poster =
                new RecordingPoster(404, "{\"code\":\"not_found\",\"msg\":\"participant not found\"}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThat(poster.calls).hasSize(1);
        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    @Test
    void htmlOrEmpty404IsFailClosed() {
        assertDisconnectFailed(
                new RecordingPoster(404, "<html>not found</html>"),
                "proxy HTML 404 must not look like Twirp not_found");
        assertDisconnectFailed(new RecordingPoster(404, ""), "empty 404 body must not succeed");
        assertDisconnectFailed(new RecordingPoster(404, "   "), "blank 404 body must not succeed");
    }

    @Test
    void notFoundUnderNon404StatusIsFailClosed() {
        assertDisconnectFailed(
                new RecordingPoster(500, "{\"code\":\"not_found\",\"msg\":\"participant not found\"}"),
                "not_found under HTTP 500 must not succeed");
    }

    @Test
    void malformedJson404IsFailClosed() {
        assertDisconnectFailed(
                new RecordingPoster(404, "{code:not_found}"),
                "malformed JSON 404 must not succeed");
        assertDisconnectFailed(
                new RecordingPoster(404, "{\"code\":[\"not_found\"]}"),
                "non-textual Twirp code must not succeed");
        assertDisconnectFailed(
                new RecordingPoster(404, "{\"code\":\"not_found\""),
                "truncated Twirp JSON object must not succeed");
        assertDisconnectFailed(
                new RecordingPoster(404, "{\"code\":\"not_found\"}garbage"),
                "trailing tokens after Twirp JSON must not succeed");
        assertDisconnectFailed(
                new RecordingPoster(404, "{\"x\":1 \"code\":\"not_found\"}"),
                "JSON object missing commas must not succeed");
    }

    @Test
    void auditFailureStillDisconnectsParticipant() {
        RecordingPoster poster = new RecordingPoster(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);
        fixture.store.failNextAudit = true;

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        guest.profile().accountId(),
                        owner.sessionCredential(),
                        CORRELATION_ID))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("audit unavailable");

        assertThat(poster.calls).hasSize(1);
        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    @Test
    void liveKitFailureKeepsMembershipRevokedAndReturnsStableProblem() {
        RecordingPoster poster = new RecordingPoster(503, "upstream unavailable");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        guest.profile().accountId(),
                        owner.sessionCredential(),
                        CORRELATION_ID))
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                    assertThat(apiException.code()).isEqualTo("PUBLIC_LIVEKIT_DISCONNECT_FAILED");
                    assertThat(apiException.retryable()).isTrue();
                    assertThat(apiException.getMessage())
                            .doesNotContain("rtc-api.example.test")
                            .doesNotContain(PUBLIC_API_SECRET)
                            .doesNotContain("upstream unavailable");
                });
        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    @Test
    void retryAfterLiveKitFailureCallsAdminApiAgain() {
        RecordingPoster poster = new RecordingPoster();
        poster.enqueue(503, "fail");
        poster.enqueue(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        guest.profile().accountId(),
                        owner.sessionCredential(),
                        CORRELATION_ID))
                .isInstanceOf(ApiException.class);

        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThat(poster.calls).hasSize(2);
    }

    @Test
    void unauthorizedCallerDoesNotInvokeAdminApi() {
        RecordingPoster poster = new RecordingPoster(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        guest.profile().accountId(),
                        null,
                        CORRELATION_ID))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("ACCOUNT_REQUIRED");
        assertThat(poster.calls).isEmpty();
    }

    @Test
    void ownerCannotBeRevokedThroughMemberEndpoint() {
        RecordingPoster poster = new RecordingPoster(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        owner.profile().accountId(),
                        owner.sessionCredential(),
                        CORRELATION_ID))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("MEMBERSHIP_REQUIRED");
        assertThat(poster.calls).isEmpty();
    }

    @Test
    void inviteRevokeDoesNotCallAdminApi() {
        RecordingPoster poster = new RecordingPoster(200, "{}");
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicInviteCreatedResponse invite = fixture.service.createInvite(
                room.room().publicRoomId(),
                owner.sessionCredential(),
                "owner-invite-key-0001",
                new CreatePublicInviteRequest(60, 1),
                CORRELATION_ID);

        fixture.service.revokeInvite(
                room.room().publicRoomId(),
                invite.inviteId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThat(poster.calls).isEmpty();
    }

    @Test
    void withoutPublicLiveKitClientRevokeStillWorksAndSkipsAdminApi() {
        Fixture fixture = Fixture.withoutAdminClient();
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        fixture.service.revokeMember(
                room.room().publicRoomId(),
                guest.profile().accountId(),
                owner.sessionCredential(),
                CORRELATION_ID);

        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    private static void assertDisconnectFailed(RecordingPoster poster, String reason) {
        Fixture fixture = Fixture.withPoster(poster);
        PublicAccessService.AccountSessionResult owner = fixture.login("owner@example.test", "Host");
        PublicRoomAccessResponse room = fixture.createRoom(owner);
        PublicAccessService.AccountSessionResult guest = fixture.login("guest@example.test", "Guest");
        fixture.admitGuest(room.room().publicRoomId(), owner, guest);

        assertThatThrownBy(() -> fixture.service.revokeMember(
                        room.room().publicRoomId(),
                        guest.profile().accountId(),
                        owner.sessionCredential(),
                        CORRELATION_ID))
                .as(reason)
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).code())
                .isEqualTo("PUBLIC_LIVEKIT_DISCONNECT_FAILED");
        assertThat(poster.calls).as(reason).hasSize(1);
        assertThat(fixture.store.rooms.get(room.room().publicRoomId()).revokedMembers)
                .contains(guest.profile().accountId());
    }

    private static String jwtPayload(String token) {
        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        return new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
    }

    private static final class RecordingPoster implements JsonPoster {

        private final List<Call> calls = new ArrayList<>();
        private final List<Integer> statuses = new ArrayList<>();
        private final List<String> bodies = new ArrayList<>();
        private final AtomicInteger index = new AtomicInteger();

        private RecordingPoster() {}

        private RecordingPoster(int status, String body) {
            enqueue(status, body);
        }

        private void enqueue(int status, String body) {
            statuses.add(status);
            bodies.add(body);
        }

        @Override
        public Response postJson(URI uri, String bearerToken, String jsonBody, Duration timeout) {
            calls.add(new Call(uri, bearerToken, jsonBody, timeout));
            int current = Math.min(index.getAndIncrement(), statuses.size() - 1);
            return new Response(statuses.get(current), bodies.get(current));
        }

        private record Call(URI uri, String bearerToken, String jsonBody, Duration timeout) {}
    }

    private static final class Fixture {

        private final InMemoryPublicAccessStore store = new InMemoryPublicAccessStore();
        private final CapturingDelivery delivery = new CapturingDelivery();
        private final PublicAccessSecrets secrets = new PublicAccessSecrets(PEPPER);
        private final PublicAccessService service;

        private Fixture(RecordingPoster poster) {
            if (poster == null) {
                this.service = new PublicAccessService(
                        store,
                        delivery,
                        secrets,
                        publicAccessProperties(),
                        Clock.fixed(NOW, ZoneOffset.UTC));
            } else {
                PublicLiveKitProperties properties = new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        PUBLIC_API_KEY,
                        PUBLIC_API_SECRET,
                        Duration.ofMinutes(5),
                        Duration.ofMinutes(1),
                        Duration.ofSeconds(3));
                PublicLiveKitRoomAdminClient client = new PublicLiveKitRoomAdminClient(
                        properties,
                        new LiveKitTokenSigner(),
                        Clock.fixed(NOW, ZoneOffset.UTC),
                        OBJECT_MAPPER,
                        poster);
                this.service = new PublicAccessService(
                        store,
                        delivery,
                        secrets,
                        publicAccessProperties(),
                        client,
                        Clock.fixed(NOW, ZoneOffset.UTC));
            }
        }

        static Fixture withPoster(RecordingPoster poster) {
            return new Fixture(poster);
        }

        static Fixture withoutAdminClient() {
            return new Fixture(null);
        }

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
        private boolean failNextAudit;

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
            UUID roomId = UUID.randomUUID();
            RoomRecord record = new RoomRecord(
                    new PublicRoom(roomId, PublicRoomStatus.OPEN, 4, now, now.plusSeconds(expiresInMinutes * 60L)));
            record.members.put(accountId, new PublicRoomMembership(PublicMembershipRole.OWNER, now));
            rooms.put(roomId, record);
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
            InviteRecord invite = invites.get(inviteId);
            if (invite != null && invite.roomId.equals(publicRoomId)) {
                invite.revoked = true;
            }
            return true;
        }

        @Override
        public boolean revokeMember(UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now) {
            RoomRecord room = rooms.get(publicRoomId);
            if (room == null || memberAccountId.equals(actorAccountId)) {
                return false;
            }
            PublicRoomMembership actor = room.members.get(actorAccountId);
            if (actor == null || actor.role() != PublicMembershipRole.OWNER) {
                return false;
            }
            room.revokedMembers.add(memberAccountId);
            return true;
        }

        @Override
        public void recordAudit(
                UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt) {
            if (failNextAudit) {
                failNextAudit = false;
                throw new IllegalStateException("audit unavailable");
            }
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
            private final StoredPublicInvite invite;
            private boolean revoked;

            private InviteRecord(UUID roomId, String tokenFingerprint, StoredPublicInvite invite) {
                this.roomId = roomId;
                this.tokenFingerprint = tokenFingerprint;
                this.invite = invite;
            }
        }
    }
}
