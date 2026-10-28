package com.pulselink.owner;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class CommissioningDeviceStatusTest {
    @Test public void onlyBackendOnlineProvisionedDeviceIsOnline() {
        assertEquals(CommissioningDeviceStatus.Stage.ONLINE,
                CommissioningDeviceStatus.fromFields("device-1", "device-1", "ONLINE", "PROVISIONED", "ENROLLED"));
    }

    @Test public void provisionedDeviceWaitsForAuthenticatedEvent() {
        assertEquals(CommissioningDeviceStatus.Stage.WAITING_FOR_EVENT,
                CommissioningDeviceStatus.fromFields("device-1", "device-1", "PENDING", "PROVISIONED", "ENROLLED"));
    }

    @Test public void missingOrRevokedDeviceNeverAppearsOnline() {
        assertEquals(CommissioningDeviceStatus.Stage.UNKNOWN,
                CommissioningDeviceStatus.fromFields("device-1", "other", "ONLINE", "PROVISIONED", "ENROLLED"));
        assertEquals(CommissioningDeviceStatus.Stage.FAILED,
                CommissioningDeviceStatus.fromFields("device-1", "device-1", "DISABLED", "REVOKED", "REVOKED"));
    }
}
