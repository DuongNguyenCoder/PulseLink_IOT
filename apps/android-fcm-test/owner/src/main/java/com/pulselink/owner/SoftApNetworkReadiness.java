package com.pulselink.owner;

import java.net.Inet4Address;
import java.net.InetAddress;

/** A local SoftAP is ready for HTTP only after Android has assigned IPv4 via DHCP. */
final class SoftApNetworkReadiness {
    private SoftApNetworkReadiness() {}

    static boolean hasIpv4Address(Iterable<InetAddress> addresses) {
        if (addresses == null) return false;
        for (InetAddress address : addresses) {
            if (address instanceof Inet4Address) return true;
        }
        return false;
    }
}
