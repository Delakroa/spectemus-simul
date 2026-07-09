package com.watchtogether.backend.room;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import jakarta.servlet.http.Cookie;

import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationOutcome;
import com.watchtogether.backend.room.RoomRealtimeStore.AuthenticationResult;

import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.WebUtils;

@Component
class RoomWebSocketAuthenticationInterceptor implements HandshakeInterceptor {

    static final String ROOM_ID_ATTRIBUTE = "watchTogether.roomId";
    static final String PARTICIPANT_ID_ATTRIBUTE = "watchTogether.participantId";
    static final String SESSION_HASH_ATTRIBUTE = "watchTogether.sessionHash";

    private static final String SESSION_COOKIE = "wt_session";
    private static final Pattern EVENTS_PATH_PATTERN = Pattern.compile(
            "^/api/v1/rooms/([A-Za-z0-9_-]{22})/events$");
    private static final Pattern SESSION_CREDENTIAL_PATTERN =
            Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final RoomRealtimeStore store;

    RoomWebSocketAuthenticationInterceptor(RoomRealtimeStore store) {
        this.store = store;
    }

    @Override
    public boolean beforeHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Map<String, Object> attributes) {
        if (request.getURI().getRawQuery() != null) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }

        Matcher path = EVENTS_PATH_PATTERN.matcher(request.getURI().getPath());
        if (!path.matches()) {
            response.setStatusCode(HttpStatus.NOT_FOUND);
            return false;
        }
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            response.setStatusCode(HttpStatus.INTERNAL_SERVER_ERROR);
            return false;
        }

        Cookie sessionCookie =
                WebUtils.getCookie(servletRequest.getServletRequest(), SESSION_COOKIE);
        if (sessionCookie == null
                || !SESSION_CREDENTIAL_PATTERN.matcher(sessionCookie.getValue()).matches()) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        String roomId = path.group(1);
        String sessionHash = SecureHash.sha256(sessionCookie.getValue());
        AuthenticationResult authentication = store.authenticateAndLoad(roomId, sessionHash);
        if (authentication.outcome() == AuthenticationOutcome.ROOM_UNAVAILABLE) {
            response.setStatusCode(HttpStatus.NOT_FOUND);
            return false;
        }
        if (authentication.outcome() == AuthenticationOutcome.AUTHENTICATION_REQUIRED) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        attributes.put(ROOM_ID_ATTRIBUTE, roomId);
        attributes.put(PARTICIPANT_ID_ATTRIBUTE, authentication.participantId());
        attributes.put(SESSION_HASH_ATTRIBUTE, sessionHash);
        return true;
    }

    @Override
    public void afterHandshake(
            ServerHttpRequest request,
            ServerHttpResponse response,
            WebSocketHandler wsHandler,
            Exception exception) {}
}
