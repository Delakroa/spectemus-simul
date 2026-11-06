package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

class PublicLiveKitPropertiesBindingTest {

    private static final String API_SECRET = "public-secret-value";

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(PropertiesConfiguration.class);

    @Test
    void failsFastWhenEnabledWithoutRtcUrl() {
        runner.withPropertyValues(
                        "spectemus-simul.public-livekit.enabled=true",
                        "spectemus-simul.public-livekit.url=",
                        "spectemus-simul.public-livekit.api-key=public-key",
                        "spectemus-simul.public-livekit.api-secret=" + API_SECRET)
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable root = rootCause(context.getStartupFailure());
                    assertThat(root).isInstanceOf(IllegalArgumentException.class);
                    assertThat(root.getMessage())
                            .contains("url")
                            .doesNotContain(API_SECRET);
                });
    }

    @Test
    void bindsCompletePublicConfiguration() {
        runner.withPropertyValues(
                        "spectemus-simul.public-livekit.enabled=true",
                        "spectemus-simul.public-livekit.url=wss://rtc.example.test",
                        "spectemus-simul.public-livekit.api-key=public-key",
                        "spectemus-simul.public-livekit.api-secret=" + API_SECRET,
                        "spectemus-simul.public-livekit.token-ttl=5m")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    PublicLiveKitProperties properties = context.getBean(PublicLiveKitProperties.class);
                    assertThat(properties.isEnabled()).isTrue();
                    assertThat(properties.url()).isEqualTo("wss://rtc.example.test");
                });
    }

    private static Throwable rootCause(Throwable failure) {
        Throwable current = failure;
        while (current != null && current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(PublicLiveKitProperties.class)
    static class PropertiesConfiguration {}
}
