package com.watchtogether.backend.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

class DefaultSecureValueGeneratorTest {

    @Test
    void generatesUrlSafeRoomIdsAndSeparateCredentials() {
        DefaultSecureValueGenerator generator = new DefaultSecureValueGenerator();
        Set<String> roomIds = new HashSet<>();
        Set<String> credentials = new HashSet<>();

        for (int index = 0; index < 100; index++) {
            roomIds.add(generator.roomId());
            credentials.add(generator.credential());
        }

        assertThat(roomIds).hasSize(100).allMatch(value -> value.matches("^[A-Za-z0-9_-]{22}$"));
        assertThat(credentials)
                .hasSize(100)
                .allMatch(value -> value.matches("^[A-Za-z0-9_-]{43}$"));
    }
}
