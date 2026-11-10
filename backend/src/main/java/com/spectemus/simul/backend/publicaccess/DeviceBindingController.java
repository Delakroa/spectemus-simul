package com.spectemus.simul.backend.publicaccess;

import java.util.UUID;

import jakarta.validation.Valid;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v2")
@ConditionalOnProperty(
        prefix = "spectemus-simul.public-access",
        name = "device-binding-enabled",
        havingValue = "true")
class DeviceBindingController {

    private static final String ACCOUNT_COOKIE = "wt_account";

    private final DeviceBindingService service;

    DeviceBindingController(DeviceBindingService service) {
        this.service = service;
    }

    @PostMapping("/auth/device-bindings")
    ResponseEntity<DeviceBindingStartedResponse> startBinding() {
        return ResponseEntity.status(201)
                .cacheControl(CacheControl.noStore())
                .body(service.startBinding());
    }

    @PostMapping("/auth/device-bindings/{bindingId}/approve")
    ResponseEntity<Void> approveBinding(
            @PathVariable UUID bindingId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            @Valid @RequestBody ApproveDeviceBindingRequest request) {
        service.approveBinding(bindingId, accountCredential, request.userCode());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/auth/device-bindings/{bindingId}/token")
    ResponseEntity<DeviceBindingSessionResponse> exchangeBinding(
            @PathVariable UUID bindingId, @Valid @RequestBody ExchangeDeviceBindingRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.exchangeBinding(bindingId, request.deviceCode()));
    }

    @PostMapping("/account/device-sessions/revoke")
    ResponseEntity<Void> revokeDeviceSession(@Valid @RequestBody RevokeDeviceSessionRequest request) {
        service.revokeDeviceSession(request.deviceCredential());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
