package com.spectemus.simul.backend.publicaccess;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import javax.sql.DataSource;

/** PostgreSQL implementation. Every mutation with an access decision is one transaction. */
final class JdbcPublicAccessStore implements PublicAccessStore {

    private static final Duration IDEMPOTENCY_TTL = Duration.ofHours(24);
    private final DataSource dataSource;

    JdbcPublicAccessStore(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void saveChallenge(StoredChallenge challenge) {
        execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO wt_email_challenge
                        (challenge_id, email_fingerprint, code_hash, expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """)) {
                statement.setObject(1, challenge.challengeId());
                statement.setString(2, challenge.emailFingerprint());
                statement.setString(3, challenge.codeFingerprint());
                statement.setTimestamp(4, timestamp(challenge.expiresAt()));
                statement.setTimestamp(5, timestamp(challenge.createdAt()));
                statement.executeUpdate();
            }
            return null;
        });
    }

    @Override
    public ChallengeAttempt consumeChallenge(
            UUID challengeId, String codeFingerprint, Instant now, int maxAttempts) {
        return transaction(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT email_fingerprint, code_hash, expires_at, consumed_at, attempts
                    FROM wt_email_challenge
                    WHERE challenge_id = ?
                    FOR UPDATE
                    """)) {
                statement.setObject(1, challengeId);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        return ChallengeAttempt.rejected();
                    }
                    boolean expired = !result.getTimestamp("expires_at").toInstant().isAfter(now);
                    boolean consumed = result.getTimestamp("consumed_at") != null;
                    int attempts = result.getInt("attempts");
                    if (expired || consumed || attempts >= maxAttempts) {
                        return ChallengeAttempt.rejected();
                    }
                    if (constantTimeEquals(result.getString("code_hash"), codeFingerprint)) {
                        try (PreparedStatement consume = connection.prepareStatement("""
                                UPDATE wt_email_challenge SET consumed_at = ? WHERE challenge_id = ?
                                """)) {
                            consume.setTimestamp(1, timestamp(now));
                            consume.setObject(2, challengeId);
                            consume.executeUpdate();
                        }
                        return ChallengeAttempt.verified(result.getString("email_fingerprint"));
                    }
                    int nextAttempts = attempts + 1;
                    try (PreparedStatement reject = connection.prepareStatement("""
                            UPDATE wt_email_challenge
                            SET attempts = ?, consumed_at = CASE WHEN ? >= ? THEN ? ELSE consumed_at END
                            WHERE challenge_id = ?
                            """)) {
                        reject.setInt(1, nextAttempts);
                        reject.setInt(2, nextAttempts);
                        reject.setInt(3, maxAttempts);
                        reject.setTimestamp(4, timestamp(now));
                        reject.setObject(5, challengeId);
                        reject.executeUpdate();
                    }
                    return ChallengeAttempt.rejected();
                }
            }
        });
    }

    @Override
    public void discardChallenge(UUID challengeId) {
        execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement(
                    "DELETE FROM wt_email_challenge WHERE challenge_id = ?")) {
                statement.setObject(1, challengeId);
                statement.executeUpdate();
            }
            return null;
        });
    }

    @Override
    public StoredAccount findOrCreateAccount(
            String emailFingerprint, String displayName, Instant createdAt) {
        return transaction(connection -> {
            Optional<StoredAccount> existing = accountByEmail(connection, emailFingerprint);
            if (existing.isPresent()) {
                return existing.get();
            }
            UUID accountId = UUID.randomUUID();
            try (PreparedStatement insert = connection.prepareStatement("""
                    INSERT INTO wt_public_account
                        (account_id, email_fingerprint, display_name, created_at)
                    VALUES (?, ?, ?, ?)
                    """)) {
                insert.setObject(1, accountId);
                insert.setString(2, emailFingerprint);
                insert.setString(3, displayName);
                insert.setTimestamp(4, timestamp(createdAt));
                insert.executeUpdate();
                return new StoredAccount(accountId, displayName, createdAt);
            } catch (SQLException exception) {
                if (isUniqueViolation(exception)) {
                    return accountByEmail(connection, emailFingerprint).orElseThrow(() -> exception);
                }
                throw exception;
            }
        });
    }

    @Override
    public void saveSession(StoredAccountSession session) {
        execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO wt_account_session
                        (session_hash, account_id, expires_at, created_at)
                    VALUES (?, ?, ?, ?)
                    """)) {
                statement.setString(1, session.sessionFingerprint());
                statement.setObject(2, session.accountId());
                statement.setTimestamp(3, timestamp(session.expiresAt()));
                statement.setTimestamp(4, timestamp(session.createdAt()));
                statement.executeUpdate();
            }
            return null;
        });
    }

    @Override
    public Optional<StoredAccount> findAccountBySession(String sessionFingerprint, Instant now) {
        return execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    SELECT account.account_id, account.display_name, account.created_at
                    FROM wt_account_session session
                    JOIN wt_public_account account ON account.account_id = session.account_id
                    WHERE session.session_hash = ?
                      AND session.revoked_at IS NULL
                      AND session.expires_at > ?
                    """)) {
                statement.setString(1, sessionFingerprint);
                statement.setTimestamp(2, timestamp(now));
                try (ResultSet result = statement.executeQuery()) {
                    return result.next() ? Optional.of(account(result)) : Optional.empty();
                }
            }
        });
    }

    @Override
    public RoomCommandResult createRoom(
            UUID accountId, int expiresInMinutes, IdempotencyCommand command, Instant now) {
        return transaction(connection -> {
            UUID roomId = UUID.randomUUID();
            IdempotencyClaim claim = claimIdempotency(connection, accountId, command, roomId, now);
            if (claim.outcome() == IdempotencyOutcome.CONFLICT) {
                return new RoomCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            if (claim.outcome() == IdempotencyOutcome.REPLAYED) {
                return new RoomCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        idempotentRoomAccess(connection, claim.resultId(), accountId).orElse(null));
            }
            Instant expiresAt = now.plusSeconds(expiresInMinutes * 60L);
            try (PreparedStatement room = connection.prepareStatement("""
                    INSERT INTO wt_public_room
                        (public_room_id, owner_account_id, status, member_limit, created_at, expires_at)
                    VALUES (?, ?, 'OPEN', 4, ?, ?)
                    """)) {
                room.setObject(1, roomId);
                room.setObject(2, accountId);
                room.setTimestamp(3, timestamp(now));
                room.setTimestamp(4, timestamp(expiresAt));
                room.executeUpdate();
            }
            try (PreparedStatement membership = connection.prepareStatement("""
                    INSERT INTO wt_public_room_membership
                        (public_room_id, account_id, role, joined_at)
                    VALUES (?, ?, 'OWNER', ?)
                    """)) {
                membership.setObject(1, roomId);
                membership.setObject(2, accountId);
                membership.setTimestamp(3, timestamp(now));
                membership.executeUpdate();
            }
            return new RoomCommandResult(
                    IdempotencyOutcome.CREATED,
                    new PublicRoomAccess(
                            new PublicRoom(roomId, PublicRoomStatus.OPEN, 4, now, expiresAt),
                            new PublicRoomMembership(PublicMembershipRole.OWNER, now)));
        });
    }

    @Override
    public Optional<PublicRoomAccess> findRoomAccess(UUID publicRoomId, UUID accountId, Instant now) {
        return execute(connection -> roomAccess(connection, publicRoomId, accountId, now));
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
        return transaction(connection -> {
            UUID inviteId = UUID.randomUUID();
            Instant expiresAt = now.plusSeconds(expiresInMinutes * 60L);
            if (!isActiveOwner(connection, publicRoomId, accountId, now)) {
                return new InviteCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            IdempotencyClaim claim = claimIdempotency(connection, accountId, command, inviteId, now);
            if (claim.outcome() == IdempotencyOutcome.CONFLICT) {
                return new InviteCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            if (claim.outcome() == IdempotencyOutcome.REPLAYED) {
                return new InviteCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        storedInvite(connection, claim.resultId()).orElse(null));
            }
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO wt_public_invite
                        (invite_id, public_room_id, token_hash, expires_at, max_redemptions, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """)) {
                statement.setObject(1, inviteId);
                statement.setObject(2, publicRoomId);
                statement.setString(3, tokenFingerprint);
                statement.setTimestamp(4, timestamp(expiresAt));
                statement.setInt(5, maxRedemptions);
                statement.setTimestamp(6, timestamp(now));
                statement.executeUpdate();
            }
            return new InviteCommandResult(
                    IdempotencyOutcome.CREATED,
                    new StoredPublicInvite(inviteId, expiresAt, maxRedemptions, 0));
        });
    }

    @Override
    public RedemptionCommandResult redeemInvite(
            String tokenFingerprint, UUID accountId, IdempotencyCommand command, Instant now) {
        return transaction(connection -> {
            InviteRow invite = lockInvite(connection, tokenFingerprint);
            if (invite == null
                    || invite.revokedAt() != null
                    || !invite.expiresAt().isAfter(now)
                    || invite.status() != PublicRoomStatus.OPEN
                    || !invite.roomExpiresAt().isAfter(now)) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.unavailable());
            }
            IdempotencyClaim claim = claimIdempotency(
                    connection, accountId, command, invite.publicRoomId(), now);
            if (claim.outcome() == IdempotencyOutcome.CONFLICT) {
                return new RedemptionCommandResult(IdempotencyOutcome.CONFLICT, null);
            }
            if (claim.outcome() == IdempotencyOutcome.REPLAYED) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.REPLAYED,
                        roomAccess(connection, claim.resultId(), accountId, now)
                                .map(InviteRedemption::redeemed)
                                .orElseGet(InviteRedemption::unavailable));
            }
            Optional<PublicRoomAccess> existing = roomAccess(connection, invite.publicRoomId(), accountId, now);
            if (existing.isPresent()) {
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.redeemed(existing.get()));
            }
            if (activeMembershipCount(connection, invite.publicRoomId()) >= invite.memberLimit()) {
                discardIdempotency(connection, accountId, command);
                return new RedemptionCommandResult(
                        IdempotencyOutcome.CREATED, InviteRedemption.roomFull());
            }
            try (PreparedStatement consume = connection.prepareStatement("""
                    UPDATE wt_public_invite
                    SET redemption_count = redemption_count + 1
                    WHERE invite_id = ? AND redemption_count < max_redemptions
                    """)) {
                consume.setObject(1, invite.inviteId());
                if (consume.executeUpdate() == 0) {
                    discardIdempotency(connection, accountId, command);
                    return new RedemptionCommandResult(
                            IdempotencyOutcome.CREATED, InviteRedemption.unavailable());
                }
            }
            try (PreparedStatement membership = connection.prepareStatement("""
                    INSERT INTO wt_public_room_membership
                        (public_room_id, account_id, role, joined_at, revoked_at)
                    VALUES (?, ?, 'GUEST', ?, NULL)
                    ON CONFLICT (public_room_id, account_id) DO UPDATE
                    SET role = 'GUEST', joined_at = EXCLUDED.joined_at, revoked_at = NULL
                    """)) {
                membership.setObject(1, invite.publicRoomId());
                membership.setObject(2, accountId);
                membership.setTimestamp(3, timestamp(now));
                membership.executeUpdate();
            }
            return new RedemptionCommandResult(
                    IdempotencyOutcome.CREATED,
                    roomAccess(connection, invite.publicRoomId(), accountId, now)
                            .map(InviteRedemption::redeemed)
                            .orElseGet(InviteRedemption::unavailable));
        });
    }

    @Override
    public boolean revokeInvite(UUID publicRoomId, UUID inviteId, UUID accountId, Instant now) {
        return transaction(connection -> {
            if (!isActiveOwner(connection, publicRoomId, accountId, now)) {
                return false;
            }
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE wt_public_invite
                    SET revoked_at = COALESCE(revoked_at, ?)
                    WHERE invite_id = ? AND public_room_id = ?
                    """)) {
                statement.setTimestamp(1, timestamp(now));
                statement.setObject(2, inviteId);
                statement.setObject(3, publicRoomId);
                statement.executeUpdate();
            }
            return true;
        });
    }

    @Override
    public boolean revokeMember(UUID publicRoomId, UUID memberAccountId, UUID actorAccountId, Instant now) {
        return transaction(connection -> {
            if (!isActiveOwner(connection, publicRoomId, actorAccountId, now)
                    || memberAccountId.equals(actorAccountId)) {
                return false;
            }
            try (PreparedStatement statement = connection.prepareStatement("""
                    UPDATE wt_public_room_membership
                    SET revoked_at = COALESCE(revoked_at, ?)
                    WHERE public_room_id = ? AND account_id = ? AND role = 'GUEST'
                    """)) {
                statement.setTimestamp(1, timestamp(now));
                statement.setObject(2, publicRoomId);
                statement.setObject(3, memberAccountId);
                statement.executeUpdate();
            }
            return true;
        });
    }

    @Override
    public void recordAudit(
            UUID publicRoomId, UUID actorAccountId, String action, UUID correlationId, Instant occurredAt) {
        execute(connection -> {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO wt_public_audit_event
                        (audit_id, public_room_id, actor_account_id, action, correlation_id, occurred_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """)) {
                statement.setObject(1, UUID.randomUUID());
                statement.setObject(2, publicRoomId);
                statement.setObject(3, actorAccountId);
                statement.setString(4, action);
                statement.setObject(5, correlationId);
                statement.setTimestamp(6, timestamp(occurredAt));
                statement.executeUpdate();
            }
            return null;
        });
    }

    private IdempotencyClaim claimIdempotency(
            Connection connection,
            UUID accountId,
            IdempotencyCommand command,
            UUID resultId,
            Instant now)
            throws SQLException {
        try (PreparedStatement prune = connection.prepareStatement("""
                DELETE FROM wt_public_idempotency
                WHERE account_id = ? AND operation = ? AND key_hash = ? AND expires_at <= ?
                """)) {
            prune.setObject(1, accountId);
            prune.setString(2, command.operation());
            prune.setString(3, command.keyFingerprint());
            prune.setTimestamp(4, timestamp(now));
            prune.executeUpdate();
        }
        try (PreparedStatement insert = connection.prepareStatement("""
                INSERT INTO wt_public_idempotency
                    (account_id, operation, key_hash, request_fingerprint, result_id, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (account_id, operation, key_hash) DO NOTHING
                """)) {
            insert.setObject(1, accountId);
            insert.setString(2, command.operation());
            insert.setString(3, command.keyFingerprint());
            insert.setString(4, command.requestFingerprint());
            insert.setObject(5, resultId);
            insert.setTimestamp(6, timestamp(now));
            insert.setTimestamp(7, timestamp(now.plus(IDEMPOTENCY_TTL)));
            if (insert.executeUpdate() == 1) {
                return new IdempotencyClaim(IdempotencyOutcome.CREATED, resultId);
            }
        }
        try (PreparedStatement existing = connection.prepareStatement("""
                SELECT request_fingerprint, result_id
                FROM wt_public_idempotency
                WHERE account_id = ? AND operation = ? AND key_hash = ?
                """)) {
            existing.setObject(1, accountId);
            existing.setString(2, command.operation());
            existing.setString(3, command.keyFingerprint());
            try (ResultSet result = existing.executeQuery()) {
                if (!result.next()
                        || !constantTimeEquals(
                                result.getString("request_fingerprint"), command.requestFingerprint())) {
                    return new IdempotencyClaim(IdempotencyOutcome.CONFLICT, null);
                }
                return new IdempotencyClaim(
                        IdempotencyOutcome.REPLAYED, result.getObject("result_id", UUID.class));
            }
        }
    }

    private void discardIdempotency(
            Connection connection, UUID accountId, IdempotencyCommand command) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                DELETE FROM wt_public_idempotency
                WHERE account_id = ? AND operation = ? AND key_hash = ?
                """)) {
            statement.setObject(1, accountId);
            statement.setString(2, command.operation());
            statement.setString(3, command.keyFingerprint());
            statement.executeUpdate();
        }
    }

    private Optional<PublicRoomAccess> idempotentRoomAccess(
            Connection connection, UUID publicRoomId, UUID accountId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT room.public_room_id, room.status, room.member_limit, room.created_at, room.expires_at,
                       membership.role, membership.joined_at
                FROM wt_public_room room
                JOIN wt_public_room_membership membership
                  ON membership.public_room_id = room.public_room_id
                WHERE room.public_room_id = ?
                  AND membership.account_id = ?
                """)) {
            statement.setObject(1, publicRoomId);
            statement.setObject(2, accountId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    return Optional.empty();
                }
                return Optional.of(new PublicRoomAccess(
                        new PublicRoom(
                                result.getObject("public_room_id", UUID.class),
                                PublicRoomStatus.valueOf(result.getString("status")),
                                result.getInt("member_limit"),
                                result.getTimestamp("created_at").toInstant(),
                                result.getTimestamp("expires_at").toInstant()),
                        new PublicRoomMembership(
                                PublicMembershipRole.valueOf(result.getString("role")),
                                result.getTimestamp("joined_at").toInstant())));
            }
        }
    }

    private Optional<StoredPublicInvite> storedInvite(Connection connection, UUID inviteId)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT invite_id, expires_at, max_redemptions, redemption_count
                FROM wt_public_invite WHERE invite_id = ?
                """)) {
            statement.setObject(1, inviteId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next()
                        ? Optional.of(new StoredPublicInvite(
                                result.getObject("invite_id", UUID.class),
                                result.getTimestamp("expires_at").toInstant(),
                                result.getInt("max_redemptions"),
                                result.getInt("redemption_count")))
                        : Optional.empty();
            }
        }
    }

    private Optional<StoredAccount> accountByEmail(Connection connection, String emailFingerprint)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT account_id, display_name, created_at
                FROM wt_public_account
                WHERE email_fingerprint = ?
                """)) {
            statement.setString(1, emailFingerprint);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(account(result)) : Optional.empty();
            }
        }
    }

    private Optional<PublicRoomAccess> roomAccess(
            Connection connection, UUID publicRoomId, UUID accountId, Instant now) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT room.public_room_id, room.status, room.member_limit, room.created_at, room.expires_at,
                       membership.role, membership.joined_at
                FROM wt_public_room room
                JOIN wt_public_room_membership membership
                  ON membership.public_room_id = room.public_room_id
                WHERE room.public_room_id = ?
                  AND room.status = 'OPEN'
                  AND room.expires_at > ?
                  AND membership.account_id = ?
                  AND membership.revoked_at IS NULL
                """)) {
            statement.setObject(1, publicRoomId);
            statement.setTimestamp(2, timestamp(now));
            statement.setObject(3, accountId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    return Optional.empty();
                }
                return Optional.of(new PublicRoomAccess(
                        new PublicRoom(
                                result.getObject("public_room_id", UUID.class),
                                PublicRoomStatus.valueOf(result.getString("status")),
                                result.getInt("member_limit"),
                                result.getTimestamp("created_at").toInstant(),
                                result.getTimestamp("expires_at").toInstant()),
                        new PublicRoomMembership(
                                PublicMembershipRole.valueOf(result.getString("role")),
                                result.getTimestamp("joined_at").toInstant())));
            }
        }
    }

    private InviteRow lockInvite(Connection connection, String tokenFingerprint) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT invite.invite_id, invite.public_room_id, invite.expires_at, invite.max_redemptions,
                       invite.redemption_count, invite.revoked_at, room.status, room.member_limit,
                       room.expires_at AS room_expires_at
                FROM wt_public_invite invite
                JOIN wt_public_room room ON room.public_room_id = invite.public_room_id
                WHERE invite.token_hash = ?
                FOR UPDATE OF invite, room
                """)) {
            statement.setString(1, tokenFingerprint);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    return null;
                }
                return new InviteRow(
                        result.getObject("invite_id", UUID.class),
                        result.getObject("public_room_id", UUID.class),
                        result.getTimestamp("expires_at").toInstant(),
                        result.getInt("max_redemptions"),
                        result.getInt("redemption_count"),
                        result.getTimestamp("revoked_at") == null
                                ? null
                                : result.getTimestamp("revoked_at").toInstant(),
                        PublicRoomStatus.valueOf(result.getString("status")),
                        result.getInt("member_limit"),
                        result.getTimestamp("room_expires_at").toInstant());
            }
        }
    }

    private int activeMembershipCount(Connection connection, UUID publicRoomId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT COUNT(*) FROM wt_public_room_membership
                WHERE public_room_id = ? AND revoked_at IS NULL
                """)) {
            statement.setObject(1, publicRoomId);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getInt(1);
            }
        }
    }

    private boolean isActiveOwner(Connection connection, UUID publicRoomId, UUID accountId, Instant now)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT 1
                FROM wt_public_room room
                JOIN wt_public_room_membership membership
                  ON membership.public_room_id = room.public_room_id
                WHERE room.public_room_id = ?
                  AND room.status = 'OPEN'
                  AND room.expires_at > ?
                  AND membership.account_id = ?
                  AND membership.role = 'OWNER'
                  AND membership.revoked_at IS NULL
                """)) {
            statement.setObject(1, publicRoomId);
            statement.setTimestamp(2, timestamp(now));
            statement.setObject(3, accountId);
            try (ResultSet result = statement.executeQuery()) {
                return result.next();
            }
        }
    }

    private StoredAccount account(ResultSet result) throws SQLException {
        return new StoredAccount(
                result.getObject("account_id", UUID.class),
                result.getString("display_name"),
                result.getTimestamp("created_at").toInstant());
    }

    private <T> T execute(SqlWork<T> work) {
        try (Connection connection = dataSource.getConnection()) {
            return work.execute(connection);
        } catch (SQLException exception) {
            throw new IllegalStateException("Public access persistence failed", exception);
        }
    }

    private <T> T transaction(SqlWork<T> work) {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                T result = work.execute(connection);
                connection.commit();
                return result;
            } catch (SQLException | RuntimeException exception) {
                connection.rollback();
                throw exception;
            }
        } catch (SQLException exception) {
            throw new IllegalStateException("Public access persistence failed", exception);
        }
    }

    private static Timestamp timestamp(Instant value) {
        return Timestamp.from(value);
    }

    private static boolean constantTimeEquals(String left, String right) {
        return left != null
                && right != null
                && MessageDigest.isEqual(
                        left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean isUniqueViolation(SQLException exception) {
        return "23505".equals(exception.getSQLState());
    }

    @FunctionalInterface
    private interface SqlWork<T> {
        T execute(Connection connection) throws SQLException;
    }

    private record InviteRow(
            UUID inviteId,
            UUID publicRoomId,
            Instant expiresAt,
            int maxRedemptions,
            int redemptionCount,
            Instant revokedAt,
            PublicRoomStatus status,
            int memberLimit,
            Instant roomExpiresAt) {}

    private record IdempotencyClaim(IdempotencyOutcome outcome, UUID resultId) {}
}
