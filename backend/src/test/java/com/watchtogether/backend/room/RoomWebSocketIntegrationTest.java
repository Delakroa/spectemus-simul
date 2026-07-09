package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.net.http.WebSocketHandshakeException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "management.health.redis.enabled=false",
            "watch-together.websocket.container-limits-enabled=true"
        })
class RoomWebSocketIntegrationTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String MISSING_ROOM_ID = "0000000000000000000000";
    private static final String SESSION = "A".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private RoomRealtimeStore store;

    private final AtomicReference<StoredRoom> currentRoom = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        currentRoom.set(room(2));
        when(store.authenticateAndLoad(anyString(), anyString())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            String sessionHash = invocation.getArgument(1);
            if (MISSING_ROOM_ID.equals(roomId)) {
                return AuthenticationResult.roomUnavailable();
            }
            if (!ROOM_ID.equals(roomId) || !SecureHash.sha256(SESSION).equals(sessionHash)) {
                return AuthenticationResult.authenticationRequired();
            }
            return AuthenticationResult.authenticated(currentRoom.get(), HOST_ID);
        });
    }

    @Test
    void sendsAuthoritativeSnapshotAsFirstMessage() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        JsonNode event = objectMapper.readTree(connection.listener().firstText());

        assertThat(event.get("schemaVersion").asInt()).isEqualTo(1);
        assertThat(event.get("eventId").stringValue()).matches(
                "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
        assertThat(event.get("type").stringValue()).isEqualTo("room.snapshot");
        assertThat(event.get("roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(event.get("participantId").isNull()).isTrue();
        assertThat(event.get("roomVersion").asLong()).isEqualTo(2);
        assertThat(event.get("occurredAt").stringValue()).isNotBlank();
        assertThat(event.at("/payload/roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(event.at("/payload/participants/0/participantId").stringValue())
                .isEqualTo(HOST_ID.toString());
        assertThat(event.at("/payload/roomVersion").asLong()).isEqualTo(2);

        connection.webSocket().sendClose(WebSocket.NORMAL_CLOSURE, "test complete").join();
    }

    @Test
    void sendsFreshSnapshotWithNewEventIdAfterReconnect() throws Exception {
        Connection first = connect(ROOM_ID, SESSION, null);
        JsonNode firstEvent = objectMapper.readTree(first.listener().firstText());
        first.webSocket().sendClose(WebSocket.NORMAL_CLOSURE, "reconnect").join();

        currentRoom.set(room(3));
        Connection second = connect(ROOM_ID, SESSION, null);
        JsonNode secondEvent = objectMapper.readTree(second.listener().firstText());

        assertThat(secondEvent.get("eventId").stringValue())
                .isNotEqualTo(firstEvent.get("eventId").stringValue());
        assertThat(secondEvent.get("roomVersion").asLong()).isEqualTo(3);
        assertThat(secondEvent.at("/payload/roomVersion").asLong()).isEqualTo(3);

        second.webSocket().sendClose(WebSocket.NORMAL_CLOSURE, "test complete").join();
    }

    @Test
    void rejectsMissingInvalidAndUnavailableSessionsBeforeUpgrade() {
        assertHandshakeStatus(ROOM_ID, null, null, 401);
        assertHandshakeStatus(ROOM_ID, "B".repeat(43), null, 401);
        assertHandshakeStatus(MISSING_ROOM_ID, SESSION, null, 404);
        assertHandshakeStatus(ROOM_ID, SESSION, "token=forbidden", 400);
    }

    @Test
    void closesUnknownClientCommandWithBadDataStatus() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        connection.listener().firstText();

        connection.webSocket().sendText(
                        """
                        {"schemaVersion":1,"type":"room.future.command"}
                        """,
                        true)
                .join();

        assertThat(connection.listener().closeCode()).isEqualTo(1007);
    }

    private void assertHandshakeStatus(
            String roomId, String sessionCredential, String query, int expectedStatus) {
        assertThatThrownBy(() -> connect(roomId, sessionCredential, query))
                .isInstanceOfSatisfying(CompletionException.class, exception -> {
                    assertThat(exception.getCause())
                            .isInstanceOfSatisfying(
                                    WebSocketHandshakeException.class,
                                    handshake -> assertThat(handshake.getResponse().statusCode())
                                            .isEqualTo(expectedStatus));
                });
    }

    private Connection connect(String roomId, String sessionCredential, String query) {
        RecordingListener listener = new RecordingListener();
        String suffix = query == null ? "" : "?" + query;
        var builder = HttpClient.newHttpClient()
                .newWebSocketBuilder()
                .header("Origin", "http://127.0.0.1:" + port);
        if (sessionCredential != null) {
            builder.header("Cookie", "wt_session=" + sessionCredential);
        }

        WebSocket webSocket = builder.buildAsync(
                        URI.create("ws://127.0.0.1:" + port + "/api/v1/rooms/" + roomId
                                + "/events" + suffix),
                        listener)
                .join();
        return new Connection(webSocket, listener);
    }

    private StoredRoom room(long roomVersion) {
        Instant now = Instant.parse("2026-07-09T10:00:00Z");
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                true,
                now,
                SecureHash.sha256(SESSION));
        return new StoredRoom(
                ROOM_ID,
                RoomStatus.CREATED,
                HOST_ID,
                List.of(host),
                roomVersion,
                now.plus(Duration.ofHours(4)),
                now.plusSeconds(roomVersion),
                SecureHash.sha256("H".repeat(43)));
    }

    private record Connection(WebSocket webSocket, RecordingListener listener) {}

    private static final class RecordingListener implements WebSocket.Listener {

        private final CompletableFuture<String> firstText = new CompletableFuture<>();
        private final CompletableFuture<Integer> closeCode = new CompletableFuture<>();
        private final StringBuilder text = new StringBuilder();

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(
                WebSocket webSocket, CharSequence data, boolean last) {
            text.append(data);
            if (last) {
                firstText.complete(text.toString());
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closeCode.complete(statusCode);
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            firstText.completeExceptionally(error);
            closeCode.completeExceptionally(error);
        }

        String firstText() throws Exception {
            return firstText.get(5, TimeUnit.SECONDS);
        }

        int closeCode() throws Exception {
            return closeCode.get(5, TimeUnit.SECONDS);
        }
    }
}
