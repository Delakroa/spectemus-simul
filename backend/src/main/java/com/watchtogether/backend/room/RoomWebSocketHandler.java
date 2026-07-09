package com.watchtogether.backend.room;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
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

import org.springframework.stereotype.Component;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import tools.jackson.databind.ObjectMapper;

@Component
class RoomWebSocketHandler extends TextWebSocketHandler implements RoomEventPublisher {

    static final int MAX_TEXT_MESSAGE_BYTES = 16 * 1024;
    private static final String CONNECTION_ID_ATTRIBUTE = "watchTogether.connectionId";
    private static final int CURRENT_SCHEMA_VERSION = 1;
    private static final String HEARTBEAT_TYPE = "participant.heartbeat";

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

        var snapshot = RoomResponseMapper.toSnapshot(presence.room());
        var event = RoomServerEvent.snapshot(snapshot, Instant.now(clock));
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(event)));
        scheduleExpiry(snapshot.roomId(), snapshot.expiresAt());
        broadcastPresenceChange(roomId, presence, session);
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

        if (!HEARTBEAT_TYPE.equals(event.type())) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        if (!validHeartbeat(session, event)) {
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
        broadcastPresenceChange(roomId, presence, session);
    }

    private boolean validHeartbeat(WebSocketSession session, ClientEvent event) {
        if (event.schemaVersion() == null
                || event.schemaVersion() != CURRENT_SCHEMA_VERSION
                || event.eventId() == null
                || event.roomId() == null
                || event.participantId() == null
                || event.expectedRoomVersion() == null
                || event.expectedRoomVersion() < 0
                || event.occurredAt() == null
                || event.payload() == null
                || event.payload().sentAt() == null) {
            return false;
        }

        Map<String, Object> attributes = session.getAttributes();
        return event.roomId().equals(optionalString(
                        attributes, RoomWebSocketAuthenticationInterceptor.ROOM_ID_ATTRIBUTE))
                && event.participantId().equals(optionalUuid(
                        attributes,
                        RoomWebSocketAuthenticationInterceptor.PARTICIPANT_ID_ATTRIBUTE));
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
            }
        }

        connectionsByParticipant.remove(
                new ParticipantConnectionKey(roomId, participantId),
                new ActiveConnection(connectionId, session));
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
                roomSession.sendMessage(new TextMessage(payload));
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
                roomSession.sendMessage(new TextMessage(payload));
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
            roomSession.sendMessage(new TextMessage(payload));
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
            HeartbeatPayload payload) {}

    private record HeartbeatPayload(Instant sentAt) {}
}
