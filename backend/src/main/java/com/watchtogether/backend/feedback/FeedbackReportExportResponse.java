package com.watchtogether.backend.feedback;

import java.time.Instant;
import java.util.List;

public record FeedbackReportExportResponse(
        Instant exportedAt,
        int count,
        List<FeedbackReport> reports) {}
