package com.pulselink.owner;

import static org.junit.Assert.assertThrows;

import org.junit.Test;

public final class CommissioningTransportClientTest {
    @Test
    public void rejectsExpiredSessionBeforeNetworkUse() {
        CommissioningTransportClient client = new CommissioningTransportClient();
        assertThrows(IllegalArgumentException.class, () -> client.handshake(
                "http://192.168.4.1", "session", "AQ==", "challenge", 1L, "owner-app"));
        client.close();
    }

    @Test
    public void refusesCredentialsWithoutAuthenticatedHandshake() {
        CommissioningTransportClient client = new CommissioningTransportClient();
        assertThrows(IllegalStateException.class, () -> client.sendCredentials("http://192.168.4.1", "ssid", "password123"));
        client.close();
    }
}
