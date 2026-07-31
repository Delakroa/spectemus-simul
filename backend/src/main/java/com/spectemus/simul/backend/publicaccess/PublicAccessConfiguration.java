package com.spectemus.simul.backend.publicaccess;

import java.util.Properties;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

/** Beans which exist only after the explicit Internet-mode switch has been validated. */
@Configuration
@ConditionalOnProperty(
        prefix = "spectemus-simul.public-access",
        name = "enabled",
        havingValue = "true")
class PublicAccessConfiguration {

    @Bean
    DataSource publicAccessDataSource(PublicAccessProperties properties) {
        return new PublicAccessDataSource(
                properties.jdbcUrl(), properties.jdbcUsername(), properties.jdbcPassword());
    }

    @Bean
    Flyway publicAccessFlyway(DataSource publicAccessDataSource) {
        Flyway flyway = Flyway.configure()
                .dataSource(publicAccessDataSource)
                .locations("classpath:db/migration")
                .load();
        flyway.migrate();
        return flyway;
    }

    @Bean
    PublicAccessStore publicAccessStore(DataSource publicAccessDataSource, Flyway publicAccessFlyway) {
        return new JdbcPublicAccessStore(publicAccessDataSource);
    }

    @Bean
    JavaMailSender publicAccessMailSender(PublicAccessProperties properties) {
        PublicAccessProperties.EmailProperties email = properties.email();
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(email.host());
        sender.setPort(email.port());
        sender.setUsername(email.username());
        sender.setPassword(email.password());
        Properties mailProperties = sender.getJavaMailProperties();
        mailProperties.put("mail.smtp.auth", "true");
        mailProperties.put("mail.smtp.starttls.enable", Boolean.toString(email.starttlsEnabled()));
        mailProperties.put("mail.smtp.connectiontimeout", "5000");
        mailProperties.put("mail.smtp.timeout", "5000");
        mailProperties.put("mail.smtp.writetimeout", "5000");
        return sender;
    }

    @Bean
    EmailChallengeDelivery emailChallengeDelivery(
            JavaMailSender publicAccessMailSender, PublicAccessProperties properties) {
        return new SmtpEmailChallengeDelivery(publicAccessMailSender, properties.email().from());
    }

    @Bean
    PublicAccessSecrets publicAccessSecrets(PublicAccessProperties properties) {
        return new PublicAccessSecrets(properties.identityPepper());
    }

    @Bean
    PublicAccessService publicAccessService(
            PublicAccessStore publicAccessStore,
            EmailChallengeDelivery emailChallengeDelivery,
            PublicAccessSecrets publicAccessSecrets,
            PublicAccessProperties properties,
            java.time.Clock clock) {
        return new PublicAccessService(
                publicAccessStore,
                emailChallengeDelivery,
                publicAccessSecrets,
                properties,
                clock);
    }
}
