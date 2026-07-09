package com.watchtogether.backend.room;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.CreateRoomResponse.Participant;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomJoinStore.JoinOutcome;
import com.watchtogether.backend.room.RoomJoinStore.JoinResult;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class RoomJoinService {

    private static final int MAX_PARTICIPANTS = 4;
    private static final Pattern ROOM_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final Pattern SESSION_CREDENTIAL_PATTERN =
            Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final RoomJoinStore store;
    private final SecureValueGenerator values;
    private final Clock clock;

    RoomJoinService(RoomJoinStore store, SecureValueGenerator values, Clock clock) {
        this.store = store;
        this.values = values;
        this.clock = clock;
    }

    JoinResponse join(String roomId, String requestedDisplayName, String sessionCredential) {
        if (!ROOM_ID_PATTERN.matcher(roomId).matches()) {
            throw roomUnavailable();
        }

        Instant now = Instant.now(clock);
        String displayName = requestedDisplayName.strip();
        String newSessionCredential = values.credential();
        StoredParticipant candidate = new StoredParticipant(
                values.participantId(),
                displayName,
                ParticipantRole.GUEST,
                true,
                now,
                SecureHash.sha256(newSessionCredential));
        String existingSessionHash = validSessionCredential(sessionCredential)
                ? SecureHash.sha256(sessionCredential)
                : "";

        JoinResult result =
                store.join(roomId, existingSessionHash, candidate, now, MAX_PARTICIPANTS);
        if (result.outcome() == JoinOutcome.ROOM_UNAVAILABLE) {
            throw roomUnavailable();
        }
        if (result.outcome() == JoinOutcome.ROOM_FULL) {
            throw ApiException.conflict(
                    "ROOM_FULL",
                    "Комната заполнена",
                    "В комнате уже находится максимально допустимое число участников.");
        }

        StoredParticipant participant = result.room().participants().stream()
                .filter(item -> item.participantId().equals(result.participantId()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Joined participant is absent from room state"));
        Participant responseParticipant = RoomResponseMapper.toParticipant(participant);
        JoinRoomResponse response = new JoinRoomResponse(
                responseParticipant, RoomResponseMapper.toSnapshot(result.room()));
        String responseSessionCredential =
                result.outcome() == JoinOutcome.REPLAYED ? sessionCredential : newSessionCredential;
        Duration remainingTtl = Duration.between(now, result.room().expiresAt());
        Duration cookieMaxAge = remainingTtl.isNegative() ? Duration.ZERO : remainingTtl;

        return new JoinResponse(response, responseSessionCredential, cookieMaxAge);
    }

    private boolean validSessionCredential(String sessionCredential) {
        return sessionCredential != null
                && SESSION_CREDENTIAL_PATTERN.matcher(sessionCredential).matches();
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

    record JoinResponse(
            JoinRoomResponse response, String sessionCredential, Duration cookieMaxAge) {}
}
