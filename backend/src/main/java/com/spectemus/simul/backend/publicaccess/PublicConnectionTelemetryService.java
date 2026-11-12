package com.spectemus.simul.backend.publicaccess;

import java.util.UUID;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** Membership-gated aggregate counters. Never records room, account, IP or request payload. */
@Service
@ConditionalOnProperty(prefix = "spectemus-simul.public-access", name = "enabled", havingValue = "true")
@ConditionalOnProperty(prefix = "spectemus-simul.public-livekit", name = "enabled", havingValue = "true")
class PublicConnectionTelemetryService {

    private final PublicAccessService accessService;
    private final MeterRegistry registry;

    PublicConnectionTelemetryService(PublicAccessService accessService, MeterRegistry registry) {
        this.accessService = accessService;
        this.registry = registry;
    }

    void record(UUID publicRoomId, String credential, PublicConnectionEventType type) {
        accessService.requireActiveMembership(publicRoomId, credential);
        Counter.builder("spectemus.internet.connection.events")
                .description("Internet room connection events from active members")
                .tag("event", type.name())
                .register(registry)
                .increment();
    }
}
