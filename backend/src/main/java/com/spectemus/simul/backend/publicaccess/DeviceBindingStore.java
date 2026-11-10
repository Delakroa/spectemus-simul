package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

interface DeviceBindingStore {

    void saveBinding(StoredBinding binding);

    Optional<StoredBinding> findBinding(UUID bindingId);

    boolean approveBinding(
            UUID bindingId, String userCodeFingerprint, UUID accountId, Instant now);

    /**
     * Atomically validates the device code, marks the binding {@code EXCHANGED}, and inserts the
     * device session using the locked binding's account id. Callers must not persist the session
     * in a separate transaction.
     */
    ExchangeResult exchangeBinding(
            UUID bindingId,
            String deviceCodeFingerprint,
            String sessionFingerprint,
            Instant sessionExpiresAt,
            Instant now);

    Optional<PublicAccessStore.StoredAccount> findAccountByDeviceSession(
            String sessionFingerprint, Instant now);

    boolean revokeDeviceSession(String sessionFingerprint, Instant now);

    enum BindingStatus {
        PENDING,
        APPROVED,
        EXCHANGED,
        EXPIRED,
        DENIED
    }

    enum ExchangeOutcome {
        PENDING,
        ISSUED,
        UNAVAILABLE,
        REJECTED
    }

    record StoredBinding(
            UUID bindingId,
            String deviceCodeFingerprint,
            String userCodeFingerprint,
            BindingStatus status,
            UUID accountId,
            Instant expiresAt,
            int intervalSeconds,
            Instant createdAt,
            Instant approvedAt,
            Instant exchangedAt) {}

    record ExchangeResult(ExchangeOutcome outcome, StoredBinding binding) {}

    record StoredDeviceSession(
            String sessionFingerprint,
            UUID accountId,
            UUID bindingId,
            Instant expiresAt,
            Instant createdAt) {}
}
