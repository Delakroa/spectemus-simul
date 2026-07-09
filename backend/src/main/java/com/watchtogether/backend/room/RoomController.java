package com.watchtogether.backend.room;

import java.net.URI;

import jakarta.validation.Valid;

import com.watchtogether.backend.room.RoomCreationService.CreationResult;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rooms")
public class RoomController {

    private static final String SESSION_COOKIE = "wt_session";

    private final RoomCreationService roomCreationService;
    private final RoomProperties properties;

    RoomController(RoomCreationService roomCreationService, RoomProperties properties) {
        this.roomCreationService = roomCreationService;
        this.properties = properties;
    }

    @PostMapping
    ResponseEntity<CreateRoomResponse> createRoom(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateRoomRequest request) {
        CreationResult result =
                roomCreationService.create(idempotencyKey, request.hostDisplayName());
        String roomId = result.response().room().roomId();
        ResponseCookie sessionCookie = ResponseCookie.from(SESSION_COOKIE, result.sessionCredential())
                .httpOnly(true)
                .secure(properties.sessionCookieSecure())
                .sameSite("Strict")
                .path("/api/v1/rooms")
                .maxAge(result.cookieMaxAge())
                .build();

        return ResponseEntity.created(URI.create("/api/v1/rooms/" + roomId))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, sessionCookie.toString())
                .body(result.response());
    }
}
