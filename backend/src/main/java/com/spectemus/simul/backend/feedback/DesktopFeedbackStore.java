package com.spectemus.simul.backend.feedback;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * Feedback store для offline desktop host.
 *
 * <p>Отзывы переживают выход из приложения: без этого канал сбора дефектов был
 * write-only — форма принимала отзыв и возвращала receipt, но отчёты жили только в
 * памяти процесса и исчезали вместе с ним, а прогон терял собственный журнал дефектов.
 *
 * <p>Путь хранения задаётся конфигурацией. Если он не задан, поведение прежнее —
 * только память: так остаются рабочими тесты и любой запуск без выделенного каталога.
 */
@Repository
@Profile("desktop")
class DesktopFeedbackStore implements FeedbackStore {

    private static final Logger log = LoggerFactory.getLogger(DesktopFeedbackStore.class);

    private final Clock clock;
    private final FeedbackOperationsProperties properties;
    private final ObjectMapper objectMapper;
    private final Path storagePath;
    private final Map<UUID, FeedbackReport> reports = new LinkedHashMap<>();

    DesktopFeedbackStore(
            Clock clock, FeedbackOperationsProperties properties, ObjectMapper objectMapper) {
        this.clock = clock;
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.storagePath = properties.storagePath().isBlank()
                ? null
                : Path.of(properties.storagePath());
        restore();
    }

    @Override
    public synchronized void save(FeedbackReport report) {
        prune();
        reports.put(report.feedbackId(), report);
        persist();
    }

    @Override
    public synchronized Optional<FeedbackReport> find(UUID feedbackId) {
        prune();
        return Optional.ofNullable(reports.get(feedbackId));
    }

    @Override
    public synchronized List<FeedbackReport> latest(int limit) {
        prune();
        return reports.values().stream()
                .sorted(Comparator.comparing(FeedbackReport::receivedAt).reversed())
                .limit(Math.max(0, limit))
                .toList();
    }

    private void prune() {
        Instant cutoff = Instant.now(clock).minus(properties.retention());
        reports.entrySet().removeIf(entry -> entry.getValue().receivedAt().isBefore(cutoff));
    }

    private void restore() {
        if (storagePath == null || !Files.isReadable(storagePath)) {
            return;
        }

        try {
            String json = Files.readString(storagePath, StandardCharsets.UTF_8);
            if (json.isBlank()) {
                return;
            }
            List<FeedbackReport> stored =
                    objectMapper.readValue(json, new TypeReference<List<FeedbackReport>>() {});
            for (FeedbackReport report : stored) {
                reports.put(report.feedbackId(), report);
            }
            prune();
        } catch (IOException | RuntimeException exception) {
            // Повреждённый файл не должен мешать принимать новые отзывы: стартуем пустыми,
            // а первая же запись перезапишет файл корректным содержимым.
            log.warn("Не удалось прочитать сохранённые отзывы: {}", exception.getMessage());
        }
    }

    private void persist() {
        if (storagePath == null) {
            return;
        }

        try {
            Path parent = storagePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            // Пишем через временный файл: обрыв во время записи не должен оставить
            // наполовину записанный журнал отзывов.
            Path temporary = storagePath.resolveSibling(storagePath.getFileName() + ".tmp");
            Files.writeString(
                    temporary,
                    objectMapper.writeValueAsString(new ArrayList<>(reports.values())),
                    StandardCharsets.UTF_8);
            Files.move(
                    temporary,
                    storagePath,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException | RuntimeException exception) {
            // Отзыв уже принят и лежит в памяти: срыв записи на диск не должен
            // превращаться в ошибку пользователю.
            log.warn("Не удалось сохранить отзывы на диск: {}", exception.getMessage());
        }
    }
}
