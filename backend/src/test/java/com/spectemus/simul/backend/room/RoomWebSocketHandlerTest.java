package com.spectemus.simul.backend.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Clock;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import tools.jackson.databind.ObjectMapper;

class RoomWebSocketHandlerTest {

    @Test
    void continuesBroadcastAfterOneRecipientDisconnectsDuringSend() throws Exception {
        RoomWebSocketHandler handler = new RoomWebSocketHandler(
                mock(RoomRealtimeStore.class),
                mock(RoomLifecycleStore.class),
                mock(ObjectMapper.class),
                new RoomWebSocketProperties(null, null, null, null),
                mock(TaskScheduler.class),
                Clock.systemUTC(),
                new RoomMetrics(new SimpleMeterRegistry()));
        WebSocketSession disconnected = mock(WebSocketSession.class);
        WebSocketSession connected = mock(WebSocketSession.class);
        when(disconnected.isOpen()).thenReturn(true);
        when(disconnected.getId()).thenReturn("disconnected");
        doThrow(new IOException("connection closed"))
                .when(disconnected)
                .sendMessage(any(TextMessage.class));
        when(connected.isOpen()).thenReturn(true);
        when(connected.getId()).thenReturn("connected");
        roomSessions(handler).put("room", Set.of(disconnected, connected));

        assertThatCode(() -> broadcast(handler, "room", "payload")).doesNotThrowAnyException();

        verify(connected).sendMessage(any(TextMessage.class));
    }

    @Test
    void unregisterKeepsRoomMappingWhenAnotherSessionIsStillRegistered() throws Exception {
        RoomWebSocketHandler handler = handler();
        WebSocketSession closing = mock(WebSocketSession.class);
        WebSocketSession stillConnected = mock(WebSocketSession.class);
        Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
        sessions.add(closing);
        sessions.add(stillConnected);
        roomSessions(handler).put("room", sessions);

        unregister(handler, "room", closing);

        assertThat(roomSessions(handler)).containsKey("room");
        assertThat(roomSessions(handler).get("room")).containsExactly(stillConnected);
    }

    private RoomWebSocketHandler handler() {
        return new RoomWebSocketHandler(
                mock(RoomRealtimeStore.class),
                mock(RoomLifecycleStore.class),
                mock(ObjectMapper.class),
                new RoomWebSocketProperties(null, null, null, null),
                mock(TaskScheduler.class),
                Clock.systemUTC(),
                new RoomMetrics(new SimpleMeterRegistry()));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Set<WebSocketSession>> roomSessions(RoomWebSocketHandler handler)
            throws Exception {
        Field field = RoomWebSocketHandler.class.getDeclaredField("sessionsByRoom");
        field.setAccessible(true);
        return (Map<String, Set<WebSocketSession>>) field.get(handler);
    }

    private void broadcast(RoomWebSocketHandler handler, String roomId, String payload)
            throws Exception {
        Method method = RoomWebSocketHandler.class.getDeclaredMethod(
                "broadcast", String.class, String.class, WebSocketSession.class);
        method.setAccessible(true);
        method.invoke(handler, roomId, payload, null);
    }

    private void unregister(RoomWebSocketHandler handler, String roomId, WebSocketSession session)
            throws Exception {
        Method method = RoomWebSocketHandler.class.getDeclaredMethod(
                "unregister", String.class, UUID.class, UUID.class, WebSocketSession.class);
        method.setAccessible(true);
        method.invoke(handler, roomId, UUID.randomUUID(), UUID.randomUUID(), session);
    }
}
