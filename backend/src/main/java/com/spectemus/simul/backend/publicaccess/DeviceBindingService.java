package com.spectemus.simul.backend.publicaccess;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import com.spectemus.simul.backend.api.ApiException;

import org.springframework.http.HttpStatus;

final class DeviceBindingService {

    private static final Pattern DEVICE_SECRET = Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Pattern USER_CODE = Pattern.compile("^[A-Z0-9]{4}-[A-Z0-9]{4}$");

    private final DeviceBindingStore store;
    private final PublicAccessStore accountStore;
    private final PublicAccessSecrets secrets;
    private final PublicAccessProperties properties;
    private final Clock clock;

    DeviceBindingService(
            DeviceBindingStore store,
            PublicAccessStore accountStore,
            PublicAccessSecrets secrets,
            PublicAccessProperties properties,
            Clock clock) {
        this.store = store;
        this.accountStore = accountStore;
        this.secrets = secrets;
        this.properties = properties;
        this.clock = clock;
    }

    DeviceBindingStartedResponse startBinding() {
        requireEnabled();
        Instant now = Instant.now(clock);
        UUID bindingId = UUID.randomUUID();
        String deviceCode = secrets.credential();
        String userCode = secrets.deviceUserCode();
        int intervalSeconds = Math.toIntExact(properties.devicePollInterval().toSeconds());
        Instant expiresAt = now.plus(properties.deviceBindingTtl());
        store.saveBinding(new DeviceBindingStore.StoredBinding(
                bindingId,
                secrets.deviceCodeFingerprint(deviceCode),
                secrets.userCodeFingerprint(userCode),
                DeviceBindingStore.BindingStatus.PENDING,
                null,
                expiresAt,
                intervalSeconds,
                now,
                null,
                null));
        String verificationUri = trimTrailingSlash(properties.deviceBindingVerificationOrigin().strip())
                + "/internet/link#binding="
                + bindingId;
        return new DeviceBindingStartedResponse(
                bindingId, userCode, verificationUri, expiresAt, intervalSeconds, deviceCode);
    }

    void approveBinding(UUID bindingId, String accountCredential, String userCode) {
        requireEnabled();
        PublicAccessStore.StoredAccount account = requireBrowserAccount(accountCredential);
        if (userCode == null || !USER_CODE.matcher(userCode).matches()) {
            throw bindingUnavailable();
        }
        Instant now = Instant.now(clock);
        boolean approved =
                store.approveBinding(bindingId, secrets.userCodeFingerprint(userCode), account.accountId(), now);
        if (!approved) {
            throw bindingUnavailable();
        }
        accountStore.recordAudit(null, account.accountId(), "DEVICE_BINDING_APPROVED", UUID.randomUUID(), now);
    }

    DeviceBindingSessionResponse exchangeBinding(UUID bindingId, String deviceCode) {
        requireEnabled();
        if (deviceCode == null || !DEVICE_SECRET.matcher(deviceCode).matches()) {
            throw deviceCodeRejected();
        }
        Instant now = Instant.now(clock);
        String deviceCredential = secrets.credential();
        Instant expiresAt = now.plus(properties.deviceSessionTtl());
        UUID auditCorrelationId = UUID.randomUUID();
        DeviceBindingStore.ExchangeResult result = store.exchangeBinding(
                bindingId,
                secrets.deviceCodeFingerprint(deviceCode),
                secrets.deviceCredentialFingerprint(deviceCredential),
                expiresAt,
                auditCorrelationId,
                now);
        return switch (result.outcome()) {
            case PENDING -> throw authorizationPending(result.binding());
            case REJECTED -> throw deviceCodeRejected();
            case UNAVAILABLE -> throw bindingUnavailable();
            case ISSUED -> {
                PublicAccessStore.StoredAccount account = result.account();
                if (account == null) {
                    throw new IllegalStateException("Issued device binding is missing account profile");
                }
                yield new DeviceBindingSessionResponse(
                        deviceCredential,
                        new AccountProfileResponse(
                                account.accountId(), account.displayName(), account.createdAt()),
                        expiresAt);
            }
        };
    }

    void revokeDeviceSession(String deviceCredential) {
        requireEnabled();
        if (deviceCredential == null || !DEVICE_SECRET.matcher(deviceCredential).matches()) {
            throw deviceCodeRejected();
        }
        Instant now = Instant.now(clock);
        store.revokeDeviceSession(secrets.deviceCredentialFingerprint(deviceCredential), now);
    }

    PublicAccessStore.StoredAccount requireDeviceAccount(String deviceCredential) {
        requireEnabled();
        if (deviceCredential == null || !DEVICE_SECRET.matcher(deviceCredential).matches()) {
            throw accountRequired();
        }
        return store.findAccountByDeviceSession(
                        secrets.deviceCredentialFingerprint(deviceCredential), Instant.now(clock))
                .orElseThrow(DeviceBindingService::accountRequired);
    }

    private PublicAccessStore.StoredAccount requireBrowserAccount(String sessionCredential) {
        if (sessionCredential == null || !DEVICE_SECRET.matcher(sessionCredential).matches()) {
            throw accountRequired();
        }
        return accountStore
                .findAccountBySession(secrets.credentialFingerprint(sessionCredential), Instant.now(clock))
                .orElseThrow(DeviceBindingService::accountRequired);
    }

    private void requireEnabled() {
        if (!properties.isDeviceBindingEnabled()) {
            throw bindingUnavailable();
        }
    }

    private static ApiException authorizationPending(DeviceBindingStore.StoredBinding binding) {
        int retryAfter = binding == null ? 5 : Math.max(1, binding.intervalSeconds());
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "DEVICE_AUTHORIZATION_PENDING",
                "Ожидается подтверждение",
                "Подтвердите привязку в браузере и повторите запрос через " + retryAfter + " с.",
                true,
                List.of());
    }

    private static ApiException bindingUnavailable() {
        return ApiException.notFound(
                "DEVICE_BINDING_UNAVAILABLE",
                "Привязка недоступна",
                "Привязка недействительна или больше не доступна.");
    }

    private static ApiException deviceCodeRejected() {
        return ApiException.unauthorized(
                "DEVICE_CODE_REJECTED",
                "Код устройства отклонён",
                "Код устройства недействителен.");
    }

    private static ApiException accountRequired() {
        return ApiException.unauthorized(
                "ACCOUNT_REQUIRED",
                "Требуется вход",
                "Войдите в аккаунт, чтобы продолжить.");
    }

    private static String trimTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
