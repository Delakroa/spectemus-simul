package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
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
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import com.watchtogether.backend.room.RoomCreationStore.StoredParticipant;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomLifecycleStore.HostPresenceResult;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;

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
            "watch-together.websocket.container-limits-enabled=true",
            "watch-together.websocket.chat-rate-limit=2",
            "watch-together.websocket.host-reconnect-grace=500ms"
        })
class RoomWebSocketIntegrationTest {

    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";
    private static final String MISSING_ROOM_ID = "0000000000000000000000";
    private static final String UUID_PATTERN =
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
    private static final String SESSION = "A".repeat(43);
    private static final String GUEST_SESSION = "B".repeat(43);
    private static final UUID HOST_ID =
            UUID.fromString("d0f8636f-e21e-4d7b-9fce-6fb0e6fb5678");
    private static final UUID GUEST_ID =
            UUID.fromString("8e7d79a8-a49f-48cc-a409-f07890dd3218");

    @LocalServerPort
    private int port;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private RoomEventPublisher eventPublisher;

    @MockitoBean
    private RoomRealtimeStore store;

    @MockitoBean
    private RoomLifecycleStore lifecycleStore;

    private final AtomicReference<StoredRoom> currentRoom = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        currentRoom.set(room(2));
        when(store.authenticateAndLoad(anyString(), anyString())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            String sessionHash = invocation.getArgument(1);
            return authentication(roomId, sessionHash);
        });
        when(store.connect(anyString(), anyString(), any(), any(), any(), any())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            String sessionHash = invocation.getArgument(1);
            UUID participantId = invocation.getArgument(2);
            return unchangedPresence(roomId, sessionHash, participantId);
        });
        when(store.heartbeat(anyString(), anyString(), any(), any(), any(), any())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            String sessionHash = invocation.getArgument(1);
            UUID participantId = invocation.getArgument(2);
            return unchangedPresence(roomId, sessionHash, participantId);
        });
        when(store.disconnect(anyString(), anyString(), any(), any(), any())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            String sessionHash = invocation.getArgument(1);
            UUID participantId = invocation.getArgument(2);
            return unchangedPresence(roomId, sessionHash, participantId);
        });
        when(lifecycleStore.markHostDisconnected(anyString(), any()))
                .thenReturn(HostPresenceResult.unchanged());
        when(lifecycleStore.recoverHost(anyString(), any()))
                .thenReturn(HostPresenceResult.unchanged());
        when(lifecycleStore.closeAbandonedRoom(anyString(), any()))
                .thenReturn(HostPresenceResult.unchanged());
    }

    @Test
    void sendsAuthoritativeSnapshotAsFirstMessage() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        JsonNode event = objectMapper.readTree(connection.listener().nextText());

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

        close(connection, "test complete");
    }

    @Test
    void sendsFreshSnapshotWithNewEventIdAfterReconnect() throws Exception {
        Connection first = connect(ROOM_ID, SESSION, null);
        JsonNode firstEvent = objectMapper.readTree(first.listener().nextText());
        close(first, "reconnect");

        currentRoom.set(room(3));
        Connection second = connect(ROOM_ID, SESSION, null);
        JsonNode secondEvent = objectMapper.readTree(second.listener().nextText());

        assertThat(secondEvent.get("eventId").stringValue())
                .isNotEqualTo(firstEvent.get("eventId").stringValue());
        assertThat(secondEvent.get("roomVersion").asLong()).isEqualTo(3);
        assertThat(secondEvent.at("/payload/roomVersion").asLong()).isEqualTo(3);

        close(second, "test complete");
    }

    @Test
    void rejectsMissingInvalidAndUnavailableSessionsBeforeUpgrade() {
        assertHandshakeStatus(ROOM_ID, null, null, 401);
        assertHandshakeStatus(ROOM_ID, "C".repeat(43), null, 401);
        assertHandshakeStatus(MISSING_ROOM_ID, SESSION, null, 404);
        assertHandshakeStatus(ROOM_ID, SESSION, "token=forbidden", 400);
    }

    @Test
    void acceptsParticipantHeartbeatWithoutClosingConnection() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        connection.listener().nextText();

        connection.webSocket().sendText(heartbeatJson(HOST_ID, SESSION, 2), true).join();

        verify(store, timeout(1000)).heartbeat(
                eq(ROOM_ID),
                eq(SecureHash.sha256(SESSION)),
                eq(HOST_ID),
                any(),
                any(),
                any());
        assertThat(connection.listener().isClosed()).isFalse();

        close(connection, "test complete");
    }

    @Test
    void broadcastsOfflineAndOnlinePresenceChanges() throws Exception {
        currentRoom.set(room(3, true));
        when(store.disconnect(eq(ROOM_ID), eq(SecureHash.sha256(GUEST_SESSION)), eq(GUEST_ID), any(), any()))
                .thenReturn(PresenceResult.offline(room(4, false), GUEST_ID));
        when(store.connect(eq(ROOM_ID), eq(SecureHash.sha256(GUEST_SESSION)), eq(GUEST_ID), any(), any(), any()))
                .thenReturn(
                        PresenceResult.unchanged(room(3, true), GUEST_ID),
                        PresenceResult.online(room(5, true), GUEST_ID));

        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        close(guest, "offline");
        JsonNode offlineEvent = objectMapper.readTree(host.listener().nextText());

        assertThat(offlineEvent.get("type").stringValue()).isEqualTo("participant.offline");
        assertThat(offlineEvent.get("participantId").stringValue()).isEqualTo(GUEST_ID.toString());
        assertThat(offlineEvent.get("roomVersion").asLong()).isEqualTo(4);
        assertThat(offlineEvent.at("/payload/participantId").stringValue())
                .isEqualTo(GUEST_ID.toString());
        assertThat(offlineEvent.at("/payload/online").booleanValue()).isFalse();

        Connection reconnectedGuest = connect(ROOM_ID, GUEST_SESSION, null);
        JsonNode reconnectSnapshot = objectMapper.readTree(reconnectedGuest.listener().nextText());
        JsonNode onlineEvent = objectMapper.readTree(host.listener().nextText());

        assertThat(reconnectSnapshot.get("type").stringValue()).isEqualTo("room.snapshot");
        assertThat(reconnectSnapshot.get("roomVersion").asLong()).isEqualTo(5);
        assertThat(onlineEvent.get("type").stringValue()).isEqualTo("participant.online");
        assertThat(onlineEvent.get("participantId").stringValue()).isEqualTo(GUEST_ID.toString());
        assertThat(onlineEvent.get("roomVersion").asLong()).isEqualTo(5);
        assertThat(onlineEvent.at("/payload/online").booleanValue()).isTrue();

        close(reconnectedGuest, "test complete");
        close(host, "test complete");
    }

    @Test
    void broadcastsRoomClosedEventAndClosesActiveSessions() throws Exception {
        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        StoredRoom closedRoom = room(4, RoomStatus.CLOSED, false);

        eventPublisher.publishRoomClosed(
                closedRoom,
                RoomClosedReason.HOST_CLOSED,
                closedRoom.updatedAt());
        JsonNode event = objectMapper.readTree(host.listener().nextText());

        assertThat(event.get("type").stringValue()).isEqualTo("room.closed");
        assertThat(event.get("roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(event.get("participantId").isNull()).isTrue();
        assertThat(event.get("roomVersion").asLong()).isEqualTo(4);
        assertThat(event.at("/payload/reason").stringValue()).isEqualTo("HOST_CLOSED");
        assertThat(event.at("/payload/closedAt").stringValue()).isEqualTo(
                closedRoom.updatedAt().toString());
        assertThat(host.listener().closeCode()).isEqualTo(1000);
    }

    @Test
    void broadcastsParticipantJoinedEventToActiveRoomSessions() throws Exception {
        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        StoredRoom afterJoin = room(3, true);
        currentRoom.set(afterJoin);

        eventPublisher.publishParticipantJoined(afterJoin, GUEST_ID, afterJoin.updatedAt());
        JsonNode event = objectMapper.readTree(host.listener().nextText());

        assertThat(event.get("type").stringValue()).isEqualTo("participant.joined");
        assertThat(event.get("roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(event.get("participantId").stringValue()).isEqualTo(GUEST_ID.toString());
        assertThat(event.get("roomVersion").asLong()).isEqualTo(3);
        assertThat(event.at("/payload/participantId").stringValue())
                .isEqualTo(GUEST_ID.toString());
        assertThat(event.at("/payload/displayName").stringValue()).isEqualTo("Guest");
        assertThat(event.at("/payload/role").stringValue()).isEqualTo("GUEST");
        assertThat(event.at("/payload/online").booleanValue()).isTrue();
        Instant guestJoinedAt = afterJoin.participants().stream()
                .filter(participant -> participant.participantId().equals(GUEST_ID))
                .findFirst()
                .orElseThrow()
                .joinedAt();
        assertThat(event.at("/payload/joinedAt").stringValue()).isEqualTo(
                guestJoinedAt.toString());
        assertThat(host.listener().isClosed()).isFalse();

        close(host, "test complete");
    }

    @Test
    void broadcastsParticipantLeftEventAndClosesLeavingParticipantSession() throws Exception {
        currentRoom.set(room(3, true));
        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();
        StoredRoom afterLeave = room(4);
        currentRoom.set(afterLeave);

        eventPublisher.publishParticipantLeft(
                afterLeave,
                GUEST_ID,
                ParticipantLeftReason.LEFT,
                afterLeave.updatedAt());
        JsonNode hostEvent = objectMapper.readTree(host.listener().nextText());
        JsonNode guestEvent = objectMapper.readTree(guest.listener().nextText());

        assertThat(hostEvent.get("type").stringValue()).isEqualTo("participant.left");
        assertThat(hostEvent.get("roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(hostEvent.get("participantId").stringValue()).isEqualTo(GUEST_ID.toString());
        assertThat(hostEvent.get("roomVersion").asLong()).isEqualTo(4);
        assertThat(hostEvent.at("/payload/participantId").stringValue())
                .isEqualTo(GUEST_ID.toString());
        assertThat(hostEvent.at("/payload/reason").stringValue()).isEqualTo("LEFT");
        assertThat(guestEvent).isEqualTo(hostEvent);
        assertThat(guest.listener().closeCode()).isEqualTo(1000);
        assertThat(host.listener().isClosed()).isFalse();

        close(host, "test complete");
    }

    @Test
    void closesUnknownClientCommandWithBadDataStatus() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        connection.listener().nextText();

        connection.webSocket().sendText(
                        """
                        {"schemaVersion":1,"type":"room.future.command"}
                        """,
                        true)
                .join();

        assertThat(connection.listener().closeCode()).isEqualTo(1007);
    }

    @Test
    void broadcastsChatMessageToEveryRoomSession() throws Exception {
        currentRoom.set(room(3, true));
        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        guest.webSocket()
                .sendText(chatJson(GUEST_ID, UUID.randomUUID(), "Погнали смотреть", 3), true)
                .join();

        JsonNode hostEvent = objectMapper.readTree(host.listener().nextText());
        JsonNode guestEvent = objectMapper.readTree(guest.listener().nextText());

        assertThat(hostEvent.get("type").stringValue()).isEqualTo("chat.message");
        assertThat(hostEvent.get("roomId").stringValue()).isEqualTo(ROOM_ID);
        assertThat(hostEvent.get("participantId").stringValue()).isEqualTo(GUEST_ID.toString());
        assertThat(hostEvent.get("roomVersion").asLong()).isEqualTo(3);
        assertThat(hostEvent.at("/payload/messageId").stringValue()).matches(UUID_PATTERN);
        assertThat(hostEvent.at("/payload/participantId").stringValue())
                .isEqualTo(GUEST_ID.toString());
        assertThat(hostEvent.at("/payload/displayName").stringValue()).isEqualTo("Guest");
        assertThat(hostEvent.at("/payload/text").stringValue()).isEqualTo("Погнали смотреть");
        assertThat(hostEvent.at("/payload/sentAt").stringValue()).isNotBlank();
        assertThat(guestEvent).isEqualTo(hostEvent);
        assertThat(host.listener().isClosed()).isFalse();
        assertThat(guest.listener().isClosed()).isFalse();

        close(guest, "test complete");
        close(host, "test complete");
    }

    @Test
    void rejectsOversizedChatMessageWithErrorEventAndKeepsConnectionOpen() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        connection.listener().nextText();

        connection.webSocket()
                .sendText(chatJson(HOST_ID, UUID.randomUUID(), "a".repeat(1001), 2), true)
                .join();

        JsonNode error = objectMapper.readTree(connection.listener().nextText());

        assertThat(error.get("type").stringValue()).isEqualTo("error");
        assertThat(error.get("participantId").stringValue()).isEqualTo(HOST_ID.toString());
        assertThat(error.at("/payload/code").stringValue()).isEqualTo("VALIDATION_FAILED");
        assertThat(error.at("/payload/status").asInt()).isEqualTo(422);
        assertThat(error.at("/payload/retryable").booleanValue()).isFalse();
        assertThat(error.at("/payload/instance").stringValue())
                .isEqualTo("/api/v1/rooms/" + ROOM_ID + "/events");
        assertThat(connection.listener().isClosed()).isFalse();

        close(connection, "test complete");
    }

    @Test
    void throttlesChatMessagesWithRetryableRateLimitedErrorEvent() throws Exception {
        currentRoom.set(room(3, true));
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        guest.webSocket().sendText(chatJson(GUEST_ID, UUID.randomUUID(), "one", 3), true).join();
        assertThat(objectMapper.readTree(guest.listener().nextText()).get("type").stringValue())
                .isEqualTo("chat.message");
        guest.webSocket().sendText(chatJson(GUEST_ID, UUID.randomUUID(), "two", 3), true).join();
        assertThat(objectMapper.readTree(guest.listener().nextText()).get("type").stringValue())
                .isEqualTo("chat.message");
        guest.webSocket().sendText(chatJson(GUEST_ID, UUID.randomUUID(), "three", 3), true).join();

        JsonNode error = objectMapper.readTree(guest.listener().nextText());

        assertThat(error.get("type").stringValue()).isEqualTo("error");
        assertThat(error.at("/payload/code").stringValue()).isEqualTo("RATE_LIMITED");
        assertThat(error.at("/payload/status").asInt()).isEqualTo(429);
        assertThat(error.at("/payload/retryable").booleanValue()).isTrue();
        assertThat(guest.listener().isClosed()).isFalse();

        close(guest, "test complete");
    }

    @Test
    void closesChatMessageWithMissingClientMessageIdUsingBadData() throws Exception {
        Connection connection = connect(ROOM_ID, SESSION, null);
        connection.listener().nextText();

        String json = objectMapper.writeValueAsString(java.util.Map.of(
                "schemaVersion", 1,
                "eventId", UUID.randomUUID(),
                "type", "chat.message",
                "roomId", ROOM_ID,
                "participantId", HOST_ID,
                "expectedRoomVersion", 2,
                "occurredAt", "2026-07-09T10:00:05Z",
                "payload", java.util.Map.of("text", "hi")));
        connection.webSocket().sendText(json, true).join();

        assertThat(connection.listener().closeCode()).isEqualTo(1007);
    }

    @Test
    void marksHostDisconnectedAndBroadcastsHostDisconnectedEvent() throws Exception {
        currentRoom.set(room(3, true));
        when(store.disconnect(eq(ROOM_ID), eq(SecureHash.sha256(SESSION)), eq(HOST_ID), any(), any()))
                .thenReturn(PresenceResult.offline(room(4, true), HOST_ID));
        when(lifecycleStore.markHostDisconnected(eq(ROOM_ID), any()))
                .thenReturn(HostPresenceResult.changed(room(5, RoomStatus.HOST_DISCONNECTED, true)));

        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        close(host, "drop");

        JsonNode offline = objectMapper.readTree(guest.listener().nextText());
        assertThat(offline.get("type").stringValue()).isEqualTo("participant.offline");
        JsonNode disconnected = objectMapper.readTree(guest.listener().nextText());
        assertThat(disconnected.get("type").stringValue()).isEqualTo("host.disconnected");
        assertThat(disconnected.get("participantId").stringValue()).isEqualTo(HOST_ID.toString());
        assertThat(disconnected.get("roomVersion").asLong()).isEqualTo(5);
        assertThat(disconnected.at("/payload/reconnectDeadline").stringValue()).isNotBlank();
        assertThat(guest.listener().isClosed()).isFalse();

        close(guest, "test complete");
    }

    @Test
    void recoversHostAndBroadcastsHostReconnectedOnReconnect() throws Exception {
        currentRoom.set(room(5, RoomStatus.HOST_DISCONNECTED, true));
        when(lifecycleStore.recoverHost(eq(ROOM_ID), any()))
                .thenReturn(HostPresenceResult.changed(room(6, RoomStatus.PLAYING, true)));

        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        Connection host = connect(ROOM_ID, SESSION, null);
        JsonNode hostSnapshot = objectMapper.readTree(host.listener().nextText());
        assertThat(hostSnapshot.get("type").stringValue()).isEqualTo("room.snapshot");
        assertThat(hostSnapshot.at("/payload/status").stringValue()).isEqualTo("PLAYING");
        assertThat(hostSnapshot.get("roomVersion").asLong()).isEqualTo(6);

        JsonNode reconnected = objectMapper.readTree(guest.listener().nextText());
        assertThat(reconnected.get("type").stringValue()).isEqualTo("host.reconnected");
        assertThat(reconnected.get("participantId").stringValue()).isEqualTo(HOST_ID.toString());
        assertThat(reconnected.get("roomVersion").asLong()).isEqualTo(6);
        assertThat(reconnected.at("/payload/participantId").stringValue())
                .isEqualTo(HOST_ID.toString());
        assertThat(reconnected.at("/payload/status").stringValue()).isEqualTo("PLAYING");
        assertThat(reconnected.at("/payload/updatedAt").stringValue()).isNotBlank();

        verify(lifecycleStore, timeout(1000)).recoverHost(eq(ROOM_ID), any());
        close(host, "test complete");
        close(guest, "test complete");
    }

    @Test
    void closesRoomWithHostTimeoutWhenGraceElapses() throws Exception {
        currentRoom.set(room(3, true));
        when(store.disconnect(eq(ROOM_ID), eq(SecureHash.sha256(SESSION)), eq(HOST_ID), any(), any()))
                .thenReturn(PresenceResult.offline(room(4, true), HOST_ID));
        when(lifecycleStore.markHostDisconnected(eq(ROOM_ID), any()))
                .thenReturn(HostPresenceResult.changed(room(5, RoomStatus.HOST_DISCONNECTED, true)));
        when(lifecycleStore.closeAbandonedRoom(eq(ROOM_ID), any()))
                .thenReturn(HostPresenceResult.changed(room(6, RoomStatus.CLOSED, false)));

        Connection host = connect(ROOM_ID, SESSION, null);
        host.listener().nextText();
        Connection guest = connect(ROOM_ID, GUEST_SESSION, null);
        guest.listener().nextText();

        close(host, "abandon");

        assertThat(objectMapper.readTree(guest.listener().nextText()).get("type").stringValue())
                .isEqualTo("participant.offline");
        assertThat(objectMapper.readTree(guest.listener().nextText()).get("type").stringValue())
                .isEqualTo("host.disconnected");

        JsonNode closed = objectMapper.readTree(guest.listener().nextText());
        assertThat(closed.get("type").stringValue()).isEqualTo("room.closed");
        assertThat(closed.at("/payload/reason").stringValue()).isEqualTo("HOST_TIMEOUT");
        assertThat(closed.get("roomVersion").asLong()).isEqualTo(6);
        assertThat(guest.listener().closeCode()).isEqualTo(1000);

        verify(lifecycleStore, timeout(2000)).closeAbandonedRoom(eq(ROOM_ID), any());
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

    private void close(Connection connection, String reason) throws Exception {
        connection.webSocket().sendClose(WebSocket.NORMAL_CLOSURE, reason).join();
        connection.listener().closeCode();
    }

    private AuthenticationResult authentication(String roomId, String sessionHash) {
        if (MISSING_ROOM_ID.equals(roomId)) {
            return AuthenticationResult.roomUnavailable();
        }
        if (!ROOM_ID.equals(roomId)) {
            return AuthenticationResult.authenticationRequired();
        }
        if (SecureHash.sha256(SESSION).equals(sessionHash)) {
            return AuthenticationResult.authenticated(currentRoom.get(), HOST_ID);
        }
        if (SecureHash.sha256(GUEST_SESSION).equals(sessionHash)) {
            return AuthenticationResult.authenticated(currentRoom.get(), GUEST_ID);
        }

        return AuthenticationResult.authenticationRequired();
    }

    private PresenceResult unchangedPresence(
            String roomId, String sessionHash, UUID participantId) {
        AuthenticationResult authentication = authentication(roomId, sessionHash);
        if (authentication.outcome()
                == RoomRealtimeStore.AuthenticationOutcome.ROOM_UNAVAILABLE) {
            return PresenceResult.roomUnavailable();
        }
        if (authentication.outcome()
                == RoomRealtimeStore.AuthenticationOutcome.AUTHENTICATION_REQUIRED
                || !participantId.equals(authentication.participantId())) {
            return PresenceResult.authenticationRequired();
        }

        return PresenceResult.unchanged(authentication.room(), participantId);
    }

    private String heartbeatJson(UUID participantId, String sessionCredential, long roomVersion)
            throws Exception {
        var payload = java.util.Map.of(
                "schemaVersion", 1,
                "eventId", UUID.randomUUID(),
                "type", "participant.heartbeat",
                "roomId", ROOM_ID,
                "participantId", participantId,
                "expectedRoomVersion", roomVersion,
                "occurredAt", "2026-07-09T10:00:05Z",
                "payload", java.util.Map.of("sentAt", "2026-07-09T10:00:05Z"));
        return objectMapper.writeValueAsString(payload);
    }

    private String chatJson(UUID participantId, UUID clientMessageId, String text, long roomVersion)
            throws Exception {
        var payload = java.util.Map.of(
                "schemaVersion", 1,
                "eventId", UUID.randomUUID(),
                "type", "chat.message",
                "roomId", ROOM_ID,
                "participantId", participantId,
                "expectedRoomVersion", roomVersion,
                "occurredAt", "2026-07-09T10:00:05Z",
                "payload", java.util.Map.of("clientMessageId", clientMessageId, "text", text));
        return objectMapper.writeValueAsString(payload);
    }

    private StoredRoom room(long roomVersion) {
        return room(roomVersion, null);
    }

    private StoredRoom room(long roomVersion, Boolean guestOnline) {
        return room(roomVersion, RoomStatus.CREATED, guestOnline);
    }

    private StoredRoom room(long roomVersion, RoomStatus status, Boolean guestOnline) {
        Instant now = Instant.parse("2030-07-09T10:00:00Z");
        StoredParticipant host = new StoredParticipant(
                HOST_ID,
                "Host",
                ParticipantRole.HOST,
                status != RoomStatus.CLOSED && status != RoomStatus.EXPIRED,
                now,
                SecureHash.sha256(SESSION));
        List<StoredParticipant> participants = guestOnline == null
                ? List.of(host)
                : List.of(
                        host,
                        new StoredParticipant(
                                GUEST_ID,
                                "Guest",
                                ParticipantRole.GUEST,
                                guestOnline,
                                now.plusSeconds(30),
                                SecureHash.sha256(GUEST_SESSION)));
        return new StoredRoom(
                ROOM_ID,
                status,
                HOST_ID,
                participants,
                roomVersion,
                now.plus(Duration.ofHours(4)),
                now.plusSeconds(roomVersion),
                SecureHash.sha256("H".repeat(43)));
    }

    private record Connection(WebSocket webSocket, RecordingListener listener) {}

    private static final class RecordingListener implements WebSocket.Listener {

        private final LinkedBlockingQueue<String> messages = new LinkedBlockingQueue<>();
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
                messages.add(text.toString());
                text.setLength(0);
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
            closeCode.completeExceptionally(error);
        }

        String nextText() throws Exception {
            String message = messages.poll(5, TimeUnit.SECONDS);
            if (message == null) {
                throw new AssertionError("WebSocket text message timed out");
            }
            return message;
        }

        int closeCode() throws Exception {
            return closeCode.get(5, TimeUnit.SECONDS);
        }

        boolean isClosed() {
            return closeCode.isDone();
        }
    }
}
