package com.pulselink.owner;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

public final class ClaimStartResponseTest {
    private static final String DEVICE_ID = "pl-98c377b427f4";
    private static final String STORE_ID = "store-1";
    private static final String CHALLENGE = "A".repeat(43);

    @Test public void validatesBackendChallengeFieldsBoundToDeviceAndStore() throws Exception {
        ClaimStartResponse.validateSession("claim-session-1", DEVICE_ID, STORE_ID, CHALLENGE,
                "2026-11-03T09:00:00.000Z", DEVICE_ID, STORE_ID, "req-test");
    }

    @Test public void rejectsMissingOrMismatchedClaimResponseFields() {
        ClaimStartResponse.ContractException missing = assertThrows(
                ClaimStartResponse.ContractException.class,
                () -> ClaimStartResponse.validateSession(null, null, null, null, null,
                        DEVICE_ID, STORE_ID, "req-test"));
        assertEquals("missing_session", missing.reason);
        assertEquals("req-test", missing.requestId);

        assertEquals("claim_context_mismatch", assertThrows(
                ClaimStartResponse.ContractException.class,
                () -> ClaimStartResponse.validateSession("claim-session-1", DEVICE_ID, "store-other",
                        CHALLENGE, "expires", DEVICE_ID, STORE_ID, "req-test")).reason);
        assertEquals("missing_challenge", assertThrows(
                ClaimStartResponse.ContractException.class,
                () -> ClaimStartResponse.validateSession("claim-session-1", DEVICE_ID, STORE_ID,
                        "invalid", "expires", DEVICE_ID, STORE_ID, "req-test")).reason);
    }

    @Test public void acceptsAlreadyClaimedOnlyForSameEnrolledDeviceAndStore() throws Exception {
        ClaimStartResponse.validateAlreadyClaimed(DEVICE_ID, STORE_ID, "ENROLLED",
                DEVICE_ID, STORE_ID, "req-existing");
        assertThrows(ClaimStartResponse.ContractException.class,
                () -> ClaimStartResponse.validateAlreadyClaimed(DEVICE_ID, "store-other", "ENROLLED",
                        DEVICE_ID, STORE_ID, "req-existing"));
    }
}
