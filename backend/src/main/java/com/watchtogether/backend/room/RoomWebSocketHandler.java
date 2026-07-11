package com.watchtogether.backend.room;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.PresenceResult;
import com.watchtogether.backend.room.RoomCreationStore.StoredRoom;
import com.watchtogether.backend.room.RoomServerEvent.ProblemDetails;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
class RoomWebSocketHandler extends TextWebSocketHandler implements RoomEventPublisher {

    static final int MAX_TEXT_MESSAGE_BYTES = 16 * 1024;
    static final int MAX_CHAT_TEXT_LENGTH = 1000;
    private static final String CONNECTION_ID_ATTRIBUTE = "watchTogether.connectionId";
    private static final int CURRENT_SCHEMA_VERSION = 1;
    private static final String HEARTBEAT_TYPE = "participant.heartbeat";
    private static final String CHAT_MESSAGE_TYPE = "chat.message";
    private static final String PROBLEM_TYPE_PREFIX = "https://watch-together.local/problems/";

    private final RoomRealtimeStore store;
    private final RoomLifecycleStore lifecycleStore;
    private final ObjectMapper objectMapper;
    private final RoomWebSocketProperties properties;
    private final TaskScheduler taskScheduler;
    private final Clock clock;
    private final Map<ParticipantConnectionKey, ActiveConnection> connectionsByParticipant =
            new ConcurrentHashMap<>();
    private final Map<String, Set<WebSocketSession>> sessionsByRoom = new ConcurrentHashMap<>();
    private final Map<String, ScheduledFuture<?>> expiryTasksByRoom = new ConcurrentHashMap<>();
    private final Map<String, ScheduledFuture<?>> hostReconnectTasksByRoom =
            new ConcurrentHashMap<>();
    private final Map<ParticipantConnectionKey, ChatRateWindow> chatRateByParticipant =
            new ConcurrentHashMap<>();

    RoomWebSocketHandler(
            RoomRealtimeStore store,
            RoomLifecycleStore lifecycleStore,
            ObjectMapper objectMapper,
            RoomWebSocketProperties properties,
            TaskScheduler taskScheduler,
            Clock clock) {
        this.store = store;
        this.lifecycleStore = lifecycleStore;
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.taskScheduler = taskScheduler;
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
        UUID connectionId = UUID.randomUUID();
        attributes.put(CONNECTION_ID_ATTRIBUTE, connectionId);
        PresenceResult presence = store.connect(
                roomId,
                sessionHash,
                participantId,
                connectionId,
                Instant.now(clock),
                properties.presenceTtl());

        if (!presenceAccepted(presence, participantId)) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        ActiveConnection previous = register(roomId, participantId, connectionId, session);
        closePrevious(previous);

        StoredRoom room = presence.room();
        boolean hostRecovered = false;
        if (participantId.equals(room.hostParticipantId())) {
            cancelHostReconnect(roomId);
            if (room.status() == RoomStatus.HOST_DISCONNECTED) {
                var recovery = lifecycleStore.recoverHost(roomId, Instant.now(clock));
                if (recovery.changed()) {
                    room = recovery.room();
                    hostRecovered = true;
                }
            }
        }

        var snapshot = RoomResponseMapper.toSnapshot(room);
        var event = RoomServerEvent.snapshot(snapshot, Instant.now(clock));
        sendTo(session, objectMapper.writeValueAsString(event));
        scheduleExpiry(snapshot.roomId(), snapshot.expiresAt());
        broadcastPresenceChange(roomId, presence, session);
        if (hostRecovered) {
            var reconnected = RoomServerEvent.hostReconnected(
                    roomId,
                    participantId,
                    room.roomVersion(),
                    room.status(),
                    room.updatedAt(),
                    Instant.now(clock));
            broadcast(roomId, objectMapper.writeValueAsString(reconnected), session);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message)
            throws Exception {
        int payloadBytes = message.getPayload().getBytes(StandardCharsets.UTF_8).length;
        if (payloadBytes > MAX_TEXT_MESSAGE_BYTES) {
            session.close(CloseStatus.TOO_BIG_TO_PROCESS);
            return;
        }

        ClientEvent event;
        try {
            event = objectMapper.readValue(message.getPayload(), ClientEvent.class);
        } catch (Exception exception) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        if (HEARTBEAT_TYPE.equals(event.type())) {
            handleHeartbeat(session, event);
        } else if (CHAT_MESSAGE_TYPE.equals(event.type())) {
            handleChatMessage(session, event);
        } else {
            session.close(CloseStatus.BAD_DATA);
        }
    }

    private void handleHeartbeat(WebSocketSession session, ClientEvent event) throws IOException {
        if (!validEnvelope(session, event) || heartbeatPayload(event) == null) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        Map<String, Object> attributes = session.getAttributes();
        String roomId = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE);
        String sessionHash = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.SESSION_HASH_ATTRIBUTE);
        UUID participantId = requiredUuid(
                attributes, RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE);
        UUID connectionId = requiredUuid(attributes, CONNECTION_ID_ATTRIBUTE);
        PresenceResult presence = store.heartbeat(
                roomId,
                sessionHash,
                participantId,
                connectionId,
                Instant.now(clock),
                properties.presenceTtl());

