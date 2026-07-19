package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class LiveKitTokenServiceTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String SESSION = "A".repeat(43);
    private static final String API_SECRET = "test-secret-test-secret-test-secret";
    private static final Instant NOW = Instant.parse("2026-07-09T10:00:00Z");
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    private final LiveKitProperties properties = new LiveKitProperties(
            "ws://127.0.0.1:7880",
            false,
            "devkey",
            API_SECRET,
            Duration.ofMinutes(10));

    @Test
    void mintsHostTokenWithPublishAndDataGrants() throws Exception {
        FakeRealtimeStore store =
                new FakeRealtimeStore(AuthenticationResult.authenticated(room(), HOST_ID));
        LiveKitTokenService service = service(store);

        LiveKitTokenResponse response = service.mint(ROOM_ID, SESSION, null);

        String payload = payload(response.token());
        assertThat(response.liveKitUrl()).isEqualTo("ws://127.0.0.1:7880");
        assertThat(response.roomName()).isEqualTo(ROOM_ID);
        assertThat(response.participantId()).isEqualTo(HOST_ID);
        assertThat(response.participantIdentity()).isEqualTo(HOST_ID.toString());
        assertThat(response.role()).isEqualTo(ParticipantRole.HOST);
        assertThat(response.canPublish()).isTrue();
        assertThat(response.canPublishData()).isTrue();
        assertThat(response.expiresAt()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
        assertThat(store.sessionCredentialHash).isEqualTo(SecureHash.sha256(SESSION));
        assertThat(payload)
                .contains("\"iss\":\"devkey\"")
                .contains("\"sub\":\"" + HOST_ID + "\"")
                .contains("\"name\":\"Host\"")
                .contains("\"iat\":" + NOW.getEpochSecond())
                .contains("\"exp\":" + NOW.plus(Duration.ofMinutes(10)).getEpochSecond())
                .contains("\"room\":\"" + ROOM_ID + "\"")
                .contains("\"roomJoin\":true")
                .contains("\"canSubscribe\":true")
                .contains("\"canPublish\":true")
                .contains("\"canPublishData\":true");
        assertValidSignature(response.token());
    }

    @Test
    void mintsGuestTokenWithVoiceAndRecoveryDataGrants() throws Exception {
        LiveKitTokenService service =
                service(new FakeRealtimeStore(AuthenticationResult.authenticated(room(), GUEST_ID)));

        LiveKitTokenResponse response = service.mint(ROOM_ID, SESSION, null);
        String payload = payload(response.token());

        assertThat(response.role()).isEqualTo(ParticipantRole.GUEST);
        assertThat(response.canPublish()).isTrue();
        assertThat(response.canPublishData()).isTrue();
        assertThat(payload)
                .contains("\"sub\":\"" + GUEST_ID + "\"")
                .contains("\"name\":\"Guest\"")
                .contains("\"canSubscribe\":true")
                .contains("\"canPublish\":true")
                .contains("\"canPublishData\":true");
        assertValidSignature(response.token());
    }

    @Test
    void rejectsMissingOrInvalidSession() {
        LiveKitTokenService service =
                service(new FakeRealtimeStore(AuthenticationResult.authenticated(room(), HOST_ID)));

        assertApiException(
                () -> service.mint(ROOM_ID, null, null),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
        assertApiException(
                () -> service.mint(ROOM_ID, "bad-session", null),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
    }

    @Test
    void hidesInvalidOrUnavailableRoom() {
        LiveKitTokenService invalidRoomService =
                service(new FakeRealtimeStore(AuthenticationResult.authenticated(room(), HOST_ID)));
        LiveKitTokenService unavailableRoomService =
                service(new FakeRealtimeStore(AuthenticationResult.roomUnavailable()));

        assertApiException(
                () -> invalidRoomService.mint("invalid", SESSION, null),
                HttpStatus.NOT_FOUND,
                "ROOM_UNAVAILABLE");
        assertApiException(
                () -> unavailableRoomService.mint(ROOM_ID, SESSION, null),
                HttpStatus.NOT_FOUND,
                "ROOM_UNAVAILABLE");
    }

    @Test
    void rejectsSessionThatDoesNotBelongToRoom() {
        LiveKitTokenService service =
                service(new FakeRealtimeStore(AuthenticationResult.authenticationRequired()));

        assertApiException(
                () -> service.mint(ROOM_ID, SESSION, null),
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED");
    }

    @Test
    void derivesLiveKitUrlFromPrivateLanRequestHostWhenEnabled() {
        LiveKitProperties lanProperties = new LiveKitProperties(
                "ws://192.168.1.42:7880",
                true,
                "devkey",
                API_SECRET,
                Duration.ofMinutes(10));
        LiveKitTokenService service = new LiveKitTokenService(
                new FakeRealtimeStore(AuthenticationResult.authenticated(room(), HOST_ID)),
                new LiveKitTokenSigner(),
                lanProperties,
                Clock.fixed(NOW, ZoneOffset.UTC));

        LiveKitTokenResponse response = service.mint(ROOM_ID, SESSION, "192.168.1.146:8088");

        assertThat(response.liveKitUrl()).isEqualTo("ws://192.168.1.146:7880");
    }

    @Test
    void keepsConfiguredLiveKitUrlForLoopbackOrPublicRequestHost() {
        LiveKitProperties lanProperties = new LiveKitProperties(
                "ws://192.168.1.42:7880",
                true,
                "devkey",
                API_SECRET,
                Duration.ofMinutes(10));
        LiveKitTokenService service = new LiveKitTokenService(
                new FakeRealtimeStore(AuthenticationResult.authenticated(room(), HOST_ID)),
                new LiveKitTokenSigner(),
                lanProperties,
                Clock.fixed(NOW, ZoneOffset.UTC));

        assertThat(service.mint(ROOM_ID, SESSION, "localhost:8088").liveKitUrl())
                .isEqualTo("ws://192.168.1.42:7880");
        assertThat(service.mint(ROOM_ID, SESSION, "203.0.113.10:8088").liveKitUrl())
                .isEqualTo("ws://192.168.1.42:7880");
    }

    private LiveKitTokenService service(FakeRealtimeStore store) {
        return new LiveKitTokenService(
                store,
                new LiveKitTokenSigner(),
                properties,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private String payload(String token) {
        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        return new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
    }

    private void assertValidSignature(String token) throws Exception {
        String[] parts = token.split("\\.");
        assertThat(parts).hasSize(3);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(API_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String expectedSignature = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal((parts[0] + "." + parts[1])
                        .getBytes(StandardCharsets.UTF_8)));
        assertThat(parts[2]).isEqualTo(expectedSignature);
    }

    private void assertApiException(
            org.assertj.core.api.ThrowableAssert.ThrowingCallable call,
            HttpStatus status,
            String code) {
        assertThatThrownBy(call)
                .isInstanceOf(ApiException.class)
                .satisfies(error -> {
                    ApiException exception = (ApiException) error;
                    assertThat(exception.status()).isEqualTo(status);
                    assertThat(exception.code()).isEqualTo(code);
                });
    }

    private StoredRoom room() {
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.READY,
                HOST_ID,
                List.of(
                        new StoredParticipant(
                                HOST_ID,
                                "Host",
                                ParticipantRole.HOST,
                                true,
                                NOW.minusSeconds(60),
                                "host-session-hash"),
                        new StoredParticipant(
                                GUEST_ID,
                                "Guest",
                                ParticipantRole.GUEST,
                                true,
                                NOW,
                                SecureHash.sha256(SESSION))),
                3,
                NOW.plus(Duration.ofHours(4)),
                NOW,
                "host-secret-hash");
    }

    private static final class FakeRealtimeStore implements RoomRealtimeStore {

        private final AuthenticationResult result;
        private String sessionCredentialHash;

        private FakeRealtimeStore(AuthenticationResult result) {
            this.result = result;
        }

        @Override
        public AuthenticationResult authenticateAndLoad(String roomId, String sessionCredentialHash) {
            this.sessionCredentialHash = sessionCredentialHash;
            return result;
        }

        @Override
        public PresenceResult connect(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant connectedAt,
                Duration presenceTtl) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PresenceResult heartbeat(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant heartbeatAt,
                Duration presenceTtl) {
            throw new UnsupportedOperationException();
        }

        @Override
        public PresenceResult disconnect(
                String roomId,
                String sessionCredentialHash,
                UUID participantId,
                UUID connectionId,
                Instant disconnectedAt) {
            throw new UnsupportedOperationException();
        }
    }
}
