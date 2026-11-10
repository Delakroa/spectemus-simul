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
import java.util.concurrent.ConcurrentHashMap;

import com.spectemus.simul.backend.api.ApiException;

import org.junit.jupiter.api.Test;

class DeviceBindingServiceTest {

    private static final Instant NOW = Instant.parse("2026-11-10T10:00:00Z");

    @Test
    void exchangesApprovedBindingOnceAndRejectsReplay() {
        Fixture fixture = Fixture.enabled();
        PublicAccessService.AccountSessionResult account =
                fixture.login("host@example.test", "Host");
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();

        fixture.deviceBinding.approveBinding(
                started.bindingId(), account.sessionCredential(), started.userCode());

        DeviceBindingSessionResponse session =
                fixture.deviceBinding.exchangeBinding(started.bindingId(), started.deviceCode());
        assertThat(session.deviceCredential()).matches("[A-Za-z0-9_-]{43}");
        assertThat(session.profile().displayName()).isEqualTo("Host");
        assertThat(fixture.deviceStore.bindings.get(started.bindingId()).deviceCodeFingerprint())
                .doesNotContain(started.deviceCode());

        assertThatThrownBy(() -> fixture.deviceBinding.exchangeBinding(
                        started.bindingId(), started.deviceCode()))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DEVICE_BINDING_UNAVAILABLE");
    }

