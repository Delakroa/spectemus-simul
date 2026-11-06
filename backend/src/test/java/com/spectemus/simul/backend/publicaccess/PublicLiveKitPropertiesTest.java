package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;

import org.junit.jupiter.api.Test;

class PublicLiveKitPropertiesTest {

    @Test
    void keepsDisabledConfigurationWithoutCredentials() {
        PublicLiveKitProperties properties = new PublicLiveKitProperties(false, null, null, null, null);

        assertThat(properties.isEnabled()).isFalse();
        assertThat(properties.tokenTtl()).isEqualTo(Duration.ofMinutes(5));
    }

    @Test
    void rejectsEnabledConfigurationWithoutWssUrl() {
        assertThatThrownBy(() -> enabled("ws://rtc.example.test", "public-key", "public-secret-value"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("wss://")
                .hasMessageNotContaining("public-secret-value");
    }

    @Test
    void rejectsLoopbackAndLanDefaultCredentials() {
        assertThatThrownBy(() -> enabled("wss://127.0.0.1:7880", "public-key", "public-secret-value"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("loopback");
        assertThatThrownBy(() -> enabled("wss://rtc.example.test", "devkey", "public-secret-value"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("LAN/default LiveKit key");
        assertThatThrownBy(() ->
                        enabled("wss://rtc.example.test", "public-key", "devsecretdevsecretdevsecretdevsecret"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("LAN/default LiveKit secret");
    }

    @Test
    void rejectsNonPositiveOrExcessiveTtl() {
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "public-key",
                        "public-secret-value",
                        Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("token-ttl");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "public-key",
                        "public-secret-value",
                        Duration.ofMinutes(16)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("15m");
    }

    @Test
    void acceptsExplicitPublicConfiguration() {
        PublicLiveKitProperties properties =
                enabled("wss://rtc.example.test", "public-key", "public-secret-value");

        assertThat(properties.isEnabled()).isTrue();
        assertThat(properties.url()).isEqualTo("wss://rtc.example.test");
        assertThat(properties.tokenTtl()).isEqualTo(Duration.ofMinutes(5));
    }

    private static PublicLiveKitProperties enabled(String url, String apiKey, String apiSecret) {
        return new PublicLiveKitProperties(true, url, apiKey, apiSecret, null);
    }
}
