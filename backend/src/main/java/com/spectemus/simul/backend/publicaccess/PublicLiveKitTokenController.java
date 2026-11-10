package com.spectemus.simul.backend.publicaccess;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
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
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.mint(publicRoomId, resolveCredential(accountCredential, authorization)));
    }

    /** Cookie remains preferred; desktop device sessions may use Authorization Bearer. */
    private static String resolveCredential(String accountCredential, String authorization) {
        if (accountCredential != null && !accountCredential.isBlank()) {
            return accountCredential;
        }
        if (authorization == null) {
            return null;
        }
        String value = authorization.strip();
        if (value.length() > 7 && value.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return value.substring(7).strip();
        }
        return null;
    }
}
