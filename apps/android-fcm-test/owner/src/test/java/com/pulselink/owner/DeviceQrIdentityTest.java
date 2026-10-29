package com.pulselink.owner;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public final class DeviceQrIdentityTest {
    @Test public void parsesRawDeviceIdAndVersionedIdentityUri() {
        assertEquals("clx1234567890abcdefghijk", DeviceQrIdentity.parse("clx1234567890abcdefghijk"));
        assertEquals("clx1234567890abcdefghijk", DeviceQrIdentity.parse("pulselink://device/v1/clx1234567890abcdefghijk"));
    }

    @Test public void rejectsSecretBearingOrAmbiguousPayloads() {
        assertNull(DeviceQrIdentity.parse(null));
        assertNull(DeviceQrIdentity.parse("https://example.test/device?id=clx1234567890abcdefghijk&token=secret"));
        assertNull(DeviceQrIdentity.parse("pulselink://device/v1/clx1234567890abcdefghijk?activation=secret"));
        assertNull(DeviceQrIdentity.parse("clx123"));
        assertNull(DeviceQrIdentity.parse("clx1234567890abcdefghijk/other"));
    }

    @Test public void derivesSoftApDiscoveryNameFromPublicMacIdentity() {
        assertEquals("PulseLink-89AB", DeviceQrIdentity.softApSsid("pl-0123456789ab"));
        assertNull(DeviceQrIdentity.softApSsid("clx1234567890abcdefghijk"));
    }
}