        if (presence.outcome() == PresenceOutcome.STALE_CONNECTION) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        if (!presenceAccepted(presence, participantId)) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        broadcastPresenceChange(roomId, presence, null);
    }

    private void handleChatMessage(WebSocketSession session, ClientEvent event) throws IOException {
        ChatPayload payload = chatPayload(event);
        if (!validEnvelope(session, event)
                || payload == null
                || payload.clientMessageId() == null) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        Map<String, Object> attributes = session.getAttributes();
        String roomId = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE);
        String sessionHash = requiredString(
                attributes, RoomWebSocketAuthenticationInterceptor.SESSION_HASH_ATTRIBUTE);
        UUID participantId = requiredUuid(
                attributes, RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE);

        if (!validChatText(payload.text())) {
            sendError(
                    session,
                    roomId,
                    participantId,
                    event.expectedRoomVersion(),
                    422,
                    "VALIDATION_FAILED",
                    "chat-message-invalid",
                    "Сообщение отклонено",
                    "Сообщение должно быть от 1 до " + MAX_CHAT_TEXT_LENGTH
                            + " символов без управляющих символов.",
                    false);
            return;
        }

        if (!allowChatMessage(
                new ParticipantConnectionKey(roomId, participantId), Instant.now(clock))) {
            sendError(
                    session,
                    roomId,
                    participantId,
                    event.expectedRoomVersion(),
                    429,
                    "RATE_LIMITED",
                    "chat-rate-limited",
                    "Слишком много сообщений",
                    "Подождите несколько секунд перед следующим сообщением.",
                    true);
            return;
        }

        AuthenticationResult authentication = store.authenticateAndLoad(roomId, sessionHash);
        if (authentication.outcome() != AuthenticationOutcome.AUTHENTICATED
                || !participantId.equals(authentication.participantId())) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        StoredRoom room = authentication.room();
        if (room.status() == RoomStatus.CLOSED || room.status() == RoomStatus.EXPIRED) {
            return;
        }

        String displayName = room.participants().stream()
                .filter(participant -> participant.participantId().equals(participantId))
                .map(participant -> participant.displayName())
                .findFirst()
                .orElse(null);
        if (displayName == null) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        var chatEvent = RoomServerEvent.chatMessage(
                roomId,
                participantId,
                displayName,
                room.roomVersion(),
                UUID.randomUUID(),
                payload.text(),
                Instant.now(clock));
        broadcast(roomId, objectMapper.writeValueAsString(chatEvent), null);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status)
            throws Exception {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = optionalString(
                attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE);
        String sessionHash = optionalString(
                attributes, RoomWebSocketAuthenticationInterceptor.SESSION_HASH_ATTRIBUTE);
        UUID participantId = optionalUuid(
                attributes, RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE);
        UUID connectionId = optionalUuid(attributes, CONNECTION_ID_ATTRIBUTE);
        if (roomId == null || sessionHash == null || participantId == null || connectionId == null) {
            return;
        }

        unregister(roomId, participantId, connectionId, session);
        PresenceResult presence =
                store.disconnect(roomId, sessionHash, participantId, connectionId, Instant.now(clock));
        if (presence == null) {
            return;
        }
        broadcastPresenceChange(roomId, presence, session);
        handleHostDisconnect(roomId, participantId, presence);
    }

    private void handleHostDisconnect(String roomId, UUID participantId, PresenceResult presence)
            throws IOException {
        if (presence.outcome() != PresenceOutcome.OFFLINE
                || presence.room() == null
                || !participantId.equals(presence.room().hostParticipantId())) {
            return;
        }

        var marked = lifecycleStore.markHostDisconnected(roomId, Instant.now(clock));
        if (!marked.changed()) {
            return;
        }

        Instant deadline = Instant.now(clock).plus(properties.hostReconnectGrace());
        var event = RoomServerEvent.hostDisconnected(
                roomId, participantId, marked.room().roomVersion(), deadline, Instant.now(clock));
        broadcast(roomId, objectMapper.writeValueAsString(event), null);
        scheduleHostReconnect(roomId, deadline);
    }

    private boolean validEnvelope(WebSocketSession session, ClientEvent event) {
        if (event.schemaVersion() == null
                || event.schemaVersion() != CURRENT_SCHEMA_VERSION
                || event.eventId() == null
                || event.roomId() == null
                || event.participantId() == null
                || event.expectedRoomVersion() == null
                || event.expectedRoomVersion() < 0
                || event.occurredAt() == null
                || event.payload() == null) {
            return false;
        }

        Map<String, Object> attributes = session.getAttributes();
        return event.roomId().equals(optionalString(
                        attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE))
                && event.participantId().equals(optionalUuid(
                        attributes,
                        RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE));
    }

    private HeartbeatPayload heartbeatPayload(ClientEvent event) {
        if (event.payload() == null) {
            return null;
        }
        try {
            HeartbeatPayload payload =
                    objectMapper.treeToValue(event.payload(), HeartbeatPayload.class);
            return payload.sentAt() == null ? null : payload;
        } catch (Exception exception) {
            return null;
        }
    }

    private ChatPayload chatPayload(ClientEvent event) {
        if (event.payload() == null) {
            return null;
        }
        try {
            return objectMapper.treeToValue(event.payload(), ChatPayload.class);
        } catch (Exception exception) {
            return null;
        }
    }

    private boolean validChatText(String text) {
        if (text == null || text.isBlank()) {
            return false;
        }
        int length = text.codePointCount(0, text.length());
        if (length < 1 || length > MAX_CHAT_TEXT_LENGTH) {
            return false;
        }
        return text.codePoints().noneMatch(RoomWebSocketHandler::isDisallowedControlChar);
    }

    private static boolean isDisallowedControlChar(int codePoint) {
        if (codePoint == '\n' || codePoint == '\t') {
            return false;
        }
        return codePoint < 0x20 || codePoint == 0x7F;
    }

    private boolean allowChatMessage(ParticipantConnectionKey key, Instant now) {
        Duration window = properties.chatRateWindow();
        ChatRateWindow updated = chatRateByParticipant.compute(key, (ignored, existing) -> {
            if (existing == null
                    || Duration.between(existing.windowStart(), now).compareTo(window) >= 0) {
                return new ChatRateWindow(now, 1);
            }
            return new ChatRateWindow(existing.windowStart(), existing.count() + 1);
        });
        return updated.count() <= properties.chatRateLimit();
    }

    private void sendError(
            WebSocketSession session,
            String roomId,
            UUID participantId,
            long roomVersion,
            int status,
            String code,
            String problemSlug,
            String title,
            String detail,
            boolean retryable)
            throws IOException {
        if (!session.isOpen()) {
            return;
        }
        var problem = new ProblemDetails(
                PROBLEM_TYPE_PREFIX + problemSlug,
                title,
                status,
                code,
                detail,
                "/api/v1/rooms/" + roomId + "/events",
                UUID.randomUUID(),
                retryable);
        var event = RoomServerEvent.error(
                roomId, participantId, roomVersion, problem, Instant.now(clock));
        sendTo(session, objectMapper.writeValueAsString(event));
    }

    private void broadcast(String roomId, String payload, WebSocketSession excludedSession)
            throws IOException {
        String excludedId = excludedSession == null ? null : excludedSession.getId();
        Set<WebSocketSession> roomSessions = sessionsByRoom.getOrDefault(roomId, Set.of());
        for (WebSocketSession roomSession : roomSessions) {
            if (roomSession.isOpen() && !Objects.equals(roomSession.getId(), excludedId)) {
                sendTo(roomSession, payload);
            }
        }
    }

    private void sendTo(WebSocketSession session, String payload) throws IOException {
        // A WebSocket session forbids concurrent sends. Broadcasts triggered from REST
        // request threads (participant joined/left, room closed) and the scheduler
        // (expiry / host-reconnect timeout) race with container-thread sends (snapshot,
        // heartbeat presence). Serialize every send per session and skip closed sockets.
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(payload));
            }
        }
    }

    private boolean presenceAccepted(PresenceResult presence, UUID participantId) {
        return presence.room() != null
                && participantId.equals(presence.participantId())
                && (presence.outcome() == PresenceOutcome.ONLINE
                        || presence.outcome() == PresenceOutcome.UNCHANGED
                        || presence.outcome() == PresenceOutcome.OFFLINE);
    }

    private ActiveConnection register(
            String roomId, UUID participantId, UUID connectionId, WebSocketSession session) {
        sessionsByRoom.computeIfAbsent(roomId, key -> ConcurrentHashMap.newKeySet()).add(session);
        return connectionsByParticipant.put(
                new ParticipantConnectionKey(roomId, participantId),
                new ActiveConnection(connectionId, session));
    }

    private void unregister(
            String roomId, UUID participantId, UUID connectionId, WebSocketSession session) {
        Set<WebSocketSession> roomSessions = sessionsByRoom.get(roomId);
        if (roomSessions != null) {
            roomSessions.remove(session);
            if (roomSessions.isEmpty()) {
                sessionsByRoom.remove(roomId, roomSessions);
                forgetChatRateWindows(roomId);
                // No sessions remain to serve, so an abandoned-room grace timer has
                // nothing to close — TTL expiry handles cleanup. Cancelling here also
                // prevents a pending timer from firing after the room is deserted.
                cancelHostReconnect(roomId);
            }
        }

        connectionsByParticipant.remove(
                new ParticipantConnectionKey(roomId, participantId),
                new ActiveConnection(connectionId, session));
    }

    private void forgetChatRateWindows(String roomId) {
        chatRateByParticipant.keySet().removeIf(key -> key.roomId().equals(roomId));
    }

    private void closePrevious(ActiveConnection previous) throws IOException {
        if (previous != null && previous.session().isOpen()) {
            previous.session().close(CloseStatus.NORMAL);
        }
    }

    private void broadcastPresenceChange(
            String roomId, PresenceResult presence, WebSocketSession excludedSession)
            throws IOException {
        if (!presence.changed()) {
            return;
        }

        var event = RoomServerEvent.participantPresence(
                presence.room().roomId(),
                presence.participantId(),
                presence.room().roomVersion(),
                presence.online(),
                presence.room().updatedAt(),
                Instant.now(clock));
        String payload = objectMapper.writeValueAsString(event);
        Set<WebSocketSession> roomSessions = sessionsByRoom.getOrDefault(roomId, Set.of());
        for (WebSocketSession roomSession : roomSessions) {
            if (!Objects.equals(roomSession.getId(), excludedSession == null ? null : excludedSession.getId())
                    && roomSession.isOpen()) {
                sendTo(roomSession, payload);
            }
        }
    }

    @Override
    public void publishParticipantJoined(StoredRoom room, UUID participantId, Instant joinedAt)
            throws IOException {
        var participant = room.participants().stream()
                .filter(item -> item.participantId().equals(participantId))
                .findFirst()
                .map(RoomResponseMapper::toParticipant)
                .orElseThrow(() -> new IllegalStateException(
                        "Joined participant is absent from room state"));
        var event = RoomServerEvent.participantJoined(
                room.roomId(),
                participant,
                room.roomVersion(),
                joinedAt);
        String payload = objectMapper.writeValueAsString(event);
        Set<WebSocketSession> roomSessions = sessionsByRoom.getOrDefault(room.roomId(), Set.of());
        for (WebSocketSession roomSession : roomSessions) {
            if (roomSession.isOpen()) {
                sendTo(roomSession, payload);
            }
        }
    }

    @Override
    public void publishRoomClosed(StoredRoom room, RoomClosedReason reason, Instant closedAt)
            throws IOException {
        ScheduledFuture<?> expiryTask = expiryTasksByRoom.remove(room.roomId());
        if (expiryTask != null) {
            expiryTask.cancel(false);
        }
        cancelHostReconnect(room.roomId());
        forgetChatRateWindows(room.roomId());

        var event = RoomServerEvent.roomClosed(
                room.roomId(),
                room.roomVersion(),
                reason,
                closedAt,
                Instant.now(clock));
        String payload = objectMapper.writeValueAsString(event);
        Set<WebSocketSession> roomSessions = Set.copyOf(
                sessionsByRoom.getOrDefault(room.roomId(), Set.of()));
        for (WebSocketSession roomSession : roomSessions) {
            if (roomSession.isOpen()) {
                sendTo(roomSession, payload);
                roomSession.close(CloseStatus.NORMAL);
            }
        }
    }

    @Override
    public void publishParticipantLeft(
            StoredRoom room, UUID participantId, ParticipantLeftReason reason, Instant leftAt)
            throws IOException {
        var event = RoomServerEvent.participantLeft(
                room.roomId(),
                participantId,
                room.roomVersion(),
                reason,
                leftAt);
        String payload = objectMapper.writeValueAsString(event);
        Set<WebSocketSession> roomSessions = Set.copyOf(
                sessionsByRoom.getOrDefault(room.roomId(), Set.of()));
        for (WebSocketSession roomSession : roomSessions) {
            if (!roomSession.isOpen()) {
                continue;
            }
            sendTo(roomSession, payload);
            if (participantId.equals(optionalUuid(
                    roomSession.getAttributes(),
                    RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE))) {
                roomSession.close(CloseStatus.NORMAL);
            }
        }
    }

    private void scheduleExpiry(String roomId, Instant expiresAt) {
        expiryTasksByRoom.compute(roomId, (key, existingTask) -> {
            if (existingTask != null && !existingTask.isDone()) {
                return existingTask;
            }
            return taskScheduler.schedule(() -> expireRoom(roomId), expiresAt);
        });
    }

    private void expireRoom(String roomId) {
        expiryTasksByRoom.remove(roomId);
        var result = lifecycleStore.expire(roomId, Instant.now(clock));
        if (!result.changed()) {
            return;
        }

        try {
            publishRoomClosed(result.room(), RoomClosedReason.EXPIRED, result.room().updatedAt());
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to publish room expiry event", exception);
        }
    }

    private void scheduleHostReconnect(String roomId, Instant deadline) {
        hostReconnectTasksByRoom.compute(roomId, (key, existingTask) -> {
            if (existingTask != null && !existingTask.isDone()) {
                existingTask.cancel(false);
            }
            return taskScheduler.schedule(() -> closeAbandonedRoom(roomId), deadline);
        });
    }

    private void cancelHostReconnect(String roomId) {
        ScheduledFuture<?> task = hostReconnectTasksByRoom.remove(roomId);
        if (task != null) {
            task.cancel(false);
        }
    }

    private void closeAbandonedRoom(String roomId) {
        hostReconnectTasksByRoom.remove(roomId);
        var result = lifecycleStore.closeAbandonedRoom(roomId, Instant.now(clock));
        if (!result.changed()) {
            return;
        }

        try {
            publishRoomClosed(
                    result.room(), RoomClosedReason.HOST_TIMEOUT, result.room().updatedAt());
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to publish host timeout close", exception);
        }
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

    private String optionalString(Map<String, Object> attributes, String name) {
        Object value = attributes.get(name);
        return value instanceof String stringValue ? stringValue : null;
    }

    private UUID optionalUuid(Map<String, Object> attributes, String name) {
        Object value = attributes.get(name);
        return value instanceof UUID uuidValue ? uuidValue : null;
    }

    private record ParticipantConnectionKey(String roomId, UUID participantId) {}

    private record ActiveConnection(UUID connectionId, WebSocketSession session) {}

    private record ClientEvent(
            Integer schemaVersion,
            UUID eventId,
            String type,
            String roomId,
            UUID participantId,
            Long expectedRoomVersion,
            Instant occurredAt,
            JsonNode payload) {}

    private record HeartbeatPayload(Instant sentAt) {}

    private record ChatPayload(UUID clientMessageId, String text) {}

    private record ChatRateWindow(Instant windowStart, int count) {}
}
