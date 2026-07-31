package com.spectemus.simul.backend.publicaccess;

import java.net.URI;
import java.time.Duration;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import com.spectemus.simul.backend.api.CorrelationIdFilter;
import com.spectemus.simul.backend.publicaccess.PublicAccessService.AccountSessionResult;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
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

/** HTTP boundary for private Internet-room access. It is absent unless explicitly configured. */
@RestController
@RequestMapping("/api/v2")
@ConditionalOnProperty(
        prefix = "spectemus-simul.public-access",
        name = "enabled",
        havingValue = "true")
class PublicAccessController {

    private static final String ACCOUNT_COOKIE = "wt_account";

    private final PublicAccessService service;
    private final PublicAccessProperties properties;

    PublicAccessController(PublicAccessService service, PublicAccessProperties properties) {
        this.service = service;
        this.properties = properties;
    }

    @PostMapping("/auth/email-challenges")
    ResponseEntity<EmailChallengeAcceptedResponse> requestEmailChallenge(
            @Valid @RequestBody EmailChallengeRequest request) {
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(service.requestEmailChallenge(request.email()));
    }

    @PostMapping("/auth/email-challenges/{challengeId}/verify")
    ResponseEntity<AccountProfileResponse> verifyEmailChallenge(
            @PathVariable UUID challengeId,
            @Valid @RequestBody VerifyEmailChallengeRequest request) {
        AccountSessionResult result =
                service.verifyEmailChallenge(challengeId, request.code(), request.displayName());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE, accountCookie(result.sessionCredential(), result.sessionTtl()))
                .body(result.profile());
    }

    @GetMapping("/account")
    ResponseEntity<AccountProfileResponse> currentAccount(
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.currentAccount(accountCredential));
    }

    @PostMapping("/public-rooms")
    ResponseEntity<PublicRoomAccessResponse> createPublicRoom(
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreatePublicRoomRequest request,
            HttpServletRequest servletRequest) {
        PublicRoomAccessResponse response = service.createRoom(
                accountCredential, idempotencyKey, request, correlationId(servletRequest));
        return ResponseEntity.created(URI.create("/api/v2/public-rooms/" + response.room().publicRoomId()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @GetMapping("/public-rooms/{publicRoomId}")
    ResponseEntity<PublicRoomAccessResponse> publicRoom(
            @PathVariable UUID publicRoomId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.roomAccess(publicRoomId, accountCredential));
    }

    @PostMapping("/public-rooms/{publicRoomId}/invites")
    ResponseEntity<PublicInviteCreatedResponse> createInvite(
            @PathVariable UUID publicRoomId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreatePublicInviteRequest request,
            HttpServletRequest servletRequest) {
        return ResponseEntity.<PublicInviteCreatedResponse>status(201)
                .cacheControl(CacheControl.noStore())
                .body(service.createInvite(
                        publicRoomId,
                        accountCredential,
                        idempotencyKey,
                        request,
                        correlationId(servletRequest)));
    }

    @PostMapping("/public-rooms/{publicRoomId}/invites/{inviteId}/revoke")
    ResponseEntity<Void> revokeInvite(
            @PathVariable UUID publicRoomId,
            @PathVariable UUID inviteId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            HttpServletRequest servletRequest) {
        service.revokeInvite(publicRoomId, inviteId, accountCredential, correlationId(servletRequest));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/public-rooms/{publicRoomId}/members/{accountId}/revoke")
    ResponseEntity<Void> revokeMember(
            @PathVariable UUID publicRoomId,
            @PathVariable UUID accountId,
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            HttpServletRequest servletRequest) {
        service.revokeMember(publicRoomId, accountId, accountCredential, correlationId(servletRequest));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/invite-redemptions")
    ResponseEntity<PublicRoomAccessResponse> redeemInvite(
            @CookieValue(name = ACCOUNT_COOKIE, required = false) String accountCredential,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody RedeemPublicInviteRequest request,
            HttpServletRequest servletRequest) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.redeemInvite(
                        accountCredential,
                        idempotencyKey,
                        request,
                        correlationId(servletRequest)));
    }

    private String accountCookie(String credential, Duration maxAge) {
        return ResponseCookie.from(ACCOUNT_COOKIE, credential)
                .httpOnly(true)
                .secure(properties.cookieSecure())
                .sameSite("Strict")
                .path("/api/v2")
                .maxAge(maxAge)
                .build()
                .toString();
    }

    private UUID correlationId(HttpServletRequest request) {
        Object value = request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
        if (value instanceof String id) {
            try {
                return UUID.fromString(id);
            } catch (IllegalArgumentException ignored) {
                // CorrelationIdFilter is authoritative; a UUID fallback remains safe in tests.
            }
        }
        return UUID.randomUUID();
    }
}
