package com.watchtogether.backend.feedback;

import java.util.UUID;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import com.watchtogether.backend.room.ParticipantRole;

public record FeedbackRequest(
        @NotNull FeedbackOutcome outcome,
        @NotNull FeedbackReason reason,
        @Size(max = 2000) String message,
        @Pattern(regexp = "^[A-Za-z0-9_-]{22}$") String roomId,
        ParticipantRole participantRole,
        UUID relatedCorrelationId,
        @Valid FeedbackClientMetadata metadata) {}
