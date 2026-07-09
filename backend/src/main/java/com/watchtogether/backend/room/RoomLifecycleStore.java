package com.watchtogether.backend.room;

import java.time.Instant;

import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;

interface RoomLifecycleStore {

    LifecycleResult closeByHost(
            String roomId, String sessionCredentialHash, String hostSecretHash, Instant closedAt);

    LifecycleResult expire(String roomId, Instant expiredAt);

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
}
