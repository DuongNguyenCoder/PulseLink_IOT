package com.pulselink.owner;

import org.junit.Test;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

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
}
