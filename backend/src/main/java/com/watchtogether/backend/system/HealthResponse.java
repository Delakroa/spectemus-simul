package com.watchtogether.backend.system;

import java.time.Instant;

public record HealthResponse(String status, Instant checkedAt) {}
