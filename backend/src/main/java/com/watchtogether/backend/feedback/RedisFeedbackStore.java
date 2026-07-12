package com.watchtogether.backend.feedback;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Repository;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Repository
class RedisFeedbackStore implements FeedbackStore {

    private static final String INDEX_KEY = "watch-together:v1:feedback:index";
    private static final String REPORT_PREFIX = "watch-together:v1:feedback:report:";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final FeedbackOperationsProperties properties;

    RedisFeedbackStore(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            FeedbackOperationsProperties properties) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    @Override
    public void save(FeedbackReport report) {
        try {
            Duration retention = properties.retention();
            String id = report.feedbackId().toString();
            redis.opsForValue().set(reportKey(id), objectMapper.writeValueAsString(report), retention);
            redis.opsForZSet().add(INDEX_KEY, id, report.receivedAt().toEpochMilli());
            redis.expire(INDEX_KEY, retention);
            redis.opsForZSet().removeRangeByScore(
                    INDEX_KEY,
                    0,
                    report.receivedAt().minus(retention).toEpochMilli());
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to serialize feedback report", exception);
        }
    }

    @Override
    public Optional<FeedbackReport> find(UUID feedbackId) {
        String id = feedbackId.toString();
        String json = redis.opsForValue().get(reportKey(id));
        if (json == null) {
            redis.opsForZSet().remove(INDEX_KEY, id);
            return Optional.empty();
        }

        return Optional.of(readReport(json));
    }

    @Override
    public List<FeedbackReport> latest(int limit) {
        if (limit <= 0) {
            return List.of();
        }

        Set<String> ids = redis.opsForZSet().reverseRange(INDEX_KEY, 0, limit - 1L);
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }

        return ids.stream()
                .map(this::findByStringId)
                .flatMap(Optional::stream)
                .toList();
    }

    private Optional<FeedbackReport> findByStringId(String id) {
        try {
            return find(UUID.fromString(id));
        } catch (IllegalArgumentException exception) {
            redis.opsForZSet().remove(INDEX_KEY, id);
            return Optional.empty();
        }
    }

    private FeedbackReport readReport(String json) {
        try {
            return objectMapper.readValue(json, FeedbackReport.class);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Unable to deserialize feedback report", exception);
        }
    }

    private String reportKey(String feedbackId) {
        return REPORT_PREFIX + feedbackId;
    }
}
