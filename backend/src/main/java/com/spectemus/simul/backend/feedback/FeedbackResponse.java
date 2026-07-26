package com.spectemus.simul.backend.feedback;

import java.time.Instant;
import java.util.UUID;

public record FeedbackResponse(UUID feedbackId, String correlationId, Instant receivedAt) {}
