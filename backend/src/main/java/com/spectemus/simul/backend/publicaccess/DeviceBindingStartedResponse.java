package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;
import java.util.UUID;

record DeviceBindingStartedResponse(
        UUID bindingId,
        String userCode,
        String verificationUri,
        Instant expiresAt,
        int intervalSeconds,
        String deviceCode) {}
