package com.spectemus.simul.backend.publicaccess;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

import com.spectemus.simul.backend.api.ApiException;
import com.spectemus.simul.backend.api.ApiFieldViolation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class PublicAccessService {

    private static final Logger log = LoggerFactory.getLogger(PublicAccessService.class);
    private static final Duration CHALLENGE_TTL = Duration.ofMinutes(10);
    private static final int MAX_CHALLENGE_ATTEMPTS = 5;

    private final PublicAccessStore store;
    private final EmailChallengeDelivery emailDelivery;
    private final PublicAccessSecrets secrets;
    private final PublicAccessProperties properties;
    private final Clock clock;

    PublicAccessService(
            PublicAccessStore store,
            EmailChallengeDelivery emailDelivery,
            PublicAccessSecrets secrets,
            PublicAccessProperties properties,
            Clock clock) {
        this.store = store;
        this.emailDelivery = emailDelivery;
        this.secrets = secrets;
        this.properties = properties;
        this.clock = clock;
    }

    EmailChallengeAcceptedResponse requestEmailChallenge(String requestedEmail) {
        String email = normalizeEmail(requestedEmail);
        Instant now = Instant.now(clock);
        UUID challengeId = UUID.randomUUID();
        String code = secrets.emailCode();
        Instant expiresAt = now.plus(CHALLENGE_TTL);
        store.saveChallenge(new PublicAccessStore.StoredChallenge(
                challengeId,
                secrets.emailFingerprint(email),
                secrets.challengeCodeFingerprint(challengeId, code),
                expiresAt,
                now));

        try {
            emailDelivery.deliver(email, code, expiresAt);
        } catch (RuntimeException exception) {
            store.discardChallenge(challengeId);
            // SMTP exceptions can embed recipient or provider diagnostics. Keep logs privacy-safe.
            log.warn("Email challenge delivery failed challengeId={}", challengeId);
        }

        // Deliberately identical for new and existing accounts and for a transient mail failure.
        return new EmailChallengeAcceptedResponse(challengeId, expiresAt);
    }

    AccountSessionResult verifyEmailChallenge(
            UUID challengeId, String submittedCode, String requestedDisplayName) {
        if (submittedCode == null || submittedCode.isBlank()) {
            throw challengeRejected();
        }
        String code = submittedCode.strip().toUpperCase(Locale.ROOT);
        PublicAccessStore.ChallengeAttempt result = store.consumeChallenge(
                challengeId,
                secrets.challengeCodeFingerprint(challengeId, code),
                Instant.now(clock),
                MAX_CHALLENGE_ATTEMPTS);
        if (result.outcome() != PublicAccessStore.ChallengeAttempt.Outcome.VERIFIED) {
            throw challengeRejected();
        }

        String displayName = normalizedDisplayName(requestedDisplayName);
        Instant now = Instant.now(clock);
        PublicAccessStore.StoredAccount account =
                store.findOrCreateAccount(result.emailFingerprint(), displayName, now);
        String sessionCredential = secrets.credential();
        Duration sessionTtl = properties.sessionTtl();
        store.saveSession(new PublicAccessStore.StoredAccountSession(
                secrets.credentialFingerprint(sessionCredential),
                account.accountId(),
                now.plus(sessionTtl),
                now));
        return new AccountSessionResult(profile(account), sessionCredential, sessionTtl);
    }

    AccountProfileResponse currentAccount(String sessionCredential) {
        return profile(requireAccount(sessionCredential));
    }

    PublicRoomAccessResponse createRoom(
            String sessionCredential, String idempotencyKey, CreatePublicRoomRequest request, UUID correlationId) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        PublicAccessStore.IdempotencyCommand command = idempotencyCommand(
                "create-public-room", idempotencyKey, Integer.toString(request.expiresInMinutes()));
        PublicAccessStore.RoomCommandResult result = store.createRoom(
                account.accountId(), request.expiresInMinutes(), command, Instant.now(clock));
        if (result.outcome() == PublicAccessStore.IdempotencyOutcome.CONFLICT) {
            throw idempotencyConflict();
        }
        PublicAccessStore.PublicRoomAccess access = result.access();
        store.recordAudit(
                access.room().publicRoomId(),
                account.accountId(),
                "PUBLIC_ROOM_CREATED",
                correlationId,
                Instant.now(clock));
        return access(access);
    }

    PublicRoomAccessResponse roomAccess(
            UUID publicRoomId, String sessionCredential) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        return store.findRoomAccess(publicRoomId, account.accountId(), Instant.now(clock))
                .map(this::access)
                .orElseThrow(PublicAccessService::membershipRequired);
    }

    PublicInviteCreatedResponse createInvite(
            UUID publicRoomId,
            String sessionCredential,
            String idempotencyKey,
            CreatePublicInviteRequest request,
            UUID correlationId) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        PublicAccessStore.PublicRoomAccess ownerAccess = store
                .findRoomAccess(publicRoomId, account.accountId(), Instant.now(clock))
                .orElseThrow(PublicAccessService::membershipRequired);
        if (ownerAccess.membership().role() != PublicMembershipRole.OWNER) {
            throw membershipRequired();
        }
        String inviteToken = secrets.credential();
        PublicAccessStore.IdempotencyCommand command = idempotencyCommand(
                "create-public-invite",
                idempotencyKey,
                publicRoomId + "\u0000" + request.expiresInMinutes() + "\u0000" + request.maxRedemptions());
        PublicAccessStore.InviteCommandResult result = store.createInvite(
                publicRoomId,
                account.accountId(),
                secrets.credentialFingerprint(inviteToken),
                request.expiresInMinutes(),
                request.maxRedemptions(),
                command,
                Instant.now(clock));
        if (result.outcome() == PublicAccessStore.IdempotencyOutcome.CONFLICT) {
            throw idempotencyConflict();
        }
        if (result.outcome() == PublicAccessStore.IdempotencyOutcome.REPLAYED) {
            throw idempotencyReplayUnavailable();
        }
        PublicAccessStore.StoredPublicInvite invite = result.invite();
        store.recordAudit(
                publicRoomId,
                account.accountId(),
                "PUBLIC_INVITE_CREATED",
                correlationId,
                Instant.now(clock));
        return new PublicInviteCreatedResponse(
                invite.inviteId(),
                "/join#invite=" + inviteToken,
                invite.expiresAt(),
                invite.maxRedemptions());
    }

    PublicRoomAccessResponse redeemInvite(
            String sessionCredential,
            String idempotencyKey,
            RedeemPublicInviteRequest request,
            UUID correlationId) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        String tokenFingerprint = secrets.credentialFingerprint(request.inviteToken());
        PublicAccessStore.IdempotencyCommand command =
                idempotencyCommand("redeem-public-invite", idempotencyKey, tokenFingerprint);
        PublicAccessStore.RedemptionCommandResult commandResult = store.redeemInvite(
                tokenFingerprint, account.accountId(), command, Instant.now(clock));
        if (commandResult.outcome() == PublicAccessStore.IdempotencyOutcome.CONFLICT) {
            throw idempotencyConflict();
        }
        PublicAccessStore.InviteRedemption redemption = commandResult.redemption();
        if (redemption.outcome() == PublicAccessStore.InviteRedemption.Outcome.UNAVAILABLE) {
            throw inviteUnavailable();
        }
        if (redemption.outcome() == PublicAccessStore.InviteRedemption.Outcome.ROOM_FULL) {
            throw accountLimitReached();
        }
        PublicAccessStore.PublicRoomAccess access = redemption.access();
        store.recordAudit(
                access.room().publicRoomId(),
                account.accountId(),
                "PUBLIC_INVITE_REDEEMED",
                correlationId,
                Instant.now(clock));
        return access(access);
    }

    void revokeInvite(
            UUID publicRoomId,
            UUID inviteId,
            String sessionCredential,
            UUID correlationId) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        if (!store.revokeInvite(publicRoomId, inviteId, account.accountId(), Instant.now(clock))) {
            throw membershipRequired();
        }
        store.recordAudit(
                publicRoomId,
                account.accountId(),
                "PUBLIC_INVITE_REVOKED",
                correlationId,
                Instant.now(clock));
    }

    void revokeMember(
            UUID publicRoomId,
            UUID memberAccountId,
            String sessionCredential,
            UUID correlationId) {
        PublicAccessStore.StoredAccount account = requireAccount(sessionCredential);
        if (!store.revokeMember(publicRoomId, memberAccountId, account.accountId(), Instant.now(clock))) {
            throw membershipRequired();
        }
        store.recordAudit(
                publicRoomId,
                account.accountId(),
                "PUBLIC_MEMBER_REVOKED",
                correlationId,
                Instant.now(clock));
    }

    private PublicAccessStore.StoredAccount requireAccount(String sessionCredential) {
        if (sessionCredential == null || !sessionCredential.matches("^[A-Za-z0-9_-]{43}$")) {
            throw accountRequired();
        }
        return store.findAccountBySession(
                        secrets.credentialFingerprint(sessionCredential), Instant.now(clock))
                .orElseThrow(PublicAccessService::accountRequired);
    }

    private String normalizeEmail(String requestedEmail) {
        if (requestedEmail == null) {
            throw ApiException.validation(new ApiFieldViolation(
                    "email", "INVALID_EMAIL", "Укажите корректный email."));
        }
        return requestedEmail.strip().toLowerCase(Locale.ROOT);
    }

    private String normalizedDisplayName(String requestedDisplayName) {
        if (requestedDisplayName == null || requestedDisplayName.isBlank()) {
            return "Гость";
        }
        String displayName = requestedDisplayName.strip();
        if (displayName.length() > 64 || displayName.chars().anyMatch(Character::isISOControl)) {
            throw ApiException.validation(new ApiFieldViolation(
                    "displayName", "INVALID_DISPLAY_NAME", "Укажите имя длиной до 64 символов."));
        }
        return displayName;
    }

    private PublicAccessStore.IdempotencyCommand idempotencyCommand(
            String operation, String idempotencyKey, String request) {
        validateIdempotencyKey(idempotencyKey);
        return new PublicAccessStore.IdempotencyCommand(
                operation,
                secrets.idempotencyFingerprint(idempotencyKey),
                secrets.requestFingerprint(operation, request));
    }

    private void validateIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey == null
                || idempotencyKey.length() < 16
                || idempotencyKey.length() > 128
                || !idempotencyKey.matches("^[\\x21-\\x7E]+$")) {
            throw ApiException.validation(new ApiFieldViolation(
                    "Idempotency-Key",
                    "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key должен содержать от 16 до 128 видимых ASCII-символов."));
        }
    }

    private AccountProfileResponse profile(PublicAccessStore.StoredAccount account) {
        return new AccountProfileResponse(account.accountId(), account.displayName(), account.createdAt());
    }

    private PublicRoomAccessResponse access(PublicAccessStore.PublicRoomAccess access) {
        PublicAccessStore.PublicRoom room = access.room();
        return new PublicRoomAccessResponse(
                new PublicRoomResponse(
                        room.publicRoomId(),
                        room.status(),
                        room.memberLimit(),
                        room.createdAt(),
                        room.expiresAt()),
                new PublicRoomMembershipResponse(
                        access.membership().role(), access.membership().joinedAt()));
    }

    private static ApiException challengeRejected() {
        return ApiException.unauthorized(
                "CHALLENGE_REJECTED",
                "Код не подтверждён",
                "Код недействителен, истёк или уже использован.");
    }

    private static ApiException accountRequired() {
        return ApiException.unauthorized(
                "ACCOUNT_REQUIRED",
                "Нужен вход",
                "Войдите через подтверждённый email и повторите действие.");
    }

    private static ApiException membershipRequired() {
        return ApiException.notFound(
                "MEMBERSHIP_REQUIRED",
                "Комната недоступна",
                "Эта комната недоступна для текущего account.");
    }

    private static ApiException inviteUnavailable() {
        return ApiException.notFound(
                "INVITE_UNAVAILABLE",
                "Приглашение недоступно",
                "Приглашение недействительно, истекло, отозвано или исчерпано.");
    }

    private static ApiException accountLimitReached() {
        return ApiException.conflict(
                "ACCOUNT_LIMIT_REACHED",
                "Достигнут лимит комнаты",
                "В этой комнате уже максимальное число участников.");
    }

    private static ApiException idempotencyConflict() {
        return ApiException.conflict(
                "IDEMPOTENCY_CONFLICT",
                "Конфликт Idempotency-Key",
                "Этот Idempotency-Key уже использован с другим запросом.");
    }

    private static ApiException idempotencyReplayUnavailable() {
        return ApiException.conflict(
                "IDEMPOTENCY_REPLAY_UNAVAILABLE",
                "Повтор приглашения недоступен",
                "Создайте новое приглашение: raw token безопасно возвращается только один раз.");
    }

    record AccountSessionResult(
            AccountProfileResponse profile, String sessionCredential, Duration sessionTtl) {}
}
