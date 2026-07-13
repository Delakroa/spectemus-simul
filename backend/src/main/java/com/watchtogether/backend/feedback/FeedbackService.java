package com.watchtogether.backend.feedback;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.watchtogether.backend.api.ApiException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
class FeedbackService {

    private static final Logger log = LoggerFactory.getLogger(FeedbackService.class);
    private static final int MESSAGE_PREVIEW_LIMIT = 160;

    private final Clock clock;
    private final FeedbackStore store;

    FeedbackService(Clock clock, FeedbackStore store) {
        this.clock = clock;
        this.store = store;
    }

    FeedbackResponse record(FeedbackRequest request, String correlationId) {
        UUID feedbackId = UUID.randomUUID();
        Instant receivedAt = Instant.now(clock);
        FeedbackClientMetadata metadata = request.metadata();
        String message = sanitize(request.message());
        FeedbackReport report = new FeedbackReport(
                feedbackId,
                correlationId,
                receivedAt,
                request.outcome(),
                request.reason(),
                message,
                request.roomId(),
                request.participantRole(),
                request.relatedCorrelationId(),
                metadata,
                FeedbackTriageStatus.NEW,
                FeedbackSeverity.UNSET,
                null,
                null,
                null);

        store.save(report);

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

    FeedbackReportListResponse listReports(int limit) {
        List<FeedbackReportSummary> reports = store.latest(limit).stream()
                .map(this::summary)
                .toList();

        return new FeedbackReportListResponse(Instant.now(clock), reports.size(), reports);
    }

    FeedbackReportExportResponse exportReports(int limit) {
        List<FeedbackReport> reports = store.latest(limit);
        return new FeedbackReportExportResponse(Instant.now(clock), reports.size(), reports);
    }

    FeedbackReport getReport(UUID feedbackId) {
        return store.find(feedbackId)
                .orElseThrow(() -> ApiException.notFound(
                        "FEEDBACK_NOT_FOUND",
                        "Отзыв не найден",
                        "Feedback report не найден или уже удалён по retention policy."));
    }

    FeedbackReport triage(UUID feedbackId, FeedbackTriageRequest request) {
        FeedbackReport current = getReport(feedbackId);
        FeedbackReport updated = current.withTriage(
                request.status(),
                request.severity() == null ? current.severity() : request.severity(),
                request.assignee() == null ? current.assignee() : sanitize(request.assignee()),
                request.note() == null ? current.triageNote() : sanitize(request.note()),
                Instant.now(clock));
        store.save(updated);

        log.info(
                "beta feedback triage feedbackId={} status={} severity={} assigneePresent={}",
                updated.feedbackId(),
                updated.triageStatus(),
                updated.severity(),
                updated.assignee() != null && !updated.assignee().isBlank());

        return updated;
    }

    private FeedbackReportSummary summary(FeedbackReport report) {
        return new FeedbackReportSummary(
                report.feedbackId(),
                report.correlationId(),
                report.receivedAt(),
                report.outcome(),
                report.reason(),
                report.roomId(),
                report.participantRole(),
                report.relatedCorrelationId(),
                report.triageStatus(),
                report.severity(),
                report.assignee(),
                preview(report.message()));
    }

    private String preview(String message) {
        if (message == null || message.length() <= MESSAGE_PREVIEW_LIMIT) {
            return message;
        }

        return message.substring(0, MESSAGE_PREVIEW_LIMIT - 3) + "...";
    }

    private String sanitize(String value) {
        if (value == null) {
            return null;
        }

        return value.replaceAll("[\\r\\n\\t]+", " ").strip();
    }
}
