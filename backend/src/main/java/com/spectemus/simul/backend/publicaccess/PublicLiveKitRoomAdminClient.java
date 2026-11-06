package com.spectemus.simul.backend.publicaccess;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;

import com.spectemus.simul.backend.room.LiveKitTokenSigner;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * LiveKit RoomService admin client for Internet rooms. Uses JDK HttpClient only; never falls back
 * to LAN LiveKit settings or request Host headers.
 */
final class PublicLiveKitRoomAdminClient {

    private static final Logger log = LoggerFactory.getLogger(PublicLiveKitRoomAdminClient.class);
    private static final String REMOVE_PARTICIPANT_PATH =
            "/twirp/livekit.RoomService/RemoveParticipant";

    private final PublicLiveKitProperties properties;
    private final LiveKitTokenSigner signer;
    private final Clock clock;
    private final JsonPoster jsonPoster;
    private final URI removeParticipantUri;

    PublicLiveKitRoomAdminClient(
            PublicLiveKitProperties properties, LiveKitTokenSigner signer, Clock clock) {
        this(properties, signer, clock, new JdkJsonPoster(properties));
    }

    PublicLiveKitRoomAdminClient(
            PublicLiveKitProperties properties,
            LiveKitTokenSigner signer,
            Clock clock,
            JsonPoster jsonPoster) {
        this.properties = properties;
        this.signer = signer;
        this.clock = clock;
        this.jsonPoster = jsonPoster;
        this.removeParticipantUri = URI.create(trimTrailingSlash(properties.apiUrl().strip())
                + REMOVE_PARTICIPANT_PATH);
    }

    /**
     * Removes a participant from the opaque LiveKit room. Missing participant is treated as
     * success so revoke stays idempotent.
     */
    void removeParticipant(String roomName, String identity) {
        Instant issuedAt = Instant.now(clock);
        Instant expiresAt = issuedAt.plus(properties.adminTokenTtl());
        String adminToken = signer.signRoomAdmin(
                properties.apiKey(),
                properties.apiSecret(),
                roomName,
                issuedAt,
                expiresAt);
        String body = "{\"room\":"
                + jsonString(roomName)
                + ",\"identity\":"
                + jsonString(identity)
                + "}";
        try {
            JsonPoster.Response response =
                    jsonPoster.postJson(removeParticipantUri, adminToken, body, properties.adminTimeout());
            if (isSuccess(response.statusCode()) || isParticipantMissing(response)) {
                return;
            }
            log.warn("Public LiveKit RemoveParticipant failed status={}", response.statusCode());
            throw disconnectFailed();
        } catch (PublicLiveKitDisconnectException exception) {
            throw exception;
        } catch (IOException | InterruptedException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.warn("Public LiveKit RemoveParticipant transport failure");
            throw disconnectFailed();
        }
    }

    private static boolean isSuccess(int statusCode) {
        return statusCode >= 200 && statusCode < 300;
    }

    private static boolean isParticipantMissing(JsonPoster.Response response) {
        if (response.statusCode() == 404) {
            return true;
        }
        String body = response.body();
        if (body == null || body.isBlank()) {
            return false;
        }
        String normalized = body.toLowerCase(Locale.ROOT);
        return normalized.contains("\"not_found\"") || normalized.contains("\"notfound\"");
    }

    private static PublicLiveKitDisconnectException disconnectFailed() {
        return new PublicLiveKitDisconnectException();
    }

    private static String trimTrailingSlash(String value) {
        if (value.endsWith("/")) {
            return value.substring(0, value.length() - 1);
        }
        return value;
    }

    private static String jsonString(String value) {
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

    @FunctionalInterface
    interface JsonPoster {
        Response postJson(URI uri, String bearerToken, String jsonBody, java.time.Duration timeout)
                throws IOException, InterruptedException;

        record Response(int statusCode, String body) {}
    }

    private static final class JdkJsonPoster implements JsonPoster {

        private final HttpClient httpClient;

        private JdkJsonPoster(PublicLiveKitProperties properties) {
            this.httpClient = HttpClient.newBuilder()
                    .connectTimeout(properties.adminTimeout())
                    .build();
        }

        @Override
        public Response postJson(URI uri, String bearerToken, String jsonBody, java.time.Duration timeout)
                throws IOException, InterruptedException {
            HttpRequest request = HttpRequest.newBuilder(uri)
                    .timeout(timeout)
                    .header("Authorization", "Bearer " + bearerToken)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return new Response(response.statusCode(), response.body());
        }
    }
}
