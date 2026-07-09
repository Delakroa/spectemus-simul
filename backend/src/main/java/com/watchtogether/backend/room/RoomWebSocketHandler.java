package com.watchtogether.backend.room;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.ObjectMapper;

@Component
class RoomWebSocketHandler extends TextWebSocketHandler {

    static final int MAX_TEXT_MESSAGE_BYTES = 16 * 1024;

    private final RoomRealtimeStore store;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    RoomWebSocketHandler(RoomRealtimeStore store, ObjectMapper objectMapper, Clock clock) {
        this.store = store;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE);
        String sessionHash = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.SESSION_HASH_ATTRIBUTE);
        UUID participantId = requiredUuid(
                attributes, RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE);
        AuthenticationResult authentication = store.authenticateAndLoad(roomId, sessionHash);

        if (authentication.outcome() != AuthenticationOutcome.AUTHENTICATED
                || !participantId.equals(authentication.participantId())) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        var snapshot = RoomResponseMapper.toSnapshot(authentication.room());
        var event = RoomServerEvent.snapshot(snapshot, Instant.now(clock));
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(event)));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message)
            throws Exception {
        int payloadBytes = message.getPayload().getBytes(StandardCharsets.UTF_8).length;
        session.close(payloadBytes > MAX_TEXT_MESSAGE_BYTES
                ? CloseStatus.TOO_BIG_TO_PROCESS
                : CloseStatus.BAD_DATA);
    }

    private String requiredString(Map<String, Object> attributes, String name) {
        Object value = attributes.get(name);
        if (value instanceof String stringValue) {
            return stringValue;
        }
        throw new IllegalStateException("Required WebSocket session attribute is missing");
    }

    private UUID requiredUuid(Map<String, Object> attributes, String name) {
        Object value = attributes.get(name);
        if (value instanceof UUID uuidValue) {
            return uuidValue;
        }
        throw new IllegalStateException("Required WebSocket session attribute is missing");
    }
}