    @Test
    void pendingPollIsRetryableWithoutAccountEnumeration() {
        Fixture fixture = Fixture.enabled();
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();

        assertThatThrownBy(() -> fixture.deviceBinding.exchangeBinding(
                        started.bindingId(), started.deviceCode()))
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException apiException = (ApiException) error;
                    assertThat(apiException.code()).isEqualTo("DEVICE_AUTHORIZATION_PENDING");
                    assertThat(apiException.retryable()).isTrue();
                });
    }

    @Test
    void expiredBindingIsUnavailable() {
        Fixture fixture = Fixture.enabled();
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();
        fixture.clock.instant = NOW.plusSeconds(3600);

        assertThatThrownBy(() -> fixture.deviceBinding.exchangeBinding(
                        started.bindingId(), started.deviceCode()))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DEVICE_BINDING_UNAVAILABLE");
    }

    @Test
    void wrongDeviceCodeIsRejected() {
        Fixture fixture = Fixture.enabled();
        PublicAccessService.AccountSessionResult account =
                fixture.login("host@example.test", "Host");
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();
        fixture.deviceBinding.approveBinding(
                started.bindingId(), account.sessionCredential(), started.userCode());

        assertThatThrownBy(() -> fixture.deviceBinding.exchangeBinding(
                        started.bindingId(), "x".repeat(43)))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DEVICE_CODE_REJECTED");
    }

    @Test
    void wrongAccountCannotApproveForeignUserCode() {
        Fixture fixture = Fixture.enabled();
        PublicAccessService.AccountSessionResult account =
                fixture.login("host@example.test", "Host");
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();

        assertThatThrownBy(() -> fixture.deviceBinding.approveBinding(
                        started.bindingId(), account.sessionCredential(), "AAAA-BBBB"))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DEVICE_BINDING_UNAVAILABLE");
    }

    @Test
    void featureOffRejectsStart() {
        Fixture fixture = Fixture.disabledBinding();
        assertThatThrownBy(fixture.deviceBinding::startBinding)
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("DEVICE_BINDING_UNAVAILABLE");
    }

    @Test
    void revokeRemovesDeviceSession() {
        Fixture fixture = Fixture.enabled();
        PublicAccessService.AccountSessionResult account =
                fixture.login("host@example.test", "Host");
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();
        fixture.deviceBinding.approveBinding(
                started.bindingId(), account.sessionCredential(), started.userCode());
        DeviceBindingSessionResponse session =
                fixture.deviceBinding.exchangeBinding(started.bindingId(), started.deviceCode());

        fixture.deviceBinding.revokeDeviceSession(session.deviceCredential());
        assertThatThrownBy(() -> fixture.deviceBinding.requireDeviceAccount(session.deviceCredential()))
                .isInstanceOf(ApiException.class)
                .extracting(error -> ((ApiException) error).code())
                .isEqualTo("ACCOUNT_REQUIRED");
    }

    @Test
    void exchangeRollsBackWhenAuditFailsAndCanBeRetried() {
        Fixture fixture = Fixture.enabled();
        PublicAccessService.AccountSessionResult account =
                fixture.login("host@example.test", "Host");
        DeviceBindingStartedResponse started = fixture.deviceBinding.startBinding();
        fixture.deviceBinding.approveBinding(
                started.bindingId(), account.sessionCredential(), started.userCode());
        fixture.deviceStore.failNextExchangeAudit = true;

        assertThatThrownBy(() -> fixture.deviceBinding.exchangeBinding(
                        started.bindingId(), started.deviceCode()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("audit unavailable");
        assertThat(fixture.deviceStore.bindings.get(started.bindingId()).status())
                .isEqualTo(DeviceBindingStore.BindingStatus.APPROVED);
        assertThat(fixture.deviceStore.sessions).isEmpty();

        DeviceBindingSessionResponse session =
                fixture.deviceBinding.exchangeBinding(started.bindingId(), started.deviceCode());
        assertThat(session.deviceCredential()).matches("[A-Za-z0-9_-]{43}");
        assertThat(fixture.deviceStore.bindings.get(started.bindingId()).status())
                .isEqualTo(DeviceBindingStore.BindingStatus.EXCHANGED);
        assertThat(fixture.deviceBinding.requireDeviceAccount(session.deviceCredential()).displayName())
                .isEqualTo("Host");
    }

    private static final class Fixture {
        private final MutableClock clock = new MutableClock(NOW);
        private final InMemoryPublicAccessStore accountStore = new InMemoryPublicAccessStore();
        private final InMemoryDeviceBindingStore deviceStore = new InMemoryDeviceBindingStore(accountStore);
        private final CapturingDelivery delivery = new CapturingDelivery();
        private final PublicAccessSecrets secrets =
                new PublicAccessSecrets("test-identity-pepper-at-least-32-characters");
        private final PublicAccessService accounts;
        private final DeviceBindingService deviceBinding;

        private Fixture(boolean bindingEnabled) {
            PublicAccessProperties properties = new PublicAccessProperties(
                    true,
                    "jdbc:postgresql://db.example.test:5432/spectemus",
                    "spectemus",
                    "not-a-real-password",
                    "test-identity-pepper-at-least-32-characters",
                    null,
                    true,
                    new PublicAccessProperties.EmailProperties(
                            "smtp.example.test", 587, "user", "password", "login@example.test", true),
                    bindingEnabled,
                    bindingEnabled ? "https://app.example.test" : null,
                    null,
                    null,
                    null);
            this.accounts = new PublicAccessService(
                    accountStore, delivery, secrets, properties, null, deviceStore, clock);
            this.deviceBinding =
                    new DeviceBindingService(deviceStore, accountStore, secrets, properties, clock);
        }

        static Fixture enabled() {
            return new Fixture(true);
        }

        static Fixture disabledBinding() {
            return new Fixture(false);
        }

        PublicAccessService.AccountSessionResult login(String email, String displayName) {
            EmailChallengeAcceptedResponse challenge = accounts.requestEmailChallenge(email);
            return accounts.verifyEmailChallenge(challenge.challengeId(), delivery.code, displayName);
        }
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }

    private static final class CapturingDelivery implements EmailChallengeDelivery {
        private String code;

        @Override
        public void deliver(String email, String oneTimeCode, Instant expiresAt) {
            this.code = oneTimeCode;
        }
    }

    private static final class InMemoryDeviceBindingStore implements DeviceBindingStore {
        private final Map<UUID, StoredBinding> bindings = new ConcurrentHashMap<>();
        private final Map<String, StoredDeviceSession> sessions = new ConcurrentHashMap<>();
        private final Map<String, Instant> revokedSessions = new ConcurrentHashMap<>();
        private final InMemoryPublicAccessStore accounts;
        private boolean failNextExchangeAudit;

        private InMemoryDeviceBindingStore(InMemoryPublicAccessStore accounts) {
            this.accounts = accounts;
        }

        @Override
        public void saveBinding(StoredBinding binding) {
            bindings.put(binding.bindingId(), binding);
        }

        @Override
        public Optional<StoredBinding> findBinding(UUID bindingId) {
            return Optional.ofNullable(bindings.get(bindingId));
        }

        @Override
        public boolean approveBinding(
                UUID bindingId, String userCodeFingerprint, UUID accountId, Instant now) {
            StoredBinding binding = bindings.get(bindingId);
            if (binding == null
                    || binding.status() != BindingStatus.PENDING
                    || !binding.expiresAt().isAfter(now)
                    || !binding.userCodeFingerprint().equals(userCodeFingerprint)) {
                return false;
            }
            bindings.put(
                    bindingId,
                    new StoredBinding(
                            binding.bindingId(),
                            binding.deviceCodeFingerprint(),
                            binding.userCodeFingerprint(),
                            BindingStatus.APPROVED,
                            accountId,
                            binding.expiresAt(),
                            binding.intervalSeconds(),
                            binding.createdAt(),
                            now,
                            null));
            return true;
        }

        @Override
        public ExchangeResult exchangeBinding(
                UUID bindingId,
                String deviceCodeFingerprint,
                String sessionFingerprint,
                Instant sessionExpiresAt,
                UUID auditCorrelationId,
                Instant now) {
            StoredBinding binding = bindings.get(bindingId);
            if (binding == null) {
                return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, null, null);
            }
            if (!binding.deviceCodeFingerprint().equals(deviceCodeFingerprint)) {
                return new ExchangeResult(ExchangeOutcome.REJECTED, binding, null);
            }
            if (!binding.expiresAt().isAfter(now)
                    || binding.status() == BindingStatus.EXCHANGED
                    || binding.status() == BindingStatus.EXPIRED
                    || binding.status() == BindingStatus.DENIED) {
                return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, binding, null);
            }
            if (binding.status() == BindingStatus.PENDING) {
                return new ExchangeResult(ExchangeOutcome.PENDING, binding, null);
            }
            if (binding.status() != BindingStatus.APPROVED || binding.accountId() == null) {
                return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, binding, null);
            }
            PublicAccessStore.StoredAccount account = accounts.accountsById.get(binding.accountId());
            if (account == null) {
                throw new IllegalStateException("binding account unavailable");
            }
            if (failNextExchangeAudit) {
                failNextExchangeAudit = false;
                throw new IllegalStateException("audit unavailable");
            }
            StoredBinding exchanged = new StoredBinding(
                    binding.bindingId(),
                    binding.deviceCodeFingerprint(),
                    binding.userCodeFingerprint(),
                    BindingStatus.EXCHANGED,
                    binding.accountId(),
                    binding.expiresAt(),
                    binding.intervalSeconds(),
                    binding.createdAt(),
                    binding.approvedAt(),
                    now);
            bindings.put(bindingId, exchanged);
            sessions.put(
                    sessionFingerprint,
                    new StoredDeviceSession(
                            sessionFingerprint,
                            binding.accountId(),
                            binding.bindingId(),
                            sessionExpiresAt,
                            now));
            return new ExchangeResult(ExchangeOutcome.ISSUED, exchanged, account);
        }

        @Override
        public Optional<PublicAccessStore.StoredAccount> findAccountByDeviceSession(
                String sessionFingerprint, Instant now) {
            StoredDeviceSession session = sessions.get(sessionFingerprint);
            if (session == null
                    || !session.expiresAt().isAfter(now)
                    || revokedSessions.containsKey(sessionFingerprint)) {
                return Optional.empty();
            }
            return Optional.ofNullable(accounts.accountsById.get(session.accountId()));
        }

        @Override
        public boolean revokeDeviceSession(String sessionFingerprint, Instant now) {
            if (!sessions.containsKey(sessionFingerprint) || revokedSessions.containsKey(sessionFingerprint)) {
                return false;
            }
            revokedSessions.put(sessionFingerprint, now);
            return true;
        }
    }

    /** Minimal account store reused by device binding tests. */
    private static final class InMemoryPublicAccessStore implements PublicAccessStore {
        private final Map<UUID, StoredChallenge> challenges = new HashMap<>();
        private final Map<String, StoredAccount> accountsByEmail = new HashMap<>();
        private final Map<UUID, StoredAccount> accountsById = new HashMap<>();
        private final Map<String, StoredAccountSession> sessions = new HashMap<>();

        @Override
        public void saveChallenge(StoredChallenge challenge) {
            challenges.put(challenge.challengeId(), challenge);
        }

        @Override
        public ChallengeAttempt consumeChallenge(
                UUID challengeId, String codeFingerprint, Instant now, int maxAttempts) {
            StoredChallenge challenge = challenges.remove(challengeId);
            if (challenge == null
                    || !challenge.expiresAt().isAfter(now)
                    || !challenge.codeFingerprint().equals(codeFingerprint)) {
                return ChallengeAttempt.rejected();
            }
            return ChallengeAttempt.verified(challenge.emailFingerprint());
        }

        @Override
        public void discardChallenge(UUID challengeId) {
            challenges.remove(challengeId);
        }

        @Override
        public StoredAccount findOrCreateAccount(
                String emailFingerprint, String displayName, Instant createdAt) {
            return accountsByEmail.computeIfAbsent(emailFingerprint, key -> {
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
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<PublicRoomAccess> findRoomAccess(UUID publicRoomId, UUID accountId, Instant now) {
            return Optional.empty();
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
            throw new UnsupportedOperationException();
        }

        @Override
        public RedemptionCommandResult redeemInvite(
                String tokenFingerprint, UUID accountId, IdempotencyCommand command, Instant now) {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean revokeInvite(UUID publicRoomId, UUID inviteId, UUID accountId, Instant now) {
            return false;
        }

        @Override
        public boolean revokeMember(
                UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now) {
            return false;
        }

        @Override
        public void recordAudit(
                UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt) {}
    }
}
