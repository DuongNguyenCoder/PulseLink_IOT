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
        assertTrue(message.contains("SoftAP network request"));
        assertTrue(message.contains("system Wi-Fi prompt"));
        org.junit.Assert.assertFalse(message.contains("secret-like detail"));
    }

    @Test public void reportsClaimContractMismatchWithCorrelationIdWithoutClaimingSuccess() {
        String message = ClaimStartFailure.describe("api",
                new ClaimStartResponse.ContractException("missing_session", "req-claim-test"));
        assertTrue(message.contains("not linked"));
        assertTrue(message.contains("missing_session"));
        assertTrue(message.contains("req-claim-test"));
        assertTrue(message.contains("five minutes"));
    }
}
