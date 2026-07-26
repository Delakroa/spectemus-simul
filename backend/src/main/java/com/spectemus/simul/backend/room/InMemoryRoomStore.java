package com.spectemus.simul.backend.room;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.spectemus.simul.backend.room.RoomCreationStore.StoredParticipant;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredRoom;
import com.spectemus.simul.backend.room.RoomCreationStore.StoredRoomCreation;
import com.spectemus.simul.backend.room.RoomLifecycleStore.HostPresenceResult;
import com.spectemus.simul.backend.room.RoomLifecycleStore.LeaveResult;
import com.spectemus.simul.backend.room.RoomLifecycleStore.LifecycleResult;
import com.spectemus.simul.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.spectemus.simul.backend.room.RoomRealtimeStore.PresenceResult;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Repository;

/**
 * Atomic JVM-local implementation for one desktop host. Every read-modify-write
 * operation shares one monitor, which is sufficient because desktop mode runs
 * exactly one backend process. The Redis implementations remain authoritative
 * for Docker and multi-instance deployments.
 */
@Repository
@Profile("desktop")
class InMemoryRoomStore
        implements RoomCreationStore, RoomJoinStore, RoomLifecycleStore, RoomRealtimeStore {

    private static final Set<RoomStatus> AVAILABLE = EnumSet.of(
            RoomStatus.CREATED,
            RoomStatus.WAITING_FOR_HOST,
            RoomStatus.READY,
            RoomStatus.PLAYING,
            RoomStatus.PAUSED,
            RoomStatus.HOST_DISCONNECTED);
    private static final Set<RoomStatus> ACTIVE = EnumSet.of(
            RoomStatus.CREATED, RoomStatus.WAITING_FOR_HOST, RoomStatus.READY,
            RoomStatus.PLAYING, RoomStatus.PAUSED);

    private final Clock clock;
    private final Map<String, StoredRoom> rooms = new HashMap<>();
    private final Map<String, Instant> roomStorageExpiresAt = new HashMap<>();
    private final Map<String, IdempotencyEntry> idempotency = new HashMap<>();
    private final Map<PresenceKey, PresenceEntry> presences = new HashMap<>();

    InMemoryRoomStore(Clock clock) {
        this.clock = clock;
    }

    @Override
    public synchronized SaveResult saveOrGet(
            String idempotencyKeyHash,
            StoredRoomCreation candidate,
            Duration roomStorageTtl,
            Duration idempotencyTtl) {
        Instant now = candidate.room().updatedAt();
        pruneRooms(now);
        pruneIdempotency(now);
        IdempotencyEntry existing = idempotency.get(idempotencyKeyHash);
        if (existing != null) {
            return SaveResult.replayed(existing.creation());
        }
        if (rooms.containsKey(candidate.room().roomId())) {
            return SaveResult.roomIdCollision();
        }
        rooms.put(candidate.room().roomId(), candidate.room());
        roomStorageExpiresAt.put(candidate.room().roomId(), now.plus(roomStorageTtl));
        idempotency.put(
                idempotencyKeyHash,
                new IdempotencyEntry(candidate, now.plus(idempotencyTtl)));
        return SaveResult.created(candidate);
    }

    @Override
    public synchronized JoinResult join(
            String roomId,
            String sessionCredentialHash,
            StoredParticipant candidate,
            Instant updatedAt,
            int maxParticipants) {
        pruneRooms(updatedAt);
        StoredRoom room = available(roomId, updatedAt);
        if (room == null) {
            return JoinResult.roomUnavailable();
        }
        for (StoredParticipant participant : room.participants()) {
            if (constantTimeEquals(participant.sessionCredentialHash(), sessionCredentialHash)) {
                return JoinResult.replayed(room, participant.participantId());
            }
        }
        if (room.participants().size() >= maxParticipants) {
            return JoinResult.roomFull();
        }
        List<StoredParticipant> participants = new ArrayList<>(room.participants());
        participants.add(candidate);
        StoredRoom updated = copy(room, room.status(), participants, updatedAt, null);
        rooms.put(roomId, updated);
        return JoinResult.joined(updated, candidate.participantId());
    }

    @Override
    public synchronized LifecycleResult closeByHost(
            String roomId, String credentialHash, String hostSecretHash, Instant closedAt) {
        pruneRooms(closedAt);
        StoredRoom room = rooms.get(roomId);
        if (room == null || room.status() == RoomStatus.EXPIRED || !room.expiresAt().isAfter(closedAt)) {
            return LifecycleResult.roomUnavailable();
        }
        StoredParticipant host = participant(room, room.hostParticipantId());
        if (host == null
                || !constantTimeEquals(host.sessionCredentialHash(), credentialHash)
                || !constantTimeEquals(room.hostSecretHash(), hostSecretHash)) {
            return LifecycleResult.accessDenied();
        }
        if (room.status() == RoomStatus.CLOSED) {
            return LifecycleResult.alreadyClosed(room);
        }
        if (!AVAILABLE.contains(room.status())) {
            return LifecycleResult.roomUnavailable();
        }
        StoredRoom closed = close(room, RoomStatus.CLOSED, closedAt);
        return LifecycleResult.closed(closed);
    }

    @Override
    public synchronized LifecycleResult expire(String roomId, Instant expiredAt) {
        pruneRooms(expiredAt);
        StoredRoom room = rooms.get(roomId);
        if (room == null) {
            return LifecycleResult.roomUnavailable();
        }
        if (room.status() == RoomStatus.CLOSED) {
            return LifecycleResult.alreadyClosed(room);
        }
        if (room.status() == RoomStatus.EXPIRED) {
            return LifecycleResult.alreadyExpired();
        }
        if (room.expiresAt().isAfter(expiredAt)) {
            return LifecycleResult.notExpired();
        }
        if (!AVAILABLE.contains(room.status())) {
            return LifecycleResult.roomUnavailable();
        }
        return LifecycleResult.expired(close(room, RoomStatus.EXPIRED, expiredAt));
    }

    @Override
    public synchronized LeaveResult leave(String roomId, String credentialHash, Instant leftAt) {
        pruneRooms(leftAt);
        StoredRoom room = available(roomId, leftAt);
        if (room == null) {
            return LeaveResult.roomUnavailable();
        }
        StoredParticipant leaving = room.participants().stream()
                .filter(item -> constantTimeEquals(item.sessionCredentialHash(), credentialHash))
                .findFirst()
                .orElse(null);
        if (leaving == null) {
            return LeaveResult.authenticationRequired();
        }
        if (leaving.participantId().equals(room.hostParticipantId())) {
            return LeaveResult.hostCannotLeave();
        }
        List<StoredParticipant> participants = room.participants().stream()
                .filter(item -> !item.participantId().equals(leaving.participantId()))
                .toList();
        clearPresence(roomId, leaving.participantId());
        StoredRoom updated = copy(room, room.status(), participants, leftAt, null);
        rooms.put(roomId, updated);
        return LeaveResult.left(updated, leaving.participantId());
    }

    @Override
    public synchronized HostPresenceResult markHostDisconnected(String roomId, Instant occurredAt) {
        pruneRooms(occurredAt);
        StoredRoom room = rooms.get(roomId);
        if (room == null) {
            return HostPresenceResult.roomUnavailable();
        }
        if (!ACTIVE.contains(room.status())) {
            return HostPresenceResult.unchanged();
        }
        StoredRoom updated = copy(room, RoomStatus.HOST_DISCONNECTED, room.participants(), occurredAt, room.status());
        rooms.put(roomId, updated);
        return HostPresenceResult.changed(updated);
    }

    @Override
    public synchronized HostPresenceResult recoverHost(String roomId, Instant occurredAt) {
        pruneRooms(occurredAt);
        StoredRoom room = rooms.get(roomId);
        if (room == null) {
            return HostPresenceResult.roomUnavailable();
        }
        if (room.status() != RoomStatus.HOST_DISCONNECTED) {
            return HostPresenceResult.unchanged();
        }
        RoomStatus restored = room.statusBeforeHostDisconnect();
        if (restored == null || !ACTIVE.contains(restored)) {
            restored = RoomStatus.CREATED;
        }
        StoredRoom updated = copy(room, restored, room.participants(), occurredAt, null);
        rooms.put(roomId, updated);
        return HostPresenceResult.changed(updated);
    }

    @Override
    public synchronized HostPresenceResult closeAbandonedRoom(String roomId, Instant closedAt) {
        pruneRooms(closedAt);
        StoredRoom room = rooms.get(roomId);
        if (room == null) {
            return HostPresenceResult.roomUnavailable();
        }
        if (room.status() != RoomStatus.HOST_DISCONNECTED) {
            return HostPresenceResult.unchanged();
        }
        return HostPresenceResult.changed(close(room, RoomStatus.CLOSED, closedAt));
    }

    @Override
    public synchronized AuthenticationResult authenticateAndLoad(String roomId, String credentialHash) {
        Instant now = Instant.now(clock);
        pruneRooms(now);
        StoredRoom room = available(roomId, now);
        if (room == null) {
            return AuthenticationResult.roomUnavailable();
        }
        return room.participants().stream()
                .filter(item -> constantTimeEquals(item.sessionCredentialHash(), credentialHash))
                .findFirst()
                .map(item -> AuthenticationResult.authenticated(room, item.participantId()))
                .orElseGet(AuthenticationResult::authenticationRequired);
    }

    @Override
    public synchronized PresenceResult connect(
            String roomId, String credentialHash, UUID participantId, UUID connectionId,
            Instant connectedAt, Duration presenceTtl) {
        return markOnline(roomId, credentialHash, participantId, connectionId, connectedAt, presenceTtl, false);
    }

    @Override
    public synchronized PresenceResult heartbeat(
            String roomId, String credentialHash, UUID participantId, UUID connectionId,
            Instant heartbeatAt, Duration presenceTtl) {
        return markOnline(roomId, credentialHash, participantId, connectionId, heartbeatAt, presenceTtl, true);
    }

    @Override
    public synchronized PresenceResult disconnect(
            String roomId, String credentialHash, UUID participantId, UUID connectionId,
            Instant disconnectedAt) {
        pruneRooms(disconnectedAt);
        PresenceKey key = new PresenceKey(roomId, participantId);
        PresenceEntry presence = currentPresence(key, disconnectedAt);
        if (presence != null && !presence.connectionId().equals(connectionId)) {
            return PresenceResult.staleConnection();
        }
        StoredRoom room = rooms.get(roomId);
        StoredParticipant participant = room == null ? null : participant(room, participantId);
        if (participant == null || !constantTimeEquals(participant.sessionCredentialHash(), credentialHash)) {
            return room == null ? PresenceResult.roomUnavailable() : PresenceResult.authenticationRequired();
        }
        presences.remove(key);
        if (!participant.online()) {
            return PresenceResult.unchanged(room, participantId);
        }
        StoredRoom updated = withOnline(room, participantId, false, disconnectedAt);
        return PresenceResult.offline(updated, participantId);
    }

    private PresenceResult markOnline(
            String roomId, String credentialHash, UUID participantId, UUID connectionId,
            Instant changedAt, Duration ttl, boolean heartbeat) {
        pruneRooms(changedAt);
        StoredRoom room = available(roomId, changedAt);
        if (room == null) {
            return PresenceResult.roomUnavailable();
        }
        StoredParticipant participant = participant(room, participantId);
        if (participant == null || !constantTimeEquals(participant.sessionCredentialHash(), credentialHash)) {
            return PresenceResult.authenticationRequired();
        }
        PresenceKey key = new PresenceKey(roomId, participantId);
        PresenceEntry active = currentPresence(key, changedAt);
        if (heartbeat && active != null && !active.connectionId().equals(connectionId)) {
            return PresenceResult.staleConnection();
        }
        presences.put(key, new PresenceEntry(connectionId, changedAt.plus(ttl)));
        if (participant.online()) {
            return PresenceResult.unchanged(room, participantId);
        }
        StoredRoom updated = withOnline(room, participantId, true, changedAt);
        return PresenceResult.online(updated, participantId);
    }

    private StoredRoom available(String roomId, Instant now) {
        StoredRoom room = rooms.get(roomId);
        return room != null && AVAILABLE.contains(room.status()) && room.expiresAt().isAfter(now) ? room : null;
    }

    private StoredRoom close(StoredRoom room, RoomStatus status, Instant at) {
        List<StoredParticipant> offline = room.participants().stream()
                .map(item -> new StoredParticipant(
                        item.participantId(), item.displayName(), item.role(), false,
                        item.joinedAt(), item.sessionCredentialHash()))
                .toList();
        clearPresence(room.roomId());
        StoredRoom updated = copy(room, status, offline, at, null);
        rooms.put(room.roomId(), updated);
        return updated;
    }

    private StoredRoom withOnline(StoredRoom room, UUID participantId, boolean online, Instant at) {
        List<StoredParticipant> participants = room.participants().stream()
                .map(item -> item.participantId().equals(participantId)
                        ? new StoredParticipant(item.participantId(), item.displayName(), item.role(),
                                online, item.joinedAt(), item.sessionCredentialHash())
                        : item)
                .toList();
        StoredRoom updated = copy(room, room.status(), participants, at, room.statusBeforeHostDisconnect());
        rooms.put(room.roomId(), updated);
        return updated;
    }

    private StoredRoom copy(
            StoredRoom room, RoomStatus status, List<StoredParticipant> participants,
            Instant updatedAt, RoomStatus previousStatus) {
        return new StoredRoom(
                room.roomId(), status, room.hostParticipantId(), participants, room.roomVersion() + 1,
                room.expiresAt(), updatedAt, room.hostSecretHash(), previousStatus);
    }

    private StoredParticipant participant(StoredRoom room, UUID id) {
        return room.participants().stream().filter(item -> item.participantId().equals(id)).findFirst().orElse(null);
    }

    private PresenceEntry currentPresence(PresenceKey key, Instant now) {
        PresenceEntry entry = presences.get(key);
        if (entry != null && !entry.expiresAt().isAfter(now)) {
            presences.remove(key);
            return null;
        }
        return entry;
    }

    private void clearPresence(String roomId) {
        presences.keySet().removeIf(key -> key.roomId().equals(roomId));
    }

    private void clearPresence(String roomId, UUID participantId) {
        presences.remove(new PresenceKey(roomId, participantId));
    }

    private void pruneIdempotency(Instant now) {
        idempotency.entrySet().removeIf(entry -> !entry.getValue().expiresAt().isAfter(now));
    }

    private void pruneRooms(Instant now) {
        roomStorageExpiresAt.entrySet().removeIf(entry -> {
            if (entry.getValue().isAfter(now)) {
                return false;
            }
            rooms.remove(entry.getKey());
            clearPresence(entry.getKey());
            return true;
        });
    }

    private boolean constantTimeEquals(String expected, String actual) {
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8));
    }

    private record IdempotencyEntry(StoredRoomCreation creation, Instant expiresAt) {}
    private record PresenceKey(String roomId, UUID participantId) {}
    private record PresenceEntry(UUID connectionId, Instant expiresAt) {}
}
