package com.pulselink.owner;

import java.util.Locale;

/** Maps local commissioning failures to safe, actionable messages. */
final class CommissioningFailure {
    private CommissioningFailure() {}

    static String describe(Throwable failure) {
        if (containsCleartextBlock(failure)) {
            return "Android blocked the local SoftAP HTTP request. Install the updated app and retry; the Device was not linked.";
        }
        if (containsSecurityException(failure)) {
            return "Android denied local SoftAP access. Install the updated app, accept the Wi-Fi prompt, and retry; the Device was not linked.";
        }
        return "Device proof or claim failed. Device was not confirmed in this Store; check the SoftAP prompt and retry after the claim challenge expires.";
    }

    static String describeClaim(String stage, Throwable failure) {
        if ("internet_handoff".equals(stage)) {
            return "Device proof was received, but Android did not restore an Internet connection. Reconnect to Wi-Fi/mobile data and retry claim completion.";
        }
        if ("backend_claim_completion".equals(stage)) {
            if (failure instanceof ApiClient.ApiError) {
                int status = ((ApiClient.ApiError) failure).status;
                if (status == 0) return "Device proof was received, but the backend could not be reached after leaving SoftAP. Restore Internet and retry.";
                if (status == 401 || status == 403) return "The backend rejected Device proof or Store authorization. Device was not linked.";
                if (status == 409) return "The Device claim conflicts with current Store or Device state. Refresh the Store and Device list.";
                return "The backend did not complete the Device claim (HTTP " + status + "). Refresh Devices before retrying.";
            }
            return "The backend claim request could not be completed. Refresh Devices before retrying.";
        }
        if ("provisioning_session".equals(stage)) {
            return "The Device claim may be complete, but Wi-Fi setup could not be prepared. Refresh Devices before retrying provisioning.";
        }
        return describe(failure);
    }

    static String describeProvisioning(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof CommissioningRequestTimeout) {
                String stage = ((CommissioningRequestTimeout) current).stage;
                if ("credentials".equals(stage)) {
                    return "The device did not confirm the encrypted Wi-Fi request in time. Do not start another session yet; the app is checking backend status. If setup stays pending, collect the redacted app and board logs.";
                }
                if ("handshake".equals(stage)) {
                    return "The Device handshake did not answer within 20 seconds. Wi-Fi credentials were not sent; create a fresh provisioning session and retry while the SoftAP is open.";
                }
            }
            if (current instanceof java.net.SocketTimeoutException) {
                return "The Device did not answer the local commissioning request within 20 seconds. Wi-Fi configuration was not confirmed; create a fresh provisioning session and retry while the SoftAP is open.";
            }
        }
        return "The local commissioning request failed before Wi-Fi configuration was confirmed. Create a fresh provisioning session and retry while the SoftAP is open.";
    }

    private static boolean containsCleartextBlock(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            String message = current.getMessage();
            if (message == null) continue;
            String normalized = message.toLowerCase(Locale.ROOT);
            if (normalized.contains("cleartext") && normalized.contains("not permitted")) return true;
        }
        return false;
    }

    private static boolean containsSecurityException(Throwable failure) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current instanceof SecurityException) return true;
        }
        return false;
    }
}
