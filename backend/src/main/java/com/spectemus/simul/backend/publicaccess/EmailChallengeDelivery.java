package com.spectemus.simul.backend.publicaccess;

import java.time.Instant;

interface EmailChallengeDelivery {

    void deliver(String email, String code, Instant expiresAt);
}
