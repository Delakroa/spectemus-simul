package com.watchtogether.backend.feedback;

import java.time.Instant;
import java.util.List;

public record FeedbackReportListResponse(
        Instant listedAt,
        int count,
        List<FeedbackReportSummary> reports) {}
