package com.watchtogether.backend.feedback;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.watchtogether.backend.room.ParticipantRole;

import org.junit.jupiter.api.Test;

class FeedbackServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-12T12:00:00Z");
    private static final String ROOM_ID = "AbCdEfGhIjKlMnOpQrStUv";

    private final InMemoryFeedbackStore store = new InMemoryFeedbackStore();
    private final FeedbackService service =
            new FeedbackService(Clock.fixed(NOW, ZoneOffset.UTC), store);

    @Test
    void recordsFeedbackIntoStoreWithSanitizedMessageAndDefaultTriage() {
        FeedbackResponse response = service.record(
                new FeedbackRequest(
                        FeedbackOutcome.ISSUE,
                        FeedbackReason.CONNECTION,
                        "звук\nпропал\tпосле reconnect",
                        ROOM_ID,
                        ParticipantRole.HOST,
                        UUID.fromString("11111111-1111-4111-8111-111111111111"),
                        null),
                "corr-1");

        FeedbackReport stored = store.latest(1).getFirst();

        assertThat(response.feedbackId()).isEqualTo(stored.feedbackId());
        assertThat(response.receivedAt()).isEqualTo(NOW);
        assertThat(stored.message()).isEqualTo("звук пропал после reconnect");
        assertThat(stored.triageStatus()).isEqualTo(FeedbackTriageStatus.NEW);
        assertThat(stored.severity()).isEqualTo(FeedbackSeverity.UNSET);
    }

    @Test
    void listsReportsWithMessagePreviewAndExportsFullRecords() {
        String longMessage = "a".repeat(170);
        store.save(new FeedbackReport(
                UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                "corr-1",
                NOW.minusSeconds(60),
                FeedbackOutcome.WORKED,
                FeedbackReason.SUCCESS,
                longMessage,
                ROOM_ID,
                ParticipantRole.GUEST,
                null,
                null,
                FeedbackTriageStatus.NEW,
                FeedbackSeverity.UNSET,
                null,
                null,
                null));

        FeedbackReportListResponse list = service.listReports(1);
        FeedbackReportExportResponse export = service.exportReports(1);

        assertThat(list.listedAt()).isEqualTo(NOW);
        assertThat(list.count()).isEqualTo(1);
        assertThat(list.reports().getFirst().messagePreview())
                .hasSize(160)
                .endsWith("...");
        assertThat(export.exportedAt()).isEqualTo(NOW);
        assertThat(export.reports().getFirst().message()).isEqualTo(longMessage);
    }

    @Test
    void triagesStoredReport() {
        UUID feedbackId = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        store.save(new FeedbackReport(
                feedbackId,
                "corr-2",
                NOW.minusSeconds(30),
                FeedbackOutcome.BLOCKED,
                FeedbackReason.SYNC,
                "seek зависает",
                ROOM_ID,
                ParticipantRole.GUEST,
                null,
                null,
                FeedbackTriageStatus.NEW,
                FeedbackSeverity.UNSET,
                null,
                null,
                null));

        FeedbackReport updated = service.triage(
                feedbackId,
                new FeedbackTriageRequest(
                        FeedbackTriageStatus.REVIEWING,
                        FeedbackSeverity.HIGH,
                        "ops\nlead",
                        "проверить\tревизию"));

        assertThat(updated.triageStatus()).isEqualTo(FeedbackTriageStatus.REVIEWING);
        assertThat(updated.severity()).isEqualTo(FeedbackSeverity.HIGH);
        assertThat(updated.assignee()).isEqualTo("ops lead");
        assertThat(updated.triageNote()).isEqualTo("проверить ревизию");
        assertThat(updated.triagedAt()).isEqualTo(NOW);
        assertThat(store.find(feedbackId)).contains(updated);
    }

    private static final class InMemoryFeedbackStore implements FeedbackStore {

        private final Map<UUID, FeedbackReport> reports = new LinkedHashMap<>();

        @Override
        public void save(FeedbackReport report) {
            reports.put(report.feedbackId(), report);
        }

        @Override
        public Optional<FeedbackReport> find(UUID feedbackId) {
            return Optional.ofNullable(reports.get(feedbackId));
        }

        @Override
        public List<FeedbackReport> latest(int limit) {
            return reports.values().stream()
                    .sorted(Comparator.comparing(FeedbackReport::receivedAt).reversed())
                    .limit(limit)
                    .toList();
        }
    }
}
