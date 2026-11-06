package com.spectemus.simul.backend.publicaccess;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Produces opaque credentials and stores only domain-separated HMAC fingerprints. */
final class PublicAccessSecrets {

    private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();
    private static final char[] CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();

    private final SecureRandom random;
    private final SecretKeySpec pepper;

    PublicAccessSecrets(String identityPepper) {
        this(new SecureRandom(), identityPepper);
    }

    PublicAccessSecrets(SecureRandom random, String identityPepper) {
        this.random = random;
        this.pepper = new SecretKeySpec(identityPepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    String credential() {
        byte[] value = new byte[32];
        random.nextBytes(value);
        return BASE64_URL.encodeToString(value);
    }

    String emailCode() {
        char[] code = new char[10];
        for (int index = 0; index < code.length; index++) {
            code[index] = CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)];
        }
        return new String(code);
    }

    String emailFingerprint(String normalizedEmail) {
        return fingerprint("email", normalizedEmail);
    }

    String challengeCodeFingerprint(UUID challengeId, String code) {
        return fingerprint("challenge-code", challengeId + "\u0000" + code);
    }

    String credentialFingerprint(String credential) {
        return fingerprint("credential", credential);
    }

    String idempotencyFingerprint(String value) {
        return fingerprint("idempotency", value);
    }

    String requestFingerprint(String operation, String value) {
        return fingerprint("request:" + operation, value);
    }

    /** Opaque LiveKit room name scoped to one Internet room (not the raw publicRoomId). */
    String livekitRoomName(UUID publicRoomId) {
        return fingerprint("livekit-room", publicRoomId.toString());
    }

    /**
     * Room-scoped LiveKit participant identity. The same account receives different values in
     * different Internet rooms, so a LiveKit identity cannot link accounts across rooms.
     */
    String livekitParticipantIdentity(UUID publicRoomId, UUID accountId) {
        return fingerprint("livekit-identity", publicRoomId + "\u0000" + accountId);
    }

    /** Deterministic room-scoped participant UUID derived from the opaque identity material. */
    UUID livekitParticipantId(UUID publicRoomId, UUID accountId) {
        return uuidFromFingerprint("livekit-participant-id", publicRoomId + "\u0000" + accountId);
    }

    private UUID uuidFromFingerprint(String scope, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(pepper);
            byte[] digest = mac.doFinal((scope + "\u0000" + value).getBytes(StandardCharsets.UTF_8));
            long mostSignificant = 0L;
            long leastSignificant = 0L;
            for (int index = 0; index < 8; index++) {
                mostSignificant = (mostSignificant << 8) | (digest[index] & 0xffL);
                leastSignificant = (leastSignificant << 8) | (digest[index + 8] & 0xffL);
            }
            // RFC 4122 variant/version bits keep the value a well-formed UUID without using accountId.
            mostSignificant &= 0xffffffffffff0fffL;
            mostSignificant |= 0x0000000000004000L;
            leastSignificant &= 0x3fffffffffffffffL;
            leastSignificant |= 0x8000000000000000L;
            return new UUID(mostSignificant, leastSignificant);
        } catch (NoSuchAlgorithmException | InvalidKeyException exception) {
            throw new IllegalStateException("HMAC-SHA-256 is unavailable", exception);
        }
    }

    private String fingerprint(String scope, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(pepper);
            return BASE64_URL.encodeToString(mac.doFinal((scope + "\u0000" + value)
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | InvalidKeyException exception) {
            throw new IllegalStateException("HMAC-SHA-256 is unavailable", exception);
        }
    }
}
