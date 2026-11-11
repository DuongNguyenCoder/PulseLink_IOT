package com.pulselink.owner;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public final class DeviceQrIdentityTest {
    @Test public void parsesRawDeviceIdAndVersionedIdentityUri() {
        assertEquals("pl-0123456789ab", DeviceQrIdentity.parse("pl-0123456789ab"));
        assertEquals("pl-0123456789ab", DeviceQrIdentity.parse("pulselink://device/v1/pl-0123456789ab"));
    }

    @Test public void rejectsSecretBearingOrAmbiguousPayloads() {
        assertNull(DeviceQrIdentity.parse(null));
        assertNull(DeviceQrIdentity.parse("https://example.test/device?id=pl-0123456789ab&token=secret"));
        assertNull(DeviceQrIdentity.parse("pulselink://device/v1/pl-0123456789ab?activation=secret"));
        assertNull(DeviceQrIdentity.parse("clx123"));
        assertNull(DeviceQrIdentity.parse("pl-0123456789ab/other"));
    }

    @Test public void derivesSoftApDiscoveryNameFromPublicMacIdentity() {
        assertEquals("PulseLink-89AB", DeviceQrIdentity.softApSsid("pl-0123456789ab"));
        assertNull(DeviceQrIdentity.softApSsid("clx1234567890ab"));
    }

    @Test public void claimAcceptsScannedOrManuallyEnteredPublicId() {
        assertEquals("pl-0123456789ab", DeviceQrIdentity.claimCandidate("pl-0123456789ab", ""));
        assertEquals("pl-0123456789ab", DeviceQrIdentity.claimCandidate(null, "pl-0123456789ab"));
        assertNull(DeviceQrIdentity.claimCandidate(null, "invalid"));
    }
}
