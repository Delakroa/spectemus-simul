package com.spectemus.simul.backend.publicaccess;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

class PublicAccessPropertiesTest {

    private static final String JDBC_URL = "jdbc:postgresql://db.example.test:5432/spectemus";
    private static final String JDBC_USERNAME = "spectemus";
    private static final String JDBC_PASSWORD = "not-a-real-db-password";
    private static final String IDENTITY_PEPPER = "test-identity-pepper-at-least-32-characters";
    private static final String EMAIL_HOST = "smtp.example.test";
    private static final String EMAIL_USERNAME = "mailer";
    private static final String EMAIL_PASSWORD = "not-a-real-smtp-password";
    private static final String EMAIL_FROM = "login@example.test";

    @Test
    void staysDisabledWithoutPrivateConfiguration() {
        PublicAccessProperties properties =
                new PublicAccessProperties(false, null, null, null, null, null, null, null);

        assertThat(properties.isEnabled()).isFalse();
    }

    @Test
    void treatsNullEnabledAsDisabled() {
        PublicAccessProperties properties =
                new PublicAccessProperties(null, " ", null, null, " ", null, false, null);

        assertThat(properties.isEnabled()).isFalse();
    }

    @Test
    void rejectsEnabledAccessWhenJdbcUrlIsMissing() {
        assertRejects(() -> enabled(" ", JDBC_USERNAME, JDBC_PASSWORD, IDENTITY_PEPPER, true, email()), "jdbc-url");
        assertRejects(() -> enabled(null, JDBC_USERNAME, JDBC_PASSWORD, IDENTITY_PEPPER, true, email()), "jdbc-url");
    }

    @Test
    void rejectsEnabledAccessWhenJdbcUsernameIsMissing() {
        assertRejects(() -> enabled(JDBC_URL, " ", JDBC_PASSWORD, IDENTITY_PEPPER, true, email()), "jdbc-username");
    }

    @Test
    void rejectsEnabledAccessWhenJdbcPasswordIsMissing() {
        assertRejects(() -> enabled(JDBC_URL, JDBC_USERNAME, null, IDENTITY_PEPPER, true, email()), "jdbc-password");
    }

    @Test
    void rejectsEnabledAccessWhenIdentityPepperIsMissing() {
        assertRejects(() -> enabled(JDBC_URL, JDBC_USERNAME, JDBC_PASSWORD, "", true, email()), "identity-pepper");
    }

    @Test
    void rejectsEnabledAccessWhenCookieIsNotSecure() {
        assertRejects(
                () -> enabled(JDBC_URL, JDBC_USERNAME, JDBC_PASSWORD, IDENTITY_PEPPER, false, email()),
                "cookie-secure");
    }

    @Test
    void rejectsEnabledAccessWhenMailHostIsMissing() {
        assertRejects(
                () -> enabled(
                        JDBC_URL,
                        JDBC_USERNAME,
                        JDBC_PASSWORD,
                        IDENTITY_PEPPER,
                        true,
                        new PublicAccessProperties.EmailProperties(
                                null, 587, EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_FROM, true)),
                "email.host");
    }

    @Test
    void rejectsEnabledAccessWhenMailUsernameIsMissing() {
        assertRejects(
                () -> enabled(
                        JDBC_URL,
                        JDBC_USERNAME,
                        JDBC_PASSWORD,
                        IDENTITY_PEPPER,
                        true,
                        new PublicAccessProperties.EmailProperties(
                                EMAIL_HOST, 587, " ", EMAIL_PASSWORD, EMAIL_FROM, true)),
                "email.username");
    }

    @Test
    void rejectsEnabledAccessWhenMailPasswordIsMissing() {
        assertRejects(
                () -> enabled(
                        JDBC_URL,
                        JDBC_USERNAME,
                        JDBC_PASSWORD,
                        IDENTITY_PEPPER,
                        true,
                        new PublicAccessProperties.EmailProperties(
                                EMAIL_HOST, 587, EMAIL_USERNAME, null, EMAIL_FROM, true)),
                "email.password");
    }

    @Test
    void rejectsEnabledAccessWhenMailFromIsMissing() {
        assertRejects(
                () -> enabled(
                        JDBC_URL,
                        JDBC_USERNAME,
                        JDBC_PASSWORD,
                        IDENTITY_PEPPER,
                        true,
                        new PublicAccessProperties.EmailProperties(
                                EMAIL_HOST, 587, EMAIL_USERNAME, EMAIL_PASSWORD, "", true)),
                "email.from");
    }

    @Test
    void rejectsInvalidMailPort() {
        assertThatThrownBy(() -> new PublicAccessProperties.EmailProperties(
                        EMAIL_HOST, 0, EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_FROM, true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("email.port")
                .hasMessageNotContaining(EMAIL_PASSWORD)
                .hasMessageNotContaining(IDENTITY_PEPPER);
    }

    @Test
    void acceptsCompleteEnabledConfiguration() {
        PublicAccessProperties properties =
                enabled(JDBC_URL, JDBC_USERNAME, JDBC_PASSWORD, IDENTITY_PEPPER, true, email());

        assertThat(properties.isEnabled()).isTrue();
        assertThat(properties.jdbcUrl()).isEqualTo(JDBC_URL);
        assertThat(properties.cookieSecure()).isTrue();
        assertThat(properties.email().host()).isEqualTo(EMAIL_HOST);
    }

    private static void assertRejects(ThrowingCallable call, String propertyName) {
        assertThatThrownBy(call)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining(propertyName)
                .hasMessageNotContaining(JDBC_PASSWORD)
                .hasMessageNotContaining(IDENTITY_PEPPER)
                .hasMessageNotContaining(EMAIL_PASSWORD)
                .hasMessageNotContaining(EMAIL_FROM);
    }

    private static PublicAccessProperties enabled(
            String jdbcUrl,
            String jdbcUsername,
            String jdbcPassword,
            String identityPepper,
            boolean cookieSecure,
            PublicAccessProperties.EmailProperties email) {
        return new PublicAccessProperties(
                true, jdbcUrl, jdbcUsername, jdbcPassword, identityPepper, null, cookieSecure, email);
    }

    private static PublicAccessProperties.EmailProperties email() {
        return new PublicAccessProperties.EmailProperties(
                EMAIL_HOST, 587, EMAIL_USERNAME, EMAIL_PASSWORD, EMAIL_FROM, true);
    }
}
