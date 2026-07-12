package com.watchtogether.backend.feedback;

import java.time.Instant;
import java.util.UUID;

import com.watchtogether.backend.room.ParticipantRole;

public record FeedbackReport(
        UUID feedbackId,
        String correlationId,
        Instant receivedAt,
        FeedbackOutcome outcome,
        FeedbackReason reason,
        String message,
        String roomId,
        ParticipantRole participantRole,
        UUID relatedCorrelationId,
        FeedbackClientMetadata metadata,
        FeedbackTriageStatus triageStatus,
        FeedbackSeverity severity,
        String assignee,
        String triageNote,
        Instant triagedAt) {

    public FeedbackReport {
        triageStatus = triageStatus == null ? FeedbackTriageStatus.NEW : triageStatus;
        severity = severity == null ? FeedbackSeverity.UNSET : severity;
    }

    FeedbackReport withTriage(
            FeedbackTriageStatus status,
            FeedbackSeverity nextSeverity,
            String nextAssignee,
            String nextNote,
            Instant now) {
        return new FeedbackReport(
                feedbackId,
                correlationId,
                receivedAt,
                outcome,
                reason,
                message,
                roomId,
                participantRole,
                relatedCorrelationId,
                metadata,
                status,
                nextSeverity,
                nextAssignee,
                nextNote,
                now);
    }
}
