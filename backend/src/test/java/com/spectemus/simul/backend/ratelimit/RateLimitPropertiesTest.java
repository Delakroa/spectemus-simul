package com.spectemus.simul.backend.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import com.spectemus.simul.backend.publicaccess.PublicAccessProperties;

import org.junit.jupiter.api.Test;

class RateLimitPropertiesTest {

    @Test
    void defaultDeviceBindingTokenBudgetCoversDefaultBindingTtl() {
        RateLimitProperties rateLimits = new RateLimitProperties(
                true, null, null, null, null, null, null, null, null, null, null, null, null, null);
        PublicAccessProperties publicAccess = new PublicAccessProperties(
                false, null, null, null, null, null, null, null, null, null, null, null, null);

        long ttlMillis = publicAccess.deviceBindingTtl().toMillis();
        long intervalMillis = publicAccess.devicePollInterval().toMillis();
        long requiredPolls = Math.ceilDiv(ttlMillis, intervalMillis);

        assertThat(rateLimits.deviceBindingToken().window())
                .isGreaterThanOrEqualTo(publicAccess.deviceBindingTtl());
        assertThat((long) rateLimits.deviceBindingToken().requests())
                .isGreaterThanOrEqualTo(requiredPolls);
    }
}
