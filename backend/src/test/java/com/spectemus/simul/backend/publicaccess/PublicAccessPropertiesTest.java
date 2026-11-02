package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class PublicAccessPropertiesTest {

    @Test
    void staysDisabledWithoutDatabaseOrMailSettings() {
        PublicAccessProperties properties =
                new PublicAccessProperties(false, null, null, null, null, null, null, null);

        assertThat(properties.isEnabled()).isFalse();
    }

    @Test
    void rejectsEnabledAccessWhenDatabaseUrlIsMissing() {
        assertThatThrownBy(() -> enabled(" ", "spectemus", "password", pepper(), true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("jdbc-url");
    }

    @Test
    void rejectsEnabledAccessWhenCookieIsNotSecure() {
        assertThatThrownBy(() -> enabled(
                        "jdbc:postgresql://db.example.test:5432/spectemus",
                        "spectemus",
                        "password",
                        pepper(),
                        false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Secure");
    }

    @Test
    void rejectsEnabledAccessWhenMailSenderIsMissing() {
        assertThatThrownBy(() -> new PublicAccessProperties(
                        true,
                        "jdbc:postgresql://db.example.test:5432/spectemus",
                        "spectemus",
                        "password",
                        pepper(),
                        null,
                        true,
                        new PublicAccessProperties.EmailProperties(null, 587, null, null, null, true)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("email.host");
    }

    private static PublicAccessProperties enabled(
            String jdbcUrl, String username, String password, String pepper, boolean cookieSecure) {
        return new PublicAccessProperties(
                true,
                jdbcUrl,
                username,
                password,
                pepper,
                null,
                cookieSecure,
                new PublicAccessProperties.EmailProperties(
                        "smtp.example.test", 587, "mailer", "password", "login@example.test", true));
    }

    private static String pepper() {
        return "test-identity-pepper-at-least-32-characters";
    }
}
