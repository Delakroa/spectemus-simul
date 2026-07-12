package com.watchtogether.backend.feedback;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import com.watchtogether.backend.api.ApiException;
import com.watchtogether.backend.api.ApiFieldViolation;
import com.watchtogether.backend.api.CorrelationIdFilter;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/feedback")
class FeedbackController {

    private static final String ADMIN_TOKEN_HEADER = "X-Feedback-Admin-Token";

    private final FeedbackService feedbackService;
    private final FeedbackOperationsProperties properties;

    FeedbackController(FeedbackService feedbackService, FeedbackOperationsProperties properties) {
        this.feedbackService = feedbackService;
        this.properties = properties;
    }

    @PostMapping
    ResponseEntity<FeedbackResponse> submitFeedback(
            @Valid @RequestBody FeedbackRequest request, HttpServletRequest servletRequest) {
        FeedbackResponse response = feedbackService.record(request, correlationId(servletRequest));

        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @GetMapping("/reports")
    ResponseEntity<FeedbackReportListResponse> listReports(
            @RequestHeader(name = ADMIN_TOKEN_HEADER, required = false) String adminToken,
            @RequestParam(name = "limit", required = false) Integer limit) {
        requireAdmin(adminToken);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(feedbackService.listReports(effectiveLimit(limit)));
    }

    @GetMapping("/reports/export")
    ResponseEntity<FeedbackReportExportResponse> exportReports(
            @RequestHeader(name = ADMIN_TOKEN_HEADER, required = false) String adminToken,
            @RequestParam(name = "limit", required = false) Integer limit) {
        requireAdmin(adminToken);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(feedbackService.exportReports(effectiveLimit(limit)));
    }

    @GetMapping("/reports/{feedbackId}")
    ResponseEntity<FeedbackReport> getReport(
            @RequestHeader(name = ADMIN_TOKEN_HEADER, required = false) String adminToken,
            @PathVariable UUID feedbackId) {
        requireAdmin(adminToken);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(feedbackService.getReport(feedbackId));
    }

    @PatchMapping("/reports/{feedbackId}")
    ResponseEntity<FeedbackReport> triageReport(
            @RequestHeader(name = ADMIN_TOKEN_HEADER, required = false) String adminToken,
            @PathVariable UUID feedbackId,
            @Valid @RequestBody FeedbackTriageRequest request) {
        requireAdmin(adminToken);

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(feedbackService.triage(feedbackId, request));
    }

    private void requireAdmin(String providedToken) {
        if (!properties.adminEnabled()) {
            throw ApiException.forbidden(
                    "FEEDBACK_OPERATIONS_DISABLED",
                    "Операции feedback отключены",
                    "Настройте FEEDBACK_ADMIN_TOKEN перед чтением beta feedback.");
        }
        if (!constantTimeEquals(properties.adminToken(), providedToken)) {
            throw ApiException.forbidden(
                    "FEEDBACK_ADMIN_FORBIDDEN",
                    "Доступ запрещён",
                    "Передайте корректный X-Feedback-Admin-Token.");
        }
    }

    private boolean constantTimeEquals(String expected, String actual) {
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] actualBytes = (actual == null ? "" : actual).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedBytes, actualBytes);
    }

    private int effectiveLimit(Integer requestedLimit) {
        if (requestedLimit == null) {
            return properties.exportLimit();
        }
        if (requestedLimit <= 0) {
            throw ApiException.validation(new ApiFieldViolation(
                    "limit",
                    "INVALID_FIELD",
                    "limit должен быть положительным числом."));
        }

        return Math.min(requestedLimit, properties.exportLimit());
    }

    private String correlationId(HttpServletRequest request) {
        Object value = request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
        return value instanceof String id ? id : java.util.UUID.randomUUID().toString();
    }
}
