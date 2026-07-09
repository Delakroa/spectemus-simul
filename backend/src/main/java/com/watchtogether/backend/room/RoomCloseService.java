package com.watchtogether.backend.room;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleOutcome;
import com.watchtogether.backend.room.RoomLifecycleStore.LifecycleResult;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class RoomCloseService {

    private static final Pattern ROOM_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final Pattern SESSION_CREDENTIAL_PATTERN =
            Pattern.compile("^[A-Za-z0-9_-]{43}$");
    private static final Pattern HOST_SECRET_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{43,128}$");

    private final RoomLifecycleStore store;
    private final RoomEventPublisher events;
    private final Clock clock;

    RoomCloseService(RoomLifecycleStore store, RoomEventPublisher events, Clock clock) {
        this.store = store;
        this.events = events;
        this.clock = clock;
    }

    void close(String roomId, String sessionCredential, String hostSecret) {
        if (!ROOM_ID_PATTERN.matcher(roomId).matches()) {
            throw roomUnavailable();
        }
        if (sessionCredential == null
                || !SESSION_CREDENTIAL_PATTERN.matcher(sessionCredential).matches()) {
            throw authenticationRequired();
        }
        if (hostSecret == null || !HOST_SECRET_PATTERN.matcher(hostSecret).matches()) {
            throw accessDenied();
        }

        Instant closedAt = Instant.now(clock);
        LifecycleResult result = store.closeByHost(
                roomId,
                SecureHash.sha256(sessionCredential),
                SecureHash.sha256(hostSecret),
                closedAt);
        if (result.outcome() == LifecycleOutcome.ROOM_UNAVAILABLE) {
            throw roomUnavailable();
        }
        if (result.outcome() == LifecycleOutcome.ACCESS_DENIED) {
            throw accessDenied();
        }
        if (result.outcome() == LifecycleOutcome.CLOSED) {
            publishRoomClosed(result, closedAt);
        }
    }

    private void publishRoomClosed(LifecycleResult result, Instant closedAt) {
        try {
            events.publishRoomClosed(result.room(), RoomClosedReason.HOST_CLOSED, closedAt);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to publish room closed event", exception);
        }
    }

    private ApiException authenticationRequired() {
        return new ApiException(
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED",
                "Требуется session",
                "Session credential отсутствует или недействительна.",
                false,
                List.of());
    }

    private ApiException accessDenied() {
        return new ApiException(
                HttpStatus.FORBIDDEN,
                "ACCESS_DENIED",
                "Доступ запрещен",
                "Текущий участник не может закрыть эту комнату.",
                false,
                List.of());
    }

    private ApiException roomUnavailable() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "ROOM_UNAVAILABLE",
                "Комната недоступна",
                "Комната не найдена, закрыта или срок её действия истёк.",
                false,
                List.of());
    }
}
