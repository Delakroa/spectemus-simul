package com.spectemus.simul.backend.publicaccess;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Internet LiveKit token boundary. Absent unless public access and public LiveKit are both
 * explicitly enabled with fail-closed credentials.
 */
@RestController
@RequestMapping("/api/v2")
@ConditionalOnProperty(
        prefix = "spectemus-simul.public-access",
        name = "enabled",
        havingValue = "true")
@ConditionalOnProperty(
        prefix = "spectemus-simul.public-livekit",
        name = "enabled",
        havingValue = "true")
class PublicLiveKitTokenController {

    private static final String ACCOUNT_COOKIE = "wt_account";

    private final PublicLiveKitTokenService service;

    PublicLiveKitTokenController(PublicLiveKitTokenService service) {
        this.service = service;
    }

    @PostMapping("/public-rooms/{publicRoomId}/livekit-token")
    ResponseEntity<PublicLiveKitTokenResponse> mintLiveKitToken(
            @PathVariable UUID publicRoomId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.mint(publicRoomId, accountCredential));
    }
}