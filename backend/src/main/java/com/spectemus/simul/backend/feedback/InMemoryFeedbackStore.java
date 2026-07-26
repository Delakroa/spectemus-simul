package com.spectemus.simul.backend.feedback;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Repository;

/** Process-local feedback store for the offline desktop host. */
@Repository
@Profile("desktop")
class InMemoryFeedbackStore implements FeedbackStore {

    private final Clock clock;
    private final FeedbackOperationsProperties properties;
    private final Map<UUID, FeedbackReport> reports = new HashMap<>();

    InMemoryFeedbackStore(Clock clock, FeedbackOperationsProperties properties) {
        this.clock = clock;
        this.properties = properties;
    }

    @Override
    public synchronized void save(FeedbackReport report) {
        prune();
        reports.put(report.feedbackId(), report);
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
}
