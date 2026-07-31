package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

final class SmtpEmailChallengeDelivery implements EmailChallengeDelivery {

    private final JavaMailSender mailSender;
    private final String from;

    SmtpEmailChallengeDelivery(JavaMailSender mailSender, String from) {
        this.mailSender = mailSender;
        this.from = from;
    }

    @Override
    public void deliver(String email, String code, Instant expiresAt) {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("Spectemus Simul — код входа");
        message.setText("Код входа: " + code + "\n\nОн действует до "
                + expiresAt.truncatedTo(ChronoUnit.MINUTES) + " UTC. "
                + "Никому не сообщайте этот код.");
        mailSender.send(message);
    }
}
