package com.pulselink.owner;

import org.json.JSONArray;
import org.json.JSONObject;

/** Interprets only Owner API device records; local SoftAP responses never imply online. */
final class CommissioningDeviceStatus {
    enum Stage { WAITING_FOR_REDEMPTION, WAITING_FOR_EVENT, ONLINE, FAILED, UNKNOWN }

    private CommissioningDeviceStatus() { }

    static Stage fromDevices(JSONArray devices, String expectedDeviceId) {
        if (devices == null || expectedDeviceId == null || expectedDeviceId.isBlank()) return Stage.UNKNOWN;
        for (int index = 0; index < devices.length(); index++) {
            JSONObject device = devices.optJSONObject(index);
            if (device == null || !expectedDeviceId.equals(device.optString("id"))) continue;
            return fromFields(expectedDeviceId, device.optString("id"), device.optString("status"),
                    device.optString("provisioningState"), device.optString("enrollmentStatus"));
        }
        return Stage.UNKNOWN;
    }

    static Stage fromFields(String expectedId, String actualId, String status, String provisioning, String enrollment) {
        if (expectedId == null || actualId == null || !expectedId.equals(actualId)) return Stage.UNKNOWN;
        if ("DISABLED".equals(status) || "REVOKED".equals(provisioning) || "REVOKED".equals(enrollment)) return Stage.FAILED;
        if ("ONLINE".equals(status) && "PROVISIONED".equals(provisioning) && "ENROLLED".equals(enrollment)) return Stage.ONLINE;
        if ("PROVISIONED".equals(provisioning) && "ENROLLED".equals(enrollment)) return Stage.WAITING_FOR_EVENT;
        return Stage.WAITING_FOR_REDEMPTION;
    }
}
