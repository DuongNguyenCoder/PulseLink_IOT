package com.pulselink.owner;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertEquals;

public final class ApiClientTest {
    @Test
    public void rejectsNonHttpsApiBase() {
        assertThrows(IllegalArgumentException.class, () -> new ApiClient("http://example.invalid"));
    }

    @Test
    public void readsResponseBodyWithoutApiLevelSpecificReadAllBytes() throws Exception {
        assertEquals("{\"data\":{}}", ApiClient.readBody(
                new ByteArrayInputStream("{\"data\":{}}".getBytes(StandardCharsets.UTF_8))));
    }

    @Test
    public void installationRegistrationUsesBackendContractWithoutLoggingToken() throws Exception {
        var payload = InstallationRegistration.create("owner-installation", "test-fcm-token");
        assertEquals("owner-installation", payload.installationId);
        assertEquals("ANDROID", payload.platform);
        assertEquals("test-fcm-token", payload.fcmToken);
    }

    @Test
    public void installationRegistrationRejectsMissingToken() {
        assertThrows(IllegalArgumentException.class,
                () -> InstallationRegistration.create("owner-installation", " "));
    }
}
