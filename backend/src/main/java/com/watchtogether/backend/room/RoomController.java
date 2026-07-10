package com.watchtogether.backend.room;

import java.net.URI;
import java.time.Duration;

import jakarta.validation.Valid;

import com.watchtogether.backend.room.RoomCreationService.CreationResult;
import com.watchtogether.backend.room.RoomJoinService.JoinResponse;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
    private final RoomRestoreService roomRestoreService;
    private final RoomJoinService roomJoinService;
    private final RoomCloseService roomCloseService;
    private final RoomLeaveService roomLeaveService;
    private final LiveKitTokenService liveKitTokenService;
    private final RoomProperties properties;

    RoomController(
            RoomCreationService roomCreationService,
            RoomRestoreService roomRestoreService,
            RoomJoinService roomJoinService,
            RoomCloseService roomCloseService,
            RoomLeaveService roomLeaveService,
            LiveKitTokenService liveKitTokenService,
            RoomProperties properties) {
        this.roomCreationService = roomCreationService;
        this.roomRestoreService = roomRestoreService;
        this.roomJoinService = roomJoinService;
        this.roomCloseService = roomCloseService;
        this.roomLeaveService = roomLeaveService;
        this.liveKitTokenService = liveKitTokenService;
        this.properties = properties;
    }

    @PostMapping
    ResponseEntity<CreateRoomResponse> createRoom(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateRoomRequest request) {
        CreationResult result =
                roomCreationService.create(idempotencyKey, request.hostDisplayName());
        String roomId = result.response().room().roomId();
        ResponseCookie sessionCookie =
                sessionCookie(result.sessionCredential(), result.cookieMaxAge());

        return ResponseEntity.created(URI.create("/api/v1/rooms/" + roomId))
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, sessionCookie.toString())
                .body(result.response());
    }

    @GetMapping("/{roomId}")
    ResponseEntity<GetRoomResponse> getRoom(
            @PathVariable String roomId,
            @CookieValue(name = SESSION_COOKIE, required = false) String sessionCredential) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(roomRestoreService.restore(roomId, sessionCredential));
    }

    @PostMapping("/{roomId}/join")
    ResponseEntity<JoinRoomResponse> joinRoom(
            @PathVariable String roomId,
            @CookieValue(name = SESSION_COOKIE, required = false) String sessionCredential,
            @Valid @RequestBody JoinRoomRequest request) {
        JoinResponse result =
                roomJoinService.join(roomId, request.displayName(), sessionCredential);
        ResponseCookie sessionCookie =
                sessionCookie(result.sessionCredential(), result.cookieMaxAge());

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, sessionCookie.toString())
                .body(result.response());
    }

    @PostMapping("/{roomId}/leave")
    ResponseEntity<Void> leaveRoom(
            @PathVariable String roomId,
            @CookieValue(name = SESSION_COOKIE, required = false) String sessionCredential) {
        roomLeaveService.leave(roomId, sessionCredential);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    @PostMapping("/{roomId}/livekit-token")
    ResponseEntity<LiveKitTokenResponse> mintLiveKitToken(
            @PathVariable String roomId,
            @CookieValue(name = SESSION_COOKIE, required = false) String sessionCredential) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(liveKitTokenService.mint(roomId, sessionCredential));
    }

    @PostMapping("/{roomId}/close")
    ResponseEntity<Void> closeRoom(
            @PathVariable String roomId,
            @CookieValue(name = SESSION_COOKIE, required = false) String sessionCredential,
            @RequestHeader(name = "X-Host-Secret", required = false) String hostSecret) {
        roomCloseService.close(roomId, sessionCredential, hostSecret);
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    private ResponseCookie sessionCookie(String value, Duration maxAge) {
        return ResponseCookie.from(SESSION_COOKIE, value)
                .httpOnly(true)
                .secure(properties.sessionCookieSecure())
                .sameSite("Strict")
                .path("/api/v1/rooms")
                .maxAge(maxAge)
                .build();
    }
}
