package com.watchtogether.backend.feedback;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import com.watchtogether.backend.api.CorrelationIdFilter;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/feedback")
class FeedbackController {

    private final FeedbackService feedbackService;

    FeedbackController(FeedbackService feedbackService) {
        this.feedbackService = feedbackService;
    }

    @PostMapping
    ResponseEntity<FeedbackResponse> submitFeedback(
            @Valid @RequestBody FeedbackRequest request, HttpServletRequest servletRequest) {
        FeedbackResponse response = feedbackService.record(request, correlationId(servletRequest));

        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    private String correlationId(HttpServletRequest request) {
        Object value = request.getAttribute(CorrelationIdFilter.ATTRIBUTE);
        return value instanceof String id ? id : java.util.UUID.randomUUID().toString();
    }
}
