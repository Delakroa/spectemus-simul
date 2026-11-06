package com.spectemus.simul.backend.publicaccess;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

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
    /** Twirp maps application code {@code not_found} to HTTP 404. */
    private static final int TWIRP_NOT_FOUND_HTTP_STATUS = 404;

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

    /**
     * Idempotent success only for a Twirp JSON error with exact {@code code == "not_found"} and the
     * matching HTTP status. HTML 404 pages, empty bodies, malformed JSON, or {@code not_found} under
     * another status stay fail-closed.
     */
    private static boolean isParticipantMissing(JsonPoster.Response response) {
        if (response.statusCode() != TWIRP_NOT_FOUND_HTTP_STATUS) {
            return false;
        }
        return readTwirpErrorCode(response.body()).filter("not_found"::equals).isPresent();
    }

    /**
     * Reads a top-level JSON object string field {@code code}. Rejects arrays, numbers, HTML and
     * malformed payloads without accepting a loose substring match.
     */
    private static Optional<String> readTwirpErrorCode(String body) {
        if (body == null) {
            return Optional.empty();
        }
        String trimmed = body.strip();
        if (trimmed.isEmpty() || trimmed.charAt(0) != '{') {
            return Optional.empty();
        }
        int index = 1;
        int length = trimmed.length();
        while (index < length) {
            index = skipJsonWhitespace(trimmed, index);
            if (index >= length) {
                return Optional.empty();
            }
            if (trimmed.charAt(index) == '}') {
                return Optional.empty();
            }
            if (trimmed.charAt(index) != '"') {
                return Optional.empty();
            }
            ParsedString field = readJsonString(trimmed, index);
            if (field == null) {
                return Optional.empty();
            }
            index = skipJsonWhitespace(trimmed, field.endIndex());
            if (index >= length || trimmed.charAt(index) != ':') {
                return Optional.empty();
            }
            index = skipJsonWhitespace(trimmed, index + 1);
            if (index >= length) {
                return Optional.empty();
            }
            if ("code".equals(field.value())) {
                if (trimmed.charAt(index) != '"') {
                    return Optional.empty();
                }
                ParsedString value = readJsonString(trimmed, index);
                return value == null ? Optional.empty() : Optional.of(value.value());
            }
            index = skipJsonValue(trimmed, index);
            if (index < 0) {
                return Optional.empty();
            }
            index = skipJsonWhitespace(trimmed, index);
            if (index < length && trimmed.charAt(index) == ',') {
                index += 1;
            }
        }
        return Optional.empty();
    }

    private static int skipJsonWhitespace(String text, int index) {
        while (index < text.length()) {
            char character = text.charAt(index);
            if (character != ' ' && character != '\n' && character != '\r' && character != '\t') {
                break;
            }
            index += 1;
        }
        return index;
    }

    private static ParsedString readJsonString(String text, int startQuoteIndex) {
        if (startQuoteIndex >= text.length() || text.charAt(startQuoteIndex) != '"') {
            return null;
        }
        StringBuilder value = new StringBuilder();
        int index = startQuoteIndex + 1;
        while (index < text.length()) {
            char character = text.charAt(index);
            if (character == '"') {
                return new ParsedString(value.toString(), index + 1);
            }
            if (character == '\\') {
                index += 1;
                if (index >= text.length()) {
                    return null;
                }
                char escaped = text.charAt(index);
                switch (escaped) {
                    case '"' -> value.append('"');
                    case '\\' -> value.append('\\');
                    case '/' -> value.append('/');
                    case 'b' -> value.append('\b');
                    case 'f' -> value.append('\f');
                    case 'n' -> value.append('\n');
                    case 'r' -> value.append('\r');
                    case 't' -> value.append('\t');
                    case 'u' -> {
                        if (index + 4 >= text.length()) {
                            return null;
                        }
                        try {
                            int codePoint = Integer.parseInt(text.substring(index + 1, index + 5), 16);
                            value.append((char) codePoint);
                            index += 4;
                        } catch (NumberFormatException ignored) {
                            return null;
                        }
                    }
                    default -> {
                        return null;
                    }
                }
            } else if (character < 0x20) {
                return null;
            } else {
                value.append(character);
            }
            index += 1;
        }
        return null;
    }

    private static int skipJsonValue(String text, int index) {
        index = skipJsonWhitespace(text, index);
        if (index >= text.length()) {
            return -1;
        }
        char character = text.charAt(index);
        return switch (character) {
            case '"' -> {
                ParsedString string = readJsonString(text, index);
                yield string == null ? -1 : string.endIndex();
            }
            case '{' -> skipJsonContainer(text, index, '{', '}');
            case '[' -> skipJsonContainer(text, index, '[', ']');
            case 't' -> text.startsWith("true", index) ? index + 4 : -1;
            case 'f' -> text.startsWith("false", index) ? index + 5 : -1;
            case 'n' -> text.startsWith("null", index) ? index + 4 : -1;
            default -> {
                if (character == '-' || Character.isDigit(character)) {
                    int cursor = index + 1;
                    while (cursor < text.length()) {
                        char digit = text.charAt(cursor);
                        if (!(Character.isDigit(digit)
                                || digit == '.'
                                || digit == 'e'
                                || digit == 'E'
                                || digit == '+'
                                || digit == '-')) {
                            break;
                        }
                        cursor += 1;
                    }
                    yield cursor;
                }
                yield -1;
            }
        };
    }

    private static int skipJsonContainer(String text, int start, char open, char close) {
        int depth = 0;
        boolean inString = false;
        boolean escape = false;
        for (int index = start; index < text.length(); index++) {
            char character = text.charAt(index);
            if (inString) {
                if (escape) {
                    escape = false;
                } else if (character == '\\') {
                    escape = true;
                } else if (character == '"') {
                    inString = false;
                }
                continue;
            }
            if (character == '"') {
                inString = true;
            } else if (character == open) {
                depth += 1;
            } else if (character == close) {
                depth -= 1;
                if (depth == 0) {
                    return index + 1;
                }
            }
        }
        return -1;
    }

    private record ParsedString(String value, int endIndex) {}

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
