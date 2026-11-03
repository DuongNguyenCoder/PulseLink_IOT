package com.pulselink.owner;

/** Maps claim-start failures to actionable, secret-free UI text. */
final class ClaimStartFailure {
    private ClaimStartFailure() {}

    static String describe(String stage, Exception failure) {
        if (failure instanceof ApiClient.ApiError) {
            int status = ((ApiClient.ApiError) failure).status;
            if (status == 0) {
                return "The claim request timed out. The backend may have created a short-lived challenge; wait for it to expire before retrying.";
            }
            if (status == 401) return "Your sign-in expired. Sign in again, then retry the Device claim.";
            if (status == 403) return "This account does not have OWNER permission for the selected Store.";
            if (status == 404) return "The Store or Device was not found for this account.";
            if (status == 409) return "This Device cannot be claimed in the selected Store. Refresh Devices and check its current Store.";
            if (status >= 500) return "The staging backend is temporarily unavailable. The Device was not confirmed as claimed.";
            return "The backend rejected the claim request (HTTP " + status + ").";
        }
        if (stage.equals("softap")) {
            if (failure instanceof SecurityException) return "Android denied the nearby Wi-Fi request. Grant Nearby Wi-Fi access and retry.";
            if (failure instanceof UnsupportedOperationException) return "Device commissioning requires Android 10 or newer.";
            return "The claim challenge was created, but Android could not start the SoftAP connection request. Retry while the Device SoftAP is active.";
        }
        return "The claim response was incomplete. The Device remains unclaimed; refresh Stores and Devices before retrying.";
    }
}
