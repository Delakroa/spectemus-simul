package com.spectemus.simul.backend.publicaccess;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v2")
@ConditionalOnProperty(prefix = "spectemus-simul.public-access", name = "enabled", havingValue = "true")
@ConditionalOnProperty(prefix = "spectemus-simul.public-livekit", name = "enabled", havingValue = "true")
class PublicConnectionTelemetryController {

    private final PublicConnectionTelemetryService service;

    PublicConnectionTelemetryController(PublicConnectionTelemetryService service) {
        this.service = service;
    }

    @PostMapping("/public-rooms/{publicRoomId}/connection-telemetry")
    ResponseEntity<Void> record(
            @PathVariable UUID publicRoomId,
            @CookieValue(name = "wt_account", required = false) String accountCredential,
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody PublicConnectionTelemetryRequest request) {
        service.record(publicRoomId, resolveCredential(accountCredential, authorization), request.type());
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore()).build();
    }

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
