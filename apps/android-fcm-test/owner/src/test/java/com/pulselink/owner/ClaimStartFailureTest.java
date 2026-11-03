package com.pulselink.owner;

import org.junit.Test;
import static org.junit.Assert.assertTrue;

public final class ClaimStartFailureTest {
    @Test public void mapsAuthorizationAndDeviceConflictSeparately() {
        assertTrue(ClaimStartFailure.describe("api", new ApiClient.ApiError(403, "internal detail"))
                .contains("OWNER permission"));
        assertTrue(ClaimStartFailure.describe("api", new ApiClient.ApiError(409, "internal detail"))
                .contains("cannot be claimed"));
    }

    @Test public void reportsUncertainChallengeWhenRequestTimesOut() {
        assertTrue(ClaimStartFailure.describe("api", new ApiClient.ApiError(0, "private detail"))
                .contains("short-lived challenge"));
    }

    @Test public void mapsSoftApPermissionWithoutExposingExceptionText() {
        String message = ClaimStartFailure.describe("softap", new SecurityException("secret-like detail"));
        assertTrue(message.contains("Nearby Wi-Fi"));
        org.junit.Assert.assertFalse(message.contains("secret-like detail"));
    }
}
