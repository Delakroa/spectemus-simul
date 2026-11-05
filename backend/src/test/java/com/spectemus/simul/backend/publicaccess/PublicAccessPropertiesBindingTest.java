package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

class PublicAccessPropertiesBindingTest {

    private static final String DATABASE_PASSWORD = "not-a-real-db-password";
    private static final String IDENTITY_PEPPER = "test-identity-pepper-at-least-32-characters";
    private static final String MAIL_PASSWORD = "not-a-real-smtp-password";
    private static final String MAIL_FROM = "login@example.test";

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(PropertiesConfiguration.class);

    @Test
    void failsContextStartupWhenEnabledWithoutJdbcUrl() {
        runner.withPropertyValues(
                        "spectemus-simul.public-access.enabled=true",
                        "spectemus-simul.public-access.jdbc-url=",
                        "spectemus-simul.public-access.jdbc-username=spectemus",
                        "spectemus-simul.public-access.jdbc-password=" + DATABASE_PASSWORD,
                        "spectemus-simul.public-access.identity-pepper=" + IDENTITY_PEPPER,
                        "spectemus-simul.public-access.cookie-secure=true",
                        "spectemus-simul.public-access.email.host=smtp.example.test",
                        "spectemus-simul.public-access.email.username=mailer",
                        "spectemus-simul.public-access.email.password=" + MAIL_PASSWORD,
                        "spectemus-simul.public-access.email.from=" + MAIL_FROM)
                .run(context -> {
                    assertThat(context).hasFailed();
                    Throwable root = rootCause(context.getStartupFailure());
                    assertThat(root).isInstanceOf(IllegalArgumentException.class);
                    assertThat(root.getMessage())
                            .contains("jdbc-url")
                            .doesNotContain(DATABASE_PASSWORD)
                            .doesNotContain(IDENTITY_PEPPER)
                            .doesNotContain(MAIL_PASSWORD)
                            .doesNotContain(MAIL_FROM);
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
    @EnableConfigurationProperties(PublicAccessProperties.class)
    static class PropertiesConfiguration {}
}
