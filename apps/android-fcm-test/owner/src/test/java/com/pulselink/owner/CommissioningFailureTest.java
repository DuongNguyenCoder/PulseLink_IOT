package com.pulselink.owner;

import org.junit.Test;
import java.io.IOException;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class CommissioningFailureTest {
    @Test public void classifiesAndroidCleartextPolicyFailureWithoutEchoingException() {
        String message = CommissioningFailure.describe(
                new IOException("Cleartext HTTP traffic to 192.168.4.1 not permitted"));
        assertTrue(message.contains("local SoftAP HTTP"));
        assertTrue(message.contains("not linked"));
        assertFalse(message.contains("192.168.4.1"));
    }

    @Test public void classifiesSecurityFailureWithoutEchoingException() {
        String message = CommissioningFailure.describe(new SecurityException("sensitive platform detail"));
        assertTrue(message.contains("Android denied local SoftAP access"));
        assertFalse(message.contains("sensitive platform detail"));
    }

    @Test public void keepsOtherProofFailuresGeneric() {
        String message = CommissioningFailure.describe(new IOException("internal detail"));
        assertTrue(message.contains("Device proof or claim failed"));
        assertFalse(message.contains("internal detail"));
    }

    @Test public void distinguishesInternetHandoffFromProofFailure() {
        String message = CommissioningFailure.describeClaim("internet_handoff", new IOException("internal"));
        assertTrue(message.contains("did not restore an Internet connection"));
        assertFalse(message.contains("internal"));
    }

    @Test public void distinguishesBackendAuthorizationAndNetworkFailures() {
        String network = CommissioningFailure.describeClaim("backend_claim_completion",
                new ApiClient.ApiError(0, "internal"));
        assertTrue(network.contains("after leaving SoftAP"));
        String forbidden = CommissioningFailure.describeClaim("backend_claim_completion",
                new ApiClient.ApiError(403, "internal"));
        assertTrue(forbidden.contains("Store authorization"));
    }

    @Test public void reportsLocalProvisioningTimeoutAndRequiresFreshSession() {
        String handshake = CommissioningFailure.describeProvisioning(
                new CommissioningRequestTimeout("handshake", "response_headers", new java.net.SocketTimeoutException("secret detail")));
        assertTrue(handshake.contains("handshake did not answer within 20 seconds"));
        assertTrue(handshake.contains("fresh provisioning session"));
        assertFalse(handshake.contains("secret detail"));

        String credentials = CommissioningFailure.describeProvisioning(
                new CommissioningRequestTimeout("credentials", "write_request", new java.net.SocketTimeoutException("secret detail")));
        assertTrue(credentials.contains("checking backend status"));
        assertFalse(credentials.contains("secret detail"));
    }
}
