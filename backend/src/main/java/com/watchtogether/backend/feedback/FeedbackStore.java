package com.watchtogether.backend.feedback;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

interface FeedbackStore {

    void save(FeedbackReport report);

    Optional<FeedbackReport> find(UUID feedbackId);

    List<FeedbackReport> latest(int limit);
}
