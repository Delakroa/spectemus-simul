package com.watchtogether.backend.room;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

import org.springframework.stereotype.Component;

interface SecureValueGenerator {

    String roomId();

    String credential();

    UUID participantId();
}

@Component
class DefaultSecureValueGenerator implements SecureValueGenerator {

    private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();

    private final SecureRandom secureRandom = new SecureRandom();

    @Override
    public String roomId() {
        return randomBase64Url(16);
    }

    @Override
    public String credential() {
        return randomBase64Url(32);
    }

    @Override
    public UUID participantId() {
        return UUID.randomUUID();
    }

    private String randomBase64Url(int byteCount) {
        byte[] bytes = new byte[byteCount];
        secureRandom.nextBytes(bytes);
        return BASE64_URL.encodeToString(bytes);
    }
}
