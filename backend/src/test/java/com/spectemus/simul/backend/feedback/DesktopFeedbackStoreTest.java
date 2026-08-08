package com.spectemus.simul.backend.feedback;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.spectemus.simul.backend.room.ParticipantRole;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class DesktopFeedbackStoreTest {

    private static final Instant NOW = Instant.parse("2026-08-08T12:00:00Z");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    @Test
    void keepsReportsAcrossProcessRestart(@TempDir Path directory) {
        Path storage = directory.resolve("feedback-reports.json");
        FeedbackReport report = report("Гость потерял звук после reconnect.");

        new DesktopFeedbackStore(clock, properties(storage.toString()), objectMapper).save(report);

        // Новый экземпляр — то же, что перезапуск desktop host: отзывы прогона не должны
        // умирать вместе с процессом.
        DesktopFeedbackStore restarted =
                new DesktopFeedbackStore(clock, properties(storage.toString()), objectMapper);

        assertThat(restarted.find(report.feedbackId())).contains(report);
        assertThat(restarted.latest(10)).containsExactly(report);
    }

    @Test
    void staysInMemoryWhenStoragePathIsNotConfigured(@TempDir Path directory) {
        FeedbackReport report = report("Без пути хранения.");

        new DesktopFeedbackStore(clock, properties(""), objectMapper).save(report);

        assertThat(new DesktopFeedbackStore(clock, properties(""), objectMapper).latest(10))
                .isEmpty();
        assertThat(directory).isEmptyDirectory();
    }

    @Test
    void startsEmptyWhenStoredFileIsCorrupted(@TempDir Path directory) throws Exception {
        Path storage = directory.resolve("feedback-reports.json");
        Files.writeString(storage, "не json");

        DesktopFeedbackStore store =
                new DesktopFeedbackStore(clock, properties(storage.toString()), objectMapper);

        assertThat(store.latest(10)).isEmpty();

        // Повреждённый файл не должен блокировать приём новых отзывов.
        FeedbackReport report = report("После повреждённого файла.");
        store.save(report);
        assertThat(new DesktopFeedbackStore(clock, properties(storage.toString()), objectMapper)
                        .latest(10))
                .containsExactly(report);
    }

    private FeedbackOperationsProperties properties(String storagePath) {
        return new FeedbackOperationsProperties(
                "token", Duration.ofDays(30), 200, storagePath);
    }

    private FeedbackReport report(String message) {
        return new FeedbackReport(
                UUID.randomUUID(),
                "11111111-1111-4111-8111-111111111111",
                NOW,
                FeedbackOutcome.ISSUE,
                FeedbackReason.CONNECTION,
                message,
                "AbCdEfGhIjKlMnOpQrStUv",
                ParticipantRole.GUEST,
                null,
                null,
                FeedbackTriageStatus.NEW,
                FeedbackSeverity.UNSET,
                null,
                null,
                null);
    }
}
