package com.spectemus.simul.backend.room;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import org.springframework.stereotype.Component;

/**
 * Privacy-safe Micrometer counters for room observability (WT-506). Records only
 * aggregate counts and low-cardinality tags (close reason) — never roomId,
 * participantId or any other identifier. Exposed via the actuator metrics /
 * prometheus endpoints for an external dashboard to scrape.
 */
@Component
class RoomMetrics {

    private final MeterRegistry registry;
    private final Counter wsConnections;
    private final Counter participantsJoined;
    private final Counter participantsLeft;
    private final Counter hostDisconnected;
    private final Counter hostReconnected;
    private final Counter chatMessages;
    private final Counter chatRateLimited;

    RoomMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.wsConnections = Counter.builder("wt.ws.connections")
                .description("Room WebSocket connections established")
                .register(registry);
        this.participantsJoined = Counter.builder("wt.room.participants.joined")
                .description("Participants that joined a room")
                .register(registry);
        this.participantsLeft = Counter.builder("wt.room.participants.left")
                .description("Participants that left a room")
                .register(registry);
        this.hostDisconnected = Counter.builder("wt.host.disconnected")
                .description("Host disconnects that started a reconnect grace period")
                .register(registry);
        this.hostReconnected = Counter.builder("wt.host.reconnected")
                .description("Host reconnects within the grace period")
                .register(registry);
        this.chatMessages = Counter.builder("wt.chat.messages")
                .description("Chat messages broadcast to a room")
                .register(registry);
        this.chatRateLimited = Counter.builder("wt.chat.rate_limited")
                .description("Chat messages rejected by the rate limiter")
                .register(registry);
    }

    void webSocketConnected() {
        wsConnections.increment();
    }

    void participantJoined() {
        participantsJoined.increment();
    }

    void participantLeft() {
        participantsLeft.increment();
    }

    void hostDisconnected() {
        hostDisconnected.increment();
    }

    void hostReconnected() {
        hostReconnected.increment();
    }

    void chatMessage() {
        chatMessages.increment();
    }

    void chatRateLimited() {
        chatRateLimited.increment();
    }

    void roomClosed(RoomClosedReason reason) {
        Counter.builder("wt.room.closed")
                .description("Rooms closed, tagged by reason")
                .tag("reason", reason.name())
                .register(registry)
                .increment();
    }
}
