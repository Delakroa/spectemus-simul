package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.UUID;

import com.spectemus.simul.backend.api.ApiException;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.Test;

class PublicConnectionTelemetryServiceTest {

    private static final UUID ROOM_ID = UUID.fromString("9de974f2-d79c-4bbf-b5ff-6fc83d608164");
    private static final String CREDENTIAL = "A".repeat(43);

    @Test
    void countsOnlyLowCardinalityEventAfterMembershipCheck() {
        PublicAccessService access = mock(PublicAccessService.class);
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        PublicConnectionTelemetryService service = new PublicConnectionTelemetryService(access, registry);

        service.record(ROOM_ID, CREDENTIAL, PublicConnectionEventType.RECONNECTING);

        verify(access).requireActiveMembership(ROOM_ID, CREDENTIAL);
        var counter = registry.find("spectemus.internet.connection.events")
                .tag("event", "RECONNECTING")
                .counter();
        assertThat(counter).isNotNull();
        assertThat(counter.count()).isEqualTo(1);
        assertThat(counter.getId().getTags()).hasSize(1);
        assertThat(counter.getId().getTags().getFirst().getKey()).isEqualTo("event");
    }

    @Test
    void revokedMemberDoesNotIncrementCounter() {
        PublicAccessService access = mock(PublicAccessService.class);
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        PublicConnectionTelemetryService service = new PublicConnectionTelemetryService(access, registry);
        doThrow(ApiException.notFound("MEMBERSHIP_REQUIRED", "Комната недоступна", "Нет доступа"))
                .when(access).requireActiveMembership(ROOM_ID, CREDENTIAL);

        assertThatThrownBy(() -> service.record(ROOM_ID, CREDENTIAL, PublicConnectionEventType.CONNECTED))
                .isInstanceOf(ApiException.class);
        assertThat(registry.find("spectemus.internet.connection.events").meters()).isEmpty();
    }
}
