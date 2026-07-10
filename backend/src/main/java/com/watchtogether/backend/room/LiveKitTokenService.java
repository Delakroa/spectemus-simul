package com.watchtogether.backend.room;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
class LiveKitTokenService {

    private static final Pattern ROOM_ID_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final Pattern SESSION_CREDENTIAL_PATTERN =
            Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final RoomRealtimeStore store;
    private final LiveKitTokenSigner signer;
    private final LiveKitProperties properties;
    private final Clock clock;

    LiveKitTokenService(
            RoomRealtimeStore store,
            LiveKitTokenSigner signer,
            LiveKitProperties properties,
            Clock clock) {
        this.store = store;
        this.signer = signer;
        this.properties = properties;
        this.clock = clock;
    }

    LiveKitTokenResponse mint(String roomId, String sessionCredential) {
        if (!ROOM_ID_PATTERN.matcher(roomId).matches()) {
            throw roomUnavailable();
        }
        if (sessionCredential == null
                || !SESSION_CREDENTIAL_PATTERN.matcher(sessionCredential).matches()) {
            throw authenticationRequired();
        }

        AuthenticationResult result =
                store.authenticateAndLoad(roomId, SecureHash.sha256(sessionCredential));
        if (result.outcome() == AuthenticationOutcome.ROOM_UNAVAILABLE) {
            throw roomUnavailable();
        }
        if (result.outcome() == AuthenticationOutcome.AUTHENTICATION_REQUIRED) {
            throw authenticationRequired();
        }

        StoredParticipant participant = result.room().participants().stream()
                .filter(item -> item.participantId().equals(result.participantId()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Authenticated participant is absent from room state"));

        boolean host = participant.role() == ParticipantRole.HOST;
        boolean canPublish = true;
        boolean canPublishData = host;
        String participantIdentity = participant.participantId().toString();
        Instant issuedAt = clock.instant();
        Instant expiresAt = issuedAt.plus(properties.tokenTtl());
        String token = signer.sign(
                properties,
                result.room().roomId(),
                participantIdentity,
                participant.displayName(),
                canPublish,
                canPublishData,
                issuedAt,
                expiresAt);

        return new LiveKitTokenResponse(
                token,
                properties.url(),
                result.room().roomId(),
                participant.participantId(),
                participantIdentity,
                participant.role(),
                canPublish,
                canPublishData,
                expiresAt);
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
