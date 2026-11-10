package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;

record DeviceBindingSessionResponse(
        String deviceCredential, AccountProfileResponse profile, Instant expiresAt) {}
