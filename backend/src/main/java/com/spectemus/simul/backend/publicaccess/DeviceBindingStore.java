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
     * Atomically validates the device code, marks the binding {@code EXCHANGED}, inserts the device
     * session and its audit event, and returns the account profile required by the response. Callers
     * must not perform response-critical persistence or reads after this transaction.
     */
    ExchangeResult exchangeBinding(
            UUID bindingId,
            String deviceCodeFingerprint,
            String sessionFingerprint,
            Instant sessionExpiresAt,
            UUID auditCorrelationId,
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

    record ExchangeResult(
            ExchangeOutcome outcome,
            StoredBinding binding,
            PublicAccessStore.StoredAccount account) {}

    record StoredDeviceSession(
            String sessionFingerprint,
            UUID accountId,
            UUID bindingId,
            Instant expiresAt,
            Instant createdAt) {}
}
