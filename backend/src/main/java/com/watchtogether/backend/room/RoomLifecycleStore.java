package com.watchtogether.backend.room;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomLifecycleStore {

    LifecycleResult closeByHost(
            String roomId, String sessionCredentialHash, String hostSecretHash, Instant closedAt);

    LifecycleResult expire(String roomId, Instant expiredAt);

    LeaveResult leave(String roomId, String sessionCredentialHash, Instant leftAt);

    HostPresenceResult markHostDisconnected(String roomId, Instant occurredAt);

    HostPresenceResult recoverHost(String roomId, Instant occurredAt);

    HostPresenceResult closeAbandonedRoom(String roomId, Instant closedAt);

    enum HostPresenceOutcome {
        CHANGED,
        UNCHANGED,
        ROOM_UNAVAILABLE
    }

    record HostPresenceResult(HostPresenceOutcome outcome, StoredRoom room) {

        static HostPresenceResult changed(StoredRoom room) {
            return new HostPresenceResult(HostPresenceOutcome.CHANGED, room);
        }

        static HostPresenceResult unchanged() {
            return new HostPresenceResult(HostPresenceOutcome.UNCHANGED, null);
        }

        static HostPresenceResult roomUnavailable() {
            return new HostPresenceResult(HostPresenceOutcome.ROOM_UNAVAILABLE, null);
        }

        boolean changed() {
            return outcome == HostPresenceOutcome.CHANGED;
        }
    }

    enum LifecycleOutcome {
        CLOSED,
        EXPIRED,
        ALREADY_CLOSED,
        ALREADY_EXPIRED,
        NOT_EXPIRED,
        ACCESS_DENIED,
        ROOM_UNAVAILABLE
    }

    record LifecycleResult(LifecycleOutcome outcome, StoredRoom room) {

        static LifecycleResult closed(StoredRoom room) {
            return new LifecycleResult(LifecycleOutcome.CLOSED, room);
        }

        static LifecycleResult expired(StoredRoom room) {
            return new LifecycleResult(LifecycleOutcome.EXPIRED, room);
        }

        static LifecycleResult alreadyClosed(StoredRoom room) {
            return new LifecycleResult(LifecycleOutcome.ALREADY_CLOSED, room);
        }

        static LifecycleResult alreadyExpired() {
            return new LifecycleResult(LifecycleOutcome.ALREADY_EXPIRED, null);
        }

        static LifecycleResult notExpired() {
            return new LifecycleResult(LifecycleOutcome.NOT_EXPIRED, null);
        }

        static LifecycleResult accessDenied() {
            return new LifecycleResult(LifecycleOutcome.ACCESS_DENIED, null);
        }

        static LifecycleResult roomUnavailable() {
            return new LifecycleResult(LifecycleOutcome.ROOM_UNAVAILABLE, null);
        }

        boolean changed() {
            return outcome == LifecycleOutcome.CLOSED || outcome == LifecycleOutcome.EXPIRED;
        }
    }

    enum LeaveOutcome {
        LEFT,
        HOST_CANNOT_LEAVE,
        AUTHENTICATION_REQUIRED,
        ROOM_UNAVAILABLE
    }

    record LeaveResult(LeaveOutcome outcome, StoredRoom room, UUID participantId) {

        static LeaveResult left(StoredRoom room, UUID participantId) {
            return new LeaveResult(LeaveOutcome.LEFT, room, participantId);
        }

        static LeaveResult hostCannotLeave() {
            return new LeaveResult(LeaveOutcome.HOST_CANNOT_LEAVE, null, null);
        }

        static LeaveResult authenticationRequired() {
            return new LeaveResult(LeaveOutcome.AUTHENTICATION_REQUIRED, null, null);
        }

        static LeaveResult roomUnavailable() {
            return new LeaveResult(LeaveOutcome.ROOM_UNAVAILABLE, null, null);
        }
    }
}
