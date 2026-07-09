package com.watchtogether.backend.room;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.api.ApiFieldViolation;
import com.watchtogether.backend.room.RoomCreationStore.SaveOutcome;
import com.watchtogether.backend.room.RoomCreationStore.SaveResult;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoomCreation;

import org.springframework.stereotype.Service;

@Service
class RoomCreationService {

    private static final int MAX_ROOM_ID_ATTEMPTS = 5;
    private final RoomCreationStore store;
    private final SecureValueGenerator values;
    private final RoomProperties properties;
    private final Clock clock;

    RoomCreationService(
            RoomCreationStore store,
            SecureValueGenerator values,
            RoomProperties properties,
            Clock clock) {
        this.store = store;
        this.values = values;
        this.properties = properties;
        this.clock = clock;
    }

    CreationResult create(String idempotencyKey, String requestedHostDisplayName) {
        validateIdempotencyKey(idempotencyKey);

        String hostDisplayName = requestedHostDisplayName.strip();
        String idempotencyKeyHash = SecureHash.sha256(idempotencyKey);
        String requestFingerprint = SecureHash.sha256("create-room:v1\0" + hostDisplayName);

        for (int attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt++) {
            StoredRoomCreation candidate = newCandidate(requestFingerprint, hostDisplayName);
            SaveResult result = store.saveOrGet(
                    idempotencyKeyHash,
                    candidate,
                    properties.storageTtl(),
                    properties.ttl());

            if (result.outcome() == SaveOutcome.ROOM_ID_COLLISION) {
                continue;
            }

            StoredRoomCreation saved = result.creation();
            if (!MessageDigest.isEqual(
                    saved.requestFingerprint().getBytes(StandardCharsets.UTF_8),
                    requestFingerprint.getBytes(StandardCharsets.UTF_8))) {
                throw ApiException.conflict(
                        "IDEMPOTENCY_CONFLICT",
                        "Конфликт idempotency key",
                        "Этот Idempotency-Key уже использован с другим запросом.");
            }

            return toResult(saved);
        }

        throw new IllegalStateException("Unable to allocate a unique room ID");
    }

    private StoredRoomCreation newCandidate(String requestFingerprint, String hostDisplayName) {
        Instant now = Instant.now(clock);
        Instant expiresAt = now.plus(properties.ttl());
        String hostSecret = values.credential();
        String sessionCredential = values.credential();
        var hostParticipantId = values.participantId();

        StoredParticipant host = new StoredParticipant(
                hostParticipantId,
                hostDisplayName,
                ParticipantRole.HOST,
                true,
                now,
                SecureHash.sha256(sessionCredential));
        StoredRoom room = new StoredRoom(
                values.roomId(),
                RoomStatus.CREATED,
                hostParticipantId,
                java.util.List.of(host),
                0,
                expiresAt,
                now,
                SecureHash.sha256(hostSecret));

        return new StoredRoomCreation(requestFingerprint, room, hostSecret, sessionCredential);
    }

    private CreationResult toResult(StoredRoomCreation creation) {
        StoredRoom room = creation.room();
        CreateRoomResponse response = new CreateRoomResponse(
                RoomResponseMapper.toSnapshot(room),
                creation.hostSecret(),
                "/rooms/" + room.roomId());
        Duration remainingTtl = Duration.between(Instant.now(clock), room.expiresAt());
        Duration cookieMaxAge = remainingTtl.isNegative() ? Duration.ZERO : remainingTtl;

        return new CreationResult(response, creation.sessionCredential(), cookieMaxAge);
    }

    private void validateIdempotencyKey(String idempotencyKey) {
        if (idempotencyKey.length() < 16
                || idempotencyKey.length() > 128
                || !idempotencyKey.matches("^[\\x21-\\x7E]+$")) {
            throw ApiException.validation(new ApiFieldViolation(
                    "Idempotency-Key",
                    "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key должен содержать от 16 до 128 видимых ASCII-символов."));
        }
    }

    record CreationResult(
            CreateRoomResponse response, String sessionCredential, Duration cookieMaxAge) {}
}
