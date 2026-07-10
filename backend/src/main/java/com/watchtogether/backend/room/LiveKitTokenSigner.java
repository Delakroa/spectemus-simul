package com.watchtogether.backend.room;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

@Component
class LiveKitTokenSigner {

    private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();
    private static final String HMAC_SHA256 = "HmacSHA256";

    String sign(
            LiveKitProperties properties,
            String roomName,
            String participantIdentity,
            String displayName,
            boolean canPublish,
            boolean canPublishData,
            Instant issuedAt,
            Instant expiresAt) {
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("alg", "HS256");
        header.put("typ", "JWT");

        Map<String, Object> videoGrant = new LinkedHashMap<>();
        videoGrant.put("room", roomName);
        videoGrant.put("roomJoin", true);
        videoGrant.put("canPublish", canPublish);
        videoGrant.put("canSubscribe", true);
        videoGrant.put("canPublishData", canPublishData);

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("iss", properties.apiKey());
        payload.put("sub", participantIdentity);
        payload.put("name", displayName);
        payload.put("nbf", issuedAt.getEpochSecond());
        payload.put("iat", issuedAt.getEpochSecond());
        payload.put("exp", expiresAt.getEpochSecond());
        payload.put("video", videoGrant);

        String signingInput = base64Json(header) + "." + base64Json(payload);
        return signingInput + "." + signHmac(signingInput, properties.apiSecret());
    }

    private String base64Json(Map<String, Object> value) {
        return BASE64_URL.encodeToString(toJson(value).getBytes(StandardCharsets.UTF_8));
    }

    private String toJson(Map<String, Object> value) {
        return value.entrySet().stream()
                .map(entry -> quote(entry.getKey()) + ":" + toJsonValue(entry.getValue()))
                .collect(Collectors.joining(",", "{", "}"));
    }

    @SuppressWarnings("unchecked")
    private String toJsonValue(Object value) {
        return switch (value) {
            case String string -> quote(string);
            case Number number -> number.toString();
            case Boolean bool -> bool.toString();
            case Map<?, ?> map -> toJson((Map<String, Object>) map);
            case null -> "null";
            default -> throw new IllegalArgumentException(
                    "Unsupported LiveKit token claim value: " + value.getClass().getName());
        };
    }

    private String quote(String value) {
        StringBuilder builder = new StringBuilder(value.length() + 2);
        builder.append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case '\b' -> builder.append("\\b");
                case '\f' -> builder.append("\\f");
                case '\n' -> builder.append("\\n");
                case '\r' -> builder.append("\\r");
                case '\t' -> builder.append("\\t");
                default -> {
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", (int) character));
                    } else {
                        builder.append(character);
                    }
                }
            }
        }
        builder.append('"');
        return builder.toString();
    }

    private String signHmac(String signingInput, String secret) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            return BASE64_URL.encodeToString(mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8)));
        } catch (InvalidKeyException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Unable to sign LiveKit token", exception);
        }
    }
}
