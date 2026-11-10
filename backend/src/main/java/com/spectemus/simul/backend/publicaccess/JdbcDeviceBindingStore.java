package com.spectemus.simul.backend.publicaccess;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import javax.sql.DataSource;

final class JdbcDeviceBindingStore implements DeviceBindingStore {

    private final DataSource dataSource;

    JdbcDeviceBindingStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void saveBinding(StoredBinding binding) {
        execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO wt_device_binding (
                        binding_id, device_code_hash, user_code_hash, status, account_id,
                        expires_at, interval_seconds, created_at, approved_at, exchanged_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """)) {
                statement.setObject(1, binding.bindingId());
                statement.setString(2, binding.deviceCodeFingerprint());
                statement.setString(3, binding.userCodeFingerprint());
                statement.setString(4, binding.status().name());
                statement.setObject(5, binding.accountId());
                statement.setTimestamp(6, timestamp(binding.expiresAt()));
                statement.setInt(7, binding.intervalSeconds());
                statement.setTimestamp(8, timestamp(binding.createdAt()));
                statement.setTimestamp(9, timestampOrNull(binding.approvedAt()));
                statement.setTimestamp(10, timestampOrNull(binding.exchangedAt()));
                statement.executeUpdate();
            }
            return null;
        });
    }

    @Override
    public Optional<StoredBinding> findBinding(UUID bindingId) {
        return execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT binding_id, device_code_hash, user_code_hash, status, account_id,
                           expires_at, interval_seconds, created_at, approved_at, exchanged_at
                    FROM wt_device_binding
                    WHERE binding_id = ?
                    """)) {
                statement.setObject(1, bindingId);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(readBinding(result));
                }
            }
        });
    }

    @Override
    public boolean approveBinding(
            UUID bindingId, String userCodeFingerprint, UUID accountId, Instant now) {
        return transaction(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT user_code_hash, status, expires_at
                    FROM wt_device_binding
                    WHERE binding_id = ?
                    FOR UPDATE
                    """)) {
                statement.setObject(1, bindingId);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        return false;
                    }
                    Instant expiresAt = result.getTimestamp("expires_at").toInstant();
                    BindingStatus status = BindingStatus.valueOf(result.getString("status"));
                    if (!expiresAt.isAfter(now) || status != BindingStatus.PENDING) {
                        return false;
                    }
                    if (!constantTimeEquals(result.getString("user_code_hash"), userCodeFingerprint)) {
                        return false;
                    }
                    try (PreparedStatement update = connection.prepareStatement("""
                            UPDATE wt_device_binding
                            SET status = ?, account_id = ?, approved_at = ?
                            WHERE binding_id = ?
                            """)) {
                        update.setString(1, BindingStatus.APPROVED.name());
                        update.setObject(2, accountId);
                        update.setTimestamp(3, timestamp(now));
                        update.setObject(4, bindingId);
                        update.executeUpdate();
                    }
                    return true;
                }
            }
        });
    }

    @Override
    public ExchangeResult exchangeBinding(
            UUID bindingId,
            String deviceCodeFingerprint,
            String sessionFingerprint,
            Instant sessionExpiresAt,
            Instant now) {
        return transaction(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT binding_id, device_code_hash, user_code_hash, status, account_id,
                           expires_at, interval_seconds, created_at, approved_at, exchanged_at
                    FROM wt_device_binding
                    WHERE binding_id = ?
                    FOR UPDATE
                    """)) {
                statement.setObject(1, bindingId);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, null);
                    }
                    StoredBinding binding = readBinding(result);
                    if (!constantTimeEquals(binding.deviceCodeFingerprint(), deviceCodeFingerprint)) {
                        return new ExchangeResult(ExchangeOutcome.REJECTED, binding);
                    }
                    if (!binding.expiresAt().isAfter(now)
                            || binding.status() == BindingStatus.EXCHANGED
                            || binding.status() == BindingStatus.DENIED
                            || binding.status() == BindingStatus.EXPIRED) {
                        return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, binding);
                    }
                    if (binding.status() == BindingStatus.PENDING) {
                        return new ExchangeResult(ExchangeOutcome.PENDING, binding);
                    }
                    if (binding.status() != BindingStatus.APPROVED || binding.accountId() == null) {
                        return new ExchangeResult(ExchangeOutcome.UNAVAILABLE, binding);
                    }
                    try (PreparedStatement update = connection.prepareStatement("""
                            UPDATE wt_device_binding
                            SET status = ?, exchanged_at = ?
                            WHERE binding_id = ?
                            """)) {
                        update.setString(1, BindingStatus.EXCHANGED.name());
                        update.setTimestamp(2, timestamp(now));
                        update.setObject(3, bindingId);
                        update.executeUpdate();
                    }
                    try (PreparedStatement insert = connection.prepareStatement("""
                            INSERT INTO wt_device_session
                                (session_hash, account_id, binding_id, expires_at, created_at)
                            VALUES (?, ?, ?, ?, ?)
                            """)) {
                        insert.setString(1, sessionFingerprint);
                        insert.setObject(2, binding.accountId());
                        insert.setObject(3, binding.bindingId());
                        insert.setTimestamp(4, timestamp(sessionExpiresAt));
                        insert.setTimestamp(5, timestamp(now));
                        insert.executeUpdate();
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
                    return new ExchangeResult(ExchangeOutcome.ISSUED, exchanged);
                }
            }
        });
    }

    @Override
    public Optional<PublicAccessStore.StoredAccount> findAccountByDeviceSession(
            String sessionFingerprint, Instant now) {
        return execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT a.account_id, a.display_name, a.created_at
                    FROM wt_device_session s
                    JOIN wt_public_account a ON a.account_id = s.account_id
                    WHERE s.session_hash = ?
                      AND s.revoked_at IS NULL
                      AND s.expires_at > ?
                    """)) {
                statement.setString(1, sessionFingerprint);
                statement.setTimestamp(2, timestamp(now));
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        return Optional.empty();
                    }
                    return Optional.of(new PublicAccessStore.StoredAccount(
                            (UUID) result.getObject("account_id"),
                            result.getString("display_name"),
                            result.getTimestamp("created_at").toInstant()));
                }
            }
        });
    }

    @Override
    public boolean revokeDeviceSession(String sessionFingerprint, Instant now) {
        return execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE wt_device_session
                    SET revoked_at = ?
                    WHERE session_hash = ? AND revoked_at IS NULL
                    """)) {
                statement.setTimestamp(1, timestamp(now));
                statement.setString(2, sessionFingerprint);
                return statement.executeUpdate() > 0;
            }
        });
    }

    private StoredBinding readBinding(ResultSet result) throws SQLException {
        Timestamp approved = result.getTimestamp("approved_at");
        Timestamp exchanged = result.getTimestamp("exchanged_at");
        return new StoredBinding(
                (UUID) result.getObject("binding_id"),
                result.getString("device_code_hash"),
                result.getString("user_code_hash"),
                BindingStatus.valueOf(result.getString("status")),
                (UUID) result.getObject("account_id"),
                result.getTimestamp("expires_at").toInstant(),
                result.getInt("interval_seconds"),
                result.getTimestamp("created_at").toInstant(),
                approved == null ? null : approved.toInstant(),
                exchanged == null ? null : exchanged.toInstant());
    }

    private <T> T execute(SqlAction<T> action) {
        try (Connection connection = dataSource.getConnection()) {
            return action.run(connection);
        } catch (SQLException exception) {
            throw new IllegalStateException("Public device binding store failed", exception);
        }
    }

    private <T> T transaction(SqlAction<T> action) {
        try (Connection connection = dataSource.getConnection()) {
            boolean previous = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                T result = action.run(connection);
                connection.commit();
                return result;
            } catch (Exception exception) {
                connection.rollback();
                if (exception instanceof RuntimeException runtime) {
                    throw runtime;
                }
                throw new IllegalStateException("Public device binding store failed", exception);
            } finally {
                connection.setAutoCommit(previous);
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Public device binding store failed", exception);
        }
    }

    private static Timestamp timestamp(Instant instant) {
        return Timestamp.from(instant);
    }

    private static Timestamp timestampOrNull(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private static boolean constantTimeEquals(String left, String right) {
        if (left == null || right == null) {
            return false;
        }
        byte[] leftBytes = left.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] rightBytes = right.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        return java.security.MessageDigest.isEqual(leftBytes, rightBytes);
    }

    @FunctionalInterface
    private interface SqlAction<T> {
        T run(Connection connection) throws SQLException;
    }
}
