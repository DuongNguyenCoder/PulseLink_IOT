package com.pulselink.owner;

import java.net.InetAddress;
import java.util.List;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class SoftApNetworkReadinessTest {
    @Test public void waitsUntilDhcpProvidesIpv4() throws Exception {
        assertFalse(SoftApNetworkReadiness.hasIpv4Address(List.of()));
        assertFalse(SoftApNetworkReadiness.hasIpv4Address(List.of(InetAddress.getByName("fe80::1"))));
        assertTrue(SoftApNetworkReadiness.hasIpv4Address(List.of(InetAddress.getByName("192.168.4.2"))));
    }

    @Test public void nullAddressListIsNotReady() {
        assertFalse(SoftApNetworkReadiness.hasIpv4Address(null));
    }
}
