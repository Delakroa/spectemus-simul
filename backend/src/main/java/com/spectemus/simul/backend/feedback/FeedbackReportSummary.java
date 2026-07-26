package com.spectemus.simul.backend.feedback;

import java.time.Instant;
import java.util.UUID;

import com.spectemus.simul.backend.room.ParticipantRole;

public record FeedbackReportSummary(
        UUID feedbackId,
        String correlationId,
        Instant receivedAt,
        FeedbackOutcome outcome,
        FeedbackReason reason,
        String roomId,
        ParticipantRole participantRole,
        UUID relatedCorrelationId,
        FeedbackTriageStatus triageStatus,
        FeedbackSeverity severity,
        String assignee,
        String messagePreview) {}
