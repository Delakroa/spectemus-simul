package com.watchtogether.backend.feedback;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
class FeedbackService {

    private static final Logger log = LoggerFactory.getLogger(FeedbackService.class);

    private final Clock clock;

    FeedbackService(Clock clock) {
        this.clock = clock;
    }

    FeedbackResponse record(FeedbackRequest request, String correlationId) {
        UUID feedbackId = UUID.randomUUID();
        Instant receivedAt = Instant.now(clock);
        FeedbackClientMetadata metadata = request.metadata();
        String message = sanitize(request.message());

        log.info(
                "beta feedback feedbackId={} correlationId={} relatedCorrelationId={} outcome={} reason={} roomId={} participantRole={} message=\"{}\" metadataPresent={} browserLanguage={} networkEffectiveType={} roomStatus={} liveKitStatus={}",
                feedbackId,
                correlationId,
                request.relatedCorrelationId(),
                request.outcome(),
                request.reason(),
                request.roomId(),
                request.participantRole(),
                message,
                metadata != null,
                metadata == null ? null : sanitize(metadata.language()),
                metadata == null ? null : sanitize(metadata.networkEffectiveType()),
                metadata == null ? null : sanitize(metadata.roomStatus()),
                metadata == null ? null : sanitize(metadata.liveKitStatus()));

        return new FeedbackResponse(feedbackId, correlationId, receivedAt);
    }

    private String sanitize(String value) {
        if (value == null) {
            return null;
        }

        return value.replaceAll("[\\r\\n\\t]+", " ").strip();
    }
}
