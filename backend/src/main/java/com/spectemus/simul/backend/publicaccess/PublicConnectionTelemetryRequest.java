package com.spectemus.simul.backend.publicaccess;

import jakarta.validation.constraints.NotNull;

public record PublicConnectionTelemetryRequest(@NotNull PublicConnectionEventType type) {}
