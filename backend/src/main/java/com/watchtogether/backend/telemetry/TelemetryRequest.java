package com.watchtogether.backend.telemetry;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

public record TelemetryRequest(@NotEmpty @Size(max = 50) @Valid List<TelemetryEvent> events) {}
