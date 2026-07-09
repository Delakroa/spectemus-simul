package com.watchtogether.backend.room;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveOutcome;
import com.watchtogether.backend.room.RoomLifecycleStore.LeaveResult;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class RoomLeaveService {

    private static final Pattern ROOM_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final Pattern SESSION_CREDENTIAL_PATTERN =
            Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final RoomLifecycleStore store;
    private final RoomEventPublisher events;
    private final Clock clock;

    RoomLeaveService(RoomLifecycleStore store, RoomEventPublisher events, Clock clock) {
        this.store = store;
        this.events = events;
        this.clock = clock;
    }

    void leave(String roomId, String sessionCredential) {
        if (!ROOM_ID_PATTERN.matcher(roomId).matches()) {
            throw roomUnavailable();
        }
        if (sessionCredential == null
                || !SESSION_CREDENTIAL_PATTERN.matcher(sessionCredential).matches()) {
            throw authenticationRequired();
        }

        Instant leftAt = Instant.now(clock);
        LeaveResult result = store.leave(roomId, SecureHash.sha256(sessionCredential), leftAt);
        if (result.outcome() == LeaveOutcome.ROOM_UNAVAILABLE) {
            throw roomUnavailable();
        }
        if (result.outcome() == LeaveOutcome.AUTHENTICATION_REQUIRED) {
            throw authenticationRequired();
        }
        if (result.outcome() == LeaveOutcome.HOST_CANNOT_LEAVE) {
            throw accessDenied();
        }

        publishParticipantLeft(result, leftAt);
    }

    private void publishParticipantLeft(LeaveResult result, Instant leftAt) {
        try {
            events.publishParticipantLeft(
                    result.room(), result.participantId(), ParticipantLeftReason.LEFT, leftAt);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to publish participant left event", exception);
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
                "Host должен закрывать комнату через close, а не leave.",
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
