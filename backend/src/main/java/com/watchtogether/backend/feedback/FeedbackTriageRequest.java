package com.watchtogether.backend.feedback;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record FeedbackTriageRequest(
        @NotNull FeedbackTriageStatus status,
        FeedbackSeverity severity,
        @Size(max = 120) String assignee,
        @Size(max = 1000) String note) {}
