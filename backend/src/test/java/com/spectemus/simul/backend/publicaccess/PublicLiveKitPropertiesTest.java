package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;

import org.junit.jupiter.api.Test;

class PublicLiveKitPropertiesTest {

    @Test
    void keepsDisabledConfigurationWithoutCredentials() {
        PublicLiveKitProperties properties =
                new PublicLiveKitProperties(false, null, null, null, null, null, null, null);

        assertThat(properties.isEnabled()).isFalse();
        assertThat(properties.tokenTtl()).isEqualTo(Duration.ofMinutes(5));
        assertThat(properties.adminTokenTtl()).isEqualTo(Duration.ofMinutes(1));
        assertThat(properties.adminTimeout()).isEqualTo(Duration.ofSeconds(3));
    }

    @Test
    void rejectsEnabledConfigurationWithoutWssOrHttpsUrls() {
        assertThatThrownBy(() -> enabled("ws://rtc.example.test", "https://rtc-api.example.test"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("wss://")
                .hasMessageNotContaining("public-secret-value");
        assertThatThrownBy(() -> enabled("wss://rtc.example.test", "http://rtc-api.example.test"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("https://");
        assertThatThrownBy(() -> enabled("wss://rtc.example.test", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("api-url");
    }

    @Test
    void rejectsLoopbackAndLanDefaultCredentials() {
        assertThatThrownBy(() -> enabled("wss://127.0.0.1:7880", "https://rtc-api.example.test"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("loopback");
        assertThatThrownBy(() -> enabled("wss://rtc.example.test", "https://127.0.0.1:7880"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("loopback");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "devkey",
                        "public-secret-value",
                        null,
                        null,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("LAN/default LiveKit key");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "public-key",
                        "devsecretdevsecretdevsecretdevsecret",
                        null,
                        null,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("LAN/default LiveKit secret");
    }

    @Test
    void rejectsNonPositiveOrExcessiveDurations() {
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "public-key",
                        "public-secret-value",
                        Duration.ZERO,
                        null,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("token-ttl");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "public-key",
                        "public-secret-value",
                        Duration.ofMinutes(16),
                        null,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("token-ttl");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "public-key",
                        "public-secret-value",
                        null,
                        Duration.ofMinutes(6),
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("admin-token-ttl");
        assertThatThrownBy(() -> new PublicLiveKitProperties(
                        true,
                        "wss://rtc.example.test",
                        "https://rtc-api.example.test",
                        "public-key",
                        "public-secret-value",
                        null,
                        null,
                        Duration.ofSeconds(20)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("admin-timeout");
    }

    @Test
    void acceptsExplicitPublicConfiguration() {
        PublicLiveKitProperties properties =
                enabled("wss://rtc.example.test", "https://rtc-api.example.test");

        assertThat(properties.isEnabled()).isTrue();
        assertThat(properties.url()).isEqualTo("wss://rtc.example.test");
        assertThat(properties.apiUrl()).isEqualTo("https://rtc-api.example.test");
        assertThat(properties.tokenTtl()).isEqualTo(Duration.ofMinutes(5));
    }

    private static PublicLiveKitProperties enabled(String url, String apiUrl) {
        return new PublicLiveKitProperties(
                true, url, apiUrl, "public-key", "public-secret-value", null, null, null);
    }
}
