package com.watchtogether.backend.room;

import java.net.URI;
import java.net.URISyntaxException;
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

    LiveKitTokenResponse mint(String roomId, String sessionCredential, String requestHost) {
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
        // Guests send the recovery request through LiveKit data packets; the client accepts only
        // the validated recovery schema and the recipient is still constrained to this room.
        boolean canPublishData = true;
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
                resolveLiveKitUrl(requestHost),
                result.room().roomId(),
                participant.participantId(),
                participantIdentity,
                participant.role(),
                canPublish,
                canPublishData,
                expiresAt);
    }

    private String resolveLiveKitUrl(String requestHost) {
        if (!properties.urlFromRequest()) {
            return properties.url();
        }

        try {
            URI configuredUrl = URI.create(properties.url());
            URI requestUrl = URI.create("http://" + requestHost);
            String requestHostname = requestUrl.getHost();

            if (!isPrivateIpv4(requestHostname)) {
                return properties.url();
            }

            return new URI(
                            configuredUrl.getScheme(),
                            configuredUrl.getUserInfo(),
                            requestHostname,
                            configuredUrl.getPort(),
                            configuredUrl.getPath(),
                            configuredUrl.getQuery(),
                            configuredUrl.getFragment())
                    .toString();
        } catch (IllegalArgumentException | URISyntaxException ignored) {
            return properties.url();
        }
    }

    private boolean isPrivateIpv4(String host) {
        if (host == null) {
            return false;
        }

        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) {
            return false;
        }

        int[] octets = new int[4];
        for (int index = 0; index < parts.length; index += 1) {
            try {
                octets[index] = Integer.parseInt(parts[index]);
            } catch (NumberFormatException ignored) {
                return false;
            }

            if (octets[index] < 0 || octets[index] > 255) {
                return false;
            }
        }

        return octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168);
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
